# Depois do plano Blaze: Storage e funções do servidor

**Antes:** plano Blaze ativo, com alerta de orçamento. Saber a localização do banco (Configurações do projeto → Geral →
"Local padrão dos recursos do Google Cloud"). As funções precisam ficar na mesma região do Firestore.

## A. Ativar o Storage (console, uma vez)
Firebase → **Storage** → **Começar** → modo de produção → escolher a **localização** `southamerica-east1` (São Paulo), a mesma do banco (não muda depois) → Concluir.

## B. Publicar as regras de fotos e as funções (Cloud Shell)
```
cd ~/haras-gestao-equina && git pull
cd functions && npm install
cd ../firebase
firebase login --no-localhost
firebase deploy --only storage --project equinos-manager
firebase deploy --only functions --project equinos-manager
```
- `firebase login --no-localhost` mostra um endereço; abra no navegador, entre com a conta do Firebase e cole o código no terminal.
- **Não** publicamos as regras do Firestore por aqui (já estão no ar pelo console, versão 2b).
- Se o deploy pedir para habilitar APIs (Cloud Functions, Cloud Build, Artifact Registry), aceite.
- O Firestore do Gustavo está em **São Paulo (`southamerica-east1`)**, e as funções já usam essa região por padrão. Nada a configurar.

## C. Dar a você o papel de "dono" (Cloud Shell)
```
cd ~/haras-gestao-equina/functions
GCLOUD_PROJECT=equinos-manager node definirDono.js            # simulação
GCLOUD_PROJECT=equinos-manager node definirDono.js --aplicar
```
Depois, sair e entrar de novo no app.

## D. Conferir
1. No app (versão de teste): Diagnóstico → ligar "Guardar fotos NOVAS no Firebase Storage" → trocar a foto de um animal de teste.
   Deve aparecer a foto nova em 1 ou 2 segundos, sem aviso. No console, Storage deve listar a pasta `haras-original/fotos/...`.
2. Mudar um papel na lista de usuários do app (num usuário de teste) e ver, em até alguns segundos, a claim mudar sozinha
   (rodar a simulação de `definir_papeis.js` deve mostrar "já estava assim").
3. Para voltar atrás: Firebase → Functions → apagar as funções; Storage: apagar as pastas de teste.
