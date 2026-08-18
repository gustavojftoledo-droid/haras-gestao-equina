// Service Worker do Haras — Gestão Equina
// Cache simples "primeiro o cache, rede como reserva", pra abrir o app mesmo sem internet depois de
// instalado ("Adicionar à tela de início"). Só entra em ação quando o app é servido por http/https
// (ex: GitHub Pages, Netlify) — não faz nada abrindo o arquivo direto do computador (file://), que é
// como o app roda hoje. Isso não muda nada nos dados: eles continuam só no localStorage do aparelho.
const CACHE_NAME = 'haras-gestao-equina-v1';
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

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
