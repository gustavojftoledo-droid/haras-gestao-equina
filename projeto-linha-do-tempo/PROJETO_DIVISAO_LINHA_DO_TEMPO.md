# Projeto: dividir a Linha do Tempo (registros de peso/score/foto) por animal

Status: **protótipo + testes prontos, nada publicado.** `app_145.html` e `app_145_preview.html` não foram tocados.
O protótipo está em `protótipo_app_preview.html` (cópia do preview atual, com Storage de fotos) e os testes em `testes/` e `firebase/`.

## 1. O problema, em palavras simples

Hoje todos os registros da Linha do Tempo de todos os cavalos moram **num único documento** (`animal_registros_list`).
Esse documento é baixado inteiro toda vez que o app abre, e o Firestore não aceita documento maior que 1 MiB.
Com ~1.700 fotos o documento enche e o app **para de gravar** qualquer registro novo (de qualquer cavalo).

## 2. Decisão de formato

**Um documento por animal, com chave plana: `areg_<animalId>`.** Cada documento guarda `{ value: [registros do animal] }`
(mesmo formato de hoje, os registros não mudam). Mais um documento-recibo `areg_indice`.

Por que chave plana (e não `animal_registros/<id>`)?
Confirmei em `firebase/firestore.rules` (e `firestore.rules.2b`): a regra é `match /harasData/{doc}` e
`match /tenants/{tid}/dados/{doc}`. `{doc}` aceita **qualquer nome sem barra**. Uma chave com barra vira subcoleção e cai em
"todo o resto bloqueado". Testei no emulador (`firebase/test_rules_areg.mjs`, 24 testes, nas duas versões de regras):
`areg_h_123` e `areg_indice` funcionam para o haras original e para clientes (`tenants/<id>/dados`), e uma chave com barra é negada.
**Não é preciso mudar nenhuma regra.**

Por que um documento por animal e não "por faixa de tempo"?
- Cada registro com foto no Storage pesa ~0,6 a 0,8 KB. Um animal cabe em ~1.400 a 1.700 registros por documento;
  um registro por semana são ~27 anos. É o "sem limite prático" que o dono pediu, com o código mais simples possível.
- O app já avisa quando um documento passa de 80% e 95% (`avisarEspacoDoc`); agora vale também para `areg_*`.
- Se algum dia um animal chegar perto do teto, o caminho de evolução é `areg_<id>_<ano>` (um documento por ano) com a lista de
  anos dentro do `areg_indice`. Não está no protótipo de propósito: seria código a mais para um problema que ninguém vai ter.

Como o animal vira chave: `areg_` + id com tudo que não for letra/número/`_`/`-` trocado por `_` (os ids atuais são `h_<data>_<rand>`, já seguros).
O app também confere `animalId` de cada registro ao ler, então uma colisão rara de nomes não mistura animais.

Modos do app (variável `aregModo`):
- `legado`: ainda no documento único (comportamento antigo; usado também durante a migração).
- `porAnimal`: formato novo.
- `indefinido`: a leitura do recibo/documento falhou na abertura. **Nada de registro é gravado** até recarregar (não arrisca apagar).

Na memória: `animalRegistros` continua existindo (assim todo código antigo que faz `animalRegistros.filter(...)` continua funcionando),
mas no formato novo ela é só o **cache** dos animais já abertos nesta sessão. Começa vazia.

## 3. Como funciona, por assunto

**Leitura sob demanda.** `loadAll` agora lê só o recibo `areg_indice` (um documento minúsculo). Ao abrir a Linha do Tempo Visual
de um animal (`abrirLinhaDoTempoVisual`), o app lê só `areg_<id>` e guarda em cache. Abrir de novo não lê de novo.

**Gravação.** Cada alteração grava só o documento do animal. Passa pelo mesmo `storeSet` de sempre, com um ramo novo
(`ehChaveAreg`) que faz a **fusão por id** igual às listas auditadas: relê o documento no banco, aplica só o que *esta aba* criou/editou/excluiu
e preserva o que outro aparelho gravou. A "foto" de base e o cache só avançam **depois** da gravação dar certo.
Se a releitura falhar, a gravação é **recusada** (mesma regra das outras listas), nunca sobrescreve às cegas.
A auditoria continua registrando inclusão/edição/exclusão (módulo "Animais").

