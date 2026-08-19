// Tool: listar_vacinas_pendentes
// Porta em leitura dos dois mecanismos de vacina do app_145.html:
//
//   A) Vacina regular por animal — computeProgramacao(), app_145.html:3421-3457.
//      Só considera animais ativos. Para cada medicamentoNome já aplicado ao
//      animal (via manejos tipo:"Vacina"), calcula a próxima data a partir da
//      última aplicação + frequência configurada (config.freqVacinas[nome],
//      default 365 dias). Status: atrasado (proxima<hoje) / proximo (<=7 dias)
//      / emdia. Uma vacina NUNCA aplicada não aparece aqui — isso é fiel ao
//      comportamento do app, não é um bug deste servidor.
//
//   B) Protocolo de gestação/potro — app_145.html:4842-4913.
//      nascimentos[].protocoloVacinas[] (vacinas da égua durante a gestação) e
//      horses[].protocoloPotro[] (vacinas do potro após o nascimento). Pendente
//      = !feito. Status: atrasado (dataAlvo<hoje) / proximo (sem faixa "emdia").

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { BackupNotFoundError, loadBackup } from "../backup.js";
import type { Backup, Horse, ProtocoloItem } from "../types.js";

type Status = "atrasado" | "proximo" | "emdia";
type Mecanismo = "regular" | "gestacao" | "potro";

interface LinhaPendente {
  animal: string;
  vacina: string;
  data: string; // ISO YYYY-MM-DD — próxima aplicação (mecanismo A) ou data alvo (mecanismo B)
  status: Status;
  mecanismo: Mecanismo;
}

const MS_POR_DIA = 24 * 60 * 60 * 1000;

function hojeISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function diasEntre(deISO: string, ateISO: string): number {
  const de = new Date(`${deISO}T00:00:00Z`).getTime();
  const ate = new Date(`${ateISO}T00:00:00Z`).getTime();
  return Math.round((ate - de) / MS_POR_DIA);
}

function somarDias(dataISO: string, dias: number): string {
  const d = new Date(`${dataISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function statusPorData(dataAlvoISO: string, hoje: string, comFaixaEmDia: boolean): Status {
  const diff = diasEntre(hoje, dataAlvoISO);
  if (diff < 0) return "atrasado";
  if (!comFaixaEmDia) return "proximo";
  return diff <= 7 ? "proximo" : "emdia";
}

function isAtivo(h: Horse): boolean {
  return h.situacao !== "E" && h.situacao !== "V" && !h.falecimento;
}

function mecanismoA(backup: Backup, hoje: string): LinhaPendente[] {
  const horses = (backup.horses ?? []).filter(isAtivo);
  const manejos = (backup.manejos ?? []).filter((m) => m.tipo === "Vacina");
  const freqVacinas = backup.config?.freqVacinas ?? {};
  const linhas: LinhaPendente[] = [];

  for (const h of horses) {
    if (!h.id) continue;
    const manejosDoAnimal = manejos.filter((m) => (m.animais ?? []).some((a) => a.id === h.id));
    const nomesVacina = Array.from(
      new Set(manejosDoAnimal.map((m) => m.medicamentoNome).filter((n): n is string => !!n)),
    );

    for (const nomeVacina of nomesVacina) {
      const aplicacoes = manejosDoAnimal
        .filter((m) => m.medicamentoNome === nomeVacina && m.data)
        .map((m) => m.data as string)
        .sort();
      const ultima = aplicacoes[aplicacoes.length - 1];
      if (!ultima) continue;

      const freqDias = Number(freqVacinas[nomeVacina]) || 365;
      const proxima = somarDias(ultima, freqDias);

      linhas.push({
        animal: h.nome ?? h.id ?? "(sem nome)",
        vacina: nomeVacina,
        data: proxima,
        status: statusPorData(proxima, hoje, true),
        mecanismo: "regular",
      });
    }
  }
  return linhas;
}

function itemParaLinha(
  item: ProtocoloItem,
  animal: string,
  mecanismo: "gestacao" | "potro",
  hoje: string,
): LinhaPendente | null {
  if (item.feito || !item.dataAlvo) return null;
  return {
    animal,
    vacina: item.nome ?? "(vacina sem nome)",
    data: item.dataAlvo,
    status: statusPorData(item.dataAlvo, hoje, false),
    mecanismo,
  };
}

function mecanismoB(backup: Backup, hoje: string): LinhaPendente[] {
  const linhas: LinhaPendente[] = [];

  for (const n of backup.nascimentos ?? []) {
    for (const item of n.protocoloVacinas ?? []) {
      const linha = itemParaLinha(item, n.matriz ?? "(matriz não identificada)", "gestacao", hoje);
      if (linha) linhas.push(linha);
    }
  }

  for (const h of backup.horses ?? []) {
    for (const item of h.protocoloPotro ?? []) {
      const linha = itemParaLinha(item, h.nome ?? h.id ?? "(sem nome)", "potro", hoje);
      if (linha) linhas.push(linha);
    }
  }

  return linhas;
}

const statusOrdem: Record<Status, number> = { atrasado: 0, proximo: 1, emdia: 2 };

const inputSchema = z.object({
  apenasAtrasados: z.boolean().default(false).describe("Se true, retorna só os itens já atrasados"),
  incluirEmDia: z
    .boolean()
    .default(false)
    .describe(
      "Se true, inclui também vacinas regulares (mecanismo A) que estão em dia — normalmente não são 'pendentes'",
    ),
});

export function registerListarVacinasPendentes(server: McpServer): void {
  server.registerTool(
    "listar_vacinas_pendentes",
    {
      description:
        "Lista vacinas pendentes/atrasadas no Haras — Gestão Equina, combinando a vacinação regular por animal " +
        "e o protocolo de vacinas de gestação/potro, a partir do backup JSON exportado do app. Somente leitura.",
      inputSchema,
    },
    async ({ apenasAtrasados, incluirEmDia }) => {
      let backup;
      try {
        backup = loadBackup();
      } catch (err) {
        if (err instanceof BackupNotFoundError) {
          return { content: [{ type: "text" as const, text: err.message }] };
        }
        throw err;
      }

      const hoje = hojeISO();
      let linhas = [...mecanismoA(backup, hoje), ...mecanismoB(backup, hoje)];

      if (!incluirEmDia) {
        linhas = linhas.filter((l) => l.status !== "emdia");
      }
      if (apenasAtrasados) {
        linhas = linhas.filter((l) => l.status === "atrasado");
      }

      linhas.sort((a, b) => statusOrdem[a.status] - statusOrdem[b.status] || a.data.localeCompare(b.data));

      if (linhas.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Nenhuma vacina pendente encontrada com os filtros aplicados. " +
                "Lembrete: vacinas nunca aplicadas a um animal não aparecem aqui (mesmo comportamento do app original).",
            },
          ],
        };
      }

      const resumo = `${linhas.length} vacina(s) pendente(s)/atrasada(s) encontrada(s).`;
      return {
        content: [{ type: "text" as const, text: `${resumo}\n\n${JSON.stringify(linhas, null, 2)}` }],
      };
    },
  );
}
