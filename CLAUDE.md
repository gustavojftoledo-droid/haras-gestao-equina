# Como trabalhar com o Gustavo (dono do sistema)

O Gustavo não é programador e tem TDAH. Combinados dele:

## Como guiar testes e passos
- Sempre em **checklist curto, em ordem**, com caixinha `- [ ]` por item: **onde clicar → o que fazer → o que deve aparecer**.
- Um passo por item, frases curtas, sem jargão. Dizer exatamente qual menu/botão e o que esperar ver.
- Terminar com: "me diga o número do passo e se deu certo ou erro (com print)".
- Comandos de Cloud Shell: **um bloco por vez**, em linha única, dizendo o que deve aparecer no final (ex.: `Deploy complete!`).
- Os testes dele são no **app normal** (`app_145.html`), a menos que ele peça a versão de teste.
- Para blocos grandes, criar um doc de checklist (Claude Docs) com caixinhas, como o "Checklist de testes — PR 90 até o PR 95".

## Regras de publicação
- Mudanças vão primeiro para `app_145_preview.html` (teste). `app_145.html` (em uso) só quando ele disser **"pode subir"** (ou pedir "direto"). "Pode ligar" = ligar interruptores. "Volta um passo" = reverter o último PR.
- Fluxo: branch de trabalho → PR → merge em `main` (esperar ~10 s antes do merge). Registrar cada mudança em `REGISTRO_DE_MUDANCAS.md`.
- Funções novas do servidor: ele publica no Cloud Shell (deploy + liberar `roles/run.invoker` para `allUsers`, nome do serviço em minúsculas).
- Nunca mexer no cliente real **Estância Felicidade** sem ele pedir.
- Decisões dele sobre dados: "excluir é excluir"; cliente não tem veto; manter dados exige mínimo mensal e 12 meses sem pagar = perde o direito (ver `TERMOS_E_LGPD_RASCUNHO.md`, §5.3).
