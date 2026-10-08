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
const { MODULOS, PLANOS, limitesDoPlano } = require('../comum');
const modsDoPlano = (plano) => MODULOS.filter(m => limitesDoPlano(plano).modulos.includes(m)); // na ordem de MODULOS
const claimsPlano = (plano) => { const l = limitesDoPlano(plano); return { maxFotos: l.maxFotos, maxUsuarios: l.maxUsuarios, plano: l.plano, recursos: [], tipoAssinatura: 'proprietario' }; };

const auth = getAuth(), db = getFirestore();
const trigHaras = fft.wrap(F.sincronizarPapeis);
const trigCliente = fft.wrap(F.sincronizarPapeisCliente);
const wCriar = fft.wrap(F.criarCliente), wBloq = fft.wrap(F.bloquearCliente), wExcl = fft.wrap(F.excluirCliente), wUso = fft.wrap(F.usoDoCliente);
const wListar = fft.wrap(F.listarClientes), wAtual = fft.wrap(F.atualizarCliente);
const CL = require('../clientes');
const wLogin = fft.wrap(F.criarLoginDoUsuario);
const wPagar = fft.wrap(F.registrarPagamento), wExcPag = fft.wrap(F.excluirPagamento), wListPag = fft.wrap(F.listarPagamentos);
const BC = require('../cobranca');
const wAutor = fft.wrap(F.animaisAutorizados), wEnviar = fft.wrap(F.enviarSolicitacao), wSolic = fft.wrap(F.listarSolicitacoes), wCancel = fft.wrap(F.cancelarSolicitacao), wDecide = fft.wrap(F.decidirSolicitacao);
const wConvidar = fft.wrap(F.convidarPrestador), wVincs = fft.wrap(F.listarVinculos), wResp = fft.wrap(F.responderConvite), wAnim = fft.wrap(F.atualizarAnimaisDoVinculo), wRevog = fft.wrap(F.revogarVinculo);

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
    assert.deepEqual(c, { papel: 'admin', modulos: modsDoPlano('basico'), tenantId: 'acme', ...claimsPlano('basico') }); // cliente sem plano gravado = básico
  });
  test('tenantId preservado ao rebaixar', async () => {
    await conta('p@acme.com', { tenantId: 'acme', papel: 'admin', modulos: MODULOS });
    await trigCliente(evento([user('p@acme.com', true)], [user('p@acme.com', false, ['animais'])], P, { tid: 'acme' }));
    assert.deepEqual(await claimsDe('p@acme.com'), { tenantId: 'acme', papel: 'funcionario', modulos: ['animais'], ...claimsPlano('basico') });
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
    assert.deepEqual(await claimsDe('admin@boavista.com'), { tenantId: r.tenantId, papel: 'admin', modulos: modsDoPlano('basico'), ...claimsPlano('basico') });
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
    assert.deepEqual(await claimsDe('livre@x.com'), { outra: 'mantida', tenantId: r.tenantId, papel: 'admin', modulos: modsDoPlano('basico'), ...claimsPlano('basico') });
    await conta('ocupado@x.com', { tenantId: 'beta', papel: 'admin' });
    await conta('haras@x.com', { papel: 'admin' });
    await conta('dono@x.com', { dono: true });
    for (const e of ['ocupado@x.com', 'haras@x.com', 'dono@x.com'])
      await rejeita(wCriar({ data: { nome: 'Invasor', emailAdmin: e }, auth: dono }), 'already-exists');
    assert.equal((await db.doc('clientes/invasor').get()).exists, false);
  });
});

describe('planos: o plano vale de verdade', () => {
  const P = 'tenants/acme/dados/usuarios_list';
  const criarComPlano = async (plano, email = 'adm@plano.com') =>
    (await wCriar({ data: { nome: 'Cliente ' + plano, emailAdmin: email, senhaProvisoria: 'provisoria1', plano }, auth: dono })).tenantId;
  test('tabela: módulos crescem de gratuito para pro; usuarios em todos; limites combinados', () => {
    const g = new Set(PLANOS.gratuito.modulos), b = new Set(PLANOS.basico.modulos), p = new Set(PLANOS.pro.modulos);
    for (const m of g) assert.ok(b.has(m)); for (const m of b) assert.ok(p.has(m));
    for (const n of ['gratuito', 'basico', 'pro']) assert.ok(PLANOS[n].modulos.includes('usuarios'));
    assert.deepEqual(MODULOS.slice().sort(), PLANOS.pro.modulos.slice().sort());
    assert.ok(!g.has('financeiro') && !g.has('consultoria') && !b.has('financeiro') && p.has('financeiro'));
    assert.deepEqual([PLANOS.gratuito.maxFotos, PLANOS.basico.maxFotos, PLANOS.pro.maxFotos], [1, 4, 8]);
    assert.deepEqual([PLANOS.gratuito.maxUsuarios, PLANOS.basico.maxUsuarios, PLANOS.pro.maxUsuarios], [2, 5, 0]);
    assert.deepEqual([PLANOS.gratuito.limiteBytes, PLANOS.basico.limiteBytes, PLANOS.pro.limiteBytes], [200 * 1048576, 1073741824, 5 * 1073741824]);
    assert.equal(limitesDoPlano('inexistente').plano, 'basico'); assert.equal(limitesDoPlano(undefined).plano, 'basico');
  });
  test('criarCliente com cada plano grava as claims e o limite do plano', async () => {
    for (const [plano, email] of [['gratuito', 'g@p.com'], ['basico', 'b@p.com'], ['pro', 'p@p.com']]) {
      const id = await criarComPlano(plano, email);
      assert.deepEqual(await claimsDe(email), { tenantId: id, papel: 'admin', modulos: modsDoPlano(plano), ...claimsPlano(plano) });
      const c = (await db.doc(`clientes/${id}`).get()).data();
      assert.equal(c.plano, plano); assert.equal(c.limiteBytes, PLANOS[plano].limiteBytes);
    }
    await rejeita(wCriar({ data: { nome: 'Ruim', emailAdmin: 'r@p.com', plano: 'diamante' }, auth: dono }), 'invalid-argument');
  });
  test('módulo fora do plano some até para o admin (gratuito não tem financeiro)', async () => {
    await db.doc('clientes/acme').set({ nome: 'Acme', ativo: true, plano: 'gratuito' });
    await conta('a@acme.com');
    await trigCliente(evento(null, [user('a@acme.com', true)], P, { tid: 'acme' }));
    const c = await claimsDe('a@acme.com');
    assert.deepEqual(c.modulos, modsDoPlano('gratuito'));
    assert.ok(!c.modulos.includes('financeiro') && !c.modulos.includes('consultoria') && c.modulos.includes('estoque'));
    // funcionário com permissão em módulo que o plano não tem: só entra o que o plano libera
    await conta('f@acme.com');
    await trigCliente(evento([user('a@acme.com', true)], [user('a@acme.com', true), user('f@acme.com', false, ['animais', 'financeiro'])], P, { tid: 'acme' }));
    assert.deepEqual((await claimsDe('f@acme.com')).modulos, ['animais']);
  });
  test('limite de usuários: admins primeiro, o resto sem acesso (gratuito = 2)', async () => {
    await db.doc('clientes/acme').set({ nome: 'Acme', ativo: true, plano: 'gratuito' });
    for (const e of ['f1@acme.com', 'f2@acme.com', 'adm@acme.com']) await conta(e);
    const lista = [user('f1@acme.com', false, ['animais']), user('f2@acme.com', false, ['animais']), user('adm@acme.com', true)];
    await trigCliente(evento(null, lista, P, { tid: 'acme' }));
    assert.equal((await claimsDe('adm@acme.com')).papel, 'admin');          // admin entra primeiro
    assert.equal((await claimsDe('f1@acme.com')).papel, 'funcionario');     // 2º lugar
    assert.equal((await claimsDe('f2@acme.com')).papel, undefined);         // passou do limite: sem papel
    assert.equal((await claimsDe('f2@acme.com')).modulos, undefined);
  });
  test('pro: sem limite de usuários', async () => {
    await db.doc('clientes/acme').set({ nome: 'Acme', ativo: true, plano: 'pro' });
    const emails = Array.from({ length: 9 }, (_, i) => `u${i}@acme.com`);
    for (const e of emails) await conta(e);
    await trigCliente(evento(null, emails.map(e => user(e, false, ['animais'])), P, { tid: 'acme' }));
    for (const e of emails) assert.equal((await claimsDe(e)).papel, 'funcionario');
  });
  test('mudar o plano reaplica TODAS as contas do cliente (rebaixa, derruba sessão e libera de novo)', async () => {
    const id = await criarComPlano('pro', 'adm@troca.com');
    await conta('f1@troca.com'); await conta('f2@troca.com');
    const lista = [user('adm@troca.com', true), user('f1@troca.com', false, ['animais', 'financeiro']), user('f2@troca.com', false, ['animais'])];
    await db.doc(`tenants/${id}/dados/usuarios_list`).set({ value: lista });
    await trigCliente(evento(null, lista, `tenants/${id}/dados/usuarios_list`, { tid: id }));
    assert.ok((await claimsDe('f1@troca.com')).modulos.includes('financeiro'));
    const r = await wAtual({ data: { tenantId: id, plano: 'gratuito' }, auth: dono });
    assert.deepEqual(r.atualizado, ['plano', 'limiteBytes', 'claims']);
    const adm = await claimsDe('adm@troca.com'), f1 = await claimsDe('f1@troca.com'), f2 = await claimsDe('f2@troca.com');
    assert.deepEqual(adm.modulos, modsDoPlano('gratuito')); assert.equal(adm.plano, 'gratuito'); assert.equal(adm.maxFotos, 1);
    assert.deepEqual(f1.modulos, ['animais']);                    // perdeu financeiro
    assert.equal(f2.papel, undefined);                              // 3º usuário passou do limite de 2
    assert.equal((await db.doc(`clientes/${id}`).get()).data().limiteBytes, PLANOS.gratuito.limiteBytes);
    // volta ao pro: todos de volta
    await wAtual({ data: { tenantId: id, plano: 'pro' }, auth: dono });
    assert.ok((await claimsDe('f1@troca.com')).modulos.includes('financeiro'));
    assert.equal((await claimsDe('f2@troca.com')).papel, 'funcionario');
    assert.equal((await claimsDe('adm@troca.com')).maxUsuarios, 0);
  });
  test('mandar o mesmo plano de novo não mexe no limite nem nas contas; limite enviado junto vale', async () => {
    const id = await criarComPlano('basico', 'adm@mesmo.com');
    await db.doc(`clientes/${id}`).update({ limiteBytes: 3 * 1048576 });
    const r = await wAtual({ data: { tenantId: id, plano: 'basico' }, auth: dono });
    assert.deepEqual(r.atualizado, ['plano']);
    assert.equal((await db.doc(`clientes/${id}`).get()).data().limiteBytes, 3 * 1048576);
    const r2 = await wAtual({ data: { tenantId: id, plano: 'pro', limiteBytes: 7 * 1048576 }, auth: dono });
    assert.deepEqual(r2.atualizado, ['plano', 'limiteBytes', 'claims']);
    assert.equal((await db.doc(`clientes/${id}`).get()).data().limiteBytes, 7 * 1048576);
  });
  test('listarClientes devolve os limites do plano e quantos usuários há na lista', async () => {
    const id = await criarComPlano('gratuito', 'adm@lista.com');
    const r = await wListar({ data: {}, auth: dono });
    const c = r.clientes.find(x => x.id === id);
    assert.deepEqual(c.limites, { modulos: modsDoPlano('gratuito').length ? PLANOS.gratuito.modulos : [], maxFotos: 1, maxUsuarios: 2, limiteBytes: PLANOS.gratuito.limiteBytes });
    assert.equal(c.usuariosNaLista, 1);
  });
  test('o haras original (sem cliente) não é afetado pelo plano', async () => {
    await conta('h@orig.com');
    await trigHaras(evento(null, [user('h@orig.com', true)], 'harasData/usuarios_list'));
    assert.deepEqual(await claimsDe('h@orig.com'), { papel: 'admin', modulos: MODULOS });
  });
});

