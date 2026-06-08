/*
 * AgroCore — cliente PWA.
 *
 * Responsabilidades:
 *   - Registrar el service worker.
 *   - Gestionar tokens (access + refresh) en IndexedDB/meta.
 *   - Detectar estado online/offline y reflejarlo en la UI (banner).
 *   - Exponer un fetch() robusto que: autentica, renueva tokens y encola en outbox si hay fallo de red.
 */
(function () {
  // Registro del Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/pwa/sw.js', { scope: '/' })
        .then(reg => {
          console.log('[AgroCore] SW registrado:', reg.scope);
          // Pedir sincronización periódica si está disponible
          if ('periodicSync' in reg) {
            reg.periodicSync.register('agrocore-sync-periodic', { minInterval: 15 * 60 * 1000 }).catch(() => {});
          }
        })
        .catch(err => console.warn('[AgroCore] Error registrando SW:', err));

      navigator.serviceWorker.addEventListener('message', evt => {
        if (evt.data?.type === 'SYNC_DONE') {
          window.dispatchEvent(new CustomEvent('agrocore:sync', { detail: evt.data.result }));
        }
      });
    });
  }

  // Banner online/offline
  function updateOnlineStatus() {
    let banner = document.getElementById('offline-banner');
    if (!navigator.onLine) {
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'offline-banner';
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#b45309;color:white;text-align:center;padding:8px;font-weight:600;font-size:13px;';
        banner.innerHTML = '📶 Sin conexión. Tus cambios se guardan localmente y se sincronizarán cuando vuelva la señal.';
        document.body.appendChild(banner);
      }
    } else if (banner) {
      banner.remove();
      // Intentar drenar outbox inmediatamente
      if (window.Outbox) window.Outbox.syncNow().catch(() => {});
    }
  }
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  window.addEventListener('DOMContentLoaded', updateOnlineStatus);

  // Escuchar eventos de sync exitoso
  window.addEventListener('agrocore:sync', e => {
    const results = e.detail?.results || [];
    const ok = results.filter(r => r.estado === 'aplicado').length;
    if (ok > 0 && window.Agro?.toast) {
      window.Agro.toast(`${ok} cambio(s) sincronizado(s).`, 'success');
    }
  });

  // ---------------------------------------------------------------------
  // API wrapper
  // ---------------------------------------------------------------------
  const Api = {
    base: '',
    async call(method, url, body, opts = {}) {
      const token = await window.Outbox?.getMeta('accessToken');
      const empresaId = await window.Outbox?.getMeta('empresaActivaId');
      const headers = Object.assign({
        'Content-Type': 'application/json',
        'X-Device-Id': await ensureDeviceId()
      }, opts.headers || {});
      if (token) headers['Authorization'] = 'Bearer ' + token;
      if (empresaId) headers['X-Empresa-Id'] = String(empresaId);

      const init = { method, headers };
      if (body && method !== 'GET' && method !== 'HEAD') init.body = JSON.stringify(body);

      try {
        const res = await fetch(this.base + url, init);
        if (res.status === 401) {
          const ok = await refreshAccessToken();
          if (ok) return this.call(method, url, body, opts);
        }
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new ApiError(res.status, text || res.statusText);
        }
        const ct = res.headers.get('Content-Type') || '';
        return ct.includes('application/json') ? await res.json() : await res.text();
      } catch (err) {
        // Sin red — si es una mutación, encolamos en outbox
        const isMutation = method !== 'GET' && method !== 'HEAD';
        const offline = !navigator.onLine || err?.name === 'TypeError';
        if (isMutation && offline && opts.entidad) {
          await window.Outbox.enqueue(opts.entidad, method.toLowerCase(), body);
          return { queued: true, offline: true };
        }
        throw err;
      }
    },
    get(url, opts)          { return this.call('GET', url, null, opts); },
    post(url, body, opts)   { return this.call('POST', url, body, opts); },
    put(url, body, opts)    { return this.call('PUT', url, body, opts); },
    del(url, opts)          { return this.call('DELETE', url, null, opts); }
  };

  class ApiError extends Error {
    constructor(status, msg) { super(msg); this.status = status; }
  }

  async function ensureDeviceId() {
    let id = await window.Outbox?.getMeta('deviceId');
    if (!id) {
      id = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now());
      await window.Outbox?.setMeta('deviceId', id);
    }
    return id;
  }

  async function refreshAccessToken() {
    const refreshToken = await window.Outbox?.getMeta('refreshToken');
    if (!refreshToken) return false;
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken })
      });
      if (!res.ok) return false;
      const body = await res.json();
      await window.Outbox.setMeta('accessToken', body.accessToken);
      await window.Outbox.setMeta('refreshToken', body.refreshToken);
      return true;
    } catch { return false; }
  }

  // ---------------------------------------------------------------------
  // Auth helper
  // ---------------------------------------------------------------------
  const Auth = {
    async login(usernameOrEmail, password, empresaId) {
      const body = await Api.post('/api/auth/login', {
        usernameOrEmail, password, empresaId,
        deviceId: await ensureDeviceId()
      });
      await window.Outbox.setMeta('accessToken', body.accessToken);
      await window.Outbox.setMeta('refreshToken', body.refreshToken);
      await window.Outbox.setMeta('empresaActivaId', body.empresaActivaId);
      await window.Outbox.setMeta('usuario', body.usuario);
      // registrar cliente de sync ahora que tenemos token
      try { await window.Outbox.ensureSyncClient?.(body.accessToken); } catch {}
      return body;
    },
    async logout() {
      const refreshToken = await window.Outbox.getMeta('refreshToken');
      try { if (refreshToken) await Api.post('/api/auth/logout', { refreshToken }); } catch {}
      await window.Outbox.setMeta('accessToken', null);
      await window.Outbox.setMeta('refreshToken', null);
    },
    async cambiarEmpresa(empresaId) {
      const body = await Api.post('/api/auth/cambiar-empresa', { empresaId });
      await window.Outbox.setMeta('accessToken', body.accessToken);
      await window.Outbox.setMeta('empresaActivaId', body.empresaActivaId);
      return body;
    }
  };

  window.Agro = window.Agro || {};
  window.Agro.Api = Api;
  window.Agro.Auth = Auth;
  window.Agro.toast = function (msg, type) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:10000;padding:12px 18px;border-radius:10px;color:white;font-weight:600;box-shadow:0 10px 25px rgba(0,0,0,.2);background:${
      type === 'error' ? '#dc2626' : type === 'success' ? '#15803d' : '#1e40af'
    };`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  };
})();
