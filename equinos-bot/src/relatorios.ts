/**
 * Monta o TEXTO dos dois relatórios diários (Telegram HTML). Função pura: recebe as listas já
 * buscadas do Firestore + a data "hoje" (Brasília), devolve string. Quem busca e envia é o cron.ts.
 *
 * 07:00 — "O que fazer hoje": uma lista só (Gustavo é ADM, já vê tudo).
 * 12:00 / 19:00 — "O que foi feito": eventos do dia, partidos em manhã/tarde, sem repetir
 *   (a msg das 19h só traz o que apareceu depois das 12h — o cron.ts guarda as chaves no KV).
 * Financeiro e Estoque ficam de fora (pedido do Gustavo; Estoque virou /estoque).
 */
import { esc } from "./telegram.ts";
import type { GrupoCard } from "./imagem.ts";
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

/**
 * 07:00 — "O que fazer hoje". UMA lista só pro Gustavo (ele é ADM: já vê tudo que o
 * veterinário e o ferrador veriam). Sem sub-blocos por papel, sem repetição.
 */
export function montarRelatorioManha(d: DadosHaras, hoje: string): string {
  const s = montarSecoesManha(d, hoje);
  const manejos = bloco("🐴 Manejos", [
    ...(s.casco.length ? ["<i>Casco</i>", ...s.casco] : []),
    ...(s.dente.length ? ["<i>Dente</i>", ...s.dente] : []),
    ...(s.vacina.length ? ["<i>Vacina</i>", ...s.vacina] : []),
    ...(s.vermifugo.length ? ["<i>Vermífugo</i>", ...s.vermifugo] : []),
  ]);
  const partes = [
    manejos,
    bloco("🩺 Veterinária", s.veterinaria),
    bloco("🐣 Reprodução", s.reproducao),
    bloco("💰 Funcionários", s.salario),
  ].filter((x) => x && x.trim());
  const cabecalho = `📋 <b>O que fazer hoje — ${fmtBR(hoje)}</b>\n`;
  if (partes.length === 0) return cabecalho + "\nNada pendente hoje. ✅";
  return cabecalho + "\n" + partes.join("\n");
}

/** Grupos pro card-imagem das 7h (mesma info do texto, só que estruturada por categoria). */
export function gruposManha(d: DadosHaras, hoje: string): GrupoCard[] {
  const s = montarSecoesManha(d, hoje);
  return [
    { label: "Casco", linhas: s.casco },
    { label: "Dente", linhas: s.dente },
    { label: "Vacina", linhas: s.vacina },
    { label: "Vermífugo", linhas: s.vermifugo },
    { label: "Veterinária", linhas: s.veterinaria },
    { label: "Reprodução", linhas: s.reproducao },
    { label: "Funcionários", linhas: s.salario },
  ].filter((g) => g.linhas.length);
}

// ================= "O QUE FOI FEITO" (manhã 12h / tarde 19h, sem repetir) =================

/** Um evento registrado hoje. `key` é estável — serve pra não repetir entre a msg das 12h e a das 19h. */
export interface Feito {
  key: string;
  modulo: "Manejos" | "Veterinária" | "Reprodução";
  texto: string;
}

