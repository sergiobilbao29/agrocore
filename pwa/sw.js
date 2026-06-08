/*
 * AgroCore — Service Worker offline-first
 *
 * Estrategias:
 *   - App shell (HTML/CSS/JS propios): Cache First con fallback de red.
 *   - CDN estáticos (Tailwind, Chart.js, iconos): Stale While Revalidate.
 *   - Llamadas a /api GET: Network First con fallback a cache (sólo lecturas).
 *   - Llamadas a /api POST/PUT/DELETE: si falla la red, se encolan en IndexedDB (outbox)
 *     y se reintentan con Background Sync cuando vuelve la conexión.
 *
 * La página debe registrar este service worker:
 *   navigator.serviceWorker.register('/pwa/sw.js', { scope: '/' });
 */

const CACHE_VERSION = 'v1.1.0';
const SHELL_CACHE = `agrocore-shell-${CACHE_VERSION}`;
const CDN_CACHE   = `agrocore-cdn-${CACHE_VERSION}`;
const API_CACHE   = `agrocore-api-${CACHE_VERSION}`;
const IMAGE_CACHE = `agrocore-img-${CACHE_VERSION}`;

const APP_SHELL = [
  '/',
  '/AgroCore.html',
  '/pwa/manifest.webmanifest',
  '/pwa/offline.html',
  '/pwa/app.js',
  '/pwa/outbox.js'
];

// ----- Install: precache shell ---------------------------------------------
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(APP_SHELL).catch(() => null))
      .then(() => self.skipWaiting())
  );
});

// ----- Activate: cleanup old versions --------------------------------------
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => !k.endsWith(CACHE_VERSION)).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// ----- Fetch: elige estrategia según URL -----------------------------------
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Sólo interceptamos GET, HEAD. POST/PUT/DELETE se dejan pasar directo;
  // el cliente (app.js/outbox.js) decide si va a red o a la outbox.
  if (event.request.method !== 'GET' && event.request.method !== 'HEAD') return;

  // CDN (Tailwind, Chart, etc.) → Stale While Revalidate
  if (url.origin !== self.location.origin && (url.pathname.endsWith('.js') || url.pathname.endsWith('.css'))) {
    event.respondWith(staleWhileRevalidate(event.request, CDN_CACHE));
    return;
  }

  // Imágenes → Cache First
  if (event.request.destination === 'image') {
    event.respondWith(cacheFirst(event.request, IMAGE_CACHE));
    return;
  }

  // Cotizaciones (BCR + Dólar) → Stale-While-Revalidate: siempre pintamos el
  // valor cacheado al instante y refrescamos en paralelo.
  if (url.pathname.startsWith('/api/cotizaciones/')) {
    event.respondWith(staleWhileRevalidate(event.request, API_CACHE));
    return;
  }

  // API GET → Network First
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(event.request, API_CACHE));
    return;
  }

  // Resto (HTML/JS propios) → Cache First
  event.respondWith(cacheFirst(event.request, SHELL_CACHE));
});

// ---------------------------------------------------------------------------
// Background Sync — reintenta la outbox cuando vuelve la conexión
// ---------------------------------------------------------------------------
self.addEventListener('sync', event => {
  if (event.tag === 'agrocore-sync-outbox') {
    event.waitUntil(processOutbox());
  }
});

// Fallback periódico cada 15 min si el navegador lo soporta.
self.addEventListener('periodicsync', event => {
  if (event.tag === 'agrocore-sync-periodic') {
    event.waitUntil(processOutbox());
  }
});

// Mensajes desde la app (forzar sync al reconectarse, limpiar cache)
self.addEventListener('message', event => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data.type === 'SYNC_NOW') event.waitUntil(processOutbox());
});

// ---------------------------------------------------------------------------
// Estrategias
// ---------------------------------------------------------------------------
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const resp = await fetch(req);
    if (resp.ok) cache.put(req, resp.clone());
    return resp;
  } catch (e) {
    return caches.match('/pwa/offline.html') || new Response('Offline', { status: 503 });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req).then(resp => {
    if (resp.ok) cache.put(req, resp.clone());
    return resp;
  }).catch(() => cached);
  return cached || fetchPromise;
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const resp = await fetch(req);
    if (resp.ok) cache.put(req, resp.clone());
    return resp;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    return new Response(JSON.stringify({
      offline: true,
      message: 'Sin conexión. Se usará caché local si existe.'
    }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
}

// ---------------------------------------------------------------------------
// Outbox (IndexedDB) — el cliente escribe aquí cuando no hay red,
// y nosotros drenamos contra /api/sync/push.
// ---------------------------------------------------------------------------
async function processOutbox() {
  const db = await openDb();
  const tx = db.transaction('outbox', 'readonly');
  const items = await reqToPromise(tx.objectStore('outbox').getAll());
  if (!items.length) return;

  const token = await getToken();
  const syncClientId = await getSyncClientId();
  if (!token || !syncClientId) return;

  try {
    const res = await fetch('/api/sync/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({
        syncClientId,
        cursorB64: await getCursor(),
        items: items.map(it => ({
          entidad: it.entidad,
          operacion: it.operacion,
          syncUuid: it.syncUuid,
          payloadJson: it.payloadJson,
          clientRowVersionB64: it.clientRowVersionB64 || null
        }))
      })
    });

    if (!res.ok) return;
    const body = await res.json();

    // Eliminar items aplicados / con conflicto resuelto
    const tx2 = db.transaction('outbox', 'readwrite');
    const store = tx2.objectStore('outbox');
    for (const r of body.results || []) {
      if (r.estado === 'aplicado' || r.estado === 'conflicto') {
        const match = items.find(i => i.syncUuid === r.syncUuid && i.entidad === r.entidad);
        if (match) store.delete(match.id);
      }
    }
    await txDone(tx2);

    // Notificar a la app abierta
    const clientsList = await self.clients.matchAll({ type: 'window' });
    clientsList.forEach(c => c.postMessage({ type: 'SYNC_DONE', result: body }));
  } catch (e) {
    // la próxima sync lo reintenta
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('agrocore', 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('outbox'))
        db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('meta'))
        db.createObjectStore('meta', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('cache'))
        db.createObjectStore('cache', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function reqToPromise(req) {
  return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}
function txDone(tx) { return new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); }

async function getMeta(key) {
  const db = await openDb();
  const tx = db.transaction('meta', 'readonly');
  const r = await reqToPromise(tx.objectStore('meta').get(key));
  return r?.value;
}
async function getToken()        { return await getMeta('accessToken'); }
async function getSyncClientId() { return await getMeta('syncClientId'); }
async function getCursor()       { return await getMeta('syncCursor') || ''; }
