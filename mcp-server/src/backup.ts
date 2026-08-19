// Localiza e carrega o backup JSON exportado pelo app_145.html (botão
// "Exportar Backup"), de forma defensiva: nem todo backup tem todas as
// chaves (versões antigas do app não exportavam "lancamentos"/"tratamentos"/
// "visitas", nem config.freqVacinas / config.protocoloVacinas*).
//
// Quando o backup está ausente/ilegível, lança BackupNotFoundError (nunca um
// erro genérico) — cada tool captura esse tipo específico e responde com uma
// mensagem amigável em vez de deixar a exceção derrubar o processo, porque um
// servidor stdio não deve morrer por causa de um arquivo que falta.

import { readFileSync, statSync, readdirSync } from "node:fs";
import { join, isAbsolute, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Backup } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// mcp-server/src/backup.ts (ou build/backup.js) -> raiz do projeto Haras
const PROJECT_ROOT = join(__dirname, "..", "..");

export interface ResolveResult {
  path: string | null;
  reason: string;
}

/** Resolve o caminho do backup: --backup <path> > HARAS_BACKUP_PATH > auto-descoberta. */
export function resolveBackupPath(argv: string[] = process.argv): ResolveResult {
  const flagIdx = argv.indexOf("--backup");
  if (flagIdx !== -1 && argv[flagIdx + 1]) {
    return { path: argv[flagIdx + 1], reason: "argumento --backup" };
  }

  const envPath = process.env.HARAS_BACKUP_PATH;
  if (envPath) {
    return { path: envPath, reason: "variável de ambiente HARAS_BACKUP_PATH" };
  }

  try {
    const candidates = readdirSync(PROJECT_ROOT).filter(
      (f) => f.startsWith("haras_backup_") && f.endsWith(".json"),
    );
    if (candidates.length > 0) {
      // O timestamp no nome (YYYY-MM-DD-HH-mm-ss) ordena corretamente como string.
      candidates.sort();
      const chosen = candidates[candidates.length - 1];
      return { path: join(PROJECT_ROOT, chosen), reason: "backup mais recente encontrado automaticamente" };
    }
  } catch {
    // diretório do projeto não pôde ser lido; segue para "não encontrado"
  }

  return { path: null, reason: "nenhuma fonte configurada e nenhum haras_backup_*.json encontrado" };
}

interface CacheEntry {
  mtimeMs: number;
  data: Backup;
}

const cache = new Map<string, CacheEntry>();

export class BackupNotFoundError extends Error {}

/** Carrega (com cache por mtime) e normaliza defensivamente o backup. Lança BackupNotFoundError se ausente/inválido. */
export function loadBackup(explicitPath?: string): Backup {
  const { path, reason } = explicitPath
    ? { path: explicitPath, reason: "caminho explícito" }
    : resolveBackupPath();

  if (!path) {
    throw new BackupNotFoundError(
      `Nenhum backup encontrado (${reason}). Exporte um backup no app Haras ` +
        `(⚙ → Exportar Backup) e configure o caminho via variável de ambiente ` +
        `HARAS_BACKUP_PATH, argumento --backup, ou deixe o arquivo ` +
        `haras_backup_*.json na raiz do projeto.`,
    );
  }

  const resolvedPath = isAbsolute(path) ? path : join(PROJECT_ROOT, path);

  let mtimeMs: number;
  try {
    mtimeMs = statSync(resolvedPath).mtimeMs;
  } catch {
    throw new BackupNotFoundError(`Arquivo de backup não encontrado em: ${resolvedPath}`);
  }

  const cached = cache.get(resolvedPath);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.data;
  }

  let raw: string;
  try {
    raw = readFileSync(resolvedPath, "utf8");
  } catch (err) {
    throw new BackupNotFoundError(`Não foi possível ler o arquivo de backup em: ${resolvedPath} (${err})`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new BackupNotFoundError(`Arquivo de backup em ${resolvedPath} não é um JSON válido (${err})`);
  }

  const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const data: Backup = {
    exportedAt: typeof obj.exportedAt === "string" ? obj.exportedAt : undefined,
    horses: Array.isArray(obj.horses) ? (obj.horses as Backup["horses"]) : [],
    manejos: Array.isArray(obj.manejos) ? (obj.manejos as Backup["manejos"]) : [],
    nascimentos: Array.isArray(obj.nascimentos) ? (obj.nascimentos as Backup["nascimentos"]) : [],
    config: obj.config && typeof obj.config === "object" ? (obj.config as Backup["config"]) : {},
  };

  cache.set(resolvedPath, { mtimeMs, data });
  return data;
}

export function describeSource(): string {
  const { path, reason } = resolveBackupPath();
  return path ? `${path} (${reason})` : `nenhum backup encontrado (${reason})`;
}
