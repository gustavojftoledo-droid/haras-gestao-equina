/* Integração entre assinaturas — ETAPA 1: vínculo proprietário ↔ prestador (ver INTEGRACAO_ENTRE_ASSINATURAS.md).
   Coleção de servidor `vinculos/{donoTenantId}__{prestadorTenantId}` (o haras original do dono é '_original').
   Só funções (Admin SDK) leem/gravam; as regras do app continuam fechadas entre clientes. A assinatura do CHAMADOR vem da claim do login. */
const { HttpsError } = require('firebase-functions/v2/https');
const { normalizarEmail, tipoValido, fazLadoProprietario, fazLadoPrestador } = require('./comum');

const ORIGINAL = '_original';
const RECURSO = 'integracao_prestadores';
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RE_VID = /^[A-Za-z0-9_-]{3,40}__[A-Za-z0-9_-]{3,40}$/;
const MAX_ANIMAIS = 1000;
const MAX_VINCULOS = 50;
const MAX_EVENTOS = 50;

function exigirAdminComRecurso(request){
  if (!request.auth) throw new HttpsError('unauthenticated', 'Entre na sua conta para continuar.');
  const t = request.auth.token || {};
  if (t.papel !== 'admin') throw new HttpsError('permission-denied', 'Só o administrador da assinatura pode fazer isso.');
  if (t.tenantId && t.tipoAssinatura !== 'ferrador' && !(Array.isArray(t.recursos) && t.recursos.includes(RECURSO)))
    throw new HttpsError('permission-denied', 'Esse recurso ainda não foi liberado para a sua assinatura.');
}
const assinaturaDoChamador = (token) => token.tenantId || ORIGINAL;
/* O haras original (sem tenantId) é proprietário. Cliente: o tipo vem da claim gravada pelo servidor. */
const tipoDoChamador = (token) => token.tenantId ? tipoValido(token.tipoAssinatura) : 'proprietario';
function exigirLado(token, lado){
  const t = tipoDoChamador(token);
  if (lado === 'proprietario' && !fazLadoProprietario(t)) throw new HttpsError('permission-denied', 'Esta assinatura é de prestador de serviço: ela não autoriza prestadores.');
  if (lado === 'prestador' && !fazLadoPrestador(t)) throw new HttpsError('permission-denied', 'Esta assinatura não é de prestador de serviço.');
}
const agora = () => new Date().toISOString();

async function nomeDaAssinatura(db, tid){
  if (tid === ORIGINAL) return 'Haras original';
  const s = await db.collection('clientes').doc(tid).get();
  return s.exists && s.data() && typeof s.data().nome === 'string' ? s.data().nome : tid;
}
async function animaisDoDono(db, tid){
  const caminho = tid === ORIGINAL ? 'harasData/horses_list' : `tenants/${tid}/dados/horses_list`;
  const s = await db.doc(caminho).get();
  const v = s.exists && s.data() && Array.isArray(s.data().value) ? s.data().value : [];
  // campos leves para a lista do prestador (sexo/categoria/situação); nada de valores nem dados do proprietário
  const t = (x, n) => typeof x === 'string' ? x.slice(0, n) : '';
  return v.filter(h => h && typeof h.id === 'string').map(h => ({ id: h.id, nome: typeof h.nome === 'string' ? h.nome : '', sexo: t(h.sexo, 12), categoria: t(h.categoria, 40), pelagem: t(h.pelagem, 40), raca: t(h.raca, 40),
    inativo: h.situacao === 'V' || h.situacao === 'E' || !!h.falecimento }));   // ativo = não é Externo, nem Vendido, nem Falecido (mesma regra da aba Ativos)
}
/* Valida a escolha de animais: todos, ou uma lista (1+) de ids que existam no cadastro do proprietário. */
async function validarAnimais(db, dono, data){
  if (data.animaisTodos === true) return { animaisTodos: true, animaisIds: [] };
  if (!Array.isArray(data.animais) || data.animais.length < 1) throw new HttpsError('invalid-argument', 'Escolha ao menos um animal, ou marque "todos".');
  if (data.animais.length > MAX_ANIMAIS) throw new HttpsError('invalid-argument', 'Animais demais para uma autorização.');
  const ids = [...new Set(data.animais.map(a => (a && typeof a === 'object') ? a.id : a))];
  if (ids.some(i => typeof i !== 'string' || !i)) throw new HttpsError('invalid-argument', 'Lista de animais inválida.');
  const meus = new Set((await animaisDoDono(db, dono)).map(a => a.id));
  if (ids.some(i => !meus.has(i))) throw new HttpsError('invalid-argument', 'Algum animal não pertence ao seu cadastro.');
  return { animaisTodos: false, animaisIds: ids };
}
function addEvento(v, por, acao){
  const ev = Array.isArray(v.eventos) ? v.eventos.slice(-(MAX_EVENTOS - 1)) : [];
  ev.push({ em: agora(), por: por || '', acao });
  return ev;
}
const publico = (id, v) => ({ id, donoTenantId: v.donoTenantId, donoNome: v.donoNome, prestadorTenantId: v.prestadorTenantId, prestadorNome: v.prestadorNome,
  prestadorEmail: v.prestadorEmail, status: v.status, animaisTodos: v.animaisTodos === true, animaisIds: Array.isArray(v.animaisIds) ? v.animaisIds : [],
  criadoEm: v.criadoEm || null, criadoPor: v.criadoPor || '', atualizadoEm: v.atualizadoEm || null });

