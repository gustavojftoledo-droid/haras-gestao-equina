// Testes das regras do Storage no emulador. Uso: ver README.md (secao "Como testar").
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const aqui = path.dirname(fileURLToPath(import.meta.url));
const env = await initializeTestEnvironment({ projectId:'demo-haras',
  storage:{ host:'127.0.0.1', port:9199, rules: fs.readFileSync(process.env.STORAGE_RULES || path.join(aqui,'..','storage.rules'),'utf8') } });
let ok=0, bad=0;
const t = async (nome, p, esperado)=>{ try{ await (esperado? assertSucceeds(p): assertFails(p)); ok++; console.log('OK  ', nome); }catch(e){ bad++; console.log('FALHA', nome, String(e.message).slice(0,100)); } };
const st = c => c.storage();
const anon = st(env.unauthenticatedContext());
const orig = st(env.authenticatedContext('gustavo',{email:'g@x.com', papel:'admin'}));
const a = st(env.authenticatedContext('ua',{tenantId:'cli-a', papel:'admin'}));
const b = st(env.authenticatedContext('ub',{tenantId:'cli-b', papel:'funcionario'}));
const vazio = st(env.authenticatedContext('uv',{tenantId:''}));
const bytes = n => new Uint8Array(n).fill(7);
const JPG = {contentType:'image/jpeg'};
const up = (s, caminho, n=50*1024, meta=JPG) => uploadBytes(ref(s,caminho), bytes(n), meta);
const rd = (s, caminho) => getBytes(ref(s,caminho));
const del = (s, caminho) => deleteObject(ref(s,caminho));
const A='tenants/cli-a/fotos/cavalo1/f1.jpg', B='tenants/cli-b/fotos/cavalo1/f1.jpg', O='haras-original/fotos/cavalo1/f1.jpg';
await env.withSecurityRulesDisabled(async c=>{
  for(const p of [A,B,O]) await uploadBytes(ref(c.storage(),p), bytes(1000), JPG);
});
// anonimo
await t('anônimo NÃO lê foto do cliente A', rd(anon,A), false);
await t('anônimo NÃO lê foto do haras original', rd(anon,O), false);
await t('anônimo NÃO grava no cliente A', up(anon,'tenants/cli-a/fotos/x/n.jpg'), false);
await t('anônimo NÃO grava no haras original', up(anon,'haras-original/fotos/x/n.jpg'), false);
await t('anônimo NÃO apaga', del(anon,A), false);
// haras original
await t('haras original LÊ a própria foto', rd(orig,O), true);
await t('haras original GRAVA jpeg 50 KB', up(orig,'haras-original/fotos/cavalo2/n.jpg'), true);
await t('haras original GRAVA png', up(orig,'haras-original/fotos/cavalo2/n.png',20000,{contentType:'image/png'}), true);
await t('haras original GRAVA webp', up(orig,'haras-original/fotos/cavalo2/n.webp',20000,{contentType:'image/webp'}), true);
await t('haras original APAGA a própria foto', del(orig,O), true);
await t('haras original NÃO lê cliente A', rd(orig,A), false);
await t('haras original NÃO grava no cliente A', up(orig,'tenants/cli-a/fotos/x/n.jpg'), false);
await t('haras original NÃO apaga do cliente A', del(orig,A), false);
// cliente A
await t('cliente A LÊ a própria foto', rd(a,A), true);
await t('cliente A GRAVA jpeg 50 KB', up(a,'tenants/cli-a/fotos/cavalo2/n.jpg'), true);
await t('cliente A GRAVA miniatura (webp)', up(a,'tenants/cli-a/fotos/cavalo2/min.webp',15000,{contentType:'image/webp'}), true);
await t('cliente A GRAVA exatamente 400 KB', up(a,'tenants/cli-a/fotos/cavalo2/limite.jpg',400*1024), true);
await t('cliente A APAGA a própria foto', del(a,A), true);
// cliente B / leitura cruzada
await t('cliente B LÊ a própria foto', rd(b,B), true);
await t('cliente A NÃO lê foto do cliente B', rd(a,B), false);
await t('cliente B NÃO lê foto do cliente A', rd(b,'tenants/cli-a/fotos/cavalo1/f1.jpg').catch(e=>{throw e}), false);
await t('cliente A NÃO grava no cliente B', up(a,'tenants/cli-b/fotos/x/n.jpg'), false);
await t('cliente A NÃO apaga do cliente B', del(a,B), false);
await t('cliente A NÃO lê haras original', rd(a,'haras-original/fotos/cavalo1/f1.jpg'), false);
await t('cliente A NÃO grava no haras original', up(a,'haras-original/fotos/x/n.jpg'), false);
await t('cliente B NÃO apaga do haras original', del(b,'haras-original/fotos/cavalo1/f1.jpg'), false);
await t('claim tenantId vazia NÃO lê haras original', rd(vazio,'haras-original/fotos/cavalo1/f1.jpg'), false);
await t('claim tenantId vazia NÃO grava', up(vazio,'haras-original/fotos/x/n.jpg'), false);
// tipo invalido
await t('cliente A NÃO grava PDF', up(a,'tenants/cli-a/fotos/c/d.pdf',1000,{contentType:'application/pdf'}), false);
await t('cliente A NÃO grava vídeo mp4', up(a,'tenants/cli-a/fotos/c/v.mp4',1000,{contentType:'video/mp4'}), false);
await t('cliente A NÃO grava gif', up(a,'tenants/cli-a/fotos/c/g.gif',1000,{contentType:'image/gif'}), false);
await t('cliente A NÃO grava SVG', up(a,'tenants/cli-a/fotos/c/s.svg',1000,{contentType:'image/svg+xml'}), false);
await t('cliente A NÃO grava sem contentType', uploadBytes(ref(a,'tenants/cli-a/fotos/c/sem.jpg'), bytes(1000)), false);
await t('haras original NÃO grava HTML', up(orig,'haras-original/fotos/c/h.jpg',1000,{contentType:'text/html'}), false);
// tamanho
await t('cliente A NÃO grava 400 KB + 1 byte', up(a,'tenants/cli-a/fotos/c/grande.jpg',400*1024+1), false);
await t('cliente A NÃO grava 2 MB', up(a,'tenants/cli-a/fotos/c/enorme.jpg',2*1024*1024), false);
await t('haras original NÃO grava 500 KB', up(orig,'haras-original/fotos/c/grande.jpg',500*1024), false);
await t('NÃO sobrescreve foto existente com arquivo grande', up(a,'tenants/cli-a/fotos/cavalo2/n.jpg',500*1024), false);
// tudo o mais bloqueado
await t('cliente A NÃO grava fora de fotos/', up(a,'tenants/cli-a/outros/n.jpg'), false);
await t('cliente A NÃO grava na raiz', up(a,'n.jpg'), false);
await t('cliente A NÃO grava em tenants/cli-a/fotos/ direto (sem animal)', up(a,'tenants/cli-a/fotos/n.jpg'), false);
await t('haras original NÃO grava fora de fotos/', up(orig,'haras-original/documentos/n.jpg'), false);
await t('haras original NÃO lê pasta qualquer', rd(orig,'qualquer/coisa.jpg'), false);
console.log(`\n${ok} passaram, ${bad} falharam`);
await env.cleanup(); process.exit(bad?1:0);
