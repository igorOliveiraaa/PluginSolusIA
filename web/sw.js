// Service worker: guarda a interface para abrir rapido no celular.
// As chamadas de API nunca sao guardadas - dados vem sempre do servidor.

const CACHE = 'ferramentas-solus-v2';
const ARQUIVOS = [
  '.', 'index.html', 'estilo.css', 'manifest.json', 'icone.svg',
  'inicio.js', 'comum.js', 'login.js', 'app.js', 'orcamento.js',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ARQUIVOS)));
  self.skipWaiting();
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys().then((chaves) =>
      Promise.all(chaves.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (evento) => {
  const url = new URL(evento.request.url);
  if (url.pathname.startsWith('/api/')) return;      // API sempre do servidor
  if (evento.request.method !== 'GET') return;

  evento.respondWith(fetch(evento.request).catch(() => caches.match(evento.request)));
});
