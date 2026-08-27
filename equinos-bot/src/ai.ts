/**
 * Camada de IA: transforma uma frase solta ("cadastra a Estopa, fêmea, filha do Vento…")
 * nos campos estruturados de um cadastro de Animal ou registro de Manejo. Usa Claude Haiku
 * (barato) com "tool use" — o modelo devolve os campos, nunca grava nada. A gravação continua
 * sendo só depois do botão Confirmar, no flows.ts.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "./firestore.ts";
import { hojeISO } from "./domain.ts";

export type Interpretacao =
  | { tipo: "animal"; dados: DadosAnimal }
  | { tipo: "manejo"; dados: DadosManejo }
  | { tipo: "pergunta"; texto: string };

export interface DadosAnimal {
  nome: string;
  sexo: "MASCULINO" | "FEMININO";
  nascimento?: string;
  pai?: string;
  mae?: string;
  pelagem?: string;
  categoria?: string;
  proprietario?: string;
}
export interface DadosManejo {
  tipo: string;
  ferrageamento?: string;
  data?: string;
  animais: string[];
  obs?: string;
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: "criar_animal",
    description:
      "Registra um novo animal (cavalo) no cadastro. Use quando a pessoa quer CADASTRAR/INCLUIR um animal.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        nome: { type: "string", description: "Nome do animal" },
        sexo: { type: "string", enum: ["MASCULINO", "FEMININO"] },
        nascimento: { type: "string", description: "Data de nascimento no formato AAAA-MM-DD, se informada" },
        pai: { type: "string", description: "Nome do pai, se informado" },
        mae: { type: "string", description: "Nome da mãe, se informada" },
        pelagem: { type: "string" },
        categoria: { type: "string", description: "Ex: Potro, Doma, Matriz, Receptora, Garanhão" },
        proprietario: { type: "string" },
      },
      required: ["nome", "sexo"],
    },
  },
  {
    name: "registrar_manejo",
    description:
      "Registra um manejo (procedimento) feito em um ou mais animais. Ex: casqueamento/ferrageamento (Casco), cheque dental (Dente).",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        tipo: { type: "string", description: "Casco, Dente, ou outro tipo dito pela pessoa" },
        ferrageamento: {
          type: "string",
          description: "Só quando tipo=Casco: o procedimento exato (ex: 'Ferrado completo', 'Casqueado completo')",
        },
        data: { type: "string", description: "Data no formato AAAA-MM-DD. Se não disser, deixe vazio (será hoje)." },
        animais: { type: "array", items: { type: "string" }, description: "Nomes dos animais, como ditos" },
        obs: { type: "string" },
      },
      required: ["tipo", "animais"],
    },
  },
];

function sistema(subtipos: string[]): string {
  return [
    "Você é um assistente que registra dados de um haras a partir de frases em português.",
    `Hoje é ${hojeISO()} (AAAA-MM-DD). Converta datas relativas: "ontem", "anteontem", "semana passada", "dia 5".`,
    "Extraia SOMENTE o que a pessoa disse. Nunca invente pelagem, categoria, pai, mãe, valores.",
    "Para cadastrar animal: se faltar o nome OU o sexo, NÃO chame a ferramenta — faça uma pergunta curta.",
    "Para manejo: se faltar o tipo OU os animais, faça uma pergunta curta.",
    subtipos.length
      ? `Procedimentos de ferrageamento válidos (escolha o mais próximo do que a pessoa disse): ${subtipos.join("; ")}.`
      : "",
    "Se a mensagem não for sobre cadastrar animal nem registrar manejo, explique em uma frase o que você faz.",
    "Responda sempre em português, curto.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function interpretar(
  env: Env,
  historico: Anthropic.MessageParam[],
  subtiposFerrageamento: string[],
): Promise<Interpretacao> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const resp = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 700,
    system: sistema(subtiposFerrageamento),
    tools: TOOLS,
    messages: historico,
  });

  const toolUse = resp.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (toolUse) {
    const inp = toolUse.input as any;
    if (toolUse.name === "criar_animal") {
      return { tipo: "animal", dados: limparAnimal(inp) };
    }
    if (toolUse.name === "registrar_manejo") {
      return { tipo: "manejo", dados: limparManejo(inp) };
    }
  }
  const txt = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join(" ")
    .trim();
  return { tipo: "pergunta", texto: txt || "Não entendi. Pode reformular?" };
}

const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

function limparAnimal(i: any): DadosAnimal {
  return {
    nome: s(i.nome) || "",
    sexo: i.sexo === "FEMININO" ? "FEMININO" : "MASCULINO",
    nascimento: s(i.nascimento),
    pai: s(i.pai),
    mae: s(i.mae),
    pelagem: s(i.pelagem),
    categoria: s(i.categoria),
    proprietario: s(i.proprietario),
  };
}
function limparManejo(i: any): DadosManejo {
  const animais = Array.isArray(i.animais) ? i.animais.map((x: unknown) => String(x).trim()).filter(Boolean) : [];
  return {
    tipo: s(i.tipo) || "",
    ferrageamento: s(i.ferrageamento),
    data: s(i.data),
    animais,
    obs: s(i.obs),
  };
}
