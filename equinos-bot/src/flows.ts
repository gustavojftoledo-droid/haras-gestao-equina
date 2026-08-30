/**
 * Conversas do bot. A pessoa fala/escreve uma frase solta; a IA (ai.ts) extrai os campos de
 * um cadastro de Animal ou de um Manejo. O bot mostra a PRÉVIA e só grava depois do botão
 * Confirmar. Na confirmação relê o Firestore (não sobrescreve edição feita no app).
 */
import type { Env } from "./firestore.ts";
import { getList, getMap, setList } from "./firestore.ts";
import { sendMessage, esc } from "./telegram.ts";
import { interpretar, type DadosAnimal, type DadosManejo } from "./ai.ts";
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

type Turno = { role: "user" | "assistant"; content: string };
type ManejoPendente = DadosManejo & {
  animaisIds: { id: string; nome: string; valorExtra?: number }[];
  valoresCasco: Record<string, number>;
};
export interface Session {
  step: "conversa" | "confirm";
  historico: Turno[];
  pendente?: { tipo: "animal"; dados: DadosAnimal } | { tipo: "manejo"; dados: ManejoPendente };
}

const KEY = (chatId: number) => `sess:${chatId}`;
const MAX_HIST = 12;

async function load(env: Env, chatId: number): Promise<Session | null> {
  return (await env.SESSIONS.get(KEY(chatId), "json")) as Session | null;
}
async function save(env: Env, chatId: number, s: Session): Promise<void> {
  s.historico = s.historico.slice(-MAX_HIST);
  await env.SESSIONS.put(KEY(chatId), JSON.stringify(s), { expirationTtl: 3600 });
}
async function clear(env: Env, chatId: number): Promise<void> {
  await env.SESSIONS.delete(KEY(chatId));
}

const INTRO =
  "🐴 <b>Equinos Manager</b>\n\n" +
  "Me conte por escrito (ou pelo microfone do teclado) o que quer registrar. Exemplos:\n\n" +
  "• <i>Cadastra a Estopa, fêmea, filha do Vento com a Aurora, nascida ontem, tordilha, do Paulo</i>\n" +
  "• <i>Ferrei hoje a Rosa, a Tirania e a Tulipa</i>\n\n" +
  "Eu monto, mostro pra você conferir, e só gravo depois do seu OK.\n" +
  "Vacina e vermífugo (com baixa de estoque): pelo app.";

// ---------- entrada ----------

export async function onText(env: Env, chatId: number, textoRaw: string): Promise<void> {
  const texto = (textoRaw || "").trim();
  const lower = texto.toLowerCase();

  if (lower === "/start" || lower === "/ajuda" || lower === "/help") {
    await clear(env, chatId);
    return sendMessage(env, chatId, INTRO);
  }
  if (lower === "/cancelar" || lower === "cancelar") {
    await clear(env, chatId);
    return sendMessage(env, chatId, "Ok, esqueci o que estava fazendo. Pode mandar outra.");
  }
  if (!texto) return;

  const s = (await load(env, chatId)) || { step: "conversa", historico: [] };
  if (s.step === "confirm") {
    return sendMessage(env, chatId, "Toque em <b>Confirmar</b> ou <b>Cancelar</b> na mensagem acima — ou mande /cancelar.");
  }

  s.historico.push({ role: "user", content: texto });
  await save(env, chatId, s);
  await interpretarEResponder(env, chatId, s);
}

export async function onCallback(env: Env, chatId: number, data: string): Promise<void> {
  const [ns, action] = data.split(":");
  if (ns === "cancel") {
    await clear(env, chatId);
    return sendMessage(env, chatId, "Cancelado. Pode mandar outra.");
  }
  const s = await load(env, chatId);
  if (ns === "confirm" && s && s.step === "confirm" && s.pendente) {
    if (action === "animal" && s.pendente.tipo === "animal") return gravarAnimal(env, chatId, s.pendente.dados);
    if (action === "manejo" && s.pendente.tipo === "manejo") return gravarManejo(env, chatId, s.pendente.dados);
  }
}

// ---------- interpretação ----------

