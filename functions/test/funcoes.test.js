/* Testes automatizados. Rodam contra os emuladores de Auth e Firestore (nada de produção).
   Como rodar: veja README.md (firebase emulators:exec --only firestore,auth ... "node --test test/"). */
process.env.GCLOUD_PROJECT = 'demo-haras';
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('Rode com os emuladores ligados (FIRESTORE_EMULATOR_HOST e FIREBASE_AUTH_EMULATOR_HOST).');
}
const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const fft = require('firebase-functions-test')({ projectId: 'demo-haras' });
const F = require('../index');
const { MODULOS } = require('../comum');

const auth = getAuth(), db = getFirestore();
const trigHaras = fft.wrap(F.sincronizarPapeis);
const trigCliente = fft.wrap(F.sincronizarPapeisCliente);
const wCriar = fft.wrap(F.criarCliente), wBloq = fft.wrap(F.bloquearCliente), wUso = fft.wrap(F.usoDoCliente);

const perm = (...mods) => { const p = {}; mods.forEach(m => p[m] = { ver: true, inserir: false, editar: false, excluir: false }); return p; };
const user = (email, admin, mods = []) => ({ id: email, nome: email, email, admin, permissoes: perm(...mods) });
const snap = (lista, path) => fft.firestore.makeDocumentSnapshot(lista === null ? {} : { value: lista }, path);
// monta o evento de escrita (antes/depois). lista null = documento não existia / foi apagado
const evento = (antes, depois, path, params = {}) => ({
  params,
  data: {
    before: antes === null ? fft.firestore.makeDocumentSnapshot({}, path) : snap(antes, path),
    after: depois === null ? fft.firestore.makeDocumentSnapshot({}, path) : snap(depois, path),
  },
});
// makeDocumentSnapshot de {} existe=true; para "não existia" usamos objeto sem value (valorDaLista trata como lista vazia)
async function limpar(){
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-haras/databases/(default)/documents`, { method: 'DELETE' });
  const r = await auth.listUsers(1000);
  if (r.users.length) await auth.deleteUsers(r.users.map(u => u.uid));
}
const conta = (email, claims) => auth.createUser({ email, password: 'senha123456' }).then(async u => { if (claims) await auth.setCustomUserClaims(u.uid, claims); return u; });
const claimsDe = async (email) => (await auth.getUserByEmail(email)).customClaims || {};
const rejeita = (p, code) => assert.rejects(p, (e) => { assert.equal(e.code, code, 'esperava ' + code + ' mas veio ' + e.code + ': ' + e.message); return true; });
const dono = { uid: 'd1', token: { dono: true } };

beforeEach(limpar);

describe('sincronizarPapeis (haras original)', () => {
  const P = 'harasData/usuarios_list';
  test('promove: novo admin recebe papel admin e todos os módulos', async () => {
    await conta('ana@x.com');
    await trigHaras(evento(null, [user('ana@x.com', true)], P));
    const c = await claimsDe('ana@x.com');
    assert.equal(c.papel, 'admin'); assert.deepEqual(c.modulos, MODULOS); assert.equal(c.tenantId, undefined);
  });
  test('funcionário recebe só os módulos com ver=true', async () => {
    await conta('f@x.com');
    await trigHaras(evento(null, [user('f@x.com', false, ['animais', 'estoque'])], P));
    const c = await claimsDe('f@x.com');
    assert.equal(c.papel, 'funcionario'); assert.deepEqual(c.modulos, ['animais', 'estoque']);
  });
  test('cenário Pedro: era admin, vira funcionário -> claim muda e tokens são revogados', async () => {
    const u = await conta('pedro@x.com', { papel: 'admin', modulos: MODULOS });
    const antesRev = (await auth.getUser(u.uid)).tokensValidAfterTime;
    await new Promise(r => setTimeout(r, 1100)); // tokensValidAfterTime tem precisão de segundos
    await trigHaras(evento([user('pedro@x.com', true)], [user('pedro@x.com', false, ['animais'])], P));
    const depois = await auth.getUser(u.uid);
    assert.equal(depois.customClaims.papel, 'funcionario');
    assert.deepEqual(depois.customClaims.modulos, ['animais']);
    assert.ok(new Date(depois.tokensValidAfterTime) > new Date(antesRev), 'tokens deveriam ter sido revogados');
  });
  test('promoção (funcionário -> admin) NÃO revoga tokens', async () => {
    const u = await conta('p@x.com', { papel: 'funcionario', modulos: ['animais'] });
    const antesRev = (await auth.getUser(u.uid)).tokensValidAfterTime;
    await new Promise(r => setTimeout(r, 1100));
    await trigHaras(evento([user('p@x.com', false, ['animais'])], [user('p@x.com', true)], P));
    const d = await auth.getUser(u.uid);
    assert.equal(d.customClaims.papel, 'admin');
    assert.equal(d.tokensValidAfterTime, antesRev);
  });
  test('usuário removido da lista perde papel/modulos, mantém outras claims e tem token revogado', async () => {
    const u = await conta('sai@x.com', { papel: 'admin', modulos: MODULOS, extra: 'fica' });
    const antesRev = (await auth.getUser(u.uid)).tokensValidAfterTime;
    await new Promise(r => setTimeout(r, 1100));
    await trigHaras(evento([user('sai@x.com', true), user('fica@x.com', false)], [user('fica@x.com', false)], P));
    const d = await auth.getUser(u.uid);
    assert.deepEqual(d.customClaims, { extra: 'fica' });
    assert.ok(new Date(d.tokensValidAfterTime) > new Date(antesRev));
  });
  test('preserva outras claims (ex.: dono não é alterado, extra é mantida)', async () => {
    await conta('x@x.com', { extra: 1 });
    await trigHaras(evento(null, [user('x@x.com', true)], P));
    assert.equal((await claimsDe('x@x.com')).extra, 1);
    await conta('dono@x.com', { dono: true, papel: 'admin', modulos: MODULOS });
    await trigHaras(evento([user('dono@x.com', true)], [], P));
    assert.equal((await claimsDe('dono@x.com')).papel, 'admin', 'dono não deve perder papel por lista');
  });
  test('e-mail sem conta é ignorado (sem erro) e os demais seguem', async () => {
    await conta('tem@x.com');
    await trigHaras(evento(null, [user('fantasma@x.com', true), user('tem@x.com', true), { nome: 'sem email', admin: true }], P));
    assert.equal((await claimsDe('tem@x.com')).papel, 'admin');
  });
  test('e-mail em maiúsculas/espaços acha a conta', async () => {
    await conta('maius@x.com');
    await trigHaras(evento(null, [user('  MAIUS@X.com ', true)], P));
    assert.equal((await claimsDe('maius@x.com')).papel, 'admin');
  });
  test('idempotente: segunda execução não grava nada nem revoga', async () => {
    const u = await conta('i@x.com');
    const lista = [user('i@x.com', false, ['animais'])];
    await trigHaras(evento(null, lista, P));
    const t1 = (await auth.getUser(u.uid)).tokensValidAfterTime;
    const { sincronizarLista } = require('../papeis');
    const r = await sincronizarLista(auth, { tenantId: null, antes: lista, depois: lista });
    assert.deepEqual(r.atualizados, []); assert.deepEqual(r.iguais, ['i@x.com']); assert.deepEqual(r.revogados, []);
    assert.equal((await auth.getUser(u.uid)).tokensValidAfterTime, t1);
  });
  test('conta de cliente (tenantId) não é alterada pela lista do haras original', async () => {
    await conta('cli@x.com', { tenantId: 'acme', papel: 'funcionario', modulos: ['animais'] });
    await trigHaras(evento(null, [user('cli@x.com', true)], P));
    assert.equal((await claimsDe('cli@x.com')).papel, 'funcionario');
  });
});

describe('sincronizarPapeis (cliente)', () => {
  const P = 'tenants/acme/dados/usuarios_list';
  test('grava tenantId junto com papel e módulos', async () => {
    await conta('a@acme.com');
    await trigCliente(evento(null, [user('a@acme.com', true)], P, { tid: 'acme' }));
    const c = await claimsDe('a@acme.com');
    assert.deepEqual(c, { papel: 'admin', modulos: MODULOS, tenantId: 'acme' });
  });
  test('tenantId preservado ao rebaixar', async () => {
    await conta('p@acme.com', { tenantId: 'acme', papel: 'admin', modulos: MODULOS });
    await trigCliente(evento([user('p@acme.com', true)], [user('p@acme.com', false, ['animais'])], P, { tid: 'acme' }));
    assert.deepEqual(await claimsDe('p@acme.com'), { tenantId: 'acme', papel: 'funcionario', modulos: ['animais'] });
  });
  test('removido do cliente perde papel/modulos mas mantém tenantId', async () => {
    await conta('r@acme.com', { tenantId: 'acme', papel: 'funcionario', modulos: ['animais'] });
    await trigCliente(evento([user('r@acme.com', false, ['animais'])], [], P, { tid: 'acme' }));
    assert.deepEqual(await claimsDe('r@acme.com'), { tenantId: 'acme' });
  });
  test('segurança: admin de cliente não consegue puxar conta de outro cliente, do dono nem do haras original', async () => {
    await conta('outro@x.com', { tenantId: 'beta', papel: 'admin', modulos: MODULOS });
    await conta('dono@x.com', { dono: true });
    await conta('haras@x.com', { papel: 'admin', modulos: MODULOS });
    await trigCliente(evento(null, [user('outro@x.com', false), user('dono@x.com', false), user('haras@x.com', false)], P, { tid: 'acme' }));
    assert.equal((await claimsDe('outro@x.com')).tenantId, 'beta');
    assert.equal((await claimsDe('outro@x.com')).papel, 'admin');
    assert.deepEqual(await claimsDe('dono@x.com'), { dono: true });
    assert.equal((await claimsDe('haras@x.com')).tenantId, undefined);
    assert.equal((await claimsDe('haras@x.com')).papel, 'admin');
  });
});

describe('criarCliente', () => {
  test('negado a quem não é dono, a admin comum e a anônimo', async () => {
    await rejeita(wCriar({ data: { nome: 'Haras A', emailAdmin: 'a@a.com' }, auth: { uid: 'u', token: { papel: 'admin' } } }), 'permission-denied');
    await rejeita(wCriar({ data: { nome: 'Haras A', emailAdmin: 'a@a.com' }, auth: { uid: 'u', token: { dono: false } } }), 'permission-denied');
    await rejeita(wCriar({ data: { nome: 'Haras A', emailAdmin: 'a@a.com' } }), 'unauthenticated');
    assert.equal((await db.collection('clientes').get()).size, 0);
  });
  test('dono cria cliente: claims, usuarios_list e clientes/{id}', async () => {
    const r = await wCriar({ data: { nome: 'Haras Boa Vista Ltda.', emailAdmin: 'Admin@BoaVista.com', senhaProvisoria: 'provisoria1' }, auth: dono });
    assert.equal(r.tenantId, 'haras-boa-vista-ltda');
    assert.equal(r.senhaGerada, undefined);
    assert.deepEqual(await claimsDe('admin@boavista.com'), { tenantId: r.tenantId, papel: 'admin', modulos: MODULOS });
    const lista = (await db.doc(`tenants/${r.tenantId}/dados/usuarios_list`).get()).data().value;
    assert.equal(lista.length, 1); assert.equal(lista[0].admin, true); assert.equal(lista[0].email, 'admin@boavista.com');
    for (const m of MODULOS) assert.deepEqual(lista[0].permissoes[m], { ver: true, inserir: true, editar: true, excluir: true });
    const c = (await db.doc(`clientes/${r.tenantId}`).get()).data();
    assert.equal(c.nome, 'Haras Boa Vista Ltda.'); assert.equal(c.ativo, true); assert.equal(c.plano, 'basico');
    assert.equal(c.limiteBytes, 1073741824); assert.ok(c.criadoEm);
  });
  test('sem senha: gera senha para conta nova', async () => {
    const r = await wCriar({ data: { nome: 'Sem Senha', emailAdmin: 's@s.com' }, auth: dono });
    assert.ok(r.senhaGerada && r.senhaGerada.length >= 8);
  });
  test('slug único: mesmo nome duas vezes, acentos e limites 3-40', async () => {
    const a = await wCriar({ data: { nome: 'Fazenda São João', emailAdmin: '1@x.com' }, auth: dono });
    const b = await wCriar({ data: { nome: 'Fazenda São João', emailAdmin: '2@x.com' }, auth: dono });
    assert.equal(a.tenantId, 'fazenda-sao-joao'); assert.equal(b.tenantId, 'fazenda-sao-joao-2');
    const longo = await wCriar({ data: { nome: 'A'.repeat(90), emailAdmin: '3@x.com' }, auth: dono });
    assert.ok(longo.tenantId.length <= 40 && longo.tenantId.length >= 3);
    const curto = await wCriar({ data: { nome: 'ab', emailAdmin: '4@x.com' }, auth: dono });
    assert.match(curto.tenantId, /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/);
    const simb = await wCriar({ data: { nome: '!!!', emailAdmin: '5@x.com' }, auth: dono });
    assert.match(simb.tenantId, /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/);
  });
  test('valida entradas', async () => {
    await rejeita(wCriar({ data: { nome: '', emailAdmin: 'a@a.com' }, auth: dono }), 'invalid-argument');
    await rejeita(wCriar({ data: { nome: 'X'.repeat(101), emailAdmin: 'a@a.com' }, auth: dono }), 'invalid-argument');
    await rejeita(wCriar({ data: { nome: 'Ok', emailAdmin: 'nao-e-email' }, auth: dono }), 'invalid-argument');
    await rejeita(wCriar({ data: { nome: 'Ok', emailAdmin: 'a@a.com', senhaProvisoria: '123' }, auth: dono }), 'invalid-argument');
    await rejeita(wCriar({ data: { nome: 123, emailAdmin: 'a@a.com' }, auth: dono }), 'invalid-argument');
    await rejeita(wCriar({ data: {}, auth: dono }), 'invalid-argument');
    assert.equal((await db.collection('clientes').get()).size, 0);
  });
  test('reaproveita conta existente livre; recusa conta que já é de outro haras/cliente/dono', async () => {
    const u = await conta('livre@x.com', { outra: 'mantida' });
    const r = await wCriar({ data: { nome: 'Reuso', emailAdmin: 'livre@x.com' }, auth: dono });
    assert.equal((await auth.getUserByEmail('livre@x.com')).uid, u.uid);
    assert.deepEqual(await claimsDe('livre@x.com'), { outra: 'mantida', tenantId: r.tenantId, papel: 'admin', modulos: MODULOS });
    await conta('ocupado@x.com', { tenantId: 'beta', papel: 'admin' });
    await conta('haras@x.com', { papel: 'admin' });
    await conta('dono@x.com', { dono: true });
    for (const e of ['ocupado@x.com', 'haras@x.com', 'dono@x.com'])
      await rejeita(wCriar({ data: { nome: 'Invasor', emailAdmin: e }, auth: dono }), 'already-exists');
    assert.equal((await db.doc('clientes/invasor').get()).exists, false);
  });
});

describe('bloquearCliente', () => {
  async function criar(nome, email){ return (await wCriar({ data: { nome, emailAdmin: email, senhaProvisoria: 'provisoria1' }, auth: dono })).tenantId; }
  test('negado a não-dono', async () => {
    const id = await criar('Alvo', 'a@alvo.com');
    await rejeita(wBloq({ data: { tenantId: id, ativo: false }, auth: { uid: 'u', token: { papel: 'admin', tenantId: id } } }), 'permission-denied');
    assert.equal((await auth.getUserByEmail('a@alvo.com')).disabled, false);
  });
  test('bloqueia e reativa só as contas do cliente, revoga tokens e atualiza clientes/{id}', async () => {
    const id = await criar('Alvo', 'a@alvo.com');
    const outro = await criar('Outro', 'b@outro.com');
    await conta('func@alvo.com', { tenantId: id, papel: 'funcionario', modulos: ['animais'] });
    const antes = (await auth.getUserByEmail('func@alvo.com')).tokensValidAfterTime;
    await new Promise(r => setTimeout(r, 1100));
    const r = await wBloq({ data: { tenantId: id, ativo: false }, auth: dono });
    assert.equal(r.contasAfetadas, 2);
    assert.equal((await auth.getUserByEmail('a@alvo.com')).disabled, true);
    const f = await auth.getUserByEmail('func@alvo.com');
    assert.equal(f.disabled, true); assert.ok(new Date(f.tokensValidAfterTime) > new Date(antes));
    assert.equal((await auth.getUserByEmail('b@outro.com')).disabled, false);
    assert.equal((await db.doc(`clientes/${id}`).get()).data().ativo, false);
    assert.equal((await db.doc(`clientes/${outro}`).get()).data().ativo, true);
    await wBloq({ data: { tenantId: id, ativo: true }, auth: dono });
    assert.equal((await auth.getUserByEmail('a@alvo.com')).disabled, false);
    assert.equal((await auth.getUserByEmail('func@alvo.com')).disabled, false);
    assert.equal((await db.doc(`clientes/${id}`).get()).data().ativo, true);
  });
  test('valida entradas e cliente inexistente', async () => {
    await rejeita(wBloq({ data: { tenantId: 'Inválido!', ativo: false }, auth: dono }), 'invalid-argument');
    await rejeita(wBloq({ data: { tenantId: 'abc', ativo: 'sim' }, auth: dono }), 'invalid-argument');
    await rejeita(wBloq({ data: { tenantId: 'nao-existe', ativo: false }, auth: dono }), 'not-found');
  });
});

describe('usoDoCliente', () => {
  test('negado a não-dono', async () => {
    await rejeita(wUso({ data: { tenantId: 'abc' }, auth: { uid: 'u', token: { papel: 'admin' } } }), 'permission-denied');
  });
  test('soma bytes, conta documentos e calcula percentual (só do cliente pedido)', async () => {
    const id = (await wCriar({ data: { nome: 'Medido', emailAdmin: 'm@m.com' }, auth: dono })).tenantId;
    const d1 = { value: [{ nome: 'Estrela', obs: 'ação' }] }, d2 = { value: 'x'.repeat(1000) };
    await db.doc(`tenants/${id}/dados/animais`).set(d1);
    await db.doc(`tenants/${id}/dados/notas`).set(d2);
    await db.doc('tenants/outro/dados/animais').set({ value: 'y'.repeat(5000) });
    const lista = (await db.doc(`tenants/${id}/dados/usuarios_list`).get()).data();
    const esperado = [lista, d1, d2].reduce((s, d) => s + Buffer.byteLength(JSON.stringify(d), 'utf8'), 0);
    const r = await wUso({ data: { tenantId: id }, auth: dono });
    assert.equal(r.documentos, 3); assert.equal(r.bytes, esperado);
    assert.equal(r.percentualDoLimite, Math.round(esperado / 1073741824 * 10000) / 100);
  });
  test('respeita limiteBytes do cliente e erros de entrada', async () => {
    await db.doc('clientes/peq').set({ nome: 'Peq', ativo: true, limiteBytes: 1000 });
    await db.doc('tenants/peq/dados/a').set({ value: 'z'.repeat(480) });
    const r = await wUso({ data: { tenantId: 'peq' }, auth: dono });
    assert.equal(r.documentos, 1); assert.ok(r.percentualDoLimite > 40 && r.percentualDoLimite < 60, String(r.percentualDoLimite));
    await rejeita(wUso({ data: { tenantId: 'zzz-nao' }, auth: dono }), 'not-found');
    await rejeita(wUso({ data: {}, auth: dono }), 'invalid-argument');
  });
});