/** Todos os eventos com data === hoje (nunca dias anteriores). */
export function coletarFeitos(d: DadosHaras, hoje: string): Feito[] {
  const nomeAnimais = (ids: any[]) => listaAnimais((ids || []).map((a) => a.nome));
  const out: Feito[] = [];

  // Manejos
  for (const m of d.manejos || []) {
    if (m.data !== hoje) continue;
    if (m.tipo === "Casco") {
      const porSub = new Map<string, string[]>();
      for (const a of m.animais || []) {
        const sub = a.tipo || m.subtipoCasco || "Casco";
        if (!porSub.has(sub)) porSub.set(sub, []);
        porSub.get(sub)!.push(a.nome);
      }
      const linhas = [...porSub].map(([sub, ns]) => `  • ${esc(sub)}: ${listaAnimais(ns)}`);
      out.push({ key: `mj|${m.id}`, modulo: "Manejos", texto: `<i>Casco</i>\n${linhas.join("\n")}` });
    } else {
      const med = m.medicamentoNome ? " (" + esc(m.medicamentoNome) + ")" : "";
      out.push({
        key: `mj|${m.id}`,
        modulo: "Manejos",
        texto: `<i>${esc(m.tipo)}</i>${med}: ${nomeAnimais(m.animais)}`,
      });
    }
  }

  // Veterinária
  for (const v of d.visitas || []) {
    if (v.data !== hoje) continue;
    out.push({
      key: `vis|${v.id}`,
      modulo: "Veterinária",
      texto: `• Visita${v.veterinario ? " (" + esc(v.veterinario) + ")" : ""}${v.local ? " — " + esc(v.local) : ""}`,
    });
  }
  for (const t of d.tratamentos || []) {
    if (t.dataInicio === hoje) {
      out.push({
        key: `trat-ini|${t.id}`,
        modulo: "Veterinária",
        texto: `• Tratamento iniciado — ${esc(t.medicamentoNome || "?")}: ${nomeAnimais(t.animais)}`,
      });
    }
    for (const k of t.doseConcluidas || []) {
      const key = String(k);
      if (!key.startsWith(hoje + "|")) continue;
      out.push({
        key: `trat-dose|${t.id}|${key}`,
        modulo: "Veterinária",
        texto: `• Dose aplicada — ${esc(t.medicamentoNome || "?")} (${key.split("|")[1]}): ${nomeAnimais(t.animais)}`,
      });
    }
  }

  // Reprodução
  const eguasVisitadas: { key: string; nomes: string[] }[] = [];
  for (const vr of d.visitasRepro || []) {
    if (vr.data !== hoje) continue;
    eguasVisitadas.push({ key: `vr|${vr.id}`, nomes: (vr.eguas || []).map((e: any) => e.nome) });
  }
  for (const vr of eguasVisitadas) {
    out.push({
      key: vr.key,
      modulo: "Reprodução",
      texto: `• Visita/exame reprodutivo — éguas: ${listaAnimais(vr.nomes)}`,
    });
  }
  for (const n of d.nascimentos || []) {
    if (n.datacob === hoje) {
      out.push({
        key: `cob|${n.id}`,
        modulo: "Reprodução",
        texto: `• Cobertura — ${esc(n.matriz || "?")} × ${esc(n.pai || "?")}${n.transferenciaEmbriao ? " (transferência de embrião)" : ""}`,
      });
    }
    if (n.lavadoData === hoje && n.lavado) {
      out.push({
        key: `lav|${n.id}`,
        modulo: "Reprodução",
        texto: `• Lavado ${n.lavado === "POS" ? "positivo ✓" : "negativo ✕"} — ${esc(n.matriz || "?")}${n.lavado === "NEG" ? " (cobertura encerrada)" : ""}`,
      });
    }
    if ((n.prenhezHistorico || []).includes(hoje)) {
      out.push({
        key: `pren|${n.id}|${hoje}`,
        modulo: "Reprodução",
        texto: `• Prenhez confirmada — ${esc(alvoGestacao(n))}`,
      });
    }
    if (n.datanasc === hoje && n.confirm === "S") {
      out.push({
        key: `nasc|${n.id}`,
        modulo: "Reprodução",
        texto: `• Nascimento confirmado — ${esc(n.matriz || "?")}`,
      });
    }
  }

  return out;
}

const ORDEM_MODULO = ["Manejos", "Veterinária", "Reprodução"] as const;

/** Grupos pro card-imagem do "feito" (manhã/tarde). */
export function gruposFeitos(feitos: Feito[]): GrupoCard[] {
  return ORDEM_MODULO.map((m) => ({
    label: m,
    linhas: feitos.filter((f) => f.modulo === m).flatMap((f) => f.texto.split("\n")),
  })).filter((g) => g.linhas.length);
}

export function montarMensagemFeitos(feitos: Feito[], titulo: string): string {
  const cab = `✅ <b>${esc(titulo)}</b>\n`;
  if (feitos.length === 0) return cab + "\nNada novo lançado neste período.";
  const partes: string[] = [];
  for (const mod of ORDEM_MODULO) {
    const linhas = feitos.filter((f) => f.modulo === mod).map((f) => f.texto);
    if (linhas.length) partes.push(bloco(mod, linhas));
  }
  return cab + "\n" + partes.join("\n");
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
