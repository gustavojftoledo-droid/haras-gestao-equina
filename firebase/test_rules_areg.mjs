// Confere que as chaves da Linha do Tempo por animal ('areg_<animalId>' e 'areg_indice') funcionam com as
// regras publicadas (firebase/firestore.rules) e com as da versão 2b (firebase/firestore.rules.2b), e que
// uma chave com barra ("animal_registros/<id>") NÃO funcionaria (cairia na regra "todo o resto bloqueado").
// Rodar com o emulador do Firestore na porta 8085 (mesmo esquema de test_rules.mjs):
//   RULES_DIR=<pasta firebase> node test_rules_areg.mjs
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import fs from 'fs';
const dir = process.env.RULES_DIR || '.';
let ok = 0, bad = 0;
const t = async (nome, p, esperado) => { try { await (esperado ? assertSucceeds(p) : assertFails(p)); ok++; console.log('OK   ', nome); } catch (e) { bad++; console.log('FALHA', nome); } };
for (const arq of ['firestore.rules', 'firestore.rules.2b']) {
  const env = await initializeTestEnvironment({ projectId: 'demo-haras-areg', firestore: { host: '127.0.0.1', port: 8085, rules: fs.readFileSync(dir + '/' + arq, 'utf8') } });
  const orig = env.authenticatedContext('g', { papel: 'admin' }).firestore();
  const func = env.authenticatedContext('f', { papel: 'funcionario' }).firestore();
  const cliA = env.authenticatedContext('ca', { tenantId: 'cli-a', papel: 'funcionario' }).firestore();
  const cliB = env.authenticatedContext('cb', { tenantId: 'cli-b', papel: 'admin' }).firestore();
  const anon = env.unauthenticatedContext().firestore();
  console.log('--- regras:', arq);
  await t('original: funcionário grava harasData/areg_h_123_abc', func.doc('harasData/areg_h_123_abc').set({ value: [{ id: 'areg_1_x' }] }), true);
  await t('original: funcionário lê harasData/areg_h_123_abc', func.doc('harasData/areg_h_123_abc').get(), true);
  await t('original: grava e lê o recibo harasData/areg_indice', orig.doc('harasData/areg_indice').set({ value: { versao: 1 } }), true);
  await t('original: apagar documento por animal (reversão/limpeza futura)', orig.doc('harasData/areg_h_123_abc').delete(), true);
  await t('cliente A: grava tenants/cli-a/dados/areg_h_9', cliA.doc('tenants/cli-a/dados/areg_h_9').set({ value: [] }), true);
  await t('cliente A: lê tenants/cli-a/dados/areg_indice', cliA.doc('tenants/cli-a/dados/areg_indice').get(), true);
  await t('cliente B NÃO lê o areg do cliente A', cliB.doc('tenants/cli-a/dados/areg_h_9').get(), false);
  await t('cliente A NÃO grava no haras original', cliA.doc('harasData/areg_h_9').set({ value: [] }), false);
  await t('original NÃO grava no cliente A', orig.doc('tenants/cli-a/dados/areg_h_9').set({ value: [] }), false);
  await t('sem login NÃO lê areg', anon.doc('harasData/areg_h_123_abc').get(), false);
  await t('chave com barra animal_registros/lista/<id> NÃO funciona (por isso a chave é plana)', orig.doc('harasData/animal_registros/lista/h_1').set({ value: [] }), false);
  await t('subcoleção harasData/areg/h_1 também bloqueada', orig.doc('harasData/areg/h_1/x').set({ value: [] }), false);
  await env.cleanup();
}
console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad ? 1 : 0);
