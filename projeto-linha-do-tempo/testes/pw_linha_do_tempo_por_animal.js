/* Testes (Playwright/Chromium) da divisão da Linha do Tempo por animal — protótipo_app_preview.html.
   Rodar:  node firebase/pw_linha_do_tempo_por_animal.js [caminho-do-html]
   Usa o armazenamento local do navegador (mesmo caminho do app sem Firebase) e, onde precisa simular o
   Firestore (falha de leitura/offline), um "db" de mentira em memória. Nenhuma rede é usada. */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const ARQ = process.argv[2] || path.resolve(__dirname, '..', 'protótipo_app_preview.html');

const resultados = [];
const ok = (nome, cond, extra) => { resultados.push({ nome, ok: !!cond, extra }); console.log((cond ? 'OK    ' : 'FALHA ') + nome + (cond ? '' : '  -> ' + JSON.stringify(extra))); };

// Funções auxiliares dentro da página
function setup() {
  document.querySelectorAll('[id*=ogin]').forEach(e => { if (getComputedStyle(e).position === 'fixed') e.style.display = 'none'; });
  document.getElementById('appRoot').style.display = '';
  window.alerts = []; window.showAlert = m => alerts.push(String(m)); window.showConfirm = async () => true;
  window.L = k => { const r = localStorage.getItem(LS_PREFIX + k); return r === null ? null : JSON.parse(r); };
  window.P = (k, v) => localStorage.setItem(LS_PREFIX + k, JSON.stringify(v));
  window.RAW = k => localStorage.getItem(LS_PREFIX + k);
  window.leituras = [];
  const orig = window.storeGet; window.storeGet = async k => { leituras.push(k); return orig(k); };
  window.reg = (id, animalId, extra) => Object.assign({ id, animalId, animalNome: 'Animal ' + animalId, data: '2026-02-01', peso: '', scoreCorporal: '', fotoDataUrl: '', fotoMiniUrl: '', obs: '' }, extra || {});
  window.espera = ms => new Promise(r => setTimeout(r, ms));
  window.semRuido = () => alerts.filter(a => !/Nutrimax/.test(a));
  window.semear = (horsesArr, regs) => { localStorage.clear(); P('horses_list', horsesArr); if (regs) P('animal_registros_list', regs); };
  window.H = [{ id: 'h_1', nome: 'Alfa', sexo: 'FEMININO' }, { id: 'h_2', nome: 'Beta', sexo: 'MASCULINO' }, { id: 'h_3', nome: 'Gama', sexo: 'FEMININO' }];
  window.B64 = (() => { const c = document.createElement('canvas'); c.width = 60; c.height = 40; const x = c.getContext('2d'); x.fillStyle = '#c33'; x.fillRect(0, 0, 60, 40); return c.toDataURL('image/jpeg', 0.7); })();
  window.URLFOTO = n => 'https://firebasestorage.googleapis.com/v0/b/x/o/animais%2Fh_1%2Ffoto' + n + '.jpg?alt=media&token=abcdef0123456789';
}

const testes = {};

testes['1) Migração do documento único para um por animal'] = async () => {
  semear(H, [
    reg('areg_1700000000001_a', 'h_1', { peso: '400' }), reg('areg_1700000000002_b', 'h_1', { fotoDataUrl: URLFOTO(1) }),
    reg('areg_1700000000003_c', 'h_2', { scoreCorporal: '5' }), reg('areg_1700000000004_d', 'h_apagado', { peso: '300' }),
    { animalId: 'h_3', data: '2026-01-01', peso: '350' },            // sem id
    { id: 'areg_1700000000005_e', data: '2026-01-01', peso: '1' }    // sem animalId
  ]);
  const antes = RAW('animal_registros_list');
  await loadAll(); await espera(600);
  const o = { modo: aregModo, antesIgualDepois: RAW('animal_registros_list') === antes, recibo: L('areg_indice') };
  o.h1 = (L('areg_h_1') || []).map(r => r.id); o.h2 = (L('areg_h_2') || []).map(r => r.id); o.h3 = (L('areg_h_3') || []).map(r => r.id);
  o.orfao = (L('areg_h_apagado') || []).map(r => r.id); o.semAnimal = (L('areg___sem_animal__') || []).map(r => r.id);
  o.memoria = animalRegistros.length; o.alertas = semRuido();
  return o;
};

