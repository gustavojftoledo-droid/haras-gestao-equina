# Cloud Functions do Haras

Funções que rodam no servidor do Firebase (projeto `equinos-manager`). Nada aqui foi publicado ainda.

## O que cada função faz

| Função | Quando roda | O que faz |
|---|---|---|
| `sincronizarPapeis` | quando `harasData/usuarios_list` muda | Acerta `papel` e `modulos` de cada pessoa da lista (acha a conta pelo e-mail). Quem saiu da lista perde papel/módulos. Rebaixou ou perdeu módulo: o login da pessoa é derrubado (ela entra de novo e já vem com o papel certo). |
| `sincronizarPapeisCliente` | quando `tenants/{id}/dados/usuarios_list` muda | O mesmo, e também grava `tenantId`. |
| `criarCliente` | chamada pelo app (só dono) | `{nome, emailAdmin, senhaProvisoria?, nomeAdmin?}` cria o cliente e devolve `{tenantId}`. Se você não passar senha e a conta for nova, devolve também `senhaGerada`. |
| `bloquearCliente` | chamada pelo app (só dono) | `{tenantId, ativo}` desativa/reativa todas as contas do cliente. |
| `usoDoCliente` | chamada pelo app (só dono) | `{tenantId}` devolve `{bytes, documentos, percentualDoLimite}`. |
| `listarClientes` | chamada pelo app (só dono) | Sem entrada. Devolve `{clientes:[{id, nome, ativo, plano, criadoEm, limiteBytes, consentimentoDados, contas, emailAdmin, ultimoAcesso}]}` ordenado por nome. |
| `atualizarCliente` | chamada pelo app (só dono) | `{tenantId, nome?, plano?, limiteBytes?, consentimentoDados?}` devolve `{tenantId, atualizado:[campos]}`. |

### Painel de clientes (`listarClientes` e `atualizarCliente`)

- `listarClientes` lê `clientes` e lista as contas do Auth uma única vez (paginado), agrupando por `tenantId` na memória. `ativo` assume `true`, `plano` `'basico'` e `limiteBytes` 1 GB quando faltam. `criadoEm` e `consentimentoDados.data` saem em ISO (ou `null`). `contas` é o número de contas do cliente, `emailAdmin` o e-mail da primeira conta com `papel==='admin'` (ou `''`) e `ultimoAcesso` o login mais recente entre elas (ou `null`). Não calcula uso de armazenamento: use `usoDoCliente` sob demanda.
- `atualizarCliente` só grava `nome` (2 a 100 letras, sem espaços nas pontas), `plano` (`gratuito`, `basico` ou `pro`), `limiteBytes` (inteiro de 1048576 a 107374182400) e `consentimentoDados` (`{aceito:boolean, versao:1 a 40 caracteres}`, guardado como `{aceito, versao, data: agora em ISO, por: e-mail do dono}`). Nunca altera `ativo` (isso é do `bloquearCliente`). Sem nenhum campo válido: `invalid-argument` "Nada para atualizar". Cliente inexistente: `not-found`.
- Para publicar (na raiz do repositório, onde fica o `firebase.json`): `firebase deploy --only functions`.

Proteções que acrescentei (além do pedido): uma lista de usuários nunca altera a conta do dono, nem a de outro cliente, nem (lista de cliente) a conta de quem é do haras original. `criarCliente` recusa um e-mail que já pertence a outro cliente, ao haras original ou ao dono.

Observações: usuário bloqueado perde o acesso quando o token atual expira (até cerca de 1 hora), porque tokens já emitidos continuam valendo até lá. A região padrão é `southamerica-east1` (São Paulo), a mesma do Firestore do Gustavo. Para outra região, crie `functions/.env` com `REGIAO_FUNCOES=...` antes do deploy.

## Como testar sem publicar nada (emuladores)

```
npm install --prefix /tmp/fn firebase-tools      # uma vez
cd functions && npm install
# firebase.json de teste (fora do repositório), ex. /tmp/fn/firebase.json:
# {"emulators":{"auth":{"port":9099},"firestore":{"port":8080},"ui":{"enabled":false}}}
cd /tmp/fn && ./node_modules/.bin/firebase emulators:exec --only firestore,auth --project demo-haras \
  "cd <repo>/functions && node --test test/*.test.js"
```

