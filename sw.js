/*
 * AgroCore — Service Worker
 * Cachea el "app shell" (HTML + scripts) para que el sistema abra sin conexión.
 * La lógica de datos offline (cola de cambios, caché de API) vive en el app,
 * usando IndexedDB. Este SW solo se encarga de que la app CARGUE sin señal.
 */
const CACHE = 'agrocore-shell-v4';

// Recursos del app shell. /app es el HTML principal; los CDN se cachean
// de forma oportunista en el fetch handler (no bloquean la instalación).
const SHELL = ['/app'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // las mutaciones las maneja el app (outbox)

  let url;
  try { url = new URL(req.url); } catch { return; }

  // Llamadas a la API: NO las interceptamos. El app maneja el offline por su
  // cuenta (caché en IndexedDB + cola de cambios). Si el SW las cacheara,
  // podría devolver datos viejos sin que el app se entere.
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;

  // Navegación (cargar el app): red primero, y si no hay señal, el shell cacheado.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          const clone = resp.clone();
          caches.open(CACHE).then((c) => c.put('/app', clone)).catch(() => {});
          return resp;
        })
        .catch(() => caches.match('/app').then((r) => r || caches.match(req)))
    );
    return;
  }

  // Recursos estáticos (scripts CDN, imágenes, íconos): caché primero, y si no
  // está, lo traemos de la red y lo guardamos para la próxima.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((resp) => {
          if (resp && (resp.ok || resp.type === 'opaque')) {
            const clone = resp.clone();
            caches.open(CACHE).then((c) => c.put(req, clone)).catch(() => {});
          }
          return resp;
        })
        .catch(() => cached);
    })
  );
});

// Permite que el app fuerce la activación de una versión nueva del SW.
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
