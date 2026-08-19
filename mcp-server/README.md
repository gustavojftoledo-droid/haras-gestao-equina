# Haras MCP Server (exemplo)

Servidor **MCP (Model Context Protocol)** de exemplo, **somente leitura**, para o app
[Haras — Gestão Equina](../app_145.html). Ele lê o backup JSON que o próprio app exporta
(botão **⚙ → Exportar Backup**) e expõe duas ferramentas que o Claude Desktop pode chamar
em uma conversa:

- **`listar_animais`** — lista os animais cadastrados (por padrão só os ativos).
- **`listar_vacinas_pendentes`** — lista vacinas atrasadas/próximas, juntando a vacinação
  regular por animal e o protocolo de vacinas de gestação/potro.

Isso é uma prova de conceito. **Não escreve nada** — não registra vacinas, não edita
animais, não mexe em financeiro. O `app_145.html` não é alterado por este servidor.

## 1. Pré-requisitos: instalar o Node.js

Este servidor precisa do **Node.js 20 ou mais recente**. Baixe em
[nodejs.org](https://nodejs.org/) (versão LTS) e instale normalmente no Windows.

Depois de instalar, confirme num terminal novo:

```bash
node --version
npm --version
```

## 2. Instalar e buildar

Na pasta `mcp-server`:

```bash
npm install
npm run build
```

Isso cria `mcp-server/build/index.js`, que é o arquivo que o Claude Desktop vai executar.

## 3. Apontar para o backup

O servidor procura o arquivo de backup nesta ordem:

1. Argumento `--backup <caminho>` na linha de comando.
2. Variável de ambiente `HARAS_BACKUP_PATH`.
3. Automático: procura por `haras_backup_*.json` na raiz do projeto (`Equinos manager code/`)
   e usa o mais recente (pelo timestamp no nome do arquivo).

Já existe um backup de exemplo no projeto (`haras_backup_2026-08-18-01-16-27.json`), então a
opção 3 já funciona sem configurar nada — mas ele está **desatualizado** (sem vacinas
registradas, sem `config.freqVacinas`, sem protocolo de gestação/potro). Para ver dados reais
de vacina, exporte um backup novo pelo app e:

- ou deixe o arquivo novo na raiz do projeto (a busca automática pega o mais recente), ou
- configure `HARAS_BACKUP_PATH` apontando para ele (veja o exemplo de configuração abaixo).

> ⚠️ Backups têm dados reais da fazenda. Evite colocar caminhos com dados sensíveis em
> arquivos versionados no git — prefira configurar `HARAS_BACKUP_PATH` fora de arquivos
> commitados.

## 4. Testar antes de plugar no Claude Desktop

Use o **MCP Inspector**, que abre uma interface web local pra listar e chamar as ferramentas
manualmente e ver a resposta crua:

```bash
npm run inspect
```

Confirme que aparecem as duas ferramentas (`listar_animais`, `listar_vacinas_pendentes`) e
que chamá-las não trava, mesmo com o backup de exemplo desatualizado (esperado: `listar_vacinas_pendentes`
retorna uma lista vazia/quase vazia, já que faltam vacinas e protocolos nesse backup específico).

Teste também o caso de erro: rode com um caminho de backup que não existe
(`HARAS_BACKUP_PATH=caminho\que\nao\existe.json npm run inspect` ou equivalente no PowerShell)
e confirme que a ferramenta responde com uma mensagem amigável em vez de travar o processo.

## 5. Configurar no Claude Desktop

Abra (ou crie) `%APPDATA%\Claude\claude_desktop_config.json` e adicione a entrada `haras`
dentro de `mcpServers`, ajustando os caminhos absolutos para os seus:

```json
{
  "mcpServers": {
    "haras": {
      "command": "node",
      "args": [
        "C:\\Users\\gusta\\Documents\\Equinos manager code\\mcp-server\\build\\index.js"
      ],
      "env": {
        "HARAS_BACKUP_PATH": "C:\\Users\\gusta\\Documents\\Equinos manager code\\haras_backup_2026-08-18-01-16-27.json"
      }
    }
  }
}
```

Troque o valor de `HARAS_BACKUP_PATH` pelo caminho do backup mais atual sempre que quiser
consultar dados novos (ou remova essa linha para usar a busca automática pelo mais recente
na raiz do projeto).

Salve o arquivo e **reinicie o Claude Desktop**. Numa conversa nova, pergunte algo como:

- "Quais animais estão cadastrados no Haras?"
- "Tem alguma vacina atrasada?"

O Claude deve pedir permissão para chamar a ferramenta na primeira vez (comportamento normal
do MCP) e responder com base nos dados reais do backup.

## Limitações conhecidas (fora do escopo deste v1)

- **Só leitura.** Nenhuma ferramenta de escrita (registrar vacina, cadastrar animal, lançar
  financeiro).
- **`listar_animais`** não retorna genealogia, observações, foto nem o campo `valor`
  (formato de moeda livre e inconsistente no backup — precisaria replicar o parser
  `parseValorLivre()` do app, `app_145.html:7406-7412`).
- **`listar_vacinas_pendentes`** replica fielmente o comportamento do app: uma vacina que o
  animal *nunca* recebeu não aparece como pendente (só aparece depois da primeira aplicação
  registrada). Isso é assim no app original também — não é um bug deste servidor.
- Não há ferramenta de financeiro/lançamentos.

Próximos passos possíveis: ferramentas de escrita, ferramenta de financeiro (replicando a
lógica de `todosLancamentosFinanceiro()` do app), suporte a múltiplos backups/histórico.
