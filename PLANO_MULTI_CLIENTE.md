# Plano: vender o programa por assinatura (vários clientes)

Decisões do Gustavo (05/10/2026): ~30 clientes nos primeiros meses; vários usuários por cliente; **um link só** para todos;
sem vídeo por enquanto (só fotos); Firebase como banco único; clientes criados manualmente no começo.

## Modelo
- **Um app, um projeto Firebase** (`equinos-manager`). Cada cliente = um *tenant*.
- Dados do cliente em `tenants/{id}/dados/{chave}` (mesmas chaves de hoje: `horses_list`, `estoque_produtos`...).
- **Haras original (Gustavo) continua em `harasData`**, sem migração: usuário sem `tenantId` = haras original.
- O `tenantId` vem de uma *claim* no login, criada só pelo servidor (Admin SDK / Cloud Function). O app não escolhe o cliente sozinho.

## Etapas
1. **(feita só na branch)** O app lê/grava na coleção do cliente (`colecaoDados()`), com o haras original inalterado. Inofensiva enquanto ninguém tiver a claim.
2. **Regras do Firestore no servidor**: cada claim só acessa `tenants/{seu id}/...`; papel (admin/funcionário) conferido no servidor; regras guardadas no repositório (`firestore.rules`).
3. **Dividir listas em blocos** (limite de 1 MB por documento) e **fotos no Firebase Storage** com cache e miniaturas. Meta: ~1 GB por cliente.
4. **Painel do dono**: criar cliente (Cloud Function define a claim), ver uso de espaço, bloquear inadimplente. Requer plano Blaze.
5. **Cobrança**, termos de uso e LGPD; backup e exclusão de dados por cliente.

## Custos (estimativa, conferir na calculadora do Firebase)
Uso real do haras original: ~500–1.300 leituras/dia e ~100–420 gravações/dia (cota gratuita: 50 mil / 20 mil por dia).
Para 30 clientes a ~65% do uso, mesmo com 3–10x mais leituras após dividir as listas, o banco fica em poucos dólares por mês.
Fotos (~150 KB cada, com cache): centavos. **Vídeo** é o que pesa (cada visualização baixa o arquivo inteiro) — fora do escopo.

## Riscos conhecidos (da auditoria de 05/10/2026)
- Regras atuais: `allow read, write: if request.auth != null` — qualquer logado lê/escreve tudo (resolve na etapa 2).
- Criação livre de contas já foi **desativada** no console.
- Permissões do app só valem na tela até a etapa 2.
- Filtros e seleções salvos no aparelho (localStorage) ainda não são por cliente.
