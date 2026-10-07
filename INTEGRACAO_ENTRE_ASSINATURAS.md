# Integração entre assinaturas — prestadores de serviço (especificação e plano)

Origem: PDF "Equinos Manager — Integração entre assinaturas" do dono (07/10/2026). Decisões do dono:
1. **Convite pelo e-mail** do administrador da assinatura do prestador.
2. **Animais**: o proprietário libera **um a um, com a opção "todos"**; pode mudar ou revogar a qualquer hora.
3. **Destino do dado**: ao aprovar, entra **igual a um lançamento feito pelo próprio cliente** (mesmo código de manejo/tratamento/visita/estoque/linha do tempo). Só consta de forma discreta quem enviou e de qual assinatura.
4. **Aviso** ao proprietário: **alerta na tela** + quadro "Solicitações pendentes" (Telegram/e-mail ficam para depois).
5. Tudo atrás do interruptor `integracao_prestadores` (liberado só aos clientes marcados no painel).

## Regras do PDF (resumo)
Vínculo; prestador envia na própria assinatura; fica **pendente**; proprietário **aprova / recusa / revisa antes de aprovar**; só depois entra na ficha/timeline; estoque do proprietário segue a regra atual (se o produto não existe lá: **sem baixa, sem custo, marcado como pendência**); cada assinatura mantém seus próprios preços/estoque/financeiro (o preço do prestador **nunca** sai da assinatura dele); registro de quem enviou, qual assinatura, quando, animal, o que, status; PDF em qualquer etapa (pendente/aprovado/recusado) **sem** mudar o status.

## Regra de valores (decisão do dono, 07/10/2026) — refina o item 5 do PDF
Cada item enviado é de um de dois tipos:
1. **Serviço do prestador** (casquear/ferrar, consulta, procedimento, ultrassom/exame, deslocamento): o proprietário **paga o prestador**, então **vai junto o valor do prestador**. Ao aprovar, entra no financeiro do proprietário como custo de serviço (o proprietário pode **revisar o valor antes de aprovar**).
2. **Material e medicamento** (ferradura, remédio): o proprietário **compra e guarda no estoque dele**, então vale o **estoque e o preço do proprietário**, com a baixa pela regra atual. Se o item **não existe** no estoque do proprietário: **sem baixa, sem custo, marcado como PENDÊNCIA** para regularizar depois.
- O que o prestador pagou/cobra pelos **materiais dele** (preço de compra, estoque dele) **nunca sai da assinatura dele**.
- Para o prestador, o envio de um item de serviço tem campo de valor; o de material tem só nome/quantidade.

## Segurança (decisão de arquitetura)
As regras do Firestore **continuam fechadas entre clientes**. Toda troca passa por funções do servidor (callable), com a assinatura do chamador vindo da **claim** do login (nunca do pedido). Coleções de servidor (`vinculos`, `solicitacoes`) não são legíveis pelo app direto.

## Etapas
1. **Vínculo** (esta etapa): convidar por e-mail, aceitar/recusar, escolher animais, revogar. Funções: `convidarPrestador`, `listarVinculos`, `responderConvite`, `atualizarAnimaisDoVinculo`, `revogarVinculo`. Tela "Prestadores".
2. **Envio**: o prestador escolhe um animal da lista autorizada e registra medicamento/aplicação/tratamento/procedimento/materiais/observações (sem preço). Gera solicitação **pendente**. Prestador pode cancelar enquanto pendente.
3. **Aprovação**: o proprietário vê, **edita (revisa)**, aprova ou recusa (com motivo). Ao aprovar, o app aplica o dado pelo mesmo caminho do lançamento manual e confirma ao servidor. Pendência de estoque quando o produto não existe.
4. **PDF e auditoria**: PDF da solicitação em qualquer status; linha na Auditoria; alerta/quadro de pendentes.

## Pontos para o advogado (LGPD)
É compartilhamento de dados entre dois clientes, autorizado pelo proprietário, revogável e registrado. Os Termos precisam prever: base legal, finalidade, o que o prestador vê (só os animais liberados), retenção do que foi aprovado e dever do prestador de não usar os dados para outro fim.
