# CLAUDE.md

Este arquivo orienta o Claude Code (claude.ai/code) ao trabalhar com o código deste repositório.

## O que é isso

**Haras — Gestão Equina** é um app de gestão de haras (plantel, manejos, treinos, nascimentos,
estoque, visitas veterinárias, dietas, funcionários, financeiro). É construído e usado em
português do Brasil; todo o texto da interface, nomes de variáveis/funções, comentários e mensagens
de commit deste repositório estão em pt-BR — siga esse padrão ao editar.

O repositório tem três partes independentes, sem pipeline de build ou deploy compartilhado:

- **`app_145.html`** (raiz) — o aplicativo em si. Um único arquivo HTML/CSS/JS autocontido, sem
  build, sem framework, sem dependência npm. É onde acontece quase todo o trabalho de features.
- **`mcp-server/`** — um servidor MCP (stdio) local, somente leitura, projeto Node/TypeScript pequeno.
- **`mcp-remote/`** — um servidor MCP remoto, somente leitura, implantado como Cloudflare Worker com
  login via GitHub OAuth, em um projeto Node/TypeScript separado.

`index.html` é só um redirecionamento (`meta http-equiv="refresh"`) que encaminha para
`./app_145.html`, mantido para que uma URL estável (ex.: raiz do GitHub Pages) sempre abra o
arquivo do app atual.

## O app principal (`app_145.html`)

### Arquitetura

Tudo — markup, CSS e JS — vive nesse único arquivo (~9,6 mil linhas). Não há bundler, sistema de
módulos nem package.json para ele: é editado diretamente e aberto diretamente no navegador (ou
implantado como arquivo estático, ex.: GitHub Pages). Ao fazer mudanças, edite o `app_145.html` no
lugar; não divida em vários arquivos nem introduza um passo de build a menos que seja pedido
explicitamente.

Estrutura geral do arquivo:
- `<head>`: dois scripts via CDN (`pdf.js` para ler PDFs enviados, `html2pdf.js` para baixar
  relatórios como PDF — ambos exigem internet e são usados só nessas funções específicas), tags de
  PWA (manifest, ícones, cor do tema), fontes do Google Fonts.
- `<style>`: todo o CSS, usando variáveis CSS definidas em `:root` (`--ink`, `--paper`, `--card`,
  `--green`, `--brass`, `--burgundy`, etc.) para a paleta de cores do app. Reaproveite esses tokens
  em vez de fixar cores no código.
- Markup do body: um menu lateral (`.nav-item[data-view="..."]`) e um `<div class="view"
  id="view-X">` por seção. Só uma `.view` tem a classe `active` por vez — ver "Navegação" abaixo.
- `<script>` (bloco único a partir da linha ~1660): toda a lógica do aplicativo, como funções de
  nível superior e estado global em `let`/`const` — sem classes, sem módulos, sem framework.

### Estado e persistência

Arrays globais mutáveis guardam todos os dados em memória: `horses`, `manejos`, `treinos`,
`nascimentos`, `estoqueProdutos`, `estoqueMovimentos`, `dietas`, `grupos`, `tratamentos`, `visitas`,
`lancamentos`, `funcionarios`, `usuarios`, além de `config` (objeto) e `aux` (listas auxiliares de
dropdown/autocomplete). São carregados uma vez na inicialização por `loadAll()` e mantidos
sincronizados com o armazenamento via chamadas explícitas a `storeSet(key, value)` depois de cada
mutação — não há framework reativo, então **todo código que altera um desses arrays/objetos precisa
também chamar `storeSet`** (e normalmente a `renderX()` correspondente), ou a mudança não persiste
nem aparece na tela.

A persistência é abstraída por `storeGet(key)` / `storeSet(key, value)`, que direcionam de forma
transparente para um de dois backends conforme `HAS_CLOUD_STORAGE`
(`typeof window.storage !== 'undefined'`):
- Rodando como artifact do Claude.ai → usa `window.storage` (na nuvem, com lógica de retry).
- Aberto como arquivo simples/hospedagem estática (navegador, PWA) → cai para o `localStorage` do
  navegador, com namespace `LS_PREFIX = 'haras_gestao_equina__'`.

