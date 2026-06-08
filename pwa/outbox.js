/*
 * AgroCore — capa cliente de outbox offline.
 *
 * Uso desde la app:
 *   await Outbox.init();
 *   await Outbox.enqueue('MovimientoCaja', 'insert', dto);
 *   await Outbox.syncNow();
 *
 * Internamente guardamos los cambios en IndexedDB (store 'outbox') y los
 * enviamos al endpoint /api/sync/push cuando hay conexión. Cada item tiene
 * un SyncUuid generado localmente — el servidor lo usa como clave idempotente.
 */
const Outbox = (() => {
  const DB_NAME = 'agrocore';
  const DB_VERSION = 2;
  const API_BASE = '';
  let db;

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
        if (!d.objectStoreNames.contains('meta'))   d.createObjectStore('meta', { keyPath: 'key' });
        if (!d.objectStoreNames.contains('cache'))  d.createObjectStore('cache', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function init() { db = await open(); return db; }

  function uuid() {
    return (crypto.randomUUID && crypto.randomUUID()) ||
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
  }

  function tx(store, mode) { return db.transaction(store, mode).objectStore(store); }
  function wait(req) { return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); }); }

  async function setMeta(key, value) {
    await wait(tx('meta', 'readwrite').put({ key, value }));
  }
  async function getMeta(key) {
    const row = await wait(tx('meta', 'readonly').get(key));
    return row?.value;
  }

  async function enqueue(entidad, operacion, payload) {
    const syncUuid = uuid();
    await wait(tx('outbox', 'readwrite').add({
      entidad,
      operacion,
      syncUuid,
      payloadJson: JSON.stringify(payload),
      createdAt: new Date().toISOString(),
      status: 'pending'
    }));
    // Notifica al SW para sincronizar cuando haya red
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      if (reg.sync) {
        try { await reg.sync.register('agrocore-sync-outbox'); } catch {}
      }
    }
    return syncUuid;
  }

  async function listPending() {
    return await wait(tx('outbox', 'readonly').getAll());
  }

  async function remove(id) {
    await wait(tx('outbox', 'readwrite').delete(id));
  }

  async function ensureSyncClient(token, nombre) {
    let id = await getMeta('syncClientId');
    if (id) return id;
    const res = await fetch(`${API_BASE}/api/sync/client`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ nombre: nombre || navigator.userAgent, plataforma: navigator.platform })
    });
    if (!res.ok) throw new Error('No se pudo registrar el cliente de sync.');
    const body = await res.json();
    id = body.syncClientId;
    await setMeta('syncClientId', id);
    return id;
  }

  async function syncNow() {
    const token = await getMeta('accessToken');
    if (!token) return { skipped: 'sin token' };
    const clientId = await ensureSyncClient(token);
    const pending = await listPending();

    // PUSH
    if (pending.length) {
      const res = await fetch(`${API_BASE}/api/sync/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          syncClientId: clientId,
          cursorB64: await getMeta('syncCursor') || '',
          items: pending.map(p => ({
            entidad: p.entidad,
            operacion: p.operacion,
            syncUuid: p.syncUuid,
            payloadJson: p.payloadJson,
            clientRowVersionB64: null
          }))
        })
      });
      if (res.ok) {
        const body = await res.json();
        for (const r of body.results || []) {
          if (r.estado === 'aplicado' || r.estado === 'conflicto') {
            const match = pending.find(p => p.syncUuid === r.syncUuid && p.entidad === r.entidad);
            if (match) await remove(match.id);
          }
        }
        if (body.nextCursorB64) await setMeta('syncCursor', body.nextCursorB64);
      }
    }

    // PULL
    const cursor = (await getMeta('syncCursor')) || '';
    const pull = await fetch(`${API_BASE}/api/sync/pull?clientId=${clientId}&cursor=${encodeURIComponent(cursor)}`, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (pull.ok) {
      const body = await pull.json();
      for (const delta of (body.deltas || [])) {
        await wait(tx('cache', 'readwrite').put({
          key: delta.entidad,
          records: delta.records,
          updatedAt: new Date().toISOString()
        }));
      }
      if (body.nextCursorB64) await setMeta('syncCursor', body.nextCursorB64);
    }
    return { pushed: pending.length };
  }

  async function readCached(entidad) {
    const row = await wait(tx('cache', 'readonly').get(entidad));
    return row?.records || [];
  }

  function isOnline() { return navigator.onLine; }

  // Reintenta al volver online
  window.addEventListener('online', () => { syncNow().catch(() => {}); });

  return { init, enqueue, listPending, syncNow, setMeta, getMeta, readCached, isOnline };
})();

window.Outbox = Outbox;
