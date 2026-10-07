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
const claimsPlano = (plano) => { const l = limitesDoPlano(plano); return { maxFotos: l.maxFotos, maxUsuarios: l.maxUsuarios, plano: l.plano }; };

const auth = getAuth(), db = getFirestore();
const trigHaras = fft.wrap(F.sincronizarPapeis);
const trigCliente = fft.wrap(F.sincronizarPapeisCliente);
const wCriar = fft.wrap(F.criarCliente), wBloq = fft.wrap(F.bloquearCliente), wUso = fft.wrap(F.usoDoCliente);
const wListar = fft.wrap(F.listarClientes), wAtual = fft.wrap(F.atualizarCliente);
const CL = require('../clientes');

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
    assert.deepEqual(Object.keys(zeta).sort(), ['ativo', 'consentimentoDados', 'contas', 'criadoEm', 'emailAdmin', 'id', 'limiteBytes', 'limites', 'nome', 'plano', 'ultimoAcesso', 'usuariosNaLista']);
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