Todos os dados reais do haras vivem só nesse armazenamento — nunca são commitados no repositório.
Os usuários exportam/importam snapshots em JSON pelos botões "⚙ Exportar/Importar Backup"
(`btnExportBackup`/`btnImportBackup`), gerando arquivos chamados `haras_backup_<timestamp>.json`.
O `.gitignore` exclui explicitamente `haras_backup_*.json` — nunca commite nem tire do
`.gitignore` arquivos de backup reais, eles contêm dados privados da fazenda. A importação faz merge
por `id` (ignora duplicatas com id exatamente igual; registros com mesmo nome mas id diferente
aparecem depois na tela "Possíveis Duplicados" — `computeDuplicatePairs`/`renderDuplicatesList` —
para o usuário resolver manualmente).

`loadAll()` também carrega migrações defensivas para formatos antigos de backup/estado (ex.:
categorias renomeadas de `valoresCasco`, criação inicial de `config.protocoloVacinasGestacao` /
`protocoloVacinasPotro` na primeira vez). Ao mudar o formato de `config` ou de uma lista
persistida, adicione ali uma migração parecida em vez de assumir estado sempre "do zero".

### Navegação e renderização

As seções ("views") funcionam por mostrar/esconder simples, não por um router: `irParaView(view)`
alterna a classe `active` em `.nav-item[data-view]` e no `#view-<name>` correspondente, e chama o
`renderX()` daquela seção para (re)construir seu DOM a partir dos arrays em memória. Não há DOM
virtual — as funções de render reconstroem o `innerHTML` a partir do estado atual a cada chamada.
Atalhos de teclado (`Alt+Shift+<letra>`, indicados no `title` de cada item do menu) também chamam
`irParaView`.

Cada domínio tem seu próprio trio `render*()`/`open*New()`/`open*Edit(id)` (ex.: `renderHorses` /
`openHorseNew` / `openHorseEdit`, `renderManejos` / abertura inline / `openManejoEdit`, e o mesmo
padrão para Treinos, Nascimentos, Estoque, Dietas, Grupos, Tratamentos, Visitas, Financeiro,
Funcionários, Usuários). Siga o mesmo padrão de nomenclatura/estrutura para qualquer novo domínio
ou campo.

O estado de "qual registro está aberto para edição" usa variáveis `editingXId` no nível do módulo
(ex.: `editingHorseId`, `editingManejoId`, `editingProdutoId`, ...) em vez de passar o id pelo DOM —
verifique essas variáveis ao trabalhar na lógica de salvar/cancelar de um formulário.

`showAlert`, `showConfirm`, `showPrompt` substituem `alert`/`confirm`/`prompt` nativos (diálogos
nativos podem ser bloqueados em iframes sandboxed, ex.: quando isso roda como artifact do Claude) —
use sempre essas funções em vez dos diálogos nativos do navegador.

### Funcionalidades transversais importantes

- **Financeiro**: os `lancamentos` (lançamentos manuais) são combinados, na hora de renderizar, com
  lançamentos *derivados* de outras seções — `lancamentosDerivadosManejos`, `...Estoque`,
  `...Treinos`, `...Visitas`, `...Tratamentos` — unificados por `todosLancamentosFinanceiro()`. Ao
  adicionar um custo em qualquer outro domínio, decida se ele também deve aparecer no Financeiro
  via um desses "derivadores" em vez de escrever direto em `lancamentos`.
