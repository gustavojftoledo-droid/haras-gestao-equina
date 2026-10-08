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

### Botão "este produto é meu" (decisão do dono, 07/10/2026)
Cada item de **material/medicamento** do envio tem, **individualmente**, um botão **"este produto é meu"** (o prestador só clica se o produto foi realmente dele):
- **Não marcado** → produto do **proprietário**: estoque e preço do proprietário, com baixa; se o proprietário não tem o item, **sem baixa, sem custo, marcado como pendência**.
- **Marcado ("é meu")** → produto do **prestador**: **não baixa o estoque do proprietário**; o prestador informa o **valor cobrado** (quantidade × valor) e isso chega ao proprietário como **custo**, identificado como "produto do prestador".
- O proprietário vê esses itens destacados na solicitação e no PDF, pode **revisar o valor** ou **recusar** antes de aprovar (é a proteção dele contra cobrança indevida).
- Servidor: item marcado exige valor cobrado; item não marcado **não leva preço** (rejeitado/ignorado). O preço de **compra** e o estoque do prestador nunca saem da assinatura dele; sai só o que ele **cobra** do proprietário.
- A baixa no estoque do próprio prestador (se ele controlar estoque) segue as regras da assinatura dele.

## Tipo de assinatura (decisão do dono, 07/10/2026)
Para não poluir o programa de um cliente comum, cada assinatura tem um **tipo**, definido **só pelo dono** (Clientes → Editar, e ao criar): **proprietário** (padrão: haras/cliente comum — autoriza prestadores e aprova o que chega), **prestador** (veterinária, ferrador... — aceita convites e envia registros; é aqui que existe o botão "este produto é meu") ou **ambos**. O tipo vai para a claim `tipoAssinatura`; o servidor confere o lado em cada ação (prestador não convida nem muda animais; proprietário não aceita convite; só quem faz o lado de prestador pode ser convidado); a tela só mostra o lado de cada tipo. O haras original do dono é proprietário. Conta antiga sem a claim vale como proprietário. O interruptor `integracao_prestadores` continua dizendo **para quem** a integração foi liberada; o tipo diz **o que cada um vê**.

## Segurança (decisão de arquitetura)
As regras do Firestore **continuam fechadas entre clientes**. Toda troca passa por funções do servidor (callable), com a assinatura do chamador vindo da **claim** do login (nunca do pedido). Coleções de servidor (`vinculos`, `solicitacoes`) não são legíveis pelo app direto.

## Etapas
1. **Vínculo** (FEITA, no teste): convidar por e-mail, aceitar/recusar, escolher animais, revogar. Funções: `convidarPrestador`, `listarVinculos`, `responderConvite`, `atualizarAnimaisDoVinculo`, `revogarVinculo`. Tela "Prestadores".
2. **Envio** (FEITA, no teste): o prestador escolhe um animal da lista autorizada e registra medicamento/aplicação/tratamento/procedimento/materiais/observações (sem preço). Gera solicitação **pendente**. Prestador pode cancelar enquanto pendente.
3. **Aprovação**: o proprietário vê, **edita (revisa)**, aprova ou recusa (com motivo). Ao aprovar, o app aplica o dado pelo mesmo caminho do lançamento manual e confirma ao servidor. Pendência de estoque quando o produto não existe.
4. **PDF e auditoria**: PDF da solicitação em qualquer status; linha na Auditoria; alerta/quadro de pendentes.

## Pontos para o advogado (LGPD)
É compartilhamento de dados entre dois clientes, autorizado pelo proprietário, revogável e registrado. Os Termos precisam prever: base legal, finalidade, o que o prestador vê (só os animais liberados), retenção do que foi aprovado e dever do prestador de não usar os dados para outro fim.


## Redesenho do envio + etapa 3 (decisões do dono, 08/10/2026)
- O prestador **não usa formulário separado**: usa as **mesmas telas** (Visita veterinária) do programa dele. Os animais **liberados** pelos clientes entram na lista dele como **Externos** ("Alfa (Paulo Toledo)"), ligados ao vínculo; somem dos seletores se o acesso for retirado.
- Ao salvar uma visita com animal de cliente, o programa **pergunta sempre** "Publicar no programa do cliente?". Vai como **pendente**; corrigir a visita **enquanto pendente substitui** a versão anterior (depois de decidida, a correção vira solicitação nova).
- Cada linha de produto na visita é **"meu"** (sai do estoque do prestador, preço dele, entra na cobrança) ou **"do cliente"** (só nome + quantidade, **não entra na cobrança dele**, não mexe no estoque dele).
- O proprietário **aprova** (podendo corrigir valores/quantidades), **recusa** (com motivo, que o prestador vê) e, ao aprovar, o app grava na ficha como **Visita veterinária** (idempotente: leva o id da solicitação). Produto do cliente: baixa no estoque dele e custo pelo preço dele; se não existir ou faltar saldo → **pendência**, sem baixa e sem custo. Produto do prestador → custo "produto do prestador", sem baixa.
- Alerta na tela ao entrar quando há registros pendentes.
- **Ainda falta:** Tratamento (protocolo com doses) publicado ao cliente; casqueamento/ferrageamento (manejo de casco); PDF e auditoria (etapa 4).