async function interpretarEResponder(env: Env, chatId: number, s: Session): Promise<void> {
  const aux = await getMap(env, "aux_lists");
  const subtipos: string[] = Array.isArray(aux.subtipoFerrageamento) ? aux.subtipoFerrageamento : [];

  let res;
  try {
    res = await interpretar(env, s.historico as any, subtipos);
  } catch (e: any) {
    return sendMessage(env, chatId, `❌ A IA não respondeu agora (${esc(String(e?.message || e))}). Tente de novo daqui a pouco.`);
  }

  if (res.tipo === "pergunta") {
    s.historico.push({ role: "assistant", content: res.texto });
    await save(env, chatId, s);
    return sendMessage(env, chatId, esc(res.texto));
  }

  if (res.tipo === "animal") {
    const d = res.dados;
    const problemas: string[] = [];
    if (!d.nome) problemas.push("nome");
    if (d.sexo !== "MASCULINO" && d.sexo !== "FEMININO") problemas.push("sexo");
    let nascISO = "";
    if (d.nascimento) {
      const iso = parseDataBR(d.nascimento) || (/^\d{4}-\d{2}-\d{2}$/.test(d.nascimento) ? d.nascimento : null);
      if (!iso) problemas.push("data de nascimento (não entendi)");
      else nascISO = iso;
    }
    if (problemas.length) {
      const q = `Faltou: ${problemas.join(", ")}. Me diz?`;
      s.historico.push({ role: "assistant", content: q });
      await save(env, chatId, s);
      return sendMessage(env, chatId, q);
    }
    d.nascimento = nascISO || undefined;
    s.step = "confirm";
    s.pendente = { tipo: "animal", dados: d };
    await save(env, chatId, s);
    return previewAnimal(env, chatId, d);
  }

  // manejo
  const d = res.dados;
  if (!d.tipo) return pergunta(env, chatId, s, "Qual o tipo do manejo? (Casco, Dente, Vacina…)");
  if (!d.animais.length) return pergunta(env, chatId, s, "Em quais animais?");

  const horses = (await getList(env, "horses_list")) as Horse[];
  const achados: { id: string; nome: string }[] = [];
  const naoAchados: string[] = [];
  const ambiguos: string[] = [];
  for (const termo of d.animais) {
    const alvo = norm(termo);
    const exato = horses.filter((h) => norm(h.nome) === alvo);
    const lista = exato.length ? exato : horses.filter((h) => norm(h.nome).includes(alvo));
    if (lista.length === 0) naoAchados.push(termo);
    else if (lista.length > 1) ambiguos.push(termo);
    else if (!achados.some((a) => a.id === lista[0].id)) achados.push({ id: lista[0].id, nome: lista[0].nome });
  }
  if (naoAchados.length || ambiguos.length) {
    let q = "";
    if (naoAchados.length) q += `Não achei no cadastro: ${naoAchados.join(", ")}. `;
    if (ambiguos.length) q += `Tem mais de um chamado: ${ambiguos.join(", ")} — diz o nome completo. `;
    return pergunta(env, chatId, s, q.trim());
  }

  let dataISO = hojeISO();
  if (d.data) {
    const iso = parseDataBR(d.data) || (/^\d{4}-\d{2}-\d{2}$/.test(d.data) ? d.data : null);
    if (!iso) return pergunta(env, chatId, s, "Não entendi a data. Diz de novo? (ex: 27/08/2026 ou 'hoje')");
    dataISO = iso;
  }

  // valores extra por animal (ex: "ferradura fechada R$150 na Zebra") → casa com quem já foi achado
  const animaisIds: { id: string; nome: string; valorExtra?: number }[] = achados.map((a) => ({ ...a }));
  for (const ve of d.valoresExtra || []) {
    const alvo = norm(ve.animal);
    const linha =
      animaisIds.find((a) => norm(a.nome) === alvo) || animaisIds.find((a) => norm(a.nome).includes(alvo));
    if (linha) linha.valorExtra = (linha.valorExtra || 0) + ve.valor;
  }

  const tn = norm(d.tipo);
  const tipoNorm = /^casque|^ferr|^casco/.test(tn)
    ? "Casco"
    : /^dente|^odont/.test(tn)
      ? "Dente"
      : /^vacin/.test(tn)
        ? "Vacina"
        : /^vermif|^verminos|^verme/.test(tn)
          ? "Vermífugo"
          : titleCase(d.tipo);
  const config = await getMap(env, "config");
  const valoresCasco: Record<string, number> =
    config && typeof config.valoresCasco === "object" && config.valoresCasco ? config.valoresCasco : {};
  const pend = { ...d, tipo: tipoNorm, data: dataISO, animaisIds, valoresCasco };
  s.step = "confirm";
  s.pendente = { tipo: "manejo", dados: pend };
  await save(env, chatId, s);
  return previewManejo(env, chatId, pend);
}

async function pergunta(env: Env, chatId: number, s: Session, texto: string): Promise<void> {
  s.historico.push({ role: "assistant", content: texto });
  await save(env, chatId, s);
  return sendMessage(env, chatId, esc(texto));
}

// ---------- prévias ----------

