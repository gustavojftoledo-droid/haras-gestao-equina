/* Lógica de criar/bloquear cliente e medir uso (separada para poder ser testada). */
const { HttpsError } = require('firebase-functions/v2/https');
const crypto = require('crypto');
const { MODULOS, LIMITE_PADRAO_BYTES, normalizarEmail } = require('./comum');

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

  // conta já existente: só reaproveita se estiver livre (sem papel, sem tenantId, não é dono)
  let conta = null;
  try { conta = await auth.getUserByEmail(emailAdmin); }
  catch (e) { if (!(e && e.code === 'auth/user-not-found')) throw e; }
  if (conta) {
    const c = conta.customClaims || {};
    if (c.dono === true || c.tenantId || c.papel)
      throw new HttpsError('already-exists', 'Esse e-mail já pertence a outro haras ou cliente.');
  }

  const tenantId = await reservarTenantId(db, nome, {
    nome, ativo: true, criadoEm: FieldValue.serverTimestamp(), plano: 'basico', limiteBytes: LIMITE_PADRAO_BYTES,
  });
  try {
    let senhaGerada;
    if (!conta) {
      const pw = senha || (senhaGerada = senhaAleatoria());
      conta = await auth.createUser({ email: emailAdmin, password: pw, displayName: nomeAdmin || nome });
    } else if (senha) {
      await auth.updateUser(conta.uid, { password: senha });
    }
    const claimsAntigas = conta.customClaims || {};
    await auth.setCustomUserClaims(conta.uid, { ...claimsAntigas, tenantId, papel: 'admin', modulos: MODULOS.slice() });
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

module.exports = { exigirDono, criarCliente, bloquearCliente, usoDoCliente, gerarSlug, RE_TENANT };
