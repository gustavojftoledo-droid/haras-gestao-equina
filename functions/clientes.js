/* Lógica de criar/bloquear cliente e medir uso (separada para poder ser testada). */
const { HttpsError } = require('firebase-functions/v2/https');
const crypto = require('crypto');
const { MODULOS, LIMITE_PADRAO_BYTES, normalizarEmail, PLANOS: TABELA_PLANOS, ehPlano, limitesDoPlano, normalizarRecursos, recursosValidos, ehTipoAssinatura, tipoValido } = require('./comum');
const { ressincronizarCliente } = require('./papeis');
const B = require('./cobranca');

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RE_TENANT = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/; // 3 a 40, sem '-' nas pontas

function exigirDono(request){
  if (!request.auth) throw new HttpsError('unauthenticated', 'Entre na sua conta para continuar.');
  if (request.auth.token.dono !== true) throw new HttpsError('permission-denied', 'Só o dono do sistema pode fazer isso.');
}
function exigirTenantId(v){
  if (typeof v !== 'string' || !RE_TENANT.test(v)) throw new HttpsError('invalid-argument', 'Código do cliente inválido.');
  return v;
}

/* "Haras Boa Vista Ltda." -> "haras-boa-vista-ltda" (3 a 40 caracteres, só a-z 0-9 e -). */
function gerarSlug(nome){
  let s = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (s.length < 3) s = ('cliente-' + s).replace(/-+$/, '');
  return s.slice(0, 40).replace(/-+$/, '');
}
function comSufixo(base, n){
  const suf = '-' + n;
  return base.slice(0, 40 - suf.length).replace(/-+$/, '') + suf;
}
function senhaAleatoria(){ return crypto.randomBytes(9).toString('base64url'); } // 12 caracteres

/* Reserva um tenantId livre criando clientes/{id} (create() falha se já existe, então não há corrida). */
async function reservarTenantId(db, nome, dadosCliente){
  const base = gerarSlug(nome);
  for (let n = 1; n <= 50; n++) {
    const id = n === 1 ? base : comSufixo(base, n);
    try { await db.collection('clientes').doc(id).create(dadosCliente); return id; }
    catch (e) { if (e && (e.code === 6 || /ALREADY_EXISTS|already exists/i.test(e.message || ''))) continue; throw e; }
  }
  throw new HttpsError('internal', 'Não foi possível gerar um código único para o cliente.');
}

async function criarCliente({ auth, db, FieldValue }, data){
  const nome = typeof data.nome === 'string' ? data.nome.trim() : '';
  const emailAdmin = normalizarEmail(data.emailAdmin);
  const senha = data.senhaProvisoria;
  const nomeAdmin = typeof data.nomeAdmin === 'string' && data.nomeAdmin.trim() ? data.nomeAdmin.trim().slice(0, 100) : '';
  if (nome.length < 2 || nome.length > 100) throw new HttpsError('invalid-argument', 'Informe o nome do cliente (2 a 100 letras).');
  if (!RE_EMAIL.test(emailAdmin) || emailAdmin.length > 200) throw new HttpsError('invalid-argument', 'E-mail do administrador inválido.');
  if (senha !== undefined && senha !== null && (typeof senha !== 'string' || senha.length < 8 || senha.length > 100))
    throw new HttpsError('invalid-argument', 'A senha provisória precisa ter de 8 a 100 caracteres.');
  if (data.plano !== undefined && !ehPlano(data.plano)) throw new HttpsError('invalid-argument', 'Plano inválido (gratuito, basico ou pro).');
  const lim = limitesDoPlano(data.plano); // sem plano informado = básico
  if (data.tipoAssinatura !== undefined && !ehTipoAssinatura(data.tipoAssinatura)) throw new HttpsError('invalid-argument', 'Tipo de assinatura inválido (proprietario, prestador ou ambos).');
  const tipo = tipoValido(data.tipoAssinatura);
  let recursos = [];
  if (data.recursos !== undefined) { try { recursos = normalizarRecursos(data.recursos); } catch (e) { throw new HttpsError('invalid-argument', 'Lista de novidades inválida.'); } }

  // conta já existente: só reaproveita se estiver livre (sem papel, sem tenantId, não é dono)
  let conta = null;
  try { conta = await auth.getUserByEmail(emailAdmin); }
  catch (e) { if (!(e && e.code === 'auth/user-not-found')) throw e; }
  if (conta) {
    const c = conta.customClaims || {};
    if (c.dono === true || c.tenantId || c.papel)
      throw new HttpsError('already-exists', 'Esse e-mail já pertence a outro haras ou cliente.');
  }

  let criouConta = false;
  const tenantId = await reservarTenantId(db, nome, {
    nome, ativo: true, criadoEm: FieldValue.serverTimestamp(), plano: lim.plano, limiteBytes: lim.limiteBytes, recursos, tipoAssinatura: tipo,
  });
  try {
    let senhaGerada;
    if (!conta) {
      const pw = senha || (senhaGerada = senhaAleatoria());
      conta = await auth.createUser({ email: emailAdmin, password: pw, displayName: nomeAdmin || nome });
      criouConta = true;
    } else if (senha) {
      await auth.updateUser(conta.uid, { password: senha });
    }
    const claimsAntigas = conta.customClaims || {};
    await auth.setCustomUserClaims(conta.uid, { ...claimsAntigas, tenantId, papel: 'admin', modulos: lim.modulos.slice(), maxFotos: lim.maxFotos, maxUsuarios: lim.maxUsuarios, plano: lim.plano, recursos, tipoAssinatura: tipo });
    const permissoes = {};
    MODULOS.forEach(m => { permissoes[m] = { ver: true, inserir: true, editar: true, excluir: true }; });
    await db.doc(`tenants/${tenantId}/dados/usuarios_list`).set({
      value: [{ id: conta.uid, nome: nomeAdmin || nome, email: emailAdmin, admin: true, permissoes }],
    });
    const out = { tenantId };
    if (senhaGerada) out.senhaGerada = senhaGerada; // só aparece quando você não informou senha e a conta é nova
    return out;
  } catch (e) {
    await db.collection('clientes').doc(tenantId).delete().catch(() => {}); // desfaz a reserva
    // conta criada agora e sem acesso configurado = sem claim de cliente = valeria como "haras original": apaga
    if (criouConta && conta) await auth.deleteUser(conta.uid).catch(() => {});
    throw e;
  }
}

