/**
 * Conversas do bot — modo "bloco": o usuario preenche um modelo (uma informacao por linha,
 * "Campo: valor") e manda tudo numa mensagem so. O bot valida, mostra a previa e so grava
 * no "Confirmar". Na confirmacao rele o Firestore (nao sobrescreve edicao feita no app).
 * Sem IA.
 */
import type { Env } from "./firestore.ts";
import { getList, getMap, setList } from "./firestore.ts";
import { sendMessage, esc } from "./telegram.ts";
import {
  acharAnimal,
  auditEntrada,
  ensureExternalAnimal,
  fmtDataBR,
  hojeISO,
  montarAnimal,
  montarManejo,
  norm,
  parseDataBR,
  registrarAux,
  titleCase,
  type Horse,
} from "./domain.ts";

export interface Session {
  flow: "animal" | "manejo" | null;
  step: "bloco" | "confirm";
  data: Record<string, any>;
}

const KEY = (chatId: number) => `sess:${chatId}`;

async function load(env: Env, chatId: number): Promise<Session | null> {
  return (await env.SESSIONS.get(KEY(chatId), "json")) as Session | null;
}
async function save(env: Env, chatId: number, s: Session): Promise<void> {
  await env.SESSIONS.put(KEY(chatId), JSON.stringify(s), { expirationTtl: 3600 });
}
async function clear(env: Env, chatId: number): Promise<void> {
  await env.SESSIONS.delete(KEY(chatId));
}

// ---------- modelos ----------

const MODELO_ANIMAL =
  "🐴 <b>Novo animal</b> — copie, preencha e mande de volta numa mensagem só.\n" +
  "Pode deixar linhas em branco (menos o Nome). Ordem não importa.\n\n" +
  "<code>Nome: \n" +
  "Sexo: (macho ou fêmea)\n" +
  "Nascimento: (dd/mm/aaaa)\n" +
  "Pai: \n" +
  "Mãe: \n" +
  "Pelagem: \n" +
  "Categoria: \n" +
  "Proprietário: </code>";

const MODELO_MANEJO =
  "📋 <b>Registrar manejo</b> — copie, preencha e mande de volta numa mensagem só.\n\n" +
  "<code>Tipo: (Casco, Dente, Vermifugação…)\n" +
  "Ferrageamento: (só se for Casco)\n" +
  "Data: hoje\n" +
  "Animais: nome1, nome2, nome3\n" +
  "Obs: </code>\n\n" +
  "Vários animais na mesma linha, separados por vírgula.\n" +
  "Vacina e Vermífugo com baixa de estoque: use o app.";

// ---------- parser de bloco ----------

/** "Campo: valor" por linha -> Map (chave sem acento, minúscula). Também aceita o modelo de labels vazio. */
function parseBloco(texto: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const linha of texto.split(/\r?\n/)) {
    const mm = linha.match(/^\s*([\p{L} /]+?)\s*[:：]\s*(.*)$/u);
    if (mm) {
      const chave = norm(mm[1]);
      const valor = mm[2].trim().replace(/^\((.*)\)$/, "").trim(); // ignora dicas tipo "(dd/mm/aaaa)"
      m.set(chave, valor);
    }
  }
  return m;
}
function pega(m: Map<string, string>, ...chaves: string[]): string {
  for (const c of chaves) {
    const v = m.get(c);
    if (v != null && v !== "") return v;
  }
  return "";
}
function parseSexo(v: string): "MASCULINO" | "FEMININO" | null {
  const n = norm(v);
  if (!n) return null;
  if (n.startsWith("m")) return "MASCULINO";
  if (n.startsWith("f")) return "FEMININO";
  return null;
}

// ---------- entrada ----------