testes['2) Leitura sob demanda (abertura não baixa registros; ficha lê só o animal)'] = async () => {
  semear(H, [reg('areg_1700000000001_a', 'h_1', { peso: '400' }), reg('areg_1700000000002_b', 'h_1', { fotoDataUrl: URLFOTO(1) }), reg('areg_1700000000003_c', 'h_2', { peso: '300' })]);
  await loadAll(); await espera(600);               // 1ª abertura: migra
  leituras.length = 0; await loadAll(); await espera(100); // 2ª abertura: já migrado
  const o = { modo: aregModo, leiturasAbertura: leituras.filter(k => /^areg_|animal_registros/.test(k)), memoriaAbertura: animalRegistros.length };
  leituras.length = 0;
  ltvPeriodoPreset = 'tudo';
  await abrirLinhaDoTempoVisual(horses.find(h => h.id === 'h_1'));
  o.leiturasFicha = leituras.slice(); o.memoriaFicha = animalRegistros.map(r => r.id);
  o.fotosNoGrafico = document.querySelectorAll('#ltvCorpo [data-ltvfoto]').length;
  leituras.length = 0; await abrirLinhaDoTempoVisual(horses.find(h => h.id === 'h_1')); o.leiturasSegundaAbertura = leituras.slice();
  return o;
};

testes['3) Adicionar, editar e excluir registro (documento do animal)'] = async () => {
  semear(H, [reg('areg_1700000000001_a', 'h_1', { peso: '400' }), reg('areg_1700000000003_c', 'h_2', { peso: '300' })]);
  await loadAll(); await espera(600); await loadAll();
  const h1 = horses.find(h => h.id === 'h_1'); await abrirLinhaDoTempoVisual(h1);
  const legado = RAW('animal_registros_list'); const docH2 = RAW('areg_h_2');
  const o = {};
  // adicionar
  abrirAnimalRegistroForm(); document.getElementById('ar_data').value = '2026-03-10'; document.getElementById('ar_peso').value = '410'; document.getElementById('ar_obs').value = 'novo';
  document.getElementById('btnArSalvar').click(); await espera(500);
  o.apos_add = L('areg_h_1').map(r => r.peso + '|' + r.obs);
  // editar (mesmo id, novo peso)
  const novo = animalRegistros.find(r => r.obs === 'novo'); editingAnimalRegistroId = novo.id;
  document.getElementById('ar_data').value = '2026-03-10'; document.getElementById('ar_peso').value = '415'; document.getElementById('ar_obs').value = 'novo';
  document.getElementById('btnArSalvar').click(); await espera(500);
  o.apos_edit = L('areg_h_1').map(r => r.peso + '|' + r.obs);
  // excluir
  editingAnimalRegistroId = novo.id; document.getElementById('btnArExcluir').click(); await espera(500);
  o.apos_del = L('areg_h_1').map(r => r.peso);
  // excluir o último registro do animal (lista vazia precisa gravar mesmo assim)
  editingAnimalRegistroId = 'areg_1700000000001_a'; document.getElementById('btnArExcluir').click(); await espera(500);
  o.apos_del_ultimo = L('areg_h_1');
  o.legadoIntacto = RAW('animal_registros_list') === legado; o.h2Intacto = RAW('areg_h_2') === docH2;
  o.auditoria = auditoria.filter(a => a.modulo === 'Animais').map(a => a.acao);
  o.alertas = semRuido();
  return o;
};

testes['4) Auto-registro ao trocar a foto no cadastro'] = async () => {
  semear(H, [reg('areg_1700000000001_a', 'h_1', { peso: '400' })]);
  await loadAll(); await espera(600); await loadAll();
  openHorseEdit('h_1');
  document.getElementById('f_fotoUrl').value = URLFOTO(7);
  document.getElementById('horseForm').requestSubmit(); await espera(1500);
  const doc = L('areg_h_1') || [];
  return { total: doc.length, fotos: doc.filter(r => r.fotoDataUrl === URLFOTO(7)).length, outroAnimal: L('areg_h_2'), legadoIntacto: L('animal_registros_list').length === 1, alertas: semRuido() };
};

