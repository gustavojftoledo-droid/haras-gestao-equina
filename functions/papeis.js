/* Lógica da sincronização de papéis (separada do trigger para poder ser testada direto). */
const { MODULOS, papelEModulos, normalizarEmail, mesmaLista } = require('./comum');

/* Transforma a lista em { email -> {papel, modulos} }. E-mails vazios e repetidos são ignorados (vale o primeiro). */
function mapaDaLista(lista){
  const mapa = new Map();
  if (!Array.isArray(lista)) return mapa;
  for (const u of lista) {
    const email = normalizarEmail(u && u.email);
    if (!email || mapa.has(email)) continue;
    mapa.set(email, papelEModulos(u));
  }
  return mapa;
}

async function acharConta(auth, email){
  try { return await auth.getUserByEmail(email); }
  catch (e) { if (e && e.code === 'auth/user-not-found') return null; throw e; }
}

/* Essa conta pode ser alterada por esta lista? Protege contra um admin de cliente "puxar" a conta de outro lugar.
   - dono nunca é alterado por listas;
   - lista de cliente (tenantId): só mexe em conta sem tenantId e sem papel (conta nova) ou da própria tenantId;
   - lista do haras original (tenantId null): só mexe em conta que NÃO tem tenantId. */
function podeMexer(claims, tenantId){
  if (claims.dono === true) return false;
  if (tenantId) {
    if (claims.tenantId) return claims.tenantId === tenantId;
    return !claims.papel; // já tem papel sem tenantId = é do haras original
  }
  return !claims.tenantId;
}

/* Aplica as claims. Retorna um resumo (útil para log e testes). */
async function sincronizarLista(auth, { tenantId, antes, depois }){
  const resumo = { atualizados: [], iguais: [], semConta: [], removidos: [], ignorados: [], revogados: [] };
  const novoMapa = mapaDaLista(depois);
  const velhoMapa = mapaDaLista(antes);

  for (const [email, { papel, modulos }] of novoMapa) {
    const conta = await acharConta(auth, email);
    if (!conta) { resumo.semConta.push(email); continue; }
    const atuais = conta.customClaims || {};
    if (!podeMexer(atuais, tenantId)) { resumo.ignorados.push(email); continue; }
    const novas = { ...atuais, papel, modulos };
    if (tenantId) novas.tenantId = tenantId;
    if (mesmaLista(atuais.modulos, modulos) && atuais.papel === papel && (!tenantId || atuais.tenantId === tenantId)) {
      resumo.iguais.push(email); continue;
    }
    await auth.setCustomUserClaims(conta.uid, novas);
    resumo.atualizados.push(email);
    // rebaixamento: perdeu admin ou perdeu algum módulo que tinha -> derruba as sessões abertas
    const modulosAntes = Array.isArray(atuais.modulos) ? atuais.modulos : [];
    const perdeuModulo = modulosAntes.some(m => !modulos.includes(m));
    if ((atuais.papel === 'admin' && papel !== 'admin') || perdeuModulo) {
      await auth.revokeRefreshTokens(conta.uid);
      resumo.revogados.push(email);
    }
  }

  // quem estava na lista antes e saiu agora perde papel e modulos
  for (const email of velhoMapa.keys()) {
    if (novoMapa.has(email)) continue;
    const conta = await acharConta(auth, email);
    if (!conta) continue;
    const atuais = conta.customClaims || {};
    if (!podeMexer(atuais, tenantId)) continue; // inclui o dono e contas de outro lugar
    if (!('papel' in atuais) && !('modulos' in atuais)) continue; // já estava limpo (idempotente)
    const novas = { ...atuais };
    delete novas.papel; delete novas.modulos;
    await auth.setCustomUserClaims(conta.uid, novas);
    await auth.revokeRefreshTokens(conta.uid);
    resumo.removidos.push(email); resumo.revogados.push(email);
  }
  return resumo;
}

module.exports = { sincronizarLista, mapaDaLista, podeMexer, MODULOS };
