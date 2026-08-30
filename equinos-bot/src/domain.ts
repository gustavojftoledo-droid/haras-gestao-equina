/**
 * Regras de dominio portadas do app (app_145.html) — versao enxuta, so o necessario pra
 * cadastrar um Animal e registrar um Manejo simples. Mantido de proposito bem colado ao que
 * o app faz, pra nao divergir.
 */

// ---- datas ----
export function toISODate(d: Date): string {
  // fuso local nao existe no Worker; usamos UTC, e o campo de data do app e so YYYY-MM-DD
  return d.toISOString().slice(0, 10);
}
export function hojeISO(): string {
  return toISODate(new Date());
}
/** "25/12/2026" | "25-12-2026" | "2026-12-25" -> "2026-12-25" ; invalido -> null */
export function parseDataBR(s: string): string | null {
  const t = (s || "").trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return isDataReal(+m[1], +m[2], +m[3]) ? `${m[1]}-${m[2]}-${m[3]}` : null;
  m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let ano = +m[3];
    if (ano < 100) ano += 2000;
    const mes = +m[2], dia = +m[1];
    if (!isDataReal(ano, mes, dia)) return null;
    return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  }
  return null;
}
function isDataReal(a: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31 || a < 1900 || a > 2100) return false;
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
export function fmtDataBR(iso: string): string {
  const m = (iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso || "—";
}

// ---- texto ----
export function titleCase(str: string): string {
  return (str || "")
    .toLowerCase()
    .replace(/(^|[\s'\-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase())
    .trim();
}
export function norm(s: string): string {
  return (s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

// ---- Animais ----
export interface Horse {
  id: string;
  codigo: string;
  nome: string;
  apelido: string;
  sexo: "MASCULINO" | "FEMININO" | "";
  situacao: "P" | "E" | "V";
  status: string;
  nascimento: string;
  falecimento: string;
  pelagem: string;
  raca: string;
  categoria: string;
  localizacao: string;
  pai: string;
  mae: string;
  avopat: string;
  avopatmat: string;
  avomatpat: string;
  avomat: string;
  freqcasco: string;
  freqdente: string;
  freqvacina: string;
  freqvermifugo: string;
  proprietario: string;
  valor: string;
  doador: boolean;
  compra: boolean;
  fotoUrl: string;
  obs: string;
  criadoEm: string;
  [k: string]: unknown;
}

export function proximoCodigo(horses: Horse[]): string {
  const nums = horses.map((h) => parseInt(String(h.codigo), 10)).filter((n) => !isNaN(n));
  return String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, "0");
}

export function acharAnimal(horses: Horse[], nome: string): Horse | undefined {
  const n = norm(nome);
  return horses.find((h) => norm(h.nome) === n);
}

/** Cria um animal externo (pai/mae/receptora) se ainda nao existir. `comoInterno` -> entra como Proprio. */
export function ensureExternalAnimal(
  horses: Horse[],
  nome: string,
  sexo: "MASCULINO" | "FEMININO",
  comoInterno = false,
): { criado: boolean; horse: Horse } {
  const limpo = titleCase((nome || "").trim());
  const existe = acharAnimal(horses, limpo);
  if (existe) {
    if (comoInterno && existe.situacao === "E") {
      existe.situacao = "P";
      if (!existe.categoria) existe.categoria = "Receptora";
    }
    return { criado: false, horse: existe };
  }
  const horse: Horse = {
    id: "h_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
    codigo: "",
    nome: limpo,
    apelido: "",
    sexo,
    situacao: comoInterno ? "P" : "E",
    status: "",
    nascimento: "",
    falecimento: "",
    pelagem: "",
    raca: "",
    categoria: comoInterno ? "Receptora" : "",
    localizacao: "",
    pai: "",
    mae: "",
    avopat: "",
    avopatmat: "",
    avomatpat: "",
    avomat: "",
    freqcasco: "",
    freqdente: "",
    freqvacina: "",
    freqvermifugo: "",
    proprietario: "",
    valor: "",
    doador: false,
    compra: false,
    fotoUrl: "",
    obs: comoInterno
      ? "Cadastrada automaticamente como receptora (animal interno)"
      : "Cadastrado automaticamente como reprodutor externo (via chatbot)",
    criadoEm: hojeISO(),
  };
  horses.push(horse);
  return { criado: true, horse };
}

export interface NovoAnimalInput {
  nome: string;
  sexo: "MASCULINO" | "FEMININO";
  nascimento?: string;
  pai?: string;
  mae?: string;
  pelagem?: string;
  categoria?: string;
  proprietario?: string;
}

/** Monta o objeto do animal novo no mesmo formato do formulario do app. Nao grava. */
export function montarAnimal(horses: Horse[], inp: NovoAnimalInput): Horse {
  const mae = inp.mae ? acharAnimal(horses, inp.mae) : undefined;
  const pai = inp.pai ? acharAnimal(horses, inp.pai) : undefined;
  return {
    id: "h_" + Date.now(),
    codigo: proximoCodigo(horses),
    nome: titleCase(inp.nome),
    apelido: "",
    sexo: inp.sexo,
    situacao: "P",
    status: "",
    nascimento: inp.nascimento || "",
    falecimento: "",
    pelagem: titleCase(inp.pelagem || ""),
    raca: "",
    categoria: titleCase(inp.categoria || ""),
    localizacao: "",
    pai: pai ? pai.nome : titleCase(inp.pai || ""),
    mae: mae ? mae.nome : titleCase(inp.mae || ""),
    avopat: pai ? String(pai.pai || "") : "",
    avopatmat: pai ? String(pai.mae || "") : "",
    avomatpat: mae ? String(mae.pai || "") : "",
    avomat: mae ? String(mae.mae || "") : "",
    freqcasco: "",
    freqdente: "",
    freqvacina: "",
    freqvermifugo: "",
    proprietario: titleCase(inp.proprietario || ""),
    valor: "",
    doador: false,
    compra: false,
    fotoUrl: "",
    obs: "Cadastrado via chatbot (Telegram)",
    criadoEm: hojeISO(),
  };
}

// ---- listas auxiliares (aux_lists) ----
/** Garante que valores novos de pelagem/categoria/proprietario aparecam nos dropdowns do app. */
export function registrarAux(aux: Record<string, string[]>, animal: Horse): boolean {
  let mudou = false;
  const add = (chave: string, valor: string) => {
    if (!valor) return;
    if (!Array.isArray(aux[chave])) aux[chave] = [];
    if (!aux[chave].some((v) => norm(v) === norm(valor))) {
      aux[chave].push(valor);
      mudou = true;
    }
  };
  add("pelagem", animal.pelagem);
  add("categoria", animal.categoria);
  add("proprietario", animal.proprietario);
  return mudou;
}

// ---- Manejos ----
export type TipoManejo = "Casco" | "Dente" | "Vacina" | "Vermífugo" | string;

export interface ManejoAnimal {
  id: string;
  nome: string;
  tipo?: string; // subtipo de ferrageamento (Casco)
  valorBase?: number; // "retrato" do valor de referência do subtipo na hora
  valorExtra?: number; // valor extra desse animal (frete, ferradura especial…)
}
export interface Manejo {
  id: string;
  data: string;
  tipo: TipoManejo;
  obs: string;
  animais: ManejoAnimal[];
  subtipoCasco?: string;
  ferrador?: string;
  valor?: number | null;
  deslocamento?: number | null;
  medicamentoId?: string | null;
  medicamentoNome?: string;
  medQuantidade?: number;
  utensilios?: unknown[];
}

export interface NovoManejoInput {
  tipo: TipoManejo;
  data: string;
  obs?: string;
  animais: { id: string; nome: string; valorExtra?: number }[];
  subtipoCasco?: string;
  ferrador?: string;
  /** config.valoresCasco do app (Firestore doc `config`) — pra gravar o valorBase igual a tela manual */
  valoresCasco?: Record<string, number>;
  /** Dente/outros: valor por animal (R$) */
  valor?: number;
  /** Vacina/Vermífugo: nome do produto e dose por animal (o bot nunca dá baixa no estoque) */
  medicamento?: string;
  quantidade?: number;
}

/** Monta o registro de manejo no mesmo formato do "Salvar Lançamento" do app. Nao grava. */
export function montarManejo(inp: NovoManejoInput): Manejo {
  const reg: Manejo = {
    id: "mj_" + Date.now(),
    data: inp.data,
    tipo: inp.tipo,
    obs: inp.obs || "Registrado via chatbot (Telegram)",
    animais: inp.animais.map((a) => {
      const linha: ManejoAnimal = { id: a.id, nome: a.nome };
      if (a.valorExtra && a.valorExtra > 0) linha.valorExtra = a.valorExtra;
      return linha;
    }),
  };
  if (inp.tipo === "Casco") {
    reg.subtipoCasco = inp.subtipoCasco || "";
    reg.ferrador = inp.ferrador || "";
    reg.valor = null;
    reg.deslocamento = null;
    const base = inp.subtipoCasco && inp.valoresCasco ? Number(inp.valoresCasco[inp.subtipoCasco]) : NaN;
    reg.animais.forEach((a) => {
      if (inp.subtipoCasco) a.tipo = inp.subtipoCasco;
      if (Number.isFinite(base)) a.valorBase = base;
    });
  } else if (inp.tipo === "Vacina" || inp.tipo === "Vermífugo") {
    // O bot NUNCA dá baixa no estoque — é sempre o caminho "sem baixa" do app (medicamentoId null).
    reg.medicamentoId = null;
    reg.medicamentoNome = inp.medicamento || "";
    reg.medQuantidade = inp.quantidade || 0;
    reg.utensilios = [];
    const v = Number(inp.valor);
    reg.valor = Number.isFinite(v) && v > 0 ? v : 0;
    if (Number.isFinite(v) && v > 0) reg.animais.forEach((a) => (a.valorBase = v));
  } else {
    // Dente e "outro": valor por animal, igual o campo "Valor (R$) — por animal" da tela.
    const v = Number(inp.valor);
    reg.valor = Number.isFinite(v) && v > 0 ? v : null;
    if (Number.isFinite(v) && v > 0) reg.animais.forEach((a) => (a.valorBase = v));
  }
  return reg;
}

// ---- auditoria (auditoria_log) ----
const AUDIT_LIMITE = 1500;
export function auditEntrada(
  log: any[],
  acao: "inclusao" | "edicao" | "exclusao",
  modulo: string,
  registro: string,
  registroId: string,
): any[] {
  log.push({
    id: "ad_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
    quando: new Date().toISOString(),
    usuarioId: "",
    usuario: "Chatbot (Telegram)",
    acao,
    modulo,
    registro,
    registroId,
    mudancas: [],
  });
  return log.length > AUDIT_LIMITE ? log.slice(-AUDIT_LIMITE) : log;
}