`test/e2e_emuladores.js` é o teste de ponta a ponta (usa o emulador de Functions de verdade: grava no Firestore e confere que o trigger mudou as claims). Precisa de `functions` na `firebase.json` (`"source": "functions"`) e, neste ambiente do Claude, de rodar sem as variáveis `HTTP(S)_PROXY`.

## Como publicar (você faz; eu não executei)

1. No console do Firebase, mude o projeto para o plano **Blaze** (obrigatório para Cloud Functions; tem cota gratuita mensal, e você pode pôr um alerta de orçamento).
2. No Cloud Shell, dentro da pasta do repositório: `cd functions && npm install` e depois `firebase deploy --only functions --project equinos-manager`.
3. Ainda no Cloud Shell, dê a claim de dono: `node definirDono.js` (simulação) e depois `node definirDono.js --aplicar`. Saia e entre de novo no app.
4. Depois de publicado, o `definir_papeis.js` manual não é mais necessário no dia a dia (serve só para a primeira carga, ou salve a lista de usuários de novo para disparar o trigger).
5. Os triggers só reagem a mudanças novas: para quem já existe, rode `definir_papeis.js --aplicar` uma vez ou edite/salve a lista.

## Planos (07/10/2026)
O plano do cliente (`clientes/{id}.plano`: gratuito | basico | pro; ausente = basico) define, nas contas dele, as claims
`{ tenantId, papel, modulos, maxFotos, maxUsuarios, plano }`. `modulos` = permissões da lista de usuários ∩ módulos do plano.

| | gratuito | basico | pro |
|---|---|---|---|
| módulos | animais, manejos, treinos, estoque, usuarios | + nascimentos, veterinaria, transporte, grupos | todos |
| maxFotos | 1 | 4 | 8 |
| maxUsuarios | 2 | 5 | 0 (sem limite) |
| limiteBytes | 200 MB | 1 GB | 5 GB |

- `criarCliente` aceita `plano` (padrão basico). `atualizarCliente` com plano diferente: troca `limiteBytes` pelo do plano (a não ser que venha um limite junto) e reaplica as claims de TODAS as contas do cliente (lista de usuários ∩ plano; passou do limite de usuários = admins primeiro, resto sem acesso; quem perdeu módulo tem a sessão derrubada). Devolve `'claims'` em `atualizado`.
- `listarClientes` devolve também `limites` e `usuariosNaLista`.
- **Honestidade sobre o que é trava:** as regras do Firestore (`firebase/firestore.rules*`) só conferem o cliente (`tenantId`) e se a conta é administradora; **não conferem módulo**. O corte por plano vale no app (menu/telas, limite de usuários e de fotos) e nas claims; **não é uma barreira de segurança** contra quem acessa o banco por fora do app. O isolamento entre clientes e o bloqueio (`ativo`) são travas reais.
- O limite de espaço (`limiteBytes`) é medido por `usoDoCliente`; **não bloqueia** gravações. No plano Pro o excedente é cobrado do cliente (ver `TERMOS_E_LGPD_RASCUNHO.md`).

## Novidades por cliente ("interruptor")
`clientes/{id}.recursos` = lista de chaves curtas (`^[a-z][a-z0-9_]{1,29}$`, até 12). Vai para a claim `recursos` de todas as contas do cliente (criarCliente aceita `recursos`; `atualizarCliente` com `recursos` diferente reaplica as claims e devolve `'claims'`; o gatilho de usuários mantém). `listarClientes` devolve `recursos`. No app: `RECURSOS_APP` (registro) + `recursoAtivo('chave')`; o haras original (sem cliente) sempre vê tudo.

## Criar login da equipe pelo próprio programa (`criarLoginDoUsuario`)
Callable chamada pelo **administrador do cliente** (claim `papel='admin'`; o cliente vem da claim do chamador). Entrada: `{ email, senhaProvisoria?, redefinir? }`. Regras: o e-mail precisa estar na `usuarios_list` do cliente e caber nos lugares do plano (admins primeiro); recusa conta do dono, de outro cliente ou do haras original; conta nova nasce **desligada**, recebe as claims e só então é ligada (falhou = apagada); `redefinir:true` gera senha nova e derruba as sessões. Devolve `{ email, criado, redefinida, jaExistia, senhaGerada? }` (a senha só aparece quando foi gerada agora). Depois do deploy, abrir a chamada: `gcloud run services add-iam-policy-binding criarlogindousuario --region=southamerica-east1 --member=allUsers --role=roles/run.invoker --project=equinos-manager`.
