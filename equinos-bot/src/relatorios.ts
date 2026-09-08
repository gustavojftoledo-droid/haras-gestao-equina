/**
 * Monta o TEXTO dos dois relatórios diários (Telegram HTML). Função pura: recebe as listas já
 * buscadas do Firestore + a data "hoje" (Brasília), devolve string. Quem busca e envia é o cron.ts.
 *
 * 07:00 — "O que fazer hoje", em 3 blocos por papel (ADM / Veterinário / Ferrador).
 * 19:00 — "O que foi feito hoje", por módulo.
 * Financeiro fica de fora dos dois (pedido do Gustavo).
 */
import { esc } from "./telegram.ts";
import {
  computeProgramacao,
  dosesPendentesTratamento,
  situacaoEstoque,
  salarioConfirmadoNoMes,
  alvoGestacao,
  fmtBR,
  diffDias,
  addDias,
  type ProgRow,
} from "./agenda.ts";

export interface DadosHaras {
  horses: any[];
  manejos: any[];
  nascimentos: any[];
  tratamentos: any[];
  visitas: any[];
  visitasRepro: any[];
  produtos: any[];
  movimentos: any[];
  funcionarios: any[];
  lancamentos: any[];
  transportes: any[];
  config: any;
  dispensadas: string[];
}

const HORIZONTE = 7; // dias à frente que contam como "próximo"

// junta linhas, ignorando vazias
function bloco(titulo: string, linhas: string[]): string {
  const uteis = linhas.filter((l) => l && l.trim());
  if (uteis.length === 0) return "";
  return `<b>${esc(titulo)}</b>\n` + uteis.join("\n") + "\n";
}

function listaAnimais(nomes: string[]): string {
  const u = [...new Set(nomes.filter(Boolean))];
  return u.length ? u.join(", ") : "—";
}

// agrupa linhas de programação de um tipo por data prevista, listando os animais
function linhasProgPorData(rows: ProgRow[], hoje: string): string[] {
  const porData = new Map<string, { animais: string[]; atrasado: boolean }>();
  for (const r of rows) {
    if (!r.proxima) continue;
    const g = porData.get(r.proxima) || { animais: [], atrasado: false };
    g.animais.push(r.animal);
    if (r.situacao === "atrasado") g.atrasado = true;
    porData.set(r.proxima, g);
  }
  return [...porData.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([data, g]) => {
      const marca = g.atrasado ? "⚠️ " : "";
      return `• ${marca}${fmtBR(data)}: ${listaAnimais(g.animais)}`;
    });
}

