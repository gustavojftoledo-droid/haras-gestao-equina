/* Testes (Playwright/Chromium) da divisão dos TREINOS por ano — usa um Firestore de mentira em memória. Nenhuma rede.
   Rodar:  node projeto-linha-do-tempo/testes/pw_treinos_por_ano.js [caminho-do-html] */
const { chromium } = require('playwright');
const path = require('path');
const ARQ = process.argv[2] || path.resolve(__dirname, '..', '..', 'app_145_preview.html');
let falhas = 0, total = 0;
const ok = (nome, cond, extra) => { total++; if(!cond) falhas++; console.log((cond ? 'OK    ' : 'FALHA ') + nome + (cond ? '' : '  -> ' + JSON.stringify(extra))); };

async function preparar(page){
  await page.evaluate(() => {
    document.querySelectorAll('[id*=ogin]').forEach(e => { if (getComputedStyle(e).position === 'fixed') e.style.display = 'none'; });
    document.getElementById('appRoot').style.display = '';
    window.alerts = []; window.showAlert = m => alerts.push(String(m)); window.showConfirm = async () => true;
    window.banco = new Map(); window.ctl = { falhaLer: new Set(), escritas: [] };
    window.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'TS' } } };
    db = { collection: () => ({ doc: k => ({
      get: async () => { if (ctl.falhaLer.has(k)) throw new Error('unavailable'); const v = banco.get(k); return { exists: v !== undefined, data: () => v }; },
      set: async d => { ctl.escritas.push(k); banco.set(k, { value: JSON.parse(JSON.stringify(d.value)) }); },
      delete: async () => { banco.delete(k); } }) }) };
    HAS_FIRESTORE = true;
    window.put = (k, v) => banco.set(k, { value: JSON.parse(JSON.stringify(v)) });
    window.val = k => banco.has(k) ? banco.get(k).value : null;
    window.ids = k => (val(k) || []).map(r => r.id).sort();
    window.espera = ms => new Promise(r => setTimeout(r, ms));
    window.tr = (id, data, extra) => Object.assign({ id, data, tipo: 'Treino', animais: [{ id: 'h_1' }] }, extra);
    window.semear = () => { banco.clear(); ctl.escritas.length = 0; alerts.length = 0; partEstado.treinos_list = undefined;
      put('horses_list', [{ id: 'h_1', nome: 'Alfa' }]);
      put('treinos_list', [tr('tr_1', '2025-03-01'), tr('tr_2', '2025-12-31'), tr('tr_3', '2026-01-01'), tr('tr_4', '2026-05-05'), tr('tr_5', ''), tr('tr_6', '2024-07-07')]); };
  });
}

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await b.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.route(/^https?:/, r => r.abort());
  await page.goto('file://' + ARQ); await page.waitForTimeout(1500);
  await preparar(page);

  // 1) formato antigo: tudo como sempre (nada de recibo)
  let o = await page.evaluate(async () => {
    semear(); await loadAll(); await espera(200);
    const o = { modo: partEstado.treinos_list.modo, memoria: treinos.length };
    treinos.push(tr('tr_7', '2026-06-06')); await storeSet('treinos_list', treinos);
    o.legado = ids('treinos_list'); o.semRecibo = val('treinos_indice') === null; o.escritas = ctl.escritas.filter(k => /treinos/.test(k)); return o; });
  ok('1) formato antigo continua igual (grava no documento único, sem recibo)', o.modo === 'legado' && o.memoria === 6 && o.legado.length === 7 && o.semRecibo && o.escritas.join() === 'treinos_list', o);

  // 2) migração
  o = await page.evaluate(async () => {
    semear(); const antes = JSON.stringify(banco.get('treinos_list'));
    await loadAll(); const r = await partMigrar('treinos_list');
    return { r, modo: partEstado.treinos_list.modo, legadoIntacto: JSON.stringify(banco.get('treinos_list')) === antes, recibo: val('treinos_indice'),
      a2025: ids('treinos_2025'), a2026: ids('treinos_2026'), a2024: ids('treinos_2024'), semData: ids('treinos_sem_data'), alerts: alerts.slice() }; });
  ok('2) migração agrupa por ano, confere e mantém o documento antigo', o.r.ok && o.modo === 'particionado' && o.legadoIntacto && o.recibo.versao === 1 && o.recibo.docs.length === 4
    && o.a2025.join() === 'tr_1,tr_2' && o.a2026.join() === 'tr_3,tr_4' && o.a2024.join() === 'tr_6' && o.semData.join() === 'tr_5', o);
  o = await page.evaluate(async () => { const r = await partMigrar('treinos_list'); return r; });
  ok('2b) migrar de novo é inofensivo (já feito)', o.ok && o.jaFeito, o);

  // 3) reabrir: a lista volta inteira; gravar mexe só no ano certo
  o = await page.evaluate(async () => {
    treinos = []; await loadAll(); await espera(100);
    const o = { memoria: treinos.map(t => t.id).sort() };
    ctl.escritas.length = 0; treinos.push(tr('tr_8', '2026-08-08')); const g = await storeSet('treinos_list', treinos);
    o.g = g; o.escritas = ctl.escritas.filter(k => /treinos/.test(k)); o.a2026 = ids('treinos_2026'); o.a2025 = ids('treinos_2025'); o.legadoIgual = ids('treinos_list').length; return o; });
  ok('3) reabrir junta os anos; salvar grava só treinos_2026', o.memoria.join() === 'tr_1,tr_2,tr_3,tr_4,tr_5,tr_6' && o.g && o.escritas.join() === 'treinos_2026' && o.a2026.join() === 'tr_3,tr_4,tr_8' && o.legadoIgual === 6, o);

  // 4) editar a data para outro ano; excluir o último de um ano
  o = await page.evaluate(async () => {
    ctl.escritas.length = 0;
    const t = treinos.find(x => x.id === 'tr_4'); t.data = '2027-02-02'; await storeSet('treinos_list', treinos);
    const o = { a2026: ids('treinos_2026'), a2027: ids('treinos_2027'), indice: val('treinos_indice').docs.slice(), escritas: ctl.escritas.slice() };
    treinos = treinos.filter(x => x.id !== 'tr_6'); await storeSet('treinos_list', treinos, true);
    o.a2024 = val('treinos_2024'); return o; });
  ok('4) mudar o ano cria treinos_2027 e atualiza o recibo; excluir o último deixa o ano vazio', o.a2026.join() === 'tr_3,tr_8' && o.a2027.join() === 'tr_4' && o.indice.includes('treinos_2027') && o.a2024.length === 0, o);

  // 5) dois aparelhos: o outro gravou algo no mesmo ano; a nossa gravação não apaga
  o = await page.evaluate(async () => {
    const outro = val('treinos_2026').concat([tr('tr_outro', '2026-09-09')]); put('treinos_2026', outro);
    treinos.push(tr('tr_meu', '2026-10-10')); await storeSet('treinos_list', treinos);
    return { a2026: ids('treinos_2026'), mem: treinos.some(t => t.id === 'tr_outro') }; });
  ok('5) gravação junta o que outro aparelho fez no mesmo ano', o.a2026.includes('tr_outro') && o.a2026.includes('tr_meu') && o.mem, o);

  // 6) falha de leitura de UM ano: nada é gravado e nada some
  o = await page.evaluate(async () => {
    const antes = JSON.stringify([...banco.entries()]);
    ctl.falhaLer.add('treinos_2025'); alerts.length = 0; treinos = [];
    await loadAll(); await espera(100);
    const o = { memoriaVazia: treinos.length === 0, modoDepois: partEstado.treinos_list.modo };
    treinos.push(tr('tr_x', '2026-11-11')); ctl.escritas.length = 0; const g = await storeSet('treinos_list', treinos);
    o.g = g; o.escritas = ctl.escritas.filter(k => /treinos/.test(k)); o.bancoIgual = JSON.stringify([...banco.entries()]) === antes; o.avisou = alerts.length > 0;
    ctl.falhaLer.clear(); return o; });
  ok('6) ano ilegível: leitura falha, gravação é recusada e o banco fica intacto', o.memoriaVazia && o.g === false && o.escritas.length === 0 && o.bancoIgual && o.avisou, o);

  // 7) lista vazia sem confirmação não apaga
  o = await page.evaluate(async () => {
    await loadAll(); await espera(100); const n = treinos.length; alerts.length = 0;
    const g = await partGravar('treinos_list', [], false); return { g, n, bloqueou: alerts.some(a => /bloqueada/.test(a)), ainda: val('treinos_2026').length }; });
  ok('7) gravar lista vazia sem querer é bloqueado', o.g === false && o.bloqueou && o.ainda > 0, o);

  // 8) reversão
  o = await page.evaluate(async () => {
    await loadAll(); await espera(100);
    const r = await partReverter('treinos_list');
    const o = { r, modo: partEstado.treinos_list.modo, legado: ids('treinos_list'), recibo: val('treinos_indice'), docsMantidos: !!val('treinos_2026') };
    treinos = []; await loadAll(); await espera(100); o.memoria = treinos.length; o.revertido = partEstado.treinos_list.revertido;
    partMigrarEmSegundoPlano(); await espera(300); o.naoMigrouSozinho = val('treinos_indice').versao === 0; return o; });
  ok('8) reversão junta tudo no documento único, mantém os anos como cópia e não migra sozinha de novo', o.r.ok && o.modo === 'legado' && o.legado.includes('tr_meu') && o.legado.includes('tr_outro') && o.recibo.versao === 0 && o.docsMantidos && o.memoria === o.legado.length && o.revertido && o.naoMigrouSozinho, o);

  // 9) migração a partir de documento com treino sem id e com app antigo gravando durante a migração
  o = await page.evaluate(async () => {
    semear(); const l = val('treinos_list'); l.push({ data: '2026-03-03', tipo: 'Sem id', animais: [] }); put('treinos_list', l);
    await loadAll(); partEstado.treinos_list.revertido = false;
    const orig = partGravarBruto; let jaMexeu = false;
    window.partGravarBruto = async (d, v) => { await orig(d, v); if (!jaMexeu && d === 'treinos_indice') { jaMexeu = true; const x = val('treinos_list'); x.push(tr('tr_tarde', '2026-04-04')); put('treinos_list', x); } };
    const r = await partMigrar('treinos_list'); window.partGravarBruto = orig;
    return { r, a2026: ids('treinos_2026'), semId: (val('treinos_2026') || []).some(x => /^trn_mig_/.test(x.id)) }; });
  ok('9) treino sem id ganha id e o que o app antigo gravou no meio da migração é recuperado', o.r.ok && o.a2026.includes('tr_tarde') && o.semId, o);

  console.log('\nErros de JavaScript na página:', JSON.stringify(errs));
  console.log(`\n${total - falhas} passaram, ${falhas} falharam`);
  await b.close(); process.exit(falhas || errs.length ? 1 : 0);
})();
