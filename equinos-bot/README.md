# equinos-bot

Bot do Telegram com **menu guiado** (sem IA) pra **cadastrar Animal** e **registrar Manejo**
no Equinos Manager. Grava direto no mesmo Firestore que o app usa, sempre com **prévia +
botão Confirmar** antes de qualquer gravação.

- Sem IA, sem transcrição de áudio → **custo zero** (Cloudflare Workers grátis + Firestore grátis + Telegram grátis).
- Só o seu chat do Telegram é aceito (lista de permissão).
- Toda gravação entra na auditoria do app como "Chatbot (Telegram)".
- Concorrência: relê o Firestore na hora de confirmar, então não sobrescreve edição feita no app nesse meio-tempo.

## O que já está pronto

- Código completo (`src/`), testes passando (`npm test` — 16 testes).
- KV namespace `SESSIONS` criado (id já no `wrangler.jsonc`).
- `wrangler deploy --dry-run` OK.

## O que falta — 3 passos (uma vez só)

### 1. Criar o bot no Telegram
1. No Telegram, fale com **@BotFather** → `/newbot` → dê um nome e um usuário (ex: `equinos_haras_bot`).
2. Ele devolve um **token** tipo `8123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`. Guarde.
3. Descubra seu **chat id**: fale com **@userinfobot** → ele responde `Id: 123456789`.

### 2. Criar a conta de serviço do Firebase (acesso de escrita ao banco)
1. https://console.firebase.google.com → projeto **equinos-manager** → ⚙ **Configurações do projeto** → aba **Contas de serviço**.
2. Botão **Gerar nova chave privada** → baixa um arquivo `.json`.
3. Esse JSON tem `client_email` e `private_key` — é o que o bot usa pra gravar. **Não commitar em lugar nenhum.**

> A chave já vem com permissão de escrever no Firestore (papel "Editor"). Se quiser restringir:
> Google Cloud Console → IAM → essa conta de serviço → deixar só **Usuário do Cloud Datastore**.

### 3. Configurar os segredos e publicar

Rodar na pasta `equinos-bot/` (o `wrangler` já está logado nesta máquina):

```bash
# token do BotFather
npx wrangler secret put TELEGRAM_TOKEN

# um segredo aleatório qualquer (invente uma senha longa) — protege o webhook
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET

# cole o JSON INTEIRO da conta de serviço, numa linha só
npx wrangler secret put GCP_SERVICE_ACCOUNT

# seu chat id (pode pôr vários separados por vírgula)
npx wrangler secret put ALLOWED_CHAT_IDS

# publica
npm run deploy
```

O deploy imprime a URL do Worker, ex: `https://equinos-bot.SEU-SUBDOMINIO.workers.dev`.

### 4. Registrar o webhook do Telegram

Trocar `<TOKEN>`, `<URL>` e `<SECRET>` (o `TELEGRAM_WEBHOOK_SECRET` do passo 3):

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=<URL>/webhook/<SECRET>&secret_token=<SECRET>"
```

Deve responder `{"ok":true,"result":true,"description":"Webhook was set"}`.

Pronto. No Telegram, mande **/start** pro bot.

## Como usar

Modo **bloco**: o bot manda um modelo, você preenche (uma info por linha, `Campo: valor`) e
manda tudo **numa mensagem só**. Ordem não importa, linha em branco = campo vazio.

```
Nome: Estopa
Sexo: fêmea
Nascimento: 26/08/2026
Pai: Vento
Mãe: Aurora
Pelagem: Tordilho
Categoria: Potro
Proprietário: Paulo Toledo
```

Manejo com vários animais de uma vez:

```
Tipo: Casco
Ferrageamento: Ferrado completo
Data: hoje
Animais: Estrela, Vento, Aurora
Obs:
```

O bot valida, mostra a prévia e só grava depois do botão **Confirmar**.

| Comando | O que faz |
|---|---|
| `/start` | Abre o menu |
| `/animal` | Manda o modelo de cadastro de animal |
| `/manejo` | Manda o modelo de registro de manejo (Casco, Dente ou outro) |
| `/cancelar` | Aborta o que estava fazendo |

Vacina e Vermífugo ficam de fora nesta versão (dependem do controle de estoque) — use o app pra esses.

## Desenvolvimento

```bash
npm install
npm test            # testes (lógica + conversa inteira, sem credenciais)
npm run type-check
npx wrangler deploy --dry-run
```

## Arquivos

| Arquivo | Papel |
|---|---|
| `src/index.ts` | Entrada do Worker: recebe o webhook, checa permissão, roteia |
| `src/flows.ts` | Máquina de estado das conversas (Animal, Manejo) + prévia/confirmação |
| `src/domain.ts` | Regras portadas do app: monta o objeto do animal/manejo, genealogia, listas auxiliares, auditoria |
| `src/firestore.ts` | Leitura/escrita no Firestore via REST + JWT da conta de serviço |
| `src/telegram.ts` | Chamadas à API do Telegram |

## Como estender (mesma lógica)

Cada nova entidade que "tem a mesma lógica" (Dieta, Nascimento, Treino, Transporte…) é:
1. um builder em `domain.ts` (`montarX`) que devolve o objeto no formato do app;
2. um fluxo de perguntas em `flows.ts` (copiar `startManejo`/`manejoText`/`previewManejo`/`confirmarManejo`);
3. um item no menu.

O passo de confirmação e a gravação (`getList`/`setList` + `auditEntrada`) já são genéricos.
