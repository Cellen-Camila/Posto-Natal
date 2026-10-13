// Service worker: guarda a interface no aparelho para funcionar com internet instável na pista.
// Chamadas à API sempre vão à rede (os registros sem conexão ficam na fila do app).
const CACHE = 'posto-v1';
const SHELL = [
  '/', '/index.html', '/app.css', '/app.js', '/lib.js', '/icon.svg', '/manifest.webmanifest',
  '/pages/crud.js', '/pages/painel.js', '/pages/pista.js', '/pages/meu.js', '/pages/agenda.js', '/pages/rh.js',
  '/pages/financeiro.js', '/pages/conveniencia.js', '/pages/combustiveis.js', '/pages/precos.js', '/pages/documentos.js', '/pages/contabil.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // rede primeiro (versão mais nova), cache como reserva quando offline
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html'))),
  );
});
