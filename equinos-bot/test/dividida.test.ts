/** Lista dividida em vários documentos (estoque_movimentos -> emov_*): o robô junta tudo; sem recibo lê o documento único. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { getMovimentosEstoque } from "../src/firestore.ts";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const FAKE_SA = JSON.stringify({
  client_email: "bot@test.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  token_uri: "https://oauth2.googleapis.com/token",
});
function toV(v: any): any {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toV) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toV(x)])) } };
}
function comBanco(store: Record<string, any>, falhar: Set<string> = new Set()) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "x", expires_in: 3600 }), { status: 200 });
    if (url.includes("firestore.googleapis.com")) {
      const doc = url.match(/documents\/harasData\/([^?]+)/)![1];
      if (falhar.has(doc)) return new Response("boom", { status: 500 });
      if (!(doc in store)) return new Response("nf", { status: 404 });
      return new Response(JSON.stringify({ fields: { value: toV(store[doc]) } }), { status: 200 });
    }
    return real(input);
  }) as any;
  const kv = new Map<string, string>();
  const SESSIONS = { async get(k: string) { const v = kv.get(k); return v == null ? null : JSON.parse(v); }, async put(k: string, v: string) { kv.set(k, v); }, async delete(k: string) { kv.delete(k); } };
  const env: any = { SESSIONS, GCP_SERVICE_ACCOUNT: FAKE_SA, FIREBASE_PROJECT_ID: "p", FIRESTORE_COLLECTION: "harasData" };
  return { env, restore: () => (globalThis.fetch = real) };
}

test("sem recibo: lê o documento único", async () => {
  const { env, restore } = comBanco({ estoque_movimentos: [{ id: "a" }, { id: "b" }] });
  try { assert.deepEqual((await getMovimentosEstoque(env)).map((r) => r.id), ["a", "b"]); } finally { restore(); }
});
test("com recibo: junta os meses e ignora o documento único congelado", async () => {
  const { env, restore } = comBanco({
    estoque_movimentos: [{ id: "velho" }],
    emov_indice: { versao: 1, docs: ["emov_2026-09", "emov_2026-10"] },
    "emov_2026-09": [{ id: "a" }, { id: "b" }],
    "emov_2026-10": [{ id: "b" }, { id: "c" }],
  });
  try { assert.deepEqual((await getMovimentosEstoque(env)).map((r) => r.id), ["a", "b", "c"]); } finally { restore(); }
});
test("recibo revertido (versao 0): volta ao documento único", async () => {
  const { env, restore } = comBanco({ estoque_movimentos: [{ id: "a" }], emov_indice: { versao: 0, revertidoEm: "x" }, "emov_2026-09": [{ id: "z" }] });
  try { assert.deepEqual((await getMovimentosEstoque(env)).map((r) => r.id), ["a"]); } finally { restore(); }
});
test("um mês ilegível: erro, nunca lista parcial", async () => {
  const { env, restore } = comBanco({ emov_indice: { versao: 1, docs: ["m1", "m2"] }, m1: [{ id: "a" }], m2: [{ id: "b" }] }, new Set(["m2"]));
  try { await assert.rejects(() => getMovimentosEstoque(env)); } finally { restore(); }
});