function previewAnimal(env: Env, chatId: number, d: DadosAnimal): Promise<void> {
  const linha = (k: string, v?: string) => (v ? `\n<b>${k}:</b> ${esc(v)}` : "");
  return sendMessage(
    env,
    chatId,
    "Vou <b>cadastrar um animal</b>:" +
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

function previewManejo(env: Env, chatId: number, d: ManejoPendente): Promise<void> {
  const ehVet = d.tipo === "Vacina" || d.tipo === "Vermífugo";
  const base = d.tipo === "Casco" && d.ferrageamento ? Number(d.valoresCasco[d.ferrageamento]) : NaN;
  const extras = d.animaisIds.filter((a) => a.valorExtra && a.valorExtra > 0);
  return sendMessage(
    env,
    chatId,
    "Vou <b>registrar um manejo</b>:" +
      `\n<b>Tipo:</b> ${esc(d.tipo)}` +
      (d.tipo === "Casco" && d.ferrageamento ? `\n<b>Ferrageamento:</b> ${esc(d.ferrageamento)}` : "") +
      (d.tipo === "Casco" && d.ferrador ? `\n<b>Ferrador:</b> ${esc(d.ferrador)}` : "") +
      (ehVet && d.medicamento ? `\n<b>Produto:</b> ${esc(d.medicamento)}` : "") +
      (ehVet && d.quantidade ? `\n<b>Dose/animal:</b> ${d.quantidade}` : "") +
      `\n<b>Data:</b> ${fmtDataBR(d.data!)}` +
      `\n<b>Animais (${d.animaisIds.length}):</b> ${esc(d.animaisIds.map((a) => a.nome).join(", "))}` +
      (Number.isFinite(base) ? `\n<b>Valor de referência:</b> R$ ${base.toFixed(2)} por animal` : "") +
      (!ehVet && d.tipo !== "Casco" && d.valor ? `\n<b>Valor:</b> R$ ${d.valor.toFixed(2)} por animal` : "") +
      (extras.length ? `\n<b>Extra:</b> ${esc(extras.map((a) => `${a.nome} R$ ${a.valorExtra!.toFixed(2)}`).join(", "))}` : "") +
      (d.obs ? `\n<b>Obs:</b> ${esc(d.obs)}` : "") +
      (ehVet
        ? `\n\n⚠️ <i>Fica pendente de baixa no estoque. No computador vai aparecer um botão "Confirmar baixa" — aí o app baixa o estoque e gera o custo por animal.</i>`
        : ""),
    [[{ text: "✔ Confirmar", data: "confirm:manejo" }, { text: "Cancelar", data: "cancel:x" }]],
  );
}

// ---------- gravação (só depois do Confirmar) ----------

async function gravarAnimal(env: Env, chatId: number, d: DadosAnimal): Promise<void> {
  await sendMessage(env, chatId, "Gravando…");
  try {
    const horses = (await getList(env, "horses_list")) as Horse[];
    const aux = await getMap(env, "aux_lists");

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
    const animal = montarAnimal(horses, {
      nome: d.nome,
      sexo: d.sexo,
      nascimento: d.nascimento,
      pai: d.pai,
      mae: d.mae,
      pelagem: d.pelagem,
      categoria: d.categoria,
      proprietario: d.proprietario,
    });
    horses.push(animal);
    await setList(env, "horses_list", horses);
    if (registrarAux(aux as Record<string, string[]>, animal)) await setList(env, "aux_lists", aux as any);
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

async function gravarManejo(env: Env, chatId: number, d: ManejoPendente): Promise<void> {
  await sendMessage(env, chatId, "Gravando…");
  try {
    const manejos = await getList(env, "manejos_list");
    const reg = montarManejo({
      tipo: d.tipo,
      data: d.data!,
      obs: d.obs,
      animais: d.animaisIds,
      subtipoCasco: d.tipo === "Casco" ? d.ferrageamento || undefined : undefined,
      ferrador: d.tipo === "Casco" ? d.ferrador : undefined,
      valoresCasco: d.valoresCasco,
      valor: d.valor,
      medicamento: d.medicamento,
      quantidade: d.quantidade,
    });
    manejos.push(reg);
    await setList(env, "manejos_list", manejos);
    const log = await getList(env, "auditoria_log");
    await setList(
      env,
      "auditoria_log",
      auditEntrada(log, "inclusao", "Manejos", `${reg.tipo} — ${d.animaisIds.map((a) => a.nome).join(", ")}`, reg.id),
    );
    await clear(env, chatId);
    const ehVet = reg.tipo === "Vacina" || reg.tipo === "Vermífugo";
    await sendMessage(
      env,
      chatId,
      `✅ Manejo de <b>${esc(reg.tipo)}</b> registrado para ${d.animaisIds.length} animal(is) em ${fmtDataBR(reg.data)}.` +
        (ehVet
          ? `\n⏳ Baixa no estoque PENDENTE — abre o app no computador e clica em "Confirmar baixa" nesse lançamento.`
          : `\nA próxima data prevista já conta a partir daqui.`),
    );
  } catch (e: any) {
    await clear(env, chatId);
    await sendMessage(env, chatId, `❌ Erro ao gravar: ${esc(String(e?.message || e))}\nNada foi salvo.`);
  }
}