export async function onText(env: Env, chatId: number, textoRaw: string): Promise<void> {
  const texto = (textoRaw || "").trim();
  const lower = texto.toLowerCase();

  if (lower === "/start" || lower === "/ajuda" || lower === "/help") {
    await clear(env, chatId);
    return menu(env, chatId);
  }
  if (lower === "/cancelar" || lower === "cancelar") {
    await clear(env, chatId);
    return sendMessage(env, chatId, "Ok, cancelei. Manda /start pra recomeçar.");
  }
  if (lower === "/animal" || lower === "/novoanimal") return startAnimal(env, chatId);
  if (lower === "/manejo") return startManejo(env, chatId);

  const s = await load(env, chatId);
  if (!s || !s.flow) return menu(env, chatId);
  if (s.step !== "bloco") {
    return sendMessage(env, chatId, "Toque em <b>Confirmar</b> ou <b>Cancelar</b> na mensagem acima. Ou /cancelar.");
  }
  if (s.flow === "animal") return receberBlocoAnimal(env, chatId, s, texto);
  if (s.flow === "manejo") return receberBlocoManejo(env, chatId, s, texto);
}

export async function onCallback(env: Env, chatId: number, data: string): Promise<void> {
  const [flow, action] = data.split(":");
  if (flow === "menu") {
    if (action === "animal") return startAnimal(env, chatId);
    if (action === "manejo") return startManejo(env, chatId);
    return;
  }
  if (flow === "cancel") {
    await clear(env, chatId);
    return sendMessage(env, chatId, "Cancelado. Manda /start pra recomeçar.");
  }
  const s = await load(env, chatId);
  if (flow === "confirm" && s && s.step === "confirm") {
    if (action === "animal" && s.flow === "animal") return confirmarAnimal(env, chatId, s);
    if (action === "manejo" && s.flow === "manejo") return confirmarManejo(env, chatId, s);
  }
}

function menu(env: Env, chatId: number): Promise<void> {
  return sendMessage(env, chatId, "🐴 <b>Equinos Manager</b>\nO que você quer fazer?", [
    [{ text: "🐴 Cadastrar animal", data: "menu:animal" }],
    [{ text: "📋 Registrar manejo", data: "menu:manejo" }],
  ]);
}

// ================= CADASTRAR ANIMAL =================

async function startAnimal(env: Env, chatId: number): Promise<void> {
  await save(env, chatId, { flow: "animal", step: "bloco", data: {} });
  await sendMessage(env, chatId, MODELO_ANIMAL);
}

async function receberBlocoAnimal(env: Env, chatId: number, s: Session, texto: string): Promise<void> {
  const m = parseBloco(texto);
  const erros: string[] = [];

  const nome = pega(m, "nome");
  if (!nome) erros.push("• falta o <b>Nome</b>");

  let sexo: "MASCULINO" | "FEMININO" | null = null;
  const sexoRaw = pega(m, "sexo");
  if (sexoRaw) {
    sexo = parseSexo(sexoRaw);
    if (!sexo) erros.push("• <b>Sexo</b>: escreva <i>macho</i> ou <i>fêmea</i>");
  } else {
    erros.push("• falta o <b>Sexo</b> (macho ou fêmea)");
  }

  let nascimento = "";
  const nascRaw = pega(m, "nascimento", "nasc", "data de nascimento");
  if (nascRaw) {
    const iso = parseDataBR(nascRaw);
    if (!iso) erros.push("• <b>Nascimento</b>: use dd/mm/aaaa");
    else nascimento = iso;
  }

  if (m.size === 0) {
    return sendMessage(env, chatId, "Não entendi. Use o modelo (uma linha por campo, <i>Campo: valor</i>):\n\n" + MODELO_ANIMAL);
  }
  if (erros.length) {
    return sendMessage(env, chatId, "Faltou ajustar:\n" + erros.join("\n") + "\n\nCorrija e mande de novo.");
  }

  s.data = {
    nome,
    sexo,
    nascimento,
    pai: pega(m, "pai"),
    mae: pega(m, "mae"),
    pelagem: pega(m, "pelagem"),
    categoria: pega(m, "categoria"),
    proprietario: pega(m, "proprietario", "dono"),
  };
  s.step = "confirm";
  await save(env, chatId, s);

  const d = s.data;
  const linha = (k: string, v?: string) => (v ? `\n<b>${k}:</b> ${esc(v)}` : "");
  await sendMessage(
    env,
    chatId,
    "Vou <b>incluir um animal novo</b>:" +
      linha("Nome", titleCase(d.nome)) +
      linha("Sexo", d.sexo === "FEMININO" ? "Fêmea" : "Macho") +
      linha("Nascimento", d.nascimento ? fmtDataBR(d.nascimento) : "") +
      linha("Pai", d.pai ? titleCase(d.pai) : "") +
      linha("Mãe", d.mae ? titleCase(d.mae) : "") +
      linha("Pelagem", d.pelagem ? titleCase(d.pelagem) : "") +
      linha("Categoria", d.categoria ? titleCase(d.categoria) : "") +
      linha("Proprietário", d.proprietario ? titleCase(d.proprietario) : "") +
      "\n<b>Situação:</b> Interno",
    [[{ text: "✔ Confirmar", data: "confirm:animal" }, { text: "Cancelar", data: "cancel:x" }]],
  );
}

