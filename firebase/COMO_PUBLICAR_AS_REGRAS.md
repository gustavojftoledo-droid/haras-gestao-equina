# Regras do Firestore — etapa 2 (isolamento por cliente)

**O que as regras fazem**
- Quem **não tem** `tenantId` no login (o haras original, do Gustavo) continua lendo/gravando só em `harasData`, exatamente como hoje.
- Quem **tem** `tenantId` só acessa `tenants/{seu id}/dados/...`. Não enxerga o haras original nem outro cliente.
- Visitante sem login: nada. Qualquer outra coleção: bloqueada.

**Efeito para os 6 usuários de hoje: nenhum** (nenhum tem `tenantId`).

## Testado antes de publicar
`test_rules.mjs` roda 19 verificações no emulador do Firestore (anônimo, haras original, cliente A, cliente B, claim vazia,
outras coleções, listagens). Resultado: 19 passaram, 0 falharam.
Para repetir: `firebase emulators:start --only firestore` e `node test_rules.mjs` (precisa de Java e `@firebase/rules-unit-testing`).

## Passo a passo para publicar (pelo console, no tablet ou computador)
1. **Antes de tudo, guarde as regras atuais.** Console Firebase → projeto *Equinos manager* → **Firestore Database → Regras**.
   Copie o texto que está lá (hoje: `allow read, write: if request.auth != null;`) e salve nas anotações. É o plano de volta.
2. Apague o texto da caixa e cole o conteúdo de `firestore.rules` deste repositório.
3. Toque em **Publicar**.
4. Teste na hora, no app em uso: recarregue, abra Início, abra um animal, salve uma observação qualquer e confira que salvou.
5. Se algo falhar: volte em **Regras**, cole o texto antigo (passo 1) e publique de novo. O histórico de versões da própria tela também permite voltar.

## Depois desta etapa
- Só agora é seguro criar o **primeiro cliente** (etapa 4), porque ele não consegue ver o haras original.
- Ainda **não** impede que um funcionário do haras original mexa em dados que a tela esconde (financeiro, usuários). Isso é a etapa 2b:
  precisa de papéis (claims) para cada usuário.

---

# Etapa 2b — só administrador altera a lista de usuários

**O problema que resolve:** hoje a lista de usuários (e o "administrador") fica num documento comum; quem está logado poderia
editá-la pelo navegador e se promover a administrador. Na 2b, o servidor só aceita essa gravação de quem tem a claim `papel = admin`,
e a claim só pode ser criada por quem administra o Firebase (não pelo próprio usuário).

**Ordem obrigatória (se inverter, o administrador fica sem poder editar usuários até corrigir):**
1. Publicar a **2a** (`firestore.rules`) — já descrita acima.
2. No **Google Cloud Shell** (computador, não tablet): rodar `definir_papeis.js` — primeiro sem `--aplicar` (simulação), conferir a lista,
   depois com `--aplicar`. Ele grava `papel` e `modulos` no login de cada usuário, mantém `tenantId` se existir, e pode rodar de novo à vontade.
3. **Todos** saem do app e entram de novo (a claim só vale no login novo). Confirmar, como administrador, que a tela Usuários ainda salva.
4. Publicar a **2b** (`firestore.rules.2b`) no console, no mesmo lugar da 2a.
5. Se algo falhar: colar de volta o texto da 2a e publicar.

**Quando criar um usuário novo:** criar a conta no console do Firebase, cadastrar no app (Administração → Usuários) e rodar o script de novo
(para ele receber o papel). Sem a claim, o usuário funciona como funcionário comum (não altera a lista de usuários).

**Testes:** `test_rules_2b.mjs` — 14 verificações no emulador (funcionário não se promove a admin, admin grava, cliente A não toca no original, etc.): 14/14.
`definir_papeis.js` foi testado nos emuladores do Firestore e do Authentication: simulação não grava; aplicar grava; mantém `tenantId`; idempotente; ignora e-mail sem conta.

**O que a 2b ainda não resolve:** um funcionário ainda pode ler o financeiro/valores direto pelo navegador (a tela esconde, o servidor não).
Esconder isso no servidor exige mudar como os dados são divididos (etapa 3).

## Comandos do Cloud Shell (etapa 2b, passo 2)
1. Abra https://console.cloud.google.com/ logado na conta do Firebase, escolha o projeto **equinos-manager** e toque no ícone `>_` (Ativar Cloud Shell), canto superior direito.
2. Cole, um bloco de cada vez:
```
git clone -b claude/trusting-hawking-lakog5 --depth 1 https://github.com/gustavojftoledo-droid/haras-gestao-equina.git
cd haras-gestao-equina/firebase
npm init -y > /dev/null && npm i firebase-admin
gcloud config set project equinos-manager
GCLOUD_PROJECT=equinos-manager node definir_papeis.js
```
3. Confira a lista (quem é `admin`, quem é `funcionario`, quantos módulos, quem está "SEM CONTA"). Se estiver certo:
```
GCLOUD_PROJECT=equinos-manager node definir_papeis.js --aplicar
```
4. Se aparecer erro de credencial: `gcloud auth application-default login` e repetir.
