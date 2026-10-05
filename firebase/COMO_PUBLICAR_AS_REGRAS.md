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