async function convidarPrestador({ auth, db, token }, data){
  exigirLado(token, 'proprietario');
  const dono = assinaturaDoChamador(token);
  const email = normalizarEmail(data.email);
  if (!RE_EMAIL.test(email) || email.length > 200) throw new HttpsError('invalid-argument', 'E-mail do prestador inválido.');
  let conta = null;
  try { conta = await auth.getUserByEmail(email); }
  catch (e) { if (!(e && e.code === 'auth/user-not-found')) throw e; }
  const c = (conta && conta.customClaims) || {};
  if (!conta || !c.tenantId || c.papel !== 'admin' || conta.disabled || !fazLadoPrestador(c.tipoAssinatura))
    throw new HttpsError('not-found', 'Não encontramos uma assinatura de prestador com esse e-mail. Peça para o prestador ter uma assinatura e informar o e-mail do administrador dela.');
  const prestador = c.tenantId;
  if (prestador === dono) throw new HttpsError('invalid-argument', 'Você não pode se convidar.');
  if (c.tipoAssinatura !== 'ferrador' && !(Array.isArray(c.recursos) && c.recursos.includes(RECURSO)))   // assinatura de ferrador já nasce com a integração
    throw new HttpsError('failed-precondition', 'Essa assinatura ainda não tem o recurso de prestadores liberado.');
  const escolha = await validarAnimais(db, dono, data);
  const vid = `${dono}__${prestador}`;
  const ref = db.collection('vinculos').doc(vid);
  const atual = await ref.get();
  if (atual.exists && ['pendente', 'ativo'].includes(atual.data().status)) throw new HttpsError('already-exists', 'Já existe um vínculo com esse prestador.');
  const meus = await db.collection('vinculos').where('donoTenantId', '==', dono).get();
  if (meus.size >= MAX_VINCULOS && !atual.exists) throw new HttpsError('resource-exhausted', 'Limite de prestadores atingido.');
  const por = typeof token.email === 'string' ? token.email : '';
  const base = atual.exists ? atual.data() : {};
  const doc = { donoTenantId: dono, donoNome: await nomeDaAssinatura(db, dono), prestadorTenantId: prestador, prestadorNome: await nomeDaAssinatura(db, prestador),
    prestadorEmail: email, status: 'pendente', ...escolha, criadoEm: agora(), criadoPor: por, atualizadoEm: agora(), eventos: addEvento(base, por, 'convite enviado') };
  await ref.set(doc);
  return publico(vid, doc);
}

async function listarVinculos({ db, token }){
  const eu = assinaturaDoChamador(token);
  const [a, b] = await Promise.all([
    db.collection('vinculos').where('donoTenantId', '==', eu).get(),
    db.collection('vinculos').where('prestadorTenantId', '==', eu).get(),
  ]);
  const lista = (snap) => snap.docs.map(d => publico(d.id, d.data())).sort((x, y) => String(y.atualizadoEm).localeCompare(String(x.atualizadoEm)));
  const prop = lista(a), prest = lista(b);
  // o prestador não vê a lista de animais antes de aceitar; depois, só quantos/todos (os nomes vêm na etapa 2)
  prest.forEach(v => { if (v.status !== 'ativo') v.animaisIds = []; });
  return { comoProprietario: prop, comoPrestador: prest };
}