**Conflito entre aparelhos.** Mesma regra do resto do app: mexeram em registros diferentes → os dois valem; mesmo registro → vale quem gravou por último. Por animal, o conflito só pode acontecer entre aparelhos mexendo no *mesmo cavalo*.

**Modo offline.** Igual ao resto do app (cache do Firestore): se a ficha já foi aberta, funciona do cache em memória; se não e o documento não está no cache do aparelho, a leitura falha depois de 3 tentativas → o app avisa "pode estar incompleto, nada foi apagado" e **recusa gravar** nesse animal até conseguir ler. Nunca grava uma lista parcial por cima.

**Backup.** O arquivo de backup continua **idêntico** (campo `animalRegistros`, lista única), portanto backups antigos e novos são compatíveis entre as versões.
Para exportar, o app lê o documento de todos os animais (um por vez, 6 em paralelo). **Se algum não puder ser lido, o backup NÃO é gerado** (um backup incompleto parece bom e não é).
Na importação, antes de mexer em qualquer lista, o app lê os documentos dos animais afetados; falhou → cancela sem alterar nada. Depois soma só os ids que faltam e grava cada animal.
Custo: um backup lê 1 documento por animal (ex.: 300 animais = 300 leituras, uma vez, ação manual).

## 4. Migração (passo a passo)

Automática, em segundo plano, logo depois do app abrir (`aregMigrar`, chamada no fim do `loadAll`). Só roda se `areg_indice` não existir.

1. Lê o recibo `areg_indice`. Se não conseguir ler: **não faz nada** (tenta na próxima abertura). Se já existe: nada a fazer.
2. Lê `animal_registros_list` (o documento antigo). Falhou: não faz nada.
3. Agrupa por `animalId`. Registro sem `id` ganha um id (`areg_mig_n`); registro sem `animalId` vai para `areg___sem_animal__`; registro de animal já excluído também é copiado (nada se perde).
4. Para cada animal: lê o documento novo (se já existir, soma por id; o que já está lá vale), confere que não passa de 95% de 1 MiB, grava e **lê de volta para conferir** que todos os ids chegaram.
5. Só depois de tudo conferido grava o recibo `areg_indice` `{versao:1, migradoEm, inicioMs, total, animais:{chave:quantidade}}` e lê de volta.
6. Passo de "ressincronização": pega do documento antigo os registros criados **depois** do início da migração (o id carrega a data) que ainda não estão no documento do animal. Cobre o app antigo gravando durante a janela.
7. Troca o modo para `porAnimal` e esvazia o cache.

Garantias: o **documento original nunca é alterado nem apagado** (testei byte a byte). Qualquer falha em qualquer passo = para, não grava o recibo, o app continua no modo antigo e tenta de novo na próxima abertura.
É idempotente: dois aparelhos migrando ao mesmo tempo chegam ao mesmo resultado (sempre soma por id).
Se um animal sozinho passaria de 95% do limite, a migração recusa e fica no modo antigo (testado).
Também há botão manual no Diagnóstico ("Dividir por animal agora") e um interruptor: `AREG_MIGRACAO_AUTOMATICA = false` (constante) ou `localStorage.haras_areg_migracao_off = '1'` em um aparelho.

Passo 3 (futuro, **não** implementado, só com confirmação do dono): depois de semanas sem problemas, liberar o espaço do documento antigo (gravar uma cópia `bkp_animal_registros_list_<data>` e esvaziar o original). Até lá o original fica como cópia de segurança.

## 5. Riscos

