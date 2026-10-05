/* Define, no LOGIN de cada usuário, o papel (admin/funcionario) e os módulos que ele pode ver.
   As regras do Firestore (firestore.rules.2b) usam isso para só deixar ADMINISTRADOR alterar a lista de usuários.
   Roda no Google Cloud Shell (gratuito). Por padrão só MOSTRA o que faria; para gravar de verdade use --aplicar.

   Uso:   node definir_papeis.js            (simulação, não grava nada)
          node definir_papeis.js --aplicar  (grava as claims)
   Não mexe em `tenantId`: se o usuário já tiver essa claim, ela é mantida. */
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const MODULOS = ['animais','grupos','nascimentos','manejos','veterinaria','transporte','treinos','estoque','funcionarios','financeiro','usuarios','consultoria'];
const aplicar = process.argv.includes('--aplicar');
const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'equinos-manager';
const colecao = process.env.COLECAO_DADOS || 'harasData'; // haras original; para um cliente: tenants/<id>/dados
initializeApp({ projectId });
(async ()=>{
  const snap = await getFirestore().collection(colecao).doc('usuarios_list').get();
  const lista = snap.exists ? snap.data().value : [];
  if(!Array.isArray(lista) || lista.length===0){ console.error('Lista de usuários vazia ou não encontrada em '+colecao+'. Nada a fazer.'); process.exit(1); }
  console.log((aplicar?'GRAVANDO':'SIMULAÇÃO (nada será gravado)')+' — '+lista.length+' usuário(s) em '+colecao+'\n');
  let alterados = 0, semConta = 0;
  for(const u of lista){
    const email = (u.email||'').trim().toLowerCase();
    if(!email){ console.log('  (sem e-mail) '+(u.nome||'?')+' — ignorado'); continue; }
    const papel = u.admin ? 'admin' : 'funcionario';
    const modulos = u.admin ? MODULOS : MODULOS.filter(m=>u.permissoes && u.permissoes[m] && u.permissoes[m].ver);
    let conta;
    try{ conta = await getAuth().getUserByEmail(email); }
    catch(e){ console.log('  '+email+' — SEM CONTA no Firebase Authentication (ignorado)'); semConta++; continue; }
    const atuais = conta.customClaims || {};
    const novas = { ...atuais, papel, modulos };
    const igual = JSON.stringify(atuais)===JSON.stringify(novas);
    console.log('  '+email.padEnd(38)+' papel='+papel.padEnd(11)+' módulos='+modulos.length+(igual?'  (já estava assim)':'  → será atualizado'));
    if(!igual && aplicar){ await getAuth().setCustomUserClaims(conta.uid, novas); alterados++; }
  }
  console.log('\n'+(aplicar? alterados+' usuário(s) atualizado(s). ' : 'Nada foi gravado. ')+(semConta? semConta+' sem conta. ':'')+'Depois disso, cada pessoa precisa SAIR e ENTRAR de novo no app para o novo papel valer.');
  process.exit(0);
})().catch(e=>{ console.error('Erro:', e.message); process.exit(1); });