testes['5) Fusão entre aparelhos (outro aparelho grava no mesmo animal)'] = async () => {
  semear(H, [reg('areg_1700000000001_a', 'h_1', { peso: '400' }), reg('areg_1700000000002_b', 'h_1', { peso: '401' })]);
  await loadAll(); await espera(600); await loadAll();
  const h1 = horses.find(h => h.id === 'h_1'); await abrirLinhaDoTempoVisual(h1);   // aparelho A tem o animal em cache
  // aparelho B: inclui um registro, edita o 'a' e exclui o 'b' direto no banco
  P('areg_h_1', [reg('areg_1700000000001_a', 'h_1', { peso: '999' }), reg('areg_1800000000000_B', 'h_1', { peso: '777' })]);
  // aparelho A: inclui o seu
  abrirAnimalRegistroForm(); document.getElementById('ar_peso').value = '123'; document.getElementById('btnArSalvar').click(); await espera(600);
  const doc = L('areg_h_1');
  return { noBanco: doc.map(r => r.id.slice(-2) + ':' + r.peso).sort(), naMemoriaDeA: registrosDoAnimal('h_1').map(r => r.id.slice(-2) + ':' + r.peso).sort() };
};

testes['6) Backup (exportar traz TUDO) e importação'] = async () => {
  semear(H, [reg('areg_1700000000001_a', 'h_1', { peso: '400' }), reg('areg_1700000000002_b', 'h_2', { peso: '300' }), reg('areg_1700000000003_c', 'h_3', { peso: '200' })]);
  await loadAll(); await espera(600); await loadAll();
  const o = { memoriaAntes: animalRegistros.length };
  window.showDirectoryPicker = undefined; let capturado = null; const orig = URL.createObjectURL; URL.createObjectURL = b => { capturado = b; return 'blob:fake'; };
  HTMLAnchorElement.prototype.click = function () {};
  document.getElementById('btnExportBackup').click(); await espera(1200);
  URL.createObjectURL = orig;
  const bk = JSON.parse(await capturado.text());
  o.backupIds = bk.animalRegistros.map(r => r.id.slice(-1)).sort();
  // importar: um registro já existente (não duplica), um novo no h_2 e um novo no h_3
  const arq = { horses: [], animalRegistros: [reg('areg_1700000000002_b', 'h_2', { peso: '300' }), reg('areg_1700000000009_n', 'h_2', { peso: '310' }), reg('areg_1700000000008_m', 'h_3', { peso: '210' })] };
  const f = new File([JSON.stringify(arq)], 'bk.json', { type: 'application/json' });
  const dt = new DataTransfer(); dt.items.add(f); const inp = document.getElementById('importBackupFile'); inp.files = dt.files; inp.dispatchEvent(new Event('change'));
  await espera(1500);
  o.h2 = L('areg_h_2').map(r => r.id.slice(-1)).sort(); o.h3 = L('areg_h_3').map(r => r.id.slice(-1)).sort(); o.h1 = L('areg_h_1').map(r => r.id.slice(-1));
  o.alertas = semRuido();
  // backup que NÃO pode ser completo (leitura falha) não é gerado
  const origGet = window.storeGet; window.storeGet = async k => /^areg_h_/.test(k) ? { ok: false, value: [] } : origGet(k);
  aregCarregados.clear(); animalRegistros = []; capturado = null; alerts.length = 0; URL.createObjectURL = b => { capturado = b; return 'blob:fake'; };
  document.getElementById('btnExportBackup').click(); await espera(800);
  o.backupIncompletoBloqueado = capturado === null && alerts.some(a => /NÃO foi gerado/.test(a));
  window.storeGet = origGet;
  return o;
};

