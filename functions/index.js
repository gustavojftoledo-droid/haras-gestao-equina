/* Cloud Functions do Haras — firebase-functions v2, Node 20. */
const { setGlobalOptions } = require('firebase-functions/v2');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onCall } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const logger = require('firebase-functions/logger');
const { sincronizarLista } = require('./papeis');
const C = require('./clientes');
const U = require('./usuarios');

// Região: precisa ser a mesma do Firestore (o banco do Gustavo está em São Paulo, southamerica-east1). Para outra região, crie functions/.env com REGIAO_FUNCOES=...
setGlobalOptions({ region: process.env.REGIAO_FUNCOES || 'southamerica-east1', maxInstances: 10 });
initializeApp();
const auth = () => getAuth();
const db = () => getFirestore();

const valorDaLista = (snap) => (snap && snap.exists && snap.data() && Array.isArray(snap.data().value)) ? snap.data().value : [];

async function tratar(event, tenantId){
  const antes = valorDaLista(event.data && event.data.before);
  const depois = valorDaLista(event.data && event.data.after);
  // cliente: aplica o plano dele (módulos, fotos, usuários); haras original: sem plano
  const dados = tenantId ? await C.dadosDoCliente(db(), tenantId) : {};
  const resumo = await sincronizarLista(auth(), { tenantId, antes, depois, plano: dados.plano, recursos: dados.recursos });
  logger.info('sincronizarPapeis', { tenantId: tenantId || 'haras-original', ...resumo });
  return null;
}

// 1) Quando a lista de usuários do haras original muda
exports.sincronizarPapeis = onDocumentWritten('harasData/usuarios_list', (event) => tratar(event, null));
// 1b) Quando a lista de usuários de um cliente muda
exports.sincronizarPapeisCliente = onDocumentWritten('tenants/{tid}/dados/usuarios_list', (event) => tratar(event, event.params.tid));

// 2) Criar cliente (só dono)
exports.criarCliente = onCall(async (request) => {
  C.exigirDono(request);
  return C.criarCliente({ auth: auth(), db: db(), FieldValue }, request.data || {});
});
// 3) Bloquear / reativar cliente (só dono)
exports.bloquearCliente = onCall(async (request) => {
  C.exigirDono(request);
  return C.bloquearCliente({ auth: auth(), db: db() }, request.data || {});
});
// 4) Uso de armazenamento do cliente (só dono)
exports.usoDoCliente = onCall(async (request) => {
  C.exigirDono(request);
  return C.usoDoCliente({ db: db() }, request.data || {});
});
// 5) Painel de clientes: listar (só dono)
exports.listarClientes = onCall(async (request) => {
  C.exigirDono(request);
  return C.listarClientes({ auth: auth(), db: db() });
});
// 6) Painel de clientes: editar nome/plano/limite/consentimento (só dono; nunca mexe em "ativo")
exports.atualizarCliente = onCall(async (request) => {
  C.exigirDono(request);
  return C.atualizarCliente({ auth: auth(), db: db(), emailDono: request.auth.token.email }, request.data || {});
});

// 7) O administrador do cliente cria/redefine o login de alguém da própria equipe (precisa estar na lista de usuários)
exports.criarLoginDoUsuario = onCall(async (request) => {
  U.exigirAdmin(request);
  return U.criarLoginDoUsuario({ auth: auth(), db: db(), claims: request.auth.token }, request.data || {});
});
