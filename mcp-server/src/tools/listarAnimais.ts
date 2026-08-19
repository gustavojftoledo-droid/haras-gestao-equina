// Tool: listar_animais
// Porta em leitura do filtro "animal ativo" usado em várias telas do app_145.html:
//   situacao !== 'E' && situacao !== 'V' && !falecimento
// (E = Externo, V = Vendido). Projeta só um subconjunto enxuto de campos —
// sem genealogia, obs, fotoUrl ou valor (valor é texto livre com formatos
// inconsistentes de moeda, ver app_145.html:7406-7412 parseValorLivre();
// fica de fora do v1, ver README).

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { BackupNotFoundError, loadBackup } from "../backup.js";
import type { Horse } from "../types.js";

function idadeAnos(nascimento?: string): number | null {
  if (!nascimento) return null;
  const nasc = new Date(nascimento);
  if (Number.isNaN(nasc.getTime())) return null;
  const hoje = new Date();
  let idade = hoje.getFullYear() - nasc.getFullYear();
  const aindaNaoFezAniversario =
    hoje.getMonth() < nasc.getMonth() ||
    (hoje.getMonth() === nasc.getMonth() && hoje.getDate() < nasc.getDate());
  if (aindaNaoFezAniversario) idade -= 1;
  return idade;
}

function isAtivo(h: Horse): boolean {
  return h.situacao !== "E" && h.situacao !== "V" && !h.falecimento;
}

const inputSchema = z.object({
  incluirInativos: z
    .boolean()
    .default(false)
    .describe("Se true, inclui também animais Externos, Vendidos ou falecidos"),
  sexo: z.enum(["MASCULINO", "FEMININO"]).optional().describe("Filtra por sexo do animal"),
  busca: z
    .string()
    .optional()
    .describe("Filtra por substring (sem diferenciar maiúsculas) em nome, apelido ou código"),
});

export function registerListarAnimais(server: McpServer): void {
  server.registerTool(
    "listar_animais",
    {
      description:
        "Lista os animais cadastrados no Haras — Gestão Equina, a partir do backup JSON exportado do app. " +
        "Por padrão retorna só animais ativos (próprios, vivos, não vendidos). Somente leitura.",
      inputSchema,
    },
    async ({ incluirInativos, sexo, busca }) => {
      let backup;
      try {
        backup = loadBackup();
      } catch (err) {
        if (err instanceof BackupNotFoundError) {
          return { content: [{ type: "text" as const, text: err.message }] };
        }
        throw err;
      }

      const todos = backup.horses ?? [];
      let filtrados = incluirInativos ? todos : todos.filter(isAtivo);

      if (sexo) {
        filtrados = filtrados.filter((h) => h.sexo === sexo);
      }
      if (busca) {
        const alvo = busca.toLowerCase();
        filtrados = filtrados.filter((h) =>
          [h.nome, h.apelido, h.codigo].some((v) => (v ?? "").toLowerCase().includes(alvo)),
        );
      }

      if (filtrados.length === 0) {
        const total = todos.length;
        return {
          content: [
            {
              type: "text" as const,
              text: `0 animais encontrados com os filtros aplicados (total no backup: ${total}). ` +
                (incluirInativos ? "" : "Dica: use incluirInativos:true para ver também externos/vendidos/falecidos."),
            },
          ],
        };
      }

      const projetados = filtrados.map((h) => ({
        id: h.id,
        codigo: h.codigo,
        nome: h.nome,
        apelido: h.apelido,
        sexo: h.sexo,
        situacao: h.situacao,
        categoria: h.categoria,
        idadeAnos: idadeAnos(h.nascimento),
        proprietario: h.proprietario,
        localizacao: h.localizacao,
      }));

      const resumo = `${projetados.length} animal(is) encontrado(s) (de ${todos.length} no backup).`;
      return {
        content: [
          { type: "text" as const, text: `${resumo}\n\n${JSON.stringify(projetados, null, 2)}` },
        ],
      };
    },
  );
}