testes['7) Falha de leitura não apaga dados (Firestore de mentira)'] = async () => {
  // Firestore falso em memória, com interruptor de falha
  const banco = new Map(); const ctl = { falhaLer: new Set(), falhaTudo: false, escritas: [] };
  window.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'TS' } } };
  db = { collection: () => ({ doc: k => ({
    get: async () => { if (ctl.falhaTudo || ctl.falhaLer.has(k)) throw new Error('unavailable'); const v = banco.get(k); return { exists: v !== undefined, data: () => v }; },
    set: async d => { if (ctl.falhaTudo) throw new Error('unavailable'); ctl.escritas.push(k); banco.set(k, { value: JSON.parse(JSON.stringify(d.value)) }); },
    delete: async () => { banco.delete(k); } }) }) };
  HAS_FIRESTORE = true;
  const put = (k, v) => banco.set(k, { value: JSON.parse(JSON.stringify(v)) });
  put('horses_list', H); put('animal_registros_list', [reg('areg_1700000000001_a', 'h_1', { peso: '400' }), reg('areg_1700000000003_c', 'h_2', { peso: '300' })]);
  const o = {};
  // (a) migração com falha de leitura no meio: nada de recibo, original intacto, continua no modo antigo
  const legado = JSON.stringify(banco.get('animal_registros_list'));
  ctl.falhaLer.add('areg_h_2');
  await loadAll(); await espera(5500);
  o.a_modo = aregModo; o.a_recibo = banco.has('areg_indice'); o.a_legadoIntacto = JSON.stringify(banco.get('animal_registros_list')) === legado;
  o.a_memoriaLegado = animalRegistros.length;
  // (b) volta a rede: migra
  ctl.falhaLer.clear(); const rm = await aregMigrar(); o.b_migrou = rm.ok; o.b_modo = aregModo;
  // (c) reabre; leitura do animal falha ao abrir a ficha: nada some, alerta, e salvar é recusado
  await loadAll(); await espera(100);
  ctl.falhaLer.add('areg_h_1'); alerts.length = 0;
  const h1 = horses.find(h => h.id === 'h_1'); await abrirLinhaDoTempoVisual(h1);
  o.c_alerta = alerts.some(a => /Não consegui ler os registros/.test(a)); o.c_carregado = aregCarregados.has('areg_h_1');
  const docAntes = JSON.stringify(banco.get('areg_h_1')); ctl.escritas.length = 0; alerts.length = 0;
  abrirAnimalRegistroForm(); document.getElementById('ar_peso').value = '555'; document.getElementById('btnArSalvar').click(); await espera(6000);
  o.c_docIntacto = JSON.stringify(banco.get('areg_h_1')) === docAntes; o.c_escritasNoAnimal = ctl.escritas.filter(k => k === 'areg_h_1').length; o.c_avisou = alerts.some(a => /NÃO salvei|Não consegui conferir/.test(a));
  // (d) leitura do recibo falha na abertura: nada de registros é gravado
  ctl.falhaLer.clear(); ctl.falhaLer.add('areg_indice');
  await loadAll(); await espera(100);
  o.d_modo = aregModo; ctl.escritas.length = 0; alerts.length = 0;
  const r = aregAdicionar([reg('areg_1800000000000_z', 'h_1', { peso: '1' })]); await r;
  o.d_escritas = ctl.escritas.filter(k => /areg_|animal_registros/.test(k)).length; o.d_avisou = alerts.some(a => /Recarregue a página/.test(a));
  return o;
};

