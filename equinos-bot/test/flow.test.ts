/**
 * Testa a conversa com a IA "mockada" (a chamada ao Claude é interceptada e devolve um
 * tool_use canned). Firestore falso em memória, Telegram capturado, chave RSA de verdade.
 * O foco: nada grava antes do Confirmar, e o que grava tem o formato certo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { onText, onCallback } from "../src/flows.ts";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const FAKE_SA = JSON.stringify({
  client_email: "bot@test.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  token_uri: "https://oauth2.googleapis.com/token",
});

type IAResp =
  | { tool: "criar_animal" | "registrar_manejo"; input: any }
  | { texto: string };

type Store = Record<string, any>;
function makeEnv(store: Store, iaFila: IAResp[]) {
  const kv = new Map<string, string>();
  const sent: { text: string; buttons?: any }[] = [];

  const SESSIONS = {
    async get(k: string) {
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
      if (url.endsWith("/sendMessage")) sent.push({ text: body.text, buttons: body.reply_markup?.inline_keyboard });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (url.includes("api.anthropic.com")) {
      const next = iaFila.shift();
      let content: any[];
      if (next && "tool" in next) {
        content = [{ type: "tool_use", id: "tu_1", name: next.tool, input: next.input }];
      } else {
        content = [{ type: "text", text: next ? next.texto : "..." }];
      }
      return new Response(
        JSON.stringify({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-haiku-4-5",
          stop_reason: next && "tool" in next ? "tool_use" : "end_turn",
          content,
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "fake", expires_in: 3600 }), { status: 200 });
    }
    if (url.includes("firestore.googleapis.com")) {
      const doc = url.match(/documents\/harasData\/([^?]+)/)![1];
      if (init?.method === "PATCH") {
        store[doc] = fromV(JSON.parse(init.body).fields.value);
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
    ANTHROPIC_API_KEY: "sk-test",
    ALLOWED_CHAT_IDS: "1",
    FIREBASE_PROJECT_ID: "equinos-manager",
    FIRESTORE_COLLECTION: "harasData",
  };
  return { env, sent, restore: () => (globalThis.fetch = realFetch) };
}

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
const last = (s: any[]) => s[s.length - 1];

test("animal: frase solta → prévia → confirma grava", async () => {
  const store: Store = { horses_list: [{ id: "h_v", nome: "Vento", situacao: "P", pai: "Raio", mae: "Lua" }], aux_lists: {}, auditoria_log: [] };
  const { env, sent, restore } = makeEnv(store, [
    { tool: "criar_animal", input: { nome: "Estopa", sexo: "FEMININO", nascimento: "2026-08-26", pai: "Vento", pelagem: "Tordilho", proprietario: "Paulo Toledo" } },
  ]);
  try {
    await onText(env, 1, "cadastra a estopa, fêmea, filha do vento, nascida ontem, tordilha, do paulo");
    assert.match(last(sent).text, /cadastrar um animal/);
    assert.match(last(sent).text, /Estopa/);
    assert.equal(store.horses_list.length, 1, "nada antes do confirmar");

    await onCallback(env, 1, "confirm:animal");
    assert.equal(store.horses_list.length, 2);
    const nova = store.horses_list.find((h) => h.nome === "Estopa");
    assert.equal(nova.sexo, "FEMININO");
    assert.equal(nova.situacao, "P");
    assert.equal(nova.nascimento, "2026-08-26");
    assert.equal(nova.pai, "Vento");
    assert.equal(nova.avopat, "Raio");
    assert.equal(store.auditoria_log[0].acao, "inclusao");
  } finally {
    restore();
  }
});

test("animal: IA pede o sexo → pergunta chega, nada grava", async () => {
  const store: Store = { horses_list: [], aux_lists: {}, auditoria_log: [] };
  const { env, sent, restore } = makeEnv(store, [{ texto: "Qual o sexo da Estopa?" }]);
  try {
    await onText(env, 1, "cadastra a estopa");
    assert.match(last(sent).text, /sexo/i);
    assert.equal(store.horses_list.length, 0);
  } finally {
    restore();
  }
});

test("manejo: 1 registro c/ 3 animais, valorBase da config, ferrador e extra por animal", async () => {
  const store: Store = {
    horses_list: [
      { id: "h1", nome: "Rosa" },
      { id: "h2", nome: "Tirania" },
      { id: "h3", nome: "Tulipa" },
    ],
    aux_lists: { subtipoFerrageamento: ["Ferrado completo", "Casqueado completo"] },
    config: { valoresCasco: { "Ferrado completo": 200 } },
    manejos_list: [],
    auditoria_log: [],
  };
  const { env, sent, restore } = makeEnv(store, [
    {
      tool: "registrar_manejo",
      input: {
        tipo: "Casco",
        ferrageamento: "Ferrado completo",
        ferrador: "Catraca",
        animais: ["Rosa", "Tirania", "Tulipa"],
        valores_extra: [{ animal: "Rosa", valor: 150 }],
      },
    },
  ]);
  try {
    await onText(env, 1, "ferrei hoje a rosa, tirania e tulipa, ferrador catraca, ferradura fechada 150 na rosa");
    assert.match(last(sent).text, /Animais \(3\)/);
    assert.match(last(sent).text, /Ferrador:.*Catraca/s);
    assert.match(last(sent).text, /refer.ncia.*200/s);
    assert.match(last(sent).text, /Extra:.*Rosa/s);
    assert.equal(store.manejos_list.length, 0);

    await onCallback(env, 1, "confirm:manejo");
    const mj = store.manejos_list[0];
    assert.equal(mj.animais.length, 3);
    assert.equal(mj.ferrador, "Catraca");
    assert.equal(mj.animais[0].tipo, "Ferrado completo");
    assert.equal(mj.animais[0].valorBase, 200);
    assert.equal(mj.animais.find((a: any) => a.nome === "Rosa").valorExtra, 150);
  } finally {
    restore();
  }
});

test("manejo: animal que não existe → pergunta, nada grava", async () => {
  const store: Store = { horses_list: [{ id: "h1", nome: "Rosa" }], aux_lists: {}, manejos_list: [], auditoria_log: [] };
  const { env, sent, restore } = makeEnv(store, [
    { tool: "registrar_manejo", input: { tipo: "Dente", animais: ["Rosa", "Fantasma"] } },
  ]);
  try {
    await onText(env, 1, "cheque dental na rosa e no fantasma");
    assert.match(last(sent).text, /Não achei.*Fantasma/s);
    assert.equal(store.manejos_list.length, 0);
  } finally {
    restore();
  }
});

test("manejo: Vacina grava sem mexer no estoque, com aviso", async () => {
  const store: Store = { horses_list: [{ id: "h1", nome: "Rosa" }], aux_lists: {}, config: {}, manejos_list: [], auditoria_log: [] };
  const { env, sent, restore } = makeEnv(store, [
    { tool: "registrar_manejo", input: { tipo: "Vacina", medicamento: "Lexington Gold", quantidade: 2, animais: ["Rosa"] } },
  ]);
  try {
    await onText(env, 1, "vacinei a rosa com lexington gold, 2ml");
    assert.match(last(sent).text, /Produto:.*Lexington Gold/s);
    assert.match(last(sent).text, /pendente de baixa/i);
    await onCallback(env, 1, "confirm:manejo");
    const mj = store.manejos_list[0];
    assert.equal(mj.tipo, "Vacina");
    assert.equal(mj.medicamentoId, null);
    assert.equal(mj.medicamentoNome, "Lexington Gold");
    assert.equal(mj.medQuantidade, 2);
    assert.equal(mj.pendenteEstoque, true);
    assert.equal(mj.origem, "chatbot");
    assert.equal(store.estoque_movimentos, undefined); // nada de baixa
    assert.match(last(sent).text, /PENDENTE/i);
  } finally {
    restore();
  }
});

test("manejo: Dente com valor por animal", async () => {
  const store: Store = { horses_list: [{ id: "h1", nome: "Rosa" }], aux_lists: {}, config: {}, manejos_list: [], auditoria_log: [] };
  const { env, sent, restore } = makeEnv(store, [
    { tool: "registrar_manejo", input: { tipo: "Dente", valor: 80, animais: ["Rosa"] } },
  ]);
  try {
    await onText(env, 1, "cheque dental na rosa, 80 reais");
    assert.match(last(sent).text, /Valor:.*80/s);
    await onCallback(env, 1, "confirm:manejo");
    const mj = store.manejos_list[0];
    assert.equal(mj.tipo, "Dente");
    assert.equal(mj.valor, 80);
    assert.equal(mj.animais[0].valorBase, 80);
    assert.equal(mj.ferrador, undefined);
  } finally {
    restore();
  }
});

test("/cancelar limpa a sessão", async () => {
  const store: Store = { horses_list: [], aux_lists: {} };
  const { env, sent, restore } = makeEnv(store, [{ texto: "Qual o sexo?" }]);
  try {
    await onText(env, 1, "cadastra a estrela");
    await onText(env, 1, "/cancelar");
    assert.match(last(sent).text, /esqueci/i);
  } finally {
    restore();
  }
});