async function confirmarAnimal(env: Env, chatId: number, s: Session): Promise<void> {
  await sendMessage(env, chatId, "Gravando…");
  try {
    const horses = (await getList(env, "horses_list")) as Horse[];
    const aux = await getMap(env, "aux_lists");
    const d = s.data;

    if (acharAnimal(horses, d.nome)) {
      await clear(env, chatId);
      return sendMessage(env, chatId, `Já existe um animal chamado <b>${esc(titleCase(d.nome))}</b>. Não cadastrei de novo.`);
    }

    const criados: string[] = [];
    if (d.pai) {
      const r = ensureExternalAnimal(horses, d.pai, "MASCULINO");
      if (r.criado) criados.push(`${r.horse.nome} (pai, externo)`);
    }
    if (d.mae) {
      const r = ensureExternalAnimal(horses, d.mae, "FEMININO");
      if (r.criado) criados.push(`${r.horse.nome} (mãe, externo)`);
    }

    const animal = montarAnimal(horses, d as any);
    horses.push(animal);
    await setList(env, "horses_list", horses);

    if (registrarAux(aux as Record<string, string[]>, animal)) {
      await setList(env, "aux_lists", aux as any);
    }
    const log = await getList(env, "auditoria_log");
    await setList(env, "auditoria_log", auditEntrada(log, "inclusao", "Animais", animal.nome, animal.id));

    await clear(env, chatId);
    await sendMessage(
      env,
      chatId,
      `✅ <b>${esc(animal.nome)}</b> cadastrado (código ${animal.codigo}).` +
        (criados.length ? `\nTambém entraram: ${esc(criados.join(", "))}.` : "") +
        `\nRegistrado na auditoria como “via chatbot”.`,
    );
  } catch (e: any) {
    await clear(env, chatId);
    await sendMessage(env, chatId, `❌ Erro ao gravar: ${esc(String(e?.message || e))}\nNada foi salvo.`);
  }
}

// ================= REGISTRAR MANEJO =================

async function startManejo(env: Env, chatId: number): Promise<void> {
  await save(env, chatId, { flow: "manejo", step: "bloco", data: {} });
  await sendMessage(env, chatId, MODELO_MANEJO);
}

function normalizarTipo(raw: string): { tipo: string; recusado?: boolean } {
  const n = norm(raw);
  if (n.startsWith("casco") || n.startsWith("casque") || n.startsWith("ferr")) return { tipo: "Casco" };
  if (n.startsWith("dente") || n.startsWith("odont")) return { tipo: "Dente" };
  if (n.startsWith("vacin") || n.startsWith("vermif") || n.startsWith("verminos")) return { tipo: raw, recusado: true };
  return { tipo: titleCase(raw) };
}

