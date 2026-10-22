// Dia da virada (docs/virada.md): substitui o sw.js do PE no GitHub Pages. O antigo guarda o app para abrir sem
// internet; este apaga essas cópias, sai do aparelho e leva as telas abertas para o endereço novo. Assim o ícone antigo
// deixa de abrir o PE guardado. O PE registra o sw.js com updateViaCache 'none': o navegador busca este arquivo novo
// na próxima vez que o app abrir com internet.
const NOVO = 'https://app.equinosmanager.com.br/';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const nome of await caches.keys()) await caches.delete(nome);
    const telas = await self.clients.matchAll({ type: 'window' });
    await self.registration.unregister();
    await Promise.allSettled(telas.map((tela) => tela.navigate(NOVO)));
  })());
});
