// Lê o backup do Haras a partir do repositório privado no GitHub
// (gustavojftoledo-droid/haras-backups) via API do GitHub, usando um token
// de leitura guardado como secret do Worker (BACKUP_REPO_TOKEN). Nunca
// escreve nada de volta no repositório — só leitura.
//
// Reimplementa em cima dos mesmos tipos e da mesma lógica de vacina do
// servidor local (mcp-server/src/), adaptado pra buscar o JSON via HTTP em
// vez do sistema de arquivos.

export interface Horse {
	id?: string;
	nome?: string;
	apelido?: string;
	codigo?: string;
	sexo?: string;
	situacao?: string;
	status?: string;
	nascimento?: string;
	falecimento?: string;
	categoria?: string;
	localizacao?: string;
	proprietario?: string;
	protocoloPotro?: ProtocoloItem[];
	[k: string]: unknown;
}

export interface Manejo {
	id?: string;
	data?: string;
	tipo?: string;
	animais?: { id?: string; nome?: string }[];
	medicamentoNome?: string;
	[k: string]: unknown;
}

export interface ProtocoloItem {
	nome?: string;
	dataAlvo?: string;
	feito?: boolean;
}

export interface Nascimento {
	matriz?: string;
	protocoloVacinas?: ProtocoloItem[];
	[k: string]: unknown;
}

export interface Backup {
	exportedAt?: string;
	horses?: Horse[];
	manejos?: Manejo[];
	nascimentos?: Nascimento[];
	config?: { freqVacinas?: Record<string, number | string> };
}

interface GitHubContentEntry {
	name: string;
	download_url: string | null;
}

export class BackupUnavailableError extends Error {}

async function githubApi(path: string, token: string): Promise<Response> {
	return fetch(`https://api.github.com${path}`, {
		headers: {
			Authorization: `Bearer ${token}`,
			"User-Agent": "haras-mcp-remote",
			Accept: "application/vnd.github+json",
		},
	});
}

let cache: { key: string; data: Backup } | null = null;

/** Busca o backup mais recente (haras_backup_*.json) no repo privado configurado. */
export async function loadBackup(env: {
	BACKUP_REPO_TOKEN: string;
	BACKUP_REPO_OWNER: string;
	BACKUP_REPO_NAME: string;
}): Promise<Backup> {
	const { BACKUP_REPO_TOKEN, BACKUP_REPO_OWNER, BACKUP_REPO_NAME } = env;
	if (!BACKUP_REPO_TOKEN || !BACKUP_REPO_OWNER || !BACKUP_REPO_NAME) {
		throw new BackupUnavailableError(
			"O servidor não está configurado com acesso ao repositório de backups (faltam variáveis de ambiente).",
		);
	}

	const listResp = await githubApi(`/repos/${BACKUP_REPO_OWNER}/${BACKUP_REPO_NAME}/contents/`, BACKUP_REPO_TOKEN);
	if (!listResp.ok) {
		throw new BackupUnavailableError(
			`Não consegui acessar o repositório de backups (${listResp.status}). Confirme se o token tem acesso ao repo ${BACKUP_REPO_OWNER}/${BACKUP_REPO_NAME}.`,
		);
	}
	const entries = (await listResp.json()) as GitHubContentEntry[];
	const candidates = entries
		.filter((e) => e.name.startsWith("haras_backup_") && e.name.endsWith(".json"))
		.sort((a, b) => a.name.localeCompare(b.name));

	if (candidates.length === 0) {
		throw new BackupUnavailableError(
			`Nenhum arquivo haras_backup_*.json encontrado em ${BACKUP_REPO_OWNER}/${BACKUP_REPO_NAME}. ` +
				"Exporte um backup no app e suba (push) esse arquivo pro repositório.",
		);
	}

	const chosen = candidates[candidates.length - 1];
	const cacheKey = chosen.name;
	if (cache && cache.key === cacheKey) return cache.data;

	if (!chosen.download_url) {
		throw new BackupUnavailableError(`Não consegui obter a URL de download de ${chosen.name}.`);
	}
	const fileResp = await fetch(chosen.download_url, {
		headers: { Authorization: `Bearer ${BACKUP_REPO_TOKEN}`, "User-Agent": "haras-mcp-remote" },
	});
	if (!fileResp.ok) {
		throw new BackupUnavailableError(`Não consegui baixar ${chosen.name} (${fileResp.status}).`);
	}

	let parsed: unknown;
	try {
		parsed = await fileResp.json();
	} catch (err) {
		throw new BackupUnavailableError(`${chosen.name} não é um JSON válido (${err}).`);
	}

	const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
	const data: Backup = {
		exportedAt: typeof obj.exportedAt === "string" ? obj.exportedAt : undefined,
		horses: Array.isArray(obj.horses) ? (obj.horses as Horse[]) : [],
		manejos: Array.isArray(obj.manejos) ? (obj.manejos as Manejo[]) : [],
		nascimentos: Array.isArray(obj.nascimentos) ? (obj.nascimentos as Nascimento[]) : [],
		config: obj.config && typeof obj.config === "object" ? (obj.config as Backup["config"]) : {},
	};

	cache = { key: cacheKey, data };
	return data;
}

// --- Lógica de negócio, portada de mcp-server/src/tools/ (ver comentários lá) ---

export function idadeAnos(nascimento?: string): number | null {
	if (!nascimento) return null;
	const nasc = new Date(nascimento);
	if (Number.isNaN(nasc.getTime())) return null;
	const hoje = new Date();
	let idade = hoje.getFullYear() - nasc.getFullYear();
	const aindaNao =
		hoje.getMonth() < nasc.getMonth() || (hoje.getMonth() === nasc.getMonth() && hoje.getDate() < nasc.getDate());
	if (aindaNao) idade -= 1;
	return idade;
}

export function isAtivo(h: Horse): boolean {
	return h.situacao !== "E" && h.situacao !== "V" && !h.falecimento;
}

type Status = "atrasado" | "proximo" | "emdia";
type Mecanismo = "regular" | "gestacao" | "potro";

export interface LinhaPendente {
	animal: string;
	vacina: string;
	data: string;
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

export function calcularVacinasPendentes(
	backup: Backup,
	opts: { apenasAtrasados?: boolean; incluirEmDia?: boolean } = {},
): LinhaPendente[] {
	const hoje = hojeISO();
	let linhas = [...mecanismoA(backup, hoje), ...mecanismoB(backup, hoje)];
	if (!opts.incluirEmDia) linhas = linhas.filter((l) => l.status !== "emdia");
	if (opts.apenasAtrasados) linhas = linhas.filter((l) => l.status === "atrasado");
	linhas.sort((a, b) => statusOrdem[a.status] - statusOrdem[b.status] || a.data.localeCompare(b.data));
	return linhas;
}
