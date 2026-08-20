# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Haras — Gestão Equina** is a farm-management app for a horse breeding operation (plantel,
manejos/husbandry, training, births, inventory, veterinary visits, diets, staff, finance). It's
built and used in Brazilian Portuguese; all UI copy, variable/function names, comments, and commit
messages in this repo are in pt-BR — match that when editing.

The repo has three independent parts that don't share a build or deploy pipeline:

- **`app_145.html`** (root) — the actual application. A single self-contained HTML/CSS/JS file,
  no build step, no framework, no npm dependency. This is where almost all feature work happens.
- **`mcp-server/`** — a local, read-only MCP (stdio) server, a small Node/TypeScript project.
- **`mcp-remote/`** — a remote, read-only MCP server deployed as a Cloudflare Worker with GitHub
  OAuth, a separate Node/TypeScript project.

`index.html` is just a redirect stub (`meta http-equiv="refresh"`) that forwards to
`./app_145.html`, kept so a stable URL (e.g. GitHub Pages root) always opens the current app file.

## The main app (`app_145.html`)

### Architecture

Everything — markup, CSS, and JS — lives in this one file (~9.6k lines). There is no bundler, no
module system, no package.json for it: it's edited directly and opened directly in a browser (or
deployed as a static file, e.g. GitHub Pages). When making changes, edit `app_145.html` in place;
do not split it into multiple files or introduce a build step unless explicitly asked.

Rough layout of the file:
- `<head>`: two CDN scripts (`pdf.js` for reading uploaded PDFs, `html2pdf.js` for downloading
  reports as PDF — both require internet and are only used by those specific features), PWA tags
  (manifest, icons, theme color), Google Fonts.
- `<style>`: all CSS, using CSS custom properties defined on `:root` (`--ink`, `--paper`, `--card`,
  `--green`, `--brass`, `--burgundy`, etc.) for the app's color palette. Reuse these tokens instead
  of hardcoding colors.
- Body markup: a sidebar nav (`.nav-item[data-view="..."]`) and one `<div class="view" id="view-X">`
  per section. Only one `.view` has class `active` at a time — see "Navigation" below.
- `<script>` (single block starting ~line 1660): all application logic, as plain top-level
  functions and global `let`/`const` state — no classes, no modules, no framework.

### State & persistence

Global mutable arrays hold all data in memory: `horses`, `manejos`, `treinos`, `nascimentos`,
`estoqueProdutos`, `estoqueMovimentos`, `dietas`, `grupos`, `tratamentos`, `visitas`,
`lancamentos`, `funcionarios`, `usuarios`, plus `config` (object) and `aux` (auxiliary
dropdown/autocomplete lists). These are loaded once at startup by `loadAll()` and kept in sync with
storage by explicit `storeSet(key, value)` calls after every mutation — there's no reactive
framework, so **any code that mutates one of these arrays/objects must also call `storeSet`** (and
usually the relevant `renderX()` function) or the change won't persist or show up.

Persistence is abstracted through `storeGet(key)` / `storeSet(key, value)`, which transparently
target one of two backends depending on `HAS_CLOUD_STORAGE` (`typeof window.storage !== 'undefined'`):
- Running as a Claude.ai artifact → uses `window.storage` (cloud-backed, with retry logic).
- Opened as a plain file/static host (browser, PWA) → falls back to the browser's `localStorage`,
  namespaced with `LS_PREFIX = 'haras_gestao_equina__'`.

All real farm data lives only in that storage — never committed to the repo. Users export/import
JSON snapshots via the "⚙ Exportar/Importar Backup" buttons (`btnExportBackup`/`btnImportBackup`),
producing files named `haras_backup_<timestamp>.json`. `.gitignore` explicitly excludes
`haras_backup_*.json` — never commit or unignore real backup files, they contain the farm's private
data. Import merges by `id` (skips exact-id duplicates; same-name-different-id entries are surfaced
later in a "Possíveis Duplicados" screen, `computeDuplicatePairs`/`renderDuplicatesList`, for the
user to resolve manually).

`loadAll()` also carries forward defensive migrations for older backups/state shapes (e.g. renamed
`valoresCasco` categories, first-time seeding of `config.protocoloVacinasGestacao` /
`protocoloVacinasPotro`). When changing the shape of `config` or a stored list, add a similar
one-time migration there rather than assuming fresh state.

### Navigation & rendering