// Casco: além da data, separar Ferrageamento de Casqueamento
function linhasCasco(rows: ProgRow[]): string[] {
  const out: string[] = [];
  const porLabel = new Map<string, ProgRow[]>();
  for (const r of rows) {
    if (!r.proxima) continue;
    const arr = porLabel.get(r.label) || [];
    arr.push(r);
    porLabel.set(r.label, arr);
  }
  for (const [label, arr] of porLabel) {
    const porData = new Map<string, { animais: string[]; atrasado: boolean }>();
    for (const r of arr) {
      const g = porData.get(r.proxima!) || { animais: [], atrasado: false };
      g.animais.push(r.animal);
      if (r.situacao === "atrasado") g.atrasado = true;
      porData.set(r.proxima!, g);
    }
    for (const [data, g] of [...porData.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      out.push(`• ${g.atrasado ? "⚠️ " : ""}${label} — ${fmtBR(data)}: ${listaAnimais(g.animais)}`);
    }
  }
  return out;
}

// ================= 07:00 — O QUE FAZER HOJE =================

interface SecoesManha {
  casco: string[];
  dente: string[];
  vacina: string[];
  vermifugo: string[];
  veterinaria: string[];
  reproducao: string[];
  estoque: string[];
  salario: string[];
}

function montarSecoesManha(d: DadosHaras, hoje: string): SecoesManha {
  const limite = addDias(hoje, HORIZONTE);
  const prog = computeProgramacao(d.horses, d.manejos, d.config, hoje, d.dispensadas).filter(
    (r) => r.proxima && r.proxima <= limite,
  );
  const porTipo = (t: string) => prog.filter((r) => r.tipo === t);

  // --- Veterinária: tratamentos com dose pendente/atrasada até o horizonte ---
  const nomeAnimais = (ids: any[]) => (ids || []).map((a) => a.nome).filter(Boolean);
  const veterinaria: string[] = [];
  for (const t of d.tratamentos || []) {
    const doses = dosesPendentesTratamento(t, hoje).filter((ds) => ds.data <= limite);
    if (doses.length === 0) continue;
    const primeira = doses.map((x) => x.data).sort()[0];
    const atras = primeira < hoje;
    veterinaria.push(
      `• ${atras ? "⚠️ " : ""}${esc(t.medicamentoNome || "Tratamento")} — ${fmtBR(primeira)} (${doses.length} dose(s)): ${listaAnimais(nomeAnimais(t.animais))}`,
    );
  }
  // visitas veterinárias agendadas (sem data de realização) até o horizonte — visitas têm só data
  for (const v of d.visitas || []) {
    if (!v.data || v.data < hoje || v.data > limite) continue;
    veterinaria.push(`• Visita ${fmtBR(v.data)}${v.veterinario ? " — " + esc(v.veterinario) : ""}`);
  }

  // --- Reprodução ---
  const reproducao: string[] = [];
  // lavado pendente (transferência de embrião ainda sem resultado)
  const lavPend = (d.nascimentos || []).filter(
    (n) => n.transferenciaEmbriao && n.confirm !== "S" && !n.lavado,
  );
  for (const n of lavPend) {
    reproducao.push(
      `• 🧫 Lavado pendente — ${esc(n.matriz || "?")}${n.dataColetaEmbriao ? " (coleta " + fmtBR(n.dataColetaEmbriao) + ")" : ""}`,
    );
  }
  // prenhez a confirmar: cobertura aberta, sem perda, já com tempo de checar (≥14 dias)
  const prenhConf = (d.nascimentos || []).filter((n) => {
    if (n.confirm === "S" || n.prenhezConfirmada === "S" || n.lavado === "NEG") return false;
    if (n.transferenciaEmbriao && n.lavado !== "POS") return false;
    const ref = n.lavadoData || n.dataColetaEmbriao || n.datacob;
    return ref && diffDias(hoje, ref) >= 14;
  });
  for (const n of prenhConf) {
    reproducao.push(
      `• 🤰 Confirmar prenhez — ${esc(alvoGestacao(n))}${n.pai ? " (× " + esc(n.pai) + ")" : ""}`,
    );
  }
  // retornos reprodutivos anotados pelo veterinário
  const retornoPorEgua = new Map<string, { nome: string; retorno: string }>();
  for (const vr of d.visitasRepro || []) {
    for (const e of vr.eguas || []) {
      if (!e.proximoRetorno) continue;
      const at = retornoPorEgua.get(e.nome);
      if (!at || (vr.data || "") > (at as any).visitaData)
        retornoPorEgua.set(e.nome, { nome: e.nome, retorno: e.proximoRetorno });
    }
  }
  const retPorData = new Map<string, string[]>();
  for (const r of retornoPorEgua.values()) {
    if (r.retorno > limite) continue;
    const jaVoltou = (d.visitasRepro || []).some(
      (vr) => (vr.data || "") > r.retorno && (vr.eguas || []).some((e: any) => e.nome === r.nome),
    );
    if (jaVoltou) continue;
    const arr = retPorData.get(r.retorno) || [];
    arr.push(r.nome);
    retPorData.set(r.retorno, arr);
  }
  for (const [data, nomes] of [...retPorData.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    reproducao.push(
      `• ${data < hoje ? "⚠️ " : ""}🔄 Retorno reprodutivo — ${fmtBR(data)}: ${listaAnimais(nomes)}`,
    );
  }
  // protocolo de vacinas de gestação — agrupado por égua, ignorando o que está mais de 45 dias vencido
  const minData = addDias(hoje, -45);
  const gestPorEgua = new Map<string, { vac: Set<string>; atras: boolean }>();
  for (const n of d.nascimentos || []) {
    if (n.confirm === "S") continue;
    for (const item of n.protocoloVacinas || []) {
      if (item.feito || !item.dataAlvo || item.dataAlvo > limite || item.dataAlvo < minData) continue;
      const alvo = alvoGestacao(n);
      const g = gestPorEgua.get(alvo) || { vac: new Set<string>(), atras: false };
      g.vac.add(item.nome);
      if (item.dataAlvo < hoje) g.atras = true;
      gestPorEgua.set(alvo, g);
    }
  }
  for (const [egua, g] of gestPorEgua) {
    reproducao.push(
      `• ${g.atras ? "⚠️ " : ""}💉 Vacina de gestação — ${esc(egua)}: ${[...g.vac].map(esc).join(", ")}`,
    );
  }
  // protocolo de vacinas de potro — idem, por potro
  for (const h of d.horses || []) {
    const vac = new Set<string>();
    let atras = false;
    for (const item of h.protocoloPotro || []) {
      if (item.feito || !item.dataAlvo || item.dataAlvo > limite || item.dataAlvo < minData) continue;
      vac.add(item.nome);
      if (item.dataAlvo < hoje) atras = true;
    }
    if (vac.size)
      reproducao.push(
        `• ${atras ? "⚠️ " : ""}🐣 Vacina de potro — ${esc(h.nome)}: ${[...vac].map(esc).join(", ")}`,
      );
  }

  // --- Estoque baixo ---
  const estoque: string[] = [];
  for (const p of d.produtos || []) {
    const s = situacaoEstoque(p, d.movimentos, hoje);
    if (!s) continue;
    const un = p.unidade ? " " + p.unidade : "";
    estoque.push(
      `• ${s === "zerado" ? "🛑 Zerado" : "⚠️ Baixo"}: ${esc(p.nome || "?")} (${Number(p.quantidade) || 0}${un})`,
    );
  }

  // --- Salário (a partir do dia 5) ---
  const salario: string[] = [];
  const anoMes = hoje.slice(0, 7);
  const dia = Number(hoje.slice(8, 10));
  if (dia >= 5) {
    for (const fu of d.funcionarios || []) {
      if (salarioConfirmadoNoMes(d.lancamentos, fu.id, anoMes)) continue;
      salario.push(`• 💰 Confirmar salário — ${esc(fu.nome || "?")}`);
    }
  }

  return {
    casco: linhasCasco(porTipo("Casco")),
    dente: linhasProgPorData(porTipo("Dente"), hoje),
    vacina: linhasProgPorData(porTipo("Vacina"), hoje),
    vermifugo: linhasProgPorData(porTipo("Vermífugo"), hoje),
    veterinaria,
    reproducao,
    estoque,
    salario,
  };
}

function blocoPapel(nome: string, secoes: string[]): string {
  const corpo = secoes.filter((s) => s && s.trim()).join("\n");
  if (!corpo.trim()) return `━━━ <b>${esc(nome)}</b> ━━━\nNada pendente. ✅\n`;
  return `━━━ <b>${esc(nome)}</b> ━━━\n${corpo}`;
}

export function montarRelatorioManha(d: DadosHaras, hoje: string): string {
  const s = montarSecoesManha(d, hoje);

  const admManejos = bloco("Manejos", [
    ...(s.casco.length ? ["<i>Casco</i>", ...s.casco] : []),
    ...(s.dente.length ? ["<i>Dente</i>", ...s.dente] : []),
    ...(s.vacina.length ? ["<i>Vacina</i>", ...s.vacina] : []),
    ...(s.vermifugo.length ? ["<i>Vermífugo</i>", ...s.vermifugo] : []),
  ]);

  const cabecalho = `📋 <b>O que fazer hoje — ${fmtBR(hoje)}</b>\n`;

  const blocoAdm = blocoPapel("👤 ADM", [
    admManejos,
    bloco("Veterinária", s.veterinaria),
    bloco("Reprodução", s.reproducao),
    bloco("Funcionários", s.salario),
  ]);
  const blocoVet = blocoPapel("🩺 Veterinário", [
    bloco("Dente", s.dente),
    bloco("Vacina", s.vacina),
    bloco("Vermífugo", s.vermifugo),
    bloco("Veterinária", s.veterinaria),
    bloco("Reprodução", s.reproducao),
  ]);
  const blocoFer = blocoPapel("🔨 Ferrador", [bloco("Casco", s.casco)]);

  return [cabecalho, blocoAdm, blocoVet, blocoFer].join("\n").trim();
}

// ================= 19:00 — O QUE FOI FEITO HOJE =================

export function montarRelatorioNoite(d: DadosHaras, hoje: string): string {
  const nomeAnimais = (ids: any[]) => listaAnimais((ids || []).map((a) => a.nome));
  const linhas: string[] = [];

  // --- Manejos feitos hoje, por tipo ---
  const manejosHoje = (d.manejos || []).filter((m) => m.data === hoje);
  const mLinhas: string[] = [];
  const porTipo = new Map<string, any[]>();
  for (const m of manejosHoje) {
    const arr = porTipo.get(m.tipo) || [];
    arr.push(m);
    porTipo.set(m.tipo, arr);
  }
  for (const [tipo, arr] of porTipo) {
    if (tipo === "Casco") {
      // separa por subtipo (por animal: a.tipo, senão m.subtipoCasco)
      const porSub = new Map<string, string[]>();
      for (const m of arr) {
        for (const a of m.animais || []) {
          const sub = a.tipo || m.subtipoCasco || "Casco";
          const l = porSub.get(sub) || [];
          l.push(a.nome);
          porSub.set(sub, l);
        }
      }
      const datas = [...new Set(arr.map((m) => m.data))].map(fmtBR).join(", ");
      mLinhas.push(`<i>Casco</i> — ${datas}`);
      for (const [sub, nomes] of porSub) mLinhas.push(`  • ${esc(sub)}: ${listaAnimais(nomes)}`);
    } else {
      for (const m of arr) {
        const nome = m.medicamentoNome ? " (" + esc(m.medicamentoNome) + ")" : "";
        mLinhas.push(`<i>${esc(tipo)}</i>${nome} — ${fmtBR(m.data)}: ${nomeAnimais(m.animais)}`);
      }
    }
  }
  const bManejos = bloco("Manejos", mLinhas);

  // --- Veterinária ---
  const vetLinhas: string[] = [];
  for (const v of d.visitas || []) {
    if (v.data !== hoje) continue;
    vetLinhas.push(
      `• Visita${v.veterinario ? " (" + esc(v.veterinario) + ")" : ""}${v.local ? " — " + esc(v.local) : ""}`,
    );
  }
  for (const t of d.tratamentos || []) {
    if (t.dataInicio === hoje) {
      vetLinhas.push(
        `• Tratamento iniciado — ${esc(t.medicamentoNome || "?")}: ${nomeAnimais(t.animais)}`,
      );
    }
    for (const key of t.doseConcluidas || []) {
      if ((key as string).startsWith(hoje + "|")) {
        vetLinhas.push(
          `• Dose aplicada — ${esc(t.medicamentoNome || "?")} (${(key as string).split("|")[1]}): ${nomeAnimais(t.animais)}`,
        );
        break;
      }
    }
  }
  const bVet = bloco("Veterinária", vetLinhas);

  // --- Reprodução ---
  const reproLinhas: string[] = [];
  const eguasVisitadas: string[] = [];
  for (const vr of d.visitasRepro || []) {
    if (vr.data !== hoje) continue;
    eguasVisitadas.push(...(vr.eguas || []).map((e: any) => e.nome));
  }
  if (eguasVisitadas.length)
    reproLinhas.push(`• Visita/exame reprodutivo — éguas: ${listaAnimais(eguasVisitadas)}`);
  for (const n of d.nascimentos || []) {
    if (n.datacob === hoje) {
      reproLinhas.push(
        `• Cobertura — ${esc(n.matriz || "?")} × ${esc(n.pai || "?")}${n.transferenciaEmbriao ? " (transferência de embrião)" : ""}`,
      );
    }
    if (n.lavadoData === hoje && n.lavado) {
      reproLinhas.push(
        `• Lavado ${n.lavado === "POS" ? "positivo ✓" : "negativo ✕"} — ${esc(n.matriz || "?")}${n.lavado === "NEG" ? " (cobertura encerrada)" : ""}`,
      );
    }
    if ((n.prenhezHistorico || []).includes(hoje)) {
      reproLinhas.push(`• Prenhez confirmada — ${esc(alvoGestacao(n))}`);
    }
    if (n.datanasc === hoje && n.confirm === "S") {
      reproLinhas.push(`• Nascimento confirmado — ${esc(n.matriz || "?")}`);
    }
  }
  const bRepro = bloco("Reprodução", reproLinhas);

  // --- Estoque ---
  const estLinhas: string[] = [];
  for (const mv of d.movimentos || []) {
    if (mv.data !== hoje) continue;
    // Baixa automática de dieta acontece todo dia sozinha — não é "o que foi feito".
    if (mv.origem === "dieta" || /^Dieta:/i.test(mv.motivo || "")) continue;
    const prod = (d.produtos || []).find((p) => p.id === mv.produtoId);
    const seta = mv.tipoMov === "entrada" ? "⬆️ entrada" : "⬇️ saída";
    estLinhas.push(
      `• ${seta} ${Number(mv.quantidade) || 0} — ${esc(prod ? prod.nome : mv.produtoNome || "?")}${mv.motivo ? " (" + esc(mv.motivo) + ")" : ""}`,
    );
  }
  const bEst = bloco("Estoque", estLinhas);

  const partes = [bManejos, bVet, bRepro].filter((x) => x && x.trim());
  const cabecalho = `✅ <b>O que foi feito hoje — ${fmtBR(hoje)}</b>\n`;
  if (partes.length === 0)
    return cabecalho + "\nNenhum registro lançado hoje. (Estoque: mande /estoque pra ver.)";
  return cabecalho + "\n" + partes.join("\n");
}

// ================= ESTOQUE (só sob demanda — comando /estoque) =================

export function montarRelatorioEstoque(
  d: Pick<DadosHaras, "produtos" | "movimentos">,
  hoje: string,
): string {
  const baixo: string[] = [];
  for (const p of d.produtos || []) {
    const s = situacaoEstoque(p, d.movimentos, hoje);
    if (!s) continue;
    const un = p.unidade ? " " + p.unidade : "";
    baixo.push(
      `• ${s === "zerado" ? "🛑 Zerado" : "⚠️ Baixo"}: ${esc(p.nome || "?")} (${Number(p.quantidade) || 0}${un})`,
    );
  }
  const saidasHoje: string[] = [];
  const entradasHoje: string[] = [];
  for (const mv of d.movimentos || []) {
    if (mv.data !== hoje) continue;
    if (mv.origem === "dieta" || /^Dieta:/i.test(mv.motivo || "")) continue;
    const prod = (d.produtos || []).find((p) => p.id === mv.produtoId);
    const linha = `• ${Number(mv.quantidade) || 0} — ${esc(prod ? prod.nome : mv.produtoNome || "?")}${mv.motivo ? " (" + esc(mv.motivo) + ")" : ""}`;
    if (mv.tipoMov === "entrada") entradasHoje.push(linha);
    else saidasHoje.push(linha);
  }
  const partes = [
    bloco("Baixo / zerado", baixo),
    bloco("Saiu hoje (" + fmtBR(hoje) + ")", saidasHoje.length ? saidasHoje : ["—"]),
    bloco("Entrou hoje", entradasHoje),
  ];
  return `📦 <b>Estoque</b>\n\n` + partes.filter((x) => x && x.trim()).join("\n");
}
