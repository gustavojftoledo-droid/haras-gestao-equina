/**
 * Tarefas agendadas (Cron Triggers da Cloudflare). Buscam as listas do Firestore, montam o texto
 * (relatorios.ts) e mandam no Telegram pros chat ids autorizados.
 *
 * Horários (UTC, fixados pra Brasília UTC-3, sem horário de verão):
 *   0 10 * * *  -> 07:00 Brasília — "O que fazer hoje" (uma vez, lista única)
 *   0 15 * * *  -> 12:00 Brasília — "O que foi feito de manhã"
 *   0 22 * * *  -> 19:00 Brasília — "O que foi feito à tarde" (só o que não veio às 12h)
 */
import type { Env } from "./firestore.ts";
import { getList, getMap } from "./firestore.ts";
import { sendMessage, sendPhoto } from "./telegram.ts";
import {
  montarRelatorioManha,
  montarRelatorioEstoque,
  coletarFeitos,
  montarMensagemFeitos,
  gruposManha,
  gruposFeitos,
  type DadosHaras,
} from "./relatorios.ts";
import type { GrupoCard } from "./imagem.ts";

/** Chave no KV com as `key`s de eventos já reportados hoje (pra msg das 19h não repetir a das 12h). */
const kvFeito = (hoje: string) => `rel:feito:${hoje}`;

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

/**
 * Manda o relatório como IMAGEM (card). Se a renderização ou o envio da foto falhar, cai pro
 * texto — nunca deixa de mandar o relatório.
 */
async function enviarComImagem(
  env: Env,
  titulo: string,
  dataBR: string,
  grupos: GrupoCard[],
  textoFallback: string,
): Promise<void> {
  let png: Uint8Array | null = null;
  try {
    const { renderCardPng } = await import("./imagem.ts");
    png = await renderCardPng(titulo, dataBR, grupos);
  } catch (e) {
    console.error("renderCardPng falhou:", e);
  }
  for (const id of chatIds(env)) {
    if (png) {
      try {
        await sendPhoto(env, id, png, `<b>${titulo}</b> — ${dataBR}`);
        continue;
      } catch (e) {
        console.error("sendPhoto falhou, mando texto:", e);
      }
    }
    for (const pedaco of partir(textoFallback, 3900)) await sendMessage(env, id, pedaco);
  }
}

function dataBRlonga(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
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

/** 07:00 — o que fazer hoje (uma lista só). Vai como imagem (card), texto de reserva. */
export async function rodarRelatorioManha(env: Env): Promise<void> {
  const dados = await carregarDados(env);
  const hoje = hojeBrasilia();
  await enviarComImagem(
    env,
    "O que fazer hoje",
    dataBRlonga(hoje),
    gruposManha(dados, hoje),
    montarRelatorioManha(dados, hoje),
  );
}

/** 12:00 — o que foi feito de manhã. Guarda as chaves pra msg das 19h não repetir. */
export async function rodarFeitoManha(env: Env): Promise<void> {
  const dados = await carregarDados(env);
  const hoje = hojeBrasilia();
  const feitos = coletarFeitos(dados, hoje);
  await enviarComImagem(
    env,
    "Feito hoje de manhã",
    dataBRlonga(hoje),
    gruposFeitos(feitos),
    montarMensagemFeitos(feitos, `Feito hoje de manhã — ${dataBRlonga(hoje)}`),
  );
  await env.SESSIONS.put(kvFeito(hoje), JSON.stringify(feitos.map((f) => f.key)), {
    expirationTtl: 172800,
  });
}

/** 19:00 — o que foi feito à tarde: só o que NÃO apareceu na msg das 12h. */
export async function rodarFeitoTarde(env: Env): Promise<void> {
  const dados = await carregarDados(env);
  const hoje = hojeBrasilia();
  const feitos = coletarFeitos(dados, hoje);
  const jaVistos: string[] = (await env.SESSIONS.get(kvFeito(hoje), "json")) || [];
  const jaSet = new Set(jaVistos);
  const novos = feitos.filter((f) => !jaSet.has(f.key));
  await enviarComImagem(
    env,
    "Feito hoje à tarde",
    dataBRlonga(hoje),
    gruposFeitos(novos),
    montarMensagemFeitos(novos, `Feito hoje à tarde — ${dataBRlonga(hoje)}`),
  );
  const uniao = [...new Set([...jaVistos, ...feitos.map((f) => f.key)])];
  await env.SESSIONS.put(kvFeito(hoje), JSON.stringify(uniao), { expirationTtl: 172800 });
}

/** Relatório de estoque sob demanda (comando /estoque no Telegram). Busca só o necessário. */
export async function textoRelatorioEstoque(env: Env): Promise<string> {
  const [produtos, movimentos] = await Promise.all([
    getList(env, "estoque_produtos"),
    getList(env, "estoque_movimentos"),
  ]);
  return montarRelatorioEstoque({ produtos, movimentos }, hojeBrasilia());
}

/** Roteia pelo horário do cron (UTC): 10h -> afazer, 15h -> feito manhã, 22h -> feito tarde. */
export async function onScheduled(event: ScheduledController, env: Env): Promise<void> {
  const hora = new Date(event.scheduledTime).getUTCHours();
  if (hora === 15) await rodarFeitoManha(env);
  else if (hora >= 20 || hora < 4) await rodarFeitoTarde(env);
  else await rodarRelatorioManha(env);
}