describe('novidades por cliente (interruptor)', () => {
  const P = 'tenants/acme/dados/usuarios_list';
  const novoCli = async (email, extra = {}) => (await wCriar({ data: { nome: 'Cli ' + email, emailAdmin: email, senhaProvisoria: 'provisoria1', ...extra }, auth: dono })).tenantId;
  test('criarCliente aceita recursos (limpa repetidos, ordena) e rejeita chaves inválidas', async () => {
    const id = await novoCli('a@rec.com', { recursos: ['zeta_x', 'alfa_y', 'alfa_y'] });
    assert.deepEqual((await claimsDe('a@rec.com')).recursos, ['alfa_y', 'zeta_x']);
    assert.deepEqual((await db.doc(`clientes/${id}`).get()).data().recursos, ['alfa_y', 'zeta_x']);
    for (const ruim of [['Maiuscula'], ['com espaço'], [1], 'texto', ['a'], ['x'.repeat(31)], Array.from({ length: 13 }, (_, i) => 'rec_' + i)])
      await rejeita(wCriar({ data: { nome: 'Ruim', emailAdmin: 'r@rec.com', recursos: ruim }, auth: dono }), 'invalid-argument');
  });
  test('atualizarCliente liga/desliga novidades e reaplica as claims de todas as contas', async () => {
    const id = await novoCli('adm@rec2.com');
    await conta('f@rec2.com');
    const lista = [user('adm@rec2.com', true), user('f@rec2.com', false, ['animais'])];
    await db.doc(`tenants/${id}/dados/usuarios_list`).set({ value: lista });
    await trigCliente(evento(null, lista, `tenants/${id}/dados/usuarios_list`, { tid: id }));
    assert.deepEqual((await claimsDe('f@rec2.com')).recursos, []);
    const r = await wAtual({ data: { tenantId: id, recursos: ['novo_painel'] }, auth: dono });
    assert.deepEqual(r.atualizado, ['recursos', 'claims']);
    assert.deepEqual((await claimsDe('adm@rec2.com')).recursos, ['novo_painel']);
    assert.deepEqual((await claimsDe('f@rec2.com')).recursos, ['novo_painel']);
    const r2 = await wAtual({ data: { tenantId: id, recursos: ['novo_painel'] }, auth: dono });   // igual: não reaplica
    assert.deepEqual(r2.atualizado, ['recursos']);
    await wAtual({ data: { tenantId: id, recursos: [] }, auth: dono });
    assert.deepEqual((await claimsDe('f@rec2.com')).recursos, []);
    await rejeita(wAtual({ data: { tenantId: id, recursos: ['Ruim!'] }, auth: dono }), 'invalid-argument');
  });
  test('o gatilho de usuários mantém as novidades do cliente; listarClientes mostra', async () => {
    await db.doc('clientes/acme').set({ nome: 'Acme', ativo: true, plano: 'pro', recursos: ['x_um', 'y_dois'] });
    await conta('n@acme.com');
    await trigCliente(evento(null, [user('n@acme.com', true)], P, { tid: 'acme' }));
    assert.deepEqual((await claimsDe('n@acme.com')).recursos, ['x_um', 'y_dois']);
    const r = await wListar({ data: {}, auth: dono });
    assert.deepEqual(r.clientes.find(c => c.id === 'acme').recursos, ['x_um', 'y_dois']);
  });
  test('mudar de plano mantém as novidades; haras original não ganha claim de recursos', async () => {
    const id = await novoCli('adm@rec3.com', { recursos: ['guardada'] });
    await wAtual({ data: { tenantId: id, plano: 'gratuito' }, auth: dono });
    assert.deepEqual((await claimsDe('adm@rec3.com')).recursos, ['guardada']);
    await conta('h@orig2.com');
    await trigHaras(evento(null, [user('h@orig2.com', true)], 'harasData/usuarios_list'));
    assert.equal((await claimsDe('h@orig2.com')).recursos, undefined);
  });
});

