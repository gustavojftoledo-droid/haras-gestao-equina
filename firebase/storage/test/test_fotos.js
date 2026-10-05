// Testa a logica PURA do fotos.js no Node (sem navegador). Rodar: node test_fotos.js
const assert = require('assert'); const F = require('../fotos.js');
let ok = 0, bad = 0;
const t = (n, f) => { try { f(); ok++; console.log('OK  ', n); } catch (e) { bad++; console.log('FALHA', n, e.message); } };
const eq = (a, b) => assert.deepStrictEqual(a, b);
t('paisagem 4000x3000 -> 900x675', () => eq(F.calcularDimensoes(4000, 3000, 900), { w: 900, h: 675 }));
t('retrato 3000x4000 -> 675x900', () => eq(F.calcularDimensoes(3000, 4000, 900), { w: 675, h: 900 }));
t('quadrada 2000x2000 -> 900x900', () => eq(F.calcularDimensoes(2000, 2000, 900), { w: 900, h: 900 }));
t('pequena 400x300 nao aumenta', () => eq(F.calcularDimensoes(400, 300, 900), { w: 400, h: 300 }));
t('miniatura 240 de 900x675 -> 240x180', () => eq(F.calcularDimensoes(900, 675, 240), { w: 240, h: 180 }));
t('faixa 10000x10 -> 900x1 (minimo 1)', () => eq(F.calcularDimensoes(10000, 10, 900), { w: 900, h: 1 }));
t('dimensao invalida -> 0x0', () => eq(F.calcularDimensoes(0, 100, 900), { w: 0, h: 0 }));
t('padrao usa 900', () => eq(F.calcularDimensoes(1800, 900), { w: 900, h: 450 }));
t('escopo null -> haras original', () => eq(F.pastaFotos(null, 'a1'), 'haras-original/fotos/a1/'));
t('escopo "" -> haras original', () => eq(F.pastaFotos('', 'a1'), 'haras-original/fotos/a1/'));
t('escopo cliente (string)', () => eq(F.pastaFotos('cli-a', 'a1'), 'tenants/cli-a/fotos/a1/'));
t('escopo cliente (objeto)', () => eq(F.pastaFotos({ tenantId: 'cli-a' }, 'a1'), 'tenants/cli-a/fotos/a1/'));
t('escopo invalido (../) rejeitado', () => assert.throws(() => F.pastaFotos('../x', 'a1')));
t('escopo invalido (com /) rejeitado', () => assert.throws(() => F.pastaFotos('a/b', 'a1')));
t('id do animal com "/" e ".." e limpo', () => eq(F.pastaFotos('cli-a', '../b/c'), 'tenants/cli-a/fotos/___b_c/'));
t('id vazio rejeitado', () => assert.throws(() => F.pastaFotos('cli-a', '')));
t('caminhoFoto monta caminho', () => eq(F.caminhoFoto('cli-a', 'a1', 'x.jpg'), 'tenants/cli-a/fotos/a1/x.jpg'));
t('nome de arquivo com / rejeitado', () => assert.throws(() => F.caminhoFoto('cli-a', 'a1', '../x.jpg')));
t('hash estavel', () => eq(F.hashBytes(new Uint8Array([1, 2, 3])), F.hashBytes(new Uint8Array([1, 2, 3]))));
t('hash difere para conteudo diferente', () => assert.notStrictEqual(F.hashBytes(new Uint8Array([1, 2, 3])), F.hashBytes(new Uint8Array([1, 2, 4]))));
t('hash tem 8 hex', () => assert.ok(/^[0-9a-f]{8}$/.test(F.hashBytes(new Uint8Array([])))));
t('nomes: foto e miniatura distintas e em jpg', () => {
  const n = F.nomesArquivo(new Uint8Array([9, 9]), 1700000000000);
  assert.ok(/^[a-z0-9]+-[0-9a-f]{8}\.jpg$/.test(n.foto)); assert.ok(/_min\.jpg$/.test(n.miniatura)); assert.notStrictEqual(n.foto, n.miniatura);
});
t('nomes mudam com o tempo', () => assert.notStrictEqual(F.nomesArquivo(new Uint8Array([1]), 1).foto, F.nomesArquivo(new Uint8Array([1]), 2).foto));
t('nomes combinam com o que as regras aceitam (caminho valido)', () => F.caminhoFoto('cli-a', 'a1', F.nomesArquivo(new Uint8Array([5]), 5).miniatura));
t('data:image/jpeg e valido', () => assert.ok(F.ehFotoValida('data:image/jpeg;base64,AAAA')));
t('https e valido', () => assert.ok(F.ehFotoValida('https://firebasestorage.googleapis.com/x')));
t('http simples nao e valido', () => assert.ok(!F.ehFotoValida('http://x/y.jpg')));
t('javascript: nao e valido', () => assert.ok(!F.ehFotoValida('javascript:alert(1)')));
t('data:text/html nao e valido', () => assert.ok(!F.ehFotoValida('data:text/html;base64,AAAA')));
t('vazio/undefined nao e valido', () => { assert.ok(!F.ehFotoValida('')); assert.ok(!F.ehFotoValida(undefined)); });
t('dataUrlParaBytes decodifica', () => { const r = F.dataUrlParaBytes('data:image/jpeg;base64,' + Buffer.from([1, 2, 255]).toString('base64')); eq(Array.from(r.bytes), [1, 2, 255]); eq(r.tipo, 'image/jpeg'); });
t('dataUrlParaBytes rejeita nao-imagem', () => assert.throws(() => F.dataUrlParaBytes('data:text/plain;base64,AAAA')));
t('caminhoDeUrl extrai caminho', () => eq(F.caminhoDeUrl('https://firebasestorage.googleapis.com/v0/b/equinos-manager.firebasestorage.app/o/tenants%2Fcli-a%2Ffotos%2Fa1%2Fx.jpg?alt=media&token=abc'), 'tenants/cli-a/fotos/a1/x.jpg'));
t('caminhoDeUrl de data: devolve vazio', () => eq(F.caminhoDeUrl('data:image/jpeg;base64,AAAA'), ''));
t('limite = 400 KB (igual as regras)', () => eq(F.LIMITE_BYTES, 409600));