async function carregarVinculo(db, vid){
  if (typeof vid !== 'string' || !RE_VID.test(vid)) throw new HttpsError('invalid-argument', 'Vínculo inválido.');
  const ref = db.collection('vinculos').doc(vid);
  const s = await ref.get();
  if (!s.exists) throw new HttpsError('not-found', 'Vínculo não encontrado.');
  return { ref, v: s.data() };
}

async function responderConvite({ db, token }, data){
  exigirLado(token, 'prestador');
  const eu = assinaturaDoChamador(token);
  const { ref, v } = await carregarVinculo(db, data.vinculoId);
  if (v.prestadorTenantId !== eu) throw new HttpsError('permission-denied', 'Esse convite não é para a sua assinatura.');
  if (v.status !== 'pendente') throw new HttpsError('failed-precondition', 'Esse convite não está mais pendente.');
  if (typeof data.aceitar !== 'boolean') throw new HttpsError('invalid-argument', 'Informe aceitar como verdadeiro ou falso.');
  const por = typeof token.email === 'string' ? token.email : '';
  const novo = { ...v, status: data.aceitar ? 'ativo' : 'recusado', atualizadoEm: agora(), eventos: addEvento(v, por, data.aceitar ? 'convite aceito' : 'convite recusado') };
  if (data.aceitar) novo.aceitoEm = agora();
  await ref.set(novo);
  return publico(ref.id, novo);
}

async function atualizarAnimaisDoVinculo({ db, token }, data){
  exigirLado(token, 'proprietario');
  const eu = assinaturaDoChamador(token);
  const { ref, v } = await carregarVinculo(db, data.vinculoId);
  if (v.donoTenantId !== eu) throw new HttpsError('permission-denied', 'Só o proprietário muda os animais liberados.');
  if (!['pendente', 'ativo'].includes(v.status)) throw new HttpsError('failed-precondition', 'Esse vínculo não está ativo.');
  const escolha = await validarAnimais(db, eu, data);
  const por = typeof token.email === 'string' ? token.email : '';
  const novo = { ...v, ...escolha, atualizadoEm: agora(), eventos: addEvento(v, por, escolha.animaisTodos ? 'animais: todos' : `animais: ${escolha.animaisIds.length} liberado(s)`) };
  await ref.set(novo);
  return publico(ref.id, novo);
}

async function revogarVinculo({ db, token }, data){
  const eu = assinaturaDoChamador(token);
  const { ref, v } = await carregarVinculo(db, data.vinculoId);
  const lado = v.donoTenantId === eu ? 'proprietário' : (v.prestadorTenantId === eu ? 'prestador' : null);
  if (!lado) throw new HttpsError('permission-denied', 'Esse vínculo não é da sua assinatura.');
  if (!['pendente', 'ativo'].includes(v.status)) throw new HttpsError('failed-precondition', 'Esse vínculo já está encerrado.');
  const por = typeof token.email === 'string' ? token.email : '';
  const novo = { ...v, status: 'revogado', revogadoEm: agora(), revogadoPor: por, revogadoLado: lado, atualizadoEm: agora(), eventos: addEvento(v, por, `vínculo encerrado pelo ${lado}`) };
  await ref.set(novo);
  return publico(ref.id, novo);
}

/* ---------------- ETAPA 2: envio do registro pelo prestador (solicitação PENDENTE) ----------------
   Coleção de servidor `solicitacoes/{id}`. Nada entra na ficha do proprietário aqui: só fica pendente (a aprovação é a etapa 3).
   Itens: 'servico' (leva o VALOR do prestador) e 'material' (estoque/preço do proprietário; só leva valor se o prestador marcou
   "este produto é meu": produtoDoPrestador=true, com valor unitário). Preço de compra/estoque do prestador nunca são enviados. */