testes['8) Reversão para o documento único'] = async () => {
  semear(H, [reg('areg_1700000000001_a', 'h_1', { peso: '400' }), reg('areg_1700000000002_b', 'h_1', { peso: '401' }), reg('areg_1700000000003_c', 'h_2', { peso: '300' })]);
  await loadAll(); await espera(600); await loadAll();
  const o = {};
  // no formato novo: inclui um registro e exclui outro
  await abrirLinhaDoTempoVisual(horses.find(h => h.id === 'h_1'));
  abrirAnimalRegistroForm(); document.getElementById('ar_peso').value = '450'; document.getElementById('btnArSalvar').click(); await espera(500);
  editingAnimalRegistroId = 'areg_1700000000002_b'; document.getElementById('btnArExcluir').click(); await espera(500);
  const r = await aregReverter(); o.reverteu = r;
  o.modo = aregModo; o.legado = L('animal_registros_list').map(x => x.peso).sort(); o.recibo = L('areg_indice');
  o.docsPorAnimalMantidos = !!L('areg_h_1') && !!L('areg_h_2');
  // reabrir: fica no formato antigo e NÃO migra sozinho
  await loadAll(); await espera(800); o.modoReaberto = aregModo; o.memoriaReaberta = animalRegistros.length; o.reciboAindaRevertido = !!(L('areg_indice') || {}).revertidoEm;
  // migrar de novo (botão) funciona
  const r2 = await aregMigrar({ forcar: true }); o.remigrou = r2.ok; o.modoDepois = aregModo;
  return o;
};

testes['9) Registros criados pelo app antigo depois da migração (ressincronizar)'] = async () => {
  semear(H, [reg('areg_1700000000001_a', 'h_1', { peso: '400' })]);
  await loadAll(); await espera(600); await loadAll();
  // app antigo (em uso) grava no documento único; id com data POSTERIOR à migração
  const novoId = 'areg_' + (Date.now() + 5000) + '_old';
  P('animal_registros_list', [reg('areg_1700000000001_a', 'h_1', { peso: '400' }), reg(novoId, 'h_1', { peso: '420' })]);
  const r = await aregRessincronizar();
  const r2 = await aregRessincronizar(); // idempotente
  return { adicionados: r.adicionados, adicionados2: r2.adicionados, doc: L('areg_h_1').map(x => x.peso).sort() };
};

testes['10) Limite: documento único estourado vira documentos pequenos; animal gigante recusa migrar'] = async () => {
  const gordo = n => reg('areg_17000000' + String(n).padStart(5, '0') + '_x', 'h_' + (1 + n % 4), { fotoDataUrl: URLFOTO(n), fotoMiniUrl: URLFOTO(n) + '&mini=1', obs: 'x'.repeat(250) });
  const H4 = [1, 2, 3, 4].map(i => ({ id: 'h_' + i, nome: 'A' + i, sexo: 'FEMININO' }));
  const regs = Array.from({ length: 1700 }, (_, n) => gordo(n));
  semear(H4, regs);
  const o = { tamanhoLegadoKB: Math.round(tamanhoDocBytes(regs) / 1024), limiteKB: LIMITE_DOC_BYTES / 1024 };
  await loadAll(); await espera(1500);
  o.modo = aregModo; o.maiorDocKB = Math.max(...[1, 2, 3, 4].map(i => Math.round(tamanhoDocBytes(L('areg_h_' + i)) / 1024)));
  o.totalNosDocs = [1, 2, 3, 4].reduce((s, i) => s + L('areg_h_' + i).length, 0);
  // continua gravando (antes: bloqueado por tamanho)
  await loadAll(); const h = horses.find(x => x.id === 'h_1'); await abrirLinhaDoTempoVisual(h);
  abrirAnimalRegistroForm(); document.getElementById('ar_peso').value = '500'; document.getElementById('btnArSalvar').click(); await espera(600);
  o.aposAdd = L('areg_h_1').length;
  // animal que sozinho passaria de 95% do documento: migração recusa e não mexe em nada
  const gigante = Array.from({ length: 1500 }, (_, n) => reg('areg_17000001' + String(n).padStart(5, '0') + '_g', 'h_1', { fotoDataUrl: URLFOTO(n), fotoMiniUrl: URLFOTO(n) + '&mini=1', obs: 'y'.repeat(300) }));
  semear(H4, gigante); const antes = RAW('animal_registros_list');
  await loadAll(); await espera(800);
  o.gigante = { modo: aregModo, semRecibo: L('areg_indice') === null, legadoIntacto: RAW('animal_registros_list') === antes, tamKB: Math.round(tamanhoDocBytes(gigante) / 1024) };
  return o;
};