1. **Dois apps na mesma base (o mais importante).** O app em uso (`app_145.html`) não conhece `areg_*`: continua lendo/gravando só `animal_registros_list`.
   Se o preview migrar os dados reais enquanto o app em uso ainda existe, registros criados no app em uso depois da migração não aparecem no preview.
   Mitigação pronta: o botão "Conferir registros do app antigo" (`aregRessincronizar`) traz o que o app antigo criou depois da migração (sem ressuscitar o que foi excluído).
   Recomendação de implantação: (a) testar primeiro com `AREG_MIGRACAO_AUTOMATICA = false` ou numa cópia (tenant de teste); (b) ligar quando o app em uso for trocado pela versão nova.
2. **Janela de poucos segundos na migração**: uma gravação do app antigo que chegue *depois* do passo 6 só é recuperada pelo botão de ressincronizar. Por isso o botão existe.
3. **Documento de um animal gigante** (>95% do limite já na migração): migração recusa e continua no modo antigo; resolver à mão (ver "evolução por ano").
4. **Backup e "Mover fotos antigas" ficam mais lentos** (1 leitura por animal) e falham de forma segura se a rede cair.
5. **Registros de animal excluído** ficam órfãos no documento dele (não aparecem em lugar nenhum, não pesam na abertura). Iguais ao comportamento de hoje. Backup só inclui animais que existem + os do recibo.
6. **Não testado em Firestore/celular reais**: os testes usam o armazenamento local do navegador e um Firestore de mentira em memória. Falta um teste manual no preview com dados reais (copiados) antes de ligar.
7. O `storeSet` foi dividido em `storeSet` (confirma o cache) + `storeSetCore` (o corpo antigo). Quem chama `storeSet` não percebe diferença; os testes de regressão passaram idênticos.
8. A tela de "Linha do Tempo" **não tem** botão de editar registro (hoje só incluir e excluir); o código de edição (`editingAnimalRegistroId`) foi mantido e testado, mas ninguém o aciona na tela atual.

## 6. Plano de reversão

Três níveis, do mais simples ao mais forte:
- **Nada migrou / migração falhou:** nada a fazer; o documento antigo está intacto e o app segue no modo antigo.
- **Desligar a migração automática:** `AREG_MIGRACAO_AUTOMATICA = false` (ou `localStorage.haras_areg_migracao_off='1'`).
- **Voltar depois de migrado:** Diagnóstico → "Voltar para o documento único" (`aregReverter`). Lê todos os documentos por animal (se algum falhar, aborta),
  monta a lista final (verdade atual + registros que o app antigo criou depois), confere o tamanho (<95% de 1 MiB, senão recusa), grava `animal_registros_list`, **lê de volta e confere**,
  e só então troca o recibo por `{versao:0, revertidoEm}` (marcador que impede migrar sozinho de novo). Os documentos `areg_*` ficam como cópia (podem ser apagados no console do Firestore depois).
  Para migrar de novo: botão "Dividir por animal agora".
- **Emergência (app novo com defeito):** voltar a usar `app_145.html`: o documento antigo continua lá (exceto registros criados só no formato novo, que estão nos `areg_*` e no backup).

## 7. Pontos do código a mudar (números de linha)

`Base` = `app_145_preview.html` atual da pasta principal (cópia em que o protótipo foi feito); `Proto` = `protótipo_app_preview.html`.

