# Fotos dos animais no Firebase Storage

Hoje a foto vira texto (base64) dentro do cadastro, e o documento `horses_list` tem limite de 1 MiB. Aqui a foto vai para o Storage e, no cadastro, fica só o endereço (URL).

**Nada aqui foi publicado nem ligado no app.** Este é só material pronto e testado em emulador.

## O que tem na pasta

| Arquivo | Para quê |
|---|---|
| `storage.rules` | Regras de segurança do Storage |
| `fotos.js` | Código para colar no app (reduzir, miniatura, enviar, apagar, migrar) |
| `firebase.json` | Config só para rodar o emulador de teste |
| `test/test_storage_rules.mjs` | 43 testes das regras (emulador) |
| `test/test_fotos.js` | 40 testes da lógica do `fotos.js` (Node puro) |
| `test/rodar_testes.sh`, `test/kill.sh` | Rodam os testes e param o emulador |

## O que as regras fazem

- `tenants/{cliente}/fotos/{animal}/{arquivo}`: só quem tem a claim `tenantId` igual ao cliente lê, grava e apaga.
- `haras-original/fotos/{animal}/{arquivo}`: só quem NÃO tem claim `tenantId`.
- Gravar só se for `image/jpeg`, `image/png` ou `image/webp` e com até 400 KB. Vídeo, PDF, gif, svg: bloqueados.
- Anônimo nunca. Qualquer outro caminho: bloqueado.
- Atenção: o endereço de download que o Firebase gera tem um "token" embutido. Quem tiver o link completo consegue ver aquela foto mesmo sem login (as regras valem para leitura/gravação via SDK, não para esse link). É o jeito normal do Firebase; não divulgue os links.

## Como integrar no app (quando for a hora)

1. Incluir o script `firebase-storage-compat.js` (versão 10.14.1, igual aos outros) e fazer `const storage = firebase.storage();`.
2. Colar o conteúdo de `fotos.js` no app (ele cria `Fotos`).
3. No lugar do `canvas.toDataURL` do botão "Escolher foto":
   ```js
   const r = await Fotos.enviarFoto(storage, TENANT_ID, h.id, file);
   // guardar no cadastro: h.fotoUrl = r.url; h.fotoMiniUrl = r.urlMiniatura;
   //                       h.fotoPath = r.path; h.fotoMiniPath = r.pathMiniatura;
   ```
   (`TENANT_ID` é `null` no haras original.) Para animais novos, o `id` precisa existir antes do envio.
4. Nas listas e na linha do animal, mostrar `h.fotoMiniUrl || h.fotoUrl`; na ficha, `h.fotoUrl`.
5. Ao trocar ou excluir a foto/animal: `await Fotos.removerFoto(storage, h)`.
6. Fotos antigas em base64 continuam funcionando (`Fotos.ehFotoValida` aceita `data:image`). Para migrar, animal por animal: `if (await Fotos.migrarBase64ParaStorage(storage, TENANT_ID, h)) salvarAnimais();`. O base64 só é trocado depois que o upload dá certo. Faça por lotes pequenos e salve ao final.
7. O app hoje só aceita `data:image` em `atualizarFotoPreview` e usa `urlSegura`; esses trechos precisam aceitar também o `https://` do Storage.

## Custo aproximado (confira o preço atual no site do Google Cloud)

- Armazenamento: da ordem de US$ 0,02 a 0,03 por GB por mês, ou seja, uns 10 a 20 centavos de real. Uma foto reduzida (~100 KB) mais miniatura (~20 KB) dá cerca de 8 mil fotos por GB. O limite combinado de ~1 GB por cliente custa centavos por mês.
- Visualização (saída de dados): cerca de US$ 0,12 por GB, com uma cota gratuita mensal. É aqui que o custo pode crescer.
- Valores em dólar, cotação e cota gratuita mudam; trate como estimativa.

## Por que cache e miniatura baixam o custo

- Cache (`public,max-age=31536000`): o navegador guarda a foto por um ano e não baixa de novo a cada abertura. O nome do arquivo muda a cada foto nova, então nunca aparece foto velha.
- Miniatura de 240 px (~15 a 25 KB): a lista de 50 animais baixa ~1 MB em vez de ~5 MB com as fotos grandes. A foto grande só é baixada ao abrir a ficha.

## O que o Gustavo precisaria fazer para ativar (não foi feito)

1. Trocar o projeto Firebase para o plano **Blaze** (pago por uso; o Storage exige). Vale colocar um alerta de orçamento (ex.: R$ 20/mês).
2. No console do Firebase, abrir Storage e criar o bucket (o padrão do projeto é `equinos-manager.firebasestorage.app`), escolhendo a região.
3. Aba Regras do Storage: colar o conteúdo de `storage.rules` e publicar.
4. Depois disso, integrar o `fotos.js` no app e testar com um animal.
5. Os claims `tenantId` já usados nas regras do Firestore valem aqui também. Sem o `tenantId` o usuário é tratado como haras original.

Observação: o limite de ~1 GB por cliente não é imposto pelas regras (Storage não soma espaço nas regras). Só limita o tamanho de cada foto (400 KB). O controle do total precisaria de contagem no app ou função de servidor.

## Como testar de novo

Precisa de Java e Node. Numa pasta temporária (fora do repositório):

```
mkdir /tmp/st && cd /tmp/st && npm init -y && npm i firebase-tools @firebase/rules-unit-testing firebase
bash <repositorio>/firebase/storage/test/rodar_testes.sh     # sobe o emulador (~45 s), testa e para
node <repositorio>/firebase/storage/test/test_fotos.js
```

Roda só no emulador, projeto `demo-haras`; não toca no Firebase real.

## O que ficou SEM teste

- As partes que usam navegador: `reduzirImagem`, `gerarMiniatura`, `enviarFoto` (canvas, Image, Blob reais). Os testes só cobrem a conta de dimensões, caminhos, nomes, base64 e a migração/remoção com um Storage de mentira.
- Envio de verdade pelo SDK do navegador contra o emulador (o teste de regras usa o SDK web, mas sem o `fotos.js`).
- Tamanho real em KB da foto e da miniatura (as faixas ~60-150 KB e ~15-25 KB são estimativas).
- Orientação EXIF (foto de celular de lado) e uso no iPhone/Safari.
- Preços: valores aproximados, não consultados.
