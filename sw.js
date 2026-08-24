// Service Worker do Equinos Manager — Gestão Equina
// Cache "rede primeiro" — sempre busca a versão mais nova quando tem internet, e só usa o que está
// guardado se a rede falhar (offline), depois de instalado ("Adicionar à tela de início"). Só entra em
// ação quando o app é servido por http/https (ex: GitHub Pages, Netlify) — não faz nada abrindo o
// arquivo direto do computador (file://). Isso não muda nada nos dados: eles continuam só no
// localStorage do aparelho.
const CACHE_NAME = 'haras-gestao-equina-v2';
const APP_SHELL = [
  './app_145.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {}) // sem internet no primeiro acesso: instala mesmo assim, sem travar
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// "Rede primeiro, cache como reserva": sempre busca a versão mais nova quando tem internet — importante
// enquanto o app ainda muda com frequência. Só usa o que está guardado no cache se a rede falhar
// (offline), pra não deixar ninguém preso numa versão antiga depois de uma atualização.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).then((response) => {
      if (response && response.status === 200 && response.type === 'basic') {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
      }
      return response;
    }).catch(() => caches.match(event.request))
  );
});