async function contasDoCliente(auth, tenantId){
  const achadas = [];
  let token;
  do {
    const r = await auth.listUsers(1000, token);
    r.users.forEach(u => { if (u.customClaims && u.customClaims.tenantId === tenantId) achadas.push(u); });
    token = r.pageToken;
  } while (token);
  return achadas;
}

async function bloquearCliente({ auth, db }, data){
  const tenantId = exigirTenantId(data.tenantId);
  if (typeof data.ativo !== 'boolean') throw new HttpsError('invalid-argument', 'Informe ativo como verdadeiro ou falso.');
  const ref = db.collection('clientes').doc(tenantId);
  if (!(await ref.get()).exists) throw new HttpsError('not-found', 'Cliente não encontrado.');
  const contas = await contasDoCliente(auth, tenantId);
  for (const u of contas) {
    await auth.updateUser(u.uid, { disabled: !data.ativo });
    await auth.revokeRefreshTokens(u.uid);
  }
  await ref.update({ ativo: data.ativo });
  return { tenantId, ativo: data.ativo, contasAfetadas: contas.length };
}

async function usoDoCliente({ db }, data){
  const tenantId = exigirTenantId(data.tenantId);
  const cli = await db.collection('clientes').doc(tenantId).get();
  if (!cli.exists) throw new HttpsError('not-found', 'Cliente não encontrado.');
  const limite = (cli.data().limiteBytes > 0) ? cli.data().limiteBytes : LIMITE_PADRAO_BYTES;
  let bytes = 0, documentos = 0;
  for await (const d of db.collection(`tenants/${tenantId}/dados`).stream()) {
    bytes += Buffer.byteLength(JSON.stringify(d.data()), 'utf8'); documentos++;
  }
  return { bytes, documentos, percentualDoLimite: Math.round(bytes / limite * 10000) / 100 };
}

/* ---- painel de clientes ---- */
const PLANOS = Object.keys(TABELA_PLANOS);
const LIMITE_MIN_BYTES = 1048576;          // 1 MB
const LIMITE_MAX_BYTES = 107374182400;     // 100 GB

