# AgroCore PWA — Offline-first

Este directorio contiene el *shell* de la Progressive Web App:

| Archivo                     | Rol                                                                                     |
|-----------------------------|-----------------------------------------------------------------------------------------|
| `manifest.webmanifest`      | Manifiesto PWA (nombre, íconos, shortcuts al "Modo Campo").                             |
| `sw.js`                     | Service Worker — cache del shell, estrategias por tipo de recurso, Background Sync.     |
| `app.js`                    | Registra el SW, envuelve `fetch` con tokens/refresh, muestra banner offline.            |
| `outbox.js`                 | Capa IndexedDB: cola de cambios locales (`outbox`), caché de lecturas, helpers de sync. |
| `offline.html`              | Pantalla de fallback cuando no hay red ni caché del recurso.                            |
| `icons/`                    | PNG 192 y 512 (reemplazables por el logo definitivo).                                   |

## Estrategias del Service Worker

- **App shell (HTML/JS/CSS propios)** → *Cache First* con precarga en `install`.
- **Recursos CDN (Tailwind, Chart)** → *Stale While Revalidate*.
- **`GET /api/...`** → *Network First* con fallback al caché.
- **`POST/PUT/DELETE /api/...`** → si falla la red, `Outbox.enqueue()` lo persiste en IndexedDB y
  `Background Sync` (tag `agrocore-sync-outbox`) lo drena cuando vuelve la conexión.

## Flujo de sincronización

1. Después del login, `app.js` llama `Outbox.ensureSyncClient(token)` → registra un `SyncClientId` único por dispositivo.
2. Cada mutación mientras se está offline se guarda en `outbox` con un `SyncUuid` local.
3. Al volver online (evento `online` o `periodicsync`), el SW llama `POST /api/sync/push` con la cola.
4. El servidor aplica los cambios idempotentemente (clave: `SyncClientId + Entidad + SyncUuid`) y responde con resultados.
5. A continuación el cliente llama `GET /api/sync/pull?clientId=...&cursor=...` para bajar los deltas del servidor.
6. El cursor (UpdatedAt máximo codificado en base64) se guarda en IndexedDB (`meta.syncCursor`).

## Entidades soportadas en PUSH

- `MovimientoCaja`
- `MovimientoGrano`

Ampliable en `Infrastructure/Sync/SyncService.ApplyAsync`.

## Desarrollo

- Servir la carpeta estática del front por HTTPS (requisito de Service Worker).
- Configurar CORS en la API para permitir el origen del front con `AllowCredentials`.
- El backend ya expone los headers `X-RowVersion`, `X-Sync-Cursor`, `X-Total-Count`.

## Modo Campo

La UI tiene un "Modo Campo" con botones grandes y atajos del manifest para:
- Crear una Orden de Trabajo rápida
- Registrar la ejecución (aplicación real) de una OT
- Ver stock de silos

Todos estos formularios funcionan **sin conexión** porque los endpoints sólo generan mutaciones que pasan por `Outbox`.
