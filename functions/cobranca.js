/* Cobrança MANUAL dos clientes (etapa 5, versão 1): o dono cobra por Pix/boleto/transferência fora do sistema e REGISTRA aqui.
   - clientes/{id}: mensalidadeCentavos, diaVencimento (1-28), inicioCobranca (AAAA-MM-DD), obsCobranca;
   - clientes/{id}/pagamentos/{AAAA-MM}: um pagamento por competência (mês). Registrar de novo a mesma competência corrige o valor.
   Nada cobra de ninguém automaticamente e nada bloqueia sozinho: o painel mostra quem está em dia, a vencer (5 dias) ou atrasado,
   e o dono decide (botão Bloquear). Sem mensalidade definida = "sem cobrança" (ex.: plano gratuito). */
const { HttpsError } = require('firebase-functions/v2/https');

const RE_COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const FORMAS = ['pix', 'boleto', 'transferencia', 'cartao', 'dinheiro', 'outro'];
const MAX_MENSALIDADE_CENTAVOS = 100000000; // R$ 1.000.000,00
const DIAS_AVISO = 5;

const dataValida = (s) => { if (typeof s !== 'string' || !RE_DATA.test(s)) return false; const d = new Date(s + 'T00:00:00Z'); return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; };
function hojeSaoPaulo(agora = new Date()){ return agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); }
const dias = (a, b) => Math.round((Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)) - Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))) / 86400000);
function somaMes(ym, n){ const t = +ym.slice(0, 4) * 12 + (+ym.slice(5, 7) - 1) + n; return String(Math.floor(t / 12)).padStart(4, '0') + '-' + String(t % 12 + 1).padStart(2, '0'); }

/* Função pura: situação de cobrança de um cliente. `pagas` = Set de competências (AAAA-MM) já pagas. */
function situacaoDeCobranca(cfg, pagas, hoje){
  if (!cfg || !(cfg.mensalidadeCentavos > 0) || !(cfg.diaVencimento >= 1 && cfg.diaVencimento <= 28) || !dataValida(cfg.inicioCobranca))
    return { situacao: 'sem_cobranca' };
  const dd = String(cfg.diaVencimento).padStart(2, '0');
  let comp = cfg.inicioCobranca.slice(0, 7);
  if (comp + '-' + dd < cfg.inicioCobranca) comp = somaMes(comp, 1); // 1º vencimento é o primeiro que cai a partir do início
  const limite = somaMes(hoje.slice(0, 7), 1);
  for (; comp <= limite; comp = somaMes(comp, 1)) {
    if (pagas.has(comp)) continue;
    const venc = comp + '-' + dd;
    if (venc < hoje) return { situacao: 'atrasado', diasAtraso: dias(hoje, venc), competenciaEmAberto: comp, vencimento: venc };
    const d = dias(venc, hoje);
    return { situacao: d <= DIAS_AVISO ? 'vence_em_breve' : 'em_dia', diasParaVencer: d, competenciaEmAberto: comp, vencimento: venc };
  }
  return { situacao: 'em_dia' };
}

function exigirCliente(tenantId){
  if (typeof tenantId !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/.test(tenantId)) throw new HttpsError('invalid-argument', 'Código do cliente inválido.');
  return tenantId;
}
async function clienteExiste(db, tenantId){
  if (!(await db.collection('clientes').doc(tenantId).get()).exists) throw new HttpsError('not-found', 'Cliente não encontrado.');
}