function paraISO(v){
  if (!v) return null;
  try {
    const d = typeof v.toDate === 'function' ? v.toDate() : new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch (e) { return null; }
}
function normalizarConsentimento(c){
  if (!c || typeof c !== 'object') return null;
  return { aceito: c.aceito === true, data: paraISO(c.data), versao: typeof c.versao === 'string' ? c.versao : '', por: typeof c.por === 'string' ? c.por : '' };
}
/* Lista os usuários do Auth UMA vez (paginado) e agrupa por tenantId. */
async function contasPorCliente(auth){
  const mapa = new Map();
  let token;
  do {
    const r = await auth.listUsers(1000, token);
    r.users.forEach(u => {
      const t = u.customClaims && u.customClaims.tenantId;
      if (!t) return;
      if (!mapa.has(t)) mapa.set(t, []);
      mapa.get(t).push(u);
    });
    token = r.pageToken;
  } while (token);
  return mapa;
}

/* Plano do cliente (clientes/{id}.plano); ausente ou desconhecido = básico. */
async function planoDoCliente(db, tenantId){
  return (await dadosDoCliente(db, tenantId)).plano;
}
/* Plano e novidades liberadas do cliente (lidos de clientes/{id}); ausentes = básico e nenhuma novidade seletiva. */
async function dadosDoCliente(db, tenantId){
  const s = await db.collection('clientes').doc(tenantId).get();
  const d = s.exists && s.data() ? s.data() : {};
  return { plano: ehPlano(d.plano) ? d.plano : 'basico', recursos: recursosValidos(d.recursos), tipoAssinatura: tipoValido(d.tipoAssinatura) };
}
async function listaUsuariosDoCliente(db, tenantId){
  try {
    const s = await db.doc(`tenants/${tenantId}/dados/usuarios_list`).get();
    const v = s.exists && s.data() ? s.data().value : null;
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}

async function listarClientes({ auth, db }){
  const snap = await db.collection('clientes').get();
  const mapa = await contasPorCliente(auth);
  const listas = await Promise.all(snap.docs.map(doc => listaUsuariosDoCliente(db, doc.id)));
  const pagos = await B.pagamentosPorCliente(db);
  const hoje = B.hojeSaoPaulo();
  const clientes = snap.docs.map((doc, i) => {
    const d = doc.data() || {};
    const contas = mapa.get(doc.id) || [];
    const lim = limitesDoPlano(d.plano);
    const admin = contas.find(u => u.customClaims.papel === 'admin');
    let ultimo = null;
    contas.forEach(u => {
      const t = u.metadata && u.metadata.lastSignInTime ? new Date(u.metadata.lastSignInTime) : null;
      if (t && !isNaN(t.getTime()) && (!ultimo || t > ultimo)) ultimo = t;
    });
    return {
      id: doc.id,
      nome: typeof d.nome === 'string' ? d.nome : '',
      ativo: d.ativo !== false,
      plano: lim.plano,
      limites: { modulos: lim.modulos, maxFotos: lim.maxFotos, maxUsuarios: lim.maxUsuarios, limiteBytes: lim.limiteBytes },
      usuariosNaLista: listas[i].length,
      recursos: recursosValidos(d.recursos),
      tipoAssinatura: tipoValido(d.tipoAssinatura),
      cobranca: B.resumoDeCobranca(d, pagos.get(doc.id), hoje),
      criadoEm: paraISO(d.criadoEm),
      limiteBytes: d.limiteBytes > 0 ? d.limiteBytes : LIMITE_PADRAO_BYTES,
      consentimentoDados: normalizarConsentimento(d.consentimentoDados),
      contas: contas.length,
      emailAdmin: admin && admin.email ? admin.email : '',
      ultimoAcesso: ultimo ? ultimo.toISOString() : null,
    };
  });
  clientes.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }) || a.id.localeCompare(b.id));
  return { clientes };
}