| O quê | Base | Proto |
|---|---|---|
| Declaração `animalRegistros` (agora é cache) | 3823 | 3830 |
| `AUDIT_KEYS.animal_registros_list` (continua, usado só no modo antigo) | 4046 | 4056 |
| `atualizarGlobalPosFusao` caso `animal_registros_list` | 4161 | 4171 |
| `avisarEspacoDoc`: aviso de espaço também para `areg_*` | 4295 | 4306 |
| `storeSet` → `storeSet` + `storeSetCore` (confirmação do cache) | 4303 | 4317 / 4322 |
| `fundivel` (chave que pode ser regravada após falha de leitura) | 4311 | 4330 |
| Ramo novo `ehChaveAreg(key)` dentro do `storeSetCore` | — | 4367 |
| **Bloco novo "LINHA DO TEMPO POR ANIMAL"** (modo, cache, leitura sob demanda, gravação, migração, ressincronização, reversão) | — | 4438-4665 |
| `loadAll`: lê `areg_indice` em vez de `animal_registros_list`; decide o modo | 4466 / 4471 | 4732 |
| `loadAll`: foto de auditoria (`animal_registros_list: animalRegistros`) — fica, vazia no modo novo | 4502 | 4763 |
| `loadAll`: dispara a migração em segundo plano no fim | 4831 | 5093 |
| Edição em lote de peso | 6433-6434 | 6696 |
| Cadastro do animal: auto-registro de peso/score/foto | 6805-6809 | 7067 |
| Cadastro do animal: foto adicional nova vira ponto | 6816-6819 | 7077 |
| **Único leitor** de registros: `computeLinhaDoTempoVisualDados` (`animalRegistros.filter(r=>r.animalId===h.id)`), chamado por `ltvCalcularRange` (preset "Tudo") e `renderLinhaDoTempoVisual` | 22889 | 23149 |
| `abrirLinhaDoTempoVisual` vira `async` e carrega o animal antes de desenhar | 22906 | 23166 |
| Salvar registro (`btnArSalvar`) | 23062-23063 | 23326 |
| Excluir registro (`btnArExcluir`) | 23068-23069 | 23333-23334 |
| "Mover fotos antigas para o Storage": carrega todos antes e grava por animal | 23639 / 23670 | 23904 / 23936 |
| Diagnóstico: HTML dos 3 botões novos / status + handlers | — | 3611 / 23940 |
| Backup: exportar (carrega todos; recusa se incompleto) | 23808 | 24106 |
| Backup: importar (carrega afetados antes; grava por animal) | 23891 / 23923 | 24158 / 24226 |

**Lista completa de quem usa `animalRegistros` / `animal_registros_list`** (busquei no repositório inteiro): somente `app_145.html`, `app_145_preview.html` e este protótipo
(mais um parágrafo em `FUNCIONALIDADES_SISTEMA_ATUAL.md`). **Relatórios não usam registros**: o único leitor é a Linha do Tempo Visual
(`renderAnimalTimeline` e a ficha do animal não leem `animalRegistros`; usam manejos/treinos/visitas). `functions/`, `mcp-server/` e `equinos-bot/` não mencionam a chave.
Atenção ao portar para o `app_145_preview.html` oficial: o arquivo da pasta principal tem 263 linhas de diferença do commit `493ee0c` (fotos no Storage); o protótipo foi feito em cima dessa versão mais nova.

## 8. Como testar

Pré-requisitos: Node com Playwright global (`/opt/node22/lib/node_modules/playwright`) e Chromium em `/opt/pw-browsers/chromium`. Nenhuma rede é usada.

```
node testes/pw_linha_do_tempo_por_animal.js          # 60 verificações (12 cenários), usa protótipo_app_preview.html
node testes/pw_linha_do_tempo_por_animal.js outro.html   # contra outro arquivo
# regras do Firestore (emulador na porta 8085, mesmo esquema de test_rules.mjs):
java -jar ~/.cache/firebase/emulators/cloud-firestore-emulator-v1.22.0.jar --host=127.0.0.1 --port=8085 &
cd <pasta com @firebase/rules-unit-testing> && RULES_DIR=<repo>/firebase node test_rules_areg.mjs
```

Cenários cobertos: migração, leitura sob demanda (conta leituras), adicionar/editar/excluir (inclusive excluir o último), auto-registro ao trocar foto,
fusão entre aparelhos, backup exportar/importar (e backup incompleto bloqueado), falha de leitura (migração, ficha, salvar, recibo ilegível), reversão e re-migração,
ressincronização do app antigo, documento único estourado (>1 MiB) virando documentos pequenos, animal gigante recusando, mover fotos antigas, edição em lote.
Teste manual recomendado antes de ligar: abrir o preview numa **cópia** dos dados, ver o botão novo no Diagnóstico, abrir a Linha do Tempo de 3 animais, conferir no console do Firestore que existem `areg_*` e `areg_indice` e que `animal_registros_list` continua igual.