describe('criarLoginDoUsuario (admin do cliente cria o login da equipe)', () => {
  const adminDe = (tid) => ({ uid: 'adm-' + tid, token: { papel: 'admin', tenantId: tid } });
  const montar = async (plano, emails) => {   // cria o cliente e a lista de usuários dele; devolve o tenantId
    const id = (await wCriar({ data: { nome: 'Cli ' + plano + emails.length, emailAdmin: 'adm@' + plano + emails.length + '.com', senhaProvisoria: 'provisoria1', plano }, auth: dono })).tenantId;
    const admEmail = 'adm@' + plano + emails.length + '.com';
    await db.doc(`tenants/${id}/dados/usuarios_list`).set({ value: [user(admEmail, true), ...emails.map(e => user(e, false, ['animais']))] });
    return id;
  };
  test('cria o login (senha gerada uma vez) e já aplica papel, módulos e plano', async () => {
    const id = await montar('basico', ['novo@cli.com']);
    const r = await wLogin({ data: { email: 'Novo@Cli.com' }, auth: adminDe(id) });
    assert.equal(r.criado, true); assert.equal(r.email, 'novo@cli.com'); assert.ok(r.senhaGerada && r.senhaGerada.length >= 8);
    const c = await claimsDe('novo@cli.com');
    assert.deepEqual(c, { tenantId: id, papel: 'funcionario', modulos: ['animais'], ...claimsPlano('basico') });
  });
  test('com senha informada: usa a senha e não devolve senhaGerada; senha curta é recusada', async () => {
    const id = await montar('basico', ['s@cli.com']);
    const r = await wLogin({ data: { email: 's@cli.com', senhaProvisoria: 'minhasenha9' }, auth: adminDe(id) });
    assert.equal(r.criado, true); assert.equal(r.senhaGerada, undefined);
    await rejeita(wLogin({ data: { email: 's@cli.com', senhaProvisoria: '123' }, auth: adminDe(id) }), 'invalid-argument');
  });
  test('negado: anônimo, não-admin, e-mail inválido', async () => {
    const id = await montar('basico', ['x@cli.com']);
    await rejeita(wLogin({ data: { email: 'x@cli.com' } }), 'unauthenticated');
    await rejeita(wLogin({ data: { email: 'x@cli.com' }, auth: { uid: 'f', token: { papel: 'funcionario', tenantId: id } } }), 'permission-denied');
    await rejeita(wLogin({ data: { email: 'nao-e-email' }, auth: adminDe(id) }), 'invalid-argument');
    await assert.rejects(() => auth.getUserByEmail('x@cli.com'));
  });
  test('só quem já está na lista de usuários do cliente ganha login', async () => {
    const id = await montar('basico', []);
    await rejeita(wLogin({ data: { email: 'intruso@x.com' }, auth: adminDe(id) }), 'failed-precondition');
    await assert.rejects(() => auth.getUserByEmail('intruso@x.com'));
  });
  test('limite de usuários do plano: quem passa do limite não ganha login (gratuito = 2)', async () => {
    const id = await montar('gratuito', ['f1@lim.com', 'f2@lim.com']);   // admin + 2 = 3 na lista; só 2 cabem
    await wLogin({ data: { email: 'f1@lim.com' }, auth: adminDe(id) });
    await rejeita(wLogin({ data: { email: 'f2@lim.com' }, auth: adminDe(id) }), 'failed-precondition');
    await assert.rejects(() => auth.getUserByEmail('f2@lim.com'));
  });
  test('o cliente vem do login do chamador, não do pedido: admin de A não cria login em B', async () => {
    const a = await montar('basico', ['a1@cli.com']);
    const b = await montar('pro', ['b1@cli.com']);
    await rejeita(wLogin({ data: { email: 'b1@cli.com', tenantId: b }, auth: adminDe(a) }), 'failed-precondition'); // b1 não está na lista de A
    await assert.rejects(() => auth.getUserByEmail('b1@cli.com'));
  });
  test('não toca em conta do dono, de outro cliente nem do haras original', async () => {
    const id = await montar('basico', ['dono2@cli.com', 'outro@cli.com', 'haras@cli.com']);
    await conta('dono2@cli.com', { dono: true });
    await conta('outro@cli.com', { tenantId: 'beta', papel: 'admin' });
    await conta('haras@cli.com', { papel: 'admin' });
    for (const e of ['dono2@cli.com', 'outro@cli.com', 'haras@cli.com'])
      await rejeita(wLogin({ data: { email: e, redefinir: true }, auth: adminDe(id) }), 'already-exists');
    assert.deepEqual(await claimsDe('dono2@cli.com'), { dono: true });
  });
  test('conta que já existe e é livre ou do próprio cliente: reaproveita; redefinir troca a senha e derruba sessões', async () => {
    const id = await montar('basico', ['livre2@cli.com', 'meu@cli.com']);
    await conta('livre2@cli.com');
    const r1 = await wLogin({ data: { email: 'livre2@cli.com' }, auth: adminDe(id) });
    assert.equal(r1.criado, false); assert.equal(r1.jaExistia, true); assert.equal(r1.senhaGerada, undefined);
    assert.equal((await claimsDe('livre2@cli.com')).tenantId, id);
    await wLogin({ data: { email: 'meu@cli.com' }, auth: adminDe(id) });
    const antes = (await auth.getUserByEmail('meu@cli.com')).tokensValidAfterTime;
    await new Promise(r => setTimeout(r, 1100));
    const r2 = await wLogin({ data: { email: 'meu@cli.com', redefinir: true }, auth: adminDe(id) });
    assert.equal(r2.redefinida, true); assert.ok(r2.senhaGerada);
    assert.notEqual((await auth.getUserByEmail('meu@cli.com')).tokensValidAfterTime, antes);
  });
  test('segurança: conta nova nasce desligada e só liga depois de receber o cliente; se falhar, é apagada', async () => {
    const id = await montar('basico', ['seg@cli.com']);
    await wLogin({ data: { email: 'seg@cli.com' }, auth: adminDe(id) });
    const ok = await auth.getUserByEmail('seg@cli.com');
    assert.equal(ok.disabled, false); assert.equal(ok.customClaims.tenantId, id);   // ligada, já com o cliente
    // falha ao gravar o acesso: a conta recém-criada é apagada (conta sem cliente valeria como "haras original")
    const usuarios = new Map(); const apagadas = [];
    const fakeAuth = {
      getUserByEmail: async (e) => { const u = usuarios.get(e); if (!u) { const err = new Error('nf'); err.code = 'auth/user-not-found'; throw err; } return u; },
      createUser: async ({ email, disabled }) => { const u = { uid: 'u-' + email, email, disabled, customClaims: {} }; usuarios.set(email, u); return u; },
      setCustomUserClaims: async () => { throw new Error('boom'); },
      deleteUser: async (uid) => { apagadas.push(uid); },
    };
    const fakeDb = { doc: () => ({ get: async () => ({ exists: true, data: () => ({ value: [user('adm@t.com', true), user('falha@t.com', false, ['animais'])] }) }) }),
      collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ plano: 'basico' }) }) }) }) };
    await assert.rejects(() => require('../usuarios').criarLoginDoUsuario({ auth: fakeAuth, db: fakeDb, claims: { papel: 'admin', tenantId: 'tt' } }, { email: 'falha@t.com' }));
    assert.deepEqual(apagadas, ['u-falha@t.com']);
    assert.equal(usuarios.get('falha@t.com').disabled, true);
  });
  test('administrador do haras original também cria login da própria equipe (sem plano)', async () => {
    await db.doc('harasData/usuarios_list').set({ value: [user('adm@haras.com', true), user('func@haras.com', false, ['animais'])] });
    const r = await wLogin({ data: { email: 'func@haras.com' }, auth: { uid: 'g', token: { papel: 'admin' } } });
    assert.equal(r.criado, true);
    assert.deepEqual(await claimsDe('func@haras.com'), { papel: 'funcionario', modulos: ['animais'] });
  });
});

