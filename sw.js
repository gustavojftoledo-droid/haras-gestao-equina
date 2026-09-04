// Service Worker do Equinos Manager — Gestão Equina
// "Rede primeiro": com internet, sempre pega a versão mais nova e guarda uma cópia. Sem internet,
// serve o que está guardado — incluindo as bibliotecas externas (Firebase, pdf.js), pra o app
// realmente abrir e funcionar offline. Os DADOS ficam no cache offline do próprio Firestore
// (enablePersistence no app): o que você digitar sem internet entra numa fila e sobe sozinho quando
// reconectar. Só entra em ação servido por http/https (GitHub Pages etc.), não em file://.
const CACHE_NAME = 'haras-gestao-equina-v7';

// Tudo que o app precisa pra abrir sem internet. As URLs externas (gstatic/cdnjs) mandam cabeçalho
// CORS, então dá pra guardar uma cópia utilizável (não é "opaque").
const APP_SHELL = [
  './app_145.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Um item que falhe (CDN fora do ar, sem internet na hora) não pode derrubar o cache inteiro —
    // por isso um a um, e não cache.addAll (que é tudo-ou-nada).
    await Promise.allSettled(APP_SHELL.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res && (res.ok || res.type === 'opaque')) await cache.put(url, res.clone());
      } catch (e) { /* segue sem esse item; a re-cache em runtime pega depois, com internet */ }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

// "Rede primeiro, cache como reserva": sempre busca a versão mais nova quando tem internet — importante
// enquanto o app ainda muda com frequência. Sem internet, usa o que está guardado.
// NÃO intercepta chamadas ao Firestore/Google APIs (o SDK do Firebase tem o próprio cache offline).
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Deixa passar direto (sem cache nosso): Firestore, Auth, e qualquer endpoint de dados do Google.
  if (/(^|\.)googleapis\.com$/.test(url.hostname) ||
      /(^|\.)firebaseio\.com$/.test(url.hostname) ||
      /(^|\.)firebase\.googleapis\.com$/.test(url.hostname) ||
      url.hostname === 'securetoken.googleapis.com' ||
      url.hostname === 'identitytoolkit.googleapis.com') {
    return;
  }
  event.respondWith(
    fetch(req).then((response) => {
      // Guarda cópia de tudo que carregou bem: a tela (mesma origem) e as libs externas (CORS).
      if (response && response.status === 200 &&
          (response.type === 'basic' || response.type === 'cors')) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
      }
      return response;
    }).catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
