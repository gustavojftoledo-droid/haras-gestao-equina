/* Criar/redefinir o LOGIN (e-mail + senha) de um usuário da equipe, feito pelo administrador do próprio cliente.
   Antes, o login precisava ser criado à mão no console do Firebase. Regras de segurança:
   - só quem tem a claim papel='admin' chama; o cliente (tenantId) vem da CLAIM do chamador, nunca do pedido;
   - o e-mail precisa já estar na lista de usuários do cliente (cadastrada na tela Usuários) e caber no limite do plano;
   - nunca mexe em conta do dono, de outro cliente ou do haras original (a menos que o chamador seja do haras original);
   - a senha provisória é mostrada UMA vez (só quando gerada aqui). */
const { HttpsError } = require('firebase-functions/v2/https');
const crypto = require('crypto');
const { normalizarEmail, limitesDoPlano } = require('./comum');
const { mapaDaLista, ressincronizarCliente } = require('./papeis');
const { dadosDoCliente } = require('./clientes');

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const senhaAleatoria = () => crypto.randomBytes(9).toString('base64url'); // 12 caracteres

function exigirAdmin(request){
  if (!request.auth) throw new HttpsError('unauthenticated', 'Entre na sua conta para continuar.');
  if (request.auth.token.papel !== 'admin') throw new HttpsError('permission-denied', 'Só o administrador pode criar logins.');
}

async function criarLoginDoUsuario({ auth, db, claims }, data){
  const tenantId = claims && claims.tenantId ? claims.tenantId : null; // do login do chamador, não do pedido
  const email = normalizarEmail(data.email);
  if (!RE_EMAIL.test(email) || email.length > 200) throw new HttpsError('invalid-argument', 'E-mail inválido.');
  const senha = data.senhaProvisoria;
  if (senha !== undefined && senha !== null && (typeof senha !== 'string' || senha.length < 8 || senha.length > 100))
    throw new HttpsError('invalid-argument', 'A senha provisória precisa ter de 8 a 100 caracteres.');
  const redefinir = data.redefinir === true;

  // o usuário precisa estar cadastrado na lista do cliente
  const caminho = tenantId ? `tenants/${tenantId}/dados/usuarios_list` : 'harasData/usuarios_list';
  const snapLista = await db.doc(caminho).get();
  const lista = snapLista.exists && snapLista.data() && Array.isArray(snapLista.data().value) ? snapLista.data().value : [];
  if (!lista.some(u => normalizarEmail(u && u.email) === email))
    throw new HttpsError('failed-precondition', 'Cadastre a pessoa em Usuários e salve antes de criar o login.');

  // plano: e-mail precisa caber nos lugares do plano (admins primeiro)
  let plano, recursos;
  if (tenantId) {
    const d = await dadosDoCliente(db, tenantId);
    plano = d.plano; recursos = d.recursos;
    if (!mapaDaLista(lista, limitesDoPlano(plano)).has(email))
      throw new HttpsError('failed-precondition', 'Limite de usuários do plano atingido: essa pessoa ficaria sem lugar. Fale com o suporte para mudar de plano.');
  }

  let conta = null;
  try { conta = await auth.getUserByEmail(email); }
  catch (e) { if (!(e && e.code === 'auth/user-not-found')) throw e; }

  let criado = false, redefinida = false, senhaGerada;
  if (!conta) {
    const pw = senha || (senhaGerada = senhaAleatoria());
    // Segurança: conta SEM claim de cliente vale como "haras original" nas regras. Por isso a conta nasce DESLIGADA e só é
    // ligada depois de conferir que recebeu o tenantId; se algo falhar, ela é apagada.
    conta = await auth.createUser({ email, password: pw, disabled: true });
    criado = true;
  } else {
    const c = conta.customClaims || {};
    const doutroLugar = c.dono === true || (tenantId ? (c.tenantId && c.tenantId !== tenantId) || (!c.tenantId && c.papel) : !!c.tenantId);
    if (doutroLugar) throw new HttpsError('already-exists', 'Esse e-mail já pertence a outro haras ou cliente.');
    if (redefinir) {
      const pw = senha || (senhaGerada = senhaAleatoria());
      await auth.updateUser(conta.uid, { password: pw });
      await auth.revokeRefreshTokens(conta.uid);
      redefinida = true;
    }
  }
  // aplica papel/módulos/plano na conta (a conta nova ainda não tem claims; o gatilho de usuários já tinha passado)
  try {
    await ressincronizarCliente(auth, { tenantId, lista, plano, recursos });
    if (criado) {
      const c = (await auth.getUser(conta.uid)).customClaims || {};
      if (!c.papel || (tenantId && c.tenantId !== tenantId)) throw new HttpsError('internal', 'Não consegui aplicar o acesso da conta nova.');
      await auth.updateUser(conta.uid, { disabled: false });
    }
  } catch (e) {
    if (criado) await auth.deleteUser(conta.uid).catch(() => {});
    throw e;
  }
  return { email, criado, redefinida, jaExistia: !criado, ...(senhaGerada ? { senhaGerada } : {}) };
}

module.exports = { exigirAdmin, criarLoginDoUsuario };
