/**
 * Tarefas agendadas (Cron Triggers da Cloudflare). Buscam as listas do Firestore, montam o texto
 * (relatorios.ts) e mandam no Telegram pros chat ids autorizados.
 *
 * Horários (UTC, fixados pra Brasília UTC-3, sem horário de verão):
 *   0 10 * * *  -> 07:00 Brasília — "O que fazer hoje"
 *   0 22 * * *  -> 19:00 Brasília — "O que foi feito hoje"
 */
import type { Env } from "./firestore.ts";
import { getList, getMap } from "./firestore.ts";
import { sendMessage } from "./telegram.ts";
import {
  montarRelatorioManha,
  montarRelatorioNoite,
  montarRelatorioEstoque,
  type DadosHaras,
} from "./relatorios.ts";

/** "hoje" em Brasília (UTC-3), formato AAAA-MM-DD. */
export function hojeBrasilia(agora: Date = new Date()): string {
  return new Date(agora.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

function chatIds(env: Env): string[] {
  return (env.ALLOWED_CHAT_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function carregarDadosDebug(env: Env): Promise<DadosHaras> {
  return carregarDados(env);
}

async function carregarDados(env: Env): Promise<DadosHaras> {
  const [
    horses,
    manejos,
    nascimentos,
    tratamentos,
    visitas,
    visitasRepro,
    produtos,
    movimentos,
    funcionarios,
    lancamentos,
    transportes,
    config,
    dispensadas,
  ] = await Promise.all([
    getList(env, "horses_list"),
    getList(env, "manejos_list"),
    getList(env, "nascimentos_list"),
    getList(env, "tratamentos_list"),
    getList(env, "visitas_list"),
    getList(env, "visitas_repro_list"),
    getList(env, "estoque_produtos"),
    getList(env, "estoque_movimentos"),
    getList(env, "funcionarios_list"),
    getList(env, "financeiro_lancamentos"),
    getList(env, "transportes_list"),
    getMap(env, "config"),
    getList(env, "dismissed_manejo_tasks"),
  ]);
  return {
    horses,
    manejos,
    nascimentos,
    tratamentos,
    visitas,
    visitasRepro,
    produtos,
    movimentos,
    funcionarios,
    lancamentos,
    transportes,
    config,
    dispensadas: (dispensadas as any[]).map(String),
  };
}

async function enviarPraTodos(env: Env, texto: string): Promise<void> {
  for (const id of chatIds(env)) {
    // Telegram corta em 4096 chars — parte em pedaços por linha se precisar.
    for (const pedaco of partir(texto, 3900)) {
      await sendMessage(env, id, pedaco);
    }
  }
}

function partir(texto: string, max: number): string[] {
  if (texto.length <= max) return [texto];
  const linhas = texto.split("\n");
  const out: string[] = [];
  let atual = "";
  for (const l of linhas) {
    if ((atual + "\n" + l).length > max && atual) {
      out.push(atual);
      atual = l;
    } else {
      atual = atual ? atual + "\n" + l : l;
    }
  }
  if (atual) out.push(atual);
  return out;
}

export async function rodarRelatorioManha(env: Env): Promise<void> {
  const dados = await carregarDados(env);
  const hoje = hojeBrasilia();
  await enviarPraTodos(env, montarRelatorioManha(dados, hoje));
}

export async function rodarRelatorioNoite(env: Env): Promise<void> {
  const dados = await carregarDados(env);
  const hoje = hojeBrasilia();
  await enviarPraTodos(env, montarRelatorioNoite(dados, hoje));
}

/** Relatório de estoque sob demanda (comando /estoque no Telegram). Busca só o necessário. */
export async function textoRelatorioEstoque(env: Env): Promise<string> {
  const [produtos, movimentos] = await Promise.all([
    getList(env, "estoque_produtos"),
    getList(env, "estoque_movimentos"),
  ]);
  return montarRelatorioEstoque({ produtos, movimentos }, hojeBrasilia());
}

/** Roteia pelo horário do cron. */
export async function onScheduled(event: ScheduledController, env: Env): Promise<void> {
  const hora = new Date(event.scheduledTime).getUTCHours();
  if (hora >= 20 || hora < 4) {
    await rodarRelatorioNoite(env);
  } else {
    await rodarRelatorioManha(env);
  }
}