- **Vacinas**: vacinas pendentes/atrasadas vêm de dois mecanismos independentes — vacinação
  regular por animal (frequência vinda de `config.freqVacinas`) e os protocolos de
  gestação/potro (`config.protocoloVacinasGestacao`/`protocoloVacinasPotro`, rastreados por
  `nascimento`/`horse`). Os dois servidores MCP reimplementam essa mesma lógica na ferramenta
  `listar_vacinas_pendentes` — mantenha-os sincronizados se você mudar as regras (ver a observação
  em `mcp-server/README.md` de que "uma vacina que o animal nunca recebeu não aparece como
  pendente" é comportamento intencional do app, não um bug).
- **Ferrageamento/Casqueamento**: a próxima data prevista agora é calculada dinamicamente a partir
  do *tipo do último procedimento lançado* (Ferrageamento = 30 dias, Casqueamento = 60 dias por
  padrão, ambos editáveis em Manejos → "Editar valores de referência") — não é mais um campo fixo
  por animal.
- **Geração de relatórios/PDF**: as funções `gerarRelatorio*` montam uma string HTML, mostram uma
  prévia em modal e depois imprimem ou repassam para o `html2pdf.js` via `wireBaixarPdfBtn`. Siga o
  padrão já existente `blocoRelatorio*` + `gerarRelatorio*` para novos relatórios.
- **Comando de voz**: `wireBotaoVoz`/`interpretarDitado`/`parseComandoLancamento` etc. implementam
  um motor genérico de ditado por palavra-chave usado em vários formulários (Manejos, Estoque,
  Animais, Nascimentos, Financeiro) — ele só preenche campos, nunca salva sozinho.
- **Usuários (`view-usuarios`)**: um seletor de perfil local baseado em PIN (`entrarNoApp`,
  `tentarLogin`, `aplicarPermissoes`), leve, para organizar quem vê quais telas — explicitamente
  *não* é uma barreira de segurança ("não é senha de banco, é organização").

### PWA / offline

`manifest.json` + `sw.js` (+ os arquivos de ícone) implementam "Adicionar à tela de início" /
funcionamento offline. O `sw.js` usa estratégia rede-primeiro (sempre busca a versão mais nova pela
rede; só cai para o cache quando está offline) — é proposital, já que o app ainda muda com
frequência; não troque para cache-primeiro. O service worker só entra em ação quando servido via
http(s) (ex.: GitHub Pages), não quando o arquivo é aberto direto com duplo clique (`file://`). Ele
só guarda em cache os arquivos do "app shell" — nunca mexe nos dados armazenados.

### Sem ferramental de build/teste/lint

Não há bundler, gerenciador de pacotes, linter, formatador nem suíte de testes para o
`app_145.html` — é HTML/CSS/JS puro, editado à mão. "Testar" uma mudança significa abrir o arquivo
no navegador e usar a tela relevante manualmente; também existe um painel "Diagnóstico" no app
(`btnDiagnostico`) que mostra a contagem de registros por chave no armazenamento e faz um teste de
ida-e-volta com um valor, útil para checar a persistência depois de mudanças relacionadas a
armazenamento.

## `mcp-server/` — servidor MCP local (somente leitura)

Um servidor MCP via stdio (Node ≥20, TypeScript) que lê um arquivo `haras_backup_*.json` exportado
do app e expõe duas ferramentas somente leitura: `listar_animais` e `listar_vacinas_pendentes`.
Nunca escreve no app nem no arquivo de backup. Ver `mcp-server/README.md` para instruções completas
de instalação/configuração no Claude Desktop.

```bash
cd mcp-server
npm install
npm run build      # tsc -> build/index.js
npm run inspect     # abre o MCP Inspector contra o build via stdio, para testar as ferramentas manualmente
npm start            # node build/index.js
```

Ordem de resolução do arquivo de backup (`src/backup.ts`, `resolveBackupPath`): argumento
`--backup <path>` > variável de ambiente `HARAS_BACKUP_PATH` > busca automática pelo
`haras_backup_*.json` mais recente na raiz do projeto. Backups têm dados reais da fazenda — não
adicione caminhos apontando para eles em arquivos commitados; prefira configurar
`HARAS_BACKUP_PATH` fora do controle de versão.

Estrutura: `src/index.ts` (inicialização do servidor, transporte stdio), `src/backup.ts`
(carregamento/cache do arquivo de backup por mtime, normalização defensiva), `src/types.ts` (tipos
compartilhados), `src/tools/` (um arquivo por ferramenta: `listarAnimais.ts`,
`listarVacinasPendentes.ts`).

Limitações conhecidas (ver `mcp-server/README.md`): somente leitura por design (nenhuma ferramenta
de escrita), `listar_animais` não retorna genealogia/observações/foto/campo `valor` (o formato de
moeda do `valor` é inconsistente — parseá-lo exigiria replicar `parseValorLivre()` do
`app_145.html`), e não há ferramenta de financeiro.

## `mcp-remote/` — servidor MCP remoto (Cloudflare Worker, somente leitura)

A mesma ideia do `mcp-server/`, mas implantado remotamente (Cloudflare Workers + Durable Objects)
com login via GitHub OAuth controlando o acesso, para poder ser usado de um celular/navegador em
vez de só do Claude Desktop na mesma máquina que tem o arquivo de backup. Ele lê o
`haras_backup_*.json` mais recente via API do GitHub, a partir de um repositório **privado** de
backups (`BACKUP_REPO_OWNER`/`BACKUP_REPO_NAME` em `wrangler.jsonc`, atualmente
`gustavojftoledo-droid/haras-backups`) em vez do sistema de arquivos local. O acesso é ainda mais
restrito a usuários específicos do GitHub via `ALLOWED_USERNAMES` em `src/index.ts`.

```bash
cd mcp-remote
npm install
npm run dev          # wrangler dev, local em http://localhost:8788
npm run type-check   # tsc --noEmit
npm run deploy       # wrangler deploy
npm run cf-typegen   # regenera worker-configuration.d.ts a partir da config do wrangler
```

Secrets (nunca commitados — configure via `wrangler secret put <NAME>`, ou em `.dev.vars` local,
copiado de `.dev.vars.example`): `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`,
`COOKIE_ENCRYPTION_KEY`, `BACKUP_REPO_TOKEN` (token do GitHub com acesso de leitura ao repositório
privado de backups).

Estrutura: `src/index.ts` (o agente `MyMCP` — definição das ferramentas e export do
`OAuthProvider`), `src/github-handler.ts` (fluxo de login via GitHub OAuth), `src/harasData.ts`
(busca do backup via API do GitHub + uma portagem da lógica de vacinas pendentes de
`mcp-server/src/`), `src/utils.ts`, `src/workers-oauth-utils.ts`. O `src/harasData.ts` deixa
explícito, em comentário, que reimplementa a lógica do `mcp-server` adaptada para busca via HTTP em
vez de acesso ao sistema de arquivos — **mantenha os dois sincronizados** quando as regras de
vacina/animal em `app_145.html` mudarem.

Este projeto começou a partir do template `remote-mcp-github-oauth` da Cloudflare; boa parte do
`mcp-remote/README.md` ainda é documentação genérica do template (fundamentos de OAuth Provider /
Durable MCP / MCP Remote, passos genéricos de deploy) — as partes específicas do Haras são
`harasData.ts`, as duas ferramentas em `index.ts` e a configuração
`ALLOWED_USERNAMES`/`BACKUP_REPO_*`.

## Convenções em todo o repositório

- Escreva texto de interface, comentários e mensagens de commit em **pt-BR**, seguindo o estilo já
  usado (conciso, no presente, explicando o *porquê* de lógica não óbvia — ver a densidade de
  comentários já existente em `app_145.html` em torno de armazenamento/migrações).
- Os dois servidores MCP são **estritamente somente leitura** por design (deixado explícito nos
  dois READMEs) — não adicione ferramentas que escrevam de volta nos dados do app ou nos arquivos
  de backup sem discutir isso antes.
- Nunca coloque dados reais da fazenda (JSON de backup, tokens, valores de `HARAS_BACKUP_PATH`
  apontando para arquivos reais) em arquivos rastreados/commitados.