describe('cobrança manual', () => {
  const set = (...c) => new Set(c);
  test('situação: sem mensalidade/vencimento/início = sem cobrança', () => {
    assert.equal(BC.situacaoDeCobranca({}, set(), '2026-10-07').situacao, 'sem_cobranca');
    assert.equal(BC.situacaoDeCobranca({ mensalidadeCentavos: 0, diaVencimento: 10, inicioCobranca: '2026-01-01' }, set(), '2026-10-07').situacao, 'sem_cobranca');
    assert.equal(BC.situacaoDeCobranca({ mensalidadeCentavos: 9900, diaVencimento: 29, inicioCobranca: '2026-01-01' }, set(), '2026-10-07').situacao, 'sem_cobranca');
  });
  test('situação: atrasado (mais antiga em aberto), a vencer em 5 dias, em dia, vence hoje', () => {
    const cfg = { mensalidadeCentavos: 9900, diaVencimento: 10, inicioCobranca: '2026-08-01' };
    // venceu 10/08 e 10/09 sem pagar; hoje 07/10
    const a = BC.situacaoDeCobranca(cfg, set(), '2026-10-07');
    assert.deepEqual([a.situacao, a.competenciaEmAberto, a.diasAtraso], ['atrasado', '2026-08', 58]);
    // pagou ago e set: próximo vence 10/10 (3 dias)
    const b = BC.situacaoDeCobranca(cfg, set('2026-08', '2026-09'), '2026-10-07');
    assert.deepEqual([b.situacao, b.competenciaEmAberto, b.diasParaVencer], ['vence_em_breve', '2026-10', 3]);
    // pagou também out: próximo é novembro, longe
    assert.equal(BC.situacaoDeCobranca(cfg, set('2026-08', '2026-09', '2026-10'), '2026-10-07').situacao, 'em_dia');
    // 6 dias para vencer não conta como "em breve"; no dia do vencimento é "vence hoje" (0)
    assert.equal(BC.situacaoDeCobranca(cfg, set('2026-08', '2026-09'), '2026-10-04').situacao, 'em_dia');
    const h = BC.situacaoDeCobranca(cfg, set('2026-08', '2026-09'), '2026-10-10');
    assert.deepEqual([h.situacao, h.diasParaVencer], ['vence_em_breve', 0]);
    // 1 dia depois do vencimento sem pagar = atrasado 1 dia
    assert.deepEqual([BC.situacaoDeCobranca(cfg, set('2026-08', '2026-09'), '2026-10-11').situacao, BC.situacaoDeCobranca(cfg, set('2026-08', '2026-09'), '2026-10-11').diasAtraso], ['atrasado', 1]);
  });
  test('situação: início depois do dia do vencimento começa no mês seguinte; virada de ano', () => {
    const cfg = { mensalidadeCentavos: 5000, diaVencimento: 5, inicioCobranca: '2026-10-20' };
    const a = BC.situacaoDeCobranca(cfg, set(), '2026-10-25');
    assert.deepEqual([a.situacao, a.competenciaEmAberto], ['em_dia', '2026-11']);
    const b = BC.situacaoDeCobranca({ ...cfg, inicioCobranca: '2026-11-01' }, set('2026-11', '2026-12'), '2027-01-02');
    assert.deepEqual([b.situacao, b.competenciaEmAberto, b.diasParaVencer], ['vence_em_breve', '2027-01', 3]);
  });
  test('situação: a data de hoje usa o fuso de São Paulo', () => {
    assert.equal(BC.hojeSaoPaulo(new Date('2026-10-08T01:30:00Z')), '2026-10-07'); // 22h30 do dia 7 em SP
  });
  const novoCli = async (email = 'a@cob.com') => (await wCriar({ data: { nome: 'Cob ' + email, emailAdmin: email, senhaProvisoria: 'provisoria1', plano: 'pro' }, auth: dono })).tenantId;
  test('registrar, corrigir, listar e excluir pagamento (só dono)', async () => {
    const id = await novoCli();
    await rejeita(wPagar({ data: { tenantId: id, competencia: '2026-10', valorCentavos: 9900, pagoEm: '2026-10-05' }, auth: { uid: 'u', token: { papel: 'admin', tenantId: id } } }), 'permission-denied');
    await rejeita(wPagar({ data: { tenantId: id, competencia: '2026-10', valorCentavos: 9900, pagoEm: '2026-10-05' } }), 'unauthenticated');
    const r = await wPagar({ data: { tenantId: id, competencia: '2026-10', valorCentavos: 9900, pagoEm: '2026-10-05', forma: 'pix' }, auth: { uid: 'd', token: { dono: true, email: 'dono@x.com' } } });
    assert.equal(r.registradoPor, 'dono@x.com'); assert.equal(r.forma, 'pix');
    await wPagar({ data: { tenantId: id, competencia: '2026-10', valorCentavos: 10000, pagoEm: '2026-10-06' }, auth: dono });   // corrige a mesma competência
    await wPagar({ data: { tenantId: id, competencia: '2026-09', valorCentavos: 9900, pagoEm: '2026-09-04', obs: '  atrasou  ' }, auth: dono });
    const l = await wListPag({ data: { tenantId: id }, auth: dono });
    assert.deepEqual(l.pagamentos.map(p => [p.competencia, p.valorCentavos, p.forma]), [['2026-10', 10000, 'outro'], ['2026-09', 9900, 'outro']]);
    assert.equal(l.pagamentos[1].obs, 'atrasou');
    await wExcPag({ data: { tenantId: id, competencia: '2026-10' }, auth: dono });
    assert.deepEqual((await wListPag({ data: { tenantId: id }, auth: dono })).pagamentos.map(p => p.competencia), ['2026-09']);
    await rejeita(wExcPag({ data: { tenantId: id, competencia: '2026-10' }, auth: dono }), 'not-found');
  });
  test('registrar: entradas inválidas e cliente inexistente', async () => {
    const id = await novoCli('b@cob.com'); const ok = { tenantId: id, competencia: '2026-10', valorCentavos: 100, pagoEm: '2026-10-05' };
    for (const ruim of [{ competencia: '2026-13' }, { competencia: '10/2026' }, { valorCentavos: -1 }, { valorCentavos: 9.5 }, { valorCentavos: '99' }, { pagoEm: '2026-02-30' }, { pagoEm: 'ontem' }, { forma: 'cripto' }, { tenantId: 'x' }])
      await rejeita(wPagar({ data: { ...ok, ...ruim }, auth: dono }), 'invalid-argument');
    await rejeita(wPagar({ data: { ...ok, tenantId: 'nao-existe' }, auth: dono }), 'not-found');
  });
  test('atualizarCliente grava e limpa mensalidade, vencimento, início e observação; valida', async () => {
    const id = await novoCli('c@cob.com');
    const r = await wAtual({ data: { tenantId: id, mensalidadeCentavos: 24900, diaVencimento: 10, inicioCobranca: '2026-10-01', obsCobranca: ' combinado Pix ' }, auth: dono });
    assert.deepEqual(r.atualizado, ['mensalidadeCentavos', 'diaVencimento', 'inicioCobranca', 'obsCobranca']);
    const c = (await db.doc(`clientes/${id}`).get()).data();
    assert.deepEqual([c.mensalidadeCentavos, c.diaVencimento, c.inicioCobranca, c.obsCobranca], [24900, 10, '2026-10-01', 'combinado Pix']);
    for (const ruim of [{ mensalidadeCentavos: -5 }, { mensalidadeCentavos: 1.5 }, { diaVencimento: 0 }, { diaVencimento: 29 }, { inicioCobranca: '2026-13-01' }, { obsCobranca: 7 }])
      await rejeita(wAtual({ data: { tenantId: id, ...ruim }, auth: dono }), 'invalid-argument');
    await wAtual({ data: { tenantId: id, mensalidadeCentavos: null, diaVencimento: null, inicioCobranca: null }, auth: dono });
    const l = (await wListar({ data: {}, auth: dono })).clientes.find(x => x.id === id);
    assert.equal(l.cobranca.situacao, 'sem_cobranca');
  });
  test('listarClientes traz a situação de cobrança e quanto entrou no mês', async () => {
    const id = await novoCli('d@cob.com');
    const hoje = BC.hojeSaoPaulo(); const mes = hoje.slice(0, 7);
    const ini = BC.hojeSaoPaulo(new Date(Date.now() - 80 * 86400000));   // começou há ~80 dias
    await wAtual({ data: { tenantId: id, mensalidadeCentavos: 10000, diaVencimento: 10, inicioCobranca: ini }, auth: dono });
    let c = (await wListar({ data: {}, auth: dono })).clientes.find(x => x.id === id).cobranca;
    assert.equal(c.situacao, 'atrasado'); assert.ok(c.diasAtraso > 0); assert.equal(c.pagoNoMesCentavos, 0);
    // paga todas as competências desde o início até o mês seguinte
    let comp = ini.slice(0, 7); const fim = BC.situacaoDeCobranca({ mensalidadeCentavos: 1, diaVencimento: 10, inicioCobranca: ini }, new Set(), hoje);
    for (let m = ini.slice(0, 7); m <= mes; m = (() => { const t = +m.slice(0, 4) * 12 + (+m.slice(5, 7)) ; return String(Math.floor(t / 12)).padStart(4, '0') + '-' + String(t % 12 + 1).padStart(2, '0'); })())
      await wPagar({ data: { tenantId: id, competencia: m, valorCentavos: 10000, pagoEm: hoje }, auth: dono });
    c = (await wListar({ data: {}, auth: dono })).clientes.find(x => x.id === id).cobranca;
    assert.notEqual(c.situacao, 'atrasado'); assert.ok(c.pagoNoMesCentavos >= 10000); assert.ok(c.pagamentos >= 3);
    assert.equal(fim.situacao, 'atrasado');
  });
});

