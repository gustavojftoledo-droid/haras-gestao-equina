/* Teste de ponta a ponta: grava no Firestore e confere se o trigger de verdade (no emulador de Functions) mudou as claims. Veja README.md. */
process.env.GCLOUD_PROJECT='demo-haras';
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
initializeApp({projectId:'demo-haras'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const a=getAuth(), db=getFirestore();
  const u=await a.createUser({email:'pedro@x.com',password:'senha123456'});
  await a.setCustomUserClaims(u.uid,{papel:'admin',modulos:['animais']});
  const perm={animais:{ver:true}};
  await db.doc('harasData/usuarios_list').set({value:[{email:'pedro@x.com',admin:false,permissoes:perm}]});
  let c; for(let i=0;i<20;i++){ await sleep(1000); c=(await a.getUser(u.uid)).customClaims; if(c.papel==='funcionario')break; }
  console.log('E2E haras claims:',JSON.stringify(c));
  const t=await a.createUser({email:'t@acme.com',password:'senha123456'});
  await db.doc('tenants/acme/dados/usuarios_list').set({value:[{email:'t@acme.com',admin:true}]});
  for(let i=0;i<20;i++){ await sleep(1000); c=(await a.getUser(t.uid)).customClaims||{}; if(c.tenantId)break; }
  console.log('E2E cliente claims:',JSON.stringify(c));
  process.exit(c.tenantId==='acme'?0:1);
})();
