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

| Etapa 1 multi-cliente (só branch, NÃO publicada) | — | O app passa a ler/gravar na coleção do cliente (`tenants/{id}/dados`) quando o login tem a claim `tenantId`; sem claim continua em `harasData` (haras original, nada muda). Ver PLANO_MULTI_CLIENTE.md. | Nada deve mudar para o haras original: abrir, salvar, trocar de tela |

| Etapa 2 multi-cliente (regras do Firestore) — **PUBLICADA no Firebase pelo Gustavo em 05/10/2026** | — | `firebase/firestore.rules` + testes (19/19 no emulador) + passo a passo. Haras original sem mudança; clientes isolados. Testado no app em uso: salvar, recarregar, editar, excluir animal, abrir Estoque — tudo normal. Regras anteriores guardadas nas anotações do Gustavo (versão de 24/08/2026 no histórico do console). | Depois de publicar: recarregar o app, salvar uma observação, conferir que salvou |

| Etapa 2b multi-cliente (papéis) — **APLICADA e PUBLICADA pelo Gustavo em 05/10/2026** | — | `firebase/firestore.rules.2b` (só admin grava `usuarios_list`) + `firebase/definir_papeis.js` (define claims) + testes 14/14 e teste do script nos emuladores. Ordem obrigatória no `COMO_PUBLICAR_AS_REGRAS.md`. | Depois de publicar: sair e entrar; como admin, editar um usuário e salvar |

Etapa 2b em 05/10/2026: `definir_papeis.js` rodado no Cloud Shell (simulação e depois --aplicar) para 5 usuários (admin: gustavojftoledo@gmail.com e pedro@equinosmanager.com; funcionario: christiano@, nelson@, catraca@); regras `firestore.rules.2b` publicadas; teste no app em uso: salvar usuário como administrador = normal, sem erro. Para voltar: colar `firebase/firestore.rules` (2a) no console. Pendente: cada usuário sair e entrar uma vez (principalmente o Pedro, para poder editar usuários).

| Etapa 1 multi-cliente → app em uso | #39 | A etapa 1 (dados por cliente via claim `tenantId`; sem claim = haras original, inalterado) sobe para app_145.html e app_145_preview.html, junto com a pasta `firebase/` e o PLANO_MULTI_CLIENTE.md. Autorizado pelo Gustavo em 05/10/2026. | Abrir o app, salvar, trocar de tela: nada deve mudar |
