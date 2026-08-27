/**
 * Maquina de estado das conversas guiadas. Sem IA: cada passo e uma pergunta fixa e a
 * resposta cai no rascunho da sessao. So na confirmacao a gente rele o Firestore, monta o
 * registro e grava (assim uma edicao feita no app nesse meio-tempo nao e sobrescrita).
 */
import type { Env } from "./firestore.ts";
import { getList, getMap, setList } from "./firestore.ts";
import { sendMessage, esc, type InlineButton } from "./telegram.ts";
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
  step: string;
  data: Record<string, any>;
}

const KEY = (chatId: number) => `sess:${chatId}`;
const empty = (): Session => ({ flow: null, step: "", data: {} });

async function load(env: Env, chatId: number): Promise<Session> {
  return ((await env.SESSIONS.get(KEY(chatId), "json")) as Session | null) || empty();
}
async function save(env: Env, chatId: number, s: Session): Promise<void> {
  await env.SESSIONS.put(KEY(chatId), JSON.stringify(s), { expirationTtl: 3600 });
}
async function clear(env: Env, chatId: number): Promise<void> {
  await env.SESSIONS.delete(KEY(chatId));
}

const PULAR = new Set(["pular", "-", "nao", "não", "n/a", "nenhum"]);
const HOJE = new Set(["hoje", "hj", "agora"]);

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
  if (lower === "/animal") {
    return startAnimal(env, chatId);
  }
  if (lower === "/manejo") {
    return startManejo(env, chatId);
  }

  const s = await load(env, chatId);
  if (!s.flow) return menu(env, chatId);

  if (s.flow === "animal") return animalText(env, chatId, s, texto);
  if (s.flow === "manejo") return manejoText(env, chatId, s, texto);
}

export async function onCallback(env: Env, chatId: number, data: string): Promise<void> {
  const [flow, action, ...rest] = data.split(":");
  const arg = rest.join(":");

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
  if (flow === "animal" && s.flow === "animal") return animalCallback(env, chatId, s, action, arg);
  if (flow === "manejo" && s.flow === "manejo") return manejoCallback(env, chatId, s, action, arg);
  if (flow === "confirm") {
    if (action === "animal") return confirmarAnimal(env, chatId, s);
    if (action === "manejo") return confirmarManejo(env, chatId, s);
  }
}

// ---------- menu ----------

function menu(env: Env, chatId: number): Promise<void> {
  return sendMessage(
    env,
    chatId,
    "🐴 <b>Equinos Manager</b>\nO que você quer fazer?",
    [
      [{ text: "🐴 Cadastrar animal", data: "menu:animal" }],
      [{ text: "📋 Registrar manejo", data: "menu:manejo" }],
    ],
  );
}

// ================= FLUXO: CADASTRAR ANIMAL =================

async function startAnimal(env: Env, chatId: number): Promise<void> {
  await save(env, chatId, { flow: "animal", step: "nome", data: {} });
  await sendMessage(env, chatId, "🐴 <b>Novo animal</b>\n\nQual o <b>nome</b>?  (ou /cancelar)");
}

