// Servidor MCP de exemplo, somente leitura, para o Haras — Gestão Equina.
// Lê o backup JSON exportado pelo app_145.html e expõe duas ferramentas via
// stdio: listar_animais e listar_vacinas_pendentes. Ver README.md para
// instalação e configuração no Claude Desktop.

import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { registerListarAnimais } from "./tools/listarAnimais.js";
import { registerListarVacinasPendentes } from "./tools/listarVacinasPendentes.js";

const server = new McpServer({
  name: "haras-gestao-equina",
  version: "0.1.0",
});

registerListarAnimais(server);
registerListarVacinasPendentes(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // console.error é seguro em servidores stdio (vai pro stderr); console.log
  // NÃO é seguro aqui — corromperia o stream JSON-RPC no stdout.
  console.error("Haras MCP Server rodando via stdio.");
}

main().catch((error) => {
  console.error("Erro fatal ao iniciar o servidor MCP do Haras:", error);
  process.exit(1);
});