Sections ("views") are plain show/hide, not a router: `irParaView(view)` toggles the `active` class
on `.nav-item[data-view]` and the matching `#view-<name>` element, and calls that section's
`renderX()` to (re)build its DOM from the in-memory arrays. There's no virtual DOM — render
functions rebuild `innerHTML` from the current state on every call. Keyboard shortcuts
(`Alt+Shift+<letter>`, shown in each nav item's `title`) call `irParaView` too.

Each domain has its own `render*()`/`open*New()`/`open*Edit(id)` trio (e.g. `renderHorses` /
`openHorseNew` / `openHorseEdit`, `renderManejos` / `openManejoNew`(inline) / `openManejoEdit`,
similarly for Treinos, Nascimentos, Estoque, Dietas, Grupos, Tratamentos, Visitas, Financeiro,
Funcionários, Usuários). Follow that same naming/structure pattern for any new domain or field.

Editing state for "which record is open" uses module-level `editingXId` variables (e.g.
`editingHorseId`, `editingManejoId`, `editingProdutoId`, ...) rather than passing the id through the
DOM — check these when working on a form's save/cancel logic.

`showAlert`, `showConfirm`, `showPrompt` are custom replacements for `alert`/`confirm`/`prompt`
(native dialogs can be blocked in sandboxed iframes, e.g. when this runs as a Claude artifact) —
always use these instead of the native browser dialogs.

### Cross-cutting features worth knowing about

- **Financeiro (finance)**: `lancamentos` (manual entries) are combined at render time with entries
  *derived* from other sections — `lancamentosDerivadosManejos`, `...Estoque`, `...Treinos`,
  `...Visitas`, `...Tratamentos` — unified by `todosLancamentosFinanceiro()`. When adding a cost to
  any other domain, decide whether it should also appear in Financeiro via one of these derivers
  rather than by writing directly into `lancamentos`.
- **Vacinas (vaccines)**: pending/overdue vaccines come from two independent mechanisms — regular
  per-animal vaccination history (frequency from `config.freqVacinas`) and the gestação/potro
  protocols (`config.protocoloVacinasGestacao`/`protocoloVacinasPotro`, tracked per
  `nascimento`/`horse`). Both MCP servers reimplement this same logic for their `listar_vacinas_pendentes`
  tool — keep them in sync if you change the rules (see `mcp-server/README.md`'s note that "a
  vaccine an animal never received doesn't show as pending" is intentional app behavior, not a bug).
- **Ferrageamento/Casqueamento (farrier)**: the next due date is now computed dynamically from the
  *last logged procedure type* (Ferrageamento=30 days, Casqueamento=60 days by default, both
  editable in Manejos → "Editar valores de referência") — not a fixed per-animal field.
- **PDF/report generation**: `gerarRelatorio*` functions build an HTML string, preview it in a
  modal, then either print or hand off to `html2pdf.js` via `wireBaixarPdfBtn`. Follow the existing
  `blocoRelatorio*` + `gerarRelatorio*` pattern for new reports.
- **Voice input**: `wireBotaoVoz`/`interpretarDitado`/`parseComandoLancamento` etc. implement a
  generic keyword-driven voice-dictation engine used across several forms (Manejos, Estoque,
  Animais, Nascimentos, Financeiro) — it only fills fields, never auto-submits.
- **Users (`view-usuarios`)**: a lightweight local PIN-based profile switcher (`entrarNoApp`,
  `tentarLogin`, `aplicarPermissoes`) for organizing who sees which screens — explicitly *not* a
  security boundary ("não é senha de banco, é organização").

### PWA / offline

`manifest.json` + `sw.js` (+ the icon files) implement "Add to Home Screen" / offline support.
`sw.js` uses a network-first strategy (always fetch fresh over the network; fall back to the cache
only when offline) — deliberate, since the app still changes often; don't switch it to cache-first.
The service worker only activates when served over http(s) (e.g. GitHub Pages), not for a `file://`
double-click open. It caches app shell files only — it never touches stored data.

### No build/test/lint tooling

There is no bundler, package manager, linter, formatter, or test suite for `app_145.html` — it's
plain HTML/CSS/JS edited by hand. "Testing" a change means opening the file in a browser and
exercising the relevant view manually; there's also an in-app "Diagnóstico" panel
(`btnDiagnostico`) that reports per-key record counts from storage and round-trips a test value,
useful for sanity-checking persistence after storage-related changes.

## `mcp-server/` — local MCP server (read-only)

A stdio MCP server (Node ≥20, TypeScript) that reads a `haras_backup_*.json` file exported from the
app and exposes two read-only tools: `listar_animais` and `listar_vacinas_pendentes`. It never
writes to the app or the backup file. See `mcp-server/README.md` for full setup/Claude Desktop
wiring instructions (in pt-BR).

```bash
cd mcp-server
npm install
npm run build      # tsc -> build/index.js
npm run inspect     # opens MCP Inspector against build via stdio, for manual tool testing
npm start            # node build/index.js
```

Backup file resolution order (`src/backup.ts`, `resolveBackupPath`): `--backup <path>` CLI arg >
`HARAS_BACKUP_PATH` env var > auto-discovery of the newest `haras_backup_*.json` at the project
root. Backups have real farm data — don't add paths pointing at them into committed files; prefer
`HARAS_BACKUP_PATH` set outside version control.

Structure: `src/index.ts` (server bootstrap, stdio transport), `src/backup.ts` (backup file
loading/caching by mtime, defensive normalization), `src/types.ts` (shared types), `src/tools/`
(one file per tool: `listarAnimais.ts`, `listarVacinasPendentes.ts`).

Known limitations (see `mcp-server/README.md`): read-only by design (no write tools), no
genealogy/observações/foto/`valor` fields in `listar_animais` output (the `valor` field's currency
format is inconsistent — parsing it would mean replicating `parseValorLivre()` from `app_145.html`),
and no financeiro tool.

## `mcp-remote/` — remote MCP server (Cloudflare Worker, read-only)

The same idea as `mcp-server/`, but deployed remotely (Cloudflare Workers + Durable Objects) with
GitHub OAuth gating access, so it can be reached from a phone/browser instead of only Claude
Desktop on the same machine as the backup file. It reads the latest `haras_backup_*.json` via the
GitHub API from a **private** backup repo (`BACKUP_REPO_OWNER`/`BACKUP_REPO_NAME` in
`wrangler.jsonc`, currently `gustavojftoledo-droid/haras-backups`) instead of the local filesystem.
Access is further restricted to specific GitHub usernames via `ALLOWED_USERNAMES` in `src/index.ts`.

```bash
cd mcp-remote
npm install
npm run dev          # wrangler dev, local at http://localhost:8788
npm run type-check   # tsc --noEmit
npm run deploy       # wrangler deploy
npm run cf-typegen   # regenerate worker-configuration.d.ts from wrangler config
```

Secrets (never committed — set via `wrangler secret put <NAME>`, or in `.dev.vars` locally, copied
from `.dev.vars.example`): `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `COOKIE_ENCRYPTION_KEY`,
`BACKUP_REPO_TOKEN` (GitHub token with read access to the private backup repo).

Structure: `src/index.ts` (the `MyMCP` agent — tool definitions and the `OAuthProvider` export),
`src/github-handler.ts` (GitHub OAuth login flow), `src/harasData.ts` (backup fetch via GitHub API +
a port of the vaccine-pending business logic from `mcp-server/src/`), `src/utils.ts`,
`src/workers-oauth-utils.ts`. `src/harasData.ts` explicitly notes it reimplements
`mcp-server`'s logic adapted for HTTP-fetch instead of filesystem access — **keep the two in sync**
when the underlying vaccine/animal rules in `app_145.html` change.

This project started from Cloudflare's `remote-mcp-github-oauth` template; most of
`mcp-remote/README.md` is still generic template documentation (OAuth Provider / Durable MCP / MCP
Remote background, generic deploy steps) — the Haras-specific pieces are `harasData.ts`, the two
tools in `index.ts`, and the `ALLOWED_USERNAMES`/`BACKUP_REPO_*` config.

## Conventions across the repo

- Write UI copy, comments, and commit messages in **pt-BR**, matching the existing style (concise,
  present-tense, explaining the *why* for non-obvious logic — see the density of comments already
  in `app_145.html` around storage/migrations).
- Both MCP servers are **strictly read-only** by design (explicitly called out in both READMEs) —
  don't add tools that write back to the app's data or the backup files without discussing it first.
- Never write real farm data (backup JSON, tokens, `HARAS_BACKUP_PATH` values pointing at real
  files) into committed/tracked files.