describe('integração entre assinaturas — etapa 1 (vínculo)', () => {
  const REC = ['integracao_prestadores'];
  const tipoDe = (id) => /^vet/.test(id || '') ? 'prestador' : 'proprietario';   // nos testes: ids 'vet...' são prestadores
  const tk = (tenantId, extra = {}) => ({ uid: 'u-' + (tenantId || 'orig'), token: { papel: 'admin', ...(tenantId ? { tenantId, recursos: REC, tipoAssinatura: tipoDe(tenantId) } : {}), email: (tenantId || 'orig') + '@x.com', ...extra } });
  const cliente = async (id, nome, adminEmail, recursos = REC) => {
    await db.doc(`clientes/${id}`).set({ nome, ativo: true, plano: 'pro' });
    await conta(adminEmail, { tenantId: id, papel: 'admin', modulos: MODULOS, recursos, tipoAssinatura: tipoDe(id) });
  };
  const animais = (...ids) => ids.map(i => ({ id: i, nome: 'Cavalo ' + i }));
  beforeEach(async () => {
    await cliente('dono1', 'Haras do Dono', 'adm@dono1.com');
    await cliente('vet1', 'Clínica Vet', 'vet@vet1.com');
    await db.doc('tenants/dono1/dados/horses_list').set({ value: animais('a1', 'a2', 'a3') });
  });
  test('convidar: cria vínculo pendente; só admin com o recurso; prestador precisa ser uma assinatura com o recurso', async () => {
    const v = await wConvidar({ data: { email: 'Vet@Vet1.com', animais: ['a1', 'a2'] }, auth: tk('dono1') });
    assert.equal(v.id, 'dono1__vet1'); assert.equal(v.status, 'pendente'); assert.deepEqual(v.animaisIds, ['a1', 'a2']); assert.equal(v.prestadorNome, 'Clínica Vet'); assert.equal(v.donoNome, 'Haras do Dono');
    await rejeita(wConvidar({ data: { email: 'vet@vet1.com', animaisTodos: true } }), 'unauthenticated');
    await rejeita(wConvidar({ data: { email: 'vet@vet1.com', animaisTodos: true }, auth: { uid: 'f', token: { papel: 'funcionario', tenantId: 'dono1', recursos: REC } } }), 'permission-denied');
    await rejeita(wConvidar({ data: { email: 'vet@vet1.com', animaisTodos: true }, auth: tk('dono1', { recursos: [] }) }), 'permission-denied');   // sem o recurso liberado
  });
  test('convidar: validações (e-mail, ninguém encontrado, a si mesmo, animal que não é seu, lista vazia, prestador sem recurso)', async () => {
    await rejeita(wConvidar({ data: { email: 'nao-e-email', animaisTodos: true }, auth: tk('dono1') }), 'invalid-argument');
    await rejeita(wConvidar({ data: { email: 'ninguem@x.com', animaisTodos: true }, auth: tk('dono1') }), 'not-found');
    await rejeita(wConvidar({ data: { email: 'adm@dono1.com', animaisTodos: true }, auth: tk('dono1') }), 'not-found');   // uma conta de proprietário não é prestador
    await rejeita(wConvidar({ data: { email: 'vet@vet1.com', animais: ['a1', 'de-outro'] }, auth: tk('dono1') }), 'invalid-argument');
    await rejeita(wConvidar({ data: { email: 'vet@vet1.com', animais: [] }, auth: tk('dono1') }), 'invalid-argument');
    await rejeita(wConvidar({ data: { email: 'vet@vet1.com' }, auth: tk('dono1') }), 'invalid-argument');
    await conta('livre@x.com');
    await rejeita(wConvidar({ data: { email: 'livre@x.com', animaisTodos: true }, auth: tk('dono1') }), 'not-found');    // conta sem assinatura
    await cliente('vet2', 'Sem Recurso', 'v2@vet2.com', []);
    await rejeita(wConvidar({ data: { email: 'v2@vet2.com', animaisTodos: true }, auth: tk('dono1') }), 'failed-precondition');
  });
  test('convidar de novo: bloqueia duplicado pendente/ativo; depois de recusado/revogado pode convidar outra vez', async () => {
    await wConvidar({ data: { email: 'vet@vet1.com', animaisTodos: true }, auth: tk('dono1') });
    await rejeita(wConvidar({ data: { email: 'vet@vet1.com', animaisTodos: true }, auth: tk('dono1') }), 'already-exists');
    await wResp({ data: { vinculoId: 'dono1__vet1', aceitar: false }, auth: tk('vet1') });
    const v2 = await wConvidar({ data: { email: 'vet@vet1.com', animais: ['a3'] }, auth: tk('dono1') });
    assert.equal(v2.status, 'pendente'); assert.deepEqual(v2.animaisIds, ['a3']);
  });
  test('prestador aceita/recusa só o que é dele, só se pendente; aceitar torna ativo', async () => {
    await wConvidar({ data: { email: 'vet@vet1.com', animaisTodos: true }, auth: tk('dono1') });
    await rejeita(wResp({ data: { vinculoId: 'dono1__vet1', aceitar: true }, auth: tk('dono1') }), 'permission-denied');          // o dono não aceita por ele
    await cliente('vet3', 'Outro Vet', 'v3@vet3.com');
    await rejeita(wResp({ data: { vinculoId: 'dono1__vet1', aceitar: true }, auth: tk('vet3') }), 'permission-denied');           // outro prestador
    await rejeita(wResp({ data: { vinculoId: 'dono1__vet1', aceitar: 'sim' }, auth: tk('vet1') }), 'invalid-argument');
    await rejeita(wResp({ data: { vinculoId: 'x', aceitar: true }, auth: tk('vet1') }), 'invalid-argument');
    await rejeita(wResp({ data: { vinculoId: 'dono1__naoexiste', aceitar: true }, auth: tk('vet1') }), 'not-found');
    const v = await wResp({ data: { vinculoId: 'dono1__vet1', aceitar: true }, auth: tk('vet1') });
    assert.equal(v.status, 'ativo');
    await rejeita(wResp({ data: { vinculoId: 'dono1__vet1', aceitar: false }, auth: tk('vet1') }), 'failed-precondition');          // já não está pendente
  });
  test('proprietário muda os animais liberados (só ele); prestador não vê a lista antes de aceitar', async () => {
    await wConvidar({ data: { email: 'vet@vet1.com', animais: ['a1'] }, auth: tk('dono1') });
    let l = await wVincs({ data: {}, auth: tk('vet1') });
    assert.equal(l.comoPrestador.length, 1); assert.deepEqual(l.comoPrestador[0].animaisIds, []);    // pendente: não vê
    await wResp({ data: { vinculoId: 'dono1__vet1', aceitar: true }, auth: tk('vet1') });
    l = await wVincs({ data: {}, auth: tk('vet1') });
    assert.deepEqual(l.comoPrestador[0].animaisIds, ['a1']);
    await rejeita(wAnim({ data: { vinculoId: 'dono1__vet1', animaisTodos: true }, auth: tk('vet1') }), 'permission-denied');          // prestador não mexe
    const v = await wAnim({ data: { vinculoId: 'dono1__vet1', animais: ['a2', 'a3'] }, auth: tk('dono1') });
    assert.deepEqual(v.animaisIds, ['a2', 'a3']);
    const t = await wAnim({ data: { vinculoId: 'dono1__vet1', animaisTodos: true }, auth: tk('dono1') });
    assert.equal(t.animaisTodos, true); assert.deepEqual(t.animaisIds, []);
    await rejeita(wAnim({ data: { vinculoId: 'dono1__vet1', animais: ['nao-meu'] }, auth: tk('dono1') }), 'invalid-argument');
  });
  test('listar: cada lado só vê o que é seu; terceiro não vê nada', async () => {
    await wConvidar({ data: { email: 'vet@vet1.com', animaisTodos: true }, auth: tk('dono1') });
    const d = await wVincs({ data: {}, auth: tk('dono1') });
    assert.equal(d.comoProprietario.length, 1); assert.equal(d.comoPrestador.length, 0);
    await cliente('vet9', 'Intruso', 'i@vet9.com');
    const i = await wVincs({ data: {}, auth: tk('vet9') });
    assert.deepEqual([i.comoProprietario.length, i.comoPrestador.length], [0, 0]);
  });
  test('revogar: qualquer um dos dois lados encerra; terceiro não; encerrado não encerra de novo', async () => {
    await wConvidar({ data: { email: 'vet@vet1.com', animaisTodos: true }, auth: tk('dono1') });
    await wResp({ data: { vinculoId: 'dono1__vet1', aceitar: true }, auth: tk('vet1') });
    await cliente('vet9', 'Intruso', 'i@vet9.com');
    await rejeita(wRevog({ data: { vinculoId: 'dono1__vet1' }, auth: tk('vet9') }), 'permission-denied');
    const v = await wRevog({ data: { vinculoId: 'dono1__vet1' }, auth: tk('vet1') });
    assert.equal(v.status, 'revogado');
    const doc = (await db.doc('vinculos/dono1__vet1').get()).data();
    assert.equal(doc.revogadoLado, 'prestador'); assert.ok(doc.eventos.some(e => /encerrado pelo prestador/.test(e.acao)));
    await rejeita(wRevog({ data: { vinculoId: 'dono1__vet1' }, auth: tk('dono1') }), 'failed-precondition');
  });
  test('o haras original (sem cliente) também pode ser proprietário', async () => {
    await db.doc('harasData/horses_list').set({ value: animais('h1', 'h2') });
    const v = await wConvidar({ data: { email: 'vet@vet1.com', animais: ['h1'] }, auth: tk(null) });
    assert.equal(v.id, '_original__vet1'); assert.equal(v.donoNome, 'Haras original');
    await rejeita(wConvidar({ data: { email: 'vet@vet1.com', animais: ['h2'] }, auth: tk(null) }), 'already-exists');
    const l = await wVincs({ data: {}, auth: tk('vet1') });
    assert.equal(l.comoPrestador[0].donoNome, 'Haras original');
  });
  test('TIPO: o tipo de assinatura vem do dono (criar/editar), vai para as claims e o padrão é proprietário', async () => {
    const id = (await wCriar({ data: { nome: 'Vet Tipo', emailAdmin: 't@tipo.com', senhaProvisoria: 'provisoria1', plano: 'pro', tipoAssinatura: 'prestador' }, auth: dono })).tenantId;
    assert.equal((await claimsDe('t@tipo.com')).tipoAssinatura, 'prestador');
    assert.equal((await db.doc(`clientes/${id}`).get()).data().tipoAssinatura, 'prestador');
    await rejeita(wCriar({ data: { nome: 'Ruim', emailAdmin: 'r@tipo.com', tipoAssinatura: 'vendedor' }, auth: dono }), 'invalid-argument');
    const id2 = (await wCriar({ data: { nome: 'Padrao Tipo', emailAdmin: 'p@tipo.com', senhaProvisoria: 'provisoria1' }, auth: dono })).tenantId;
    assert.equal((await claimsDe('p@tipo.com')).tipoAssinatura, 'proprietario');
    await db.doc(`tenants/${id2}/dados/usuarios_list`).set({ value: [user('p@tipo.com', true)] });
    const r = await wAtual({ data: { tenantId: id2, tipoAssinatura: 'ambos' }, auth: dono });
    assert.deepEqual(r.atualizado, ['tipoAssinatura', 'claims']);
    assert.equal((await claimsDe('p@tipo.com')).tipoAssinatura, 'ambos');
    await rejeita(wAtual({ data: { tenantId: id2, tipoAssinatura: 'xx' }, auth: dono }), 'invalid-argument');
    const l = (await wListar({ data: {}, auth: dono })).clientes;
    assert.equal(l.find(c => c.id === id2).tipoAssinatura, 'ambos'); assert.equal(l.find(c => c.id === id).tipoAssinatura, 'prestador');
  });
  test('TIPO: prestador não convida; proprietário não aceita; cliente comum não pode ser convidado; "ambos" faz os dois lados', async () => {
    await rejeita(wConvidar({ data: { email: 'adm@dono1.com', animaisTodos: true }, auth: tk('vet1') }), 'permission-denied');         // prestador tentando convidar
    await cliente('comum2', 'Cliente Comum', 'c@comum2.com');                                                                           // proprietário comum
    await rejeita(wConvidar({ data: { email: 'c@comum2.com', animaisTodos: true }, auth: tk('dono1') }), 'not-found');                    // não é prestador: nem aparece como opção
    await wConvidar({ data: { email: 'vet@vet1.com', animaisTodos: true }, auth: tk('dono1') });
    await rejeita(wResp({ data: { vinculoId: 'dono1__vet1', aceitar: true }, auth: tk('comum2') }), 'permission-denied');                // proprietário não aceita convite
    await rejeita(wAnim({ data: { vinculoId: 'dono1__vet1', animaisTodos: true }, auth: tk('vet1') }), 'permission-denied');             // prestador não muda animais
    // "ambos": convida e aceita
    await cliente('ambos1', 'Vet com Animais', 'a@ambos1.com');
    await conta('a@ambos1.com', { tenantId: 'ambos1', papel: 'admin', modulos: MODULOS, recursos: REC, tipoAssinatura: 'ambos' }).catch(() => {});
    await auth.setCustomUserClaims((await auth.getUserByEmail('a@ambos1.com')).uid, { tenantId: 'ambos1', papel: 'admin', modulos: MODULOS, recursos: REC, tipoAssinatura: 'ambos' });
    await db.doc('tenants/ambos1/dados/horses_list').set({ value: animais('z1') });
    const tAmbos = { uid: 'u-ambos1', token: { papel: 'admin', tenantId: 'ambos1', recursos: REC, tipoAssinatura: 'ambos', email: 'a@ambos1.com' } };
    const v1 = await wConvidar({ data: { email: 'vet@vet1.com', animais: ['z1'] }, auth: tAmbos });    // como proprietário
    assert.equal(v1.id, 'ambos1__vet1');
    await rejeita(wConvidar({ data: { email: 'a@ambos1.com', animaisTodos: true }, auth: tAmbos }), 'invalid-argument');   // ninguém se convida
    await wConvidar({ data: { email: 'adm@dono1.com', animaisTodos: true }, auth: tk('vet1') }).then(() => assert.fail('vet1 é só prestador'), e => assert.equal(e.code, 'permission-denied'));
    await wConvidar({ data: { email: 'a@ambos1.com', animaisTodos: true }, auth: tk('dono1') });        // dono1 convida o "ambos" como prestador
    const v2 = await wResp({ data: { vinculoId: 'dono1__ambos1', aceitar: true }, auth: tAmbos });     // e o "ambos" aceita como prestador
    assert.equal(v2.status, 'ativo');
  });
  test('TIPO: conta antiga sem a claim vale como proprietário (padrão)', async () => {
    await conta('velho@x.com', { tenantId: 'dono1', papel: 'admin', modulos: MODULOS, recursos: REC });   // sem tipoAssinatura
    const velho = { uid: 'u-velho', token: { papel: 'admin', tenantId: 'dono1', recursos: REC, email: 'velho@x.com' } };
    const v = await wConvidar({ data: { email: 'vet@vet1.com', animaisTodos: true }, auth: velho });
    assert.equal(v.status, 'pendente');
    await rejeita(wResp({ data: { vinculoId: 'dono1__vet1', aceitar: true }, auth: velho }), 'permission-denied');
  });
  test('o app não lê a coleção vinculos direto (regras fechadas)', async () => {
    const fs = require('fs'), path = require('path');
    const regras = fs.readFileSync(path.join(__dirname, '..', '..', 'firebase', 'firestore.rules.2b'), 'utf8');
    assert.ok(!/vinculos|solicitacoes/.test(regras));   // nenhuma regra libera: "todo o resto bloqueado" vale
    assert.ok(/match \/\{outro=\*\*\}/.test(regras) && /allow read, write: if false/.test(regras));
  });
});

