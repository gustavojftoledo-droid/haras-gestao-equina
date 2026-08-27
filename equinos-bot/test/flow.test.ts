/**
 * Testa a conversa em modo "bloco" (Animal e Manejo) sem credenciais: Firestore falso em
 * memória, Telegram capturado, e uma chave RSA de verdade pro JWT.
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

type Store = Record<string, any>;
function makeEnv(store: Store) {
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

test("animal: bloco completo → prévia → confirma grava", async () => {
  const store: Store = { horses_list: [{ id: "h_v", nome: "Vento", situacao: "P", pai: "Raio", mae: "Lua" }], aux_lists: {}, auditoria_log: [] };
  const { env, sent, restore } = makeEnv(store);
  try {
    await onText(env, 1, "/animal");
    await onText(
      env,
      1,
      "Nome: Estopa\nSexo: fêmea\nNascimento: 26/08/2026\nPai: Vento\nMãe: \nPelagem: Tordilho\nCategoria: Potro\nProprietário: Paulo Toledo",
    );
    assert.match(last(sent).text, /incluir um animal novo/);
    assert.match(last(sent).text, /Estopa/);
    assert.equal(store.horses_list.length, 1, "nada gravado antes de confirmar");

    await onCallback(env, 1, "confirm:animal");
    assert.equal(store.horses_list.length, 2);
    const nova = store.horses_list.find((h) => h.nome === "Estopa");
    assert.equal(nova.sexo, "FEMININO");
    assert.equal(nova.situacao, "P");
    assert.equal(nova.nascimento, "2026-08-26");
    assert.equal(nova.pai, "Vento");
    assert.equal(nova.avopat, "Raio"); // herdou avós do pai
    assert.equal(store.auditoria_log[0].acao, "inclusao");
    assert.deepEqual(store.aux_lists.pelagem, ["Tordilho"]);
  } finally {
    restore();
  }
});

test("animal: modelo em branco (só labels) → pede pra preencher", async () => {
  const store: Store = { horses_list: [], aux_lists: {}, auditoria_log: [] };
  const { env, sent, restore } = makeEnv(store);
  try {
    await onText(env, 1, "/animal");
    await onText(env, 1, "Nome: \nSexo: (macho ou fêmea)\nNascimento: (dd/mm/aaaa)\nPai: \nMãe: ");
    assert.match(last(sent).text, /Faltou ajustar/);
    assert.match(last(sent).text, /Nome/);
    assert.match(last(sent).text, /Sexo/);
    assert.equal(store.horses_list.length, 0);
  } finally {
    restore();
  }
});

test("animal: data inválida é recusada", async () => {
  const store: Store = { horses_list: [], aux_lists: {}, auditoria_log: [] };
  const { env, sent, restore } = makeEnv(store);
  try {
    await onText(env, 1, "/animal");
    await onText(env, 1, "Nome: Teste\nSexo: macho\nNascimento: 31/02/2020");
    assert.match(last(sent).text, /Nascimento.*dd\/mm\/aaaa/s);
  } finally {
    restore();
  }
});

test("manejo: Casco, vários animais numa linha, data hoje", async () => {
  const store: Store = {
    horses_list: [
      { id: "h_1", nome: "Estrela" },
      { id: "h_2", nome: "Vento" },
      { id: "h_3", nome: "Aurora" },
    ],
    manejos_list: [],
    auditoria_log: [],
  };
  const { env, sent, restore } = makeEnv(store);
  try {
    await onText(env, 1, "/manejo");
    await onText(env, 1, "Tipo: Casco\nFerrageamento: Ferrado completo\nData: hoje\nAnimais: Estrela, Vento, Aurora\nObs: rotina");
    assert.match(last(sent).text, /registrar um manejo/i);
    assert.match(last(sent).text, /Animais \(3\)/);
    assert.equal(store.manejos_list.length, 0);

    await onCallback(env, 1, "confirm:manejo");
    assert.equal(store.manejos_list.length, 1);
    const mj = store.manejos_list[0];
    assert.equal(mj.tipo, "Casco");
    assert.equal(mj.subtipoCasco, "Ferrado completo");
    assert.equal(mj.animais.length, 3);
    assert.equal(mj.animais[0].tipo, "Ferrado completo");
    assert.equal(mj.obs, "rotina");
    assert.match(mj.data, /^\d{4}-\d{2}-\d{2}$/);
  } finally {
    restore();
  }
});

test("manejo: animal inexistente é apontado, nada grava", async () => {
  const store: Store = { horses_list: [{ id: "h_1", nome: "Estrela" }], manejos_list: [], auditoria_log: [] };
  const { env, sent, restore } = makeEnv(store);
  try {
    await onText(env, 1, "/manejo");
    await onText(env, 1, "Tipo: Dente\nData: 01/08/2026\nAnimais: Estrela, Fantasma");
    assert.match(last(sent).text, /Não achei.*Fantasma/s);
    assert.equal(store.manejos_list.length, 0);
  } finally {
    restore();
  }
});

test("manejo: Vacina é recusada", async () => {
  const store: Store = { horses_list: [{ id: "h_1", nome: "Estrela" }], manejos_list: [] };
  const { env, sent, restore } = makeEnv(store);
  try {
    await onText(env, 1, "/manejo");
    await onText(env, 1, "Tipo: Vacina\nAnimais: Estrela");
    assert.match(last(sent).text, /Vacina e Vermífugo dependem/);
  } finally {
    restore();
  }
});

test("/start abre o menu e /cancelar limpa", async () => {
  const store: Store = { horses_list: [] };
  const { env, sent, restore } = makeEnv(store);
  try {
    await onText(env, 1, "/animal");
    await onText(env, 1, "/cancelar");
    assert.match(last(sent).text, /cancelei/i);
    await onText(env, 1, "oi");
    assert.match(last(sent).text, /Equinos Manager/);
  } finally {
    restore();
  }
});
