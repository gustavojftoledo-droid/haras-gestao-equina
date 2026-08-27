# equinos-bot

Bot do Telegram que entende **frase solta** (texto ou voz-do-teclado) pra **cadastrar Animal**
e **registrar Manejo** no Equinos Manager. Uma IA barata (Claude Haiku) extrai os campos; o bot
mostra a **prévia** e só grava depois do **botão Confirmar**. Grava direto no mesmo Firestore que
o app usa.

Exemplos:
> Cadastra a Estopa, fêmea, filha do Vento com a Aurora, nascida ontem, tordilha, do Paulo
> Ferrei hoje a Rosa, a Tirania e a Tulipa

- Só o seu chat do Telegram é aceito (lista de permissão).
- Toda gravação entra na auditoria do app como "Chatbot (Telegram)".
- Concorrência: relê o Firestore na hora de confirmar, então não sobrescreve edição feita no app nesse meio-tempo.
- Custo: Telegram/Cloudflare/Firestore grátis; a IA custa ~R$0,01 por comando (uns poucos reais/mês no uso normal).
- Transcrição de áudio (mensagem de voz do Telegram) ainda não — use o microfone do teclado.
- Vacina/Vermífugo com baixa de estoque: pelo app.

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

# chave da API da Anthropic — crie em console.anthropic.com > API keys
# (precisa de um cartão / créditos nessa conta; o uso é de centavos por comando)
npx wrangler secret put ANTHROPIC_API_KEY

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

Manda a frase, do jeito que falar. A IA entende e monta.

> Cadastra a Estopa, fêmea, filha do Vento com a Aurora, nascida ontem, tordilha, categoria potro, do Paulo Toledo

> Ferrei hoje a Rosa, a Tirania e a Tulipa

> Casqueei a Estrela dia 20/08

O bot mostra a prévia e só grava depois do botão **Confirmar**. Se faltar algo (nome, sexo,
qual animal…) ele pergunta. Nomes de pai/mãe/animais são batidos com o cadastro (ignora
acento e maiúscula); animal que não existe, ele avisa e não grava.

| Comando | O que faz |
|---|---|
| `/start` | Explica como usar |
| `/cancelar` | Esquece a conversa atual |

Vacina e Vermífugo (com baixa de estoque) ficam de fora — use o app pra esses.

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
| `src/ai.ts` | Chama o Claude Haiku (tool use) e devolve os campos do Animal/Manejo, ou uma pergunta |
| `src/flows.ts` | Conversa: chama a IA, valida, bate nomes com o cadastro, prévia/confirmação, gravação |
| `src/domain.ts` | Regras portadas do app: monta o objeto do animal/manejo, genealogia, listas auxiliares, auditoria |
| `src/firestore.ts` | Leitura/escrita no Firestore via REST + JWT da conta de serviço |
| `src/telegram.ts` | Chamadas à API do Telegram |

## Como estender (mesma lógica)

Cada nova entidade que "tem a mesma lógica" (Dieta, Nascimento, Treino, Transporte…) é:
1. um builder em `domain.ts` (`montarX`) que devolve o objeto no formato do app;
2. uma ferramenta nova em `ai.ts` (`TOOLS[]`) com o schema dos campos;
3. um ramo em `flows.ts` → `interpretarEResponder` (validar + `previewX` + `pendente`) e um `gravarX`.

O passo de confirmação e a gravação (`getList`/`setList` + `auditEntrada`) já são genéricos.
