# O que conferir na versão de teste (PRs 45 a 48)

Endereço do teste: https://gustavojftoledo-droid.github.io/haras-gestao-equina/app_145_preview.html
(recarregar com Ctrl + Shift + R / fechar e abrir o app no celular). Antes de mexer: fazer backup no computador.

1. **Diagnóstico só para o dono** (PR 45): você vê o botão no menu. Quem não é dono não vê. Para mostrar a alguém: endereço com `?diag=1` no final.
2. **Cronômetro** (PR 45): Diagnóstico → Verificar agora mostra o bloco "TEMPO DA ÚLTIMA ABERTURA". Fora do Diagnóstico nada aparece.
3. **Mover fotos antigas** (PRs 45, 46, 47): Diagnóstico → "Mover fotos antigas para o Storage". A pergunta deve aparecer NA FRENTE (PR 46). Move fotos de animal, da linha do tempo e da consultoria.
4. **Fotos do cadastro** (PRs 45 e 47): em um animal, adicionar fotos adicionais. Limite de 4 no total (principal + 3). A 5ª é bloqueada com aviso. ✕ tira a foto da ficha (continua na linha do tempo).
5. **Linha do tempo** (PR 47): cada foto adicional nova vira um ponto com a data de hoje. Linha do tempo visual: "+ Peso/Score/Foto" com foto vai para o Storage.
6. **Consultoria** (PR 47): anexar foto numa avaliação; ela entra na linha do tempo na data da visita; apagar a foto na avaliação apaga o arquivo.
7. **Excluir/editar foto da linha do tempo** (PR 48): tocar numa foto → "Editar data / anotação" e "Excluir esta foto". A foto principal do cadastro continua na ficha mesmo se o ponto da linha do tempo for excluído.
8. **Se uma foto não enviar**: deve aparecer aviso e a foto ser guardada do jeito antigo (nada se perde).