describe('integração entre assinaturas — etapa 2 (envio pelo prestador)', () => {
  const REC = ['integracao_prestadores'];
  const tkD = { uid: 'u-d', token: { papel: 'admin', tenantId: 'dono2', recursos: REC, tipoAssinatura: 'proprietario', email: 'adm@dono2.com' } };
  const tkV = (id = 'vet2') => ({ uid: 'u-' + id, token: { papel: 'admin', tenantId: id, recursos: REC, tipoAssinatura: 'prestador', email: 'vet@' + id + '.com' } });
  const hoje = () => new Date().toISOString().slice(0, 10);
  const servico = (extra = {}) => ({ tipo: 'servico', nome: 'Consulta', categoria: 'consulta', valorCentavos: 15000, ...extra });
  const material = (extra = {}) => ({ tipo: 'material', nome: 'Fenilbutazona', quantidade: 2, unidade: 'ml', produtoDoPrestador: false, ...extra });
  const ok = (extra = {}) => ({ vinculoId: 'dono2__vet2', animalId: 'a1', dataRegistro: hoje(), tipoRegistro: 'aplicacao', descricao: 'Aplicação IV', itens: [servico(), material()], ...extra });
  beforeEach(async () => {
    for (const [id, nome, email, tipo] of [['dono2', 'Haras Dois', 'adm@dono2.com', 'proprietario'], ['vet2', 'Vet Dois', 'vet@vet2.com', 'prestador'], ['vet3', 'Vet Tres', 'vet@vet3.com', 'prestador']]) {
      await db.doc(`clientes/${id}`).set({ nome, ativo: true, plano: 'pro' });
      await conta(email, { tenantId: id, papel: 'admin', modulos: MODULOS, recursos: REC, tipoAssinatura: tipo });
    }
    await db.doc('tenants/dono2/dados/horses_list').set({ value: [{ id: 'a1', nome: 'Alfa' }, { id: 'a2', nome: 'Beta' }, { id: 'a3', nome: 'Gama' }] });
    await wConvidar({ data: { email: 'vet@vet2.com', animais: ['a1', 'a2'] }, auth: tkD });
    await wResp({ data: { vinculoId: 'dono2__vet2', aceitar: true }, auth: tkV() });
  });
  test('animais autorizados: só os liberados (ou todos), só o prestador do vínculo ativo', async () => {
    const r = await wAutor({ data: { vinculoId: 'dono2__vet2' }, auth: tkV() });
    assert.deepEqual(r.animais.map(a => a.id), ['a1', 'a2']);
    await wAnim({ data: { vinculoId: 'dono2__vet2', animaisTodos: true }, auth: tkD });
    assert.equal((await wAutor({ data: { vinculoId: 'dono2__vet2' }, auth: tkV() })).animais.length, 3);
    await rejeita(wAutor({ data: { vinculoId: 'dono2__vet2' }, auth: tkV('vet3') }), 'permission-denied');
    await rejeita(wAutor({ data: { vinculoId: 'dono2__vet2' }, auth: tkD }), 'permission-denied');     // o proprietário não usa isso
  });
  test('enviar: cria solicitação PENDENTE com serviço (com valor) e material (sem valor)', async () => {
    const r = await wEnviar({ data: ok(), auth: tkV() });
    assert.equal(r.status, 'pendente'); assert.equal(r.animalNome, 'Alfa'); assert.equal(r.donoNome, 'Haras Dois'); assert.equal(r.prestadorNome, 'Vet Dois');
    assert.deepEqual(r.itens[0], { tipo: 'servico', nome: 'Consulta', categoria: 'consulta', valorCentavos: 15000, obs: '' });
    assert.equal(r.itens[1].produtoDoPrestador, false); assert.equal(r.itens[1].valorUnitarioCentavos, undefined);
    const no = (await db.doc('tenants/dono2/dados/horses_list').get()).data().value;
    assert.equal(no.length, 3);                                  // nada foi gravado na ficha do proprietário
    assert.equal((await db.collection('tenants/dono2/dados').get()).docs.filter(d => /manejos|tratamentos|estoque|visitas/.test(d.id)).length, 0);
  });
  test('botão "este produto é meu": exige valor unitário; sem o botão, valor é recusado', async () => {
    const meu = await wEnviar({ data: ok({ itens: [material({ nome: 'Ferradura', produtoDoPrestador: true, valorUnitarioCentavos: 4500, quantidade: 4 })] }), auth: tkV() });
    assert.deepEqual([meu.itens[0].produtoDoPrestador, meu.itens[0].valorUnitarioCentavos, meu.itens[0].quantidade], [true, 4500, 4]);
    await rejeita(wEnviar({ data: ok({ itens: [material({ produtoDoPrestador: true })] }), auth: tkV() }), 'invalid-argument');                       // sem valor
    await rejeita(wEnviar({ data: ok({ itens: [material({ produtoDoPrestador: false, valorUnitarioCentavos: 100 })] }), auth: tkV() }), 'invalid-argument'); // preço sem ser dele
    await rejeita(wEnviar({ data: ok({ itens: [material({ produtoDoPrestador: true, valorUnitarioCentavos: -5 })] }), auth: tkV() }), 'invalid-argument');
  });
  test('enviar: animal fora da lista, vínculo de outro prestador, tipos errados e entradas inválidas são recusados', async () => {
    await rejeita(wEnviar({ data: ok({ animalId: 'a3' }), auth: tkV() }), 'permission-denied');                       // a3 não liberado
    await rejeita(wEnviar({ data: ok(), auth: tkV('vet3') }), 'permission-denied');                                   // outro prestador
    await rejeita(wEnviar({ data: ok(), auth: tkD }), 'permission-denied');                                           // proprietário não envia
    await rejeita(wEnviar({ data: ok(), auth: { uid: 'f', token: { papel: 'funcionario', tenantId: 'vet2', recursos: REC, tipoAssinatura: 'prestador' } } }), 'permission-denied');
    await rejeita(wEnviar({ data: ok({ dataRegistro: '2030-01-01' }), auth: tkV() }), 'invalid-argument');             // futuro
    await rejeita(wEnviar({ data: ok({ dataRegistro: '2026-02-31' }), auth: tkV() }), 'invalid-argument');
    await rejeita(wEnviar({ data: ok({ tipoRegistro: 'cirurgia' }), auth: tkV() }), 'invalid-argument');
    await rejeita(wEnviar({ data: ok({ itens: [] }), auth: tkV() }), 'invalid-argument');
    await rejeita(wEnviar({ data: ok({ itens: [{ tipo: 'outro', nome: 'x' }] }), auth: tkV() }), 'invalid-argument');
    await rejeita(wEnviar({ data: ok({ itens: [servico({ valorCentavos: undefined })] }), auth: tkV() }), 'invalid-argument');           // serviço sem valor
    await rejeita(wEnviar({ data: ok({ itens: [material({ quantidade: 0 })] }), auth: tkV() }), 'invalid-argument');
    await rejeita(wEnviar({ data: ok({ itens: Array.from({ length: 31 }, () => servico()) }), auth: tkV() }), 'invalid-argument');
    await wRevog({ data: { vinculoId: 'dono2__vet2' }, auth: tkD });
    await rejeita(wEnviar({ data: ok(), auth: tkV() }), 'failed-precondition');                                         // vínculo encerrado
  });
  test('listar: cada lado só vê o que é seu; prestador cancela só a própria e só pendente', async () => {
    const s = await wEnviar({ data: ok(), auth: tkV() });
    const d = await wSolic({ data: {}, auth: tkD }); const v = await wSolic({ data: {}, auth: tkV() }); const o = await wSolic({ data: {}, auth: tkV('vet3') });
    assert.equal(d.recebidas.length, 1); assert.equal(d.enviadas.length, 0); assert.equal(v.enviadas.length, 1); assert.equal(v.recebidas.length, 0);
    assert.deepEqual([o.recebidas.length, o.enviadas.length], [0, 0]);
    await rejeita(wCancel({ data: { solicitacaoId: s.id }, auth: tkV('vet3') }), 'permission-denied');
    await rejeita(wCancel({ data: { solicitacaoId: s.id }, auth: tkD }), 'permission-denied');
    await rejeita(wCancel({ data: { solicitacaoId: 'curto' }, auth: tkV() }), 'invalid-argument');
    const c = await wCancel({ data: { solicitacaoId: s.id }, auth: tkV() });
    assert.equal(c.status, 'cancelado');
    await rejeita(wCancel({ data: { solicitacaoId: s.id }, auth: tkV() }), 'failed-precondition');
    assert.equal((await wSolic({ data: {}, auth: tkD })).recebidas[0].status, 'cancelado');
  });
  test('decidir: só o proprietário dono da solicitação; recusa pede motivo; aprova com revisão e guarda o original; não decide duas vezes', async () => {
    const s = await wEnviar({ data: ok(), auth: tkV() });
    await rejeita(wDecide({ data: { solicitacaoId: s.id, decisao: 'aprovar' }, auth: tkV() }), 'permission-denied');          // prestador não decide
    await rejeita(wDecide({ data: { solicitacaoId: s.id, decisao: 'aprovar' }, auth: tkV('vet3') }), 'permission-denied');
    await rejeita(wDecide({ data: { solicitacaoId: s.id, decisao: 'talvez' }, auth: tkD }), 'invalid-argument');
    await rejeita(wDecide({ data: { solicitacaoId: 'curto', decisao: 'aprovar' }, auth: tkD }), 'invalid-argument');
    await rejeita(wDecide({ data: { solicitacaoId: s.id, decisao: 'recusar' }, auth: tkD }), 'invalid-argument');             // sem motivo
    await rejeita(wDecide({ data: { solicitacaoId: s.id, decisao: 'aprovar', itens: [servico({ valorCentavos: -1 })] }, auth: tkD }), 'invalid-argument');
    const a = await wDecide({ data: { solicitacaoId: s.id, decisao: 'aprovar', itens: [servico({ valorCentavos: 12000 })] }, auth: tkD });
    assert.equal(a.status, 'aprovado'); assert.equal(a.itens[0].valorCentavos, 12000);
    const bruto = (await db.doc('solicitacoes/' + s.id).get()).data();
    assert.equal(bruto.itensOriginais[0].valorCentavos, 15000); assert.ok(bruto.eventos.some(e => /valores revisados/.test(e.acao)));
    await rejeita(wDecide({ data: { solicitacaoId: s.id, decisao: 'recusar', motivo: 'não pedi' }, auth: tkD }), 'failed-precondition');
    const r = await wEnviar({ data: ok(), auth: tkV() });
    const z = await wDecide({ data: { solicitacaoId: r.id, decisao: 'recusar', motivo: 'valor acima do combinado' }, auth: tkD });
    assert.deepEqual([z.status, z.motivo], ['recusado', 'valor acima do combinado']);
    await rejeita(wCancel({ data: { solicitacaoId: r.id }, auth: tkV() }), 'failed-precondition');
    assert.equal((await wSolic({ data: {}, auth: tkV() })).enviadas.find(x => x.id === r.id).motivo, 'valor acima do combinado');
  });
  test('substituir: nova versão troca a pendente (mesmo id); depois de decidida, vira solicitação nova', async () => {
    const a = await wEnviar({ data: ok(), auth: tkV() });
    const b = await wEnviar({ data: ok({ tipoRegistro: 'visita', substituiSolicitacaoId: a.id, itens: [servico({ valorCentavos: 9900 })] }), auth: tkV() });
    assert.equal(b.id, a.id); assert.equal(b.substituida, true); assert.equal(b.itens[0].valorCentavos, 9900);
    assert.equal((await db.collection('solicitacoes').get()).size, 1);
    assert.ok((await db.doc('solicitacoes/' + a.id).get()).data().eventos.some(e => /substitui a pendente/.test(e.acao)));
    await wDecide({ data: { solicitacaoId: a.id, decisao: 'aprovar' }, auth: tkD });
    const c = await wEnviar({ data: ok({ substituiSolicitacaoId: a.id }), auth: tkV() });
    assert.notEqual(c.id, a.id); assert.equal(c.status, 'pendente');
    const d = await wEnviar({ data: ok({ animalId: 'a2', substituiSolicitacaoId: c.id }), auth: tkV() });   // outro animal: não substitui
    assert.notEqual(d.id, c.id);
  });
  test('limite de pendentes por vínculo', async () => {
    for (let i = 0; i < 50; i++) await db.collection('solicitacoes').add({ vinculoId: 'dono2__vet2', donoTenantId: 'dono2', prestadorTenantId: 'vet2', status: 'pendente', itens: [], criadoEm: new Date().toISOString() });
    await rejeita(wEnviar({ data: ok(), auth: tkV() }), 'resource-exhausted');
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

describe('listarClientes', () => {
  test('negado a não-dono e a anônimo', async () => {
    await rejeita(wListar({ data: {}, auth: { uid: 'u', token: { papel: 'admin' } } }), 'permission-denied');
    await rejeita(wListar({ data: {} }), 'unauthenticated');
  });
  test('lista vazia', async () => {
    assert.deepEqual(await wListar({ data: {}, auth: dono }), { clientes: [] });
  });
  test('formato, defaults, contas por tenant, admin, último acesso e ordenação pt-BR', async () => {
    await db.doc('clientes/zeta').set({ nome: 'zeta Haras', ativo: false, plano: 'pro', limiteBytes: 5000000,
      criadoEm: new Date('2026-01-02T03:04:05.000Z'),
      consentimentoDados: { aceito: true, data: new Date('2026-02-03T00:00:00.000Z'), versao: 'v1', por: 'a@b.com' } });
    await db.doc('clientes/alfa').set({ nome: 'Álamo' }); // só nome: usa defaults
    await db.doc('clientes/beta').set({ nome: 'beta' });
    await conta('adm@zeta.com', { tenantId: 'zeta', papel: 'admin', modulos: [] });
    await conta('f1@zeta.com', { tenantId: 'zeta', papel: 'funcionario', modulos: [] });
    await conta('f2@alfa.com', { tenantId: 'alfa', papel: 'funcionario', modulos: [] });
    await conta('dono@x.com', { dono: true });
    await conta('livre@x.com');
    const r = await wListar({ data: {}, auth: dono });
    assert.deepEqual(r.clientes.map(c => c.id), ['alfa', 'beta', 'zeta']); // Álamo, beta, zeta (sem diferenciar maiúsculas)
    const [alfa, beta, zeta] = r.clientes;
    assert.deepEqual(Object.keys(zeta).sort(), ['ativo', 'cobranca', 'consentimentoDados', 'contas', 'criadoEm', 'emailAdmin', 'id', 'limiteBytes', 'limites', 'nome', 'plano', 'recursos', 'tipoAssinatura', 'ultimoAcesso', 'usuariosNaLista']);
    assert.equal(zeta.ativo, false); assert.equal(zeta.plano, 'pro'); assert.equal(zeta.limiteBytes, 5000000);
    assert.equal(zeta.criadoEm, '2026-01-02T03:04:05.000Z');
    assert.deepEqual(zeta.consentimentoDados, { aceito: true, data: '2026-02-03T00:00:00.000Z', versao: 'v1', por: 'a@b.com' });
    assert.equal(zeta.contas, 2); assert.equal(zeta.emailAdmin, 'adm@zeta.com');
    assert.equal(alfa.ativo, true); assert.equal(alfa.plano, 'basico'); assert.equal(alfa.limiteBytes, 1073741824);
    assert.equal(alfa.criadoEm, null); assert.equal(alfa.consentimentoDados, null);
    assert.equal(alfa.contas, 1); assert.equal(alfa.emailAdmin, '');
    assert.equal(beta.contas, 0); assert.equal(beta.ultimoAcesso, null);
  });
  test('unitário: lista o Auth uma única vez (paginado), agrupa por tenant e usa o último acesso mais recente', async () => {
    const mk = (email, tenantId, papel, last) => ({ uid: email, email, customClaims: tenantId ? { tenantId, papel } : {}, metadata: { lastSignInTime: last } });
    const paginas = [
      { users: [mk('a@a', 'a', 'funcionario', 'Mon, 01 Jun 2026 10:00:00 GMT'), mk('b@b', 'b', 'admin', 'Tue, 02 Jun 2026 10:00:00 GMT')], pageToken: 't1' },
      { users: [mk('a2@a', 'a', 'admin', 'Wed, 03 Jun 2026 10:00:00 GMT'), mk('s@s', null, null, undefined)], pageToken: undefined },
    ];
    const chamadas = [];
    const fakeAuth = { listUsers: async (n, tok) => { chamadas.push([n, tok]); return tok ? paginas[1] : paginas[0]; } };
    const docs = [['a', { nome: 'A' }], ['b', { nome: 'B' }], ['c', { nome: 'C' }]].map(([id, d]) => ({ id, data: () => d }));
    const fakeDb = { collection: (n) => { assert.equal(n, 'clientes'); return { get: async () => ({ docs }) }; } };
    const r = await CL.listarClientes({ auth: fakeAuth, db: fakeDb });
    assert.deepEqual(chamadas, [[1000, undefined], [1000, 't1']]);
    const por = Object.fromEntries(r.clientes.map(c => [c.id, c]));
    assert.equal(por.a.contas, 2); assert.equal(por.a.emailAdmin, 'a2@a');
    assert.equal(por.a.ultimoAcesso, '2026-06-03T10:00:00.000Z');
    assert.equal(por.b.contas, 1); assert.equal(por.b.emailAdmin, 'b@b');
    assert.equal(por.c.contas, 0); assert.equal(por.c.ultimoAcesso, null);
  });
});

describe('atualizarCliente', () => {
  const donoEmail = { uid: 'd1', token: { dono: true, email: 'dono@haras.com' } };
  const base = () => db.doc('clientes/acme').set({ nome: 'Acme', ativo: true, plano: 'basico', limiteBytes: 1073741824 });
  const lerCli = async () => (await db.doc('clientes/acme').get()).data();
  test('negado a não-dono e a anônimo', async () => {
    await base();
    await rejeita(wAtual({ data: { tenantId: 'acme', nome: 'Hack' }, auth: { uid: 'u', token: { papel: 'admin', tenantId: 'acme' } } }), 'permission-denied');
    await rejeita(wAtual({ data: { tenantId: 'acme', nome: 'Hack' } }), 'unauthenticated');
    assert.equal((await lerCli()).nome, 'Acme');
  });
  test('atualiza nome (trim), plano, limite e consentimento; devolve os campos alterados', async () => {
    await base();
    const antes = Date.now();
    const r = await wAtual({ data: { tenantId: 'acme', nome: '  Acme Novo  ', plano: 'pro', limiteBytes: 2097152,
      consentimentoDados: { aceito: true, versao: 'v2' } }, auth: donoEmail });
    assert.deepEqual(r, { tenantId: 'acme', atualizado: ['nome', 'plano', 'limiteBytes', 'consentimentoDados', 'claims'] });
    const c = await lerCli();
    assert.equal(c.nome, 'Acme Novo'); assert.equal(c.plano, 'pro'); assert.equal(c.limiteBytes, 2097152);
    assert.equal(c.ativo, true);
    assert.equal(c.consentimentoDados.aceito, true); assert.equal(c.consentimentoDados.versao, 'v2');
    assert.equal(c.consentimentoDados.por, 'dono@haras.com');
    assert.ok(new Date(c.consentimentoDados.data).getTime() >= antes - 1000);
  });
  test('atualização parcial e consentimento sem e-mail no token grava por vazio', async () => {
    await base();
    assert.deepEqual(await wAtual({ data: { tenantId: 'acme', plano: 'gratuito' }, auth: dono }), { tenantId: 'acme', atualizado: ['plano', 'limiteBytes', 'claims'] });
    assert.equal((await lerCli()).plano, 'gratuito'); assert.equal((await lerCli()).nome, 'Acme');
    await wAtual({ data: { tenantId: 'acme', consentimentoDados: { aceito: false, versao: 'v1' } }, auth: dono });
    assert.equal((await lerCli()).consentimentoDados.por, '');
  });
  test('nunca altera ativo nem campos desconhecidos', async () => {
    await base();
    const r = await wAtual({ data: { tenantId: 'acme', nome: 'Ok', ativo: false, criadoEm: 'x', foo: 1 }, auth: dono });
    assert.deepEqual(r.atualizado, ['nome']);
    const c = await lerCli(); assert.equal(c.ativo, true); assert.equal(c.foo, undefined); assert.equal(c.criadoEm, undefined);
    await rejeita(wAtual({ data: { tenantId: 'acme', ativo: false }, auth: dono }), 'invalid-argument');
    assert.equal((await lerCli()).ativo, true);
  });
  test('entradas inválidas e atualização vazia', async () => {
    await base();
    const t = (d) => rejeita(wAtual({ data: { tenantId: 'acme', ...d }, auth: dono }), 'invalid-argument');
    await t({}); await t({ foo: 1 });
    await t({ nome: 'a' }); await t({ nome: '   ' }); await t({ nome: 'x'.repeat(101) }); await t({ nome: 5 });
    await t({ plano: 'premium' }); await t({ plano: 1 });
    await t({ limiteBytes: 1048575 }); await t({ limiteBytes: 107374182401 }); await t({ limiteBytes: 1.5e6 + 0.5 }); await t({ limiteBytes: '2097152' });
    await t({ consentimentoDados: { aceito: 'sim', versao: 'v1' } });
    await t({ consentimentoDados: { aceito: true, versao: '' } });
    await t({ consentimentoDados: { aceito: true, versao: 'v'.repeat(41) } });
    await t({ consentimentoDados: { aceito: true } }); await t({ consentimentoDados: null });
    await rejeita(wAtual({ data: { tenantId: 'Inválido!', nome: 'Ok' }, auth: dono }), 'invalid-argument');
    await rejeita(wAtual({ data: { nome: 'Ok' }, auth: dono }), 'invalid-argument');
    assert.deepEqual(await lerCli(), { nome: 'Acme', ativo: true, plano: 'basico', limiteBytes: 1073741824 });
  });
  test('limites aceitos (mínimo e máximo) e cliente inexistente', async () => {
    await base();
    await wAtual({ data: { tenantId: 'acme', limiteBytes: 1048576 }, auth: dono });
    await wAtual({ data: { tenantId: 'acme', limiteBytes: 107374182400 }, auth: dono });
    assert.equal((await lerCli()).limiteBytes, 107374182400);
    await rejeita(wAtual({ data: { tenantId: 'nao-existe', nome: 'Ok' }, auth: dono }), 'not-found');
    assert.equal((await db.doc('clientes/nao-existe').get()).exists, false);
  });
});

describe('excluirCliente', () => {
  async function criar(nome, email){ return (await wCriar({ data: { nome, emailAdmin: email, senhaProvisoria: 'provisoria1' }, auth: dono })).tenantId; }
  test('negado a não-dono', async () => {
    const id = await criar('Apagar', 'x@apagar.com');
    await wBloq({ data: { tenantId: id, ativo: false }, auth: dono });
    await rejeita(wExcl({ data: { tenantId: id, confirmacaoNome: 'Apagar' }, auth: { uid: 'u', token: { papel: 'admin', tenantId: id } } }), 'permission-denied');
  });
  test('recusa cliente ativo e nome errado; nada é apagado', async () => {
    const id = await criar('Apagar', 'x@apagar.com');
    await rejeita(wExcl({ data: { tenantId: id, confirmacaoNome: 'Apagar', confirmacao: 'EXCLUIR' }, auth: dono }), 'failed-precondition');
    await wBloq({ data: { tenantId: id, ativo: false }, auth: dono });
    await rejeita(wExcl({ data: { tenantId: id, confirmacaoNome: 'outro', confirmacao: 'EXCLUIR' }, auth: dono }), 'invalid-argument');
    await rejeita(wExcl({ data: { tenantId: id, confirmacaoNome: 'Apagar', confirmacao: 'excluir' }, auth: dono }), 'invalid-argument');
    await rejeita(wExcl({ data: { tenantId: id }, auth: dono }), 'invalid-argument');
    assert.ok((await db.doc(`clientes/${id}`).get()).exists);
    await auth.getUserByEmail('x@apagar.com');
  });
  test('apaga dados, contas, pagamentos, vínculos e pedidos só desse cliente', async () => {
    const id = await criar('Apagar', 'x@apagar.com');
    const outro = await criar('Fica', 'y@fica.com');
    await conta('func@apagar.com', { tenantId: id, papel: 'funcionario', modulos: ['animais'] });
    await db.doc(`tenants/${id}/dados/animais`).set({ value: [1] });
    await db.doc(`tenants/${outro}/dados/animais`).set({ value: [2] });
    await db.doc(`clientes/${id}/pagamentos/p1`).set({ valorCentavos: 100 });
    await db.doc(`vinculos/${id}__${outro}`).set({ donoTenantId: id, prestadorTenantId: outro });
    await db.doc(`vinculos/${outro}__zz`).set({ donoTenantId: outro, prestadorTenantId: 'zz' });
    await db.doc('solicitacoes/s1').set({ donoTenantId: outro, prestadorTenantId: id });
    await wBloq({ data: { tenantId: id, ativo: false }, auth: dono });
    const r = await wExcl({ data: { tenantId: id, confirmacaoNome: ' Apagar ', confirmacao: 'EXCLUIR' }, auth: dono });
    assert.equal(r.contasApagadas, 2); assert.equal(r.documentosApagados, 2); assert.equal(r.pagamentosApagados, 1); assert.equal(r.vinculosApagados, 1); assert.equal(r.pedidosApagados, 1);
    assert.equal((await db.doc(`clientes/${id}`).get()).exists, false);
    assert.equal((await db.doc(`tenants/${id}/dados/animais`).get()).exists, false);
    await assert.rejects(auth.getUserByEmail('x@apagar.com')); await assert.rejects(auth.getUserByEmail('func@apagar.com'));
    assert.ok((await db.doc(`tenants/${outro}/dados/animais`).get()).exists);
    assert.ok((await db.doc(`vinculos/${outro}__zz`).get()).exists);
    await auth.getUserByEmail('y@fica.com');
  });
  test('cliente inexistente', async () => { await rejeita(wExcl({ data: { tenantId: 'nao-existe', confirmacaoNome: 'x', confirmacao: 'EXCLUIR' }, auth: dono }), 'not-found'); });
});
