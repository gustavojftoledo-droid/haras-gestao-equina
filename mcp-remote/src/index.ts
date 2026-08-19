import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { GitHubHandler } from "./github-handler";
import { BackupUnavailableError, calcularVacinasPendentes, idadeAnos, isAtivo, loadBackup } from "./harasData";

// Contexto do processo de login, guardado de forma criptografada no token e
// disponibilizado aqui como this.props.
type Props = {
	login: string;
	name: string;
	email: string;
	accessToken: string;
};

// Só usuários do GitHub nesta lista conseguem usar o servidor.
const ALLOWED_USERNAMES = new Set<string>(["gustavojftoledo-droid"]);

export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
	server = new McpServer({
		name: "Haras — Gestão Equina",
		version: "0.1.0",
	});

	async init() {
		if (!ALLOWED_USERNAMES.has(this.props!.login)) {
			// Usuário autenticado no GitHub, mas não está na lista permitida.
			// Não registra nenhuma ferramenta — a conexão fica sem nada pra usar.
			return;
		}

		this.server.tool(
			"listar_animais",
			"Lista os animais cadastrados no Haras — Gestão Equina, a partir do backup mais recente no repositório privado. Por padrão retorna só animais ativos. Somente leitura.",
			{
				incluirInativos: z.boolean().default(false).describe("Incluir também externos/vendidos/falecidos"),
				sexo: z.enum(["MASCULINO", "FEMININO"]).optional(),
				busca: z.string().optional().describe("Substring em nome, apelido ou código"),
			},
			async ({ incluirInativos, sexo, busca }) => {
				let backup;
				try {
					backup = await loadBackup(this.env);
				} catch (err) {
					if (err instanceof BackupUnavailableError) {
						return { content: [{ type: "text" as const, text: err.message }] };
					}
					throw err;
				}

				const todos = backup.horses ?? [];
				let filtrados = incluirInativos ? todos : todos.filter(isAtivo);
				if (sexo) filtrados = filtrados.filter((h) => h.sexo === sexo);
				if (busca) {
					const alvo = busca.toLowerCase();
					filtrados = filtrados.filter((h) =>
						[h.nome, h.apelido, h.codigo].some((v) => (v ?? "").toLowerCase().includes(alvo)),
					);
				}

				if (filtrados.length === 0) {
					return {
						content: [
							{
								type: "text" as const,
								text: `0 animais encontrados (total no backup: ${todos.length}).`,
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

				return {
					content: [
						{
							type: "text" as const,
							text: `${projetados.length} animal(is) encontrado(s) (de ${todos.length} no backup).\n\n${JSON.stringify(projetados, null, 2)}`,
						},
					],
				};
			},
		);

		this.server.tool(
			"listar_vacinas_pendentes",
			"Lista vacinas pendentes/atrasadas no Haras — Gestão Equina, combinando a vacinação regular por animal e o protocolo de gestação/potro, a partir do backup mais recente no repositório privado. Somente leitura.",
			{
				apenasAtrasados: z.boolean().default(false),
				incluirEmDia: z.boolean().default(false),
			},
			async ({ apenasAtrasados, incluirEmDia }) => {
				let backup;
				try {
					backup = await loadBackup(this.env);
				} catch (err) {
					if (err instanceof BackupUnavailableError) {
						return { content: [{ type: "text" as const, text: err.message }] };
					}
					throw err;
				}

				const linhas = calcularVacinasPendentes(backup, { apenasAtrasados, incluirEmDia });
				if (linhas.length === 0) {
					return {
						content: [
							{
								type: "text" as const,
								text: "Nenhuma vacina pendente encontrada. Lembrete: vacinas nunca aplicadas a um animal não aparecem aqui (mesmo comportamento do app original).",
							},
						],
					};
				}

				return {
					content: [
						{
							type: "text" as const,
							text: `${linhas.length} vacina(s) pendente(s)/atrasada(s).\n\n${JSON.stringify(linhas, null, 2)}`,
						},
					],
				};
			},
		);
	}
}

export default new OAuthProvider({
	apiHandler: MyMCP.serve("/mcp"),
	apiRoute: "/mcp",
	authorizeEndpoint: "/authorize",
	clientRegistrationEndpoint: "/register",
	defaultHandler: GitHubHandler as any,
	tokenEndpoint: "/token",
});