async function registrarPagamento({ db, emailDono }, data){
  const tenantId = exigirCliente(data.tenantId);
  if (typeof data.competencia !== 'string' || !RE_COMPETENCIA.test(data.competencia)) throw new HttpsError('invalid-argument', 'Competência inválida (use AAAA-MM).');
  if (!Number.isInteger(data.valorCentavos) || data.valorCentavos < 0 || data.valorCentavos > MAX_MENSALIDADE_CENTAVOS) throw new HttpsError('invalid-argument', 'Valor inválido.');
  if (!dataValida(data.pagoEm)) throw new HttpsError('invalid-argument', 'Data do pagamento inválida (AAAA-MM-DD).');
  const forma = data.forma === undefined || data.forma === '' ? 'outro' : data.forma;
  if (!FORMAS.includes(forma)) throw new HttpsError('invalid-argument', 'Forma de pagamento inválida.');
  const obs = typeof data.obs === 'string' ? data.obs.trim().slice(0, 300) : '';
  await clienteExiste(db, tenantId);
  const reg = { competencia: data.competencia, valorCentavos: data.valorCentavos, pagoEm: data.pagoEm, forma, obs,
    registradoPor: typeof emailDono === 'string' ? emailDono : '', registradoEm: new Date().toISOString() };
  await db.doc(`clientes/${tenantId}/pagamentos/${data.competencia}`).set(reg);
  return { tenantId, ...reg };
}

async function excluirPagamento({ db }, data){
  const tenantId = exigirCliente(data.tenantId);
  if (typeof data.competencia !== 'string' || !RE_COMPETENCIA.test(data.competencia)) throw new HttpsError('invalid-argument', 'Competência inválida (use AAAA-MM).');
  await clienteExiste(db, tenantId);
  const ref = db.doc(`clientes/${tenantId}/pagamentos/${data.competencia}`);
  if (!(await ref.get()).exists) throw new HttpsError('not-found', 'Pagamento não encontrado.');
  await ref.delete();
  return { tenantId, competencia: data.competencia, excluido: true };
}

async function listarPagamentos({ db }, data){
  const tenantId = exigirCliente(data.tenantId);
  await clienteExiste(db, tenantId);
  const snap = await db.collection(`clientes/${tenantId}/pagamentos`).get();
  const pagamentos = snap.docs.map(d => d.data()).sort((a, b) => b.competencia.localeCompare(a.competencia));
  return { tenantId, pagamentos };
}

/* Pagamentos de TODOS os clientes numa leitura só (para a lista do painel). Devolve Map(tenantId -> [pagamentos]). */
async function pagamentosPorCliente(db){
  const mapa = new Map();
  try {
    const snap = await db.collectionGroup('pagamentos').get();
    snap.docs.forEach(d => {
      const tid = d.ref && d.ref.parent && d.ref.parent.parent ? d.ref.parent.parent.id : null;
      if (!tid) return;
      if (!mapa.has(tid)) mapa.set(tid, []);
      mapa.get(tid).push(d.data());
    });
  } catch (e) { /* sem pagamentos legíveis: a lista segue sem situação de cobrança */ }
  return mapa;
}

/* Resumo de cobrança de um cliente a partir do documento dele e dos pagamentos. */
function resumoDeCobranca(d, pagamentos, hoje){
  const cfg = { mensalidadeCentavos: Number.isInteger(d.mensalidadeCentavos) ? d.mensalidadeCentavos : null,
    diaVencimento: Number.isInteger(d.diaVencimento) ? d.diaVencimento : null,
    inicioCobranca: typeof d.inicioCobranca === 'string' ? d.inicioCobranca : null };
  const lista = pagamentos || [];
  const pagas = new Set(lista.map(p => p.competencia));
  const mesAtual = hoje.slice(0, 7);
  const pagoNoMes = lista.filter(p => typeof p.pagoEm === 'string' && p.pagoEm.slice(0, 7) === mesAtual).reduce((s, p) => s + (p.valorCentavos || 0), 0);
  return { ...cfg, obs: typeof d.obsCobranca === 'string' ? d.obsCobranca : '', ...situacaoDeCobranca(cfg, pagas, hoje), pagoNoMesCentavos: pagoNoMes, pagamentos: lista.length };
}

module.exports = { RE_COMPETENCIA, FORMAS, MAX_MENSALIDADE_CENTAVOS, dataValida, hojeSaoPaulo, situacaoDeCobranca, registrarPagamento, excluirPagamento,
  listarPagamentos, pagamentosPorCliente, resumoDeCobranca };
