/* Integração entre assinaturas — ETAPA 1: vínculo proprietário ↔ prestador (ver INTEGRACAO_ENTRE_ASSINATURAS.md).
   Coleção de servidor `vinculos/{donoTenantId}__{prestadorTenantId}` (o haras original do dono é '_original').
   Só funções (Admin SDK) leem/gravam; as regras do app continuam fechadas entre clientes. A assinatura do CHAMADOR vem da claim do login. */
const { HttpsError } = require('firebase-functions/v2/https');
const { normalizarEmail } = require('./comum');

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
  if (t.tenantId && !(Array.isArray(t.recursos) && t.recursos.includes(RECURSO)))
    throw new HttpsError('permission-denied', 'Esse recurso ainda não foi liberado para a sua assinatura.');
}
const assinaturaDoChamador = (token) => token.tenantId || ORIGINAL;
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
  return v.filter(h => h && typeof h.id === 'string').map(h => ({ id: h.id, nome: typeof h.nome === 'string' ? h.nome : '' }));
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
  const dono = assinaturaDoChamador(token);
  const email = normalizarEmail(data.email);
  if (!RE_EMAIL.test(email) || email.length > 200) throw new HttpsError('invalid-argument', 'E-mail do prestador inválido.');
  let conta = null;
  try { conta = await auth.getUserByEmail(email); }
  catch (e) { if (!(e && e.code === 'auth/user-not-found')) throw e; }
  const c = (conta && conta.customClaims) || {};
  if (!conta || !c.tenantId || c.papel !== 'admin' || conta.disabled)
    throw new HttpsError('not-found', 'Não encontramos uma assinatura de prestador com esse e-mail. Peça para o prestador ter uma assinatura e informar o e-mail do administrador dela.');
  const prestador = c.tenantId;
  if (prestador === dono) throw new HttpsError('invalid-argument', 'Você não pode se convidar.');
  if (!(Array.isArray(c.recursos) && c.recursos.includes(RECURSO)))
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

module.exports = { ORIGINAL, RECURSO, exigirAdminComRecurso, convidarPrestador, listarVinculos, responderConvite, atualizarAnimaisDoVinculo, revogarVinculo };
