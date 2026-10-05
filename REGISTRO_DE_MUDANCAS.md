# Registro de mudanças da auditoria (para poder voltar atrás)

Cada mudança entra por um *Pull Request* separado, então dá para desfazer só aquela parte.
**Ponto de retorno geral:** o commit `9deedb9` (Pull Request #32) é o programa exatamente como estava antes de qualquer correção da auditoria. Ele continua guardado no histórico da `main`.

Como desfazer uma parte: pedir "desfaz a parte N" (usa `git revert` do PR indicado) ou voltar tudo para o commit 9deedb9.

| Parte | PR | O que mudou | O que conferir depois |
|---|---|---|---|
| 1 | #33 | Importar backup não quebra com contatos; aux_lists não lida não é regravada; sair apaga "já entrou neste aparelho" e sem sessão não entra como Admin; "1.500" vale 1500 | Importar um backup; sair e entrar de novo; digitar valores com ponto de milhar |
| 2 (só teste) | #35 | Textos digitados (nomes, observações, contatos, usuários, auditoria) passam por proteção antes de aparecer na tela; links/imagens só aceitam endereços seguros. **Só em app_145_preview.html** — o app em uso ainda não tem. | Abrir Animais, Estoque, Manejos, Treinos, Nascimentos, Veterinária, Auditoria e Usuários e ver se nomes com & " ' < > aparecem certos (sem "&amp;" visível); abrir fotos de animais e links de exames/documentos |
| 3 (publicada só no teste) | — | Aviso quando um cadastro grande passa de 80% / 95% do limite de 1 MB do banco (animais com fotos, exames, financeiro etc.); aviso ao escolher foto; Diagnóstico mostra o espaço de cada lista; backup exporta e importa também exames, consultoria, piquetes e registros de peso/foto | Escolher uma foto de animal; Segurança dos dados → Exportar backup e Importar; Diagnóstico → Verificar agora |
| 4 (publicada só no teste) | — | Título do modal de Treino não mudava (id repetido); atalho Alt+R na Veterinária apontava para aba que não existe. (Os botões de excluir dose de tratamento já pediam confirmação — nada a mudar.) | Abrir Novo Treino e Nova Aplicação (títulos certos); Alt+R na Veterinária não dá erro |
| 2b (só teste) | — | Correção de defeito da parte 2 achado no teste: o gráfico de categorias do plantel (Início) mostrava código na tela; também protegidos os rótulos da agenda/Início e listas de manejo. | Início: plantel e agenda normais; Agenda com tarefas de transporte e manejo |
| 2, 2b, 3, 4 → app em uso | #38 | Partes 2 (textos protegidos), 2b (correção do plantel), 3 (aviso de espaço também para Treinos e Manejos, backup completo) e 4 passam para o app em uso (app_145.html), após teste do Gustavo na versão de teste. | Conferir Início, Animais, Estoque, Treinos e o backup no app em uso |

Para voltar só esta promoção: pedir "volta um passo" (reverte o PR #38). Para voltar tudo ao início da auditoria: commit 9deedb9.
