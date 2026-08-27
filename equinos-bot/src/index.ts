/**
 * equinos-bot — bot do Telegram com menu guiado (sem IA) pra cadastrar Animal e registrar
 * Manejo no Equinos Manager. Grava direto no Firestore do app, com prévia + Confirmar.
 *
 * Rotas:
 *   POST /webhook/<TELEGRAM_WEBHOOK_SECRET>   -> updates do Telegram
 *   GET  /                                    -> healthcheck
 */
import type { Env } from "./firestore.ts";
import { answerCallback, sendMessage } from "./telegram.ts";
import { onCallback, onText } from "./flows.ts";

function autorizado(env: Env, chatId: number): boolean {
  const ids = (env.ALLOWED_CHAT_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return ids.includes(String(chatId));
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/") {
      return new Response("equinos-bot ok", { status: 200 });
    }

    if (req.method === "POST" && url.pathname === `/webhook/${env.TELEGRAM_WEBHOOK_SECRET}`) {
      // Confere tambem o header secreto do Telegram (definido no setWebhook).
      const header = req.headers.get("x-telegram-bot-api-secret-token");
      if (header !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }

      let update: any;
      try {
        update = await req.json();
      } catch {
        return new Response("bad json", { status: 400 });
      }

      // Responde 200 rapido pro Telegram e processa em background.
      ctx.waitUntil(handleUpdate(env, update).catch((e) => console.error("handleUpdate:", e)));
      return new Response("ok", { status: 200 });
    }

    return new Response("not found", { status: 404 });
  },
};

async function handleUpdate(env: Env, update: any): Promise<void> {
  if (update.message && update.message.chat) {
    const chatId = update.message.chat.id as number;
    if (!autorizado(env, chatId)) {
      await sendMessage(env, chatId, `Sem permissão. (seu chat id: ${chatId})`);
      return;
    }
    if (update.message.voice || update.message.audio) {
      await sendMessage(
        env,
        chatId,
        "Essa versão ainda não entende áudio — digite o comando, ou use os botões. (/start)",
      );
      return;
    }
    const texto = update.message.text || "";
    await onText(env, chatId, texto);
    return;
  }

  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message?.chat?.id as number;
    await answerCallback(env, cq.id);
    if (chatId == null) return;
    if (!autorizado(env, chatId)) {
      await sendMessage(env, chatId, `Sem permissão. (seu chat id: ${chatId})`);
      return;
    }
    await onCallback(env, chatId, cq.data || "");
    return;
  }
}
