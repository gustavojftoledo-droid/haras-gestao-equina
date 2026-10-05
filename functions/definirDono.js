/* Dá a claim dono:true ao e-mail do dono do sistema. Roda no Google Cloud Shell.
   Por padrão só MOSTRA o que faria; para gravar de verdade use --aplicar.
   Uso:  node definirDono.js            (simulação)
         node definirDono.js --aplicar  (grava)
   Depois, saia e entre de novo no app para a claim valer. As outras claims (papel, modulos) são mantidas. */
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const EMAIL = 'gustavojftoledo@gmail.com';
const aplicar = process.argv.includes('--aplicar');
initializeApp({ projectId: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'equinos-manager' });
(async () => {
  const conta = await getAuth().getUserByEmail(EMAIL);
  const atuais = conta.customClaims || {};
  if (atuais.dono === true) { console.log(EMAIL + ' já é dono. Nada a fazer.'); process.exit(0); }
  console.log((aplicar ? 'GRAVANDO' : 'SIMULAÇÃO (nada será gravado)') + ': ' + EMAIL + ' receberá dono:true. Claims atuais: ' + JSON.stringify(atuais));
  if (aplicar) { await getAuth().setCustomUserClaims(conta.uid, { ...atuais, dono: true }); console.log('Pronto. Saia e entre de novo no app.'); }
  else console.log('Para gravar, rode: node definirDono.js --aplicar');
  process.exit(0);
})().catch(e => { console.error('Erro:', e.code === 'auth/user-not-found' ? 'Esse e-mail não tem conta no Firebase Authentication.' : e.message); process.exit(1); });