async function animalText(env: Env, chatId: number, s: Session, texto: string): Promise<void> {
  const val = texto;
  const pular = PULAR.has(val.toLowerCase());

  switch (s.step) {
    case "nome":
      if (!val) return sendMessage(env, chatId, "Preciso de um nome. Digite o nome do animal.");
      s.data.nome = val;
      s.step = "sexo";
      await save(env, chatId, s);
      return sendMessage(env, chatId, "Sexo?", [
        [
          { text: "♂ Macho", data: "animal:sexo:MASCULINO" },
          { text: "♀ Fêmea", data: "animal:sexo:FEMININO" },
        ],
      ]);
    case "nascimento":
      if (!pular) {
        const iso = parseDataBR(val);
        if (!iso) return sendMessage(env, chatId, "Data não entendida. Use dd/mm/aaaa, ou escreva <i>pular</i>.");
        s.data.nascimento = iso;
      }
      s.step = "pai";
      await save(env, chatId, s);
      return sendMessage(env, chatId, "Nome do <b>pai</b>?  (ou <i>pular</i>)");
    case "pai":
      if (!pular) s.data.pai = val;
      s.step = "mae";
      await save(env, chatId, s);
      return sendMessage(env, chatId, "Nome da <b>mãe</b>?  (ou <i>pular</i>)");
    case "mae":
      if (!pular) s.data.mae = val;
      s.step = "pelagem";
      await save(env, chatId, s);
      return sendMessage(env, chatId, "<b>Pelagem</b>?  (ou <i>pular</i>)");
    case "pelagem":
      if (!pular) s.data.pelagem = val;
      s.step = "categoria";
      await save(env, chatId, s);
      return sendMessage(env, chatId, "<b>Categoria</b>?  (ex: Potro, Doma, Matriz… ou <i>pular</i>)");
    case "categoria":
      if (!pular) s.data.categoria = val;
      s.step = "proprietario";
      await save(env, chatId, s);
      return sendMessage(env, chatId, "<b>Proprietário</b>?  (ou <i>pular</i>)");
    case "proprietario":
      if (!pular) s.data.proprietario = val;
      return previewAnimal(env, chatId, s);
    default:
      return sendMessage(env, chatId, "Perdi o fio. Manda /animal pra recomeçar.");
  }
}

async function animalCallback(env: Env, chatId: number, s: Session, action: string, arg: string): Promise<void> {
  if (action === "sexo" && s.step === "sexo") {
    s.data.sexo = arg === "FEMININO" ? "FEMININO" : "MASCULINO";
    s.step = "nascimento";
    await save(env, chatId, s);
    return sendMessage(env, chatId, "<b>Data de nascimento</b>?  (dd/mm/aaaa, ou <i>pular</i>)");
  }
}

async function previewAnimal(env: Env, chatId: number, s: Session): Promise<void> {
  s.step = "confirm";
  await save(env, chatId, s);
  const d = s.data;
  const linha = (k: string, v?: string) => (v ? `\n<b>${k}:</b> ${esc(v)}` : "");
  const txt =
    "Vou <b>incluir um animal novo</b>:" +
    linha("Nome", titleCase(d.nome)) +
    linha("Sexo", d.sexo === "FEMININO" ? "Fêmea" : "Macho") +
    linha("Nascimento", d.nascimento ? fmtDataBR(d.nascimento) : "") +
    linha("Pai", d.pai ? titleCase(d.pai) : "") +
    linha("Mãe", d.mae ? titleCase(d.mae) : "") +
    linha("Pelagem", d.pelagem ? titleCase(d.pelagem) : "") +
    linha("Categoria", d.categoria ? titleCase(d.categoria) : "") +
    linha("Proprietário", d.proprietario ? titleCase(d.proprietario) : "") +
    "\n<b>Situação:</b> Interno";
  await sendMessage(env, chatId, txt, [
    [
      { text: "✔ Confirmar", data: "confirm:animal" },
      { text: "Cancelar", data: "cancel:x" },
    ],
  ]);
}