testes['11) Mover fotos antigas (base64) para o Storage com registros por animal'] = async () => {
  semear(H, [reg('areg_1700000000001_a', 'h_1', { fotoDataUrl: window.B64 }), reg('areg_1700000000002_b', 'h_2', { fotoDataUrl: window.B64 }), reg('areg_1700000000003_c', 'h_3', { peso: '1' })]);
  await loadAll(); await espera(600); await loadAll();
  const o = { memoriaAntes: animalRegistros.length };
  const gravados = [];
  const fakeStorage = { setMaxUploadRetryTime() {}, setMaxOperationRetryTime() {}, ref: p => ({ put: async () => { gravados.push(p); }, getDownloadURL: async () => 'https://firebasestorage.googleapis.com/v0/b/x/o/' + encodeURIComponent(p) + '?alt=media&token=abc', delete: async () => {} }) };
  window.fotosNoStorageAtivo = () => true; window.carregarStorage = async () => fakeStorage; currentUser = { admin: true, nome: 'x' };
  document.getElementById('btnMigrarFotos').click(); await espera(3500);
  const d1 = L('areg_h_1'), d2 = L('areg_h_2'), d3 = L('areg_h_3');
  o.h1 = (d1[0].fotoDataUrl || '').slice(0, 8); o.h2 = (d2[0].fotoDataUrl || '').slice(0, 8); o.h3 = d3.length; o.mini = !!d1[0].fotoMiniUrl;
  o.status = document.getElementById('migrarFotosStatus').textContent; o.alertas = semRuido();
  return o;
};