const TIPOS_REGISTRO = ['aplicacao', 'tratamento', 'procedimento', 'consulta', 'visita', 'casco', 'outro'];
const CATEGORIAS_SERVICO = ['consulta', 'procedimento', 'exame', 'casqueamento', 'ferrageamento', 'deslocamento', 'outro'];
const MAX_ITENS = 30, MAX_PENDENTES_POR_VINCULO = 50, MAX_LISTA = 200;
const MAX_VALOR_CENTAVOS = 100000000;
const RE_SID = /^[A-Za-z0-9]{10,40}$/;
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const dataOk = (d) => { if (typeof d !== 'string' || !RE_DATA.test(d)) return false; const x = new Date(d + 'T00:00:00Z'); return !isNaN(x.getTime()) && x.toISOString().slice(0, 10) === d; };
const txt = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const inteiro = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;

function limparItens(brutos, permiteVazio){
  if (permiteVazio && (brutos === undefined || (Array.isArray(brutos) && brutos.length === 0))) return [];
  if (!Array.isArray(brutos) || brutos.length < 1) throw new HttpsError('invalid-argument', 'Inclua ao menos um item (serviço ou material).');
  if (brutos.length > MAX_ITENS) throw new HttpsError('invalid-argument', 'Itens demais em um envio (máximo ' + MAX_ITENS + ').');
  return brutos.map((it, i) => {
    const n = i + 1;
    if (!it || typeof it !== 'object') throw new HttpsError('invalid-argument', `Item ${n} inválido.`);
    const nome = txt(it.nome, 120);
    if (nome.length < 2) throw new HttpsError('invalid-argument', `Informe o nome do item ${n}.`);
    if (it.tipo === 'servico') {
      if (!inteiro(it.valorCentavos, MAX_VALOR_CENTAVOS)) throw new HttpsError('invalid-argument', `Informe o valor do serviço "${nome}".`);
      const categoria = it.categoria === undefined || it.categoria === '' ? 'outro' : it.categoria;
      if (!CATEGORIAS_SERVICO.includes(categoria)) throw new HttpsError('invalid-argument', `Categoria inválida no serviço "${nome}".`);
      return { tipo: 'servico', nome, categoria, valorCentavos: it.valorCentavos, obs: txt(it.obs, 300) };
    }
    if (it.tipo === 'material') {
      if (!(typeof it.quantidade === 'number' && isFinite(it.quantidade) && it.quantidade > 0 && it.quantidade <= 100000)) throw new HttpsError('invalid-argument', `Quantidade inválida em "${nome}".`);
      const meu = it.produtoDoPrestador === true;
      const base = { tipo: 'material', nome, quantidade: it.quantidade, unidade: txt(it.unidade, 20), produtoDoPrestador: meu, obs: txt(it.obs, 300) };
      if (meu) {
        if (!inteiro(it.valorUnitarioCentavos, MAX_VALOR_CENTAVOS)) throw new HttpsError('invalid-argument', `Informe o valor cobrado por unidade de "${nome}" (produto seu).`);
        base.valorUnitarioCentavos = it.valorUnitarioCentavos;
      } else if (it.valorUnitarioCentavos !== undefined && it.valorUnitarioCentavos !== null) {
        throw new HttpsError('invalid-argument', `"${nome}" não é produto seu: não envie valor (vale o estoque e o preço do proprietário).`);
      }
      return base;
    }
    throw new HttpsError('invalid-argument', `Tipo inválido no item ${n} (servico ou material).`);
  });
}

async function vinculoDoPrestador(db, token, vid){
  exigirLado(token, 'prestador');
  const eu = assinaturaDoChamador(token);
  const { v } = await carregarVinculo(db, vid);
  if (v.prestadorTenantId !== eu) throw new HttpsError('permission-denied', 'Esse vínculo não é da sua assinatura.');
  if (v.status !== 'ativo') throw new HttpsError('failed-precondition', 'Esse vínculo não está ativo.');
  return v;
}
async function animaisLiberados(db, v){
  const todos = await animaisDoDono(db, v.donoTenantId);
  if (v.animaisTodos === true) return todos.filter(a => !a.inativo);   // "Todos" = todos os animais ATIVOS do cliente
  const ids = new Set(Array.isArray(v.animaisIds) ? v.animaisIds : []);
  return todos.filter(a => ids.has(a.id)).map(a => ({ ...a, inativo: false }));   // escolhidos um a um valem como o dono marcou
}