async function atualizarCliente({ auth, db, emailDono }, data){
  const tenantId = exigirTenantId(data.tenantId);
  const upd = {};
  if (data.nome !== undefined) {
    const nome = typeof data.nome === 'string' ? data.nome.trim() : '';
    if (nome.length < 2 || nome.length > 100) throw new HttpsError('invalid-argument', 'Informe o nome do cliente (2 a 100 letras).');
    upd.nome = nome;
  }
  if (data.plano !== undefined) {
    if (!PLANOS.includes(data.plano)) throw new HttpsError('invalid-argument', 'Plano inválido (gratuito, basico ou pro).');
    upd.plano = data.plano;
  }
  if (data.limiteBytes !== undefined) {
    const l = data.limiteBytes;
    if (!Number.isInteger(l) || l < LIMITE_MIN_BYTES || l > LIMITE_MAX_BYTES)
      throw new HttpsError('invalid-argument', 'Limite de armazenamento inválido (1 MB a 100 GB, em bytes).');
    upd.limiteBytes = l;
  }
  if (data.consentimentoDados !== undefined) {
    const c = data.consentimentoDados;
    if (!c || typeof c !== 'object' || typeof c.aceito !== 'boolean' || typeof c.versao !== 'string' || c.versao.length < 1 || c.versao.length > 40)
      throw new HttpsError('invalid-argument', 'Consentimento inválido (aceito verdadeiro/falso e versão de 1 a 40 caracteres).');
    upd.consentimentoDados = { aceito: c.aceito, versao: c.versao, data: new Date().toISOString(), por: typeof emailDono === 'string' ? emailDono : '' };
  }
  if (data.tipoAssinatura !== undefined) {
    if (!ehTipoAssinatura(data.tipoAssinatura)) throw new HttpsError('invalid-argument', 'Tipo de assinatura inválido (proprietario, prestador ou ambos).');
    upd.tipoAssinatura = data.tipoAssinatura;
  }
  if (data.recursos !== undefined) {
    try { upd.recursos = normalizarRecursos(data.recursos); } catch (e) { throw new HttpsError('invalid-argument', 'Lista de novidades inválida (chaves com letras minúsculas, números e _; até 12).'); }
  }
  // cobrança manual: valores em CENTAVOS; null apaga o campo
  if (data.mensalidadeCentavos !== undefined) {
    const v = data.mensalidadeCentavos;
    if (v !== null && (!Number.isInteger(v) || v < 0 || v > B.MAX_MENSALIDADE_CENTAVOS)) throw new HttpsError('invalid-argument', 'Mensalidade inválida.');
    upd.mensalidadeCentavos = v;
  }
  if (data.diaVencimento !== undefined) {
    const v = data.diaVencimento;
    if (v !== null && (!Number.isInteger(v) || v < 1 || v > 28)) throw new HttpsError('invalid-argument', 'Dia de vencimento inválido (1 a 28).');
    upd.diaVencimento = v;
  }
  if (data.inicioCobranca !== undefined) {
    const v = data.inicioCobranca;
    if (v !== null && !B.dataValida(v)) throw new HttpsError('invalid-argument', 'Data de início da cobrança inválida (AAAA-MM-DD).');
    upd.inicioCobranca = v;
  }
  if (data.obsCobranca !== undefined) {
    if (typeof data.obsCobranca !== 'string') throw new HttpsError('invalid-argument', 'Observação inválida.');
    upd.obsCobranca = data.obsCobranca.trim().slice(0, 300);
  }
  const campos = Object.keys(upd);
  if (!campos.length) throw new HttpsError('invalid-argument', 'Nada para atualizar');
  const ref = db.collection('clientes').doc(tenantId);
  const atual = await ref.get();
  if (!atual.exists) throw new HttpsError('not-found', 'Cliente não encontrado.');
  // Mudança de plano: o limite de espaço passa a ser o do novo plano (a menos que venha um limite junto) e as contas
  // do cliente são reaplicadas (módulos, fotos, usuários) na hora.
  const planoAntes = limitesDoPlano((atual.data() || {}).plano).plano;
  const mudouPlano = upd.plano !== undefined && upd.plano !== planoAntes;
  const recursosAntes = recursosValidos((atual.data() || {}).recursos);
  const mudouRecursos = upd.recursos !== undefined && JSON.stringify(upd.recursos) !== JSON.stringify(recursosAntes);
  const mudouTipo = upd.tipoAssinatura !== undefined && upd.tipoAssinatura !== tipoValido((atual.data() || {}).tipoAssinatura);
  if (mudouPlano && upd.limiteBytes === undefined) upd.limiteBytes = limitesDoPlano(upd.plano).limiteBytes;
  await ref.update(upd);
  const atualizado = Object.keys(upd);
  if ((mudouPlano || mudouRecursos || mudouTipo) && auth) {
    const d = await dadosDoCliente(db, tenantId); // já com o que acabou de ser gravado
    await ressincronizarCliente(auth, { tenantId, lista: await listaUsuariosDoCliente(db, tenantId), plano: d.plano, recursos: d.recursos, tipoAssinatura: d.tipoAssinatura });
    atualizado.push('claims');
  }
  return { tenantId, atualizado };
}

module.exports = { exigirDono, criarCliente, bloquearCliente, usoDoCliente, listarClientes, atualizarCliente, planoDoCliente, dadosDoCliente, gerarSlug, RE_TENANT };