async function confirmarAnimal(env: Env, chatId: number, s: Session): Promise<void> {
  if (s.flow !== "animal" || s.step !== "confirm") return;
  await sendMessage(env, chatId, "Gravando…");
  try {
    const horses = (await getList(env, "horses_list")) as Horse[];
    const aux = await getMap(env, "aux_lists");
    const d = s.data;

    if (acharAnimal(horses, d.nome)) {
      await clear(env, chatId);
      return sendMessage(
        env,
        chatId,
        `Já existe um animal chamado <b>${esc(titleCase(d.nome))}</b>. Não cadastrei de novo.`,
      );
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
    await sendMessage(env, chatId, `❌ Deu erro ao gravar: ${esc(String(e?.message || e))}\nNada foi salvo. Tente de novo.`);
  }
}

// ================= FLUXO: REGISTRAR MANEJO =================

async function startManejo(env: Env, chatId: number): Promise<void> {
  await save(env, chatId, { flow: "manejo", step: "tipo", data: { animais: [] } });
  await sendMessage(env, chatId, "📋 <b>Registrar manejo</b>\n\nQual o tipo?  (ou /cancelar)", [
    [
      { text: "🐴 Casco", data: "manejo:tipo:Casco" },
      { text: "🦷 Dente", data: "manejo:tipo:Dente" },
    ],
    [{ text: "✏️ Outro", data: "manejo:tipo:__outro" }],
  ]);
}

async function manejoText(env: Env, chatId: number, s: Session, texto: string): Promise<void> {
  const val = texto;

  if (s.step === "tipoLivre") {
    if (!val) return sendMessage(env, chatId, "Digite o nome do tipo de manejo.");
    s.data.tipo = titleCase(val);
    s.step = "animal";
    await save(env, chatId, s);
    return sendMessage(env, chatId, "Qual <b>animal</b>? Digite o nome.");
  }

  if (s.step === "animal" || s.step === "animalMais") {
    if (s.step === "animalMais" && norm(val) === "pronto") return apurarProntoManejo(env, chatId, s);
    const horses = (await getList(env, "horses_list")) as Horse[];
    const alvo = norm(val);
    const exatos = horses.filter((h) => norm(h.nome) === alvo);
    const parciais = exatos.length ? exatos : horses.filter((h) => norm(h.nome).includes(alvo));
    if (parciais.length === 0) {
      return sendMessage(env, chatId, `Não achei nenhum animal com “${esc(val)}”. Digite de novo ou /cancelar.`);
    }
    if (parciais.length === 1) {
      return addAnimalManejo(env, chatId, s, parciais[0]);
    }
    const botoes: InlineButton[][] = parciais
      .slice(0, 8)
      .map((h) => [{ text: h.nome + (h.codigo ? ` (${h.codigo})` : ""), data: `manejo:pick:${h.id}` }]);
    return sendMessage(env, chatId, "Achei mais de um. Qual deles?", botoes);
  }

  if (s.step === "data") {
    let iso: string | null = null;
    if (HOJE.has(val.toLowerCase())) iso = hojeISO();
    else iso = parseDataBR(val);
    if (!iso) return sendMessage(env, chatId, "Data não entendida. Use dd/mm/aaaa ou escreva <i>hoje</i>.");
    s.data.data = iso;
    s.step = "obs";
    await save(env, chatId, s);
    return sendMessage(env, chatId, "Alguma <b>observação</b>?  (ou <i>pular</i>)");
  }

  if (s.step === "obs") {
    if (!PULAR.has(val.toLowerCase())) s.data.obs = val;
    return previewManejo(env, chatId, s);
  }

  return sendMessage(env, chatId, "Perdi o fio. Manda /manejo pra recomeçar.");
}

async function addAnimalManejo(env: Env, chatId: number, s: Session, h: Horse): Promise<void> {
  if (!s.data.animais.some((a: any) => a.id === h.id)) {
    s.data.animais.push({ id: h.id, nome: h.nome });
  }
  s.step = "animalMais";
  await save(env, chatId, s);
  const nomes = s.data.animais.map((a: any) => a.nome).join(", ");
  await sendMessage(
    env,
    chatId,
    `Selecionados: <b>${esc(nomes)}</b>.\nMais algum? Digite o nome, ou toque em Pronto.`,
    [[{ text: "✅ Pronto", data: "manejo:pronto:x" }]],
  );
}

async function manejoCallback(env: Env, chatId: number, s: Session, action: string, arg: string): Promise<void> {
  if (action === "tipo" && s.step === "tipo") {
    if (arg === "__outro") {
      s.step = "tipoLivre";
      await save(env, chatId, s);
      return sendMessage(env, chatId, "Qual o tipo de manejo? (texto livre)");
    }
    if (arg === "Vacina" || arg === "Vermífugo") {
      await clear(env, chatId);
      return sendMessage(
        env,
        chatId,
        "Vacina e Vermífugo ainda não pelo chatbot (dependem do controle de estoque). Use o app pra esses. Cancelei aqui.",
      );
    }
    s.data.tipo = arg;
    s.step = "animal";
    await save(env, chatId, s);
    return sendMessage(env, chatId, "Qual <b>animal</b>? Digite o nome.");
  }

  if (action === "pick" && (s.step === "animal" || s.step === "animalMais")) {
    const horses = (await getList(env, "horses_list")) as Horse[];
    const h = horses.find((x) => x.id === arg);
    if (!h) return sendMessage(env, chatId, "Esse animal não existe mais. Digite o nome de novo.");
    return addAnimalManejo(env, chatId, s, h);
  }

  if (action === "pronto" && s.step === "animalMais") {
    return apurarProntoManejo(env, chatId, s);
  }

  if (action === "subtipo" && s.step === "subtipo") {
    s.data.subtipoCasco = arg;
    s.step = "data";
    await save(env, chatId, s);
    return sendMessage(env, chatId, "<b>Data</b> do manejo?  (dd/mm/aaaa ou <i>hoje</i>)");
  }
}

async function apurarProntoManejo(env: Env, chatId: number, s: Session): Promise<void> {
  if (!s.data.animais || s.data.animais.length === 0) {
    return sendMessage(env, chatId, "Nenhum animal selecionado. Digite o nome de um animal.");
  }
  if (s.data.tipo === "Casco") {
    const aux = await getMap(env, "aux_lists");
    const opts: string[] = Array.isArray(aux.subtipoFerrageamento) ? aux.subtipoFerrageamento : [];
    if (opts.length) {
      s.step = "subtipo";
      await save(env, chatId, s);
      const botoes: InlineButton[][] = opts
        .slice(0, 10)
        .map((o) => [{ text: o, data: `manejo:subtipo:${o}`.slice(0, 64) }]);
      return sendMessage(env, chatId, "Tipo de ferrageamento?", botoes);
    }
  }
  s.step = "data";
  await save(env, chatId, s);
  return sendMessage(env, chatId, "<b>Data</b> do manejo?  (dd/mm/aaaa ou <i>hoje</i>)");
}

async function previewManejo(env: Env, chatId: number, s: Session): Promise<void> {
  s.step = "confirm";
  await save(env, chatId, s);
  const d = s.data;
  const nomes = d.animais.map((a: any) => a.nome).join(", ");
  let txt =
    "Vou <b>registrar um manejo</b>:" +
    `\n<b>Tipo:</b> ${esc(d.tipo)}` +
    (d.subtipoCasco ? `\n<b>Ferrageamento:</b> ${esc(d.subtipoCasco)}` : "") +
    `\n<b>Data:</b> ${fmtDataBR(d.data)}` +
    `\n<b>Animais:</b> ${esc(nomes)}` +
    (d.obs ? `\n<b>Obs:</b> ${esc(d.obs)}` : "");
  await sendMessage(env, chatId, txt, [
    [
      { text: "✔ Confirmar", data: "confirm:manejo" },
      { text: "Cancelar", data: "cancel:x" },
    ],
  ]);
}

async function confirmarManejo(env: Env, chatId: number, s: Session): Promise<void> {
  if (s.flow !== "manejo" || s.step !== "confirm") return;
  await sendMessage(env, chatId, "Gravando…");
  try {
    const manejos = await getList(env, "manejos_list");
    const d = s.data;
    const reg = montarManejo({
      tipo: d.tipo,
      data: d.data,
      obs: d.obs,
      animais: d.animais,
      subtipoCasco: d.subtipoCasco,
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
    await sendMessage(env, chatId, `❌ Deu erro ao gravar: ${esc(String(e?.message || e))}\nNada foi salvo. Tente de novo.`);
  }
}
