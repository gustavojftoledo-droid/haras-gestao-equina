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
