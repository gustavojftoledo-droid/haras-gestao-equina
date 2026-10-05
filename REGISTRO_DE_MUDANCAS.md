# Registro de mudanças da auditoria (para poder voltar atrás)

Cada mudança entra por um *Pull Request* separado, então dá para desfazer só aquela parte.
**Ponto de retorno geral:** o commit `9deedb9` (Pull Request #32) é o programa exatamente como estava antes de qualquer correção da auditoria. Ele continua guardado no histórico da `main`.

Como desfazer uma parte: pedir "desfaz a parte N" (usa `git revert` do PR indicado) ou voltar tudo para o commit 9deedb9.

| Parte | PR | O que mudou | O que conferir depois |
|---|---|---|---|
| 1 | #33 | Importar backup não quebra com contatos; aux_lists não lida não é regravada; sair apaga "já entrou neste aparelho" e sem sessão não entra como Admin; "1.500" vale 1500 | Importar um backup; sair e entrar de novo; digitar valores com ponto de milhar |
