/** Chamadas simples a API do Telegram Bot. */
import type { Env } from "./firestore.ts";

const api = (env: Env, method: string) =>
  `https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/${method}`;

export interface InlineButton {
  text: string;
  data: string;
}

export async function sendMessage(
  env: Env,
  chatId: number | string,
  text: string,
  buttons?: InlineButton[][],
): Promise<void> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (buttons) {
    body.reply_markup = {
      inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))),
    };
  }
  const res = await fetch(api(env, "sendMessage"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error("sendMessage falhou:", res.status, await res.text());
}

export async function answerCallback(env: Env, callbackId: string, text?: string): Promise<void> {
  await fetch(api(env, "answerCallbackQuery"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackId, text: text || "" }),
  });
}

/** Baixa o texto de uma nota de voz nao e suportado nesta versao basica (sem IA/transcricao). */
export function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