// migrar/remover com Storage FALSO (sem navegador): so o que nao usa canvas.
const fakeStorage = (falha) => { const feito = {}; return { feito, ref: (p) => ({ put: async (b, m) => { if (falha) throw new Error('rede'); feito[p] = m; }, getDownloadURL: async () => 'https://x/o/' + encodeURIComponent(p) + '?alt=media', delete: async () => { delete feito[p]; } }) }; };
global.Blob = global.Blob || require('buffer').Blob;
(async () => {
  const b64 = 'data:image/jpeg;base64,' + Buffer.from(new Uint8Array(1000).fill(3)).toString('base64');
  const h = { id: 'a1', fotoUrl: b64 }; const s = fakeStorage(false);
  try { const r = await F.migrarBase64ParaStorage(s, 'cli-a', h);
    // miniatura falha sem canvas (document inexistente): migracao segue so com a foto.
    assert.ok(r === true && h.fotoUrl.startsWith('https://') && /^tenants\/cli-a\/fotos\/a1\//.test(h.fotoPath) && !h.fotoMiniUrl);
    const m = s.feito[h.fotoPath]; assert.strictEqual(m.cacheControl, 'public,max-age=31536000'); assert.strictEqual(m.contentType, 'image/jpeg');
    ok++; console.log('OK   migrar: base64 vira URL, cacheControl 1 ano, caminho do cliente (miniatura sem canvas = ignorada)'); } catch (e) { bad++; console.log('FALHA migrar', e.message); }
  const h2 = { id: 'a2', fotoUrl: b64 };
  try { await F.migrarBase64ParaStorage(fakeStorage(true), null, h2); bad++; console.log('FALHA migrar com erro devia rejeitar'); }
  catch (e) { try { assert.strictEqual(h2.fotoUrl, b64); assert.ok(!h2.fotoPath); ok++; console.log('OK   migrar com upload falhando: base64 continua intacto'); } catch (e2) { bad++; console.log('FALHA', e2.message); } }
  try { assert.strictEqual(await F.migrarBase64ParaStorage(s, null, { id: 'x', fotoUrl: 'https://a/b' }), false); assert.strictEqual(await F.migrarBase64ParaStorage(s, null, { id: 'x' }), false); ok++; console.log('OK   migrar: nada a fazer (https ou sem foto) -> false'); } catch (e) { bad++; console.log('FALHA', e.message); }
  try { const n = await F.removerFoto(s, h); assert.strictEqual(n, 1); assert.ok(!s.feito[h.fotoPath]); ok++; console.log('OK   removerFoto apaga pelo fotoPath'); } catch (e) { bad++; console.log('FALHA remover', e.message); }
  try { const s3 = fakeStorage(false); const n = await F.removerFoto(s3, { fotoUrl: 'https://x/o/' + encodeURIComponent('tenants/cli-a/fotos/a1/y.jpg') + '?alt=media' }); assert.strictEqual(n, 1); ok++; console.log('OK   removerFoto acha o caminho pela URL'); } catch (e) { bad++; console.log('FALHA', e.message); }
  console.log(`\n${ok} passaram, ${bad} falharam`); process.exit(bad ? 1 : 0);
})();
