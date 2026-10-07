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

## Estado em 05/10/2026 (noite)
- Etapa 1 (código por cliente): **no ar** (app em uso e teste).
- Etapa 2 / 2b (regras e papéis no Firebase): **no ar** (publicadas pelo Gustavo).
- Etapa 3 (fotos no Storage): **preparada na branch** — `firebase/storage/` (regras 43/43, módulo 40/40). Falta encaixar no app e ativar (Blaze).
- Etapa 4 (funções no servidor): **preparada na branch** — `functions/` (26/26 + teste ponta a ponta nos emuladores): sincroniza papéis sozinho, cria/bloqueia cliente, mede uso. Falta Blaze e `firebase deploy`.
- Etapa 5 (cobrança, termos, LGPD): a decidir.

## Estado em 06/10/2026
- Blaze ativo (período grátis); Storage ativo (São Paulo); regras do Storage e 5 funções publicadas (Node 22); claim `dono` dada ao Gustavo.
- Foto nova no Storage testada no app de teste (rápida, sem alerta). Falta: mover fotos antigas, promover o código de fotos ao app em uso (só com 'pode subir'), divisão de listas (limite de 1 MiB), painel de clientes, cobrança.

- Limite de fotos por animal: claim `maxFotos` (padrão 3). A etapa 5 (cobrança) deve só ligar/desligar esse número (e a função criarCliente/painel precisa gravar a claim). Divisão das listas grandes (etapa 3b) deve vir antes de aumentar o limite para todos.
- Diagnóstico escondido de quem não é dono; `?diag=1` libera na aba.
- Divisão da Linha do Tempo por animal: projeto, protótipo e testes prontos em `projeto-linha-do-tempo/` (não publicado). Falta portar para a versão atual e testar com cópia dos dados.

## Dados como ativo: histórico de estoque e consumo (regra do dono, 07/10/2026)

Pedido do Gustavo: o histórico de **estoque, medicamentos e consumo de ração por dieta** é valioso para farmácias parceiras e empresas de ração (sazonalidade, consumo, histórico completo) e é parte da força do programa. **Nunca pode ser perdido nem apagado.** Vale principalmente para clientes que derem permissão, em especial no plano gratuito.

Decisões / pendências (nada abaixo foi implementado ainda, exceto o item 1; o item 3 aguarda o OK do dono):
1. **Dividir os documentos que enchem** (estoque por mês, treinos por ano): evita o teto de 1 MiB, que hoje é o único risco de "parar de gravar". Os documentos divididos nunca são apagados. (Feito no teste; ligar só com "pode ligar".)
2. **Excluir é excluir** (decisão do dono, 07/10/2026): quem exclui um movimento é porque registrou errado; não haverá "exclusão suave". O histórico fica completo porque, com a divisão em documentos pequenos, nunca enche e nada é apagado sozinho.
3. **Cópia permanente por cliente**: além do backup diário de 10 dias, guardar um arquivo mensal imutável (`hist_estoque_AAAA-MM`) que o app nunca altera nem apaga.
4. **Consentimento**: campo por cliente (tenant) `consentimentoDados` (data, versão do termo, quem aceitou), exigido no cadastro do plano gratuito. Só os dados de clientes com consentimento entram em análises/ofertas a parceiros.
5. **Privacidade (LGPD)**: dados oferecidos a parceiros devem ser **agregados e anonimizados** (sem nome do haras/pessoa); os termos de uso/contrato precisam de revisão jurídica antes de qualquer venda de dados.
6. Etapa 4 (painel de clientes) deve incluir: lista de quem consentiu e relatório agregado de consumo por produto/período.

## Planos (aplicados em 07/10/2026) e excedente do Pro
| | Gratuito | Básico | Pro |
|---|---|---|---|
| Módulos | Animais, Manejos, Treinos, Estoque (+ Usuários) | + Nascimentos, Veterinária, Transporte, Grupos | Todos |
| Fotos por animal | 1 | 4 | 8 |
| Usuários | 2 | 5 | sem limite |
| Espaço de dados | 200 MB | 1 GB | 5 GB |

- O plano vale de verdade: o servidor grava nas contas do cliente as claims `modulos` (já cortados pelo plano), `maxFotos`, `maxUsuarios`, `plano`; o app esconde o que está fora do plano e limita novos usuários. Mudar o plano na tela Clientes atualiza todas as contas do cliente na hora.
- **Regra do dono:** no **Pro**, espaço usado **acima do limite** é **cobrado do cliente**. Texto e valor: ver `TERMOS_E_LGPD_RASCUNHO.md` (§5.2, a revisar com advogado). A cobrança em si fica na etapa 5; hoje o app só **mede** o uso (Ver uso) e **não bloqueia**.
- **LGPD:** `TERMOS_E_LGPD_RASCUNHO.md` tem o rascunho dos Termos, da Política de Privacidade, da licença de dados agregados e o checklist técnico. **Nada disso protege sem a revisão de um advogado.** Não entregar dados a parceiros antes disso.
- **Honestidade sobre os limites do plano:** o corte de módulos, fotos e usuários vale no app e nas claims; as regras do Firestore **não** conferem módulo (só cliente e administrador). Para virar barreira de segurança, seria preciso uma etapa de regras por módulo (opcional, depois). O espaço (`limiteBytes`) hoje só é medido, não bloqueado.

## Interruptor de novidades por cliente (07/10/2026)
Hoje todo cliente recebe o mesmo app. Para entregar uma função nova só a alguns clientes: (1) registrar a chave em `RECURSOS_APP` (app) com `liberacao:'selecionados'`; (2) proteger o código novo com `if(recursoAtivo('chave'))`; (3) o dono marca os clientes em Clientes → Editar → "Novidades liberadas só para este cliente". Para liberar a todos: trocar para `liberacao:'todos'` (ou remover o `if`). Outros caminhos: plano (módulos) e o link de teste (`app_145_preview.html`).

## Etapa 5 — cobrança (versão 1: MANUAL, 07/10/2026)
Decisão do dono: começar manual. Por cliente: mensalidade, dia do vencimento e início da cobrança; pagamentos registrados mês a mês no painel (Clientes → 💰 Pagamentos). O painel mostra Atrasado / Vence em até 5 dias / Em dia / Sem cobrança e o "Recebido neste mês". Bloquear inadimplente continua sendo decisão do dono (botão Bloquear). **Valores dos planos: a decidir** (campos vazios = sem cobrança). Próximos itens da etapa 5, ainda NÃO feitos: aceite dos Termos/Política dentro do app (depende do texto do advogado), exportar todos os dados de um cliente (portabilidade), excluir cliente definitivamente (confirmação reforçada), alerta de uso de espaço 80%/100%, cobrança automática via provedor (Asaas/Mercado Pago/Stripe) se um dia fizer sentido.
