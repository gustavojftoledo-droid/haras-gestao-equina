/**
 * Cálculo das pendências do haras (o que está por fazer) e do que foi feito num dia — portado do
 * app_145.html (computeProgramacao / computeCalendarTasks / gerarDosesTratamento / situacaoEstoque).
 * Tudo aqui é FUNÇÃO PURA: recebe as listas do Firestore + a data "hoje", devolve dados. Quem busca
 * do Firestore e manda no Telegram é o cron.ts.
 *
 * ⚠️ Essas regras vivem também no app (app_145.html). Mudou lá, tem que mudar aqui — mesma dívida
 * que domain.ts já tem com montarAnimal/montarManejo.
 */

// ---- datas (o Worker não tem fuso; "hoje" sempre vem de fora, já em horário de Brasília) ----
export function addDias(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + Number(n));
  return d.toISOString().slice(0, 10);
}
export function addMeses(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + Number(n));
  return d.toISOString().slice(0, 10);
}
export function diffDias(aIso: string, bIso: string): number {
  return Math.round(
    (new Date(aIso + "T00:00:00Z").getTime() - new Date(bIso + "T00:00:00Z").getTime()) / 86400000,
  );
}
export function fmtBR(iso: string): string {
  const m = (iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso || "—";
}

// ---- Programação de manejos (Casco / Dente / Vacina / Vermífugo) ----
const FREQ_FIELD: Record<string, string> = {
  Casco: "freqcasco",
  Dente: "freqdente",
  Vermífugo: "freqvermifugo",
};

function freqDinamicaCasco(subtipo: string | null | undefined, config: any): number | null {
  if (!subtipo) return null;
  if (/ferrad/i.test(subtipo)) return Number(config?.freqFerrageamento) || 30;
  if (/casquead/i.test(subtipo)) return Number(config?.freqCasqueamento) || 60;
  return null;
}
function labelCasco(subtipo: string | null | undefined): string {
  return subtipo && /casquead/i.test(subtipo) ? "Casqueamento" : "Ferrageamento";
}

export interface ProgRow {
  animal: string;
  animalId: string;
  tipo: "Casco" | "Dente" | "Vacina" | "Vermífugo";
  label: string;
  subtipo: string;
  ultima: string | null;
  proxima: string | null;
  situacao: "atrasado" | "proximo" | "emdia" | "nunca";
}

/** chave de "tarefa dispensada" no app: [animalId, tipo, label, data].join('|') */
function chaveTarefa(r: ProgRow): string {
  return [r.animalId, r.tipo, r.label || "", r.proxima].join("|");
}

export function computeProgramacao(
  horses: any[],
  manejos: any[],
  config: any,
  hoje: string,
  dispensadas: string[] = [],
): ProgRow[] {
  const rows: ProgRow[] = [];
  const dispSet = new Set(dispensadas);
  const situacaoPara = (prox: string): ProgRow["situacao"] => {
    const d = diffDias(prox, hoje);
    return d < 0 ? "atrasado" : d <= 7 ? "proximo" : "emdia";
  };
  const ativos = (horses || []).filter(
    (h) => h.situacao !== "E" && h.situacao !== "V" && !h.falecimento,
  );
  for (const h of ativos) {
    // Casco — frequência dinâmica pelo último subtipo feito
    const regCasco = (manejos || [])
      .filter((m) => m.tipo === "Casco" && (m.animais || []).some((a: any) => a.id === h.id))
      .sort((a, b) => (b.data || "").localeCompare(a.data || ""));
    const ultimoCasco = regCasco[0];
    const subCasco = ultimoCasco
      ? ((ultimoCasco.animais || []).find((a: any) => a.id === h.id) || {}).tipo ||
        ultimoCasco.subtipoCasco
      : null;
    const freqC = ultimoCasco ? freqDinamicaCasco(subCasco, config) || h.freqcasco : h.freqcasco;
    if (freqC) {
      const ultima = ultimoCasco ? ultimoCasco.data : null;
      let proxima: string | null = null;
      let situacao: ProgRow["situacao"] = "nunca";
      if (ultima) {
        proxima = addDias(ultima, Number(freqC));
        situacao = situacaoPara(proxima);
      }
      rows.push({
        animal: h.nome,
        animalId: h.id,
        tipo: "Casco",
        label: labelCasco(subCasco),
        subtipo: subCasco || "",
        ultima,
        proxima,
        situacao,
      });
    }
    // Dente / Vermífugo — frequência em meses cadastrada no animal
    for (const tipo of ["Dente", "Vermífugo"] as const) {
      const freq = h[FREQ_FIELD[tipo]];
      if (!freq) continue;
      const regs = (manejos || [])
        .filter((m) => m.tipo === tipo && (m.animais || []).some((a: any) => a.id === h.id))
        .sort((a, b) => (b.data || "").localeCompare(a.data || ""));
      const ultima = regs[0] ? regs[0].data : null;
      let proxima: string | null = null;
      let situacao: ProgRow["situacao"] = "nunca";
      if (ultima) {
        proxima = addMeses(ultima, Number(freq));
        situacao = situacaoPara(proxima);
      }
      rows.push({
        animal: h.nome,
        animalId: h.id,
        tipo,
        label: tipo === "Dente" ? "Cheque Dental" : "Desparasitação",
        subtipo: "",
        ultima,
        proxima,
        situacao,
      });
    }
    // Vacinas — cada vacina aplicada tem a própria frequência (config.freqVacinas[nome], senão 365d)
    const nomesVacina = [
      ...new Set(
        (manejos || [])
          .filter(
            (m) =>
              m.tipo === "Vacina" &&
              m.medicamentoNome &&
              (m.animais || []).some((a: any) => a.id === h.id),
          )
          .map((m) => m.medicamentoNome as string),
      ),
    ];
    for (const nome of nomesVacina) {
      const regs = (manejos || [])
        .filter(
          (m) =>
            m.tipo === "Vacina" &&
            m.medicamentoNome === nome &&
            (m.animais || []).some((a: any) => a.id === h.id),
        )
        .sort((a, b) => (b.data || "").localeCompare(a.data || ""));
      const ultima = regs[0].data;
      const freqDias = Number(config?.freqVacinas && config.freqVacinas[nome]) || 365;
      const proxima = addDias(ultima, freqDias);
      rows.push({
        animal: h.nome,
        animalId: h.id,
        tipo: "Vacina",
        label: "Vacinação: " + nome,
        subtipo: nome,
        ultima,
        proxima,
        situacao: situacaoPara(proxima),
      });
    }
  }
  return rows.filter((r) => !r.proxima || !dispSet.has(chaveTarefa(r)));
}

// ---- Tratamentos veterinários (doses pendentes) ----
const PERIODOS_TRATAMENTO = ["manha", "tarde", "noite"];
export function dosesPendentesTratamento(t: any, hoje: string): { data: string; periodo: string }[] {
  if (!t.dataInicio || !t.diasTratamento) return [];
  const periodos = PERIODOS_TRATAMENTO.filter((p) => t.periodos && t.periodos[p]);
  if (periodos.length === 0) return [];
  const intervalo = Number(t.intervaloDias) >= 1 ? Number(t.intervaloDias) : 1;
  const n = Number(t.diasTratamento);
  const concluidas = new Set(t.doseConcluidas || []);
  const excluidas = new Set(t.doseExcluidas || []);
  const out: { data: string; periodo: string }[] = [];
  let data = t.dataInicio;
  for (let i = 0; i < n; i++) {
    for (const p of periodos) {
      const key = data + "|" + p;
      if (!concluidas.has(key) && !excluidas.has(key)) out.push({ data, periodo: p });
    }
    data = addDias(data, intervalo);
  }
  return out;
}

// ---- Estoque (mesma regra do situacaoEstoque do app) ----
export function situacaoEstoque(
  p: any,
  movimentos: any[],
  hoje: string,
): "zerado" | "perto" | null {
  const qtd = Number(p.quantidade) || 0;
  if (qtd <= 0) return "zerado";
  if (p.alertaModo === "projetado") {
    const saidas = (movimentos || []).filter((m) => m.produtoId === p.id && m.tipoMov === "saida");
    if (saidas.length === 0) return null;
    const datas = saidas.map((m) => m.data).sort();
    let dias = diffDias(hoje, datas[0]);
    if (dias < 7) dias = 7;
    const total = saidas.reduce((s, m) => s + (Number(m.quantidade) || 0), 0);
    const porDia = total / dias;
    const diasRestantes = porDia > 0 ? Math.floor(qtd / porDia) : Infinity;
    return diasRestantes <= 10 ? "perto" : null;
  }
  const min = p.minimo !== "" && p.minimo != null ? Number(p.minimo) : null;
  return min != null && qtd <= min ? "perto" : null;
}

// ---- Salário (dia 5) ----
export function salarioConfirmadoNoMes(
  lancamentos: any[],
  funcionarioId: string,
  anoMes: string,
): boolean {
  return (lancamentos || []).some(
    (l) =>
      l.origemFuncionarioId === funcionarioId &&
      l.categoria === "Salário" &&
      (l.data || "").slice(0, 7) === anoMes,
  );
}

// ---- Reprodução: quem carrega a gestação ----
export function alvoGestacao(n: any): string {
  return n.transferenciaEmbriao && n.receptora ? n.receptora : n.matriz;
}