async function animaisAutorizados({ db, token }, data){
  const v = await vinculoDoPrestador(db, token, data.vinculoId);
  return { vinculoId: data.vinculoId, donoNome: v.donoNome, animais: (await animaisLiberados(db, v)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')) };
}

const MAX_ANIMAIS_REGISTRO = 80;
/* Um registro = UM lançamento: vários animais do mesmo cliente de uma vez (cada um com seus itens) + itens comuns ao lançamento (ex.: deslocamento).
   Entrada: { animais: [{ id, itens }], itensComuns } — ou o formato antigo de um animal só: { animalId, itens }. */
async function enviarSolicitacao({ db, token }, data){
  const v = await vinculoDoPrestador(db, token, data.vinculoId);
  const liberados = await animaisLiberados(db, v);
  if (!dataOk(data.dataRegistro)) throw new HttpsError('invalid-argument', 'Data do registro inválida (AAAA-MM-DD).');
  const amanha = new Date(Date.now() + 36 * 3600000).toISOString().slice(0, 10);
  if (data.dataRegistro > amanha) throw new HttpsError('invalid-argument', 'A data do registro não pode ser no futuro.');
  const tipoRegistro = data.tipoRegistro === undefined || data.tipoRegistro === '' ? 'outro' : data.tipoRegistro;
  if (!TIPOS_REGISTRO.includes(tipoRegistro)) throw new HttpsError('invalid-argument', 'Tipo de registro inválido.');
  const entrada = Array.isArray(data.animais) ? data.animais : [{ id: data.animalId, itens: data.itens }];
  if (entrada.length < 1 || entrada.length > MAX_ANIMAIS_REGISTRO) throw new HttpsError('invalid-argument', 'Informe de 1 a ' + MAX_ANIMAIS_REGISTRO + ' animais.');
  const vistos = new Set(), animaisOut = [];
  for (const e of entrada) {
    const animal = e && liberados.find(a => a.id === e.id);
    if (!animal) throw new HttpsError('permission-denied', 'Esse animal não está liberado para você.');
    if (vistos.has(animal.id)) throw new HttpsError('invalid-argument', 'Animal repetido no registro.');
    vistos.add(animal.id);
    animaisOut.push({ id: animal.id, nome: animal.nome, itens: limparItens(e.itens, entrada.length > 1 || Array.isArray(data.itensComuns)) });
  }
  const itensComuns = Array.isArray(data.itensComuns) && data.itensComuns.length ? limparItens(data.itensComuns) : [];
  const todosItens = [...animaisOut.flatMap(a => a.itens), ...itensComuns];
  if (todosItens.length < 1) throw new HttpsError('invalid-argument', 'Inclua ao menos um item (serviço ou material).');
  if (tipoDoChamador(token) === 'ferrador') {
    if (tipoRegistro !== 'casco') throw new HttpsError('permission-denied', 'A assinatura de ferrador só registra casqueamento/ferrageamento.');
    if (todosItens.some(i => i.tipo !== 'servico' || !['casqueamento', 'ferrageamento', 'deslocamento'].includes(i.categoria))) throw new HttpsError('permission-denied', 'A assinatura de ferrador só envia serviços de casqueamento, ferrageamento e deslocamento.');
  }
  const por = typeof token.email === 'string' ? token.email : '';
  const nomes = animaisOut.map(a => a.nome).join(', ').slice(0, 300);
  const corpo = { dataRegistro: data.dataRegistro, tipoRegistro, descricao: txt(data.descricao, 1000), animais: animaisOut, itensComuns, itens: todosItens, animalId: animaisOut[0].id, animalNome: nomes };
  // Correção de um registro já enviado: se a versão antiga ainda está PENDENTE (e é deste prestador e deste vínculo), a nova a substitui.
  if (typeof data.substituiSolicitacaoId === 'string' && RE_SID.test(data.substituiSolicitacaoId)) {
    const antigaRef = db.collection('solicitacoes').doc(data.substituiSolicitacaoId);
    const antiga = await antigaRef.get();
    const a = antiga.exists ? antiga.data() : null;
    if (a && a.status === 'pendente' && a.prestadorTenantId === v.prestadorTenantId && a.vinculoId === data.vinculoId) {
      const novaVersao = { ...a, ...corpo, atualizadoEm: agora(), enviadoPor: por,
        eventos: [...(a.eventos || []).slice(-(MAX_EVENTOS - 1)), { em: agora(), por, acao: 'versão atualizada pelo prestador (substitui a pendente)' }] };
      await antigaRef.set(novaVersao);
      return { id: antigaRef.id, substituida: true, ...novaVersao };
    }
  }
  const pend = await db.collection('solicitacoes').where('vinculoId', '==', data.vinculoId).where('status', '==', 'pendente').get();
  if (pend.size >= MAX_PENDENTES_POR_VINCULO) throw new HttpsError('resource-exhausted', 'Há solicitações pendentes demais para esse proprietário. Aguarde a aprovação.');
  const ref = db.collection('solicitacoes').doc();
  const doc = { vinculoId: data.vinculoId, donoTenantId: v.donoTenantId, donoNome: v.donoNome, prestadorTenantId: v.prestadorTenantId, prestadorNome: v.prestadorNome,
    enviadoPor: por, ...corpo, status: 'pendente', criadoEm: agora(), atualizadoEm: agora(), eventos: [{ em: agora(), por, acao: 'enviado ao proprietário' }] };
  await ref.set(doc);
  return { id: ref.id, ...doc };
}

const solPublica = (id, d) => ({ id, vinculoId: d.vinculoId, donoNome: d.donoNome, prestadorNome: d.prestadorNome, enviadoPor: d.enviadoPor, animalId: d.animalId, animalNome: d.animalNome,
  animais: Array.isArray(d.animais) ? d.animais : [{ id: d.animalId, nome: d.animalNome, itens: Array.isArray(d.itens) ? d.itens : [] }], itensComuns: Array.isArray(d.itensComuns) ? d.itensComuns : [],
  dataRegistro: d.dataRegistro, tipoRegistro: d.tipoRegistro, descricao: d.descricao || '', itens: Array.isArray(d.itens) ? d.itens : [], status: d.status,
  criadoEm: d.criadoEm || null, atualizadoEm: d.atualizadoEm || null, motivo: d.motivo || '' });

async function listarSolicitacoes({ db, token }){
  const eu = assinaturaDoChamador(token);
  const ordem = (a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm));
  const [a, b] = await Promise.all([
    db.collection('solicitacoes').where('donoTenantId', '==', eu).get(),
    db.collection('solicitacoes').where('prestadorTenantId', '==', eu).get(),
  ]);
  const lista = (snap) => snap.docs.map(d => solPublica(d.id, d.data())).sort(ordem).slice(0, MAX_LISTA);
  return { recebidas: lista(a), enviadas: lista(b) };
}

async function cancelarSolicitacao({ db, token }, data){
  exigirLado(token, 'prestador');
  if (typeof data.solicitacaoId !== 'string' || !RE_SID.test(data.solicitacaoId)) throw new HttpsError('invalid-argument', 'Solicitação inválida.');
  const ref = db.collection('solicitacoes').doc(data.solicitacaoId);
  const s = await ref.get();
  if (!s.exists) throw new HttpsError('not-found', 'Solicitação não encontrada.');
  const d = s.data();
  if (d.prestadorTenantId !== assinaturaDoChamador(token)) throw new HttpsError('permission-denied', 'Essa solicitação não é da sua assinatura.');
  if (d.status !== 'pendente') throw new HttpsError('failed-precondition', 'Só dá para cancelar enquanto está pendente.');
  const por = typeof token.email === 'string' ? token.email : '';
  const novo = { ...d, status: 'cancelado', atualizadoEm: agora(), eventos: [...(d.eventos || []).slice(-(MAX_EVENTOS - 1)), { em: agora(), por, acao: 'cancelado pelo prestador' }] };
  await ref.set(novo);
  return solPublica(ref.id, novo);
}

/* ---------------- ETAPA 3: o proprietário decide (aprovar, com revisão opcional, ou recusar) ----------------
   O APP do proprietário grava o registro na ficha dele (mesmo código do lançamento manual, sem duplicar: o registro leva o id da
   solicitação) e depois confirma aqui. O servidor só muda o estado da solicitação; nunca escreve na ficha do proprietário. */
async function decidirSolicitacao({ db, token }, data){
  exigirLado(token, 'proprietario');
  if (typeof data.solicitacaoId !== 'string' || !RE_SID.test(data.solicitacaoId)) throw new HttpsError('invalid-argument', 'Solicitação inválida.');
  if (data.decisao !== 'aprovar' && data.decisao !== 'recusar') throw new HttpsError('invalid-argument', 'Decisão inválida (aprovar ou recusar).');
  const ref = db.collection('solicitacoes').doc(data.solicitacaoId);
  const s = await ref.get();
  if (!s.exists) throw new HttpsError('not-found', 'Solicitação não encontrada.');
  const d = s.data();
  if (d.donoTenantId !== assinaturaDoChamador(token)) throw new HttpsError('permission-denied', 'Essa solicitação não é para a sua assinatura.');
  if (d.status !== 'pendente') throw new HttpsError('failed-precondition', 'Essa solicitação já foi decidida (' + d.status + ').');
  const por = typeof token.email === 'string' ? token.email : '';
  const novo = { ...d, atualizadoEm: agora() };
  if (data.decisao === 'recusar') {
    const motivo = txt(data.motivo, 300);
    if (motivo.length < 3) throw new HttpsError('invalid-argument', 'Informe o motivo da recusa (aparece para o prestador).');
    novo.status = 'recusado'; novo.motivo = motivo;
    novo.eventos = addEvento(d, por, 'recusado pelo proprietário: ' + motivo);
  } else {
    let revisado = false;
    if (data.itens !== undefined && Array.isArray(d.animais) && d.animais.length > 1) throw new HttpsError('invalid-argument', 'Revisão de valores só vale para registro de um animal; ajuste no cadastro e aprove.');
    if (data.itens !== undefined) {
      const itens = limparItens(data.itens);
      revisado = JSON.stringify(itens) !== JSON.stringify(d.itens || []);
      if (revisado) { novo.itensOriginais = Array.isArray(d.itensOriginais) ? d.itensOriginais : (d.itens || []); novo.itens = itens; }
    }
    novo.status = 'aprovado'; novo.aprovadoEm = agora(); novo.aprovadoPor = por; novo.motivo = '';
    novo.eventos = addEvento(d, por, revisado ? 'aprovado pelo proprietário (valores revisados)' : 'aprovado pelo proprietário');
  }
  await ref.set(novo);
  return solPublica(ref.id, novo);
}

/* ---------------- FICHA SÓ-LEITURA do animal liberado (o prestador vê o cavalo do cliente como se fosse dele) ----------------
   Leitura ao vivo no servidor, com LISTA FIXA de campos: nunca valores, custos, financeiro, estoque, vendas nem dados do proprietário. */
const CAMPOS_ANIMAL = ['nome', 'apelido', 'sexo', 'nascimento', 'pelagem', 'raca', 'categoria', 'status', 'localizacao', 'pai', 'mae', 'situacao', 'registro', 'microchip'];
const caminhoDoDono = (dono, key) => dono === ORIGINAL ? `harasData/${key}` : `tenants/${dono}/dados/${key}`;
async function lerLista(db, dono, key){
  const s = await db.doc(caminhoDoDono(dono, key)).get();
  return s.exists && s.data() && Array.isArray(s.data().value) ? s.data().value : [];
}
/* treinos podem estar divididos por ano (treinos_indice + treinos_AAAA): lê os dois anos mais recentes (ou o documento único). */
async function lerTreinos(db, dono){
  const ri = await db.doc(caminhoDoDono(dono, 'treinos_indice')).get();
  const idx = ri.exists ? ri.data() && ri.data().value : null;
  if (idx && typeof idx === 'object' && !Array.isArray(idx) && Number(idx.versao) >= 1 && Array.isArray(idx.docs)) {
    const docs = [...new Set(idx.docs)].filter(d => typeof d === 'string' && /^[A-Za-z0-9_]{3,40}$/.test(d)).sort().slice(-2);
    const todos = [];
    for (const d of docs) todos.push(...await lerLista(db, dono, d));
    return todos;
  }
  return lerLista(db, dono, 'treinos_list');
}
const soTexto = (v, max) => typeof v === 'string' ? v.slice(0, max) : '';
async function fichaDoAnimal({ db, token }, data){
  const v = await vinculoDoPrestador(db, token, data.vinculoId);
  const liberados = await animaisLiberados(db, v);
  if (typeof data.animalId !== 'string' || !liberados.some(a => a.id === data.animalId)) throw new HttpsError('permission-denied', 'Esse animal não está liberado para você.');
  const id = data.animalId, dono = v.donoTenantId;
  const [horses, manejos, tratamentos] = await Promise.all([lerLista(db, dono, 'horses_list'), lerLista(db, dono, 'manejos_list'), lerLista(db, dono, 'tratamentos_list')]);
  const treinos = await lerTreinos(db, dono);
  const h = horses.find(x => x && x.id === id);
  if (!h) throw new HttpsError('not-found', 'Animal não encontrado no cadastro do proprietário.');
  const animal = {}; CAMPOS_ANIMAL.forEach(k => { if (h[k] !== undefined && h[k] !== null && typeof h[k] !== 'object') animal[k] = soTexto(String(h[k]), 120); });
  if (h.examesSaude && typeof h.examesSaude === 'object') {
    animal.examesSaude = {}; Object.keys(h.examesSaude).slice(0, 10).forEach(t => { const e = h.examesSaude[t]; if (e && typeof e === 'object') animal.examesSaude[soTexto(t, 40)] = { data: soTexto(e.data, 10), validade: soTexto(e.validade, 10), resultado: soTexto(e.resultado, 60) }; });
  }
  const doAnimal = (arr) => (Array.isArray(arr) ? arr : []).filter(x => x && Array.isArray(x.animais) && x.animais.some(a => a && a.id === id));
  const porData = (a, b) => String(b.data || b.dataInicio || '').localeCompare(String(a.data || a.dataInicio || ''));
  const manejosOut = doAnimal(manejos).sort(porData).slice(0, 40).map(m => {
    const a = m.animais.find(x => x && x.id === id) || {};
    return { data: soTexto(m.data, 10), tipo: soTexto(m.tipo, 30), subtipo: soTexto(a.tipo || m.subtipoCasco, 60), ferrador: soTexto(m.ferrador, 80), medicamento: soTexto(m.medicamentoNome, 80), obs: soTexto([m.obs, a.extra].filter(Boolean).join(' — '), 300) };
  });
  const tratamentosOut = doAnimal(tratamentos).sort(porData).slice(0, 15).map(t => ({ medicamento: soTexto(t.medicamentoNome, 80), quantidade: Number(t.quantidade) || 0, unidade: soTexto(t.unidade, 20), meio: soTexto(t.meioAplicacao, 40),
    dataInicio: soTexto(t.dataInicio, 10), aplicacoes: Number(t.diasTratamento) || 0, intervaloDias: Number(t.intervaloDias) || 1, obs: soTexto(t.obs, 300) }));
  const treinosOut = doAnimal(treinos).sort(porData).slice(0, 15).map(t => ({ data: soTexto(t.data, 10), tipo: soTexto(t.tipo, 40), local: soTexto(t.local, 60) }));
  if (tipoDoChamador(token) === 'ferrador') { // ferrador: só dados do animal (sem exames) e manejos de casco
    delete animal.examesSaude;
    return { vinculoId: data.vinculoId, donoNome: v.donoNome, animal, manejos: manejosOut.filter(m => m.tipo === 'Casco'), tratamentos: [], treinos: [] };
  }
  return { vinculoId: data.vinculoId, donoNome: v.donoNome, animal, manejos: manejosOut, tratamentos: tratamentosOut, treinos: treinosOut };
}

module.exports = { ORIGINAL, RECURSO, exigirAdminComRecurso, convidarPrestador, listarVinculos, responderConvite, atualizarAnimaisDoVinculo, revogarVinculo,
  animaisAutorizados, enviarSolicitacao, listarSolicitacoes, cancelarSolicitacao, decidirSolicitacao, fichaDoAnimal };
