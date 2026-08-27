/**
 * Acesso de leitura/escrita ao Firestore do Equinos Manager pela API REST, autenticando
 * com uma conta de servico do Firebase (JWT RS256 -> token OAuth). Sem SDK: so Web APIs,
 * pra rodar num Cloudflare Worker.
 *
 * O banco do app e simples: a colecao `harasData` tem ~25 documentos, cada um no formato
 * { value: <array>, atualizadoEm: <timestamp> }. Aqui a gente le/grava o array `value` inteiro,
 * exatamente como o proprio app faz (storeSet regrava a lista toda).
 */

export interface Env {
  SESSIONS: KVNamespace;
  TELEGRAM_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  GCP_SERVICE_ACCOUNT: string;
  ALLOWED_CHAT_IDS: string;
  FIREBASE_PROJECT_ID: string;
  FIRESTORE_COLLECTION: string;
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

// ---- conversao JSON <-> formato "Value" tipado do Firestore ----

function toValue(v: unknown): any {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return { nullValue: null };
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) {
    return v.length ? { arrayValue: { values: v.map(toValue) } } : { arrayValue: {} };
  }
  if (typeof v === "object") {
    const fields: Record<string, any> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val === undefined) continue;
      fields[k] = toValue(val);
    }
    return Object.keys(fields).length ? { mapValue: { fields } } : { mapValue: {} };
  }
  return { nullValue: null };
}

function fromValue(v: any): Json {
  if (v == null) return null;
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return !!v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("stringValue" in v) return v.stringValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromValue);
  if ("mapValue" in v) {
    const out: Record<string, Json> = {};
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) out[k] = fromValue(val);
    return out;
  }
  return null;
}

// ---- token OAuth da conta de servico ----

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const raw = atob(body);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

async function getAccessToken(env: Env): Promise<string> {
  const cached = await env.SESSIONS.get("gcp_token", "json") as { token: string; exp: number } | null;
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp > now + 60) return cached.token;

  const sa = JSON.parse(env.GCP_SERVICE_ACCOUNT) as {
    client_email: string;
    private_key: string;
    token_uri?: string;
  };
  const tokenUri = sa.token_uri || "https://oauth2.googleapis.com/token";
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${b64url(new TextEncoder().encode(JSON.stringify(header)))}.${b64url(
    new TextEncoder().encode(JSON.stringify(claim)),
  )}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${b64url(sig)}`;

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`token OAuth falhou: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  await env.SESSIONS.put(
    "gcp_token",
    JSON.stringify({ token: data.access_token, exp: now + data.expires_in - 120 }),
    { expirationTtl: Math.max(120, data.expires_in) },
  );
  return data.access_token;
}

// ---- get / set de um documento (a lista `value` inteira) ----

function docUrl(env: Env, docId: string): string {
  return `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${env.FIRESTORE_COLLECTION}/${docId}`;
}

export async function getList(env: Env, docId: string): Promise<any[]> {
  const token = await getAccessToken(env);
  const res = await fetch(docUrl(env, docId), { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Firestore GET ${docId}: ${res.status} ${await res.text()}`);
  const doc = (await res.json()) as { fields?: { value?: any } };
  const val = doc.fields?.value ? fromValue(doc.fields.value) : [];
  return Array.isArray(val) ? val : [];
}

export async function getMap(env: Env, docId: string): Promise<Record<string, any>> {
  const token = await getAccessToken(env);
  const res = await fetch(docUrl(env, docId), { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 404) return {};
  if (!res.ok) throw new Error(`Firestore GET ${docId}: ${res.status} ${await res.text()}`);
  const doc = (await res.json()) as { fields?: { value?: any } };
  const val = doc.fields?.value ? fromValue(doc.fields.value) : {};
  return val && typeof val === "object" && !Array.isArray(val) ? (val as Record<string, any>) : {};
}

export async function setList(env: Env, docId: string, list: any[]): Promise<void> {
  const token = await getAccessToken(env);
  const body = {
    fields: {
      value: toValue(list),
      atualizadoEm: { timestampValue: new Date().toISOString() },
    },
  };
  const res = await fetch(docUrl(env, docId), {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Firestore PATCH ${docId}: ${res.status} ${await res.text()}`);
}

export { toValue as _toValue, fromValue as _fromValue };