async function receberBlocoManejo(env: Env, chatId: number, s: Session, texto: string): Promise<void> {
  const m = parseBloco(texto);
  if (m.size === 0) {
    return sendMessage(env, chatId, "Não entendi. Use o modelo:\n\n" + MODELO_MANEJO);
  }

  const tipoRaw = pega(m, "tipo", "manejo");
  if (!tipoRaw) return sendMessage(env, chatId, "Falta o <b>Tipo</b> (ex: Casco, Dente).");
  const { tipo, recusado } = normalizarTipo(tipoRaw);
  if (recusado) {
    await clear(env, chatId);
    return sendMessage(env, chatId, "Vacina e Vermífugo dependem do controle de estoque — faça esses pelo app. Cancelei aqui.");
  }

  const animaisRaw = pega(m, "animais", "animal", "cavalos", "cavalo");
  if (!animaisRaw) return sendMessage(env, chatId, "Falta a linha <b>Animais:</b> (um ou mais nomes, separados por vírgula).");

  const horses = (await getList(env, "horses_list")) as Horse[];
  const termos = animaisRaw.split(/[,;\n]+/).map((t) => t.trim()).filter(Boolean);
  const achados: { id: string; nome: string }[] = [];
  const naoAchados: string[] = [];
  const ambiguos: string[] = [];
  for (const termo of termos) {
    const alvo = norm(termo);
    const exato = horses.filter((h) => norm(h.nome) === alvo);
    const lista = exato.length ? exato : horses.filter((h) => norm(h.nome).includes(alvo));
    if (lista.length === 0) naoAchados.push(termo);
    else if (lista.length > 1) ambiguos.push(termo);
    else if (!achados.some((a) => a.id === lista[0].id)) achados.push({ id: lista[0].id, nome: lista[0].nome });
  }
  if (naoAchados.length || ambiguos.length) {
    let msg = "";
    if (naoAchados.length) msg += `Não achei: <b>${esc(naoAchados.join(", "))}</b>\n`;
    if (ambiguos.length) msg += `Tem mais de um com: <b>${esc(ambiguos.join(", "))}</b> — escreva o nome completo.\n`;
    return sendMessage(env, chatId, msg + "Corrija a linha Animais e mande de novo.");
  }

  let data = hojeISO();
  const dataRaw = pega(m, "data", "quando");
  if (dataRaw && !/^hoje|hj|agora$/i.test(dataRaw.trim())) {
    const iso = parseDataBR(dataRaw);
    if (!iso) return sendMessage(env, chatId, "<b>Data</b> não entendida. Use dd/mm/aaaa ou <i>hoje</i>.");
    data = iso;
  }

  s.data = {
    tipo,
    subtipoCasco: tipo === "Casco" ? pega(m, "ferrageamento", "ferrageamento (so se for casco)", "subtipo", "tipo de ferrageamento") : "",
    data,
    obs: pega(m, "obs", "observacao", "observacoes"),
    animais: achados,
  };
  s.step = "confirm";
  await save(env, chatId, s);

  const d = s.data;
  await sendMessage(
    env,
    chatId,
    "Vou <b>registrar um manejo</b>:" +
      `\n<b>Tipo:</b> ${esc(d.tipo)}` +
      (d.subtipoCasco ? `\n<b>Ferrageamento:</b> ${esc(d.subtipoCasco)}` : "") +
      `\n<b>Data:</b> ${fmtDataBR(d.data)}` +
      `\n<b>Animais (${d.animais.length}):</b> ${esc(d.animais.map((a: any) => a.nome).join(", "))}` +
      (d.obs ? `\n<b>Obs:</b> ${esc(d.obs)}` : ""),
    [[{ text: "✔ Confirmar", data: "confirm:manejo" }, { text: "Cancelar", data: "cancel:x" }]],
  );
}

async function confirmarManejo(env: Env, chatId: number, s: Session): Promise<void> {
  await sendMessage(env, chatId, "Gravando…");
  try {
    const manejos = await getList(env, "manejos_list");
    const d = s.data;
    const reg = montarManejo({
      tipo: d.tipo,
      data: d.data,
      obs: d.obs,
      animais: d.animais,
      subtipoCasco: d.subtipoCasco || undefined,
    });
    manejos.push(reg);
    await setList(env, "manejos_list", manejos);

    const log = await getList(env, "auditoria_log");
    const resumo = `${reg.tipo} — ${d.animais.map((a: any) => a.nome).join(", ")}`;
    await setList(env, "auditoria_log", auditEntrada(log, "inclusao", "Manejos", resumo, reg.id));

    await clear(env, chatId);
    await sendMessage(
      env,
      chatId,
      `✅ Manejo de <b>${esc(reg.tipo)}</b> registrado para ${d.animais.length} animal(is) em ${fmtDataBR(reg.data)}.` +
        `\nA próxima data prevista já conta a partir daqui.`,
    );
  } catch (e: any) {
    await clear(env, chatId);
    await sendMessage(env, chatId, `❌ Erro ao gravar: ${esc(String(e?.message || e))}\nNada foi salvo.`);
  }
}