testes['12) Edição em lote de peso cria registro no documento de cada animal'] = async () => {
  semear(H, [reg('areg_1700000000001_a', 'h_1', { peso: '400' })]);
  await loadAll(); await espera(600); await loadAll();
  selectedHorseIds = new Set(['h_1', 'h_2']);
  document.getElementById('el_chkPeso').checked = true; document.getElementById('el_peso').value = '480';
  document.getElementById('btnSalvarEditLote').click(); await espera(1200);
  return { h1: (L('areg_h_1') || []).map(r => r.peso), h2: (L('areg_h_2') || []).map(r => r.peso), h3: L('areg_h_3'), alertas: semRuido() };
};

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const out = {};
  for (const nome of Object.keys(testes)) {
    const pg = await b.newPage(); const errs = [];
    pg.on('pageerror', e => errs.push(e.message));
    await pg.route(/^https?:/, r => r.abort());
    await pg.goto('file://' + ARQ); await pg.waitForTimeout(1200);
    await pg.evaluate(setup);
    let r;
    try { r = await pg.evaluate('(' + testes[nome].toString() + ')()'); } catch (e) { r = { erro: e.message }; }
    out[nome] = { r, errs }; await pg.close();
  }
  await b.close();
  const J = x => JSON.stringify(x);
  let t;
  console.log('\n===== Saídas brutas =====');
  for (const n of Object.keys(out)) console.log(n + '\n' + JSON.stringify(out[n].r) + (out[n].errs.length ? '\nERROS DE PÁGINA: ' + J(out[n].errs) : ''));
  console.log('\n===== Verificações =====');
  t = out['1) Migração do documento único para um por animal'].r;
  ok('1 modo passou a porAnimal', t.modo === 'porAnimal', t.modo);
  ok('1 documento original byte a byte igual (não apagado/alterado)', t.antesIgualDepois, t.antesIgualDepois);
  ok('1 recibo gravado (versão 1, total 6)', t.recibo && t.recibo.versao === 1 && t.recibo.total === 6, t.recibo);
  ok('1 h_1 tem 2 registros, h_2 tem 1', J(t.h1) === J(['areg_1700000000001_a', 'areg_1700000000002_b']) && t.h2.length === 1, [t.h1, t.h2]);
  ok('1 registro sem id ganhou id e foi para o animal certo', t.h3.length === 1 && /^areg_mig_/.test(t.h3[0]), t.h3);
  ok('1 registro de animal já apagado (órfão) foi preservado', J(t.orfao) === J(['areg_1700000000004_d']), t.orfao);
  ok('1 registro sem animalId preservado em documento à parte', J(t.semAnimal) === J(['areg_1700000000005_e']), t.semAnimal);
  ok('1 memória não carrega registros (sob demanda)', t.memoria === 0, t.memoria);
  ok('1 nenhum alerta de erro', t.alertas.length === 0, t.alertas);

  t = out['2) Leitura sob demanda (abertura não baixa registros; ficha lê só o animal)'].r;
  ok('2 abertura já migrada não lê nenhum documento de registros (só o recibo)', J(t.leiturasAbertura) === J(['areg_indice']), t.leiturasAbertura);
  ok('2 memória vazia após abrir o app', t.memoriaAbertura === 0, t.memoriaAbertura);
  ok('2 ficha lê SÓ o documento do animal', J(t.leiturasFicha) === J(['areg_h_1']), t.leiturasFicha);
  ok('2 memória tem só os 2 registros do h_1', t.memoriaFicha.length === 2, t.memoriaFicha);
  ok('2 Linha do Tempo Visual desenha a foto', t.fotosNoGrafico === 1, t.fotosNoGrafico);
  ok('2 segunda abertura usa o cache (0 leituras)', t.leiturasSegundaAbertura.length === 0, t.leiturasSegundaAbertura);

  t = out['3) Adicionar, editar e excluir registro (documento do animal)'].r;
  ok('3 adicionar grava no documento do animal', J(t.apos_add) === J(['400|', '410|novo']), t.apos_add);
  ok('3 editar troca (não duplica)', J(t.apos_edit) === J(['400|', '415|novo']), t.apos_edit);
  ok('3 excluir remove', J(t.apos_del) === J(['400']), t.apos_del);
  ok('3 excluir o último deixa documento vazio (grava mesmo assim)', J(t.apos_del_ultimo) === J([]), t.apos_del_ultimo);
  ok('3 documento antigo e documento de outro animal intactos', t.legadoIntacto && t.h2Intacto, [t.legadoIntacto, t.h2Intacto]);
  ok('3 auditoria registrou inclusão, edição e exclusões', ['inclusao', 'edicao', 'exclusao', 'exclusao'].every((a, i) => t.auditoria[i] === a), t.auditoria);
  ok('3 sem alertas de erro', t.alertas.length === 0, t.alertas);

  t = out['4) Auto-registro ao trocar a foto no cadastro'].r;
  ok('4 foto nova criou 1 ponto datado no documento do animal', t.fotos === 1 && t.total === 2, t);
  ok('4 não mexeu em outro animal nem no documento antigo', t.outroAnimal === null && t.legadoIntacto, t);

  t = out['5) Fusão entre aparelhos (outro aparelho grava no mesmo animal)'].r;
  ok('5 banco: edição e inclusão do aparelho B + inclusão do A (B excluiu o "b": continua excluído)', J(t.noBanco) === J(['_B:777', '_a:999', 'ro:123'].sort()) || (t.noBanco.length === 3 && t.noBanco.some(x => /:123$/.test(x)) && t.noBanco.some(x => /:777$/.test(x)) && t.noBanco.some(x => /:999$/.test(x))), t.noBanco);
  ok('5 memória do aparelho A passou a refletir o que B gravou', t.naMemoriaDeA.length === 3 && t.naMemoriaDeA.some(x => /:777$/.test(x)), t.naMemoriaDeA);

  t = out['6) Backup (exportar traz TUDO) e importação'].r;
  ok('6 abertura não tinha registros em memória (formato novo)', t.memoriaAntes === 0, t.memoriaAntes);
  ok('6 backup exportado traz os registros de TODOS os animais', J(t.backupIds) === J(['a', 'b', 'c']), t.backupIds);
  ok('6 importação soma só o que falta (sem duplicar) no animal certo', J(t.h2) === J(['b', 'n']) && J(t.h3) === J(['c', 'm']) && J(t.h1) === J(['a']), [t.h1, t.h2, t.h3]);
  ok('6 backup incompleto (leitura falhou) NÃO é gerado', t.backupIncompletoBloqueado, t.backupIncompletoBloqueado);

  t = out['7) Falha de leitura não apaga dados (Firestore de mentira)'].r;
  ok('7a migração com falha de leitura: sem recibo, original intacto, continua no formato antigo', t.a_modo === 'legado' && t.a_recibo === false && t.a_legadoIntacto && t.a_memoriaLegado === 2, t);
  ok('7b com a rede de volta, migra', t.b_migrou && t.b_modo === 'porAnimal', t);
  ok('7c ficha com leitura falha: avisa, não marca como carregado', t.c_alerta && t.c_carregado === false, t);
  ok('7c salvar com leitura falha é recusado: documento do animal intacto, 0 gravações, avisou', t.c_docIntacto && t.c_escritasNoAnimal === 0 && t.c_avisou, t);
  ok('7d recibo ilegível na abertura: modo indefinido, nada gravado, pede recarregar', t.d_modo === 'indefinido' && t.d_escritas === 0 && t.d_avisou, t);

  t = out['8) Reversão para o documento único'].r;
  ok('8 reversão ok', t.reverteu && t.reverteu.ok, t.reverteu);
  ok('8 documento único = estado atual (inclusão entra, exclusão não ressuscita)', J(t.legado) === J(['300', '400', '450']), t.legado);
  ok('8 recibo virou marcador "revertido" e documentos por animal ficaram como cópia', t.recibo && t.recibo.versao === 0 && !!t.recibo.revertidoEm && t.docsPorAnimalMantidos, t.recibo);
  ok('8 reabrir: formato antigo, tudo na memória, não migra sozinho', t.modoReaberto === 'legado' && t.memoriaReaberta === 3 && t.reciboAindaRevertido, t);
  ok('8 migrar de novo pelo botão funciona', t.remigrou && t.modoDepois === 'porAnimal', t);

  t = out['9) Registros criados pelo app antigo depois da migração (ressincronizar)'].r;
  ok('9 traz o registro novo do app antigo, 1x só (idempotente)', t.adicionados === 1 && t.adicionados2 === 0 && J(t.doc) === J(['400', '420']), t);

  t = out['10) Limite: documento único estourado vira documentos pequenos; animal gigante recusa migrar'].r;
  ok('10 documento único original passava de 1 MiB', t.tamanhoLegadoKB > t.limiteKB, [t.tamanhoLegadoKB, t.limiteKB]);
  ok('10 migrou: todos os 1700 registros nos documentos por animal, cada um bem abaixo do limite', t.modo === 'porAnimal' && t.totalNosDocs === 1700 && t.maiorDocKB < t.limiteKB * 0.5, t);
  ok('10 continua gravando depois', t.aposAdd === 426, t.aposAdd);
  ok('10 animal que sozinho estoura: recusa migrar, nada alterado, formato antigo', t.gigante.modo === 'legado' && t.gigante.semRecibo && t.gigante.legadoIntacto, t.gigante);
  t = out['11) Mover fotos antigas (base64) para o Storage com registros por animal'].r;
  ok('11 fotos antigas de animais diferentes foram para o Storage, cada uma no documento do seu animal', t.h1 === 'https://' && t.h2 === 'https://' && t.h3 === 1 && t.mini, t);
  ok('11 sem erro e status informou a quantidade', t.alertas.length === 0 && /2 da linha do tempo/.test(t.status), [t.alertas, t.status]);
  t = out['12) Edição em lote de peso cria registro no documento de cada animal'].r;
  ok('12 lote: h_1 ganhou o 2º registro, h_2 criou o documento dele, h_3 intocado', t.h1.length === 2 && t.h1.includes('480') && J(t.h2) === J(['480']) && t.h3 === null, t);
  for (const n of Object.keys(out)) ok('sem erro de JavaScript na página: ' + n.slice(0, 2), out[n].errs.length === 0 && !out[n].r.erro, [out[n].errs, out[n].r.erro]);
  const f = resultados.filter(x => !x.ok).length;
  console.log('\n' + (resultados.length - f) + ' passaram, ' + f + ' falharam');
  process.exit(f ? 1 : 0);
})();
