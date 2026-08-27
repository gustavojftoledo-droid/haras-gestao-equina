/**
 * Testa a conversa inteira (Animal e Manejo) sem credenciais: um Firestore falso em memória
 * e as chamadas ao Telegram capturadas. Verifica que a gravação só acontece na confirmação.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { onText, onCallback } from "../src/flows.ts";

// conta de servico de mentira, com uma chave RSA de verdade (pro crypto.subtle assinar sem erro)
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const FAKE_SA = JSON.stringify({
  client_email: "bot@test.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  token_uri: "https://oauth2.googleapis.com/token",
});

// --- Firestore + Telegram falsos via fetch ---
type Store = Record<string, any>;
function makeEnv(store: Store) {
  const kv = new Map<string, string>();
  const sent: { text: string; buttons?: any }[] = [];

  const SESSIONS = {
    async get(k: string, _t?: string) {
      const v = kv.get(k);
      return v == null ? null : JSON.parse(v);
    },
    async put(k: string, v: string) {
      kv.set(k, v);
    },
    async delete(k: string) {
      kv.delete(k);
    },
  };

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    if (url.includes("api.telegram.org")) {
      const body = JSON.parse(init.body);
      if (url.endsWith("/sendMessage")) {
        sent.push({ text: body.text, buttons: body.reply_markup?.inline_keyboard });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (url.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "fake", expires_in: 3600 }), { status: 200 });
    }
    if (url.includes("firestore.googleapis.com")) {
      const m = url.match(/documents\/harasData\/([^?]+)/);
      const doc = m![1];
      if (init?.method === "PATCH") {
        const body = JSON.parse(init.body);
        store[doc] = fromV(body.fields.value);
        return new Response("{}", { status: 200 });
      }
      if (!(doc in store)) return new Response("not found", { status: 404 });
      return new Response(JSON.stringify({ fields: { value: toV(store[doc]) } }), { status: 200 });
    }
    return realFetch(input, init);
  }) as any;

  const env: any = {
    SESSIONS,
    TELEGRAM_TOKEN: "t",
    TELEGRAM_WEBHOOK_SECRET: "s",
    GCP_SERVICE_ACCOUNT: FAKE_SA,
    ALLOWED_CHAT_IDS: "1",
    FIREBASE_PROJECT_ID: "equinos-manager",
    FIRESTORE_COLLECTION: "harasData",
  };
  return { env, sent, restore: () => (globalThis.fetch = realFetch) };
}

// conversores JSON <-> Value do Firestore (qualquer valor no topo, array ou objeto)
function toV(v: any): any {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return v.length ? { arrayValue: { values: v.map(toV) } } : { arrayValue: {} };
  const fields: any = {};
  for (const [k, val] of Object.entries(v)) if (val !== undefined) fields[k] = toV(val);
  return { mapValue: { fields } };
}
function fromV(x: any): any {
  if ("nullValue" in x) return null;
  if ("booleanValue" in x) return x.booleanValue;
  if ("integerValue" in x) return Number(x.integerValue);
  if ("doubleValue" in x) return Number(x.doubleValue);
  if ("stringValue" in x) return x.stringValue;
  if ("arrayValue" in x) return (x.arrayValue.values || []).map(fromV);
  if ("mapValue" in x) {
    const o: any = {};
    for (const [k, val] of Object.entries(x.mapValue.fields || {})) o[k] = fromV(val);
    return o;
  }
  return null;
}

const last = (sent: any[]) => sent[sent.length - 1];

test("fluxo animal: nada grava antes do Confirmar", async () => {
  const store: Store = { horses_list: [{ id: "h_pai", nome: "Vento", situacao: "P", pai: "", mae: "" }], aux_lists: {}, auditoria_log: [] };
  const { env, sent, restore } = makeEnv(store);
  try {
    await onText(env, 1, "/animal");
    await onText(env, 1, "Estopa");
    await onCallback(env, 1, "animal:sexo:FEMININO");
    await onText(env, 1, "26/08/2026");
    await onText(env, 1, "Vento");
    await onText(env, 1, "pular");
    await onText(env, 1, "Tordilho");
    await onText(env, 1, "Potro");
    await onText(env, 1, "Paulo Toledo");
    assert.match(last(sent).text, /incluir um animal novo/);
    assert.equal(store.horses_list.length, 1, "não gravou antes de confirmar");

    await onCallback(env, 1, "confirm:animal");
    assert.equal(store.horses_list.length, 2, "gravou o animal");
    const nova = store.horses_list.find((h) => h.nome === "Estopa");
    assert.equal(nova.sexo, "FEMININO");
    assert.equal(nova.situacao, "P");
    assert.equal(nova.pai, "Vento");
    assert.equal(nova.nascimento, "2026-08-26");
    assert.equal(store.auditoria_log.length, 1);
    assert.equal(store.auditoria_log[0].acao, "inclusao");
    assert.match(last(sent).text, /cadastrado/);
  } finally {
    restore();
  }
});

test("fluxo manejo: Casco com subtipo e data 'hoje'", async () => {
  const store: Store = {
    horses_list: [{ id: "h_1", nome: "Estrela", codigo: "0007" }],
    aux_lists: { subtipoFerrageamento: ["Casqueado completo", "Ferrado completo"] },
    manejos_list: [],
    auditoria_log: [],
  };
  const { env, sent, restore } = makeEnv(store);
  try {
    await onText(env, 1, "/manejo");
    await onCallback(env, 1, "manejo:tipo:Casco");
    await onText(env, 1, "Estrela");
    await onCallback(env, 1, "manejo:pronto:x");
    await onCallback(env, 1, "manejo:subtipo:Ferrado completo");
    await onText(env, 1, "hoje");
    await onText(env, 1, "pular");
    assert.match(last(sent).text, /registrar um manejo/i);
    assert.equal(store.manejos_list.length, 0, "não gravou antes de confirmar");

    await onCallback(env, 1, "confirm:manejo");
    assert.equal(store.manejos_list.length, 1);
    const mj = store.manejos_list[0];
    assert.equal(mj.tipo, "Casco");
    assert.equal(mj.subtipoCasco, "Ferrado completo");
    assert.equal(mj.animais[0].tipo, "Ferrado completo");
    assert.equal(mj.animais[0].id, "h_1");
    assert.match(mj.data, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(store.auditoria_log[0].modulo, "Manejos");
  } finally {
    restore();
  }
});

test("fluxo manejo: Vacina é recusado nesta versão", async () => {
  const store: Store = { horses_list: [], manejos_list: [] };
  const { env, sent, restore } = makeEnv(store);
  try {
    await onText(env, 1, "/manejo");
    await onCallback(env, 1, "manejo:tipo:Casco"); // ok
    // força o caso Vacina por outro caminho: reinicia e manda tipo Vacina via callback
    await onText(env, 1, "/manejo");
    await onCallback(env, 1, "manejo:tipo:Vacina");
    assert.match(last(sent).text, /Vacina e Vermífugo ainda não/);
  } finally {
    restore();
  }
});

test("cancelar limpa a sessão", async () => {
  const store: Store = { horses_list: [] };
  const { env, sent, restore } = makeEnv(store);
  try {
    await onText(env, 1, "/animal");
    await onText(env, 1, "/cancelar");
    assert.match(last(sent).text, /cancelei/i);
    await onText(env, 1, "qualquer coisa");
    assert.match(last(sent).text, /Equinos Manager/); // voltou ao menu
  } finally {
    restore();
  }
});
