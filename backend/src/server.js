// AgroCore API - servidor Express todo-en-uno (Fase 3 consolidada).
// Un solo archivo con auth, middleware, todas las rutas y error handler.
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z, ZodError } from 'zod';
import { PrismaClient } from '@prisma/client';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import XLSX from 'xlsx';
// pdf-parse: dependencia OPCIONAL. Si no está instalada o falla la carga, el
// servidor arranca igual y el endpoint /api/admin/parse-factura-pdf devuelve 501.
// Esto evita que un problema con esa lib tire toda la API.
let _pdfParse = null;
let _pdfParseTried = false;
let _pdfParseErr = null;
async function getPdfParse() {
  if (_pdfParse) return _pdfParse;
  if (_pdfParseTried) throw _pdfParseErr || new Error('pdf-parse no disponible');
  _pdfParseTried = true;
  try {
    const mod = await import('pdf-parse/lib/pdf-parse.js');
    _pdfParse = mod.default || mod;
    return _pdfParse;
  } catch (e) {
    _pdfParseErr = new Error('pdf-parse no instalado o falló la carga: ' + e.message);
    throw _pdfParseErr;
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = process.env.STATIC_DIR || path.resolve(__dirname, '..', '..');

// Prisma con pool más grande para soportar varios usuarios concurrentes sin timeouts.
// Por defecto Prisma usa connection_limit=num_physical_cpus*2+1 (3 en máquinas chicas).
// Lo subimos a 10 + pool_timeout 30s. Solo inyectamos los params si no están ya en la URL.
function _buildDatabaseUrl() {
  const base = process.env.DATABASE_URL || '';
  if (!base) return base;
  if (/connection_limit=/.test(base)) return base; // respetar lo que pusiste en .env
  const sep = base.includes('?') ? '&' : '?';
  return base + sep + 'connection_limit=10&pool_timeout=30';
}
const prisma = new PrismaClient({
  datasources: { db: { url: _buildDatabaseUrl() } },
});
const app = express();

// Multer en memoria — para uploads chicos (Excel < 10MB, PDFs de factura, etc).
// Se declara ACÁ ARRIBA porque varios endpoints lo usan al levantarse y JavaScript
// no permite usar una const antes de su inicialización (TDZ).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Versión actual del sistema. Se incrementa con cada release.
// Endpoint /api/system/version la expone para que el frontend la muestre
// y para que el script Update-AgroCore.ps1 compare antes de pullear.
const AGROCORE_VERSION = '2.70.0';
const AGROCORE_BUILD = new Date('2026-07-27').toISOString().slice(0, 10);

// ============================================================
// CONFIG
// ============================================================
const PORT = Number(process.env.PORT) || 3100;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '10mb' }));

// Servir el HTML del frontend desde el mismo dominio (C:\AgroCore\AgroCore-web.html)
// accesible como GET /app. Al vivir todo bajo la misma URL, se elimina CORS y se
// puede exponer a internet con un único túnel de Cloudflare.
app.get('/app', (_req, res) => { res.set('X-Robots-Tag', 'noindex, nofollow'); res.sendFile(path.join(STATIC_DIR, 'AgroCore-web.html')); });
app.use('/assets', express.static(path.join(STATIC_DIR, 'assets'), { fallthrough: true }));

// Las instancias de clientes (bocco., peiretti., llsp., gerardo., npi., demo, etc.) son
// PRIVADAS: no deben indexarse en buscadores. Bloqueamos todo el crawling (robots.txt)
// y marcamos noindex por header en cualquier respuesta.
app.get('/robots.txt', (_req, res) => {
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send('User-agent: *\nDisallow: /\n');
});
app.use((_req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow'); next(); });

// PWA: service worker y manifest (para que el app funcione offline).
// El SW se sirve desde la raíz para tener scope sobre todo el sitio.
app.get('/sw.js', (_req, res) => {
  res.set('Content-Type', 'application/javascript; charset=utf-8');
  res.set('Service-Worker-Allowed', '/');
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(STATIC_DIR, 'sw.js'));
});
app.get('/manifest.webmanifest', (_req, res) => {
  res.set('Content-Type', 'application/manifest+json; charset=utf-8');
  res.sendFile(path.join(STATIC_DIR, 'manifest.webmanifest'));
});
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()}  ${req.method} ${req.path}`);
  next();
});

// ============================================================
// PERMISOS
// ============================================================
function hasPermission(perms, required) {
  if (!Array.isArray(perms)) return false;
  if (perms.includes('*:*') || perms.includes('*')) return true;
  if (perms.includes(required)) return true;
  const [mod] = required.split(':');
  return perms.includes(`${mod}:*`);
}

function requirePermission(perm) {
  return (req, res, next) => {
    if (req.user?.superAdmin) return next();
    const perms = req.membership?.role?.permissions || [];
    if (!hasPermission(perms, perm)) {
      return res.status(403).json({ ok: false, error: 'Permiso denegado', required: perm });
    }
    next();
  };
}

// Categorías de producto que el rol activo puede VER en Stock. Devuelve null cuando
// no hay restricción (superAdmin o el rol no configuró categorías = ve todas).
function stockCatsPermitidas(req) {
  if (req.user?.superAdmin) return null;
  const cats = req.membership?.role?.stockCategorias;
  if (!Array.isArray(cats) || !cats.length) return null;
  return new Set(cats.map(c => String(c).toLowerCase()));
}

// ============================================================
// MIDDLEWARE DE AUTH
// ============================================================
async function authMiddleware(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const [scheme, token] = auth.split(' ');
    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ ok: false, error: 'Falta token (Authorization: Bearer ...)' });
    }
    let payload;
    try { payload = jwt.verify(token, JWT_SECRET); }
    catch { return res.status(401).json({ ok: false, error: 'Token invalido o expirado' }); }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { userCompanies: { include: { role: true, company: true } } },
    });
    if (!user || !user.activo) {
      return res.status(401).json({ ok: false, error: 'Usuario no encontrado o inactivo' });
    }
    req.user = user;
    const companyId = req.headers['x-company-id'];
    if (companyId) {
      const m = user.userCompanies.find((uc) => uc.companyId === companyId);
      if (!m && !user.superAdmin) {
        return res.status(403).json({ ok: false, error: 'Sin acceso a esta empresa' });
      }
      req.companyId = companyId;
      req.membership = m || null;
    }
    next();
  } catch (err) { next(err); }
}

function requireCompany(req, res, next) {
  if (!req.companyId) return res.status(400).json({ ok: false, error: 'Falta header X-Company-Id' });
  next();
}

// ============================================================
// HEALTH (publico)
// ============================================================
app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, service: 'agrocore-api', version: '0.1.0', db: 'up', time: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, db: 'down', error: err.message });
  }
});

// Devuelve las IPs de red local para mostrar en la UI y poder compartir el acceso LAN.
function getLanIps() {
  const ifs = os.networkInterfaces();
  const out = [];
  for (const [name, addrs] of Object.entries(ifs)) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ iface: name, address: a.address });
    }
  }
  return out;
}
// ============================================================
// Cotizaciones en vivo
// - Dólar: dolarapi.com (oficial, blue, mep, ccl, cripto, tarjeta)
// - Cereales: scraping de BCR Rosario (precios de cámara arbitral)
// Cache de 10 min para dólar, 30 min para cereales.
// ============================================================
const _cotCache = { dolar: null, dolarTime: 0, cereales: null, cerealesTime: 0 };
const COT_TTL_DOLAR = 10 * 60 * 1000;        // 10 min
const COT_TTL_CER   = 6 * 60 * 60 * 1000;    // 6 hs (BCR publica una vez al día, chequeamos 4 veces)

async function fetchWithTimeout(url, ms = 6000, opts = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ac.signal });
    return r;
  } finally { clearTimeout(t); }
}

async function fetchDolar() {
  try {
    const r = await fetchWithTimeout('https://dolarapi.com/v1/dolares', 5000);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const arr = await r.json();
    return Object.fromEntries(arr.map(d => [d.casa, { compra: d.compra, venta: d.venta, fecha: d.fechaActualizacion }]));
  } catch (e) {
    console.warn('[cotizaciones] dólar falló:', e.message);
    return null;
  }
}

// Valores de referencia (última cotización conocida). Se usan sólo si todas las fuentes
// externas fallan, para que el banner nunca quede vacío. Se actualizan manualmente acá
// cuando cambian mucho. En pesos por tonelada.
const CEREALES_REFERENCIA = {
  soja:    385000,
  maiz:    195000,
  trigo:   220000,
  sorgo:   170000,
  girasol: 310000,
};

// Scraping de la tabla de precios de la Cámara Arbitral de Cereales de Rosario.
// Intenta varias fuentes en orden; si todas fallan, devuelve valores de referencia.
async function fetchCereales() {
  // Intento 1: API no oficial de ArgentinaDatos (más estable que scraping HTML directo).
  try {
    const r = await fetchWithTimeout('https://api.argentinadatos.com/v1/finanzas/granos/', 5000);
    if (r.ok) {
      const data = await r.json();
      if (Array.isArray(data) && data.length) {
        const ult = data[data.length - 1]; // más reciente
        const cer = {};
        ['soja','maiz','trigo','sorgo','girasol','cebada','centeno','avena'].forEach(k => {
          if (ult[k] != null) cer[k] = Number(ult[k]);
        });
        if (Object.keys(cer).length) return { fuente: 'ArgentinaDatos', fecha: ult.fecha || null, items: cer };
      }
    }
  } catch (e) { console.warn('[cotizaciones] ArgentinaDatos granos falló:', e.message); }

  // Intento 2: scraping de la página BCR Mercado Físico.
  try {
    const r = await fetchWithTimeout('https://www.bcr.com.ar/es/mercados/mercado-fisico', 8000, {
      headers: { 'User-Agent': 'Mozilla/5.0 AgroCore/0.2' }
    });
    if (r.ok) {
      const html = await r.text();
      const cer = {};
      const lookup = {
        'soja':    /Soja[\s\S]{0,200}?\$\s*([\d.]+),\d{2}/i,
        'maiz':    /Ma[ií]z[\s\S]{0,200}?\$\s*([\d.]+),\d{2}/i,
        'trigo':   /Trigo[\s\S]{0,200}?\$\s*([\d.]+),\d{2}/i,
        'sorgo':   /Sorgo[\s\S]{0,200}?\$\s*([\d.]+),\d{2}/i,
        'girasol': /Girasol[\s\S]{0,200}?\$\s*([\d.]+),\d{2}/i,
      };
      for (const [k, re] of Object.entries(lookup)) {
        const m = html.match(re);
        if (m) cer[k] = Number(m[1].replace(/\./g, ''));
      }
      if (Object.keys(cer).length) return { fuente: 'BCR Rosario', fecha: null, items: cer };
    }
  } catch (e) { console.warn('[cotizaciones] BCR mercado-fisico falló:', e.message); }

  // Intento 3: Cámara Arbitral de Cereales (página oficial de cotizaciones).
  try {
    const r = await fetchWithTimeout('https://www.cac.bcr.com.ar/es/precios-de-pizarra', 8000, {
      headers: { 'User-Agent': 'Mozilla/5.0 AgroCore/0.2' }
    });
    if (r.ok) {
      const html = await r.text();
      const cer = {};
      const lookup = {
        'soja':    /Soja[\s\S]{0,300}?([\d.]{5,9}),\d{2}/i,
        'maiz':    /Ma[ií]z[\s\S]{0,300}?([\d.]{5,9}),\d{2}/i,
        'trigo':   /Trigo[\s\S]{0,300}?([\d.]{5,9}),\d{2}/i,
        'sorgo':   /Sorgo[\s\S]{0,300}?([\d.]{5,9}),\d{2}/i,
        'girasol': /Girasol[\s\S]{0,300}?([\d.]{5,9}),\d{2}/i,
      };
      for (const [k, re] of Object.entries(lookup)) {
        const m = html.match(re);
        if (m) cer[k] = Number(m[1].replace(/\./g, ''));
      }
      if (Object.keys(cer).length) return { fuente: 'Cámara Arbitral BCR', fecha: null, items: cer };
    }
  } catch (e) { console.warn('[cotizaciones] CAC Rosario falló:', e.message); }

  // Último recurso: valores de referencia hardcodeados. Se marcan como tal para que
  // el usuario entienda que no son en vivo, pero al menos el banner no queda vacío.
  console.warn('[cotizaciones] Todas las fuentes fallaron, usando valores de referencia.');
  return { fuente: 'Referencia', fecha: null, items: { ...CEREALES_REFERENCIA } };
}

// ===== MULTIMONEDA: monedas soportadas y cotizaciones históricas =====
// valor de cada cotización = ARS por 1 unidad. ARS es la base (=1).
const MONEDAS = [
  { clave:'ARS',     label:'Pesos (ARS)',    simbolo:'$',   tipo:'fiat',  unidad:'$'  },
  { clave:'USD',          label:'Dólar oficial',   simbolo:'US$', tipo:'fiat',  unidad:'US$'},
  { clave:'USD_MAYORISTA',label:'Dólar divisa (mayorista)', simbolo:'US$', tipo:'fiat', unidad:'US$'},
  { clave:'USD_MEP',      label:'Dólar MEP',       simbolo:'US$', tipo:'fiat',  unidad:'US$'},
  { clave:'USD_BLUE',     label:'Dólar blue',      simbolo:'US$', tipo:'fiat',  unidad:'US$'},
  { clave:'EUR',     label:'Euro',           simbolo:'€',   tipo:'fiat',  unidad:'€'  },
  { clave:'SOJA',    label:'Soja',           simbolo:'tn',  tipo:'grano', unidad:'tn' },
  { clave:'MAIZ',    label:'Maíz',           simbolo:'tn',  tipo:'grano', unidad:'tn' },
  { clave:'TRIGO',   label:'Trigo',          simbolo:'tn',  tipo:'grano', unidad:'tn' },
  { clave:'SORGO',   label:'Sorgo',          simbolo:'tn',  tipo:'grano', unidad:'tn' },
  { clave:'GIRASOL', label:'Girasol',        simbolo:'tn',  tipo:'grano', unidad:'tn' },
  { clave:'KGN',     label:'Kg Novillo (Cañuelas)', simbolo:'kg', tipo:'hacienda', unidad:'kg' },
];
function _hoy0() { const d = new Date(); d.setHours(0,0,0,0); return d; }
// Guarda el valor de hoy para cada moneda (global, companyId=null). Idempotente por día.
// Normaliza el nombre de un grano a la clave de cotización (SOJA, MAIZ, ...).
// El arrendamiento guarda el NOMBRE del cereal ("Soja", "Maíz") pero las
// cotizaciones se guardan por clave en mayúsculas y sin acentos.
function _claveGrano(g) {
  return String(g || '').trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
async function snapshotCotizaciones(dolar, cereales) {
  const fecha = _hoy0();
  const filas = [];
  const dv = (c) => (dolar && dolar[c]) ? Number(dolar[c].venta || dolar[c].compra || 0) : 0;
  if (dv('oficial'))         filas.push({ moneda:'USD',           valor:dv('oficial'),    fuente:'dolarapi' });
  if (dv('mayorista'))       filas.push({ moneda:'USD_MAYORISTA', valor:dv('mayorista'),  fuente:'dolarapi' });
  if (dv('mep'))             filas.push({ moneda:'USD_MEP',       valor:dv('mep'),        fuente:'dolarapi' });
  if (dv('blue'))            filas.push({ moneda:'USD_BLUE',      valor:dv('blue'),       fuente:'dolarapi' });
  const it = (cereales && cereales.items) || {};
  const cer = (k) => Number(it[k] || 0);
  [['soja','SOJA'],['maiz','MAIZ'],['trigo','TRIGO'],['sorgo','SORGO'],['girasol','GIRASOL']].forEach(([k,m])=>{
    if (cer(k)) filas.push({ moneda:m, valor:cer(k), fuente:(cereales && cereales.fuente) || 'BCR' });
  });
  // Monedas propias del catálogo con fuente automática reconocida (dólar o grano).
  try {
    const customMon = await prisma.catalogo.findMany({ where: { tipo: 'Moneda', activo: true } });
    const yaPuestas = new Set(filas.map(f => f.moneda));
    for (const c of customMon) {
      const clave = (c.codigo || c.nombre || '').trim();
      const fuente = (c.descripcion || '').toLowerCase().trim();
      if (!clave || yaPuestas.has(clave) || !fuente || fuente === 'manual') continue;
      let val = 0;
      if (dolar && dolar[fuente]) val = Number(dolar[fuente].venta || dolar[fuente].compra || 0);
      else if (it[fuente]) val = Number(it[fuente] || 0);
      if (val) { filas.push({ moneda: clave, valor: val, fuente }); yaPuestas.add(clave); }
    }
  } catch (e) { /* ignore */ }
  for (const f of filas) {
    try {
      // Upsert manual: Prisma no admite null en el where de la unique compuesta.
      const ex = await prisma.cotizacion.findFirst({ where: { companyId: null, moneda: f.moneda, fecha } });
      if (ex) await prisma.cotizacion.update({ where: { id: ex.id }, data: { valor: f.valor, fuente: f.fuente } });
      else await prisma.cotizacion.create({ data: { companyId: null, moneda: f.moneda, fecha, valor: f.valor, fuente: f.fuente } });
    } catch (e) { /* ignore */ }
  }
}
// Mapa de cotizaciones EN VIVO (cache del scraping de dólar/pizarras). Sirve como
// respaldo cuando la tabla Cotizacion todavía no tiene la fila persistida.
function _liveCotizMap() {
  const m = {};
  try {
    const d = _cotCache.dolar || {}, c = (_cotCache.cereales && _cotCache.cereales.items) || {};
    const set = (k, v) => { if (v != null && Number(v) > 0) m[k] = Number(v); };
    set('USD', d.oficial?.venta); set('USD_MAYORISTA', d.mayorista?.venta); set('USD_MEP', d.mep?.venta); set('USD_BLUE', d.blue?.venta); set('EUR', d.euro?.venta);
    set('SOJA', c.soja); set('MAIZ', c.maiz); set('TRIGO', c.trigo); set('SORGO', c.sorgo); set('GIRASOL', c.girasol);
  } catch (e) { /* ignore */ }
  return m;
}
// Devuelve ARS por 1 unidad de `moneda` a la `fecha` (la más reciente <= fecha).
// ARS -> 1. Si no hay dato, intenta el cache vivo; si no, null.
async function getCotizacionARS(moneda, fecha, companyId) {
  if (!moneda || moneda === 'ARS') return 1;
  const f = fecha ? new Date(fecha) : new Date();
  const row = await prisma.cotizacion.findFirst({
    where: { moneda, companyId: null, fecha: { lte: f } },
    orderBy: [{ fecha: 'desc' }],
  });
  if (row) return row.valor;
  // fallback al cache vivo
  const d = _cotCache.dolar, c = _cotCache.cereales;
  const map = { USD:d?.oficial?.venta, USD_MEP:d?.mep?.venta, USD_BLUE:d?.blue?.venta,
    SOJA:c?.items?.soja, MAIZ:c?.items?.maiz, TRIGO:c?.items?.trigo, SORGO:c?.items?.sorgo, GIRASOL:c?.items?.girasol };
  return map[moneda] ? Number(map[moneda]) : null;
}

// Texto corto de un importe en su moneda, ej: "US$ 10.000" / "50 tn (SOJA)" / "$ 1.000".
function fmtMonedaTxt(moneda, valor) {
  const n = Number(valor || 0);
  const m = MONEDAS.find(x => x.clave === moneda);
  if (!moneda || moneda === 'ARS') return `$ ${n.toLocaleString('es-AR')}`;
  if (m && m.tipo === 'grano') return `${n.toLocaleString('es-AR')} tn (${moneda})`;
  const sim = m ? m.simbolo : moneda;
  return `${sim} ${n.toLocaleString('es-AR')}`;
}

// Fuente de cotización automática de cada moneda predefinida (clave de dolarapi o de granos).
const MONEDA_FUENTE_BUILTIN = {
  USD:'oficial', USD_MAYORISTA:'mayorista', USD_MEP:'mep', USD_BLUE:'blue', EUR:'euro',
  SOJA:'soja', MAIZ:'maiz', TRIGO:'trigo', SORGO:'sorgo', GIRASOL:'girasol',
  KGN:'manual',
};
// Lista de monedas: predefinidas (MONEDAS) + propias del catálogo (tipo='Moneda'),
// cada una con su última cotización conocida (para sugerir en formularios).
app.get('/api/monedas', authMiddleware, async (req, res, next) => {
  try {
    const custom = req.companyId ? await prisma.catalogo.findMany({ where: { companyId: req.companyId, tipo: 'Moneda', activo: true } }) : [];
    const customM = custom.map(c => {
      const esGrano = (c.tipoPrecio === 'grano');
      return { clave: (c.codigo || c.nombre || '').trim(), label: c.nombre, tipo: esGrano ? 'grano' : 'fiat',
        simbolo: esGrano ? 'tn' : (c.precioReferencia ? String(c.precioReferencia) : '$'),
        unidad: esGrano ? 'tn' : '', fuente: (c.descripcion || 'manual').trim(), custom: true, id: c.id };
    }).filter(m => m.clave);
    const builtIn = MONEDAS.map(m => ({ ...m, fuente: MONEDA_FUENTE_BUILTIN[m.clave] || 'manual', custom: false }));
    const all = [...builtIn, ...customM.filter(cm => !builtIn.some(m => m.clave === cm.clave))];
    const claves = all.map(m => m.clave).filter(k => k && k !== 'ARS');
    const cots = await prisma.cotizacion.findMany({ where: { companyId: null, moneda: { in: claves } }, orderBy: { fecha: 'desc' } });
    const ultima = {}; cots.forEach(c => { if (ultima[c.moneda] == null) ultima[c.moneda] = c.valor; });
    all.forEach(m => { m.ultima = m.clave === 'ARS' ? 1 : (ultima[m.clave] ?? null); });
    res.json({ ok: true, data: all });
  } catch (e) { next(e); }
});

// Histórico de cotizaciones (carga manual / edición). Global por defecto.
app.get('/api/cotizaciones-historico', authMiddleware, async (req, res, next) => {
  try {
    const where = { companyId: null };  // cotizaciones de mercado (globales)
    if (req.query.moneda) where.moneda = String(req.query.moneda);
    if (req.query.desde || req.query.hasta) {
      where.fecha = {};
      if (req.query.desde) where.fecha.gte = new Date(req.query.desde);
      if (req.query.hasta) where.fecha.lte = new Date(req.query.hasta);
    }
    const data = await prisma.cotizacion.findMany({ where, orderBy: [{ fecha: 'desc' }, { moneda: 'asc' }], take: 500 });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});
app.post('/api/cotizaciones-historico', authMiddleware, requirePermission('finanzas:create'), async (req, res, next) => {
  try {
    const d = z.object({ moneda: z.string().min(1), fecha: z.coerce.date(), valor: z.number().positive() }).parse(req.body);
    const fecha = new Date(d.fecha); fecha.setHours(0,0,0,0);
    // Prisma no permite null en el where de una unique compuesta, así que hacemos
    // el upsert a mano (las cotizaciones de mercado son globales: companyId = null).
    const existing = await prisma.cotizacion.findFirst({ where: { companyId: null, moneda: d.moneda, fecha } });
    const row = existing
      ? await prisma.cotizacion.update({ where: { id: existing.id }, data: { valor: d.valor, fuente: 'manual' } })
      : await prisma.cotizacion.create({ data: { companyId: null, moneda: d.moneda, fecha, valor: d.valor, fuente: 'manual' } });
    res.json({ ok: true, data: row });
  } catch (e) { next(e); }
});
app.delete('/api/cotizaciones-historico/:id', authMiddleware, requirePermission('finanzas:delete'), async (req, res, next) => {
  try { await prisma.cotizacion.deleteMany({ where: { id: req.params.id } }); res.json({ ok: true }); }
  catch (e) { next(e); }
});

app.get('/api/cotizaciones', async (_req, res) => {
  const now = Date.now();
  let dolar = _cotCache.dolar;
  if (!dolar || (now - _cotCache.dolarTime) > COT_TTL_DOLAR) {
    const d = await fetchDolar();
    if (d) { _cotCache.dolar = d; _cotCache.dolarTime = now; dolar = d; }
    else if (!dolar) dolar = null;
  }
  let cereales = _cotCache.cereales;
  if (!cereales || (now - _cotCache.cerealesTime) > COT_TTL_CER) {
    const c = await fetchCereales();
    if (c) { _cotCache.cereales = c; _cotCache.cerealesTime = now; cereales = c; }
  }
  // Guardamos un snapshot diario para tener historia (no bloquea la respuesta).
  snapshotCotizaciones(dolar, cereales).catch(()=>{});
  res.json({
    ok: true,
    dolar,
    cereales,
    actualizado: {
      dolar: _cotCache.dolarTime ? new Date(_cotCache.dolarTime).toISOString() : null,
      cereales: _cotCache.cerealesTime ? new Date(_cotCache.cerealesTime).toISOString() : null,
    },
  });
});

// Histórico de cotizaciones de mercado (PÚBLICO) — para gráficos de tendencia en la web.
// Devuelve las últimas N jornadas guardadas (snapshot diario, companyId=null) por moneda.
app.get('/api/cotizaciones/historico', async (req, res) => {
  try {
    const monedas = req.query.moneda
      ? String(req.query.moneda).split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
      : ['SOJA','MAIZ','TRIGO','SORGO','GIRASOL','USD','USD_BLUE'];
    const dias = Math.min(Math.max(Number(req.query.dias) || 60, 7), 180);
    const desde = new Date(); desde.setDate(desde.getDate() - dias); desde.setHours(0,0,0,0);
    const rows = await prisma.cotizacion.findMany({
      where: { companyId: null, moneda: { in: monedas }, fecha: { gte: desde } },
      orderBy: { fecha: 'asc' }, select: { moneda: true, fecha: true, valor: true },
    });
    const series = {};
    for (const r of rows) { (series[r.moneda] = series[r.moneda] || []).push({ fecha: r.fecha, valor: r.valor }); }
    res.json({ ok: true, series });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ============================================================
// NOTICIAS DEL AGRO (RSS de medios argentinos)
// Fuentes:
//   - Infocampo        https://www.infocampo.com.ar/feed/
//   - Valor Soja       https://valorsoja.com/feed/
//   - Bichos de Campo  https://bichosdecampo.com/feed/
//   - Agritotal        https://agritotal.com/rss/
// Cache: 30 minutos. Auto-refresh cada 30 minutos.
// ============================================================
const FUENTES_NOTICIAS = [
  { nombre: 'Infocampo',       url: 'https://www.infocampo.com.ar/feed/',     max: 5 },
  { nombre: 'Valor Soja',      url: 'https://valorsoja.com/feed/',            max: 5 },
  { nombre: 'Bichos de Campo', url: 'https://bichosdecampo.com/feed/',        max: 5 },
  { nombre: 'Agritotal',       url: 'https://agritotal.com/rss/',             max: 5 },
];
const NOT_TTL = 30 * 60 * 1000; // 30 min
const _notCache = { items: null, time: 0 };

// Parser RSS minimalista (sin dependencias). RSS 2.0 estándar.
function parseRSS(xml, fuente, max = 5) {
  const out = [];
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null && out.length < max) {
    const it = m[1];
    const tag = (t) => {
      const re = new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`, 'i');
      const r = it.match(re);
      if (!r) return '';
      let v = r[1].trim();
      // Quitar CDATA si existe
      v = v.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/m, '$1').trim();
      return v;
    };
    const title = tag('title');
    let link = tag('link');
    // Algunos feeds ponen el link como atributo href en vez de contenido (Atom).
    if (!link) {
      const lm = it.match(/<link[^>]*href=["']([^"']+)["']/i);
      if (lm) link = lm[1];
    }
    const pubDate = tag('pubDate') || tag('dc:date') || tag('updated');
    let desc = tag('description') || tag('summary') || tag('content:encoded') || '';
    desc = desc.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
               .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
               .replace(/\s+/g, ' ').trim();
    if (desc.length > 220) desc = desc.slice(0, 220).replace(/\s+\S*$/, '') + '…';
    if (title && link) {
      out.push({
        fuente,
        titulo: title.replace(/&amp;/g, '&').replace(/&#8217;/g, "'").replace(/&#8220;/g, '"').replace(/&#8221;/g, '"'),
        link: link.trim(),
        fecha: pubDate ? new Date(pubDate).toISOString() : null,
        resumen: desc,
      });
    }
  }
  return out;
}

async function fetchNoticias() {
  const promesas = FUENTES_NOTICIAS.map(async (f) => {
    try {
      const r = await fetchWithTimeout(f.url, 6000, {
        headers: { 'User-Agent': 'Mozilla/5.0 AgroCore/0.3 (RSS reader)' },
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const xml = await r.text();
      return parseRSS(xml, f.nombre, f.max);
    } catch (e) {
      console.warn(`[noticias] ${f.nombre} falló:`, e.message);
      return [];
    }
  });
  const arrays = await Promise.all(promesas);
  let items = arrays.flat();
  // Ordenar por fecha desc primero (asi al deduplicar nos quedamos con la mas nueva).
  items.sort((a, b) => {
    if (!a.fecha && !b.fecha) return 0;
    if (!a.fecha) return 1;
    if (!b.fecha) return -1;
    return new Date(b.fecha) - new Date(a.fecha);
  });
  // Deduplicar: misma noticia puede aparecer en varios medios (republicaciones)
  // o en el mismo feed dos veces. Dedup por link normalizado y por titulo normalizado.
  const norm = (s) => (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')      // quitar acentos
    .replace(/[^a-z0-9 ]/g, '')                            // quitar puntuacion
    .replace(/\s+/g, ' ').trim();
  const normUrl = (u) => (u || '').replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase();
  const vistosLink = new Set();
  const vistosTit = new Set();
  items = items.filter(it => {
    const lk = normUrl(it.link);
    const tt = norm(it.titulo);
    if (lk && vistosLink.has(lk)) return false;
    if (tt && vistosTit.has(tt))  return false;
    if (lk) vistosLink.add(lk);
    if (tt) vistosTit.add(tt);
    return true;
  });
  return items.slice(0, 10); // top 10 unicas mas recientes
}

app.get('/api/noticias-agro', async (_req, res) => {
  const now = Date.now();
  if (!_notCache.items || (now - _notCache.time) > NOT_TTL) {
    const items = await fetchNoticias();
    if (items.length) { _notCache.items = items; _notCache.time = now; }
  }
  res.json({
    ok: true,
    items: _notCache.items || [],
    actualizado: _notCache.time ? new Date(_notCache.time).toISOString() : null,
    fuentes: FUENTES_NOTICIAS.map(f => ({ nombre: f.nombre, url: f.url })),
  });
});

app.get('/api/network-info', (_req, res) => {
  const ips = getLanIps();
  const port = Number(process.env.PORT) || 3100;
  res.json({
    ok: true,
    port,
    ips: ips.map(i => ({ ...i, url: `http://${i.address}:${port}/app` })),
    local: `http://127.0.0.1:${port}/app`,
    hostname: os.hostname(),
  });
});

// ============================================================
// AUTH: login, me, change-password
// ============================================================
// login acepta nombre, email o alias en el campo `login` (o `email` para compat.)
const loginSchema = z.object({
  login: z.string().min(1).optional(),
  email: z.string().min(1).optional(),
  password: z.string().min(1),
}).refine(d => d.login || d.email, { message: 'Falta usuario' });

async function serializeUser(u) {
  // Empresas donde el usuario tiene una membresía explícita.
  const _coFiscal = (co) => ({
    razonSocial: co.razonSocial || null, cuit: co.cuit || null,
    domicilio: co.domicilio || null, localidad: co.localidad || null,
    provincia: co.provincia || null, condIVA: co.condIVA || null,
    email: co.email || null, telefono: co.telefono || null,
  });
  const companies = u.userCompanies.map((uc) => ({
    id: uc.company.id, name: uc.company.name,
    color: uc.company.color || null,
    logoUrl: uc.company.logoUrl || null,
    ..._coFiscal(uc.company),
    roleLabel: uc.role.label,
    role: { key: uc.role.key, label: uc.role.label, permissions: uc.role.permissions, stockCategorias: uc.role.stockCategorias || null },
  }));

  // Super Admin: además ve TODAS las empresas activas del sistema, con permisos
  // totales (rol sintético '*:*'). Así el selector de empresas nunca queda vacío.
  if (u.superAdmin) {
    const todas = await prisma.company.findMany({
      where: { activo: true }, orderBy: { name: 'asc' },
    });
    const yaIncluidas = new Set(companies.map((c) => c.id));
    const superRole = { key: 'super', label: 'Super Admin', permissions: ['*:*'] };
    for (const co of todas) {
      if (yaIncluidas.has(co.id)) continue;
      companies.push({
        id: co.id, name: co.name,
        color: co.color || null, logoUrl: co.logoUrl || null,
        ..._coFiscal(co),
        roleLabel: 'Super Admin',
        role: superRole,
      });
    }
  }

  return {
    id: u.id, email: u.email, alias: u.alias || null,
    nombre: u.nombre, apellido: u.apellido,
    fotoUrl: u.fotoUrl || null,
    superAdmin: u.superAdmin,
    oculto: u.oculto || false,
    empleadoId: u.empleadoId || null,
    choferId: u.choferId || null,
    companies,
    memberships: u.userCompanies.map((uc) => ({
      companyId: uc.companyId, companyName: uc.company.name,
      roleId: uc.roleId, roleKey: uc.role.key, roleLabel: uc.role.label,
    })),
  };
}

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const parsed = loginSchema.parse(req.body);
    const query = (parsed.login || parsed.email || '').trim();
    const password = parsed.password;
    if (!query) return res.status(400).json({ ok: false, error: 'Falta usuario' });

    let user = null;
    if (query.includes('@')) {
      // Parece email, busca por email exacto
      user = await prisma.user.findUnique({
        where: { email: query.toLowerCase() },
        include: { userCompanies: { include: { company: true, role: true } } },
      });
    }
    if (!user) {
      // Busca por alias (case-insensitive), nombre (case-insensitive) o email exacto
      const lower = query.toLowerCase();
      const candidates = await prisma.user.findMany({
        where: {
          OR: [
            { email: lower },
            { alias: { equals: query, mode: 'insensitive' } },
            { nombre: { equals: query, mode: 'insensitive' } },
          ],
        },
        include: { userCompanies: { include: { company: true, role: true } } },
      });
      if (candidates.length === 0) {
        // Último intento: "Nombre Apellido"
        const parts = query.split(/\s+/);
        if (parts.length >= 2) {
          const cands2 = await prisma.user.findMany({
            where: {
              AND: [
                { nombre: { equals: parts[0], mode: 'insensitive' } },
                { apellido: { equals: parts.slice(1).join(' '), mode: 'insensitive' } },
              ],
            },
            include: { userCompanies: { include: { company: true, role: true } } },
          });
          if (cands2.length === 1) user = cands2[0];
          else if (cands2.length > 1) return res.status(401).json({ ok: false, error: 'Hay varios usuarios con ese nombre; usa el email' });
        }
      } else if (candidates.length === 1) {
        user = candidates[0];
      } else {
        return res.status(401).json({ ok: false, error: 'Hay varios usuarios con ese nombre; usa el email' });
      }
    }
    if (!user || !user.activo) return res.status(401).json({ ok: false, error: 'Credenciales invalidas' });
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ ok: false, error: 'Credenciales invalidas' });
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ ok: true, token, user: await serializeUser(user) });
  } catch (e) { next(e); }
});

app.get('/api/auth/me', authMiddleware, async (req, res, next) => {
  try {
    res.json({ ok: true, user: await serializeUser(req.user) });
  } catch (e) { next(e); }
});

app.post('/api/auth/change-password', authMiddleware, async (req, res, next) => {
  try {
    const schema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(1) });
    const { currentPassword, newPassword } = schema.parse(req.body);
    const ok = await bcrypt.compare(currentPassword, req.user.passwordHash);
    if (!ok) return res.status(401).json({ ok: false, error: 'Contrasena actual incorrecta' });
    const hash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: req.user.id }, data: { passwordHash: hash } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ============================================================
// Preferencias del usuario actual (shortcuts del Inicio, etc.)
// ============================================================
app.get('/api/me/preferences', authMiddleware, async (req, res, next) => {
  try {
    const pref = await prisma.userPreference.findUnique({ where: { userId: req.user.id } });
    res.json({ ok: true, data: pref || { shortcuts: [], extras: null } });
  } catch (e) { next(e); }
});

app.put('/api/me/preferences', authMiddleware, async (req, res, next) => {
  try {
    const schema = z.object({
      shortcuts: z.array(z.string()).optional(),
      extras: z.any().optional(),
    });
    const d = schema.parse(req.body || {});
    const data = {};
    if (d.shortcuts !== undefined) data.shortcuts = d.shortcuts;
    if (d.extras !== undefined)    data.extras = d.extras;
    const row = await prisma.userPreference.upsert({
      where: { userId: req.user.id },
      create: { userId: req.user.id, shortcuts: d.shortcuts || [], extras: d.extras ?? null },
      update: data,
    });
    res.json({ ok: true, data: row });
  } catch (e) { next(e); }
});

// Permite que un usuario active/desactive el flag "oculto" sobre SI MISMO.
// Solo el propio user puede hacerlo, no se puede toggleear este flag en otro
// usuario por mas que sea super admin. Sirve para que el mantenedor del sistema
// tenga un usuario "invisible" al resto.
app.put('/api/me/oculto', authMiddleware, async (req, res, next) => {
  try {
    const schema = z.object({ oculto: z.boolean() });
    const { oculto } = schema.parse(req.body || {});
    const u = await prisma.user.update({
      where: { id: req.user.id },
      data: { oculto },
      select: { id: true, oculto: true },
    });
    res.json({ ok: true, data: u });
  } catch (e) { next(e); }
});

// ============================================================
// MAILER — envío de comprobantes por email (Resend HTTP API)
// Sin dependencias: usa fetch nativo (Node 18+). Se activa con las variables de
// entorno RESEND_API_KEY y MAIL_FROM. Si no están, devuelve notConfigured y el
// frontend cae al mailto tradicional. Remitente genérico de AgroCore que muestra
// el nombre de la empresa; el reply-to apunta al email de la empresa.
// ============================================================
const MAIL_FROM = process.env.MAIL_FROM || 'no-reply@agrocore.ar';
const MAIL_FROM_NAME = process.env.MAIL_FROM_NAME || 'AgroCore';
function mailConfigurado() { return !!process.env.RESEND_API_KEY; }
function _escHtml(s) { return String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c])); }
async function enviarEmailResend({ to, subject, html, text, replyTo, fromName, attachments }) {
  if (!process.env.RESEND_API_KEY) return { ok: false, notConfigured: true, error: 'Email no configurado (falta RESEND_API_KEY)' };
  const cleanName = String(fromName || MAIL_FROM_NAME).replace(/[<>\r\n"]/g, '').trim() || MAIL_FROM_NAME;
  const payload = {
    from: `${cleanName} <${MAIL_FROM}>`,
    to: Array.isArray(to) ? to : [to],
    subject: subject || 'Comprobante',
  };
  if (html) payload.html = html;
  if (text) payload.text = text;
  if (replyTo) payload.reply_to = replyTo;
  if (attachments && attachments.length) payload.attachments = attachments.map(a => ({ filename: a.filename, content: a.content }));
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: (j && (j.message || j.error)) || ('HTTP ' + r.status) };
    return { ok: true, id: (j && j.id) || null };
  } catch (e) { return { ok: false, error: e.message }; }
}
function _companyActiva(req) {
  const uc = (req.user?.userCompanies || []).find(u => u.companyId === req.companyId);
  return uc?.company || null;
}

// Formulario de contacto de la web pública (agrocore.ar). PÚBLICO (sin auth).
app.post('/api/contact', async (req, res) => {
  try {
    const { nombre, email, telefono, empresa, mensaje } = req.body || {};
    if (!nombre || !email || !mensaje) return res.status(400).json({ ok: false, error: 'Faltan datos' });
    const to = process.env.MAIL_CONTACT_TO || 'hola@agrocore.ar';
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px">
      <h3 style="color:#166534">Nueva consulta desde agrocore.ar</h3>
      <p><b>Nombre:</b> ${_escHtml(nombre)}</p>
      <p><b>Email:</b> ${_escHtml(email)}</p>
      <p><b>Teléfono:</b> ${_escHtml(telefono || '-')}</p>
      <p><b>Empresa:</b> ${_escHtml(empresa || '-')}</p>
      <p><b>Mensaje:</b><br>${_escHtml(mensaje).replace(/\n/g, '<br>')}</p></div>`;
    const r = await enviarEmailResend({ to, subject: `Consulta web — ${nombre}`, html, replyTo: email, fromName: 'AgroCore Web' });
    if (!r.ok) return res.status(r.notConfigured ? 503 : 502).json({ ok: false, error: r.error });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ============================================================
// ENDPOINTS PUBLICOS (sin auth) — version del sistema
// Hay que declararlos ANTES del app.use('/api', authMiddleware) porque
// si no quedan capturados por el middleware global y devuelven 401.
// El frontend los usa para mostrar la version y el updater para health check.
// ============================================================
app.get('/api/system/version', (_req, res) => {
  res.json({ ok: true, version: AGROCORE_VERSION, build: AGROCORE_BUILD });
});

// Detecta si los usuarios de prueba del seed (Admin/admin123, Super/super123)
// todavía existen. Si NO existen, el login no muestra el hint de "Usuarios de
// prueba" — así, al implementar en un cliente, basta con borrar esos usuarios
// para que el hint desaparezca automáticamente. No expone passwords ni datos
// sensibles, solo un booleano.
app.get('/api/system/demo-status', async (_req, res) => {
  try {
    const candidatos = ['Admin', 'admin', 'Super', 'super'];
    const found = await prisma.user.findMany({
      where: { OR: candidatos.map(a => ({ alias: { equals: a, mode: 'insensitive' } })) },
      select: { alias: true, superAdmin: true },
    });
    const demoAdmin = found.some(u => /^admin$/i.test(u.alias || ''));
    const demoSuper = found.some(u => /^super$/i.test(u.alias || ''));
    res.json({ ok: true, demoAdmin, demoSuper, anyDemo: demoAdmin || demoSuper });
  } catch (e) {
    // Si falla, devolver "no demo" para no exponer credenciales por error
    res.json({ ok: true, demoAdmin: false, demoSuper: false, anyDemo: false });
  }
});

// ============================================================
// TODO LO SIGUIENTE REQUIERE AUTH
// ============================================================
app.use('/api', authMiddleware);

// ============================================================
// EMAIL / COMPROBANTES EMITIDOS (reimprimir / PDF / reenviar)
// ============================================================
app.get('/api/mail/estado', requireCompany, (req, res) => {
  res.json({ ok: true, configurado: mailConfigurado(), from: MAIL_FROM });
});

// Envía un comprobante por email (PDF adjunto opcional). Remitente genérico de
// AgroCore con el nombre de la empresa; reply-to = email de la empresa.
app.post('/api/comprobantes/enviar', requireCompany, async (req, res) => {
  try {
    const schema = z.object({
      to: z.string().email('Email de destino inválido'),
      asunto: z.string().min(1),
      mensaje: z.string().optional().default(''),
      pdfBase64: z.string().optional().nullable(),
      filename: z.string().optional().default('comprobante.pdf'),
      tipo: z.string().optional(),
      documentoId: z.string().optional().nullable(),
    });
    const d = schema.parse(req.body);
    const company = _companyActiva(req);
    const fromName = company?.razonSocial || company?.name || 'AgroCore';
    const replyTo = company?.email || undefined;
    const htmlMsg = _escHtml(d.mensaje || '').replace(/\n/g, '<br>');
    const _dom = [company?.domicilio, company?.localidad].filter(Boolean).map(_escHtml).join(', ');
    const _contacto = [
      company?.telefono ? 'Tel: ' + _escHtml(company.telefono) : '',
      company?.email ? 'Email: ' + _escHtml(company.email) : '',
    ].filter(Boolean).join(' · ');
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
      ${htmlMsg || 'Adjuntamos el comprobante.'}
      <hr style="border:none;border-top:1px solid #ddd;margin:16px 0">
      <div style="font-size:12px;color:#444;line-height:1.5">
        <div style="font-weight:bold">${_escHtml(fromName)}</div>
        ${company?.cuit ? `<div>CUIT: ${_escHtml(company.cuit)}</div>` : ''}
        ${_dom ? `<div>${_dom}</div>` : ''}
        ${_contacto ? `<div>${_contacto}</div>` : ''}
        <div style="color:#888;margin-top:8px">Ante cualquier consulta, comuníquese con nosotros por los datos de arriba.<br>Este correo se envió desde una dirección de solo envío (no-reply).</div>
      </div>
      <div style="font-size:11px;color:#bbb;margin-top:6px">Enviado con AgroCore</div></div>`;
    const attachments = d.pdfBase64 ? [{ filename: d.filename, content: String(d.pdfBase64).replace(/^data:.*?base64,/, '') }] : [];
    const r = await enviarEmailResend({ to: d.to, subject: d.asunto, html, text: d.mensaje, replyTo, fromName, attachments });
    if (!r.ok) return res.status(200).json({ ok: false, notConfigured: !!r.notConfigured, error: r.error });
    if (d.documentoId) {
      try { await prisma.documentoEmitido.update({ where: { id: d.documentoId }, data: { emailEnviadoA: d.to, emailEnviadoEn: new Date() } }); } catch {}
    }
    res.json({ ok: true, id: r.id });
  } catch (e) {
    if (e instanceof ZodError) return res.status(400).json({ ok: false, error: e.errors?.[0]?.message || 'Datos inválidos' });
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Persistir un comprobante emitido para poder reabrirlo/reimprimirlo/reenviarlo.
app.post('/api/documentos', requireCompany, async (req, res) => {
  try {
    const schema = z.object({
      tipo: z.string().min(1),
      numero: z.string().optional().nullable(),
      contactoTipo: z.string().optional().nullable(),
      contactoId: z.string().optional().nullable(),
      contactoNombre: z.string().optional().nullable(),
      contactoEmail: z.string().optional().nullable(),
      total: z.number().optional().nullable(),
      moneda: z.string().optional().default('ARS'),
      fecha: z.coerce.date().optional(),
      datos: z.any(),
    });
    const d = schema.parse(req.body);
    let numeroFmt = d.numero || null;
    // Numeración correlativa atómica para comprobantes internos (OP / Recibo).
    const doc = await prisma.$transaction(async (tx) => {
      if (COMPROBANTES_NUMERADOS.has(d.tipo) && !numeroFmt) {
        let seq = await tx.secuenciaComprobante.findFirst({ where: { companyId: req.companyId, tipo: d.tipo } });
        if (!seq) seq = await tx.secuenciaComprobante.create({ data: { companyId: req.companyId, tipo: d.tipo, puntoVenta: 1, proximoNumero: 1 } });
        // UPDATE atómico (row lock) → dos pagos simultáneos nunca toman el mismo número.
        const upd = await tx.secuenciaComprobante.update({ where: { id: seq.id }, data: { proximoNumero: { increment: 1 } } });
        const numeroInt = upd.proximoNumero - 1;
        numeroFmt = String(upd.puntoVenta).padStart(4, '0') + '-' + String(numeroInt).padStart(8, '0');
      }
      const datos = (d.datos && typeof d.datos === 'object' && !Array.isArray(d.datos)) ? { ...d.datos, numero: numeroFmt } : (d.datos ?? {});
      return tx.documentoEmitido.create({ data: {
        companyId: req.companyId, tipo: d.tipo, numero: numeroFmt,
        fecha: d.fecha || new Date(),
        contactoTipo: d.contactoTipo || null, contactoId: d.contactoId || null,
        contactoNombre: d.contactoNombre || null, contactoEmail: d.contactoEmail || null,
        total: d.total ?? null, moneda: d.moneda || 'ARS',
        datos, createdById: req.user?.id || null,
      }});
    });
    res.json({ ok: true, data: { id: doc.id, numero: numeroFmt } });
  } catch (e) {
    if (e instanceof ZodError) return res.status(400).json({ ok: false, error: e.errors?.[0]?.message || 'Datos inválidos' });
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Tipos de comprobante interno que toman número correlativo al persistir el documento.
const COMPROBANTES_NUMERADOS = new Set(['orden_pago', 'recibo_cobro']);
// Clave de secuencia de una factura/NC/ND de venta según su clase y letra.
function _seqTipoFactura(clase, letra) {
  const c = clase === 'nota_credito' ? 'nc' : (clase === 'nota_debito' ? 'nd' : 'factura');
  return 'venta_' + c + '_' + (letra || 'A');
}
function _labelComp(clase, letra) {
  const c = clase === 'nota_credito' ? 'Nota de crédito' : (clase === 'nota_debito' ? 'Nota de débito' : 'Factura');
  return c + ' ' + letra;
}
// Adelanta la secuencia (companyId, tipo, puntoVenta) a numero+1 si venía atrás.
async function _avanzarSecuencia(tx, companyId, tipo, puntoVenta, numero) {
  const prox = Number(numero) + 1;
  const seq = await tx.secuenciaComprobante.findFirst({ where: { companyId, tipo, puntoVenta } });
  if (!seq) await tx.secuenciaComprobante.create({ data: { companyId, tipo, puntoVenta, proximoNumero: prox } });
  else if (seq.proximoNumero < prox) await tx.secuenciaComprobante.update({ where: { id: seq.id }, data: { proximoNumero: prox } });
}

// Configuración de numeración (soporta múltiples puntos de venta y tipos).
app.get('/api/numeradores', requireCompany, async (req, res) => {
  try {
    const rows = await prisma.secuenciaComprobante.findMany({ where: { companyId: req.companyId }, orderBy: [{ tipo:'asc' }, { puntoVenta:'asc' }] });
    const data = rows.map(r => ({ id:r.id, tipo:r.tipo, puntoVenta:r.puntoVenta, proximoNumero:r.proximoNumero }));
    for (const t of ['recibo_cobro','orden_pago']) if (!data.some(d => d.tipo === t)) data.unshift({ id:null, tipo:t, puntoVenta:1, proximoNumero:1 });
    res.json({ ok: true, data });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
// Próximo número (sin incrementar) para sugerir en el formulario de factura.
app.get('/api/numeradores/proximo', requireCompany, async (req, res) => {
  try {
    const tipo = String(req.query.tipo || ''); const pv = Number(req.query.puntoVenta || 1);
    if (!tipo) return res.json({ ok:true, proximoNumero:1, puntoVenta:pv });
    const seq = await prisma.secuenciaComprobante.findFirst({ where: { companyId: req.companyId, tipo, puntoVenta: pv } });
    res.json({ ok:true, proximoNumero: seq ? seq.proximoNumero : 1, puntoVenta: pv });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
app.put('/api/numeradores', requireCompany, requirePermission('finanzas:update'), async (req, res) => {
  try {
    const d = z.object({
      tipo: z.string().min(1),
      puntoVenta: z.number().int().min(1).max(99999),
      proximoNumero: z.number().int().min(1),
    }).parse(req.body);
    const seq = await prisma.secuenciaComprobante.findFirst({ where: { companyId: req.companyId, tipo: d.tipo, puntoVenta: d.puntoVenta } });
    const row = seq
      ? await prisma.secuenciaComprobante.update({ where: { id: seq.id }, data: { proximoNumero: d.proximoNumero } })
      : await prisma.secuenciaComprobante.create({ data: { companyId: req.companyId, tipo: d.tipo, puntoVenta: d.puntoVenta, proximoNumero: d.proximoNumero } });
    res.json({ ok: true, data: row });
  } catch (e) {
    if (e instanceof ZodError) return res.status(400).json({ ok: false, error: e.errors?.[0]?.message || 'Datos inválidos' });
    res.status(500).json({ ok: false, error: e.message });
  }
});
app.delete('/api/numeradores/:id', requireCompany, requirePermission('finanzas:update'), async (req, res) => {
  try { await prisma.secuenciaComprobante.deleteMany({ where: { id: req.params.id, companyId: req.companyId } }); res.json({ ok:true }); }
  catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});

app.get('/api/documentos', requireCompany, async (req, res) => {
  try {
    const tipo = req.query.tipo ? String(req.query.tipo) : undefined;
    const rows = await prisma.documentoEmitido.findMany({
      where: { companyId: req.companyId, ...(tipo ? { tipo } : {}) },
      orderBy: { fecha: 'desc' }, take: 500,
      select: { id: true, tipo: true, numero: true, fecha: true, contactoTipo: true, contactoId: true, contactoNombre: true, contactoEmail: true, total: true, moneda: true, emailEnviadoA: true, emailEnviadoEn: true },
    });
    res.json({ ok: true, data: rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/documentos/:id', requireCompany, async (req, res) => {
  try {
    const doc = await prisma.documentoEmitido.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!doc) return res.status(404).json({ ok: false, error: 'Comprobante no encontrado' });
    res.json({ ok: true, data: doc });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Método del pago a partir de las observaciones ("Pago via efectivo/cheque/...").
function _metodoDeObs(obs) { const m = /Pago via\s+([a-záéíóú]+)/i.exec(obs || ''); return m ? m[1].toLowerCase() : 'efectivo'; }
// Intenta ubicar el movimiento de recurso (caja/banco/cheque) de un pago viejo,
// para poder revertirlo después. Devuelve {tipo,id} sólo si hay UN único match.
async function _matchRecursoPago(companyId, metodo, prov, monto, fecha) {
  const d0 = new Date(fecha); d0.setHours(0,0,0,0); const d1 = new Date(d0); d1.setDate(d1.getDate()+1);
  const near = { gte: d0, lt: d1 }; const aprox = { gte: monto - 1, lte: monto + 1 };
  const nom = prov.razonSocial || '';
  try {
    if (metodo === 'efectivo') { const r = await prisma.efectivo.findMany({ where: { companyId, tipo:'egreso', concepto: 'Pago a ' + nom, monto: aprox, fecha: near } }); if (r.length === 1) return { tipo:'efectivo', id:r[0].id }; }
    else if (metodo === 'transferencia') { const r = await prisma.bancoMovimiento.findMany({ where: { companyId, tipo:'transferencia_out', concepto: 'Pago a ' + nom, monto: aprox, fecha: near } }); if (r.length === 1) return { tipo:'banco', id:r[0].id }; }
    else if (metodo === 'cheque') { const r = await prisma.cheque.findMany({ where: { companyId, monto: aprox, estado: { in:['entregado','endosado'] }, OR:[{ enPoderDe: nom }, { beneficiario: nom }] } }); if (r.length === 1) return { tipo:'cheque', id:r[0].id, chTipo:r[0].tipo }; }
  } catch (e) { /* si falla el match, se revisa a mano */ }
  return null;
}

// Reconstruye las Órdenes de Pago de pagos ANTERIORES (cargados antes de que
// existiera el documento de OP) a partir de la cuenta corriente, para que
// aparezcan y se puedan reimprimir/enviar/deshacer. Idempotente.
app.post('/api/documentos/backfill-op', requireCompany, requirePermission('finanzas:create'), async (req, res) => {
  try {
    const companyId = req.companyId;
    const pagos = await prisma.ctaCte.findMany({
      where: { companyId, contactoTipo:'proveedor', haber:{ gt:0.01 },
               OR:[{ detalle:{ startsWith:'Pago de' } }, { detalle:'Pago a cuenta' }] },
      orderBy: { fecha:'asc' },
    });
    const docs = await prisma.documentoEmitido.findMany({ where: { companyId, tipo:'orden_pago' }, select:{ datos:true } });
    const cubiertos = new Set();
    for (const d of docs) { const id = d.datos && d.datos._ccPagoId; if (id) cubiertos.add(id); }
    const provs = await prisma.proveedor.findMany({ where: { companyId } });
    const provMap = new Map(provs.map(p => [p.id, p]));
    let creados = 0;
    for (const row of pagos) {
      if (cubiertos.has(row.id)) continue;
      const prov = provMap.get(row.contactoId) || {};
      const metodo = _metodoDeObs(row.observaciones);
      const monto = Number(row.haber || 0);
      const detalleComp = (row.detalle || '').replace(/^Pago de\s*/i, '') || 'Pago a cuenta';
      const link = await _matchRecursoPago(companyId, metodo, prov, monto, row.fecha);
      const op = {
        numero: null, proveedor: prov.razonSocial || '', proveedorCuit: prov.cuit || '', proveedorEmail: prov.email || '',
        proveedorDomicilio: prov.direccion || '', proveedorLocalidad: prov.localidad || '', proveedorIva: prov.condicionIva || prov.condicionIVA || '',
        fecha: row.fecha, metodo, monto, obs: null,
        comprobantes: [{ detalle: detalleComp, importe: monto }], cheques: [], retenciones: [],
        totalEfectivo: metodo === 'efectivo' ? monto : 0, totalTransferencias: metodo === 'transferencia' ? monto : 0, totalCheques: metodo === 'cheque' ? monto : 0,
        _ccPagoId: row.id, _referencia: row.referencia || null, _backfill: true, _link: link,
      };
      await prisma.documentoEmitido.create({ data: {
        companyId, tipo:'orden_pago', numero:null, fecha: row.fecha,
        contactoTipo:'proveedor', contactoId: row.contactoId, contactoNombre: prov.razonSocial || null, contactoEmail: prov.email || null,
        total: monto, moneda: row.moneda || 'ARS', datos: op, createdById: req.user?.id || null,
      }});
      creados++;
    }
    res.json({ ok:true, creados, total: pagos.length });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});

// Deshacer un pago (revertir una OP): repone la deuda del proveedor y revierte el
// movimiento de caja/banco/cheque, y borra el comprobante. Transaccional.
app.post('/api/documentos/:id/revertir', requireCompany, requirePermission('finanzas:delete'), async (req, res) => {
  try {
    const doc = await prisma.documentoEmitido.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!doc) return res.status(404).json({ ok:false, error:'OP no encontrada' });
    if (doc.tipo !== 'orden_pago') return res.status(400).json({ ok:false, error:'Solo se puede deshacer una Orden de Pago' });
    const op = doc.datos || {};
    const companyId = req.companyId;
    // Ubicar el recurso si no vino linkeado (OP nuevas).
    let link = op._link;
    if (!link && op.metodo && Number(doc.total||0) > 0.01) {
      link = await _matchRecursoPago(companyId, op.metodo, { razonSocial: doc.contactoNombre }, Number(doc.total||0), doc.fecha);
    }
    const warns = [];
    await prisma.$transaction(async (tx) => {
      // 1) Cuenta corriente: borrar la fila de pago y reponer la deuda.
      if (op._ccPagoId) {
        const pagoRow = await tx.ctaCte.findFirst({ where: { id: op._ccPagoId, companyId } });
        if (pagoRow) {
          await tx.ctaCte.delete({ where: { id: pagoRow.id } });
          if (pagoRow.referencia) await tx.ctaCte.updateMany({ where: { companyId, contactoTipo:'proveedor', contactoId: doc.contactoId, referencia: pagoRow.referencia, debe:{ gt:0 } }, data:{ pagado:false } });
        } else warns.push('El movimiento de cuenta corriente ya no existía.');
      } else {
        const cand = await tx.ctaCte.findMany({ where: { companyId, contactoTipo:'proveedor', contactoId: doc.contactoId, detalle:{ startsWith:'Pago de' }, haber:{ gt:0 } } });
        const target = cand.filter(r => Math.abs(new Date(r.fecha) - new Date(doc.fecha)) < 86400000 && Math.abs(Number(r.haber) - Number(doc.total||0)) < 1);
        for (const r of target) { await tx.ctaCte.delete({ where: { id: r.id } }); if (r.referencia) await tx.ctaCte.updateMany({ where: { companyId, referencia: r.referencia, debe:{ gt:0 } }, data:{ pagado:false } }); }
        if (!target.length) warns.push('No pude identificar el movimiento de cuenta corriente; revisalo manualmente.');
      }
      // 2) Recurso (caja/banco/cheque).
      if (link && link.tipo === 'efectivo') { await tx.efectivo.deleteMany({ where: { id: link.id, companyId } }); }
      else if (link && link.tipo === 'banco') { await tx.bancoMovimiento.deleteMany({ where: { id: link.id, companyId } }); }
      else if (link && link.tipo === 'cheque') {
        const ch = await tx.cheque.findFirst({ where: { id: link.id, companyId } });
        if (ch) {
          // Vuelve a cartera (sin entrega). Si era un cheque propio creado en el
          // mismo pago, queda en cartera sin usar: se puede borrar desde Tesorería.
          await tx.cheque.update({ where: { id: ch.id }, data: { estado:'en_cartera', enPoderDe:null, fechaEndoso:null, beneficiario:null } });
          if (ch.tipo === 'propio') warns.push('El cheque propio volvió a cartera. Si se había creado sólo para este pago, borralo desde Tesorería → Cheques.');
        }
      } else if (op.metodo && !['intercompany','cereal'].includes(op.metodo) && Number(doc.total||0) > 0.01) {
        warns.push('No pude ubicar el movimiento de ' + op.metodo + ' de forma unívoca; revisá Tesorería y ajustalo a mano si corresponde.');
      }
      // 3) Borrar el comprobante de OP.
      await tx.documentoEmitido.delete({ where: { id: doc.id } });
    });
    res.json({ ok:true, warnings: warns });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});

// Corrige el "Tipo Cheque" guardado en las Órdenes de Pago YA EMITIDAS. Antes se
// guardaba el tipo propio/terceros (que caía en "Físico") en lugar del formato
// real del cheque. Recupera el formato buscando el cheque original (por id o por
// número + banco) y reescribe el texto a Electrónico/Físico. Idempotente.
app.post('/api/documentos/fix-cheque-tipo', requireCompany, requirePermission('finanzas:update'), async (req, res) => {
  try {
    const companyId = req.companyId;
    const _label = f => f === 'electronico' ? 'Electrónico' : (f === 'fisico' ? 'Físico' : null);
    const docs = await prisma.documentoEmitido.findMany({ where: { companyId, tipo: 'orden_pago' } });
    const cheques = await prisma.cheque.findMany({ where: { companyId }, select: { id: true, formato: true, nroCheque: true, banco: true } });
    // Índices para ubicar el cheque original.
    const porId = new Map(cheques.map(c => [c.id, c]));
    const porNumBanco = new Map();
    for (const c of cheques) {
      const k = `${(c.nroCheque || '').trim()}|${(c.banco || '').trim().toLowerCase()}`;
      if (!porNumBanco.has(k)) porNumBanco.set(k, c);
    }
    const buscarFormato = (ch) => {
      // 1) idInterno guarda los primeros 8 caracteres del id del cheque.
      const idp = (ch.idInterno || '').trim();
      if (idp && idp !== '—') {
        const hit = cheques.find(c => c.id.startsWith(idp));
        if (hit) return hit.formato;
      }
      // 2) por número + banco.
      const k = `${(ch.nroCheque || '').toString().trim()}|${(ch.banco || '').trim().toLowerCase()}`;
      const hit2 = porNumBanco.get(k);
      if (hit2) return hit2.formato;
      return null;
    };
    let docsFix = 0, chequesFix = 0;
    for (const doc of docs) {
      const datos = doc.datos;
      if (!datos || !Array.isArray(datos.cheques) || !datos.cheques.length) continue;
      let cambio = false;
      for (const ch of datos.cheques) {
        const fmt = buscarFormato(ch);
        const nuevo = _label(fmt);
        if (nuevo && ch.tipo !== nuevo) { ch.tipo = nuevo; cambio = true; chequesFix++; }
      }
      if (cambio) {
        await prisma.documentoEmitido.update({ where: { id: doc.id }, data: { datos } });
        docsFix++;
      }
    }
    res.json({ ok: true, docsCorregidos: docsFix, chequesCorregidos: chequesFix, totalOP: docs.length });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ---------- SETTINGS (configuración global del sistema) ----------
// Una sola fila id="global" en la tabla Setting. Cualquier usuario logueado
// puede leerla (los teléfonos se usan para los links de WhatsApp). Solo el
// super admin puede editarla.
app.get('/api/settings', async (_req, res, next) => {
  try {
    const row = await prisma.setting.findUnique({ where: { id: 'global' } });
    res.json({ ok: true, data: row?.data || {} });
  } catch (e) { next(e); }
});

app.put('/api/settings', async (req, res, next) => {
  try {
    if (!req.user?.superAdmin) return res.status(403).json({ ok: false, error: 'Solo Super Admin puede editar la configuración global' });
    const data = req.body || {};
    const row = await prisma.setting.upsert({
      where: { id: 'global' },
      create: { id: 'global', data },
      update: { data },
    });
    res.json({ ok: true, data: row.data });
  } catch (e) { next(e); }
});

// ---------- ASISTENTE IA (OpenAI) ----------
// Config global guardada en Setting 'ia': { enabled, apiKey, model }. La API key NUNCA
// se devuelve completa al frontend (solo enmascarada). Fallback a env OPENAI_API_KEY.
async function _iaConfig() {
  let cfg = {};
  try { cfg = (await prisma.setting.findUnique({ where: { id: 'ia' } }))?.data || {}; } catch {}
  const apiKey = (cfg.apiKey || process.env.OPENAI_API_KEY || '').trim();
  return { enabled: !!cfg.enabled && !!apiKey, apiKey, model: cfg.model || 'gpt-4o-mini' };
}
app.get('/api/ia-config', async (req, res, next) => {
  try {
    if (!req.user?.superAdmin) return res.status(403).json({ ok: false, error: 'Solo Super Admin' });
    const cfg = (await prisma.setting.findUnique({ where: { id: 'ia' } }))?.data || {};
    const key = (cfg.apiKey || '').trim();
    res.json({ ok: true, data: { enabled: !!cfg.enabled, model: cfg.model || 'gpt-4o-mini', tieneKey: !!key, keyMask: key ? ('sk-…' + key.slice(-4)) : '' } });
  } catch (e) { next(e); }
});
app.put('/api/ia-config', async (req, res, next) => {
  try {
    if (!req.user?.superAdmin) return res.status(403).json({ ok: false, error: 'Solo Super Admin puede configurar la IA' });
    const prev = (await prisma.setting.findUnique({ where: { id: 'ia' } }))?.data || {};
    const b = req.body || {};
    const data = {
      enabled: b.enabled != null ? !!b.enabled : !!prev.enabled,
      model: (b.model || prev.model || 'gpt-4o-mini').trim(),
      // Solo actualiza la key si mandan una nueva no vacía; si mandan "" y borrarKey, la borra.
      apiKey: (typeof b.apiKey === 'string' && b.apiKey.trim()) ? b.apiKey.trim() : (b.borrarKey ? '' : (prev.apiKey || '')),
    };
    await prisma.setting.upsert({ where: { id: 'ia' }, create: { id: 'ia', data }, update: { data } });
    res.json({ ok: true, data: { enabled: data.enabled, model: data.model, tieneKey: !!data.apiKey } });
  } catch (e) { next(e); }
});
// Prueba rápida de la IA (superAdmin): normaliza una frase de ejemplo.
app.post('/api/ia-config/probar', async (req, res, next) => {
  try {
    if (!req.user?.superAdmin) return res.status(403).json({ ok: false, error: 'Solo Super Admin' });
    // Permite probar la key que el usuario acaba de escribir en el campo (aun sin Guardar).
    const ia = await _iaConfig();
    const keyProbar = String(req.body?.apiKey || '').trim() || ia.apiKey;
    const modelProbar = String(req.body?.model || '').trim() || ia.model;
    if (!keyProbar) return res.status(400).json({ ok: false, error: 'Falta la API key de OpenAI.' });
    const iaTest = { enabled: true, apiKey: keyProbar, model: modelProbar };
    const ctx = await _ctxAsistente(req.companyId);
    const frase = String(req.body?.texto || 'apliqué 120 litros de glifosato en el lote 3').trim();
    const norm = await _iaNormalizar(frase, ctx, iaTest);
    res.json({ ok: true, entrada: frase, normalizado: norm || '(la IA no la asoció a ninguna acción)' });
  } catch (e) { res.status(502).json({ ok: false, error: 'No pude conectar con OpenAI: ' + (e.message || e) }); }
});
// Usa OpenAI para REESCRIBIR el mensaje libre a un "molde" que las reglas ya entienden.
// No ejecuta nada: solo normaliza. Devuelve la frase o null. Barato y con timeout.
async function _iaNormalizar(texto, ctx, ia) {
  try {
    const cfg = ia || await _iaConfig();
    if (!cfg.apiKey) return null;
    const lista = (arr, f, n = 60) => (arr || []).slice(0, n).map(f).filter(Boolean).join(', ');
    const campos = lista(ctx.campos, c => c.nombre);
    const lotes = lista(ctx.lotes, l => l.nombre);
    const cats = lista(ctx.categorias, c => c);
    const clientes = lista(ctx.clientes, c => c.razonSocial, 40);
    const proveedores = lista(ctx.proveedores, p => p.razonSocial, 40);
    const sys = [
      'Sos un normalizador de AgroCore (gestión agropecuaria argentina). Reescribí el mensaje del usuario a UNA sola frase corta y clara en español rioplatense, usando EXACTAMENTE uno de estos moldes:',
      '- Gasto: "gasté <monto> en <concepto>"  · Ingreso: "ingresó <monto> por <concepto>"',
      '- Pago: "pagá <monto> a <proveedor>"  · Cobro: "cobrale <monto> a <cliente>"',
      '- Animales: "nacieron 5 terneros en <campo>" / "murieron 2 vacas en <campo>" / "compré 10 novillos en <campo>"',
      '- Labor: "pulverización en el lote <lote> de <campo>" (o cosecha/siembra/fertilización/laboreo). Si hay un insumo aplicado, agregalo al final así: "... con 120 litros de glifosato".',
      '- Recordatorio: "recordar <texto> el DD/MM"',
      '- Consultas: "cuánto stock queda de <producto>", "cuánto tengo a cobrar", "cuánto debo", "cómo estoy", "cuánta plata tengo en caja", "cuánto cereal me falta liquidar", "qué campos tengo", "qué lotes tengo", "qué campañas tengo", "mostrame los animales".',
      'Usá los nombres reales de este contexto cuando correspondan (elegí el más parecido):',
      `Campos: ${campos || '(ninguno)'}`,
      `Lotes: ${lotes || '(ninguno)'}`,
      `Categorías de animales: ${cats || '(ninguna)'}`,
      `Clientes: ${clientes || '(ninguno)'}`,
      `Proveedores: ${proveedores || '(ninguno)'}`,
      'Si el mensaje no corresponde a ninguna acción/consulta, respondé exactamente NONE. Respondé SOLO la frase (o NONE), sin comillas, sin corchetes [], sin llaves {}, sin paréntesis ni explicaciones.',
    ].join('\n');
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 9000);
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: cfg.model || 'gpt-4o-mini', temperature: 0, max_tokens: 80, messages: [{ role: 'system', content: sys }, { role: 'user', content: String(texto || '').slice(0, 500) }] }),
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (!r.ok) { console.warn('IA normalizar HTTP', r.status); return null; }
    const j = await r.json();
    let out = (j?.choices?.[0]?.message?.content || '').trim().replace(/^["']|["']$/g, '');
    // Defensa: si el modelo dejó corchetes/llaves, los quitamos pero conservamos el texto interno.
    out = out.replace(/[\[\]{}]/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (!out || /^none$/i.test(out)) return null;
    return out;
  } catch (e) { if (e.name !== 'AbortError') console.warn('IA normalizar error:', e.message); return null; }
}

// Analiza un documento (PDF o imagen/foto) con OpenAI y lo clasifica: factura de compra,
// liquidación (cereal/animales), orden de trabajo/labor, gasto/ticket, cheque, etc.
// Devuelve { tipo, resumen, datos } o null. Usa visión para imágenes (gpt-4o-mini).
async function _iaAnalizarDocumento({ buffer, mime, filename, textoPdf }, ia) {
  const cfg = ia || await _iaConfig();
  if (!cfg.apiKey) return null;
  const sys = [
    'Sos un clasificador de documentos de una empresa agropecuaria argentina. Mirá el documento y respondé SOLO un JSON con esta forma:',
    '{ "tipo": "...", "resumen": "...", "datos": { ... } }',
    'tipo debe ser UNO de: factura_compra, liquidacion_cereal, liquidacion_animales, orden_trabajo, gasto, cheque, otro.',
    '- factura_compra: factura/remito de un proveedor (nos venden algo). datos: proveedor, cuit, numero, fecha, total, moneda.',
    '- liquidacion_cereal: liquidación primaria de granos / venta de cereal. datos: comprador, numero, fecha, grano, neto.',
    '- liquidacion_animales: liquidación de compra directa/faena de hacienda (porcinos/bovinos). datos: comprador, numero, fecha, categoria, cabezas, neto.',
    '- orden_trabajo: orden de trabajo/laboreo/aplicación a campo. datos: establecimiento, lote, cultivo, labor, hectareas, contratista, fecha, tarifa.',
    '- gasto: ticket o comprobante de un gasto chico (panadería, combustible, ferretería...). datos: concepto, monto, fecha.',
    '- cheque: un cheque bancario. datos: banco, numero, importe, fecha, beneficiario.',
    'Usá números sin símbolos ni separadores de miles (ej 1234.50). Si un dato no está, omitilo. Respondé SOLO el JSON, sin texto extra.',
  ].join('\n');
  const userContent = [];
  if (textoPdf) userContent.push({ type: 'text', text: 'Documento (texto extraído del PDF):\n' + textoPdf.slice(0, 6000) });
  else {
    userContent.push({ type: 'text', text: 'Analizá esta imagen de un documento y clasificalo.' });
    userContent.push({ type: 'image_url', image_url: { url: `data:${mime || 'image/jpeg'};base64,${buffer.toString('base64')}` } });
  }
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: cfg.model || 'gpt-4o-mini', temperature: 0, max_tokens: 500, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sys }, { role: 'user', content: userContent }] }),
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (!r.ok) { console.warn('IA analizar HTTP', r.status); return null; }
    const j = await r.json();
    let out = (j?.choices?.[0]?.message?.content || '').trim();
    try { return JSON.parse(out); } catch { return null; }
  } catch (e) { clearTimeout(to); if (e.name !== 'AbortError') console.warn('IA analizar error:', e.message); return null; }
}

// ---------- EMPRESAS ----------
const empresaSchema = z.object({
  name: z.string().min(1),
  cuit: z.string().nullable().optional(),
  razonSocial: z.string().nullable().optional(),
  domicilio: z.string().nullable().optional(),
  localidad: z.string().nullable().optional(),
  provincia: z.string().nullable().optional(),
  pais: z.string().nullable().optional(),
  telefono: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  condIVA: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  logoUrl: z.string().nullable().optional(),
  informal: z.boolean().optional(),
  activo: z.boolean().optional(),
});

app.get('/api/empresas', async (req, res, next) => {
  try {
    const companies = req.user.superAdmin
      ? await prisma.company.findMany({ orderBy: { name: 'asc' } })
      : req.user.userCompanies.map((uc) => uc.company);
    res.json({ ok: true, data: companies });
  } catch (e) { next(e); }
});

app.post('/api/empresas', async (req, res, next) => {
  try {
    if (!req.user.superAdmin) return res.status(403).json({ ok: false, error: 'Solo superAdmin' });
    const data = empresaSchema.parse(req.body);
    const c = await prisma.company.create({ data });
    // Auto-sembrar catalogos genericos desde una empresa "plantilla" (si esta
    // configurada en Settings) o desde la primera empresa que tenga catalogos.
    // Excluye los tipos "Banco" y "Caja" (esos siempre se cargan por empresa).
    try {
      const seeded = await _autoSembrarCatalogosDesdeTemplate(c.id);
      res.status(201).json({ ok: true, data: c, catalogosSembrados: seeded });
    } catch (e) {
      console.warn('[empresa.create] No se pudieron sembrar catalogos automaticamente:', e.message);
      res.status(201).json({ ok: true, data: c, catalogosSembrados: 0, catalogosError: e.message });
    }
  } catch (e) { next(e); }
});

// Helper: encuentra la empresa "plantilla" desde donde copiar catalogos.
// Prioridad:
//   1. Setting global 'templateCompanyId' (si existe y la empresa esta activa)
//   2. Primera empresa con mas catalogos cargados (heuristica: la que tenga
//      mas tipos distintos)
// Devuelve null si no encontro ninguna candidata.
async function _findTemplateCompany(excludeId) {
  try {
    const setting = await prisma.setting.findUnique({ where: { id: 'global' } }).catch(() => null);
    let templateId = setting?.data?.templateCompanyId;
    if (templateId && templateId !== excludeId) {
      const exists = await prisma.company.findUnique({ where: { id: templateId } });
      if (exists?.activo) return templateId;
    }
  } catch {}
  // Heuristica: tomar la empresa con mas catalogos cargados (excluyendo la nueva)
  const compsConCatalogos = await prisma.catalogo.groupBy({
    by: ['companyId'],
    where: { companyId: { not: excludeId } },
    _count: { _all: true },
    orderBy: { _count: { id: 'desc' } },
    take: 1,
  }).catch(() => []);
  return compsConCatalogos[0]?.companyId || null;
}

// Helper: copia catalogos de una empresa plantilla a una empresa nueva.
// EXCLUYE los tipos pasados en excludeTipos (default: Banco y Caja).
// Devuelve la cantidad de catalogos copiados.
async function _copiarCatalogos(sourceCompanyId, targetCompanyId, excludeTipos = ['banco', 'caja']) {
  const excluded = excludeTipos.map(t => t.toLowerCase());
  const fuente = await prisma.catalogo.findMany({
    where: { companyId: sourceCompanyId, activo: true },
  });
  // Filtrar tipos excluidos
  const aCopiar = fuente.filter(c => !excluded.includes(String(c.tipo).toLowerCase()));
  if (!aCopiar.length) return 0;
  // No duplicar: tomar los que ya tiene la empresa destino y descontarlos por (tipo, codigo)
  const yaExistentes = await prisma.catalogo.findMany({
    where: { companyId: targetCompanyId },
    select: { tipo: true, codigo: true, nombre: true },
  });
  const existeKey = new Set(yaExistentes.map(c => `${(c.tipo||'').toLowerCase()}|${(c.codigo||c.nombre||'').toLowerCase()}`));
  const nuevos = aCopiar.filter(c => !existeKey.has(`${(c.tipo||'').toLowerCase()}|${(c.codigo||c.nombre||'').toLowerCase()}`));
  if (!nuevos.length) return 0;
  await prisma.catalogo.createMany({
    data: nuevos.map(c => ({
      companyId: targetCompanyId,
      tipo: c.tipo, codigo: c.codigo, nombre: c.nombre,
      descripcion: c.descripcion,
      precioReferencia: c.precioReferencia,
      tipoPrecio: c.tipoPrecio,
      activo: true,
    })),
    skipDuplicates: true,
  });
  return nuevos.length;
}

// Helper: copia un ÁRBOL padre/hijo (CategoriaArticulo o CategoriaGasto) de una
// empresa a otra preservando la jerarquía. Idempotente: no duplica un nodo si el
// destino ya tiene uno con el mismo nombre bajo el mismo padre. Devuelve # creados.
async function _copiarArbol(model, sourceCompanyId, targetCompanyId) {
  const src = await prisma[model].findMany({ where: { companyId: sourceCompanyId } });
  if (!src.length) return 0;
  const tgt = await prisma[model].findMany({ where: { companyId: targetCompanyId } });
  const key = (padreId, nombre) => `${padreId || ''}|${String(nombre || '').toLowerCase().trim()}`;
  const tgtByKey = new Map(tgt.map(n => [key(n.padreId, n.nombre), n.id]));
  const byId = new Map(src.map(n => [n.id, n]));
  // Ordenar por profundidad para crear los padres antes que los hijos.
  const depth = (n) => { let d = 0, c = n; const seen = new Set(); while (c && c.padreId && !seen.has(c.id)) { seen.add(c.id); c = byId.get(c.padreId); d++; if (d > 50) break; } return d; };
  const ordered = [...src].sort((a, b) => depth(a) - depth(b));
  const idMap = new Map();  // id origen -> id destino
  let creados = 0;
  for (const n of ordered) {
    const tgtPadre = n.padreId ? (idMap.get(n.padreId) || null) : null;
    const k = key(tgtPadre, n.nombre);
    let existing = tgtByKey.get(k);
    if (!existing) {
      const nuevo = await prisma[model].create({ data: {
        companyId: targetCompanyId, nombre: n.nombre, padreId: tgtPadre,
        icono: n.icono, orden: n.orden, activo: n.activo,
      }});
      existing = nuevo.id; tgtByKey.set(k, existing); creados++;
    }
    idMap.set(n.id, existing);
  }
  return creados;
}

async function _autoSembrarCatalogosDesdeTemplate(newCompanyId) {
  const templateId = await _findTemplateCompany(newCompanyId);
  if (!templateId) return 0;
  const cat = await _copiarCatalogos(templateId, newCompanyId);
  // La empresa plantilla también siembra los árboles de Categorías y Familias y de Gastos.
  try { await _copiarArbol('categoriaArticulo', templateId, newCompanyId); } catch {}
  try { await _copiarArbol('categoriaGasto', templateId, newCompanyId); } catch {}
  return cat;
}

// === COPIAR CATALOGOS de una empresa origen a una o varias destino ===
// Body:
//   sourceCompanyId: ID empresa origen
//   targetCompanyIds: array de IDs destino, o "all" para todas las demas activas
//   excludeTipos: array de tipos a NO copiar (default: ["Banco","Caja"])
//   incluirOcultos: si true, copia tambien catalogos con activo=false (default false)
// Devuelve cantidad copiada por empresa destino.
app.post('/api/admin/copiar-catalogos', authMiddleware, async (req, res, next) => {
  try {
    if (!req.user.superAdmin) return res.status(403).json({ ok: false, error: 'Solo super admin' });
    const schema = z.object({
      sourceCompanyId: z.string().min(1),
      targetCompanyIds: z.union([z.array(z.string()), z.literal('all')]),
      excludeTipos: z.array(z.string()).optional(),
      // Qué copiar (opcional). Si no viene, por compatibilidad copia solo catálogos.
      incluir: z.object({
        catalogos: z.boolean().optional(),
        categoriasArt: z.boolean().optional(),
        categoriasGasto: z.boolean().optional(),
      }).optional(),
    });
    const d = schema.parse(req.body || {});
    const exclude = (d.excludeTipos && d.excludeTipos.length ? d.excludeTipos : ['Banco', 'Caja']).map(t => t.toLowerCase());
    // Por defecto (sin "incluir") copia catálogos, como antes.
    const inc = d.incluir || { catalogos: true };

    // Resolver lista de empresas destino
    let targetIds;
    if (d.targetCompanyIds === 'all') {
      const todas = await prisma.company.findMany({
        where: { activo: true, id: { not: d.sourceCompanyId } },
        select: { id: true },
      });
      targetIds = todas.map(t => t.id);
    } else {
      targetIds = d.targetCompanyIds.filter(id => id !== d.sourceCompanyId);
    }
    if (!targetIds.length) {
      return res.json({ ok: true, resultados: [], total: 0,
        mensaje: 'No hay empresas destino para procesar.' });
    }
    const resultados = [];
    let total = 0, totalCatArt = 0, totalCatGasto = 0;
    for (const tid of targetIds) {
      try {
        const copiados   = inc.catalogos      ? await _copiarCatalogos(d.sourceCompanyId, tid, exclude) : 0;
        const catArt     = inc.categoriasArt   ? await _copiarArbol('categoriaArticulo', d.sourceCompanyId, tid) : 0;
        const catGasto   = inc.categoriasGasto ? await _copiarArbol('categoriaGasto', d.sourceCompanyId, tid) : 0;
        resultados.push({ companyId: tid, copiados, categoriasArt: catArt, categoriasGasto: catGasto, error: null });
        total += copiados; totalCatArt += catArt; totalCatGasto += catGasto;
      } catch (e) {
        resultados.push({ companyId: tid, copiados: 0, categoriasArt: 0, categoriasGasto: 0, error: String(e.message || e) });
      }
    }
    res.json({ ok: true, resultados, total, totalCategoriasArt: totalCatArt, totalCategoriasGasto: totalCatGasto, excludeTipos: exclude, incluir: inc });
  } catch (e) { next(e); }
});

// === DESIGNAR empresa plantilla (de donde se copian catalogos al crear nuevas) ===
app.put('/api/admin/empresa-plantilla', authMiddleware, async (req, res, next) => {
  try {
    if (!req.user.superAdmin) return res.status(403).json({ ok: false, error: 'Solo super admin' });
    const schema = z.object({ companyId: z.string().nullable() });
    const { companyId } = schema.parse(req.body || {});
    if (companyId) {
      const exists = await prisma.company.findUnique({ where: { id: companyId } });
      if (!exists) return res.status(404).json({ ok: false, error: 'Empresa no encontrada' });
    }
    const setting = await prisma.setting.findUnique({ where: { id: 'global' } }).catch(() => null);
    const data = (setting?.data && typeof setting.data === 'object') ? { ...setting.data } : {};
    if (companyId) data.templateCompanyId = companyId;
    else delete data.templateCompanyId;
    await prisma.setting.upsert({
      where: { id: 'global' },
      create: { id: 'global', data },
      update: { data },
    });
    res.json({ ok: true, templateCompanyId: companyId });
  } catch (e) { next(e); }
});

app.get('/api/admin/empresa-plantilla', authMiddleware, async (req, res, next) => {
  try {
    const setting = await prisma.setting.findUnique({ where: { id: 'global' } }).catch(() => null);
    res.json({ ok: true, templateCompanyId: setting?.data?.templateCompanyId || null });
  } catch (e) { next(e); }
});

app.put('/api/empresas/:id', async (req, res, next) => {
  try {
    const m = req.user.userCompanies.find((uc) => uc.companyId === req.params.id);
    const isAdmin = req.user.superAdmin || (m && (m.role.key === 'admin' || (m.role.permissions || []).includes('*:*')));
    if (!isAdmin) return res.status(403).json({ ok: false, error: 'Sin permisos' });
    const data = empresaSchema.partial().parse(req.body);
    const c = await prisma.company.update({ where: { id: req.params.id }, data });
    res.json({ ok: true, data: c });
  } catch (e) { next(e); }
});

// Borrado de empresa.
// Reglas:
//   1) Super Admin o Admin de esa empresa pueden borrar
//   2) Si la empresa tiene datos asociados (clientes, facturas, movimientos, etc.)
//      se rechaza el borrado. La forma "limpia" de hacerlo es usar primero
//      Limpiar Empresa (vacía movimientos) y después este endpoint.
//   3) ?force=1 borra cascada en todo (UserCompany, BancoCuenta, Deposito,
//      Catalogo, etc.) — solo recomendado si se sabe lo que se está haciendo.
app.delete('/api/empresas/:id', async (req, res, next) => {
  try {
    const empresaId = req.params.id;
    if (!_puedeAdminEmpresa(req, empresaId)) {
      return res.status(403).json({ ok: false, error: 'Solo el Super Admin o un Administrador de la empresa pueden borrarla' });
    }
    // Si el user NO es super admin, validar que no se quede sin empresas
    if (!req.user.superAdmin) {
      const accesos = (req.user.userCompanies || []).filter(uc => uc.companyId !== empresaId);
      if (accesos.length === 0) {
        return res.status(400).json({ ok: false, error: 'No podés borrar la única empresa a la que tenés acceso, te quedarías sin empresas para trabajar. Pediéle a otro admin que la borre.' });
      }
    }

    const force = String(req.query.force || '') === '1';
    try {
      // Limpiar UserCompany (los memberships con esta empresa)
      await prisma.userCompany.deleteMany({ where: { companyId: empresaId } });
      await prisma.company.delete({ where: { id: empresaId } });
      return res.json({ ok: true });
    } catch (e) {
      const isFK = e?.code === 'P2003' || /Foreign key|violates foreign key/i.test(String(e?.message || ''));
      if (!isFK) throw e;
      if (!force) {
        return res.status(409).json({
          ok: false,
          error: 'La empresa tiene datos asociados (clientes, facturas, movimientos, etc.). Por seguridad no se borra automáticamente.',
          tieneRelacionados: true,
          sugerencia: 'Usá primero "Limpiar empresa" en Configuración → Sistema para vaciar los movimientos. Si igual querés borrar todo, podés forzar — eso borra TODOS los datos de la empresa en cascada.',
        });
      }
      // Force: cascada manual de las tablas que pueden tener referencias.
      // Lo hacemos en transacción para que sea atómico (todo o nada).
      // El orden importa: tablas hoja primero, raíz al final.
      await prisma.$transaction(async (tx) => {
        const m = (model) => tx[model] ? tx[model].deleteMany({ where: { companyId: empresaId } }).catch(() => null) : null;
        // Memberships del usuario en la empresa
        await tx.userCompany.deleteMany({ where: { companyId: empresaId } });
        // Detalles e items que dependen de cabeceras (se borran primero por FK)
        await m('facturaItem');             // por si tiene companyId directo
        await m('facturaCompraItem');
        await m('laborInsumo');
        await m('liquidacionCerealConcepto');
        await m('cuotaCredito');
        await m('insumoAplicado');
        // Cabeceras transaccionales
        await m('movimientoEmpleado');
        await m('liquidacionSueldo');
        await m('liquidacionCereal');
        await m('credito');
        await m('laborAplicada');
        await m('cheque');
        await m('factura');
        await m('facturaCompra');
        await m('ctaCte');
        await m('efectivo');
        await m('flujoCaja');
        await m('arrendamiento');
        await m('viaje');
        await m('haciendaMovimiento');
        await m('haciendaStock');
        await m('bancoMovimiento');
        await m('bancoCuenta');
        await m('movimiento');
        // Maestros
        await m('lote');
        await m('campana');
        await m('campo');
        await m('empleado');
        await m('cliente');
        await m('proveedor');
        await m('catalogo');
        // Depósitos: pueden ser compartidos (companyId null). Solo borrar los exclusivos.
        if (tx.deposito) await tx.deposito.deleteMany({ where: { companyId: empresaId } }).catch(() => null);
        // Setting global no es por empresa, no se toca
        // Borrar la empresa misma
        await tx.company.delete({ where: { id: empresaId } });
      });
      return res.json({ ok: true, forzado: true });
    }
  } catch (e) { next(e); }
});

// ============================================================
// ARCA / WSCTG — Integración para consultar Carta de Porte de Granos
//
// Esta versión deja toda la estructura armada (archivos del cert, almacenamiento
// por empresa, endpoints de consulta) pero la consulta a los servidores de ARCA
// está MOCKEADA: devuelve datos plausibles para probar el flujo end-to-end.
// La activación real (WSAA token + WSCTG SOAP) se conecta cuando estén en AWS
// con los certs definitivos de cada empresa.
// ============================================================

// Solo el admin de la empresa (o super admin) puede tocar la config ARCA.
function _puedeAdminEmpresa(req, empresaId) {
  if (req.user.superAdmin) return true;
  const m = req.user.userCompanies.find((uc) => uc.companyId === empresaId);
  if (!m) return false;
  return m.role.key === 'admin' || (m.role.permissions || []).includes('*:*');
}

// Paso 1: generar la clave privada + solicitud (CSR) localmente con node-forge.
// El usuario después sube el CSR a AFIP, descarga el cert.crt y lo carga en Paso 3.
app.post('/api/empresas/:id/arca/generar', async (req, res, next) => {
  try {
    if (!_puedeAdminEmpresa(req, req.params.id)) return res.status(403).json({ ok: false, error: 'Sin permisos' });
    const { nombre, cuit } = z.object({
      nombre: z.string().min(2),
      cuit: z.string().regex(/^\d{10,11}$/, 'CUIT inválido (11 dígitos sin guiones)'),
    }).parse(req.body);
    // node-forge es opcional: si no está instalado, devolvemos un error claro.
    let forge;
    try { forge = (await import('node-forge')).default; }
    catch {
      return res.status(500).json({ ok: false, error: 'Falta la dependencia node-forge. En el servidor ejecutá: npm install node-forge' });
    }
    const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
    const csr = forge.pki.createCertificationRequest();
    csr.publicKey = keys.publicKey;
    csr.setSubject([
      { name: 'commonName',   value: nombre },
      { name: 'serialNumber', value: 'CUIT ' + cuit },
      { shortName: 'C',       value: 'AR' },
    ]);
    csr.sign(keys.privateKey, forge.md.sha256.create());
    res.json({
      ok: true,
      data: {
        privadaKey:   forge.pki.privateKeyToPem(keys.privateKey),
        solicitudCsr: forge.pki.certificationRequestToPem(csr),
      },
    });
  } catch (e) { next(e); }
});

// Estado de configuración ARCA de la empresa.
app.get('/api/empresas/:id/arca/estado', async (req, res, next) => {
  try {
    const m = req.user.userCompanies.find((uc) => uc.companyId === req.params.id);
    if (!m && !req.user.superAdmin) return res.status(403).json({ ok: false, error: 'Sin acceso a la empresa' });
    const c = await prisma.company.findUnique({
      where: { id: req.params.id },
      select: { arcaCuit: true, arcaCertCrt: true, arcaPrivadaKey: true, arcaModo: true, arcaConfigAt: true },
    });
    if (!c) return res.status(404).json({ ok: false, error: 'Empresa no encontrada' });
    res.json({
      ok: true,
      data: {
        cuit:         c.arcaCuit || null,
        certCargado:  !!c.arcaCertCrt,
        keyCargada:   !!c.arcaPrivadaKey,
        modo:         c.arcaModo || 'prod',
        configAt:     c.arcaConfigAt,
        configurado:  !!(c.arcaCertCrt && c.arcaPrivadaKey && c.arcaCuit),
      },
    });
  } catch (e) { next(e); }
});

// Guardar config ARCA (cert + key + cuit + modo). Acepta cada campo opcional.
app.put('/api/empresas/:id/arca/config', async (req, res, next) => {
  try {
    if (!_puedeAdminEmpresa(req, req.params.id)) return res.status(403).json({ ok: false, error: 'Sin permisos' });
    const d = z.object({
      cuit:        z.string().regex(/^\d{10,11}$/).optional(),
      certCrt:     z.string().optional(),
      privadaKey:  z.string().optional(),
      modo:        z.enum(['homo', 'prod']).optional(),
    }).parse(req.body);
    const update = { arcaConfigAt: new Date() };
    if (d.cuit !== undefined)       update.arcaCuit = d.cuit;
    if (d.certCrt !== undefined)    update.arcaCertCrt = d.certCrt;
    if (d.privadaKey !== undefined) update.arcaPrivadaKey = d.privadaKey;
    if (d.modo !== undefined)       update.arcaModo = d.modo;
    await prisma.company.update({ where: { id: req.params.id }, data: update });
    // Si cambió el modo, invalidamos los TAs cacheados de esta empresa (eran del modo anterior).
    if (d.modo !== undefined) {
      for (const k of _arcaTaCache.keys()) {
        if (k.startsWith(req.params.id + '::')) _arcaTaCache.delete(k);
      }
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Probar conexión: autentica con WSAA y hace heartbeat a WSFE en el ambiente
// configurado. Si las dos cosas responden OK, el cert está bien y el server WSFE
// del ambiente está accesible. (La asociación del cert al servicio WSFE/WSCTG
// se valida recién cuando hagas una operación real contra ellos.)
// ===== Cliente WSAA + WSCTG + WSFE (integración real con servidores AFIP/ARCA) =====
// URLs por servicio y ambiente. Configurable por env. El "modo" se elige por
// empresa (campo arcaModo) y aplica a TODOS los servicios.
const ARCA_URLS = {
  wsaa: {
    prod: process.env.ARCA_WSAA_PROD_URL || 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
    homo: process.env.ARCA_WSAA_HOMO_URL || 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
  },
  wsctg: {
    prod: process.env.ARCA_WSCTG_PROD_URL || 'https://serviciosjava.afip.gob.ar/wsctgv4/services/CTGService',
    homo: process.env.ARCA_WSCTG_HOMO_URL || 'https://fwshomo.afip.gov.ar/wsctgv4/services/CTGService',
  },
  wsfe: {
    prod: process.env.ARCA_WSFE_PROD_URL || 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
    homo: process.env.ARCA_WSFE_HOMO_URL || 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  },
  wscpe: {
    prod: process.env.ARCA_WSCPE_PROD_URL || 'https://serviciosjava.afip.gob.ar/wscpe/services/soap',
    homo: process.env.ARCA_WSCPE_HOMO_URL || 'https://fwshomo.afip.gov.ar/wscpe/services/soap',
  },
};
function _arcaUrl(servicio, modo) {
  const m = (modo === 'homo') ? 'homo' : 'prod';
  return ARCA_URLS[servicio]?.[m];
}
// Cache de Tickets de Acceso (TA) por (companyId, modo, service). TTL ~11h.
const _arcaTaCache = new Map();

async function _arcaForge() {
  try { return (await import('node-forge')).default; }
  catch { throw new Error('Falta la dependencia node-forge. En el servidor ejecutá: npm install node-forge'); }
}
function _arcaXmlEsc(s) {
  return String(s == null ? '' : s).replace(/[<>&"']/g, c =>
    ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":'&apos;' }[c]));
}
function _arcaXmlGet(xml, tag) {
  // Soporta prefijo de namespace: <ns:token>...</ns:token> o <token>...</token>
  const re = new RegExp(`<(?:[\\w-]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}
// Hora Argentina (UTC-3) en formato ISO con offset explícito (lo que pide AFIP).
function _arcaArgTime(d) {
  const arg = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${arg.getUTCFullYear()}-${p(arg.getUTCMonth()+1)}-${p(arg.getUTCDate())}T${p(arg.getUTCHours())}:${p(arg.getUTCMinutes())}:${p(arg.getUTCSeconds())}-03:00`;
}
// Arma el Ticket de Requerimiento de Acceso (TRA) para el servicio.
function _arcaCrearTRA(service) {
  const now = new Date();
  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${Math.floor(now.getTime()/1000)}</uniqueId>
    <generationTime>${_arcaArgTime(new Date(now.getTime() - 5*60*1000))}</generationTime>
    <expirationTime>${_arcaArgTime(new Date(now.getTime() + 30*60*1000))}</expirationTime>
  </header>
  <service>${service}</service>
</loginTicketRequest>`;
}
// Firma el TRA como CMS (PKCS#7) con el cert + key de la empresa.
async function _arcaFirmarTRA(tra, certPem, keyPem) {
  const forge = await _arcaForge();
  let cert, key;
  try { cert = forge.pki.certificateFromPem(certPem); }
  catch (e) { throw new Error('Certificado inválido: ' + e.message); }
  try { key = forge.pki.privateKeyFromPem(keyPem); }
  catch (e) { throw new Error('Clave privada inválida: ' + e.message); }
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, 'utf8');
  p7.addCertificate(cert);
  p7.addSigner({
    key, certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  });
  p7.sign({ detached: false });
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return forge.util.encode64(der);
}
// Llama a WSAA.loginCms con el TRA firmado y devuelve { token, sign, expirationTime }.
async function _arcaLoginWsaa(cmsBase64, modo) {
  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>${cmsBase64}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`;
  let res, xml;
  try {
    res = await fetch(_arcaUrl('wsaa', modo), {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '' },
      body: envelope,
    });
    xml = await res.text();
  } catch (e) {
    throw new Error('No se pudo conectar a WSAA: ' + e.message);
  }
  if (!res.ok) {
    const f = _arcaXmlGet(xml, 'faultstring') || xml.slice(0, 400);
    throw new Error(`WSAA error ${res.status}: ${f}`);
  }
  const loginReturn = _arcaXmlGet(xml, 'loginCmsReturn');
  if (!loginReturn) {
    const f = _arcaXmlGet(xml, 'faultstring');
    throw new Error('WSAA: ' + (f || 'respuesta sin loginCmsReturn — ' + xml.slice(0, 300)));
  }
  // El contenido de loginCmsReturn es XML escapado con &lt; etc.
  const inner = loginReturn
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
  const token = _arcaXmlGet(inner, 'token');
  const sign  = _arcaXmlGet(inner, 'sign');
  const exp   = _arcaXmlGet(inner, 'expirationTime');
  if (!token || !sign) throw new Error('WSAA: no se pudo extraer token/sign de la respuesta');
  return { token, sign, expirationTime: exp };
}
// Obtiene un TA (con cache) para una empresa + ambiente + servicio.
async function _arcaGetTA(companyId, service, certPem, keyPem, modo) {
  const k = `${companyId}::${modo || 'prod'}::${service}`;
  const cached = _arcaTaCache.get(k);
  if (cached && cached.expiresAt > Date.now()) return cached.ta;
  const tra = _arcaCrearTRA(service);
  const cms = await _arcaFirmarTRA(tra, certPem, keyPem);
  const ta  = await _arcaLoginWsaa(cms, modo);
  _arcaTaCache.set(k, { ta, expiresAt: Date.now() + 11 * 60 * 60 * 1000 });
  return ta;
}
// Heartbeat de WSFE (no requiere auth). Útil para confirmar que el server WSFE
// del ambiente elegido está respondiendo. Devuelve { AppServer, DbServer, AuthServer }.
async function _arcaWsfeDummy(modo) {
  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soap:Body>
    <ar:FEDummy/>
  </soap:Body>
</soap:Envelope>`;
  let res, xml;
  try {
    res = await fetch(_arcaUrl('wsfe', modo), {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': 'http://ar.gov.afip.dif.FEV1/FEDummy' },
      body: envelope,
    });
    xml = await res.text();
  } catch (e) {
    throw new Error('No se pudo conectar a WSFE: ' + e.message);
  }
  if (!res.ok) {
    const f = _arcaXmlGet(xml, 'faultstring') || xml.slice(0, 400);
    throw new Error(`WSFE error ${res.status}: ${f}`);
  }
  return {
    AppServer:  _arcaXmlGet(xml, 'AppServer')  || '?',
    DbServer:   _arcaXmlGet(xml, 'DbServer')   || '?',
    AuthServer: _arcaXmlGet(xml, 'AuthServer') || '?',
  };
}
// Consulta un CTG en WSCTG.consultarCTG. Devuelve detalles parseados.
async function _arcaConsultarCTG({ token, sign, cuit, ctgNumero, modo }) {
  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsc="http://impl.service.wsctg.afip.gov/wsctg/">
  <soapenv:Header/>
  <soapenv:Body>
    <wsc:consultarCTG>
      <wsc:request>
        <wsc:auth>
          <wsc:token>${_arcaXmlEsc(token)}</wsc:token>
          <wsc:sign>${_arcaXmlEsc(sign)}</wsc:sign>
          <wsc:cuitRepresentado>${_arcaXmlEsc(cuit)}</wsc:cuitRepresentado>
        </wsc:auth>
        <wsc:numeroCTG>${_arcaXmlEsc(String(ctgNumero))}</wsc:numeroCTG>
      </wsc:request>
    </wsc:consultarCTG>
  </soapenv:Body>
</soapenv:Envelope>`;
  let res, xml;
  try {
    res = await fetch(_arcaUrl('wsctg', modo), {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '' },
      body: envelope,
    });
    xml = await res.text();
  } catch (e) {
    throw new Error('No se pudo conectar a WSCTG: ' + e.message);
  }
  if (!res.ok) {
    const f = _arcaXmlGet(xml, 'faultstring') || xml.slice(0, 400);
    throw new Error(`WSCTG error ${res.status}: ${f}`);
  }
  // WSCTG suele devolver errores dentro del body con <arrayErrores>/<codigo>/<descripcion>.
  const errCod = _arcaXmlGet(xml, 'codigo');
  const errDsc = _arcaXmlGet(xml, 'descripcion');
  if (errCod && errCod !== '0' && errDsc) {
    throw new Error(`ARCA ${errCod}: ${errDsc}`);
  }
  // Extraer estado y kg con varios nombres posibles para robustez.
  const estado     = _arcaXmlGet(xml, 'estado') || _arcaXmlGet(xml, 'codigoEstado') || _arcaXmlGet(xml, 'estadoCTG');
  const estadoDesc = _arcaXmlGet(xml, 'descripcionEstado') || estado;
  const kg = _arcaXmlGet(xml, 'cantidadKgConfirmados')
          || _arcaXmlGet(xml, 'pesoNetoDescarga')
          || _arcaXmlGet(xml, 'pesoNetoConfirmado')
          || _arcaXmlGet(xml, 'kilosConfirmados')
          || _arcaXmlGet(xml, 'pesoNeto')
          || _arcaXmlGet(xml, 'cantidadKg');
  return {
    ctg: ctgNumero,
    estado: estado || null,
    estadoDescripcion: estadoDesc || estado || 'Consultado',
    kgRecibidos: kg ? Number(kg) : null,
  };
}

// Probar conexión a WSAA con el cert configurado.
app.post('/api/empresas/:id/arca/probar', async (req, res, next) => {
  try {
    const m = req.user.userCompanies.find((uc) => uc.companyId === req.params.id);
    if (!m && !req.user.superAdmin) return res.status(403).json({ ok: false, error: 'Sin acceso' });
    const c = await prisma.company.findUnique({
      where: { id: req.params.id },
      select: { arcaCuit: true, arcaCertCrt: true, arcaPrivadaKey: true, arcaModo: true },
    });
    if (!c?.arcaCertCrt || !c?.arcaPrivadaKey || !c?.arcaCuit) {
      return res.status(400).json({ ok: false, error: 'Faltan archivos o CUIT. Completá el Paso 3 antes de probar.' });
    }
    const modo = c.arcaModo || 'prod';
    // WSAA: invalidamos cache y forzamos un login fresco contra el ambiente correcto.
    _arcaTaCache.delete(`${req.params.id}::${modo}::wsfe`);
    let wsaaOk = false, wsaaErr = null, expTime = null;
    try {
      const ta = await _arcaGetTA(req.params.id, 'wsfe', c.arcaCertCrt, c.arcaPrivadaKey, modo);
      wsaaOk = true; expTime = ta.expirationTime;
    } catch (e) { wsaaErr = e.message; }
    // WSFE Dummy: heartbeat al server (no requiere auth).
    let wsfeStatus = null, wsfeErr = null;
    try { wsfeStatus = await _arcaWsfeDummy(modo); }
    catch (e) { wsfeErr = e.message; }
    const wsfeOk = !!(wsfeStatus && wsfeStatus.AppServer === 'OK' && wsfeStatus.DbServer === 'OK' && wsfeStatus.AuthServer === 'OK');
    const ambienteLbl = modo === 'homo' ? 'HOMOLOGACIÓN' : 'PRODUCCIÓN';
    const mensaje = (wsaaOk && wsfeOk)
      ? `Conexión OK · ambiente ${ambienteLbl}. WSAA token hasta ${expTime || '?'}. WSFE: App/Db/Auth ${wsfeStatus.AppServer}/${wsfeStatus.DbServer}/${wsfeStatus.AuthServer}.`
      : `Hay problemas en ${ambienteLbl}: ${[wsaaErr && 'WSAA → '+wsaaErr, wsfeErr && 'WSFE → '+wsfeErr].filter(Boolean).join(' · ')}`;
    res.json({
      ok: wsaaOk && wsfeOk,
      modo, mensaje,
      wsaa: { ok: wsaaOk, error: wsaaErr, expirationTime: expTime },
      wsfe: { ok: wsfeOk, error: wsfeErr, status: wsfeStatus },
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Consulta uno o varios CTGs reales en ARCA.
app.post('/api/empresas/:id/arca/consultar-ctg', async (req, res, next) => {
  try {
    const m = req.user.userCompanies.find((uc) => uc.companyId === req.params.id);
    if (!m && !req.user.superAdmin) return res.status(403).json({ ok: false, error: 'Sin acceso' });
    const c = await prisma.company.findUnique({
      where: { id: req.params.id },
      select: { arcaCuit: true, arcaCertCrt: true, arcaPrivadaKey: true, arcaModo: true },
    });
    if (!c?.arcaCertCrt || !c?.arcaPrivadaKey || !c?.arcaCuit) {
      return res.status(400).json({ ok: false, error: 'ARCA no configurado.' });
    }
    const modo = c.arcaModo || 'prod';
    const body = z.object({
      viajeIds: z.array(z.string()).optional(),
      ctg: z.string().optional(),
    }).parse(req.body);

    const ta = await _arcaGetTA(req.params.id, 'wsctg', c.arcaCertCrt, c.arcaPrivadaKey, modo);

    if (body.viajeIds?.length) {
      const viajes = await prisma.viaje.findMany({
        where: { id: { in: body.viajeIds }, companyId: req.params.id },
        select: { id: true, ctg: true, cartaPorte: true, cantidad: true },
      });
      const resultados = [];
      for (const v of viajes) {
        const ctgNumero = v.ctg || v.cartaPorte;
        if (!ctgNumero) {
          resultados.push({ viajeId: v.id, error: 'Sin CTG / Carta de Porte cargado' });
          continue;
        }
        try {
          const data = await _arcaConsultarCTG({ token: ta.token, sign: ta.sign, cuit: c.arcaCuit, ctgNumero, modo });
          resultados.push({ viajeId: v.id, ...data });
        } catch (e) {
          resultados.push({ viajeId: v.id, ctg: ctgNumero, error: e.message });
        }
      }
      return res.json({ ok: true, data: resultados });
    }
    if (body.ctg) {
      const data = await _arcaConsultarCTG({ token: ta.token, sign: ta.sign, cuit: c.arcaCuit, ctgNumero: body.ctg, modo });
      return res.json({ ok: true, data });
    }
    res.status(400).json({ ok: false, error: 'Falta viajeIds o ctg en el body' });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ---------- ROLES ----------
const roleSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  description: z.string().nullable().optional(),
  permissions: z.array(z.string()),
  // Categorías de producto visibles en Stock (vacío/null = todas).
  stockCategorias: z.array(z.string()).nullable().optional(),
});

app.get('/api/roles', async (_req, res, next) => {
  try { res.json({ ok: true, data: await prisma.role.findMany({ orderBy: { label: 'asc' } }) }); }
  catch (e) { next(e); }
});

// Devuelve true si el user es Super Admin O Administrador (role.key === 'admin')
// en AL MENOS UNA empresa. Se usa para roles (que son globales del sistema):
// alcanza con ser admin en alguna empresa para poder gestionarlos.
function _esAdminEnAlguna(req) {
  if (req.user?.superAdmin) return true;
  return (req.user?.userCompanies || []).some(uc =>
    uc.role?.key === 'admin' || (uc.role?.permissions || []).includes('*:*')
  );
}

app.post('/api/roles', async (req, res, next) => {
  try {
    if (!_esAdminEnAlguna(req)) return res.status(403).json({ ok: false, error: 'Solo Super Admin o Administradores pueden crear roles' });
    const role = await prisma.role.create({ data: roleSchema.parse(req.body) });
    res.status(201).json({ ok: true, data: role });
  } catch (e) { next(e); }
});

app.put('/api/roles/:id', async (req, res, next) => {
  try {
    if (!_esAdminEnAlguna(req)) return res.status(403).json({ ok: false, error: 'Solo Super Admin o Administradores pueden editar roles' });
    const existing = await prisma.role.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    // Solo el rol Administrador (acceso total) no se puede modificar; el resto sí.
    if (existing.key === 'admin') return res.status(400).json({ ok: false, error: 'El rol Administrador no se puede modificar (es el rol base de acceso total).' });
    const data = roleSchema.partial().parse(req.body);
    res.json({ ok: true, data: await prisma.role.update({ where: { id: req.params.id }, data }) });
  } catch (e) { next(e); }
});

// Borrado de rol.
// Reglas:
//   1) Super Admin o Admin en alguna empresa pueden borrar
//   2) Roles "builtin" (admin, contable, operaciones, lectura) no se borran
//   3) Si hay UserCompany usando este rol → rechazar y avisar cuántos
//      usuarios lo tienen. La opción "force" reasigna esos usuarios al rol
//      de "lectura" (mínimos permisos) antes de borrar.
app.delete('/api/roles/:id', async (req, res, next) => {
  try {
    if (!_esAdminEnAlguna(req)) return res.status(403).json({ ok: false, error: 'Solo Super Admin o Administradores pueden borrar roles' });
    const r = await prisma.role.findUnique({ where: { id: req.params.id } });
    if (!r) return res.status(404).json({ ok: false, error: 'No encontrado' });
    // Builtin roles: solo el Super Admin puede borrarlos (los Admin no).
    // Los Super Admin habilitan esto para poder limpiar la base al implementar
    // en un cliente y dejar solo los roles que el cliente realmente usa.
    if (r.builtin && !req.user.superAdmin) {
      return res.status(400).json({ ok: false, error: 'Rol de sistema (admin, contable, operaciones, lectura). Solo el Super Admin puede borrarlo.' });
    }
    // Si el rol es "admin" no se puede borrar nunca — sin él, ningún Administrador
    // podría seguir gestionando empresas / usuarios / roles, quedando el sistema
    // con solo Super Admin manejando todo.
    if (r.key === 'admin') {
      return res.status(400).json({ ok: false, error: 'El rol "Administrador" no se puede borrar — es el rol base que necesitan los administradores de empresa para operar.' });
    }

    // Verificar uso actual del rol
    const enUso = await prisma.userCompany.count({ where: { roleId: req.params.id } });
    const force = String(req.query.force || '') === '1';
    if (enUso > 0 && !force) {
      return res.status(409).json({
        ok: false,
        error: `El rol "${r.label}" está siendo usado por ${enUso} ${enUso === 1 ? 'usuario' : 'usuarios'}. Por seguridad no se borra automáticamente.`,
        tieneRelacionados: true,
        enUso,
        sugerencia: 'Reasigná esos usuarios a otro rol primero (Usuarios → Editar). Si igual querés borrarlo, podés forzar y todos esos accesos quedarán con el rol "Lectura" (mínimos permisos).',
      });
    }

    if (force && enUso > 0) {
      // Reasignar todos los UserCompany que usaban este rol al rol "lectura"
      const lectura = await prisma.role.findFirst({ where: { key: 'lectura' } });
      if (!lectura) {
        return res.status(500).json({ ok: false, error: 'No se encontró el rol "lectura" base para reasignar. Pedile a soporte que verifique los roles del sistema.' });
      }
      await prisma.userCompany.updateMany({ where: { roleId: req.params.id }, data: { roleId: lectura.id } });
    }
    await prisma.role.delete({ where: { id: req.params.id } });
    res.json({ ok: true, forzado: force && enUso > 0 });
  } catch (e) { next(e); }
});

// ---------- USUARIOS ----------
function canManageUsers(req) {
  if (req.user.superAdmin) return true;
  if (!req.companyId) return false;
  const m = req.user.userCompanies.find((uc) => uc.companyId === req.companyId);
  const perms = m?.role?.permissions || [];
  return perms.includes('*:*') || perms.includes('usuarios:*') || perms.includes('usuarios:update');
}

app.get('/api/usuarios', async (req, res, next) => {
  try {
    if (!canManageUsers(req)) return res.status(403).json({ ok: false, error: 'Sin permisos' });
    // Filtro base: super admins ven todos los usuarios; el resto solo los de sus empresas.
    const baseWhere = req.user.superAdmin ? {} : { userCompanies: { some: { companyId: req.companyId } } };
    // Usuarios "ocultos" son invisibles para todos salvo el propio user.
    // Esto permite que un mantenedor del sistema (ej. soporte) tenga un acceso
    // de emergencia que ningun otro super admin pueda borrar o ver.
    const where = { AND: [ baseWhere, { OR: [ { oculto: false }, { id: req.user.id } ] } ] };
    const users = await prisma.user.findMany({
      where,
      include: { userCompanies: { include: { role: true, company: true } } },
      orderBy: { email: 'asc' },
    });
    res.json({
      ok: true,
      data: users.map((u) => ({
        id: u.id, email: u.email, alias: u.alias || null,
        nombre: u.nombre, apellido: u.apellido,
        fotoUrl: u.fotoUrl || null,
        activo: u.activo, superAdmin: u.superAdmin,
        oculto: u.oculto || false,
        empleadoId: u.empleadoId || null,
        choferId: u.choferId || null,
        memberships: u.userCompanies.map((uc) => ({
          companyId: uc.companyId, companyName: uc.company.name,
          roleId: uc.roleId, roleKey: uc.role.key, roleLabel: uc.role.label,
        })),
      })),
    });
  } catch (e) { next(e); }
});

app.post('/api/usuarios', async (req, res, next) => {
  try {
    if (!canManageUsers(req)) return res.status(403).json({ ok: false, error: 'Sin permisos' });
    const schema = z.object({
      email: z.string().email(),
      alias: z.string().nullable().optional(),
      nombre: z.string().min(1),
      apellido: z.string().nullable().optional(),
      fotoUrl: z.string().nullable().optional(),
      password: z.string().min(1),
      activo: z.boolean().optional(),
      superAdmin: z.boolean().optional(),
      empleadoId: z.string().nullable().optional(),
      choferId: z.string().nullable().optional(),
      memberships: z.array(z.object({ companyId: z.string(), roleId: z.string() })).optional(),
    });
    const input = schema.parse(req.body);
    const user = await prisma.user.create({
      data: {
        email: input.email.toLowerCase(),
        alias: input.alias ? input.alias.trim() : null,
        nombre: input.nombre,
        apellido: input.apellido,
        fotoUrl: input.fotoUrl || null,
        passwordHash: await bcrypt.hash(input.password, 10),
        activo: input.activo !== false,
        superAdmin: !!input.superAdmin && req.user.superAdmin,
        empleadoId: input.empleadoId || null,
        choferId: input.choferId || null,
        userCompanies: input.memberships ? { create: input.memberships } : undefined,
      },
    });
    res.status(201).json({ ok: true, data: { id: user.id, email: user.email } });
  } catch (e) { next(e); }
});

app.put('/api/usuarios/:id', async (req, res, next) => {
  try {
    if (!canManageUsers(req)) return res.status(403).json({ ok: false, error: 'Sin permisos' });
    const schema = z.object({
      nombre: z.string().optional(),
      alias: z.string().nullable().optional(),
      apellido: z.string().nullable().optional(),
      fotoUrl: z.string().nullable().optional(),
      activo: z.boolean().optional(),
      superAdmin: z.boolean().optional(),
      empleadoId: z.string().nullable().optional(),
      choferId: z.string().nullable().optional(),
      memberships: z.array(z.object({ companyId: z.string(), roleId: z.string() })).optional(),
    });
    const input = schema.parse(req.body);
    const { memberships, ...data } = input;
    if (data.alias !== undefined) data.alias = data.alias ? data.alias.trim() : null;
    if (data.superAdmin !== undefined && !req.user.superAdmin) delete data.superAdmin;
    // Actualizar datos básicos del usuario
    const user = await prisma.user.update({ where: { id: req.params.id }, data });
    // Reemplazar memberships si vienen en el body
    if (Array.isArray(memberships)) {
      await prisma.userCompany.deleteMany({ where: { userId: req.params.id } });
      if (memberships.length > 0) {
        await prisma.userCompany.createMany({
          data: memberships.map(m => ({ userId: req.params.id, companyId: m.companyId, roleId: m.roleId })),
        });
      }
    }
    res.json({ ok: true, data: { id: user.id, email: user.email } });
  } catch (e) { next(e); }
});

app.post('/api/usuarios/:id/reset-password', async (req, res, next) => {
  try {
    if (!canManageUsers(req)) return res.status(403).json({ ok: false, error: 'Sin permisos' });
    const { newPassword } = z.object({ newPassword: z.string().min(1) }).parse(req.body);
    await prisma.user.update({ where: { id: req.params.id }, data: { passwordHash: await bcrypt.hash(newPassword, 10) } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post('/api/usuarios/assign', async (req, res, next) => {
  try {
    if (!canManageUsers(req)) return res.status(403).json({ ok: false, error: 'Sin permisos' });
    const { userId, companyId, roleId } = z.object({
      userId: z.string(), companyId: z.string(), roleId: z.string(),
    }).parse(req.body);
    const m = await prisma.userCompany.upsert({
      where: { userId_companyId: { userId, companyId } },
      create: { userId, companyId, roleId },
      update: { roleId },
    });
    res.json({ ok: true, data: m });
  } catch (e) { next(e); }
});

// Borrado de usuario. Necesita varias salvaguardas porque un User borrado mal
// puede romper movimientos, ctas corrientes y cualquier cosa que tenga FK al
// usuario. Reglas:
//   1) Solo super admin puede borrar (no alcanza con manageUsers)
//   2) No te podes borrar a vos mismo
//   3) No se puede borrar al ultimo super admin del sistema
//   4) Si el usuario tiene registros relacionados (movimientos, cheques, etc.)
//      se rechaza el borrado y se sugiere desactivarlo. El cliente puede
//      forzar pasando ?force=1 — eso borra primero todos los registros
//      dependientes en cascada (UserCompany, UserPreference) y deja los
//      registros donde el user es solo "autor" (Movimiento.userId) en null.
app.delete('/api/usuarios/:id', async (req, res, next) => {
  try {
    if (!req.user?.superAdmin) {
      return res.status(403).json({ ok: false, error: 'Solo el Super Admin puede borrar usuarios' });
    }
    const targetId = req.params.id;
    if (targetId === req.user.id) {
      return res.status(400).json({ ok: false, error: 'No te podés borrar a vos mismo. Pediéle a otro super admin que lo haga, o desactivá tu cuenta.' });
    }
    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });

    // Usuarios "ocultos" no se pueden borrar (ni siquiera por otros super admins).
    // Es el ancla del mantenedor del sistema — solo el propio user puede desactivarse
    // el flag oculto desde su perfil y, una vez visible, recién ahí lo puede borrar.
    if (target.oculto && targetId !== req.user.id) {
      return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    }

    // Si el target es super admin, validar que quede al menos uno
    if (target.superAdmin) {
      const otrosSupers = await prisma.user.count({ where: { superAdmin: true, id: { not: targetId }, activo: true } });
      if (otrosSupers === 0) {
        return res.status(400).json({ ok: false, error: 'No se puede borrar al último Super Admin activo del sistema. Creá otro antes, o desactivá este usuario en vez de borrarlo.' });
      }
    }

    const force = String(req.query.force || '') === '1';

    // Intentar borrado simple primero. Si falla por FK constraint, ofrecer force.
    try {
      // Limpiar dependencias "propias" del user (UserCompany memberships, UserPreference)
      await prisma.userCompany.deleteMany({ where: { userId: targetId } });
      try { await prisma.userPreference.deleteMany({ where: { userId: targetId } }); } catch {}
      await prisma.user.delete({ where: { id: targetId } });
      return res.json({ ok: true });
    } catch (e) {
      // P2003 = foreign key constraint violation
      const msg = String(e?.message || e);
      const isFK = e?.code === 'P2003' || /Foreign key constraint|violates foreign key/i.test(msg);
      if (!isFK) throw e;
      if (!force) {
        return res.status(409).json({
          ok: false,
          error: 'El usuario tiene registros asociados (movimientos, cheques u otros). Por seguridad no se borra automáticamente.',
          tieneRelacionados: true,
          sugerencia: 'Te recomendamos DESACTIVAR el usuario (no podrá loguearse, pero queda la trazabilidad). Si querés borrarlo igual, los movimientos asociados quedarán SIN AUTOR registrado.',
        });
      }
      // Force: limpiar todas las FK "soft" (donde el user es solo autor)
      // poniendo userId = null en las tablas que lo permitan.
      try { await prisma.movimiento.updateMany({ where: { userId: targetId }, data: { userId: null } }); } catch {}
      // Ahora reintentar el delete
      await prisma.user.delete({ where: { id: targetId } });
      return res.json({ ok: true, forzado: true });
    }
  } catch (e) { next(e); }
});

// ============================================================
// FACTORIA CRUD GENERICA (empresa-scoped)
// ============================================================
function mountCrud({ path, modelName, perm, schema, orderBy = { createdAt: 'desc' }, include, searchFields = [], injectUserId = false, readOpen = false, dependencias = [], bloquearSi = null }) {
  const full = `/api/${path}`;
  const model = () => prisma[modelName];
  // readOpen = true → la LECTURA (GET) queda disponible para cualquier usuario de la
  // empresa (datos maestros/referencia que casi todos los modulos necesitan leer,
  // ej. Catalogos). La escritura sigue exigiendo el permiso del area.
  const readGuard = readOpen ? ((req, res, next) => next()) : requirePermission(`${perm}:read`);

  app.get(full, requireCompany, readGuard, async (req, res, next) => {
    try {
      const where = { companyId: req.companyId };
      const q = req.query.q?.toString().trim();
      if (q && searchFields.length) {
        where.OR = searchFields.map((f) => ({ [f]: { contains: q, mode: 'insensitive' } }));
      }
      res.json({ ok: true, data: await model().findMany({ where, orderBy, include }) });
    } catch (e) { next(e); }
  });

  app.get(`${full}/:id`, requireCompany, readGuard, async (req, res, next) => {
    try {
      const row = await model().findFirst({ where: { id: req.params.id, companyId: req.companyId }, include });
      if (!row) return res.status(404).json({ ok: false, error: 'No encontrado' });
      res.json({ ok: true, data: row });
    } catch (e) { next(e); }
  });

  app.post(full, requireCompany, requirePermission(`${perm}:create`), async (req, res, next) => {
    try {
      const data = schema.parse(req.body);
      const payload = { ...data, companyId: req.companyId };
      if (injectUserId) payload.userId = req.user?.id || null;
      const row = await model().create({ data: payload, include });
      res.status(201).json({ ok: true, data: row });
    } catch (e) { next(e); }
  });

  app.put(`${full}/:id`, requireCompany, requirePermission(`${perm}:update`), async (req, res, next) => {
    try {
      const existing = await model().findFirst({ where: { id: req.params.id, companyId: req.companyId } });
      if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
      const data = schema.partial().parse(req.body);
      res.json({ ok: true, data: await model().update({ where: { id: req.params.id }, data, include }) });
    } catch (e) { next(e); }
  });

  app.delete(`${full}/:id`, requireCompany, requirePermission(`${perm}:delete`), async (req, res, next) => {
    try {
      const existing = await model().findFirst({ where: { id: req.params.id, companyId: req.companyId } });
      if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
      // Bloqueo por estado del propio registro (ej. cheque ya usado, arrendamiento con cuotas pagadas).
      if (typeof bloquearSi === 'function') {
        const motivo = await bloquearSi(existing, req);
        if (motivo) return res.status(400).json({ ok: false, error: `No se puede eliminar: ${motivo}.` });
      }
      // Bloqueo por dependencias (registros hijos que quedarían huérfanos o se borrarían).
      const bloq = await _contarDependencias(req.companyId, req.params.id, dependencias);
      if (bloq.length) return res.status(400).json({ ok: false, error: `No se puede eliminar porque tiene ${bloq.join(' · ')}. Primero eliminá o reasigná esos registros.` });
      await model().delete({ where: { id: req.params.id } });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
}

// Cuenta registros dependientes. `deps` = [{ model, where:(id)=>({...}), label, sinCompany }].
// Devuelve un array de strings "N label" para los que tengan al menos 1.
async function _contarDependencias(companyId, id, deps) {
  const out = [];
  for (const d of (deps || [])) {
    const where = d.sinCompany ? d.where(id) : { companyId, ...d.where(id) };
    const n = await prisma[d.model].count({ where });
    if (n > 0) out.push(`${n} ${d.label}`);
  }
  return out;
}

// ---------- STOCK ----------
mountCrud({
  path: 'productos', modelName: 'producto', perm: 'stock',
  schema: z.object({
    categoria: z.string().min(1),
    nombre: z.string().min(1),
    unidad: z.string().min(1),
    stockMinimo: z.number().optional(),
    precioReferencia: z.number().nullable().optional(),
    categoriaHacienda: z.string().nullable().optional(),
    observaciones: z.string().nullable().optional(),
    activo: z.boolean().optional(),
    // v2.8.0 — atributos de artículo (estándar ERP)
    sku: z.string().nullable().optional(),
    codigoBarras: z.string().nullable().optional(),
    ivaDefault: z.number().nullable().optional(),
    tipoArticulo: z.string().nullable().optional(),
    categoriaArticuloId: z.string().nullable().optional(),
  }),
  orderBy: { nombre: 'asc' },
  searchFields: ['nombre', 'categoria', 'sku', 'codigoBarras'],
  dependencias: [
    { model: 'movimiento', where: (id) => ({ productoId: id }), label: 'movimientos de stock' },
  ],
});

// ============================================================
// v2.8.0 — Árbol de CATEGORÍAS/FAMILIAS de artículos (padre/hijo), editable por
// empresa. CRUD estándar + endpoint de siembra (crea el árbol agro por defecto
// y mapea los productos existentes por su categoría plana).
// ============================================================
mountCrud({
  path: 'categorias-articulo', modelName: 'categoriaArticulo', perm: 'catalogos',
  schema: z.object({
    nombre: z.string().min(1),
    padreId: z.string().nullable().optional(),
    icono: z.string().nullable().optional(),
    orden: z.number().int().optional(),
    activo: z.boolean().optional(),
  }),
  orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
  searchFields: ['nombre'],
  readOpen: true,   // leer abierto a cualquier usuario; crear/editar/borrar requiere 'catalogos'
});

// Al borrar un nodo, dejamos a sus hijos como raíz y desvinculamos los productos
// (no hay FK en la base; lo hacemos a mano para no dejar referencias colgadas).
app.post('/api/categorias-articulo/:id/preparar-borrado', requireCompany, requirePermission('catalogos:delete'), async (req, res, next) => {
  try {
    const id = req.params.id;
    await prisma.$transaction([
      prisma.categoriaArticulo.updateMany({ where: { companyId: req.companyId, padreId: id }, data: { padreId: null } }),
      prisma.producto.updateMany({ where: { companyId: req.companyId, categoriaArticuloId: id }, data: { categoriaArticuloId: null } }),
    ]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Mapea la categoría plana de un producto a la familia madre del árbol.
function _familiaMadreDeCategoria(cat) {
  const c = (cat || '').toLowerCase().trim();
  if (['granos', 'grano', 'cereales', 'cereal'].includes(c)) return 'Cereales / Granos';
  if (c === 'hacienda') return 'Animales';
  if (['servicios', 'servicio', 'labor', 'labores', 'flete', 'fletes'].includes(c)) return 'Servicios y Labores';
  if (['insumos', 'insumo', 'combustibles', 'combustible'].includes(c)) return 'Insumos';
  return 'Otros';
}
function _tipoArticuloDeCategoria(cat) {
  const c = (cat || '').toLowerCase().trim();
  if (['granos', 'grano', 'cereales', 'cereal'].includes(c)) return 'cereal';
  if (['servicios', 'servicio', 'labor', 'labores', 'flete', 'fletes'].includes(c)) return 'servicio';
  return 'stockeable';
}

// Siembra el árbol agro por defecto para una empresa (solo si está vacío) y
// mapea los productos existentes a su familia madre + les setea el tipo de artículo.
app.post('/api/categorias-articulo/sembrar', requireCompany, requirePermission('catalogos:create'), async (req, res, next) => {
  try {
    const force = req.query.force === '1' || req.body?.force === true;
    const yaHay = await prisma.categoriaArticulo.count({ where: { companyId: req.companyId } });
    if (yaHay > 0 && !force) return res.json({ ok: true, sembrado: false, total: yaHay });

    // Las FAMILIAS de Insumos y Animales salen de los catálogos reales de la empresa
    // (Tipos de insumo y Especies), así el árbol refleja su clasificación existente.
    const cats = await prisma.catalogo.findMany({ where: { companyId: req.companyId, activo: true } });
    const uniqOrd = (arr) => [...new Set(arr.map(x => (x || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    // Semillas es su propia categoría (no una familia de Insumos). Curasemilla sí es insumo.
    const esSemilla = (n) => /^semillas?$/i.test((n || '').trim());
    const tipos = uniqOrd(cats.filter(c => c.tipo === 'Tipo de insumo').map(c => c.nombre)).filter(n => !esSemilla(n));
    const especies = uniqOrd(cats.filter(c => c.tipo === 'Especie').map(c => c.nombre));
    const insumosHijos  = tipos.length    ? tipos    : ['Herbicidas', 'Insecticidas', 'Fungicidas', 'Fertilizantes', 'Coadyuvantes', 'Combustibles y Lubricantes'];
    const haciendaHijos = especies.length ? especies : ['Bovinos', 'Ovinos', 'Caprinos', 'Equinos', 'Porcinos'];

    // Categoría (raíz) -> Familias (hijos). Producto/Item queda en el 3er nivel (catálogo).
    const arbol = [
      { nombre: 'Insumos', icono: '🌱', hijos: insumosHijos },
      { nombre: 'Cereales / Granos', icono: '🌾', hijos: ['Fina', 'Gruesa'] },
      { nombre: 'Animales', icono: '🐄', hijos: haciendaHijos },
      { nombre: 'Servicios y Labores', icono: '🚜', hijos: ['De Campaña', 'De Animales', 'Externos'] },
      { nombre: 'Otros', icono: '📦', hijos: [] },
    ];
    const madres = {};
    await prisma.$transaction(async (tx) => {
      if (force) {
        // Regenerar: desvinculamos productos y catálogos, y borramos el árbol previo.
        await tx.producto.updateMany({ where: { companyId: req.companyId }, data: { categoriaArticuloId: null } });
        try { await tx.catalogo.updateMany({ where: { companyId: req.companyId }, data: { categoriaArticuloId: null } }); } catch {}
        await tx.categoriaArticulo.deleteMany({ where: { companyId: req.companyId } });
      }
      let orden = 0;
      for (const fam of arbol) {
        const madre = await tx.categoriaArticulo.create({ data: {
          companyId: req.companyId, nombre: fam.nombre, icono: fam.icono, orden: orden++, activo: true,
        }});
        madres[fam.nombre] = madre.id;
        let ordenHijo = 0;
        for (const hijo of fam.hijos) {
          await tx.categoriaArticulo.create({ data: {
            companyId: req.companyId, nombre: hijo, padreId: madre.id, orden: ordenHijo++, activo: true,
          }});
        }
      }
      // Mapear productos existentes a su categoría madre + tipo de artículo.
      const prods = await tx.producto.findMany({ where: { companyId: req.companyId } });
      for (const p of prods) {
        const madreNombre = _familiaMadreDeCategoria(p.categoria);
        const madreId = madres[madreNombre] || madres['Otros'];
        await tx.producto.update({ where: { id: p.id }, data: {
          categoriaArticuloId: p.categoriaArticuloId || madreId,
          tipoArticulo: p.tipoArticulo || _tipoArticuloDeCategoria(p.categoria),
        }});
      }
      // Vincular items del catálogo (Herbicida, Fertilizante, Bovino...) a la familia
      // del árbol que tenga ese mismo nombre (su "tipo" o especie).
      const nodos = await tx.categoriaArticulo.findMany({ where: { companyId: req.companyId } });
      const byName = {}; nodos.forEach(n => { byName[(n.nombre||'').trim().toLowerCase()] = n.id; });
      const items = await tx.catalogo.findMany({ where: { companyId: req.companyId } });
      for (const it of items) {
        const fid = byName[(it.tipo||'').trim().toLowerCase()];
        if (fid) { try { await tx.catalogo.update({ where: { id: it.id }, data: { categoriaArticuloId: fid } }); } catch {} }
      }
    });
    const total = await prisma.categoriaArticulo.count({ where: { companyId: req.companyId } });
    res.json({ ok: true, sembrado: true, total, regenerado: force });
  } catch (e) { next(e); }
});

// Vincula los items del catálogo y los productos a las familias del árbol SIN
// recrear el árbol (backfill no destructivo). Ideal para enganchar lo ya cargado.
app.post('/api/categorias-articulo/vincular', requireCompany, requirePermission('catalogos:create'), async (req, res, next) => {
  try {
    const nodos = await prisma.categoriaArticulo.findMany({ where: { companyId: req.companyId } });
    if (!nodos.length) return res.json({ ok: true, catalogos: 0, productos: 0, sinArbol: true });
    const byName = {}; nodos.forEach(n => { byName[(n.nombre||'').trim().toLowerCase()] = n.id; });
    const roots = {}; nodos.filter(n => !n.padreId).forEach(n => { roots[(n.nombre||'').trim().toLowerCase()] = n.id; });
    let cats = 0, prods = 0;
    await prisma.$transaction(async (tx) => {
      const items = await tx.catalogo.findMany({ where: { companyId: req.companyId } });
      for (const it of items) {
        if (it.categoriaArticuloId) continue;
        const fid = byName[(it.tipo||'').trim().toLowerCase()];
        if (fid) { await tx.catalogo.update({ where: { id: it.id }, data: { categoriaArticuloId: fid } }); cats++; }
      }
      const productos = await tx.producto.findMany({ where: { companyId: req.companyId, categoriaArticuloId: null } });
      for (const p of productos) {
        const madreId = roots[_familiaMadreDeCategoria(p.categoria).trim().toLowerCase()] || roots['otros'];
        if (madreId) { await tx.producto.update({ where: { id: p.id }, data: { categoriaArticuloId: madreId, tipoArticulo: p.tipoArticulo || _tipoArticuloDeCategoria(p.categoria) } }); prods++; }
      }
    });
    res.json({ ok: true, catalogos: cats, productos: prods });
  } catch (e) { next(e); }
});

// ---------- CATEGORÍAS DE GASTO (árbol padre/hijo, para Movimientos Diarios) ----------
mountCrud({
  path: 'categorias-gasto', modelName: 'categoriaGasto', perm: 'finanzas',
  schema: z.object({
    nombre: z.string().min(1),
    padreId: z.string().nullable().optional(),
    icono: z.string().nullable().optional(),
    orden: z.number().int().optional(),
    activo: z.boolean().optional(),
  }),
  orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
  searchFields: ['nombre'],
  readOpen: true,   // leer abierto; crear/editar/borrar requiere 'finanzas'
});

// Al borrar un nodo del árbol de gastos, sus hijos quedan como raíz (sin dato colgado).
app.post('/api/categorias-gasto/:id/preparar-borrado', requireCompany, requirePermission('finanzas:delete'), async (req, res, next) => {
  try {
    await prisma.categoriaGasto.updateMany({ where: { companyId: req.companyId, padreId: req.params.id }, data: { padreId: null } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Siembra el árbol de gastos por defecto (solo si está vacío) e importa las categorías
// de gasto ya usadas (catálogo 'Categoría de gasto') como familias dentro de 'Empresa'.
app.post('/api/categorias-gasto/sembrar', requireCompany, requirePermission('finanzas:create'), async (req, res, next) => {
  try {
    const force = req.query.force === '1' || req.body?.force === true;
    const yaHay = await prisma.categoriaGasto.count({ where: { companyId: req.companyId } });
    if (yaHay > 0 && !force) return res.json({ ok: true, sembrado: false, total: yaHay });

    // Categorías de gasto ya usadas (del catálogo) -> se migran como familias de "Empresa".
    const cats = await prisma.catalogo.findMany({ where: { companyId: req.companyId, tipo: 'Categoría de gasto', activo: true } });
    const usadas = [...new Set(cats.map(c => (c.nombre || '').trim()).filter(Boolean))];
    const empresaBase = ['Combustible', 'Insumos', 'Repuestos', 'Servicios', 'Impuestos', 'Honorarios', 'Sueldos', 'Fletes', 'Taller'];
    const empresaHijos = [...new Set([...empresaBase, ...usadas])].sort((a, b) => a.localeCompare(b));
    const arbol = [
      { nombre: 'Empresa', icono: '🏢', hijos: empresaHijos },
      { nombre: 'Gastos familiares', icono: '🏠', hijos: ['Alimentación', 'Impuestos y tasas', 'Educación', 'Salud', 'Servicios del hogar', 'Otros'] },
      { nombre: 'Otros', icono: '📦', hijos: [] },
    ];
    await prisma.$transaction(async (tx) => {
      if (force) await tx.categoriaGasto.deleteMany({ where: { companyId: req.companyId } });
      let orden = 0;
      for (const cat of arbol) {
        const madre = await tx.categoriaGasto.create({ data: {
          companyId: req.companyId, nombre: cat.nombre, icono: cat.icono, orden: orden++, activo: true,
        }});
        let ordenHijo = 0;
        for (const hijo of cat.hijos) {
          await tx.categoriaGasto.create({ data: {
            companyId: req.companyId, nombre: hijo, padreId: madre.id, orden: ordenHijo++, activo: true,
          }});
        }
      }
    });
    const total = await prisma.categoriaGasto.count({ where: { companyId: req.companyId } });
    res.json({ ok: true, sembrado: true, total, regenerado: force });
  } catch (e) { next(e); }
});

mountCrud({
  path: 'movimientos', modelName: 'movimiento', perm: 'stock',
  schema: z.object({
    productoId: z.string(),
    fecha: z.coerce.date(),
    tipo: z.enum(['ingreso', 'egreso']),
    motivo: z.string().min(1),
    cantidad: z.number(),
    precio: z.number().nullable().optional(),
    total: z.number().nullable().optional(),
    contraparteId: z.string().nullable().optional(),
    contraparteTipo: z.string().nullable().optional(),
    referencia: z.string().nullable().optional(),
    observaciones: z.string().nullable().optional(),
    depositoId: z.string().nullable().optional(),
    campanaId: z.string().nullable().optional(),   // campaña del grano (para rinde real)
  }),
  orderBy: { fecha: 'desc' },
  include: { producto: true, user: { select: { id: true, nombre: true, apellido: true, alias: true } }, deposito: { select: { id: true, nombre: true, tipo: true } } },
  searchFields: ['motivo', 'referencia'],
  injectUserId: true,    // mountCrud should auto-add userId on create (see helper)
});

// Stock actual (calculado)
app.get('/api/stock-actual', requireCompany, requirePermission('stock:read'), async (req, res, next) => {
  try {
    const depositoId = req.query.depositoId || null;
    // Aseguramos que cada categoría de animal y cada insumo del catálogo tengan su
    // producto, para verlos todos en Stock (existencia 0 hasta que se muevan).
    try { await sincronizarProductosHacienda(req.companyId); } catch {}
    try { await sincronizarProductosInsumos(req.companyId); } catch {}
    try { await sincronizarProductosCereales(req.companyId); } catch {}
    // Mapa nombre→tipo de insumo (Herbicida, Fertilizante, ...) para etiquetar cada fila.
    let insTipoMap = {};
    try { insTipoMap = await insumoNombreATipo(req.companyId); } catch {}
    // Respaldo: nombre de la familia del arbol (solo nodos hijos = familias como Herbicida).
    // Asi Stock muestra la familia aunque el catalogo no matchee por nombre exacto.
    const _famNodo = {};
    try {
      const _nodos = await prisma.categoriaArticulo.findMany({ where: { companyId: req.companyId }, select: { id: true, nombre: true, padreId: true } });
      _nodos.forEach(n => { if (n.padreId) _famNodo[n.id] = n.nombre; });
    } catch {}
    const _nrmNombre = (s) => _sinAcentos(s || '').replace(/\s+/g, ' ').trim();
    const productos = await prisma.producto.findMany({
      where: { companyId: req.companyId, activo: true },
      orderBy: { nombre: 'asc' },
    });
    // Filtramos los movimientos:
    // - Los de la empresa activa SIEMPRE entran
    // - Si filtran por depósito X, solo los movs de ese depósito
    const movWhere = { companyId: req.companyId };
    if (depositoId) movWhere.depositoId = depositoId;
    const movs = await prisma.movimiento.groupBy({
      by: ['productoId', 'tipo'],
      where: movWhere,
      _sum: { cantidad: true },
    });
    // Productos de hacienda: su existencia NO sale de Movimiento sino que se
    // nutre de los movimientos de animales (cabezas reales + kg estimados).
    // Se vincula por el mapeo producto.categoriaHacienda (o el nombre si no hay).
    let hacByCat = {};
    if (productos.some(p => (p.categoria || '').toLowerCase() === 'hacienda')) {
      // Si se filtra por un depósito que representa un campo, la hacienda se limita
      // a ese campo. Si el depósito NO es un campo (cerealera/silo), no hay hacienda.
      let campoFiltro = null, soloEseCampo = false;
      if (depositoId) {
        const dep = await prisma.deposito.findFirst({ where: { id: depositoId }, select: { campoId: true } });
        soloEseCampo = true;
        campoFiltro = dep?.campoId || '__sin_campo__';
      }
      const hMovWhere = { companyId: req.companyId };
      if (soloEseCampo) hMovWhere.campoId = campoFiltro;
      const [hmovs, hstocks] = await Promise.all([
        prisma.haciendaMovimiento.findMany({ where: hMovWhere }),
        prisma.haciendaStock.findMany({ where: { companyId: req.companyId } }),
      ]);
      const pesoBy = {};
      hstocks.forEach(s => { if (s.pesoPromedio != null) pesoBy[s.campoId + '::' + s.categoria] = s.pesoPromedio; });
      const signoH = (m) => {
        switch (m.tipo) {
          case 'nacimiento': case 'compra': case 'traslado_in': return Number(m.cantidad || 0);
          case 'muerte': case 'venta': case 'traslado_out': return -Number(m.cantidad || 0);
          case 'ajuste': return Number(m.cantidad || 0);
          default: return 0;
        }
      };
      const real = {};
      hmovs.forEach(m => {
        if (m.tipo === 'cambio_categoria') {
          const kOut = m.campoId + '::' + m.categoria;
          const kIn = m.campoId + '::' + (m.categoriaDestino || m.categoria);
          real[kOut] = (real[kOut] || 0) - Number(m.cantidad || 0);
          real[kIn] = (real[kIn] || 0) + Number(m.cantidad || 0);
          return;
        }
        const k = m.campoId + '::' + m.categoria;
        real[k] = (real[k] || 0) + signoH(m);
      });
      Object.keys(real).forEach(k => {
        const [, cat] = k.split('::');
        if (!hacByCat[cat]) hacByCat[cat] = { cabezas: 0, kilos: 0 };
        hacByCat[cat].cabezas += real[k];
        if (pesoBy[k] != null) hacByCat[cat].kilos += real[k] * pesoBy[k];
      });
    }
    const data = productos.map((p) => {
      if ((p.categoria || '').toLowerCase() === 'hacienda') {
        const h = hacByCat[p.categoriaHacienda || p.nombre] || { cabezas: 0, kilos: 0 };
        return { ...p, existencia: h.cabezas, kilos: Math.round(h.kilos), esHacienda: true, bajoMinimo: h.cabezas < Number(p.stockMinimo || 0) };
      }
      const ing = movs.find((m) => m.productoId === p.id && m.tipo === 'ingreso')?._sum?.cantidad || 0;
      const egr = movs.find((m) => m.productoId === p.id && m.tipo === 'egreso')?._sum?.cantidad || 0;
      const existencia = Number(ing) - Number(egr);
      // Para insumos, etiquetamos con su tipo del catálogo (Herbicida, Fertilizante…).
      const subtipo = (p.categoria || '').toLowerCase() === 'insumos'
        ? (insTipoMap[_nrmNombre(p.nombre)] || (p.categoriaArticuloId ? _famNodo[p.categoriaArticuloId] : null) || null) : null;
      return { ...p, existencia, subtipo, bajoMinimo: existencia < Number(p.stockMinimo || 0) };
    });
    // Si el rol limita las categorías visibles de stock, filtramos.
    const catsOk = stockCatsPermitidas(req);
    const dataFiltrada = catsOk ? data.filter(p => catsOk.has((p.categoria || '').toLowerCase())) : data;
    res.json({ ok: true, data: dataFiltrada });
  } catch (e) { next(e); }
});

// Stock desglosado por depósito (filas planas) — para el Resumen multi-empresa.
// OJO: este endpoint NO debe llamarse '/api/stock-por-deposito' porque hay otro
// con esa ruta más abajo (línea ~3551) que devuelve formato distinto (con array
// anidado de depósitos) usado por pages.cerealeras y otros. Express usa el
// primero que matchee, así que aquí va con sufijo "-flat".
app.get('/api/stock-por-deposito-flat', requireCompany, requirePermission('stock:read'), async (req, res, next) => {
  try {
    const productos = await prisma.producto.findMany({
      where: { companyId: req.companyId, activo: true },
      orderBy: { nombre: 'asc' },
    });
    // Depósitos: propios de la empresa + compartidos (companyId null)
    const depositos = await prisma.deposito.findMany({
      where: { OR: [{ companyId: req.companyId }, { companyId: null, compartido: true }] },
      orderBy: { nombre: 'asc' },
    });
    const movs = await prisma.movimiento.groupBy({
      by: ['productoId', 'tipo', 'depositoId'],
      where: { companyId: req.companyId },
      _sum: { cantidad: true },
    });
    const out = [];
    for (const p of productos) {
      // Por cada depósito
      for (const d of depositos) {
        const ing = movs.find(m => m.productoId === p.id && m.tipo === 'ingreso' && m.depositoId === d.id)?._sum?.cantidad || 0;
        const egr = movs.find(m => m.productoId === p.id && m.tipo === 'egreso' && m.depositoId === d.id)?._sum?.cantidad || 0;
        const existencia = Number(ing) - Number(egr);
        if (existencia !== 0 || ing > 0 || egr > 0) {
          out.push({
            productoId: p.id, productoNombre: p.nombre, unidad: p.unidad,
            depositoId: d.id, depositoNombre: d.nombre, depositoTipo: d.tipo, depositoCompartido: !!d.compartido,
            existencia,
          });
        }
      }
      // Movimientos sin depósito asignado (sueltos)
      const ingS = movs.find(m => m.productoId === p.id && m.tipo === 'ingreso' && m.depositoId === null)?._sum?.cantidad || 0;
      const egrS = movs.find(m => m.productoId === p.id && m.tipo === 'egreso' && m.depositoId === null)?._sum?.cantidad || 0;
      const existS = Number(ingS) - Number(egrS);
      if (existS !== 0) {
        out.push({
          productoId: p.id, productoNombre: p.nombre, unidad: p.unidad,
          depositoId: null, depositoNombre: '(sin depósito)', depositoTipo: null, depositoCompartido: false,
          existencia: existS,
        });
      }
    }
    res.json({ ok: true, data: out });
  } catch (e) { next(e); }
});

// ---------- CONTACTOS ----------
const clienteSchema = z.object({
  razonSocial: z.string().min(1),
  nombreFantasia: z.string().nullable().optional(),
  cuit: z.string().nullable().optional(),
  condIVA: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  telefono: z.string().nullable().optional(),
  direccion: z.string().nullable().optional(),
  localidad: z.string().nullable().optional(),
  provincia: z.string().nullable().optional(),
  pais: z.string().nullable().optional(),
  observaciones: z.string().nullable().optional(),
  activo: z.boolean().optional(),
});
mountCrud({
  path: 'clientes', modelName: 'cliente', perm: 'contactos',
  schema: clienteSchema, orderBy: { razonSocial: 'asc' },
  searchFields: ['razonSocial', 'nombreFantasia', 'cuit'],
  dependencias: [
    { model: 'factura', where: (id) => ({ clienteId: id }), label: 'facturas de venta' },
    { model: 'ctaCte', where: (id) => ({ contactoTipo: 'cliente', contactoId: id }), label: 'movimientos de cuenta corriente' },
  ],
});
mountCrud({
  path: 'proveedores', modelName: 'proveedor', perm: 'contactos',
  schema: clienteSchema.extend({ rubro: z.string().nullable().optional() }),
  orderBy: { razonSocial: 'asc' },
  searchFields: ['razonSocial', 'nombreFantasia', 'cuit', 'rubro'],
  dependencias: [
    { model: 'facturaCompra', where: (id) => ({ proveedorId: id }), label: 'facturas de compra' },
    { model: 'ctaCte', where: (id) => ({ contactoTipo: 'proveedor', contactoId: id }), label: 'movimientos de cuenta corriente' },
  ],
});

// ---------- PRODUCCION ----------
mountCrud({
  path: 'campos', modelName: 'campo', perm: 'produccion',
  schema: z.object({
    nombre: z.string().min(1),
    localidad: z.string().nullable().optional(),
    provincia: z.string().nullable().optional(),
    hectareas: z.number().optional(),
    propietario: z.string().nullable().optional(),
    titularidad: z.string().nullable().optional(),
    ubicacion: z.string().nullable().optional(),
    renspa: z.string().nullable().optional(),
    renspas: z.array(z.object({
      codigo: z.string(),
      tipo: z.enum(['agricola','ganadera','mixto','otro']).optional(),
    })).nullable().optional(),
    tipoExplotacion: z.enum(['agricola','ganadera','mixta']).nullable().optional(),
    geolocalizacion: z.string().nullable().optional(),
    observaciones: z.string().nullable().optional(),
    esDeposito: z.boolean().optional(),
    activo: z.boolean().optional(),
  }),
  orderBy: { nombre: 'asc' },
  include: { lotes: true },
  searchFields: ['nombre', 'localidad'],
});

// Lotes: el modelo no tiene companyId directo (esta en campo) -> ruta manual
const loteSchema = z.object({
  campoId: z.string(),
  nombre: z.string().min(1),
  hectareas: z.number().optional(),
  observaciones: z.string().nullable().optional(),
  geojson: z.any().nullable().optional(),   // contorno GeoJSON para el mapa
  centro: z.string().nullable().optional(), // "lat,lng"
  activo: z.boolean().optional(),
});

app.get('/api/lotes', requireCompany, requirePermission('produccion:read'), async (req, res, next) => {
  try {
    const rows = await prisma.lote.findMany({
      where: { campo: { companyId: req.companyId } },
      include: { campo: true },
      orderBy: { nombre: 'asc' },
    });
    res.json({ ok: true, data: rows });
  } catch (e) { next(e); }
});

app.post('/api/lotes', requireCompany, requirePermission('produccion:create'), async (req, res, next) => {
  try {
    const data = loteSchema.parse(req.body);
    const campo = await prisma.campo.findFirst({ where: { id: data.campoId, companyId: req.companyId } });
    if (!campo) return res.status(400).json({ ok: false, error: 'Campo no valido' });
    res.status(201).json({ ok: true, data: await prisma.lote.create({ data }) });
  } catch (e) { next(e); }
});

app.put('/api/lotes/:id', requireCompany, requirePermission('produccion:update'), async (req, res, next) => {
  try {
    const existing = await prisma.lote.findFirst({
      where: { id: req.params.id, campo: { companyId: req.companyId } },
    });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    res.json({ ok: true, data: await prisma.lote.update({ where: { id: req.params.id }, data: loteSchema.partial().parse(req.body) }) });
  } catch (e) { next(e); }
});

app.delete('/api/lotes/:id', requireCompany, requirePermission('produccion:delete'), async (req, res, next) => {
  try {
    const existing = await prisma.lote.findFirst({
      where: { id: req.params.id, campo: { companyId: req.companyId } },
    });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    await prisma.lote.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- APLICACIONES (insumos + labores unificadas) ----------
// Unimos InsumoAplicado + LaborAplicada en una sola API para simplificar el frontend.
app.get('/api/aplicaciones', requireCompany, requirePermission('produccion:read'), async (req, res, next) => {
  try {
    const [ins, lab] = await Promise.all([
      prisma.insumoAplicado.findMany({ where: { campana: { companyId: req.companyId } }, orderBy: { fecha: 'desc' } }),
      prisma.laborAplicada.findMany({   where: { campana: { companyId: req.companyId } }, orderBy: { fecha: 'desc' } }),
    ]);
    const data = [
      ...ins.map(x => ({ id: x.id, campanaId: x.campanaId, tipo: 'insumo',
        item: x.nombre, subtipo: x.unidad || null,
        unidadHa: x.cantidad, precioUnit: x.precioUnit ?? null,
        costoHa: x.costo, moneda: 'USD', hectareasAplicadas: x.hectareasAplicadas,
        fecha: x.fecha, observaciones: x.observaciones })),
      ...lab.map(x => ({ id: x.id, campanaId: x.campanaId, tipo: 'labor',
        item: x.tipo, subtipo: null,
        unidadHa: null, precioUnit: null,
        costoHa: x.costo, moneda: x.monedaCosto || 'USD', hectareasAplicadas: x.hectareasAplicadas,
        fecha: x.fecha, observaciones: x.observaciones })),
    ];
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});
app.post('/api/aplicaciones', requireCompany, requirePermission('produccion:create'), async (req, res, next) => {
  try {
    const schema = z.object({
      campanaId: z.string(),
      tipo: z.enum(['insumo', 'labor']),
      item: z.string().min(1),
      productoId: z.string().nullable().optional(),
      subtipo: z.string().nullable().optional(),
      unidadHa: z.number().nullable().optional(),
      precioUnit: z.number().nullable().optional(),
      costoHa: z.number().nullable().optional(),
      hectareasAplicadas: z.number().nullable().optional(),
      fecha: z.coerce.date().nullable().optional(),
      observaciones: z.string().nullable().optional(),
    });
    const d = schema.parse(req.body);
    const camp = await prisma.campana.findFirst({ where: { id: d.campanaId, companyId: req.companyId } });
    if (!camp) return res.status(404).json({ ok: false, error: 'Campaña no encontrada' });
    const fecha = d.fecha || new Date();
    if (d.tipo === 'insumo') {
      // Resolvemos el producto para descontar del stock (por id, o por nombre como fallback).
      let prod = null;
      if (d.productoId) prod = await prisma.producto.findFirst({ where: { id: d.productoId, companyId: req.companyId } });
      if (!prod) prod = await prisma.producto.findFirst({ where: { companyId: req.companyId, nombre: { equals: d.item, mode: 'insensitive' } } });
      // Cantidad total consumida = unidades por ha × hectáreas aplicadas.
      const cantConsumida = Number(d.unidadHa || 0) * Number(d.hectareasAplicadas || 0);
      const row = await prisma.$transaction(async (tx) => {
        const ins = await tx.insumoAplicado.create({
          data: { campanaId: d.campanaId, productoId: prod?.id || null, nombre: d.item, cantidad: d.unidadHa || 0,
            unidad: d.subtipo || 'u/ha', fecha, costo: d.costoHa || 0,
            precioUnit: d.precioUnit ?? null,
            hectareasAplicadas: d.hectareasAplicadas ?? null,
            observaciones: d.observaciones || null },
        });
        // Si encontramos el producto y hay cantidad consumida, generamos el egreso de stock.
        if (prod && cantConsumida > 0) {
          const total = (d.precioUnit || 0) * cantConsumida;
          const mov = await tx.movimiento.create({
            data: {
              companyId: req.companyId, productoId: prod.id, depositoId: null,
              fecha, tipo: 'egreso', motivo: 'aplicacion',
              cantidad: cantConsumida, precio: d.precioUnit ?? null, total: total || null,
              referencia: `INS-${ins.id.slice(-6).toUpperCase()}`,
              observaciones: `Aplicado en lote (${d.item})`,
              userId: req.user?.id || null,
            },
          });
          await tx.insumoAplicado.update({ where: { id: ins.id }, data: { movimientoId: mov.id } });
          ins.movimientoId = mov.id;
        }
        return ins;
      });
      return res.status(201).json({ ok: true, data: { ...row, tipo: 'insumo' } });
    } else {
      const row = await prisma.laborAplicada.create({
        data: { campanaId: d.campanaId, tipo: d.item, fecha, costo: d.costoHa || 0,
          hectareasAplicadas: d.hectareasAplicadas ?? null,
          observaciones: d.observaciones || null },
      });
      return res.status(201).json({ ok: true, data: { ...row, tipo: 'labor' } });
    }
  } catch (e) { next(e); }
});
// Editar una aplicación (insumo o labor) — para corregir un solo renglón sin borrar y recargar.
app.put('/api/aplicaciones/:id', requireCompany, requirePermission('produccion:update'), async (req, res, next) => {
  try {
    const id = req.params.id;
    const schema = z.object({
      item: z.string().min(1).optional(),
      subtipo: z.string().nullable().optional(),
      unidadHa: z.number().nullable().optional(),
      precioUnit: z.number().nullable().optional(),
      costoHa: z.number().nullable().optional(),
      monedaCosto: z.string().nullable().optional(),
      hectareasAplicadas: z.number().nullable().optional(),
      fecha: z.coerce.date().nullable().optional(),
      observaciones: z.string().nullable().optional(),
    });
    const d = schema.parse(req.body || {});
    const ins = await prisma.insumoAplicado.findFirst({ where: { id, campana: { companyId: req.companyId } } });
    if (ins) {
      const row = await prisma.insumoAplicado.update({ where: { id }, data: {
        nombre: d.item ?? ins.nombre,
        unidad: d.subtipo !== undefined ? (d.subtipo || 'u/ha') : ins.unidad,
        cantidad: d.unidadHa !== undefined ? (d.unidadHa || 0) : ins.cantidad,
        precioUnit: d.precioUnit !== undefined ? d.precioUnit : ins.precioUnit,
        costo: d.costoHa !== undefined ? (d.costoHa || 0) : ins.costo,
        hectareasAplicadas: d.hectareasAplicadas !== undefined ? d.hectareasAplicadas : ins.hectareasAplicadas,
        fecha: d.fecha || ins.fecha,
        observaciones: d.observaciones !== undefined ? d.observaciones : ins.observaciones,
      }});
      // Si tiene un egreso de stock vinculado, lo ajustamos a la nueva cantidad/fecha/precio.
      if (ins.movimientoId) {
        const cant = Number(row.cantidad || 0) * Number(row.hectareasAplicadas || 0);
        const total = Number(row.precioUnit || 0) * cant;
        await prisma.movimiento.updateMany({
          where: { id: ins.movimientoId, companyId: req.companyId },
          data: { cantidad: cant, precio: row.precioUnit ?? null, total: total || null, fecha: row.fecha },
        });
      }
      return res.json({ ok: true, data: { ...row, tipo: 'insumo' } });
    }
    const lab = await prisma.laborAplicada.findFirst({ where: { id, campana: { companyId: req.companyId } } });
    if (lab) {
      const row = await prisma.laborAplicada.update({ where: { id }, data: {
        tipo: d.item ?? lab.tipo,
        costo: d.costoHa !== undefined ? (d.costoHa || 0) : lab.costo,
        monedaCosto: d.monedaCosto !== undefined ? (d.monedaCosto || 'USD') : lab.monedaCosto,
        hectareasAplicadas: d.hectareasAplicadas !== undefined ? d.hectareasAplicadas : lab.hectareasAplicadas,
        fecha: d.fecha || lab.fecha,
        observaciones: d.observaciones !== undefined ? d.observaciones : lab.observaciones,
      }});
      return res.json({ ok: true, data: { ...row, tipo: 'labor' } });
    }
    res.status(404).json({ ok: false, error: 'No encontrado' });
  } catch (e) { next(e); }
});
app.delete('/api/aplicaciones/:id', requireCompany, requirePermission('produccion:delete'), async (req, res, next) => {
  try {
    const id = req.params.id;
    // Intentar borrar como insumo, si no existe probar como labor
    const ins = await prisma.insumoAplicado.findFirst({ where: { id, campana: { companyId: req.companyId } } });
    if (ins) {
      await prisma.$transaction(async (tx) => {
        await tx.insumoAplicado.delete({ where: { id } });
        // Revertir el egreso de stock generado por el uso.
        if (ins.movimientoId) await tx.movimiento.deleteMany({ where: { id: ins.movimientoId, companyId: req.companyId } });
      });
      return res.json({ ok: true });
    }
    const lab = await prisma.laborAplicada.findFirst({ where: { id, campana: { companyId: req.companyId } } });
    if (lab) { await prisma.laborAplicada.delete({ where: { id } }); return res.json({ ok: true }); }
    res.status(404).json({ ok: false, error: 'No encontrado' });
  } catch (e) { next(e); }
});

// Backfill: genera los egresos de stock que faltan para los insumos ya aplicados
// (los cargados antes de que el uso descontara stock). Idempotente: solo procesa
// los que no tienen movimiento vinculado y cuyo nombre coincide con un producto.
app.post('/api/aplicaciones/backfill-stock', requireCompany, requirePermission('produccion:update'), async (req, res, next) => {
  try {
    const pendientes = await prisma.insumoAplicado.findMany({
      where: { campana: { companyId: req.companyId }, movimientoId: null },
    });
    let generados = 0, sinProducto = 0, sinCantidad = 0;
    for (const ins of pendientes) {
      const cant = Number(ins.cantidad || 0) * Number(ins.hectareasAplicadas || 0);
      if (!(cant > 0)) { sinCantidad++; continue; }
      let prod = null;
      if (ins.productoId) prod = await prisma.producto.findFirst({ where: { id: ins.productoId, companyId: req.companyId } });
      if (!prod) prod = await prisma.producto.findFirst({ where: { companyId: req.companyId, nombre: { equals: ins.nombre, mode: 'insensitive' } } });
      if (!prod) { sinProducto++; continue; }
      await prisma.$transaction(async (tx) => {
        const total = (ins.precioUnit || 0) * cant;
        const mov = await tx.movimiento.create({
          data: {
            companyId: req.companyId, productoId: prod.id, depositoId: null,
            fecha: ins.fecha, tipo: 'egreso', motivo: 'aplicacion',
            cantidad: cant, precio: ins.precioUnit ?? null, total: total || null,
            referencia: `INS-${ins.id.slice(-6).toUpperCase()}`,
            observaciones: `Aplicado en lote (${ins.nombre})`,
            userId: req.user?.id || null,
          },
        });
        await tx.insumoAplicado.update({ where: { id: ins.id }, data: { productoId: prod.id, movimientoId: mov.id } });
      });
      generados++;
    }
    res.json({ ok: true, generados, sinProducto, sinCantidad, total: pendientes.length });
  } catch (e) { next(e); }
});

mountCrud({
  path: 'campanas', modelName: 'campana', perm: 'produccion',
  schema: z.object({
    loteId: z.string(),
    nombre: z.string().nullable().optional(),
    cultivo: z.string().min(1),
    variedad: z.string().nullable().optional(),
    ciclo: z.string().nullable().optional(),
    hectareas: z.number().optional(),
    rindeEstimado: z.number().nullable().optional(),
    rindeReal: z.number().nullable().optional(),
    fechaSiembra: z.coerce.date().nullable().optional(),
    fechaCosecha: z.coerce.date().nullable().optional(),
    estado: z.string().optional(),
    observaciones: z.string().nullable().optional(),
    analisisSuelo: z.string().nullable().optional(),
    planilla: z.any().nullable().optional(),   // planilla resultado económico (JSON)
  }),
  include: { lote: { include: { campo: true } } },
  searchFields: ['nombre', 'cultivo', 'variedad', 'ciclo'],
});

// Rinde REAL de una campaña: kg cosechados que salieron en viajes + los cargados
// como ingreso de stock manual (motivo cosecha), con su desglose. rinde = tn/ha.
app.get('/api/campanas/:id/rinde', requireCompany, requirePermission('produccion:read'), async (req, res, next) => {
  try {
    const camp = await prisma.campana.findFirst({ where: { id: req.params.id, companyId: req.companyId }, include: { lote: true } });
    if (!camp) return res.status(404).json({ ok: false, error: 'Campaña no encontrada' });
    const hectareas = Number(camp.lote?.hectareas || camp.hectareas || 0);
    const viajes = await prisma.viaje.findMany({ where: { companyId: req.companyId, campanaId: camp.id, estado: { not: 'anulada' } } });
    const kgDeViaje = (v) => Number(v.kgDescarga || v.kgNetoDest || v.kgNeto || v.cantidad || 0);
    const kgViajes = viajes.reduce((a, v) => a + kgDeViaje(v), 0);
    // Ingresos de stock de esa campaña, excluyendo los auto-generados por un viaje
    // (referencia VIAJE-...) para no duplicar con los viajes de arriba.
    const movs = await prisma.movimiento.findMany({ where: { companyId: req.companyId, campanaId: camp.id, tipo: 'ingreso' } });
    const movsCosecha = movs.filter(m => !String(m.referencia || '').startsWith('VIAJE-'));
    const kgStock = movsCosecha.reduce((a, m) => a + Number(m.cantidad || 0), 0);
    const kgTotal = kgViajes + kgStock;
    const rindeTnHa = hectareas > 0 ? (kgTotal / 1000) / hectareas : 0;
    res.json({ ok: true, data: {
      hectareas, kgViajes, kgStock, kgTotal, rindeTnHa,
      viajesCount: viajes.length, stockCount: movsCosecha.length,
      detalleViajes: viajes.map(v => ({ id: v.id, fecha: v.fecha, destino: v.destino, producto: v.producto, kg: kgDeViaje(v) })),
      detalleStock: movsCosecha.map(m => ({ id: m.id, fecha: m.fecha, motivo: m.motivo, referencia: m.referencia, kg: Number(m.cantidad || 0) })),
    }});
  } catch (e) { next(e); }
});

// ---------- VENTAS (facturas con items + CAE simulado) ----------
function calcFactura(items) {
  let subtotal = 0, iva = 0;
  const det = items.map((it) => {
    const sub = it.cantidad * it.precioUnit;
    const alic = it.alicuotaIva ?? 21;
    const ivaImp = sub * (alic / 100);
    subtotal += sub; iva += ivaImp;
    return { productoId: it.productoId || null, descripcion: it.descripcion, cantidad: it.cantidad, precioUnit: it.precioUnit,
             alicuotaIva: alic, subtotal: sub, ivaImporte: ivaImp, total: sub + ivaImp,
             campoId: it.campoId || null, cabezas: (it.cabezas != null ? it.cabezas : null) };
  });
  return { items: det, subtotal, iva, total: subtotal + iva };
}

// Helpers para generar/borrar movimientos de stock asociados a facturas.
// Usamos el campo `referencia` del Movimiento como link inverso: "VTA-{facturaId}" o "CPR-{facturaCompraId}".
async function crearMovimientosDesdeFactura(tx, { companyId, factura, tipo, motivo, contraparteId, contraparteTipo, refPrefix, userId, depositoId = null }) {
  // tipo = "ingreso" (compra) o "egreso" (venta)
  const items = (factura.items || []).filter(it => it.productoId);
  if (!items.length) return 0;
  const ref = `${refPrefix}-${factura.id}`;
  const compNum = `${factura.tipo} ${String(factura.puntoVenta).padStart(4,'0')}-${String(factura.numero).padStart(8,'0')}`;
  // Detectar productos de HACIENDA: mueven el stock de animales (cabezas + kg),
  // no el stock de productos.
  const prods = await tx.producto.findMany({ where: { companyId, id: { in: items.map(i => i.productoId) } }, select: { id: true, nombre: true, categoria: true, categoriaHacienda: true } });
  const prodById = Object.fromEntries(prods.map(p => [p.id, p]));
  const esHac = (it) => ((prodById[it.productoId]?.categoria) || '').toLowerCase() === 'hacienda';
  const itemsProd = items.filter(it => !esHac(it));
  const itemsHac  = items.filter(it => esHac(it) && it.campoId && Number(it.cabezas) > 0);
  // 1) Stock de productos (todo lo que NO es hacienda)
  if (itemsProd.length) {
    await tx.movimiento.createMany({ data: itemsProd.map(it => ({
      companyId, productoId: it.productoId, fecha: factura.fecha, tipo, motivo,
      cantidad: Number(it.cantidad), precio: Number(it.precioUnit) || null, total: Number(it.subtotal) || null,
      contraparteId: contraparteId || null, contraparteTipo: contraparteTipo || null, referencia: ref,
      depositoId: (it.depositoId || depositoId) || null,
      observaciones: `Generado automaticamente por ${motivo} ${compNum}`, userId: userId || null,
    })) });
  }
  // 2) Stock de animales (la "cantidad" de la línea son los kg; las cabezas vienen aparte)
  for (const it of itemsHac) {
    const tipoMov = (tipo === 'egreso') ? 'venta' : 'compra';
    const kg = Number(it.cantidad) || null;
    await tx.haciendaMovimiento.create({ data: {
      companyId, campoId: it.campoId, categoria: prodById[it.productoId]?.categoriaHacienda || prodById[it.productoId]?.nombre || it.descripcion,
      fecha: factura.fecha, tipo: tipoMov, cantidad: Math.round(Number(it.cabezas) || 0),
      kilos: kg, precioKg: Number(it.precioUnit) || null, total: Number(it.subtotal) || null,
      clienteId: contraparteTipo === 'cliente' ? (contraparteId || null) : null,
      modoVenta: tipoMov === 'venta' ? 'directo' : null,
      estadoRend: tipoMov === 'venta' ? 'cerrada' : null,
      cobroTipo: 'ninguno', facturaRef: ref,
      observaciones: `Generado por ${motivo} ${compNum}`,
    }});
  }
  return items.length;
}

async function borrarMovimientosDeFactura(tx, { companyId, refPrefix, facturaId }) {
  const ref = `${refPrefix}-${facturaId}`;
  // Revertir también los movimientos de animales generados por la factura.
  await tx.haciendaMovimiento.deleteMany({ where: { companyId, facturaRef: ref } });
  return tx.movimiento.deleteMany({ where: { companyId, referencia: ref } });
}

// Genera el movimiento de Cuenta Corriente al crear una factura. El campo
// `referencia` (FAC-{id} o FACC-{id}) sirve de link inverso para poder
// borrarlo si la factura se anula o elimina.
// Extrae los días de una condición de pago: usa condicionDias si vino explícito,
// si no, intenta parsear del texto (ej. "Cta cte 30 días" → 30, "Contado" → 0).
function _condicionDiasFrom(cond, diasExpl) {
  if (typeof diasExpl === 'number' && diasExpl >= 0) return diasExpl;
  if (!cond) return null;
  const s = String(cond).toLowerCase();
  if (s.includes('contado')) return 0;
  const m = s.match(/(\d+)\s*d[ií]as?/i);
  if (m) return Number(m[1]);
  return null;
}

async function crearCtaCteDesdeFactura(tx, { companyId, factura, contactoTipo, contactoId, refPrefix, motivo, condicion, condicionDias, vencimientoFecha }) {
  if (!contactoId) return; // sin cliente/proveedor registrado no hay cuenta corriente
  const _moneda = factura.moneda || 'ARS';
  const _cotiz = factura.cotizacion != null ? factura.cotizacion : (_moneda === 'ARS' ? 1 : null);
  const compNum = `${String(factura.puntoVenta).padStart(4, '0')}-${String(factura.numero).padStart(8, '0')}`;
  let vencimiento = null;
  // 1) Fecha fija (típico en agro: "pago en cosecha 2027") tiene prioridad
  if (vencimientoFecha) {
    const d = new Date(vencimientoFecha);
    if (!isNaN(d.getTime())) vencimiento = d;
  }
  // 2) Si no hay fecha fija, calculamos con los días
  if (!vencimiento) {
    const dias = _condicionDiasFrom(condicion, condicionDias);
    if (dias != null && dias > 0) {
      vencimiento = new Date(factura.fecha);
      vencimiento.setDate(vencimiento.getDate() + dias);
    } else if (dias === 0) {
      // Contado: vencimiento = misma fecha de factura
      vencimiento = new Date(factura.fecha);
    }
  }
  await tx.ctaCte.create({
    data: {
      companyId,
      contactoTipo, contactoId,
      fecha: factura.fecha,
      vencimiento,
      detalle: `${motivo} ${factura.tipo} ${compNum}`,
      moneda: _moneda,
      cotizacion: _cotiz,
      debe: Number(factura.total) || 0,
      haber: 0,
      referencia: `${refPrefix}-${factura.id}`,
    },
  });
}

async function borrarCtaCteDeFactura(tx, { companyId, refPrefix, facturaId }) {
  return tx.ctaCte.deleteMany({
    where: { companyId, referencia: `${refPrefix}-${facturaId}` },
  });
}


// Para items de factura que vienen sin productoId pero con productoNombre,
// busca o crea el Producto en la empresa. Devuelve el productoId.
async function _ensureProductoFromItem(tx, companyId, item) {
  if (item.productoId) return item.productoId;
  const nombre = (item.productoNombre || '').trim();
  if (!nombre) return null;
  const existing = await tx.producto.findFirst({
    where: { companyId, nombre: { equals: nombre, mode: 'insensitive' } },
  });
  if (existing) return existing.id;
  // Defaults: el schema exige unidad y categoria no nulos
  const unidad    = (item.productoUnidad || '').trim() || 'unidad';
  const categoria = (item.productoCategoria || 'insumos').trim().toLowerCase() || 'insumos';
  const creado = await tx.producto.create({ data: {
    company: { connect: { id: companyId } },
    nombre,
    unidad,
    categoria,
    activo: true,
  }});
  return creado.id;
}

const itemFacSchema = z.object({
  productoId: z.string().nullable().optional(),
  // Si productoId es null pero vienen estos campos, el backend crea el Producto
  // al vuelo (típico cuando el usuario carga un item del catálogo "Insumos"
  // que aún no existe como Producto).
  productoNombre: z.string().nullable().optional(),
  productoUnidad: z.string().nullable().optional(),
  productoCategoria: z.string().nullable().optional(),
  descripcion: z.string().min(1), cantidad: z.number(),
  precioUnit: z.number(), alicuotaIva: z.number().optional(),
  // Animales: campo del que sale/entra + cabezas (la "cantidad" de la línea son kg).
  campoId: z.string().nullable().optional(),
  cabezas: z.number().nullable().optional(),
});

app.get('/api/facturas', requireCompany, requirePermission('ventas:read'), async (req, res, next) => {
  try {
    const { desde, hasta } = req.query;
    const where = { companyId: req.companyId };
    if (desde || hasta) { where.fecha = {}; if (desde) where.fecha.gte = new Date(desde); if (hasta) where.fecha.lte = new Date(hasta); }
    const facturas = await prisma.factura.findMany({ where, orderBy: { fecha: 'desc' }, include: { cliente: true, items: true } });
    // Marcar cuáles ya tienen un cobro aplicado (para no permitir editarlas).
    const cobros = await prisma.ctaCte.findMany({
      where: { companyId: req.companyId, contactoTipo: 'cliente', referencia: { startsWith: 'FAC-' }, OR: [{ detalle: { startsWith: 'Cobro de' } }, { pagado: true }] },
      select: { referencia: true },
    });
    const pagadas = new Set(cobros.map(p => String(p.referencia || '').replace(/^FAC-/, '')));
    res.json({ ok: true, data: facturas.map(f => ({ ...f, pagada: pagadas.has(f.id) })) });
  } catch (e) { next(e); }
});

// Helper: ¿la factura de venta tiene un cobro aplicado? Un cobro crea un
// contra-asiento con detalle "Cobro de ..." y referencia FAC-<id>, y marca
// pagado=true si cubre todo. Detecta cobros totales y parciales.
async function _ventaTienePago(companyId, facturaId) {
  const row = await prisma.ctaCte.findFirst({
    where: { companyId, contactoTipo: 'cliente', referencia: `FAC-${facturaId}`, OR: [{ detalle: { startsWith: 'Cobro de' } }, { pagado: true }] },
    select: { id: true },
  });
  return !!row;
}

app.get('/api/facturas/libroIva/:anio/:mes', requireCompany, requirePermission('ventas:read'), async (req, res, next) => {
  try {
    const anio = Number(req.params.anio), mes = Number(req.params.mes);
    const desde = new Date(anio, mes - 1, 1), hasta = new Date(anio, mes, 0, 23, 59, 59);
    res.json({
      ok: true,
      periodo: { anio, mes },
      data: await prisma.factura.findMany({
        where: { companyId: req.companyId, fecha: { gte: desde, lte: hasta }, estado: { not: 'anulada' } },
        include: { items: true, cliente: true }, orderBy: { fecha: 'asc' },
      }),
    });
  } catch (e) { next(e); }
});

app.get('/api/facturas/:id', requireCompany, requirePermission('ventas:read'), async (req, res, next) => {
  try {
    const row = await prisma.factura.findFirst({
      where: { id: req.params.id, companyId: req.companyId },
      include: { cliente: true, items: true },
    });
    if (!row) return res.status(404).json({ ok: false, error: 'No encontrada' });
    const pagada = await _ventaTienePago(req.companyId, row.id);
    res.json({ ok: true, data: { ...row, pagada } });
  } catch (e) { next(e); }
});

// EDITAR factura de venta: revierte (stock + cta cte + items) y la recrea,
// preservando CAE / vto / origen / estado. Bloquea si ya tiene un cobro aplicado.
app.put('/api/facturas/:id', requireCompany, requirePermission('ventas:create'), async (req, res, next) => {
  try {
    const schema = z.object({
      clienteId: z.string().nullable().optional(),
      tipo: z.enum(['A', 'B', 'C', 'E']),
      clase: z.enum(['factura', 'nota_credito', 'nota_debito']).optional().default('factura'),
      puntoVenta: z.number().int(),
      numero: z.number().int(),
      fecha: z.coerce.date(),
      condicionVenta: z.string().nullable().optional(),
      condicionDias: z.number().int().min(0).nullable().optional(),
      vencimientoFecha: z.coerce.date().nullable().optional(),
      moneda: z.string().optional(),
      cotizacion: z.number().positive().nullable().optional(),
      depositoId: z.string().nullable().optional(),
      observaciones: z.string().nullable().optional(),
      items: z.array(itemFacSchema).min(1),
    });
    const input = schema.parse(req.body);
    const existing = await prisma.factura.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrada' });
    if (await _ventaTienePago(req.companyId, req.params.id)) return res.status(400).json({ ok: false, error: 'No se puede editar: la factura tiene un cobro aplicado. Primero eliminá el cobro (Recibo → deshacer) y después editá.' });
    const factura = await prisma.$transaction(async (tx) => {
      for (const it of input.items) it.productoId = await _ensureProductoFromItem(tx, req.companyId, it);
      const totales = calcFactura(input.items);
      const _mon = input.moneda || existing.moneda || 'ARS';
      const _cot = _mon === 'ARS' ? 1 : (input.cotizacion ?? await getCotizacionARS(_mon, input.fecha, req.companyId));
      const _clase = input.clase || 'factura';
      await borrarMovimientosDeFactura(tx, { companyId: req.companyId, refPrefix: 'VTA', facturaId: req.params.id });
      await borrarCtaCteDeFactura(tx, { companyId: req.companyId, refPrefix: 'FAC', facturaId: req.params.id });
      await tx.facturaItem.deleteMany({ where: { facturaId: req.params.id } });
      const f = await tx.factura.update({
        where: { id: req.params.id },
        data: {
          clienteId: input.clienteId || null, tipo: input.tipo, clase: _clase,
          puntoVenta: input.puntoVenta, numero: input.numero, fecha: input.fecha,
          condicionVenta: input.condicionVenta, observaciones: input.observaciones,
          moneda: _mon, cotizacion: _cot, subtotal: totales.subtotal, iva: totales.iva, total: totales.total,
          items: { create: totales.items },
        },
        include: { cliente: true, items: true },
      });
      if (_clase === 'factura') {
        await crearMovimientosDesdeFactura(tx, { companyId: req.companyId, factura: f, tipo: 'egreso', motivo: 'venta', contraparteId: input.clienteId || null, contraparteTipo: 'cliente', refPrefix: 'VTA', userId: req.user?.id || null, depositoId: input.depositoId || null });
        await crearCtaCteDesdeFactura(tx, { companyId: req.companyId, factura: f, contactoTipo: 'cliente', contactoId: input.clienteId || null, refPrefix: 'FAC', motivo: 'Factura', condicion: input.condicionVenta, condicionDias: input.condicionDias, vencimientoFecha: input.vencimientoFecha || null });
      } else if (_clase === 'nota_credito') {
        await crearMovimientosDesdeFactura(tx, { companyId: req.companyId, factura: f, tipo: 'ingreso', motivo: 'devolucion_venta', contraparteId: input.clienteId || null, contraparteTipo: 'cliente', refPrefix: 'VTA', userId: req.user?.id || null, depositoId: input.depositoId || null });
        await tx.ctaCte.create({ data: { companyId: req.companyId, contactoTipo: 'cliente', contactoId: input.clienteId || null, fecha: input.fecha,
          detalle: `Nota de crédito ${input.tipo} ${String(input.puntoVenta).padStart(4,'0')}-${String(input.numero).padStart(8,'0')}`,
          moneda: _mon, cotizacion: _cot, haber: totales.total, referencia: `FAC-${f.id}`, observaciones: input.observaciones || null }});
      } else {
        await tx.ctaCte.create({ data: { companyId: req.companyId, contactoTipo: 'cliente', contactoId: input.clienteId || null, fecha: input.fecha,
          detalle: `Nota de débito ${input.tipo} ${String(input.puntoVenta).padStart(4,'0')}-${String(input.numero).padStart(8,'0')}`,
          moneda: _mon, cotizacion: _cot, debe: totales.total, referencia: `FAC-${f.id}`, observaciones: input.observaciones || null }});
      }
      return f;
    });
    res.json({ ok: true, data: factura });
  } catch (e) { next(e); }
});

app.post('/api/facturas', requireCompany, requirePermission('ventas:create'), async (req, res, next) => {
  try {
    // Aceptamos dos modos:
    //  - origen "agrocore" (default): el sistema asigna un CAE generado (mock,
    //    en producción saldrá de WSFE) y la factura queda autorizada.
    //  - origen "arca_externa": ya se emitió en el portal de ARCA, vienen el
    //    CAE y CAE vto reales en el body — el sistema no inventa nada.
    const schema = z.object({
      clienteId: z.string().nullable().optional(),
      tipo: z.enum(['A', 'B', 'C', 'E']),
      clase: z.enum(['factura', 'nota_credito', 'nota_debito']).optional().default('factura'),
      puntoVenta: z.number().int(),
      numero: z.number().int(),
      fecha: z.coerce.date(),
      condicionVenta: z.string().nullable().optional(),
      condicionDias: z.number().int().min(0).nullable().optional(),  // del catálogo de Condiciones de pago
      vencimientoFecha: z.coerce.date().nullable().optional(),       // si la condición es "a fecha fija"
      moneda: z.string().optional(),
      cotizacion: z.number().positive().nullable().optional(),
      depositoId: z.string().nullable().optional(),   // depósito de donde sale el stock vendido
      observaciones: z.string().nullable().optional(),
      origen: z.enum(['agrocore', 'arca_externa']).optional().default('agrocore'),
      cae: z.string().optional(),
      caeVto: z.coerce.date().optional(),
      laborServicioId: z.string().nullable().optional(),   // si la factura sale de una labor a terceros, la vinculamos
      items: z.array(itemFacSchema).min(1),
    });
    const input = schema.parse(req.body);
    // Evitar numeración duplicada: mismo comprobante (tipo+clase+PV+número) ya emitido.
    {
      const _clase0 = input.clase || 'factura';
      const dup = await prisma.factura.findFirst({ where: { companyId: req.companyId, tipo: input.tipo, clase: _clase0, puntoVenta: input.puntoVenta, numero: input.numero, estado: { not: 'anulada' } } });
      if (dup) return res.status(400).json({ ok: false, error: `Ya existe ${_labelComp(_clase0, input.tipo)} ${String(input.puntoVenta).padStart(4,'0')}-${String(input.numero).padStart(8,'0')}. Cambiá el número.` });
    }
    // Si dicen que la factura ya está en ARCA, exigimos CAE + vto reales.
    if (input.origen === 'arca_externa') {
      if (!input.cae || !/^\d{14}$/.test(input.cae)) {
        return res.status(400).json({ ok: false, error: 'CAE inválido. Debe ser de 14 dígitos (el que devolvió ARCA al emitir).' });
      }
      if (!input.caeVto) {
        return res.status(400).json({ ok: false, error: 'Falta la fecha de vencimiento del CAE.' });
      }
    }
    const cae = input.origen === 'arca_externa'
      ? input.cae
      : Math.floor(1e13 + Math.random() * 9e13).toString();
    let caeVto;
    if (input.origen === 'arca_externa') {
      caeVto = input.caeVto;
    } else {
      caeVto = new Date(input.fecha); caeVto.setDate(caeVto.getDate() + 10);
    }
    // Transaccion: crear factura + descontar stock con movimientos egreso.
    const factura = await prisma.$transaction(async (tx) => {
      // Resolver productoIds desde nombre (crea Producto si no existe)
      for (const it of input.items) {
        it.productoId = await _ensureProductoFromItem(tx, req.companyId, it);
      }
      const totales = calcFactura(input.items);
      const _mon = input.moneda || 'ARS';
      const _cot = _mon === 'ARS' ? 1 : (input.cotizacion ?? await getCotizacionARS(_mon, input.fecha, req.companyId));
      const _clase = input.clase || 'factura';
      const f = await tx.factura.create({
        data: {
          companyId: req.companyId, clienteId: input.clienteId || null,
          tipo: input.tipo, clase: _clase, puntoVenta: input.puntoVenta, numero: input.numero, fecha: input.fecha,
          condicionVenta: input.condicionVenta, observaciones: input.observaciones,
          moneda: _mon, cotizacion: _cot,
          subtotal: totales.subtotal, iva: totales.iva, total: totales.total,
          cae, caeVto, estado: 'autorizada',
          origen: input.origen,
          items: { create: totales.items },
        },
        include: { cliente: true, items: true },
      });
      // Mantener la numeración correlativa al día (para la próxima carga manual).
      await _avanzarSecuencia(tx, req.companyId, _seqTipoFactura(_clase, input.tipo), input.puntoVenta, input.numero);
      if (_clase === 'factura') {
        // Factura de venta: sale stock (egreso) + el cliente queda debiendo (debe).
        await crearMovimientosDesdeFactura(tx, {
          companyId: req.companyId, factura: f, tipo: 'egreso', motivo: 'venta',
          contraparteId: input.clienteId || null, contraparteTipo: 'cliente', refPrefix: 'VTA',
          userId: req.user?.id || null, depositoId: input.depositoId || null,
        });
        await crearCtaCteDesdeFactura(tx, {
          companyId: req.companyId, factura: f,
          contactoTipo: 'cliente', contactoId: input.clienteId || null,
          refPrefix: 'FAC', motivo: 'Factura',
          condicion: input.condicionVenta, condicionDias: input.condicionDias,
          vencimientoFecha: input.vencimientoFecha || null,
        });
      } else if (_clase === 'nota_credito') {
        // NC de venta = devolución: REINGRESA el stock al depósito elegido y BAJA
        // lo que el cliente nos debe (haber).
        await crearMovimientosDesdeFactura(tx, {
          companyId: req.companyId, factura: f, tipo: 'ingreso', motivo: 'devolucion_venta',
          contraparteId: input.clienteId || null, contraparteTipo: 'cliente', refPrefix: 'VTA',
          userId: req.user?.id || null, depositoId: input.depositoId || null,
        });
        await tx.ctaCte.create({ data: {
          companyId: req.companyId, contactoTipo: 'cliente', contactoId: input.clienteId || null,
          fecha: input.fecha,
          detalle: `Nota de crédito ${input.tipo} ${String(input.puntoVenta).padStart(4,'0')}-${String(input.numero).padStart(8,'0')}`,
          moneda: _mon, cotizacion: _cot,
          haber: totales.total, referencia: `FAC-${f.id}`,
          observaciones: input.observaciones || null,
        }});
      } else {
        // ND de venta: SUMA lo que el cliente nos debe (debe). No toca stock.
        await tx.ctaCte.create({ data: {
          companyId: req.companyId, contactoTipo: 'cliente', contactoId: input.clienteId || null,
          fecha: input.fecha,
          detalle: `Nota de débito ${input.tipo} ${String(input.puntoVenta).padStart(4,'0')}-${String(input.numero).padStart(8,'0')}`,
          moneda: _mon, cotizacion: _cot,
          debe: totales.total, referencia: `FAC-${f.id}`,
          observaciones: input.observaciones || null,
        }});
      }
      // Vincular la labor a terceros con esta factura (queda "facturada").
      // LaborAplicada no tiene companyId; validamos la pertenencia por el cliente.
      if (input.laborServicioId) {
        const lab = await tx.laborAplicada.findFirst({ where: { id: input.laborServicioId, esServicio: true }, include: { cliente: true } }).catch(()=>null);
        if (lab && lab.cliente && lab.cliente.companyId === req.companyId) {
          await tx.laborAplicada.update({ where: { id: lab.id }, data: { facturaId: f.id } });
        }
      }
      return f;
    });
    res.status(201).json({ ok: true, data: factura });
  } catch (e) { next(e); }
});

// ============================================================
// IMPORTAR "Mis Comprobantes -> Emitidos" de ARCA (Excel).
// Crea una Factura (venta) por comprobante: alta de cliente por CUIT (receptor),
// IVA por alicuota y cuenta a COBRAR. Marca origen 'arca_externa' + estado
// 'autorizada' con el CAE real. Deduplica por (companyId, tipo, PV, numero).
// NO mueve stock (ARCA no trae renglones); son ventas ya emitidas.
// ============================================================
app.post('/api/facturas/import-arca', requireCompany, requirePermission('ventas:create'), async (req, res, next) => {
  try {
    const matrix = req.body?.matrix;
    if (!Array.isArray(matrix) || !matrix.length) return res.status(400).json({ ok:false, error:'No se recibieron filas del Excel.' });
    let hdrIdx = -1;
    for (let i=0;i<Math.min(matrix.length,10);i++){ const cells=(matrix[i]||[]).map(_normHdr); if(cells.includes('fecha') && cells.some(c=>c==='imp total')){ hdrIdx=i; break; } }
    if (hdrIdx<0) return res.status(400).json({ ok:false, error:'No encontré la fila de encabezados de "Mis Comprobantes". ¿Es el Excel correcto?' });
    const H = {}; (matrix[hdrIdx]||[]).forEach((h,i)=>{ H[_normHdr(h)] = i; });
    const get = (row,name)=>{ const i = H[name]; return i!=null ? row[i] : undefined; };
    // Control de CUIT: si el nombre del archivo trae un CUIT distinto al de la
    // empresa activa, cortamos para no cargar ventas en la empresa equivocada.
    const company = await prisma.company.findUnique({ where:{ id:req.companyId }, select:{ cuit:true, arcaCuit:true } });
    const propioCuit = String(company?.cuit || company?.arcaCuit || '').replace(/\D/g,'');
    const archivoCuit = String(req.body?.archivoCuit||'').replace(/\D/g,'');
    if (propioCuit && archivoCuit && archivoCuit !== propioCuit) {
      return res.status(400).json({ ok:false, error:`El Excel es del CUIT ${archivoCuit}, pero la empresa activa tiene CUIT ${propioCuit}. Cambiá de empresa o revisá el archivo.` });
    }

    const resumen = { creados:0, duplicados:0, omitidos:0, errores:0 };
    const detalle = [];
    const vistos = new Set();

    for (let r=hdrIdx+1; r<matrix.length; r++){
      const row = matrix[r]; if(!row || !row.length) continue;
      const fechaRaw = get(row,'fecha'); if(fechaRaw==null || String(fechaRaw).trim()==='') continue;
      try {
        const fecha = _arcaFecha(fechaRaw);
        const tipoCod = parseInt(String(get(row,'tipo')||'').match(/\d+/)?.[0] || '0', 10);
        const map = ARCA_TIPO_MAP[tipoCod];
        const pv = parseInt(String(get(row,'punto de venta')||'0').replace(/\D/g,'')||'0',10);
        const numero = parseInt(String(get(row,'numero desde')||'0').replace(/\D/g,'')||'0',10);
        const cae = String(get(row,'cod autorizacion')||'').trim();
        const tipoDocRec = String(get(row,'tipo doc receptor')||'').toUpperCase();
        const docReceptor = String(get(row,'nro doc receptor')||'').replace(/\D/g,'');
        const razon = String(get(row,'denominacion receptor')||'').trim();
        if(!map){ resumen.omitidos++; detalle.push({ fila:r+1, estado:'omitido', motivo:`Tipo ${tipoCod} no soportado`, ref:`${pv}-${numero}` }); continue; }
        const [letra, clase] = map;
        const key = `${letra}|${pv}|${numero}`;
        if(vistos.has(key)){ resumen.duplicados++; detalle.push({ fila:r+1, estado:'duplicado', motivo:'Repetido en el archivo', ref:`${letra} ${pv}-${numero}`, proveedor:razon }); continue; }
        vistos.add(key);
        const monRaw = String(get(row,'moneda')||'').toUpperCase();
        const esUsd = /US|U\$|D[OÓ]LAR|USD/.test(monRaw);
        const moneda = esUsd ? 'USD' : 'ARS';
        const cotiz = moneda==='ARS' ? 1 : (_arcaNum(get(row,'tipo cambio'))||null);
        const impTotal = _arcaNum(get(row,'imp total'));
        const noGrav = _arcaNum(get(row,'neto no gravado')) + _arcaNum(get(row,'op exentas')) + _arcaNum(get(row,'neto grav iva 0%'));
        const otros = _arcaNum(get(row,'otros tributos'));
        const alics = [[2.5,'neto grav iva 2,5%'],[5,'neto grav iva 5%'],[10.5,'neto grav iva 10,5%'],[21,'neto grav iva 21%'],[27,'neto grav iva 27%']];
        const items = [];
        for(const [a,cn] of alics){ const neto=_arcaNum(get(row,cn)); if(neto>0.005) items.push({ descripcion:`Neto gravado ${a}%`, cantidad:1, precioUnit:neto, alicuotaIva:a }); }
        if(noGrav>0.005) items.push({ descripcion:'No gravado / exento', cantidad:1, precioUnit:noGrav, alicuotaIva:0 });
        if(otros>0.005) items.push({ descripcion:'Otros tributos / percepciones', cantidad:1, precioUnit:otros, alicuotaIva:0 });
        if(!items.length){ items.push({ descripcion:'Importe total (comprobante ARCA)', cantidad:1, precioUnit:impTotal, alicuotaIva:0 }); }

        const creada = await prisma.$transaction(async (tx)=>{
          const dup = await tx.factura.findFirst({ where:{ companyId:req.companyId, tipo:letra, clase, puntoVenta:pv, numero, estado:{ not:'anulada' } } });
          if(dup) return { _dup:true, cliente: razon };
          // Cliente por CUIT (receptor) o razon social. Puede quedar null (consumidor final).
          let cli = null;
          if(docReceptor && tipoDocRec==='CUIT') cli = await tx.cliente.findFirst({ where:{ companyId:req.companyId, cuit:docReceptor } });
          if(!cli && razon) cli = await tx.cliente.findFirst({ where:{ companyId:req.companyId, razonSocial:{ equals:razon, mode:'insensitive' } } });
          if(!cli && (razon || (docReceptor && tipoDocRec==='CUIT'))) cli = await tx.cliente.create({ data:{ companyId:req.companyId, razonSocial: razon || `Cliente ${docReceptor||''}`.trim(), cuit:(tipoDocRec==='CUIT'?docReceptor:null)||null } });
          let calc = calcFactura(items);
          const dif = impTotal - calc.total;
          if(Math.abs(dif) > 0.5){ items.push({ descripcion:'Ajuste (redondeo ARCA)', cantidad:1, precioUnit:dif, alicuotaIva:0 }); calc = calcFactura(items); }
          const obs = `Importada de Mis Comprobantes (ARCA)${cae?` · CAE ${cae}`:''}`;
          const f = await tx.factura.create({ data:{
            companyId:req.companyId, clienteId: cli?cli.id:null, tipo:letra, clase, puntoVenta:pv, numero, fecha,
            moneda, cotizacion:cotiz, observaciones:obs, subtotal:calc.subtotal, iva:calc.iva, total:calc.total,
            cae: cae||null, caeVto:null, estado:'autorizada', origen:'arca_externa',
            items:{ create: calc.items },
          }, include:{ items:true } });
          if(clase==='factura'){
            await crearCtaCteDesdeFactura(tx, { companyId:req.companyId, factura:f, contactoTipo:'cliente', contactoId: cli?cli.id:null, refPrefix:'FAC', motivo:'Factura' });
          } else if (cli) {
            const esNC = clase==='nota_credito';
            await tx.ctaCte.create({ data:{ companyId:req.companyId, contactoTipo:'cliente', contactoId:cli.id, fecha,
              detalle:`${esNC?'Nota de crédito':'Nota de débito'} ${letra} ${String(pv).padStart(4,'0')}-${String(numero).padStart(8,'0')}`,
              moneda, cotizacion:cotiz, ...(esNC?{haber:f.total}:{debe:f.total}), referencia:`FAC-${f.id}`, observaciones:obs }});
          }
          return { _dup:false, cliente: cli?cli.razonSocial:(razon||'Consumidor final'), total:f.total };
        });
        if(creada._dup){ resumen.duplicados++; detalle.push({ fila:r+1, estado:'duplicado', motivo:'Ya existía en el sistema', ref:`${letra} ${pv}-${numero}`, proveedor:creada.cliente }); }
        else { resumen.creados++; detalle.push({ fila:r+1, estado:'creado', ref:`${letra} ${pv}-${numero}`, proveedor:creada.cliente, total:creada.total }); }
      } catch(eRow){
        resumen.errores++; detalle.push({ fila:r+1, estado:'error', motivo:String(eRow.message||eRow).slice(0,160) });
      }
    }
    res.json({ ok:true, resumen, detalle });
  } catch (e) { next(e); }
});

app.post('/api/facturas/:id/anular', requireCompany, requirePermission('ventas:update'), async (req, res, next) => {
  try {
    const existing = await prisma.factura.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrada' });
    // Anulacion: marcar la factura como anulada, devolver el stock y quitar el
    // movimiento de cuenta corriente.
    const data = await prisma.$transaction(async (tx) => {
      await borrarMovimientosDeFactura(tx, { companyId: req.companyId, refPrefix: 'VTA', facturaId: req.params.id });
      await borrarCtaCteDeFactura(tx, { companyId: req.companyId, refPrefix: 'FAC', facturaId: req.params.id });
      return tx.factura.update({ where: { id: req.params.id }, data: { estado: 'anulada' } });
    });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});

// Eliminar DEFINITIVAMENTE una factura de venta — solo si NO tiene CAE (no
// autorizada por ARCA) y NO tiene cobros aplicados. Devuelve el stock.
app.delete('/api/facturas/:id', requireCompany, requirePermission('ventas:delete'), async (req, res, next) => {
  try {
    const f = await prisma.factura.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!f) return res.status(404).json({ ok: false, error: 'No encontrada' });
    if (f.cae) return res.status(400).json({ ok: false, error: 'La factura tiene CAE (autorizada por ARCA). No se puede eliminar; usá Anular.' });
    // ¿Tiene cobros aplicados? (contra-asientos haber con la misma referencia)
    const cobros = await prisma.ctaCte.count({ where: { companyId: req.companyId, referencia: `FAC-${req.params.id}`, haber: { gt: 0.01 } } });
    if (cobros > 0) return res.status(400).json({ ok: false, error: 'La factura tiene un cobro aplicado. Primero eliminá el pago/cobro y después la factura.' });
    await prisma.$transaction(async (tx) => {
      await borrarMovimientosDeFactura(tx, { companyId: req.companyId, refPrefix: 'VTA', facturaId: req.params.id });
      await borrarCtaCteDeFactura(tx, { companyId: req.companyId, refPrefix: 'FAC', facturaId: req.params.id });
      await tx.factura.delete({ where: { id: req.params.id } }); // items caen por onDelete: Cascade
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- COMPRAS ----------
app.get('/api/facturas-compra', requireCompany, requirePermission('compras:read'), async (req, res, next) => {
  try {
    const { desde, hasta } = req.query;
    const where = { companyId: req.companyId };
    if (desde || hasta) { where.fecha = {}; if (desde) where.fecha.gte = new Date(desde); if (hasta) where.fecha.lte = new Date(hasta); }
    const facturas = await prisma.facturaCompra.findMany({ where, orderBy: { fecha: 'desc' }, include: { proveedor: true, items: true } });
    // Marcar cuáles ya tienen un pago aplicado (para no permitir editarlas).
    const pagos = await prisma.ctaCte.findMany({
      where: { companyId: req.companyId, contactoTipo: 'proveedor', referencia: { startsWith: 'FACC-' }, OR: [{ haber: { gt: 0.01 } }, { pagado: true }] },
      select: { referencia: true },
    });
    const pagadas = new Set(pagos.map(p => String(p.referencia || '').replace(/^FACC-/, '')));
    res.json({ ok: true, data: facturas.map(f => ({ ...f, pagada: pagadas.has(f.id) })) });
  } catch (e) { next(e); }
});

// Helper: ¿la factura de compra tiene un pago aplicado (OP)? Un pago crea una
// fila en la cuenta con haber>0 y referencia FACC-<id>, y marca pagado=true si
// cubre todo. Detecta pagos totales y parciales.
async function _compraTienePago(companyId, facturaId) {
  const row = await prisma.ctaCte.findFirst({
    where: { companyId, contactoTipo: 'proveedor', referencia: `FACC-${facturaId}`, OR: [{ haber: { gt: 0.01 } }, { pagado: true }] },
    select: { id: true },
  });
  return !!row;
}

app.get('/api/facturas-compra/libroIva/:anio/:mes', requireCompany, requirePermission('compras:read'), async (req, res, next) => {
  try {
    const anio = Number(req.params.anio), mes = Number(req.params.mes);
    const desde = new Date(anio, mes - 1, 1), hasta = new Date(anio, mes, 0, 23, 59, 59);
    res.json({
      ok: true,
      periodo: { anio, mes },
      data: await prisma.facturaCompra.findMany({
        where: { companyId: req.companyId, fecha: { gte: desde, lte: hasta } },
        include: { items: true, proveedor: true }, orderBy: { fecha: 'asc' },
      }),
    });
  } catch (e) { next(e); }
});

app.get('/api/facturas-compra/:id', requireCompany, requirePermission('compras:read'), async (req, res, next) => {
  try {
    const row = await prisma.facturaCompra.findFirst({
      where: { id: req.params.id, companyId: req.companyId },
      include: { proveedor: true, items: true },
    });
    if (!row) return res.status(404).json({ ok: false, error: 'No encontrada' });
    const pagada = await _compraTienePago(req.companyId, row.id);
    res.json({ ok: true, data: { ...row, pagada } });
  } catch (e) { next(e); }
});

app.post('/api/facturas-compra', requireCompany, requirePermission('compras:create'), async (req, res, next) => {
  try {
    const schema = z.object({
      proveedorId: z.string().nullable().optional(),
      tipo: z.enum(['A', 'B', 'C', 'E']),
      clase: z.enum(['factura', 'nota_credito', 'nota_debito']).optional().default('factura'),
      puntoVenta: z.number().int(),
      numero: z.number().int(),
      fecha: z.coerce.date(),
      condicionCompra: z.string().nullable().optional(),
      condicionDias: z.number().int().min(0).nullable().optional(),  // del catálogo
      vencimientoFecha: z.coerce.date().nullable().optional(),       // si la condición es "a fecha fija"
      moneda: z.string().optional(),
      cotizacion: z.number().positive().nullable().optional(),
      depositoId: z.string().nullable().optional(),   // depósito destino del stock que entra
      observaciones: z.string().nullable().optional(),
      items: z.array(itemFacSchema).min(1),
      // Datos del emisor cuando no hay proveedor en el catálogo (vienen del PDF)
      emisorCuit: z.string().nullable().optional(),
      emisorRazonSocial: z.string().nullable().optional(),
      cae: z.string().nullable().optional(),
    });
    const input = schema.parse(req.body);
    // Si no hay proveedor pero sí datos del emisor (PDF), los preservamos en observaciones
    if (!input.proveedorId && (input.emisorCuit || input.emisorRazonSocial)) {
      const ext = [
        input.emisorRazonSocial ? `Emisor: ${input.emisorRazonSocial}` : null,
        input.emisorCuit ? `CUIT ${input.emisorCuit}` : null,
        input.cae ? `CAE ${input.cae}` : null,
      ].filter(Boolean).join(' · ');
      input.observaciones = ext + (input.observaciones ? ' | ' + input.observaciones : '');
    }
    // Transaccion: crear factura compra + sumar stock con movimientos ingreso.
    const factura = await prisma.$transaction(async (tx) => {
      // Resolver productoIds desde nombre (crea Producto si no existe)
      for (const it of input.items) {
        it.productoId = await _ensureProductoFromItem(tx, req.companyId, it);
      }
      const totales = calcFactura(input.items);
      const _mon = input.moneda || 'ARS';
      const _cot = _mon === 'ARS' ? 1 : (input.cotizacion ?? await getCotizacionARS(_mon, input.fecha, req.companyId));
      const _clase = input.clase || 'factura';
      const f = await tx.facturaCompra.create({
        data: {
          companyId: req.companyId, proveedorId: input.proveedorId || null,
          tipo: input.tipo, clase: _clase, puntoVenta: input.puntoVenta, numero: input.numero, fecha: input.fecha,
          condicionCompra: input.condicionCompra, observaciones: input.observaciones,
          moneda: _mon, cotizacion: _cot,
          subtotal: totales.subtotal, iva: totales.iva, total: totales.total,
          items: { create: totales.items },
        },
        include: { proveedor: true, items: true },
      });
      if (_clase === 'factura') {
        // Factura: entra stock + le quedamos debiendo al proveedor (debe).
        await crearMovimientosDesdeFactura(tx, {
          companyId: req.companyId, factura: f, tipo: 'ingreso', motivo: 'compra',
          contraparteId: input.proveedorId || null, contraparteTipo: 'proveedor', refPrefix: 'CPR',
          userId: req.user?.id || null, depositoId: input.depositoId || null,
        });
        await crearCtaCteDesdeFactura(tx, {
          companyId: req.companyId, factura: f,
          contactoTipo: 'proveedor', contactoId: input.proveedorId || null,
          refPrefix: 'FACC', motivo: 'Compra',
          condicion: input.condicionCompra, condicionDias: input.condicionDias,
          vencimientoFecha: input.vencimientoFecha || null,
        });
      } else {
        // Nota de crédito: reduce lo que le debemos (haber). Nota de débito: lo suma (debe).
        // No tocan el stock por defecto (suelen ser ajustes de precio/gastos, no devolución
        // de mercadería); si fuese una devolución, ajustá el stock a mano.
        const esNC = _clase === 'nota_credito';
        await tx.ctaCte.create({ data: {
          companyId: req.companyId, contactoTipo: 'proveedor', contactoId: input.proveedorId || null,
          fecha: input.fecha,
          detalle: `${esNC ? 'Nota de crédito' : 'Nota de débito'} ${input.tipo} ${String(input.puntoVenta).padStart(4,'0')}-${String(input.numero).padStart(8,'0')}`,
          moneda: _mon, cotizacion: _cot,
          ...(esNC ? { haber: totales.total } : { debe: totales.total }),
          referencia: 'FACC',
          observaciones: input.observaciones || null,
        }});
      }
      // Guardar el costo unitario de la última compra de cada producto (para
      // autocompletarlo después en la carga de insumos y en la venta).
      for (const it of input.items) {
        if (it.productoId && it.precioUnit != null) {
          await tx.producto.update({
            where: { id: it.productoId },
            data: { ultimoCostoCompra: Number(it.precioUnit), ultimoCostoMoneda: _mon },
          });
        }
      }
      return f;
    });
    res.status(201).json({ ok: true, data: factura });
  } catch (e) { next(e); }
});

// ============================================================
// IMPORTAR "Mis Comprobantes → Recibidos" de ARCA (Excel).
// El frontend parsea el .xlsx a una matriz (array de filas) y la manda acá.
// Creamos una FacturaCompra por comprobante: alta de proveedor por CUIT,
// IVA reconstruido por alícuota y cuenta a pagar. Deduplica por el índice
// único (companyId, proveedorId, tipo, puntoVenta, numero). NO carga renglones
// de stock (ARCA no los provee): los ítems se agregan después a mano.
// ============================================================
const ARCA_TIPO_MAP = {
  1:['A','factura'], 2:['A','nota_debito'], 3:['A','nota_credito'],
  6:['B','factura'], 7:['B','nota_debito'], 8:['B','nota_credito'],
  11:['C','factura'], 12:['C','nota_debito'], 13:['C','nota_credito'],
  51:['M','factura'], 52:['M','nota_debito'], 53:['M','nota_credito'],
  19:['E','factura'], 20:['E','nota_debito'], 21:['E','nota_credito'],
};
function _normHdr(s){ return String(s==null?'':s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\./g,'').replace(/\s+/g,' ').trim(); }
function _arcaNum(v){ if(v==null) return 0; let s=String(v).trim(); if(!s) return 0;
  if(s.includes(',')&&s.includes('.')) s=s.replace(/\./g,'').replace(',','.'); else if(s.includes(',')) s=s.replace(',','.');
  const n=Number(s.replace(/[^0-9.\-]/g,'')); return isFinite(n)?n:0; }
function _arcaFecha(v){ if(v instanceof Date) return v; const s=String(v==null?'':v).trim();
  let m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); if(m){ let y=+m[3]; if(y<100)y+=2000; return new Date(y,+m[2]-1,+m[1]); }
  m=s.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m) return new Date(+m[1],+m[2]-1,+m[3]); const d=new Date(s); return isNaN(d)?null:d; }

app.post('/api/facturas-compra/import-arca', requireCompany, requirePermission('compras:create'), async (req, res, next) => {
  try {
    const matrix = req.body?.matrix;
    if (!Array.isArray(matrix) || !matrix.length) return res.status(400).json({ ok:false, error:'No se recibieron filas del Excel.' });
    // Ubicar la fila de encabezados (la que tiene "Fecha" e "Imp. Total")
    let hdrIdx = -1;
    for (let i=0;i<Math.min(matrix.length,10);i++){ const cells=(matrix[i]||[]).map(_normHdr); if(cells.includes('fecha') && cells.some(c=>c==='imp total')){ hdrIdx=i; break; } }
    if (hdrIdx<0) return res.status(400).json({ ok:false, error:'No encontré la fila de encabezados de "Mis Comprobantes". ¿Es el Excel correcto?' });
    const H = {}; (matrix[hdrIdx]||[]).forEach((h,i)=>{ H[_normHdr(h)] = i; });
    const col = (name)=> H[name] != null ? H[name] : -1;
    const get = (row,name)=>{ const i=col(name); return i>=0 ? row[i] : undefined; };
    const company = await prisma.company.findUnique({ where:{ id:req.companyId }, select:{ cuit:true, arcaCuit:true } });
    const propioCuit = String(company?.cuit || company?.arcaCuit || '').replace(/\D/g,'');
    // Control de CUIT: el Excel de ARCA se baja por CUIT. Si el nombre del archivo
    // trae un CUIT distinto al de la empresa activa, cortamos para no mezclar empresas.
    const archivoCuit = String(req.body?.archivoCuit||'').replace(/\D/g,'');
    if (propioCuit && archivoCuit && archivoCuit !== propioCuit) {
      return res.status(400).json({ ok:false, error:`El Excel es del CUIT ${archivoCuit}, pero la empresa activa tiene CUIT ${propioCuit}. Cambiá de empresa o revisá el archivo.` });
    }

    const resumen = { creados:0, duplicados:0, omitidos:0, errores:0 };
    const detalle = [];
    const vistos = new Set();

    for (let r=hdrIdx+1; r<matrix.length; r++){
      const row = matrix[r]; if(!row || !row.length) continue;
      const fechaRaw = get(row,'fecha'); if(fechaRaw==null || String(fechaRaw).trim()==='') continue;
      try {
        const fecha = _arcaFecha(fechaRaw);
        const tipoCod = parseInt(String(get(row,'tipo')||'').match(/\d+/)?.[0] || '0', 10);
        const map = ARCA_TIPO_MAP[tipoCod];
        const pv = parseInt(String(get(row,'punto de venta')||'0').replace(/\D/g,'')||'0',10);
        const numero = parseInt(String(get(row,'numero desde')||'0').replace(/\D/g,'')||'0',10);
        const cae = String(get(row,'cod autorizacion')||'').trim();
        const cuitEmisor = String(get(row,'nro doc emisor')||'').replace(/\D/g,'');
        const razon = String(get(row,'denominacion emisor')||'').trim();
        if(!map){ resumen.omitidos++; detalle.push({ fila:r+1, estado:'omitido', motivo:`Tipo ${tipoCod} no soportado`, ref:`${pv}-${numero}` }); continue; }
        if(propioCuit && cuitEmisor===propioCuit){ resumen.omitidos++; detalle.push({ fila:r+1, estado:'omitido', motivo:'El emisor sos vos (comprobante emitido)', ref:`${pv}-${numero}` }); continue; }
        // El receptor de un comprobante recibido tiene que ser esta empresa.
        const docRec = String(get(row,'nro doc receptor')||'').replace(/\D/g,'');
        const tipoRec = String(get(row,'tipo doc receptor')||'').toUpperCase();
        if(propioCuit && tipoRec==='CUIT' && docRec.length===11 && docRec!==propioCuit){ resumen.omitidos++; detalle.push({ fila:r+1, estado:'omitido', motivo:'El receptor es otro CUIT (no es esta empresa)', ref:`${pv}-${numero}` }); continue; }
        const [letra, clase] = map;
        // dedupe dentro del archivo
        const key = `${cuitEmisor}|${letra}|${pv}|${numero}`;
        if(vistos.has(key)){ resumen.duplicados++; detalle.push({ fila:r+1, estado:'duplicado', motivo:'Repetido en el archivo', ref:`${letra} ${pv}-${numero}`, proveedor:razon }); continue; }
        vistos.add(key);
        // Moneda
        const monRaw = String(get(row,'moneda')||'').toUpperCase();
        const esUsd = /US|U\$|D[OÓ]LAR|USD/.test(monRaw);
        const moneda = esUsd ? 'USD' : 'ARS';
        const cotiz = moneda==='ARS' ? 1 : (_arcaNum(get(row,'tipo cambio'))||null);
        // Montos por alícuota
        const impTotal = _arcaNum(get(row,'imp total'));
        const totalIva = _arcaNum(get(row,'total iva'));
        const noGrav = _arcaNum(get(row,'neto no gravado')) + _arcaNum(get(row,'op exentas')) + _arcaNum(get(row,'neto grav iva 0%'));
        const otros = _arcaNum(get(row,'otros tributos'));
        const alics = [[2.5,'neto grav iva 2,5%'],[5,'neto grav iva 5%'],[10.5,'neto grav iva 10,5%'],[21,'neto grav iva 21%'],[27,'neto grav iva 27%']];
        const items = [];
        for(const [a,cn] of alics){ const neto=_arcaNum(get(row,cn)); if(neto>0.005) items.push({ descripcion:`Neto gravado ${a}%`, cantidad:1, precioUnit:neto, alicuotaIva:a }); }
        if(noGrav>0.005) items.push({ descripcion:'No gravado / exento', cantidad:1, precioUnit:noGrav, alicuotaIva:0 });
        if(otros>0.005) items.push({ descripcion:'Otros tributos / percepciones', cantidad:1, precioUnit:otros, alicuotaIva:0 });
        if(!items.length){ items.push({ descripcion:'Importe total (comprobante ARCA)', cantidad:1, precioUnit:impTotal, alicuotaIva:0 }); }

        const creada = await prisma.$transaction(async (tx)=>{
          // Proveedor por CUIT (o razón social)
          let prov = cuitEmisor ? await tx.proveedor.findFirst({ where:{ companyId:req.companyId, cuit:cuitEmisor } }) : null;
          if(!prov && razon) prov = await tx.proveedor.findFirst({ where:{ companyId:req.companyId, razonSocial:{ equals:razon, mode:'insensitive' } } });
          if(!prov) prov = await tx.proveedor.create({ data:{ companyId:req.companyId, razonSocial: razon || `Proveedor ${cuitEmisor||''}`.trim(), cuit: cuitEmisor||null } });
          else if(cuitEmisor && !prov.cuit) await tx.proveedor.update({ where:{ id:prov.id }, data:{ cuit:cuitEmisor } });
          // dedupe contra la base (índice único companyId+proveedorId+tipo+pv+numero)
          const dup = await tx.facturaCompra.findFirst({ where:{ companyId:req.companyId, proveedorId:prov.id, tipo:letra, puntoVenta:pv, numero } });
          if(dup) return { _dup:true, proveedor: prov.razonSocial };
          // Ajuste para que subtotal+iva = Imp. Total exacto
          let calc = calcFactura(items);
          const dif = impTotal - calc.total;
          if(Math.abs(dif) > 0.5){ items.push({ descripcion:'Ajuste (redondeo ARCA)', cantidad:1, precioUnit:dif, alicuotaIva:0 }); calc = calcFactura(items); }
          const obs = `Importado de Mis Comprobantes (ARCA)${cae?` · CAE ${cae}`:''}`;
          const f = await tx.facturaCompra.create({ data:{
            companyId:req.companyId, proveedorId:prov.id, tipo:letra, clase, puntoVenta:pv, numero, fecha,
            moneda, cotizacion:cotiz, observaciones:obs,
            subtotal:calc.subtotal, iva:calc.iva, total:calc.total,
            items:{ create: calc.items },
          }, include:{ items:true } });
          if(clase==='factura'){
            await crearCtaCteDesdeFactura(tx, { companyId:req.companyId, factura:f, contactoTipo:'proveedor', contactoId:prov.id, refPrefix:'FACC', motivo:'Compra' });
          } else {
            const esNC = clase==='nota_credito';
            await tx.ctaCte.create({ data:{ companyId:req.companyId, contactoTipo:'proveedor', contactoId:prov.id, fecha,
              detalle:`${esNC?'Nota de crédito':'Nota de débito'} ${letra} ${String(pv).padStart(4,'0')}-${String(numero).padStart(8,'0')}`,
              moneda, cotizacion:cotiz, ...(esNC?{haber:f.total}:{debe:f.total}), referencia:'FACC', observaciones:obs }});
          }
          return { _dup:false, proveedor: prov.razonSocial, total:f.total };
        });
        if(creada._dup){ resumen.duplicados++; detalle.push({ fila:r+1, estado:'duplicado', motivo:'Ya existía en el sistema', ref:`${letra} ${pv}-${numero}`, proveedor:creada.proveedor }); }
        else { resumen.creados++; detalle.push({ fila:r+1, estado:'creado', ref:`${letra} ${pv}-${numero}`, proveedor:creada.proveedor, total:creada.total }); }
      } catch(eRow){
        resumen.errores++; detalle.push({ fila:r+1, estado:'error', motivo:String(eRow.message||eRow).slice(0,160) });
      }
    }
    res.json({ ok:true, resumen, detalle });
  } catch (e) { next(e); }
});

// EDITAR factura de compra: revierte (stock + cta cte + items) y la recrea.
// Bloquea si la compra ya tiene un pago aplicado (hay que deshacerlo primero).
app.put('/api/facturas-compra/:id', requireCompany, requirePermission('compras:create'), async (req, res, next) => {
  try {
    const schema = z.object({
      proveedorId: z.string().nullable().optional(),
      tipo: z.enum(['A', 'B', 'C', 'E']),
      clase: z.enum(['factura', 'nota_credito', 'nota_debito']).optional().default('factura'),
      puntoVenta: z.number().int(),
      numero: z.number().int(),
      fecha: z.coerce.date(),
      condicionCompra: z.string().nullable().optional(),
      condicionDias: z.number().int().min(0).nullable().optional(),
      vencimientoFecha: z.coerce.date().nullable().optional(),
      moneda: z.string().optional(),
      cotizacion: z.number().positive().nullable().optional(),
      depositoId: z.string().nullable().optional(),
      observaciones: z.string().nullable().optional(),
      items: z.array(itemFacSchema).min(1),
      emisorCuit: z.string().nullable().optional(),
      emisorRazonSocial: z.string().nullable().optional(),
      cae: z.string().nullable().optional(),
    });
    const input = schema.parse(req.body);
    const existing = await prisma.facturaCompra.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrada' });
    if (await _compraTienePago(req.companyId, req.params.id)) return res.status(400).json({ ok: false, error: 'No se puede editar: la compra tiene un pago aplicado (OP). Primero deshacé el pago desde la Orden de pago.' });
    if (!input.proveedorId && (input.emisorCuit || input.emisorRazonSocial)) {
      const ext = [ input.emisorRazonSocial ? `Emisor: ${input.emisorRazonSocial}` : null, input.emisorCuit ? `CUIT ${input.emisorCuit}` : null, input.cae ? `CAE ${input.cae}` : null ].filter(Boolean).join(' · ');
      input.observaciones = ext + (input.observaciones ? ' | ' + input.observaciones : '');
    }
    const factura = await prisma.$transaction(async (tx) => {
      for (const it of input.items) it.productoId = await _ensureProductoFromItem(tx, req.companyId, it);
      const totales = calcFactura(input.items);
      const _mon = input.moneda || 'ARS';
      const _cot = _mon === 'ARS' ? 1 : (input.cotizacion ?? await getCotizacionARS(_mon, input.fecha, req.companyId));
      const _clase = input.clase || 'factura';
      // revertir lo anterior
      await borrarMovimientosDeFactura(tx, { companyId: req.companyId, refPrefix: 'CPR', facturaId: req.params.id });
      await borrarCtaCteDeFactura(tx, { companyId: req.companyId, refPrefix: 'FACC', facturaId: req.params.id });
      // Las NC/ND guardan su cta cte con referencia 'FACC' (sin id): la ubicamos por su detalle
      // para no dejar una fila huérfana al editar.
      if (existing.clase !== 'factura') {
        const num = `${existing.tipo} ${String(existing.puntoVenta).padStart(4,'0')}-${String(existing.numero).padStart(8,'0')}`;
        await tx.ctaCte.deleteMany({ where: { companyId: req.companyId, contactoTipo: 'proveedor', contactoId: existing.proveedorId, referencia: 'FACC', detalle: { in: [`Nota de crédito ${num}`, `Nota de débito ${num}`] } } });
      }
      await tx.facturaCompraItem.deleteMany({ where: { facturaCompraId: req.params.id } });
      const f = await tx.facturaCompra.update({
        where: { id: req.params.id },
        data: {
          proveedorId: input.proveedorId || null, tipo: input.tipo, clase: _clase,
          puntoVenta: input.puntoVenta, numero: input.numero, fecha: input.fecha,
          condicionCompra: input.condicionCompra, observaciones: input.observaciones,
          moneda: _mon, cotizacion: _cot, subtotal: totales.subtotal, iva: totales.iva, total: totales.total,
          items: { create: totales.items },
        },
        include: { proveedor: true, items: true },
      });
      if (_clase === 'factura') {
        await crearMovimientosDesdeFactura(tx, { companyId: req.companyId, factura: f, tipo: 'ingreso', motivo: 'compra', contraparteId: input.proveedorId || null, contraparteTipo: 'proveedor', refPrefix: 'CPR', userId: req.user?.id || null, depositoId: input.depositoId || null });
        await crearCtaCteDesdeFactura(tx, { companyId: req.companyId, factura: f, contactoTipo: 'proveedor', contactoId: input.proveedorId || null, refPrefix: 'FACC', motivo: 'Compra', condicion: input.condicionCompra, condicionDias: input.condicionDias, vencimientoFecha: input.vencimientoFecha || null });
      } else {
        const esNC = _clase === 'nota_credito';
        await tx.ctaCte.create({ data: { companyId: req.companyId, contactoTipo: 'proveedor', contactoId: input.proveedorId || null, fecha: input.fecha,
          detalle: `${esNC ? 'Nota de crédito' : 'Nota de débito'} ${input.tipo} ${String(input.puntoVenta).padStart(4,'0')}-${String(input.numero).padStart(8,'0')}`,
          moneda: _mon, cotizacion: _cot, ...(esNC ? { haber: totales.total } : { debe: totales.total }), referencia: 'FACC', observaciones: input.observaciones || null }});
      }
      for (const it of input.items) { if (it.productoId && it.precioUnit != null) { await tx.producto.update({ where: { id: it.productoId }, data: { ultimoCostoCompra: Number(it.precioUnit), ultimoCostoMoneda: _mon } }); } }
      return f;
    });
    res.json({ ok: true, data: factura });
  } catch (e) { next(e); }
});

app.delete('/api/facturas-compra/:id', requireCompany, requirePermission('compras:delete'), async (req, res, next) => {
  try {
    const existing = await prisma.facturaCompra.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrada' });
    if (await _compraTienePago(req.companyId, req.params.id)) return res.status(400).json({ ok: false, error: 'No se puede eliminar: la compra tiene un pago aplicado (OP). Primero deshacé el pago desde la Orden de pago.' });
    // Borrar movimientos de stock y de cuenta corriente ANTES de borrar la factura.
    await prisma.$transaction(async (tx) => {
      await borrarMovimientosDeFactura(tx, { companyId: req.companyId, refPrefix: 'CPR', facturaId: req.params.id });
      await borrarCtaCteDeFactura(tx, { companyId: req.companyId, refPrefix: 'FACC', facturaId: req.params.id });
      await tx.facturaCompra.delete({ where: { id: req.params.id } });
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- FINANZAS ----------
mountCrud({
  path: 'cheques', modelName: 'cheque', perm: 'finanzas',
  schema: z.object({
    tipo: z.enum(['propio', 'terceros']),
    formato: z.string().nullable().optional(),  // "fisico" | "electronico"
    banco: z.string().nullable().optional(),
    cuenta: z.string().nullable().optional(),
    nroCheque: z.string().min(1),
    fechaEmision: z.coerce.date(),
    fechaPago: z.coerce.date(),
    monto: z.number(),
    beneficiario: z.string().nullable().optional(),
    librador: z.string().nullable().optional(),
    cuitTitular: z.string().nullable().optional(),
    endosante: z.string().nullable().optional(),
    fechaRecepcion: z.coerce.date().nullable().optional(),
    fechaEndoso: z.coerce.date().nullable().optional(),
    enPoderDe: z.string().nullable().optional(),
    estado: z.string().optional(),
    observaciones: z.string().nullable().optional(),
  }),
  orderBy: { fechaPago: 'asc' },
  searchFields: ['nroCheque', 'banco', 'beneficiario', 'librador', 'endosante', 'enPoderDe'],
  bloquearSi: (ch) => (ch.estado && ch.estado !== 'en_cartera') ? `el cheque ya fue usado (estado: ${ch.estado}). Volvelo a cartera si querés eliminarlo` : null,
  dependencias: [
    { model: 'bancoMovimiento', where: (id) => ({ chequeId: id }), label: 'movimientos bancarios vinculados' },
  ],
});

// ============================================================
// CHEQUE → BANCO: cambiar estado del cheque y, si corresponde, generar
// (o eliminar) el movimiento bancario asociado.
//   Tercero depositado/cobrado → INGRESO en cuenta (cheque_cobrado)
//   Propio   pagado/cobrado    → EGRESO en cuenta (cheque_pagado)
// Si vuelve a "en_cartera"/"emitido"/"anulado"/"rechazado": elimina el movimiento.
// ============================================================
const CHEQUE_BANCO_ESTADOS_INGRESO = new Set(['depositado', 'cobrado']); // terceros
const CHEQUE_BANCO_ESTADOS_EGRESO  = new Set(['pagado', 'cobrado']);     // propios

function _chequeMovTipo(cheque) {
  if (cheque.tipo === 'terceros' && CHEQUE_BANCO_ESTADOS_INGRESO.has(cheque.estado)) return 'cheque_cobrado';
  if (cheque.tipo === 'propio'   && CHEQUE_BANCO_ESTADOS_EGRESO.has(cheque.estado))  return 'cheque_pagado';
  return null;
}

// ============================================================
// ESTADOS DE CHEQUE configurables (reusa la tabla Catalogo, tipo "Estado de cheque").
// Sin migracion. Se siembran los defaults la primera vez. La logica de negocio
// sigue usando los codigos estables (en_cartera / emitido / endosado / depositado / ...).
// ============================================================
const CHEQUE_ESTADOS_DEFAULT = [
  { codigo:'en_cartera', nombre:'En cartera' },
  { codigo:'emitido',    nombre:'Emitido' },
  { codigo:'endosado',   nombre:'Endosado / Entregado' },
  { codigo:'depositado', nombre:'Depositado' },
  { codigo:'cobrado',    nombre:'Cobrado' },
  { codigo:'pagado',     nombre:'Pagado' },
  { codigo:'rechazado',  nombre:'Rechazado' },
  { codigo:'anulado',    nombre:'Anulado' },
];
async function seedChequeEstados(companyId) {
  const n = await prisma.catalogo.count({ where: { companyId, tipo: 'Estado de cheque' } });
  if (n > 0) return;
  for (const e of CHEQUE_ESTADOS_DEFAULT) {
    await prisma.catalogo.create({ data: { companyId, tipo: 'Estado de cheque', codigo: e.codigo, nombre: e.nombre } });
  }
}
app.get('/api/cheque-estados', requireCompany, requirePermission('finanzas:read'), async (req, res, next) => {
  try {
    await seedChequeEstados(req.companyId);
    const data = await prisma.catalogo.findMany({
      where: { companyId: req.companyId, tipo: 'Estado de cheque', activo: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, codigo: true, nombre: true },
    });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});
app.post('/api/cheque-estados', requireCompany, requirePermission('finanzas:create'), async (req, res, next) => {
  try {
    const d = z.object({ nombre: z.string().min(1) }).parse(req.body);
    let codigo = _slugCat(d.nombre);
    const dup = await prisma.catalogo.findFirst({ where: { companyId: req.companyId, tipo: 'Estado de cheque', codigo } });
    if (dup) codigo = codigo + '_' + Date.now().toString(36).slice(-4);
    const r = await prisma.catalogo.create({ data: { companyId: req.companyId, tipo: 'Estado de cheque', codigo, nombre: d.nombre } });
    res.status(201).json({ ok: true, data: { id: r.id, codigo: r.codigo, nombre: r.nombre } });
  } catch (e) { next(e); }
});
app.put('/api/cheque-estados/:id', requireCompany, requirePermission('finanzas:update'), async (req, res, next) => {
  try {
    const existing = await prisma.catalogo.findFirst({ where: { id: req.params.id, companyId: req.companyId, tipo: 'Estado de cheque' } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    const d = z.object({ nombre: z.string().min(1) }).parse(req.body);
    const r = await prisma.catalogo.update({ where: { id: existing.id }, data: { nombre: d.nombre } });
    res.json({ ok: true, data: { id: r.id, codigo: r.codigo, nombre: r.nombre } });
  } catch (e) { next(e); }
});
app.delete('/api/cheque-estados/:id', requireCompany, requirePermission('finanzas:delete'), async (req, res, next) => {
  try {
    const existing = await prisma.catalogo.findFirst({ where: { id: req.params.id, companyId: req.companyId, tipo: 'Estado de cheque' } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    await prisma.catalogo.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post('/api/cheques/:id/cambiar-estado', requireCompany, requirePermission('finanzas:update'), async (req, res, next) => {
  try {
    const cheque = await prisma.cheque.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!cheque) return res.status(404).json({ ok: false, error: 'Cheque no encontrado' });
    const schema = z.object({
      estado: z.string().min(1),
      cuentaBancoId: z.string().nullable().optional(),
      fecha: z.coerce.date().optional(),
      referencia: z.string().nullable().optional(),
      observaciones: z.string().nullable().optional(),
    });
    const d = schema.parse(req.body || {});
    const fechaMov = d.fecha || cheque.fechaPago || new Date();
    // Si el depósito/pago del cheque cae en un mes ya conciliado de esa cuenta, se bloquea.
    if (d.cuentaBancoId) {
      const bloq = await _conciliacionBloqueo(req.companyId, d.cuentaBancoId, fechaMov);
      if (bloq) return res.status(400).json({ ok: false, error: `El mes ${bloq.periodo} de esa cuenta está conciliado. Reabrí la conciliación para depositar/registrar el cheque en ese mes.` });
    }
    const result = await prisma.$transaction(async (tx) => {
      // 1) Actualizar estado del cheque
      const actualizado = await tx.cheque.update({
        where: { id: cheque.id },
        data: {
          estado: d.estado,
          // Al endosar/entregar/depositar sale de cartera: registramos la fecha si no estaba.
          ...(/endosad|entregad|deposit|pagad/i.test(d.estado) && !cheque.fechaEndoso ? { fechaEndoso: fechaMov } : {}),
        },
      });
      // 2) Recalcular si debe haber movimiento bancario para este cheque
      const tipoMov = _chequeMovTipo(actualizado);
      // Buscar movimiento bancario existente (puede ser de un cambio anterior)
      const existente = await tx.bancoMovimiento.findFirst({ where: { chequeId: cheque.id, companyId: req.companyId } });
      if (!tipoMov) {
        // El estado nuevo NO requiere movimiento → eliminar si había
        if (existente) await tx.bancoMovimiento.delete({ where: { id: existente.id } });
        return { cheque: actualizado, movimientoBanco: null };
      }
      // El estado nuevo SÍ requiere movimiento
      if (!d.cuentaBancoId) {
        // Si ya existía un movimiento (de un estado anterior), lo dejamos como está;
        // si no, el usuario no eligió cuenta → no creamos uno y avisamos.
        return { cheque: actualizado, movimientoBanco: existente, warning: existente ? null : 'Para registrar en el banco, elegí una cuenta bancaria' };
      }
      const cuenta = await tx.bancoCuenta.findFirst({ where: { id: d.cuentaBancoId, companyId: req.companyId } });
      if (!cuenta) throw Object.assign(new Error('Cuenta bancaria no encontrada'), { status: 400 });
      const concepto = `Cheque ${cheque.tipo === 'propio' ? 'propio' : 'de terceros'} #${cheque.nroCheque}${cheque.banco ? ' · ' + cheque.banco : ''}`;
      const contraparte = cheque.tipo === 'propio' ? (cheque.beneficiario || null) : (cheque.librador || null);
      let movimientoBanco;
      if (existente) {
        // Actualizar el movimiento existente (puede haber cambiado la cuenta, fecha o tipo)
        movimientoBanco = await tx.bancoMovimiento.update({
          where: { id: existente.id },
          data: {
            cuentaId: d.cuentaBancoId, fecha: fechaMov, tipo: tipoMov,
            concepto, monto: Number(cheque.monto || 0), contraparte,
            referencia: d.referencia || cheque.nroCheque, observaciones: d.observaciones || null,
            userId: req.user?.id || existente.userId,
          },
        });
      } else {
        movimientoBanco = await tx.bancoMovimiento.create({
          data: {
            companyId: req.companyId, cuentaId: d.cuentaBancoId,
            fecha: fechaMov, tipo: tipoMov,
            concepto, monto: Number(cheque.monto || 0), contraparte,
            referencia: d.referencia || cheque.nroCheque,
            chequeId: cheque.id, observaciones: d.observaciones || null,
            userId: req.user?.id || null,
          },
        });
      }
      return { cheque: actualizado, movimientoBanco };
    });
    res.json({ ok: true, data: result });
  } catch (e) { next(e); }
});

// IMPORTANTE: este endpoint va ANTES del mountCrud('ctas-ctes') porque el CRUD
// registra GET /api/ctas-ctes/:id y, si quedara después, "pendientes" se tomaría
// como un :id y devolvería "No encontrado".
app.get('/api/ctas-ctes/pendientes', requireCompany, requirePermission('finanzas:read'), async (req, res, next) => {
  try {
    const tipo = String(req.query.tipo || ''); // 'cliente' | 'proveedor'
    if (!['cliente', 'proveedor'].includes(tipo)) {
      return res.status(400).json({ ok: false, error: 'tipo debe ser cliente o proveedor' });
    }
    const contactoId = req.query.contactoId || undefined;
    const itemsRaw = await prisma.ctaCte.findMany({
      where: {
        companyId: req.companyId,
        contactoTipo: tipo,
        ...(contactoId ? { contactoId } : {}),
        pagado: false,
        OR: [ { debe: { gt: 0 } }, { haber: { gt: 0 } } ],
      },
      orderBy: { fecha: 'asc' },
    });
    // Excluir los contra-asientos de un pago/cobro (detalle "Pago de…"/"Cobro de…").
    // Son la contrapartida de un pago, no un comprobante a pagar ni un crédito a favor.
    // (Los nuevos ya se guardan como pagado:true; esto cubre los viejos.)
    const items = itemsRaw.filter(x => !/^(pago|cobro) de /i.test(x.detalle || ''));
    // Saldo a favor = créditos todavía no aplicados a una factura: pagos/cobros
    // "a cuenta" (referencia null) Y notas de crédito (referencia 'FACC'/'FAC-…').
    // Todos son asientos de haber puro (debe=0, haber>0). Una factura parcialmente
    // pagada tiene debe>0, así que no se cuenta acá.
    const saldoAFavor = items
      .filter(x => Number(x.debe || 0) === 0 && Number(x.haber || 0) > 0)
      .reduce((a, x) => a + Number(x.haber || 0), 0);
    res.json({ ok: true, data: items, saldoAFavor });
  } catch (e) { next(e); }
});

// Aplica el "saldo a favor" (pagos/cobros a cuenta previos) a facturas pendientes.
// No mueve plata nueva: transfiere el haber del crédito al comprobante (así la
// factura queda saldada y el crédito se consume). Mantiene el saldo global igual.
app.post('/api/ctas-ctes/aplicar-credito', requireCompany, requirePermission('finanzas:update'), async (req, res, next) => {
  try {
    const d = z.object({
      contactoTipo: z.enum(['cliente', 'proveedor']),
      contactoId: z.string().min(1),
      aplicaciones: z.array(z.object({ ctaCteId: z.string().min(1), importe: z.number().positive() })).min(1),
    }).parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      let aplicadoTotal = 0;
      for (const ap of d.aplicaciones) {
        const inv = await tx.ctaCte.findFirst({ where: { id: ap.ctaCteId, companyId: req.companyId, contactoTipo: d.contactoTipo, contactoId: d.contactoId } });
        if (!inv) throw Object.assign(new Error('Comprobante no encontrado: ' + ap.ctaCteId), { status: 404 });
        const saldoInv = Number(inv.debe || 0) - Number(inv.haber || 0);
        if (saldoInv <= 0.01) continue; // ya saldado
        const aAplicar = Math.min(ap.importe, saldoInv);
        const monedaInv = inv.moneda || 'ARS';
        // Créditos disponibles en la MISMA moneda, más viejos primero. Incluye
        // pagos/cobros a cuenta (referencia null) Y notas de crédito (haber puro,
        // debe=0). No incluye facturas parciales (esas tienen debe>0).
        const creditos = await tx.ctaCte.findMany({
          where: { companyId: req.companyId, contactoTipo: d.contactoTipo, contactoId: d.contactoId, pagado: false, debe: 0, haber: { gt: 0 }, moneda: monedaInv },
          orderBy: { fecha: 'asc' },
        });
        const disponible = creditos.reduce((a, c) => a + Number(c.haber || 0), 0);
        if (aAplicar > disponible + 0.01) throw Object.assign(new Error(`No hay saldo a favor suficiente en ${monedaInv} (disponible ${disponible.toFixed(2)})`), { status: 400 });
        // Consumir créditos FIFO.
        let restante = aAplicar;
        for (const cred of creditos) {
          if (restante <= 0.01) break;
          const tomar = Math.min(Number(cred.haber || 0), restante);
          const nuevoHaber = Math.round((Number(cred.haber || 0) - tomar) * 100) / 100;
          await tx.ctaCte.update({ where: { id: cred.id }, data: {
            haber: nuevoHaber, pagado: nuevoHaber <= 0.01,
            observaciones: (cred.observaciones ? cred.observaciones + ' · ' : '') + 'Aplicado a ' + (inv.detalle || inv.referencia || 'comprobante'),
          }});
          restante -= tomar;
        }
        // Aumentar el haber de la factura y saldarla si corresponde.
        const invHaber = Math.round((Number(inv.haber || 0) + aAplicar) * 100) / 100;
        await tx.ctaCte.update({ where: { id: inv.id }, data: {
          haber: invHaber, pagado: (Number(inv.debe || 0) - invHaber) <= 0.01,
        }});
        aplicadoTotal += aAplicar;
      }
      return { aplicadoTotal: Math.round(aplicadoTotal * 100) / 100 };
    });
    res.json({ ok: true, ...result });
  } catch (e) { next(e); }
});

mountCrud({
  path: 'ctas-ctes', modelName: 'ctaCte', perm: 'finanzas',
  schema: z.object({
    contactoTipo: z.enum(['cliente', 'proveedor', 'libre']).nullable().optional(),
    contactoId: z.string().nullable().optional(),
    nombreLibre: z.string().nullable().optional(),
    fecha: z.coerce.date(),
    vencimiento: z.coerce.date().nullable().optional(),
    detalle: z.string().min(1),
    categoria: z.string().nullable().optional(),
    moneda: z.string().nullable().optional(),
    cotizacion: z.number().positive().nullable().optional(),
    debe: z.number().optional(),
    haber: z.number().optional(),
    pagado: z.boolean().optional(),
    referencia: z.string().nullable().optional(),
    observaciones: z.string().nullable().optional(),
  }),
  orderBy: { fecha: 'desc' },
  searchFields: ['detalle', 'nombreLibre', 'referencia', 'categoria'],
});

mountCrud({
  path: 'arrendamientos', modelName: 'arrendamiento', perm: 'finanzas',
  schema: z.object({
    campoId: z.string().nullable().optional(),
    nombre: z.string().nullable().optional(),
    propietario: z.string().min(1),
    hectareas: z.number(),
    importeHa: z.number().nullable().optional(),
    tipoPago: z.string().nullable().optional(),
    vencimiento: z.coerce.date().nullable().optional(),
    pagado: z.boolean().optional(),
    modalidad: z.string().nullable().optional(),
    grano: z.string().nullable().optional(),
    quintalesHaBlanco: z.number().nullable().optional(),
    quintalesHaNegro: z.number().nullable().optional(),
    moneda: z.string().nullable().optional(),
    cuotas: z.array(z.object({
      etiqueta: z.string().nullable().optional(),
      vencimiento: z.string().nullable().optional(),
      quintalesHa: z.number().nullable().optional(),
      kgNovillo: z.number().nullable().optional(),   // cuota en Kg Novillo (total)
      importe: z.number().nullable().optional(),     // cuota en efectivo (moneda del contrato)
      color: z.string().nullable().optional(),
      pagado: z.boolean().optional(),
      pago: z.any().nullable().optional(),           // datos del pago (método, fecha, monto)
    })).nullable().optional(),
    observaciones: z.string().nullable().optional(),
  }),
  orderBy: { vencimiento: 'asc' },
  searchFields: ['propietario','nombre'],
  bloquearSi: (a) => {
    const cs = Array.isArray(a.cuotas) ? a.cuotas : [];
    if (cs.some(c => c && c.pagado)) return 'tiene cuotas pagadas. Deshacé esos pagos primero';
    if (a.pagado) return 'está marcado como pagado';
    return null;
  },
});

mountCrud({
  path: 'efectivo', modelName: 'efectivo', perm: 'finanzas',
  schema: z.object({
    fecha: z.coerce.date(),
    tipo: z.enum(['ingreso', 'egreso', 'transferencia']),
    concepto: z.string().min(1),
    monto: z.number(),
    caja: z.string().nullable().optional(),
    cajaDestino: z.string().nullable().optional(),
    clasificacion: z.string().nullable().optional(),
    observaciones: z.string().nullable().optional(),
  }),
  orderBy: { fecha: 'desc' },
  searchFields: ['concepto', 'caja'],
});

mountCrud({
  path: 'flujo-caja', modelName: 'flujoCaja', perm: 'finanzas',
  schema: z.object({
    fecha: z.coerce.date(),
    concepto: z.string().min(1),
    categoria: z.string().nullable().optional(),
    monto: z.number(),
    saldoAcum: z.number().nullable().optional(),
    observaciones: z.string().nullable().optional(),
  }),
  orderBy: { fecha: 'desc' },
  searchFields: ['concepto', 'categoria'],
});

// ---------- RESUMEN MULTI-EMPRESA (consolidado) ----------
// Devuelve datos agregados de las empresas a las que el usuario tiene acceso:
// cheques (pendientes, a vencer, vencidos), efectivo (saldo por caja) y flujo de
// caja (saldo neto). Util para ver "el todo" sin tener que cambiar de empresa.
// No requiere requireCompany porque por definicion consulta varias empresas.
app.get('/api/resumen-multiempresa', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ ok: false, error: 'No autenticado' });
    // Requiere permiso "Reportes" (salvo superAdmin). Se controla en Roles.
    if (!req.user.superAdmin && !hasPermission(req.membership?.role?.permissions || [], 'reportes:read')) {
      return res.status(403).json({ ok: false, error: 'Permiso denegado', required: 'reportes:read' });
    }
    // Si es superAdmin sin headers, listamos TODAS las empresas activas
    let empresas;
    if (req.user.superAdmin) {
      empresas = await prisma.company.findMany({ where: { activo: true }, select: { id: true, name: true, color: true } });
    } else {
      empresas = (req.user.userCompanies || []).map((uc) => ({
        id: uc.companyId, name: uc.company.name, color: uc.company.color,
      }));
    }
    if (!empresas.length) {
      return res.json({ ok: true, data: { porEmpresa: [], totales: emptyTotales() } });
    }
    const companyIds = empresas.map((e) => e.id);
    const hoy = new Date();
    const hoy15 = new Date(hoy.getTime() + 15 * 24 * 60 * 60 * 1000);
    const estadosPendientes = ['en_cartera', 'emitido', 'depositado'];

    // Traemos los registros relevantes de TODAS las empresas en una sola query c/u
    const [cheques, efectivos, flujos] = await Promise.all([
      prisma.cheque.findMany({ where: { companyId: { in: companyIds } } }),
      prisma.efectivo.findMany({ where: { companyId: { in: companyIds } } }),
      prisma.flujoCaja.findMany({ where: { companyId: { in: companyIds } } }),
    ]);

    const porEmpresa = empresas.map((emp) => {
      const ch = cheques.filter((c) => c.companyId === emp.id);
      const chPend = ch.filter((c) => estadosPendientes.includes((c.estado || '').toLowerCase()));
      const chVenc = chPend.filter((c) => c.fechaPago && new Date(c.fechaPago) < hoy);
      const chAVenc = chPend.filter((c) => {
        if (!c.fechaPago) return false;
        const f = new Date(c.fechaPago);
        return f >= hoy && f <= hoy15;
      });
      const sumMonto = (arr) => arr.reduce((a, x) => a + Number(x.monto || 0), 0);

      const ef = efectivos.filter((e) => e.companyId === emp.id);
      // Las transferencias mueven plata entre cajas: son neutras para el total
      // de efectivo de la empresa. Solo ingresos suman y egresos restan.
      const saldoEfectivo = ef.reduce((a, e) => {
        if (e.tipo === 'ingreso') return a + Number(e.monto || 0);
        if (e.tipo === 'egreso') return a - Number(e.monto || 0);
        return a;
      }, 0);

      // Desglose por caja (campo libre, ej. nombre del dueño "Lucas").
      // Las transferencias entre cajas se reflejan: restan en origen y suman en destino.
      const cajasMap = new Map();
      const ensureCaja = (nombre) => {
        const key = (nombre && String(nombre).trim()) || '(sin caja)';
        if (!cajasMap.has(key)) {
          cajasMap.set(key, {
            nombre: key,
            ingresos: 0, egresos: 0,
            transferenciaIn: 0, transferenciaOut: 0,
            saldo: 0, movimientos: 0,
          });
        }
        return cajasMap.get(key);
      };
      for (const e of ef) {
        const monto = Number(e.monto || 0);
        const tipo = (e.tipo || '').toLowerCase();
        if (tipo === 'ingreso') {
          const c = ensureCaja(e.caja);
          c.ingresos += monto; c.saldo += monto; c.movimientos += 1;
        } else if (tipo === 'egreso') {
          const c = ensureCaja(e.caja);
          c.egresos += monto; c.saldo -= monto; c.movimientos += 1;
        } else if (tipo === 'transferencia') {
          const origen = ensureCaja(e.caja);
          origen.transferenciaOut += monto; origen.saldo -= monto; origen.movimientos += 1;
          if (e.cajaDestino) {
            const destino = ensureCaja(e.cajaDestino);
            destino.transferenciaIn += monto; destino.saldo += monto; destino.movimientos += 1;
          }
        }
      }
      const cajas = [...cajasMap.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

      const fc = flujos.filter((f) => f.companyId === emp.id);
      const saldoFlujo = fc.reduce((a, f) => a + Number(f.monto || 0), 0);

      return {
        companyId: emp.id,
        companyName: emp.name,
        color: emp.color || null,
        cheques: {
          enCartera: chPend.length,
          montoEnCartera: sumMonto(chPend),
          aVencer15: chAVenc.length,
          montoAVencer15: sumMonto(chAVenc),
          vencidos: chVenc.length,
          montoVencidos: sumMonto(chVenc),
        },
        efectivo: { saldo: saldoEfectivo, movimientos: ef.length, cajas },
        flujoCaja: { saldoActual: saldoFlujo, movimientos: fc.length },
      };
    });

    const totales = porEmpresa.reduce((acc, e) => {
      acc.cheques.enCartera += e.cheques.enCartera;
      acc.cheques.montoEnCartera += e.cheques.montoEnCartera;
      acc.cheques.aVencer15 += e.cheques.aVencer15;
      acc.cheques.montoAVencer15 += e.cheques.montoAVencer15;
      acc.cheques.vencidos += e.cheques.vencidos;
      acc.cheques.montoVencidos += e.cheques.montoVencidos;
      acc.efectivo.saldo += e.efectivo.saldo;
      acc.efectivo.movimientos += e.efectivo.movimientos;
      acc.flujoCaja.saldoActual += e.flujoCaja.saldoActual;
      acc.flujoCaja.movimientos += e.flujoCaja.movimientos;
      return acc;
    }, emptyTotales());

    res.json({ ok: true, data: { porEmpresa, totales } });
  } catch (e) { next(e); }
});

function emptyTotales() {
  return {
    cheques: { enCartera: 0, montoEnCartera: 0, aVencer15: 0, montoAVencer15: 0, vencidos: 0, montoVencidos: 0 },
    efectivo: { saldo: 0, movimientos: 0 },
    flujoCaja: { saldoActual: 0, movimientos: 0 },
  };
}

// === Stock consolidado multi-empresa por depósito ===
// Devuelve filas planas [{ companyId, companyName, productoId, productoNombre, productoCategoria,
// unidad, depositoId, depositoNombre, depositoCompartido, existencia }]
// El frontend filtra/agrupa según lo que el usuario seleccione.
app.get('/api/resumen-multiempresa/stock', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ ok: false, error: 'No autenticado' });
    if (!req.user.superAdmin && !hasPermission(req.membership?.role?.permissions || [], 'reportes:read')) {
      return res.status(403).json({ ok: false, error: 'Permiso denegado', required: 'reportes:read' });
    }
    // Empresas accesibles (igual que el resumen general)
    let empresas;
    if (req.user.superAdmin) {
      empresas = await prisma.company.findMany({ where: { activo: true }, select: { id: true, name: true, color: true } });
    } else {
      empresas = (req.user.userCompanies || []).map((uc) => ({
        id: uc.companyId, name: uc.company.name, color: uc.company.color,
      }));
    }
    if (!empresas.length) return res.json({ ok: true, data: { filas: [], empresas: [], depositos: [], productos: [] } });
    const companyIds = empresas.map((e) => e.id);

    // Productos: cada empresa tiene los suyos. Los traemos todos.
    const productos = await prisma.producto.findMany({
      where: { companyId: { in: companyIds }, activo: true },
      select: { id: true, companyId: true, nombre: true, categoria: true, unidad: true },
      orderBy: { nombre: 'asc' },
    });
    // Depósitos: los de cada empresa + los compartidos (companyId null).
    const depositos = await prisma.deposito.findMany({
      where: { OR: [{ companyId: { in: companyIds } }, { companyId: null, compartido: true }] },
      select: { id: true, companyId: true, nombre: true, tipo: true, compartido: true },
      orderBy: { nombre: 'asc' },
    });
    // Movimientos agregados por (productoId, tipo, depositoId, companyId)
    const movs = await prisma.movimiento.groupBy({
      by: ['productoId', 'tipo', 'depositoId', 'companyId'],
      where: { companyId: { in: companyIds } },
      _sum: { cantidad: true },
    });

    const empMap = new Map(empresas.map(e => [e.id, e]));
    const depMap = new Map(depositos.map(d => [d.id, d]));
    const filas = [];
    // Una fila por cada combinación producto × depósito (incluyendo "sin depósito") con existencia distinta de 0.
    for (const p of productos) {
      const emp = empMap.get(p.companyId);
      // Por cada depósito accesible (propio de la empresa o compartido)
      const depsAccesibles = depositos.filter(d => d.companyId === p.companyId || (d.companyId === null && d.compartido));
      for (const d of depsAccesibles) {
        const ing = movs.find(m => m.productoId === p.id && m.tipo === 'ingreso' && m.depositoId === d.id && m.companyId === p.companyId)?._sum?.cantidad || 0;
        const egr = movs.find(m => m.productoId === p.id && m.tipo === 'egreso' && m.depositoId === d.id && m.companyId === p.companyId)?._sum?.cantidad || 0;
        const existencia = Number(ing) - Number(egr);
        if (existencia !== 0 || ing > 0 || egr > 0) {
          filas.push({
            companyId: p.companyId, companyName: emp?.name || '?', companyColor: emp?.color || null,
            productoId: p.id, productoNombre: p.nombre, productoCategoria: p.categoria, unidad: p.unidad,
            depositoId: d.id, depositoNombre: d.nombre, depositoTipo: d.tipo, depositoCompartido: !!d.compartido,
            existencia,
          });
        }
      }
      // Movimientos del producto sin depósito asignado (depositoId null)
      const ingS = movs.find(m => m.productoId === p.id && m.tipo === 'ingreso' && m.depositoId === null && m.companyId === p.companyId)?._sum?.cantidad || 0;
      const egrS = movs.find(m => m.productoId === p.id && m.tipo === 'egreso' && m.depositoId === null && m.companyId === p.companyId)?._sum?.cantidad || 0;
      const existS = Number(ingS) - Number(egrS);
      if (existS !== 0) {
        filas.push({
          companyId: p.companyId, companyName: emp?.name || '?', companyColor: emp?.color || null,
          productoId: p.id, productoNombre: p.nombre, productoCategoria: p.categoria, unidad: p.unidad,
          depositoId: null, depositoNombre: '(sin depósito)', depositoTipo: null, depositoCompartido: false,
          existencia: existS,
        });
      }
    }
    res.json({
      ok: true,
      data: {
        filas,
        empresas: empresas.map(e => ({ id: e.id, name: e.name, color: e.color })),
        depositos: depositos.map(d => ({ id: d.id, nombre: d.nombre, tipo: d.tipo, compartido: d.compartido, companyId: d.companyId })),
        productos: [...new Set(productos.map(p => p.nombre))].sort(),
      },
    });
  } catch (e) { next(e); }
});

// ---------- LOGISTICA / RRHH / CATALOGOS ----------
// ---------- VIAJES (custom: con estado, factura vinculada y auto-settlement) ----------
const viajeSchema = z.object({
  fecha: z.coerce.date(),
  origen: z.string().nullable().optional(),
  destino: z.string().nullable().optional(),
  producto: z.string().nullable().optional(),
  campanaId: z.string().nullable().optional(),    // campaña del grano (para rinde real)
  cantidad: z.number().nullable().optional(),     // kg carga
  kgDescarga: z.number().nullable().optional(),
  unidad: z.string().nullable().optional(),
  transportista: z.string().nullable().optional(),
  transporteCuit: z.string().nullable().optional(),
  chofer: z.string().nullable().optional(),
  choferCuit: z.string().nullable().optional(),
  patente: z.string().nullable().optional(),
  patenteAcoplado: z.string().nullable().optional(),
  tipoCamion: z.string().nullable().optional(),
  cartaPorte: z.string().nullable().optional(),
  ctg: z.string().nullable().optional(),
  cdp: z.string().nullable().optional(),           // legacy, ya no se usa en UI
  pagadorFlete: z.string().nullable().optional(),  // quien paga el flete
  km: z.number().nullable().optional(),
  tarifa: z.number().nullable().optional(),
  combustible: z.number().nullable().optional(),
  peajes: z.number().nullable().optional(),
  comida: z.number().nullable().optional(),
  varios: z.number().nullable().optional(),
  total: z.number().nullable().optional(),
  flete: z.number().nullable().optional(),
  estado: z.enum(['pendiente','cargado','descargado','facturado','pagado','anulada']).optional(),
  facturaCompraId: z.string().nullable().optional(),
  observaciones: z.string().nullable().optional(),
  // Destino del cereal (registrar a dónde va para luego cargar la liquidación)
  destinoTipo: z.enum(['cerealera','venta_directa','otro']).nullable().optional(),
  depositoOrigenId: z.string().nullable().optional(),   // silo/silobolsa de origen (excluye campaña)
  origenDepositos: z.array(z.object({ depositoId: z.string(), kg: z.coerce.number() })).nullable().optional(), // carga desde varios depósitos
  depositoDestinoId: z.string().nullable().optional(),
  liquidacionCerealId: z.string().nullable().optional(),
  contratoCerealId: z.string().nullable().optional(),   // contrato/confirmación al que se imputa la CP

      kgTara:      z.coerce.number().nullable().optional(),
      kgBruto:     z.coerce.number().nullable().optional(),
      kgNeto:      z.coerce.number().nullable().optional(),
      kgTaraDest:  z.coerce.number().nullable().optional(),
      kgBrutoDest: z.coerce.number().nullable().optional(),
      kgNetoDest:  z.coerce.number().nullable().optional(),
    
      transportistaId: z.string().nullable().optional(),
      choferId:        z.string().nullable().optional(),
      camionId:        z.string().nullable().optional(),
      acopladoId:      z.string().nullable().optional(),
      cpeNroCtg:           z.string().nullable().optional(),
      cpeNroComprobante:   z.string().nullable().optional(),
      cpeEstado:           z.string().nullable().optional(),
      cpeTipo:             z.string().nullable().optional(),
      cpeFechaEmision:     z.coerce.date().nullable().optional(),
      cpeFechaArribo:      z.coerce.date().nullable().optional(),
      cpeObservaciones:    z.string().nullable().optional(),
      cpeOrigenCuit:       z.string().nullable().optional(),
      cpeOrigenRenspa:     z.string().nullable().optional(),
      cpeDestinoCuit:      z.string().nullable().optional(),
      cpeDestinatarioCuit: z.string().nullable().optional(),
      cpeCorredorCuit:     z.string().nullable().optional(),
      cpeIntermediarioCuit:z.string().nullable().optional(),
    });

// Deriva el estado del viaje a partir de sus datos. "pagado" es sticky (manual o
// vía auto-settle); el resto se calcula desde el form salvo que el usuario lo
// fuerce explícitamente.
function deriveEstadoViaje(d, prev) {
  if (prev && prev.estado === 'anulada') return 'anulada';   // una CP anulada no se re-activa al editar
  if (prev && prev.estado === 'pagado') return 'pagado';
  if (d.facturaCompraId)                return 'facturado';
  if (Number(d.kgDescarga || 0) > 0)    return 'descargado';
  if (Number(d.cantidad || 0) > 0)      return 'cargado';
  return 'pendiente';
}

// ============================================================
// ALTA AUTOMÁTICA de catálogos de logística al guardar un viaje.
// Si el transportista / chofer / camión / acoplado escritos en el viaje no
// existen todavía en su catálogo, se crean solos y se devuelven sus IDs para
// vincularlos al viaje. Además, cada transportista se da de alta también como
// PROVEEDOR (rubro Transporte) para poder cargarle luego una factura de flete.
// Es idempotente: si ya existen, sólo completa datos faltantes (CUIT).
// Devuelve SOLO las claves que resolvió (no pisa vínculos con null).
// ============================================================
async function _asegurarProveedorTransportista(companyId, tr, counts) {
  const nombre = (tr.nombre || '').trim();
  if (!nombre) return null;
  const cuit = (tr.cuit || '').replace(/[-.\s]/g, '');
  let prov = null;
  if (cuit) {
    const provs = await prisma.proveedor.findMany({ where: { companyId }, select: { id: true, cuit: true, razonSocial: true } });
    prov = provs.find(p => (p.cuit || '').replace(/[-.\s]/g, '') === cuit) || null;
  }
  if (!prov) prov = await prisma.proveedor.findFirst({ where: { companyId, razonSocial: { equals: nombre, mode: 'insensitive' } } });
  if (!prov) {
    prov = await prisma.proveedor.create({ data: {
      companyId, razonSocial: nombre, cuit: tr.cuit || null,
      telefono: tr.telefono || null, email: tr.email || null, direccion: tr.direccion || null,
      rubro: 'Transporte', observaciones: 'Alta automática desde transportista (flete)',
    }});
    if (counts) counts.proveedores++;
  }
  return prov;
}

async function _autoAltaLogisticaViaje(companyId, d, counts) {
  const out = {};
  const norm = (s) => (s == null ? '' : String(s)).trim();
  const up   = (s) => norm(s).toUpperCase();

  // --- Transportista (dedup por CUIT primero, después por nombre) ---
  let transportistaId = d.transportistaId || null;
  const trNombre = norm(d.transportista);
  const trCuitNorm = norm(d.transporteCuit).replace(/[-.\s]/g, '');
  let trRow = null;
  if (!transportistaId && (trNombre || trCuitNorm)) {
    // 1) Buscar por CUIT (evita duplicar por diferencias de tipeo en el nombre).
    if (trCuitNorm) {
      const todos = await prisma.transportista.findMany({ where: { companyId }, select: { id: true, cuit: true } });
      const hit = todos.find(t => (t.cuit || '').replace(/[-.\s]/g, '') === trCuitNorm);
      if (hit) trRow = await prisma.transportista.findFirst({ where: { id: hit.id, companyId } });
    }
    // 2) Si no hay CUIT o no matcheó, buscar por nombre exacto (case-insensitive).
    if (!trRow && trNombre) trRow = await prisma.transportista.findFirst({ where: { companyId, nombre: { equals: trNombre, mode: 'insensitive' } } });
    // 3) Crear sólo si hay nombre.
    if (!trRow && trNombre) {
      trRow = await prisma.transportista.create({ data: { companyId, nombre: trNombre, cuit: norm(d.transporteCuit) || null } });
      if (counts) counts.transportistas++;
    } else if (trRow && norm(d.transporteCuit) && !trRow.cuit) {
      trRow = await prisma.transportista.update({ where: { id: trRow.id }, data: { cuit: norm(d.transporteCuit) } });
    }
    if (trRow) transportistaId = trRow.id;
  } else if (transportistaId) {
    trRow = await prisma.transportista.findFirst({ where: { id: transportistaId, companyId } });
  }
  if (transportistaId) out.transportistaId = transportistaId;
  // Proveedor espejo del transportista (para facturar el flete) — NO si es transporte propio.
  if (trRow && !trRow.propio) { try { await _asegurarProveedorTransportista(companyId, trRow, counts); } catch (_) {} }

  // --- Camión (por patente del chasis) ---
  let camionId = d.camionId || null;
  const pat = up(d.patente);
  if (!camionId && pat) {
    let cam = await prisma.camion.findFirst({ where: { companyId, patente: { equals: pat, mode: 'insensitive' } } });
    if (!cam) {
      cam = await prisma.camion.create({ data: {
        companyId, patente: pat,
        patenteAcoplado: up(d.patenteAcoplado) || null,
        tipo: norm(d.tipoCamion) || null,
        transportistaId: transportistaId || null,
      }});
      if (counts) counts.camiones++;
    }
    camionId = cam.id;
  }
  if (camionId) out.camionId = camionId;

  // --- Acoplado (por patente del acoplado) ---
  let acopladoId = d.acopladoId || null;
  const pata = up(d.patenteAcoplado);
  if (!acopladoId && pata) {
    let ac = await prisma.acoplado.findFirst({ where: { companyId, patente: { equals: pata, mode: 'insensitive' } } });
    if (!ac) {
      ac = await prisma.acoplado.create({ data: { companyId, patente: pata, transportistaId: transportistaId || null } });
      if (counts) counts.acoplados++;
    }
    acopladoId = ac.id;
  }
  if (acopladoId) out.acopladoId = acopladoId;

  // --- Chofer (por nombre) ---
  let choferId = d.choferId || null;
  const chNombre = norm(d.chofer);
  let chRow = null;
  if (!choferId && chNombre) {
    chRow = await prisma.chofer.findFirst({ where: { companyId, nombre: { equals: chNombre, mode: 'insensitive' } } });
    if (!chRow) {
      chRow = await prisma.chofer.create({ data: {
        companyId, nombre: chNombre, cuit: norm(d.choferCuit) || null,
        transportistaId: transportistaId || null, camionId: camionId || null, acopladoId: acopladoId || null,
      }});
      if (counts) counts.choferes++;
    } else if (norm(d.choferCuit) && !chRow.cuit) {
      chRow = await prisma.chofer.update({ where: { id: chRow.id }, data: { cuit: norm(d.choferCuit) } });
    }
    choferId = chRow.id;
  } else if (choferId) {
    chRow = await prisma.chofer.findFirst({ where: { id: choferId, companyId } });
  }
  // Vincular el chofer con un EMPLEADO marcado como "chofer" (por CUIT o nombre),
  // así la comisión configurada en la ficha del empleado se toma sola en el viaje.
  if (chRow && !chRow.empleadoId) {
    try {
      const emp = await _matchEmpleadoChofer(companyId, chRow.nombre, norm(d.choferCuit) || chRow.cuit);
      if (emp) chRow = await prisma.chofer.update({ where: { id: chRow.id }, data: { empleadoId: emp.id } });
    } catch (_) {}
  }
  if (choferId) out.choferId = choferId;

  return out;
}

// Busca un empleado (marcado esChofer) que corresponda al chofer del viaje, por
// CUIT/CUIL/DNI primero y por nombre (en cualquier orden) después.
async function _matchEmpleadoChofer(companyId, nombreChofer, cuitChofer) {
  const emps = await prisma.empleado.findMany({ where: { companyId, esChofer: true } });
  if (!emps.length) return null;
  const soloDig = (s) => (s || '').replace(/\D/g, '');
  const cuitNorm = soloDig(cuitChofer);
  // Si el chofer tiene CUIT, se vincula SOLO por CUIT (CUIL/DNI del empleado).
  // El nombre varía mucho entre cargas, así que no se usa como respaldo en ese caso.
  if (cuitNorm) {
    return emps.find(e => soloDig(e.cuil) === cuitNorm || soloDig(e.dni) === cuitNorm) || null;
  }
  // Sólo si el chofer no trae CUIT, intentamos por nombre (en cualquier orden).
  const norm = (s) => (s || '').toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
  const target = norm(nombreChofer);
  if (!target) return null;
  return emps.find(e => {
    const a = norm(`${e.nombre} ${e.apellido}`);
    const b = norm(`${e.apellido} ${e.nombre}`);
    return a === target || b === target;
  }) || null;
}

// ============================================================
// COMISIÓN del chofer-EMPLEADO por el viaje (camión propio).
// Si el chofer del viaje está vinculado a un empleado y tiene comisión
// configurada, genera/actualiza un MovimientoEmpleado (tipo ganancia,
// categoría "comision") en la ficha del empleado. Idempotente por viajeId:
// se recalcula al editar el viaje y se borra si el monto queda en 0.
// No toca la comisión si ya quedó incluida en una liquidación.
// ============================================================
async function _comisionChoferViaje(companyId, v) {
  try {
    if (!v || !v.id || !v.choferId) return;
    const ch = await prisma.chofer.findFirst({ where: { id: v.choferId, companyId } });
    const existing = await prisma.movimientoEmpleado.findFirst({ where: { companyId, viajeId: v.id, categoria: 'comision' } });
    // Resolver la config de comisión: primero la del CHOFER; si no está, la del EMPLEADO vinculado.
    const empId = ch?.empleadoId || null;
    const emp = empId ? await prisma.empleado.findFirst({ where: { id: empId, companyId } }) : null;
    let comTipo = ch?.comisionTipo || null;
    let comVal  = (ch?.comisionValor != null) ? Number(ch.comisionValor) : null;
    if ((!comTipo || !(comVal > 0)) && emp && emp.esChofer && emp.comisionViajeTipo && emp.comisionViajeValor) {
      comTipo = emp.comisionViajeTipo;
      comVal  = Number(emp.comisionViajeValor);
    }
    // Sin empleado o sin config válida → si había una comisión vieja (no liquidada), la limpiamos.
    if (!ch || !empId || !emp || !comTipo || !(comVal > 0)) {
      if (existing && !existing.liquidacionId) await prisma.movimientoEmpleado.delete({ where: { id: existing.id } });
      return;
    }
    const kg = Number(v.kgDescarga || v.cantidad || 0);
    const tn = kg / 1000;
    const fleteBase = Number(v.total || v.flete || (v.tarifa ? v.tarifa * kg / 1000 : 0)) || 0;
    const val = comVal;
    let monto = 0, cantidad = 1, unidad = 'viaje', valorUnitario = null, detalleCalc = '';
    if (comTipo === 'porcentaje')      { monto = fleteBase * val / 100; valorUnitario = null; detalleCalc = `${val}% de ${fleteBase.toFixed(2)}`; }
    else if (comTipo === 'monto_fijo') { monto = val; valorUnitario = val; detalleCalc = 'monto fijo por viaje'; }
    else if (comTipo === 'por_tn')     { monto = val * tn; cantidad = tn; unidad = 'tn'; valorUnitario = val; detalleCalc = `${val}/tn × ${tn.toFixed(2)} tn`; }
    monto = Math.round(monto * 100) / 100;
    if (!(monto > 0)) {
      if (existing && !existing.liquidacionId) await prisma.movimientoEmpleado.delete({ where: { id: existing.id } });
      return;
    }
    const fecha = v.fecha ? new Date(v.fecha) : new Date();
    const periodo = fecha.toISOString().slice(0, 7);
    const concepto = `Comisión flete ${(v.origen || '').trim()}→${(v.destino || '').trim()}`.trim();
    const data = {
      companyId, empleadoId: emp.id, fecha, periodo,
      tipo: 'ganancia', categoria: 'comision', concepto,
      cantidad, valorUnitario, unidad, monto, viajeId: v.id,
      observaciones: `Comisión automática del viaje · ${detalleCalc}`,
    };
    if (existing) {
      if (existing.liquidacionId) return; // ya liquidada, no se toca
      await prisma.movimientoEmpleado.update({ where: { id: existing.id }, data });
    } else {
      await prisma.movimientoEmpleado.create({ data });
    }
  } catch (_) { /* la comisión no debe romper el guardado del viaje */ }
}

app.get('/api/viajes', requireCompany, requirePermission('logistica:read'), async (req, res, next) => {
  try {
    const where = { companyId: req.companyId };
    const q = req.query.q?.toString().trim();
    if (q) {
      where.OR = ['origen','destino','transportista','patente','cartaPorte','ctg']
        .map(f => ({ [f]: { contains: q, mode: 'insensitive' } }));
    }
    const data = await prisma.viaje.findMany({
      where, orderBy: { fecha: 'desc' },
      include: { facturaCompra: { include: { proveedor: true } } },
    });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});

app.get('/api/viajes/:id', requireCompany, requirePermission('logistica:read'), async (req, res, next) => {
  try {
    const row = await prisma.viaje.findFirst({
      where: { id: req.params.id, companyId: req.companyId },
      include: { facturaCompra: { include: { proveedor: true } } },
    });
    if (!row) return res.status(404).json({ ok: false, error: 'No encontrado' });
    res.json({ ok: true, data: row });
  } catch (e) { next(e); }
});

// Resuelve (o crea) un Producto de granos por nombre, para los viajes.
async function _ensureProductoGrano(tx, companyId, nombre) {
  const n = (nombre || '').trim();
  if (!n) return null;
  const ex = await tx.producto.findFirst({ where: { companyId, nombre: { equals: n, mode: 'insensitive' } } });
  if (ex) return ex.id;
  const creado = await tx.producto.create({ data: {
    company: { connect: { id: companyId } }, nombre: n, unidad: 'kg', categoria: 'granos', activo: true,
  }});
  return creado.id;
}
// Sincroniza el ingreso de stock generado por un viaje que descarga en un depósito.
// Idempotente: borra el movimiento anterior del viaje (referencia VIAJE-<id>) y, si
// corresponde (tiene depósito destino, kg descargados > 0 y está descargado/facturado/
// pagado), crea un ingreso de los kg al depósito destino. Suma stock (el viaje ES la
// entrada del grano; aplica a cualquier depósito, incluidas cerealeras).
async function _sincronizarStockViaje(companyId, viaje) {
  const ref = `VIAJE-${viaje.id}`;
  const grano = (viaje.producto || '').trim();
  const estadoOk = ['cargado','descargado','facturado','pagado'].includes(viaje.estado || '');
  const kgEntrada = Number(viaje.kgDescarga || viaje.kgNetoDest || viaje.cantidad || 0);
  const kgSalida  = Number(viaje.cantidad || viaje.kgNeto || viaje.kgDescarga || 0);
  // Origen: un solo depósito (depositoOrigenId) o VARIOS (origenDepositos: [{depositoId,kg}]).
  const multiOrig = Array.isArray(viaje.origenDepositos) ? viaje.origenDepositos.filter(o => o && o.depositoId && Number(o.kg) > 0) : [];
  const origen = !!viaje.depositoOrigenId || multiOrig.length > 0;
  // EGRESO del silo/silobolsa de origen (el cereal sale de ese depósito acumulado).
  // La VENTA DIRECTA saca el stock vía la liquidación (no acá) para no duplicar.
  const debeEgreso = origen && kgSalida > 0 && estadoOk && !!grano && viaje.destinoTipo !== 'venta_directa';
  // INGRESO al depósito destino:
  //  - destino "otro" (depósito propio): siempre (cualquier origen) — comportamiento previo.
  //  - destino "cerealera": SÓLO si el cereal salió de un depósito (el viaje hace el movimiento
  //    completo). Para viajes de campaña, la cerealera se carga con el botón 📤 (entrega).
  const ingresoOtro       = viaje.destinoTipo === 'otro'      && !!viaje.depositoDestinoId && kgEntrada > 0 && estadoOk && !!grano;
  const ingresoCerealera  = origen && viaje.destinoTipo === 'cerealera' && !!viaje.depositoDestinoId && kgEntrada > 0 && estadoOk && !!grano;
  await prisma.$transaction(async (tx) => {
    await tx.movimiento.deleteMany({ where: { companyId, referencia: ref } });
    if (!debeEgreso && !ingresoOtro && !ingresoCerealera) return;
    const productoId = await _ensureProductoGrano(tx, companyId, grano);
    if (!productoId) return;
    if (debeEgreso) {
      if (multiOrig.length > 0) {
        // Egreso por cada depósito de origen con sus kg.
        for (const o of multiOrig) {
          await tx.movimiento.create({ data: {
            companyId, productoId, depositoId: o.depositoId,
            fecha: viaje.fecha || new Date(), tipo: 'egreso', motivo: 'viaje',
            cantidad: Number(o.kg), referencia: ref,
            observaciones: `Salida de ${grano} del depósito por viaje${viaje.destino ? ' → ' + viaje.destino : ''}`,
          }});
        }
      } else {
        await tx.movimiento.create({ data: {
          companyId, productoId, depositoId: viaje.depositoOrigenId,
          fecha: viaje.fecha || new Date(), tipo: 'egreso', motivo: 'viaje',
          cantidad: kgSalida, referencia: ref,
          observaciones: `Salida de ${grano} del depósito por viaje${viaje.destino ? ' → ' + viaje.destino : ''}`,
        }});
      }
    }
    if (ingresoOtro || ingresoCerealera) {
      await tx.movimiento.create({ data: {
        companyId, productoId, depositoId: viaje.depositoDestinoId,
        fecha: viaje.fecha || new Date(), tipo: 'ingreso', motivo: 'viaje',
        cantidad: kgEntrada, referencia: ref,
        observaciones: `Ingreso de ${grano} por viaje${viaje.origen ? ' ' + viaje.origen : ''}${viaje.destino ? ' → ' + viaje.destino : ''}`,
      }});
    }
  });
}

// Valida que, si el viaje sale de varios depósitos, la suma de kg cuadre con los kg del viaje.
function _chkOrigenDepositos(v) {
  const arr = Array.isArray(v.origenDepositos) ? v.origenDepositos.filter(o => o && o.depositoId) : [];
  if (!arr.length) return null;
  if (arr.some(o => !(Number(o.kg) > 0))) return 'Cada depósito de origen debe tener kg mayores a 0.';
  const total = Number(v.cantidad || v.kgNeto || 0);
  const suma = arr.reduce((a, o) => a + Number(o.kg || 0), 0);
  if (total > 0 && Math.abs(suma - total) > 1) return `La suma de kg por depósito (${Math.round(suma).toLocaleString('es-AR')}) debe ser igual a los kg del viaje (${Math.round(total).toLocaleString('es-AR')}).`;
  return null;
}

app.post('/api/viajes', requireCompany, requirePermission('logistica:create'), async (req, res, next) => {
  try {
    const d = viajeSchema.parse(req.body);
    { const eD = _chkOrigenDepositos(d); if (eD) return res.status(400).json({ ok: false, error: eD }); }
    if (d.facturaCompraId) {
      const f = await prisma.facturaCompra.findFirst({ where: { id: d.facturaCompraId, companyId: req.companyId } });
      if (!f) return res.status(400).json({ ok: false, error: 'Factura de compra no válida' });
    }
    const estado = deriveEstadoViaje(d, null);
    // Alta automática de transportista/chofer/camión/acoplado (+ proveedor) y vínculo por ID.
    let autoIds = {};
    try { autoIds = await _autoAltaLogisticaViaje(req.companyId, d); } catch (_) {}
    const row = await prisma.viaje.create({
      data: { ...d, ...autoIds, companyId: req.companyId, estado },
      include: { facturaCompra: { include: { proveedor: true } } },
    });
    await _sincronizarStockViaje(req.companyId, row);
    await _comisionChoferViaje(req.companyId, row);
    res.status(201).json({ ok: true, data: row });
  } catch (e) { next(e); }
});

app.put('/api/viajes/:id', requireCompany, requirePermission('logistica:update'), async (req, res, next) => {
  try {
    const existing = await prisma.viaje.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    const d = viajeSchema.partial().parse(req.body);
    if (d.facturaCompraId) {
      const f = await prisma.facturaCompra.findFirst({ where: { id: d.facturaCompraId, companyId: req.companyId } });
      if (!f) return res.status(400).json({ ok: false, error: 'Factura de compra no válida' });
    }
    const merged = { ...existing, ...d };
    { const eD = _chkOrigenDepositos(merged); if (eD) return res.status(400).json({ ok: false, error: eD }); }
    const estado = d.estado ?? deriveEstadoViaje(merged, existing);
    // Alta automática de catálogos + vínculo por ID (usa los datos combinados).
    let autoIds = {};
    try { autoIds = await _autoAltaLogisticaViaje(req.companyId, merged); } catch (_) {}
    const row = await prisma.viaje.update({
      where: { id: req.params.id },
      data: { ...d, ...autoIds, estado },
      include: { facturaCompra: { include: { proveedor: true } } },
    });
    await _sincronizarStockViaje(req.companyId, row);
    await _comisionChoferViaje(req.companyId, row);
    res.json({ ok: true, data: row });
  } catch (e) { next(e); }
});

app.delete('/api/viajes/:id', requireCompany, requirePermission('logistica:delete'), async (req, res, next) => {
  try {
    const existing = await prisma.viaje.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    if (existing.facturaCompraId || ['facturado','pagado'].includes(existing.estado)) return res.status(400).json({ ok: false, error: `No se puede eliminar: el viaje está ${existing.estado==='pagado'?'pagado':'facturado'} (vinculado a la factura del transportista). Deshacé el pago o desvinculá la factura primero.` });
    await prisma.movimiento.deleteMany({ where: { companyId: req.companyId, referencia: 'VIAJE-' + req.params.id } });
    await prisma.viaje.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Borrado masivo de viajes / cartas de porte de la empresa activa.
// Pensado para limpiar de una vez todo lo importado por Excel/CP y volver a
// cargar de cero. SIEMPRE acotado a la empresa del usuario (companyId).
// El frontend pide doble confirmación antes de llamar a este endpoint.
app.delete('/api/viajes', requireCompany, requirePermission('logistica:delete'), async (req, res, next) => {
  try {
    await prisma.movimiento.deleteMany({ where: { companyId: req.companyId, referencia: { startsWith: 'VIAJE-' } } });
    const r = await prisma.viaje.deleteMany({ where: { companyId: req.companyId } });
    res.json({ ok: true, deleted: r.count });
  } catch (e) { next(e); }
});

// Anular una carta de porte / viaje: NO se borra, queda con estado "anulada" y
// se revierten los movimientos que generó (egreso/ingreso de stock y la comisión
// de chofer). Se puede reactivar después. Si está pagado o facturado, primero
// hay que deshacer el pago/factura del transportista.
app.post('/api/viajes/:id/anular', requireCompany, requirePermission('logistica:update'), async (req, res, next) => {
  try {
    const existing = await prisma.viaje.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    if (existing.estado === 'anulada') return res.json({ ok: true, data: existing });
    if (existing.facturaCompraId || ['facturado','pagado'].includes(existing.estado)) {
      return res.status(400).json({ ok: false, error: `No se puede anular: el viaje está ${existing.estado==='pagado'?'pagado':'facturado'} (vinculado a la factura del transportista). Deshacé el pago o desvinculá la factura primero.` });
    }
    const row = await prisma.viaje.update({ where: { id: req.params.id }, data: { estado: 'anulada' } });
    // Revierte stock: con estado "anulada", _sincronizarStockViaje borra los movimientos VIAJE-*.
    await _sincronizarStockViaje(req.companyId, row);
    // Revierte la comisión de chofer generada por el viaje (si no quedó ya liquidada).
    await prisma.movimientoEmpleado.deleteMany({ where: { companyId: req.companyId, viajeId: row.id, categoria: 'comision', liquidacionId: null } });
    res.json({ ok: true, data: row });
  } catch (e) { next(e); }
});

// Reactivar una CP anulada: recalcula su estado según los datos y vuelve a
// generar los movimientos de stock y la comisión de chofer.
app.post('/api/viajes/:id/reactivar', requireCompany, requirePermission('logistica:update'), async (req, res, next) => {
  try {
    const existing = await prisma.viaje.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    if (existing.estado !== 'anulada') return res.json({ ok: true, data: existing });
    const estado = deriveEstadoViaje(existing, null);   // prev=null: recomputa limpio (no arrastra "anulada")
    const row = await prisma.viaje.update({ where: { id: req.params.id }, data: { estado } });
    await _sincronizarStockViaje(req.companyId, row);
    await _comisionChoferViaje(req.companyId, row);
    res.json({ ok: true, data: row });
  } catch (e) { next(e); }
});

// Cambio manual de estado (sobre todo para forzar "pagado" sin esperar al
// hook automático del cobro/pago).
app.post('/api/viajes/:id/estado', requireCompany, requirePermission('logistica:update'), async (req, res, next) => {
  try {
    const { estado } = z.object({ estado: z.enum(['pendiente','cargado','descargado','facturado','pagado','anulada']) }).parse(req.body);
    const existing = await prisma.viaje.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    const row = await prisma.viaje.update({ where: { id: req.params.id }, data: { estado } });
    await _sincronizarStockViaje(req.companyId, row);
    res.json({ ok: true, data: row });
  } catch (e) { next(e); }
});

// Auto-settle: dado un proveedorId, si su saldo en cuenta corriente quedó <=0
// (le pagamos todo o más), marca como "pagado" todos sus viajes que estén
// "facturado". El frontend lo llama después de registrar un cobro/pago.
app.post('/api/viajes/auto-settle', requireCompany, requirePermission('logistica:update'), async (req, res, next) => {
  try {
    const { proveedorId } = z.object({ proveedorId: z.string() }).parse(req.body);
    const movs = await prisma.ctaCte.findMany({
      where: { companyId: req.companyId, contactoTipo: 'proveedor', contactoId: proveedorId },
    });
    const saldo = movs.reduce((a, m) => a + Number(m.debe || 0) - Number(m.haber || 0), 0);
    if (saldo > 0) return res.json({ ok: true, updated: 0, saldo });
    // Saldo 0 o negativo -> marcamos pagados los viajes facturados de ese proveedor.
    const r = await prisma.viaje.updateMany({
      where: {
        companyId: req.companyId, estado: 'facturado',
        facturaCompra: { proveedorId },
      },
      data: { estado: 'pagado' },
    });
    res.json({ ok: true, updated: r.count, saldo });
  } catch (e) { next(e); }
});

mountCrud({
  path: 'empleados', modelName: 'empleado', perm: 'rrhh',
  schema: z.object({
    nombre: z.string().min(1),
    apellido: z.string().min(1),
    dni: z.string().nullable().optional(),
    cuil: z.string().nullable().optional(),
    puesto: z.string().nullable().optional(),
    fechaIngreso: z.coerce.date().nullable().optional(),
    fechaEgreso: z.coerce.date().nullable().optional(),
    sueldo: z.number().nullable().optional(),
    jornalDiario: z.coerce.number().nullable().optional(),   // precio por día
    telefono: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    direccion: z.string().nullable().optional(),
    observaciones: z.string().nullable().optional(),
    fotoUrl: z.string().nullable().optional(),
    activo: z.boolean().optional(),
    // Tipo de empleado + % por labor
    tipo: z.enum(['propio', 'externo']).optional(),
    cobraPorcentaje: z.boolean().optional(),
    porcentajeDefault: z.number().nullable().optional(),
    // Chofer de camión con comisión por viaje
    esChofer: z.boolean().optional(),
    comisionViajeTipo: z.enum(['porcentaje', 'monto_fijo', 'por_tn']).nullable().optional(),
    comisionViajeValor: z.coerce.number().nullable().optional(),
    localidad: z.string().nullable().optional(),
    provincia: z.string().nullable().optional(),
    // Seguro / ART
    aseguradora: z.string().nullable().optional(),
    aseguradoraTel: z.string().nullable().optional(),
    seguroActivo: z.boolean().optional(),
  }),
  orderBy: { apellido: 'asc' },
  searchFields: ['nombre', 'apellido', 'dni', 'cuil', 'puesto'],
});

// ---------- PLANILLA DEL EMPLEADO (movimientos + liquidación de sueldo) ----------
// Cada empleado tiene una planilla mensual de ingresos (horas, premios, sueldo
// base) y egresos (adelantos, compras personales, descuentos). A fin de mes se
// puede liquidar el sueldo: el neto sale del efectivo en caja, de un cheque
// propio o de una transferencia bancaria.

// "periodo" YYYY-MM derivado de la fecha (en UTC, porque el front manda fechas
// sin hora y se interpretan como medianoche UTC).
function periodoDe(fecha) {
  const d = new Date(fecha);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Verifica que el empleado exista y pertenezca a la empresa del request.
async function getEmpleadoScoped(req) {
  return prisma.empleado.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
}

const movEmpSchema = z.object({
  fecha: z.coerce.date(),
  tipo: z.enum(['ganancia', 'gasto']),
  categoria: z.string().nullable().optional(),
  concepto: z.string().min(1),
  horas: z.number().nullable().optional(),
  valorHora: z.number().nullable().optional(),
  cantidad: z.number().nullable().optional(),
  valorUnitario: z.number().nullable().optional(),
  unidad: z.string().nullable().optional(),
  monto: z.number(),
  observaciones: z.string().nullable().optional(),
});

// Listar movimientos de la planilla de un empleado.
app.get('/api/empleados/:id/movimientos', requireCompany, requirePermission('rrhh:read'), async (req, res, next) => {
  try {
    const emp = await getEmpleadoScoped(req);
    if (!emp) return res.status(404).json({ ok: false, error: 'Empleado no encontrado' });
    const data = await prisma.movimientoEmpleado.findMany({
      where: { empleadoId: emp.id, companyId: req.companyId },
      orderBy: { fecha: 'desc' },
    });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});

// Crear un movimiento (ganancia o gasto) en la planilla del empleado.
app.post('/api/empleados/:id/movimientos', requireCompany, requirePermission('rrhh:create'), async (req, res, next) => {
  try {
    const emp = await getEmpleadoScoped(req);
    if (!emp) return res.status(404).json({ ok: false, error: 'Empleado no encontrado' });
    const d = movEmpSchema.parse(req.body);
    const row = await prisma.movimientoEmpleado.create({
      data: {
        companyId: req.companyId,
        empleadoId: emp.id,
        fecha: d.fecha,
        periodo: periodoDe(d.fecha),
        tipo: d.tipo,
        categoria: d.categoria || null,
        concepto: d.concepto,
        horas: d.horas ?? null,
        valorHora: d.valorHora ?? null,
        cantidad: d.cantidad ?? null,
        valorUnitario: d.valorUnitario ?? null,
        unidad: d.unidad ?? null,
        monto: d.monto,
        observaciones: d.observaciones || null,
      },
    });
    res.status(201).json({ ok: true, data: row });
  } catch (e) { next(e); }
});

// Editar un movimiento de la planilla.
app.put('/api/empleados/:id/movimientos/:movId', requireCompany, requirePermission('rrhh:update'), async (req, res, next) => {
  try {
    const emp = await getEmpleadoScoped(req);
    if (!emp) return res.status(404).json({ ok: false, error: 'Empleado no encontrado' });
    const existing = await prisma.movimientoEmpleado.findFirst({
      where: { id: req.params.movId, empleadoId: emp.id, companyId: req.companyId },
    });
    if (!existing) return res.status(404).json({ ok: false, error: 'Movimiento no encontrado' });
    const d = movEmpSchema.partial().parse(req.body);
    const data = { ...d };
    if (d.categoria !== undefined) data.categoria = d.categoria || null;
    if (d.observaciones !== undefined) data.observaciones = d.observaciones || null;
    if (d.fecha !== undefined) data.periodo = periodoDe(d.fecha);
    const row = await prisma.movimientoEmpleado.update({ where: { id: req.params.movId }, data });
    res.json({ ok: true, data: row });
  } catch (e) { next(e); }
});

// Borrar un movimiento de la planilla.
app.delete('/api/empleados/:id/movimientos/:movId', requireCompany, requirePermission('rrhh:delete'), async (req, res, next) => {
  try {
    const emp = await getEmpleadoScoped(req);
    if (!emp) return res.status(404).json({ ok: false, error: 'Empleado no encontrado' });
    const existing = await prisma.movimientoEmpleado.findFirst({
      where: { id: req.params.movId, empleadoId: emp.id, companyId: req.companyId },
    });
    if (!existing) return res.status(404).json({ ok: false, error: 'Movimiento no encontrado' });
    await prisma.movimientoEmpleado.delete({ where: { id: req.params.movId } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- ENTREGA DE ROPA / INDUMENTARIA DE TRABAJO ----------
// Historial simple por empleado: cuándo se le entregó, qué prenda, talle,
// cuánta cantidad y una observación. No mueve stock, es un registro/control.
const entregaRopaSchema = z.object({
  fecha: z.coerce.date(),
  prenda: z.string().min(1),
  talle: z.string().nullable().optional(),
  cantidad: z.coerce.number().int().min(1).optional(),
  observaciones: z.string().nullable().optional(),
});

// Listar las entregas de ropa de un empleado (todas, más nuevas primero).
app.get('/api/empleados/:id/ropa', requireCompany, requirePermission('rrhh:read'), async (req, res, next) => {
  try {
    const emp = await getEmpleadoScoped(req);
    if (!emp) return res.status(404).json({ ok: false, error: 'Empleado no encontrado' });
    const data = await prisma.entregaRopa.findMany({
      where: { empleadoId: emp.id, companyId: req.companyId },
      orderBy: { fecha: 'desc' },
    });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});

// Registrar una entrega de ropa.
app.post('/api/empleados/:id/ropa', requireCompany, requirePermission('rrhh:create'), async (req, res, next) => {
  try {
    const emp = await getEmpleadoScoped(req);
    if (!emp) return res.status(404).json({ ok: false, error: 'Empleado no encontrado' });
    const d = entregaRopaSchema.parse(req.body);
    const row = await prisma.entregaRopa.create({
      data: {
        companyId: req.companyId,
        empleadoId: emp.id,
        fecha: d.fecha,
        prenda: d.prenda,
        talle: d.talle || null,
        cantidad: d.cantidad ?? 1,
        observaciones: d.observaciones || null,
      },
    });
    res.status(201).json({ ok: true, data: row });
  } catch (e) { next(e); }
});

// Editar una entrega de ropa.
app.put('/api/empleados/:id/ropa/:ropaId', requireCompany, requirePermission('rrhh:update'), async (req, res, next) => {
  try {
    const emp = await getEmpleadoScoped(req);
    if (!emp) return res.status(404).json({ ok: false, error: 'Empleado no encontrado' });
    const existing = await prisma.entregaRopa.findFirst({
      where: { id: req.params.ropaId, empleadoId: emp.id, companyId: req.companyId },
    });
    if (!existing) return res.status(404).json({ ok: false, error: 'Entrega no encontrada' });
    const d = entregaRopaSchema.partial().parse(req.body);
    const data = { ...d };
    if (d.talle !== undefined) data.talle = d.talle || null;
    if (d.observaciones !== undefined) data.observaciones = d.observaciones || null;
    const row = await prisma.entregaRopa.update({ where: { id: req.params.ropaId }, data });
    res.json({ ok: true, data: row });
  } catch (e) { next(e); }
});

// Borrar una entrega de ropa.
app.delete('/api/empleados/:id/ropa/:ropaId', requireCompany, requirePermission('rrhh:delete'), async (req, res, next) => {
  try {
    const emp = await getEmpleadoScoped(req);
    if (!emp) return res.status(404).json({ ok: false, error: 'Empleado no encontrado' });
    const existing = await prisma.entregaRopa.findFirst({
      where: { id: req.params.ropaId, empleadoId: emp.id, companyId: req.companyId },
    });
    if (!existing) return res.status(404).json({ ok: false, error: 'Entrega no encontrada' });
    await prisma.entregaRopa.delete({ where: { id: req.params.ropaId } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ============================================================
// CATEGORÍAS DE PLANILLA (configurables por empresa)
// modo "monto" = monto directo · modo "cant" = cantidad × valorUnitario.
// ============================================================
const CATEGORIAS_PLANILLA_DEFAULT = [
  { codigo:'horas',      nombre:'Horas trabajadas',        mov:'ganancia', modo:'cant',  unidad:'horas', orden:1, especial:true },
  { codigo:'dias',       nombre:'Días trabajados',         mov:'ganancia', modo:'cant',  unidad:'días',  orden:2, especial:true },
  { codigo:'sueldo',     nombre:'Sueldo',                  mov:'ganancia', modo:'monto', unidad:null, orden:3, especial:false },
  { codigo:'premio',     nombre:'Premio / bono',           mov:'ganancia', modo:'monto', unidad:null, orden:4, especial:false },
  { codigo:'otro_ing',   nombre:'Otro ingreso',            mov:'ganancia', modo:'monto', unidad:null, orden:5, especial:false },
  { codigo:'adelanto',   nombre:'Adelanto de dinero',      mov:'gasto',    modo:'monto', unidad:null, orden:1, especial:false },
  { codigo:'compra',     nombre:'Compra / cosa personal',  mov:'gasto',    modo:'monto', unidad:null, orden:2, especial:false },
  { codigo:'descuento',  nombre:'Descuento',               mov:'gasto',    modo:'monto', unidad:null, orden:3, especial:false },
  { codigo:'dia_no_trab',nombre:'Día no trabajado',        mov:'gasto',    modo:'cant',  unidad:'días', orden:4, especial:true },
  { codigo:'otro_gasto', nombre:'Otro gasto',              mov:'gasto',    modo:'monto', unidad:null, orden:5, especial:false },
];
async function seedCategoriasPlanilla(companyId) {
  const n = await prisma.categoriaPlanilla.count({ where: { companyId } });
  if (n === 0) {
    await prisma.categoriaPlanilla.createMany({
      data: CATEGORIAS_PLANILLA_DEFAULT.map(c => ({ ...c, companyId })),
      skipDuplicates: true,
    });
    return;
  }
  // Empresas que ya tenían categorías: aseguramos las categorías por DÍA (jornal),
  // que sirven para cobrar por días trabajados y descontar los días no trabajados.
  const porDia = CATEGORIAS_PLANILLA_DEFAULT.filter(c => c.unidad === 'días');
  for (const c of porDia) {
    const ex = await prisma.categoriaPlanilla.findFirst({ where: { companyId, codigo: c.codigo } });
    if (!ex) { try { await prisma.categoriaPlanilla.create({ data: { ...c, companyId } }); } catch {} }
  }
}
const _slugCat = (s) => String(s||'').toLowerCase()
  .replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,40) || 'cat';
const categoriaPlanillaSchema = z.object({
  nombre: z.string().min(1),
  mov: z.enum(['ganancia','gasto']),
  modo: z.enum(['monto','cant']).optional(),
  unidad: z.string().nullable().optional(),
  orden: z.coerce.number().int().optional(),
  activo: z.boolean().optional(),
});
app.get('/api/categorias-planilla', requireCompany, requirePermission('rrhh:read'), async (req, res, next) => {
  try {
    await seedCategoriasPlanilla(req.companyId);
    const data = await prisma.categoriaPlanilla.findMany({
      where: { companyId: req.companyId },
      orderBy: [{ mov: 'asc' }, { orden: 'asc' }, { nombre: 'asc' }],
    });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});
app.post('/api/categorias-planilla', requireCompany, requirePermission('rrhh:create'), async (req, res, next) => {
  try {
    const d = categoriaPlanillaSchema.parse(req.body);
    let codigo = _slugCat(d.nombre);
    const dup = await prisma.categoriaPlanilla.findFirst({ where: { companyId: req.companyId, codigo } });
    if (dup) codigo = codigo + '_' + Date.now().toString(36).slice(-4);
    const r = await prisma.categoriaPlanilla.create({
      data: {
        companyId: req.companyId, nombre: d.nombre, codigo, mov: d.mov,
        modo: d.modo || 'monto', unidad: d.modo === 'cant' ? (d.unidad || 'unidad') : null,
        orden: d.orden ?? 99, especial: false,
      },
    });
    res.status(201).json({ ok: true, data: r });
  } catch (e) { next(e); }
});
app.put('/api/categorias-planilla/:id', requireCompany, requirePermission('rrhh:update'), async (req, res, next) => {
  try {
    const existing = await prisma.categoriaPlanilla.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    const d = categoriaPlanillaSchema.partial().parse(req.body);
    const data = { ...d };
    if (d.modo === 'monto') data.unidad = null;
    const r = await prisma.categoriaPlanilla.update({ where: { id: req.params.id }, data });
    res.json({ ok: true, data: r });
  } catch (e) { next(e); }
});
app.delete('/api/categorias-planilla/:id', requireCompany, requirePermission('rrhh:delete'), async (req, res, next) => {
  try {
    const existing = await prisma.categoriaPlanilla.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    await prisma.categoriaPlanilla.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Listar las liquidaciones de sueldo de un empleado.
app.get('/api/empleados/:id/liquidaciones', requireCompany, requirePermission('rrhh:read'), async (req, res, next) => {
  try {
    const emp = await getEmpleadoScoped(req);
    if (!emp) return res.status(404).json({ ok: false, error: 'Empleado no encontrado' });
    const data = await prisma.liquidacionSueldo.findMany({
      where: { empleadoId: emp.id, companyId: req.companyId },
      orderBy: { periodo: 'desc' },
    });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});

const liqSchema = z.object({
  periodo: z.string().regex(/^\d{4}-\d{2}$/, 'Período inválido (YYYY-MM)'),
  fecha: z.coerce.date(),
  medioPago: z.enum(['efectivo', 'cheque', 'transferencia', 'tarjeta', 'intercompany']),
  caja: z.string().nullable().optional(),
  banco: z.string().nullable().optional(),
  nroCheque: z.string().nullable().optional(),
  referencia: z.string().nullable().optional(),
  incluirSueldoBase: z.boolean().optional(),
  observaciones: z.string().nullable().optional(),
  // Intercompany: otra firma del grupo pone los fondos del sueldo.
  empresaOrigenId: z.string().nullable().optional(),
  recursoIntercompany: z.enum(['efectivo', 'cheque', 'transferencia', 'deuda']).nullable().optional(),
  cajaOrigen: z.string().nullable().optional(),
  chequeIdOrigen: z.string().nullable().optional(),
  bancoCuentaIdOrigen: z.string().nullable().optional(),
});

// Liquidar el sueldo de un mes. Suma las ganancias (incluido el sueldo base del
// empleado) y resta los gastos del período; el neto se paga por efectivo
// (genera un egreso en Control de Efectivo), cheque (genera un cheque propio) o
// transferencia (sólo queda registrado). Los movimientos del mes quedan
// marcados con el id de la liquidación.
app.post('/api/empleados/:id/liquidaciones', requireCompany, requirePermission('rrhh:create'), async (req, res, next) => {
  try {
    const emp = await getEmpleadoScoped(req);
    if (!emp) return res.status(404).json({ ok: false, error: 'Empleado no encontrado' });
    const d = liqSchema.parse(req.body);

    const yaExiste = await prisma.liquidacionSueldo.findFirst({
      where: { empleadoId: emp.id, periodo: d.periodo },
    });
    if (yaExiste) {
      return res.status(409).json({ ok: false, error: 'Ya existe una liquidación para ese mes. Anulala primero si querés rehacerla.' });
    }

    if ((d.medioPago === 'efectivo' || d.medioPago === 'tarjeta') && !d.caja) {
      return res.status(400).json({ ok: false, error: d.medioPago === 'tarjeta' ? 'Elegí la tarjeta con la que se paga' : 'Elegí la caja de la que sale el pago en efectivo' });
    }
    if (d.medioPago === 'cheque' && !d.nroCheque) {
      return res.status(400).json({ ok: false, error: 'Ingresá el número de cheque' });
    }
    if (d.medioPago === 'intercompany') {
      if (!d.empresaOrigenId) return res.status(400).json({ ok: false, error: 'Elegí la firma del grupo que paga el sueldo' });
      if (d.empresaOrigenId === req.companyId) return res.status(400).json({ ok: false, error: 'La firma que paga no puede ser la misma' });
      if (!_userTieneAcceso(req, d.empresaOrigenId)) return res.status(403).json({ ok: false, error: 'No tenés acceso a la firma que paga' });
      const tienePerm = req.user.superAdmin || (req.user.userCompanies || []).some(uc =>
        uc.companyId === req.companyId &&
        ((uc.role?.permissions || []).includes('finanzas:intercompany') ||
         (uc.role?.permissions || []).includes('finanzas:*') ||
         (uc.role?.permissions || []).includes('*:*')));
      if (!tienePerm) return res.status(403).json({ ok: false, error: 'No tenés permiso finanzas:intercompany' });
    }

    const movs = await prisma.movimientoEmpleado.findMany({
      where: { empleadoId: emp.id, companyId: req.companyId, periodo: d.periodo },
    });
    const totalGastos = movs.filter(m => m.tipo === 'gasto').reduce((a, m) => a + Number(m.monto || 0), 0);
    const totalGananciasMov = movs.filter(m => m.tipo === 'ganancia').reduce((a, m) => a + Number(m.monto || 0), 0);
    // Sueldo base automático del mes, salvo que ya exista un movimiento de
    // categoría "sueldo" cargado a mano para ese período.
    const haySueldoMov = movs.some(m => m.categoria === 'sueldo');
    const sueldoBase = (d.incluirSueldoBase !== false && !haySueldoMov) ? Number(emp.sueldo || 0) : 0;
    const totalGanancias = totalGananciasMov + sueldoBase;
    const neto = totalGanancias - totalGastos;

    const nombreCompleto = `${emp.apellido}, ${emp.nombre}`;
    const liquidacion = await prisma.$transaction(async (tx) => {
      let efectivoId = null;
      let chequeId = null;
      let intercompanyRef = null;

      // Intercompany: otra firma del grupo paga el sueldo. Deja los asientos espejo
      // y mueve el recurso REAL de la firma que financia (misma lógica que el pago
      // a proveedor Intercompany).
      if (neto > 0 && d.medioPago === 'intercompany') {
        const interRef = `ic_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
        const concepto = `Sueldo ${nombreCompleto} · ${d.periodo}`;
        const obsIc = `Liquidación de sueldo ${d.periodo}${d.observaciones ? ' · ' + d.observaciones : ''} [ic:${interRef}]`;
        // Esta empresa (destino) queda debiendo a la otra: haber = neto.
        await tx.ctaCte.create({ data: {
          companyId: req.companyId, contactoTipo: 'intercompany',
          empresaContraparteId: d.empresaOrigenId, intercompanyRef: interRef,
          fecha: d.fecha, detalle: concepto + ' — pagado por otra firma del grupo',
          haber: neto, observaciones: obsIc,
        }});
        // La firma que paga queda con saldo a favor: debe = neto.
        await tx.ctaCte.create({ data: {
          companyId: d.empresaOrigenId, contactoTipo: 'intercompany',
          empresaContraparteId: req.companyId, intercompanyRef: interRef,
          fecha: d.fecha, detalle: 'Sueldo pagado para otra firma del grupo: ' + concepto,
          debe: neto, observaciones: obsIc,
        }});
        await tx.intercompanyMovimiento.create({ data: {
          fecha: d.fecha, empresaOrigenId: d.empresaOrigenId, empresaDestinoId: req.companyId,
          monto: neto, motivo: concepto, intercompanyRef: interRef,
          observaciones: obsIc, userId: req.user?.id || null,
        }});
        await _intercompanyMoverRecurso(tx, {
          empresaOrigenId: d.empresaOrigenId, recurso: d.recursoIntercompany || 'deuda',
          monto: neto, fecha: d.fecha, concepto, observaciones: obsIc, userId: req.user?.id || null,
          cajaOrigen: d.cajaOrigen, chequeIdOrigen: d.chequeIdOrigen, bancoCuentaIdOrigen: d.bancoCuentaIdOrigen,
        });
        intercompanyRef = interRef;
      }

      // Sólo generamos el pago en otros módulos si el neto es positivo.
      if (neto > 0 && (d.medioPago === 'efectivo' || d.medioPago === 'tarjeta')) {
        const ef = await tx.efectivo.create({
          data: {
            companyId: req.companyId,
            fecha: d.fecha,
            tipo: 'egreso',
            concepto: `Sueldo ${nombreCompleto} · ${d.periodo}`,
            monto: neto,
            caja: d.caja,
            clasificacion: 'empresa',
            observaciones: `Liquidación de sueldo ${d.periodo}` + (d.medioPago === 'tarjeta' ? ' · Tarjeta: ' + d.caja : ''),
          },
        });
        efectivoId = ef.id;
      } else if (neto > 0 && d.medioPago === 'cheque') {
        const ch = await tx.cheque.create({
          data: {
            companyId: req.companyId,
            tipo: 'propio',
            banco: d.banco || null,
            nroCheque: d.nroCheque,
            fechaEmision: d.fecha,
            fechaPago: d.fecha,
            monto: neto,
            beneficiario: nombreCompleto,
            estado: 'en_cartera',
            observaciones: `Liquidación de sueldo ${d.periodo}`,
          },
        });
        chequeId = ch.id;
      }

      const liq = await tx.liquidacionSueldo.create({
        data: {
          companyId: req.companyId,
          empleadoId: emp.id,
          periodo: d.periodo,
          fecha: d.fecha,
          sueldoBase,
          totalGanancias,
          totalGastos,
          neto,
          medioPago: d.medioPago,
          caja: (d.medioPago === 'efectivo' || d.medioPago === 'tarjeta') ? d.caja : null,
          banco: (d.medioPago !== 'efectivo' && d.medioPago !== 'tarjeta') ? (d.banco || null) : null,
          nroCheque: d.medioPago === 'cheque' ? d.nroCheque : null,
          referencia: d.referencia || null,
          efectivoId,
          chequeId,
          intercompanyRef,
          observaciones: d.observaciones || null,
        },
      });

      // Marcar los movimientos del mes como liquidados.
      await tx.movimientoEmpleado.updateMany({
        where: { empleadoId: emp.id, companyId: req.companyId, periodo: d.periodo },
        data: { liquidacionId: liq.id },
      });

      return liq;
    });

    res.status(201).json({ ok: true, data: liquidacion });
  } catch (e) { next(e); }
});

// Anular una liquidación: borra el pago generado (efectivo / cheque), desmarca
// los movimientos del mes y elimina la liquidación.
app.delete('/api/empleados/:id/liquidaciones/:liqId', requireCompany, requirePermission('rrhh:delete'), async (req, res, next) => {
  try {
    const emp = await getEmpleadoScoped(req);
    if (!emp) return res.status(404).json({ ok: false, error: 'Empleado no encontrado' });
    const liq = await prisma.liquidacionSueldo.findFirst({
      where: { id: req.params.liqId, empleadoId: emp.id, companyId: req.companyId },
    });
    if (!liq) return res.status(404).json({ ok: false, error: 'Liquidación no encontrada' });

    await prisma.$transaction(async (tx) => {
      if (liq.efectivoId) {
        await tx.efectivo.deleteMany({ where: { id: liq.efectivoId, companyId: req.companyId } });
      }
      if (liq.chequeId) {
        await tx.cheque.deleteMany({ where: { id: liq.chequeId, companyId: req.companyId } });
      }
      // Reversa del pago Intercompany: se identifica por la referencia guardada.
      if (liq.intercompanyRef) {
        const ref = liq.intercompanyRef;
        const tag = `[ic:${ref}]`;
        // Deshacer los dos asientos espejo y el movimiento intercompany.
        const im = await tx.intercompanyMovimiento.findFirst({ where: { intercompanyRef: ref } });
        const empresaOrigenId = im?.empresaOrigenId || null;
        await tx.ctaCte.deleteMany({ where: { intercompanyRef: ref } });
        await tx.intercompanyMovimiento.deleteMany({ where: { intercompanyRef: ref } });
        // Deshacer el recurso movido por la firma que pagó (se etiquetó con [ic:ref]).
        if (empresaOrigenId) {
          await tx.efectivo.deleteMany({ where: { companyId: empresaOrigenId, observaciones: { contains: tag } } });
          await tx.bancoMovimiento.deleteMany({ where: { companyId: empresaOrigenId, observaciones: { contains: tag } } });
          // Si se entregó/endosó un cheque de la otra firma, lo devolvemos a cartera.
          await tx.cheque.updateMany({
            where: { companyId: empresaOrigenId, observaciones: { contains: tag } },
            data: { estado: 'en_cartera', fechaEndoso: null, enPoderDe: null },
          });
        }
      }
      await tx.movimientoEmpleado.updateMany({
        where: { liquidacionId: liq.id },
        data: { liquidacionId: null },
      });
      await tx.liquidacionSueldo.delete({ where: { id: liq.id } });
    });

    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- HACIENDA ----------
// Stock real (computado por sumatoria de movimientos) y declarado (SENASA/ARCA)
// por campo y categoría. Se mantiene en tablas aparte de Producto/Movimiento
// porque el flujo es distinto: nacimientos, muertes, traslados entre campos.

// Validador del cuerpo de un stock declarado.
const hacStockSchema = z.object({
  campoId: z.string(),
  categoria: z.string().min(1),
  declarado: z.number().int().nonnegative().optional(),
  pesoPromedio: z.number().nonnegative().nullable().optional(),
  observaciones: z.string().nullable().optional(),
});

async function _verifyCampo(req, campoId) {
  if (!campoId) return null;
  return prisma.campo.findFirst({ where: { id: campoId, companyId: req.companyId } });
}

// Listar todos los stocks declarados de la empresa (con su campo).
app.get('/api/hacienda-stock', requireCompany, requirePermission('stock:read'), async (req, res, next) => {
  try {
    const where = { companyId: req.companyId };
    if (req.query.campoId) where.campoId = String(req.query.campoId);
    const data = await prisma.haciendaStock.findMany({
      where, orderBy: [{ campoId: 'asc' }, { categoria: 'asc' }],
      include: { campo: { select: { id: true, nombre: true } } },
    });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});

// Crear o actualizar el declarado de una (campo, categoría). Idempotente:
// si ya existe lo actualiza.
app.post('/api/hacienda-stock', requireCompany, requirePermission('stock:create'), async (req, res, next) => {
  try {
    const d = hacStockSchema.parse(req.body);
    const campo = await _verifyCampo(req, d.campoId);
    if (!campo) return res.status(400).json({ ok: false, error: 'Campo no válido' });
    const row = await prisma.haciendaStock.upsert({
      where: { companyId_campoId_categoria: { companyId: req.companyId, campoId: d.campoId, categoria: d.categoria } },
      create: {
        companyId: req.companyId, campoId: d.campoId, categoria: d.categoria,
        declarado: d.declarado || 0, pesoPromedio: d.pesoPromedio ?? null,
        observaciones: d.observaciones || null,
      },
      update: {
        declarado: d.declarado ?? 0,
        pesoPromedio: d.pesoPromedio !== undefined ? d.pesoPromedio : undefined,
        observaciones: d.observaciones ?? null,
      },
    });
    res.status(201).json({ ok: true, data: row });
  } catch (e) { next(e); }
});

app.put('/api/hacienda-stock/:id', requireCompany, requirePermission('stock:update'), async (req, res, next) => {
  try {
    const existing = await prisma.haciendaStock.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    const d = hacStockSchema.partial().parse(req.body);
    const data = {};
    if (d.declarado !== undefined) data.declarado = d.declarado;
    if (d.pesoPromedio !== undefined) data.pesoPromedio = d.pesoPromedio;
    if (d.observaciones !== undefined) data.observaciones = d.observaciones || null;
    const row = await prisma.haciendaStock.update({ where: { id: req.params.id }, data });
    res.json({ ok: true, data: row });
  } catch (e) { next(e); }
});

app.delete('/api/hacienda-stock/:id', requireCompany, requirePermission('stock:delete'), async (req, res, next) => {
  try {
    const existing = await prisma.haciendaStock.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    await prisma.haciendaStock.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Tipos de movimiento permitidos. El "signo" decide si suma o resta al real.
const HAC_TIPOS = ['nacimiento','muerte','compra','venta','traslado','ajuste','cambio_categoria'];
const hacMovSchema = z.object({
  campoId: z.string(),
  categoria: z.string().min(1),
  categoriaDestino: z.string().nullable().optional(),  // requerido si tipo='cambio_categoria'
  fecha: z.coerce.date(),
  tipo: z.enum(HAC_TIPOS),
  cantidad: z.number().int(),  // CABEZAS. permite negativo para ajuste; resto positivos
  kilos: z.number().nonnegative().nullable().optional(),  // kg del movimiento (balanza)
  campoDestino: z.string().nullable().optional(),  // requerido si tipo='traslado'
  // --- Venta de hacienda (tipo='venta') ---
  precioKg: z.number().nonnegative().nullable().optional(),
  total: z.number().nonnegative().nullable().optional(),
  clienteId: z.string().nullable().optional(),
  modoVenta: z.enum(['directo','rendimiento']).nullable().optional(),
  cobroTipo: z.enum(['ctacte','efectivo','banco','ninguno']).nullable().optional(),
  caja: z.string().nullable().optional(),
  bancoCuentaId: z.string().nullable().optional(),
  facturaRef: z.string().nullable().optional(),  // vincular a una factura ya cargada
  observaciones: z.string().nullable().optional(),
});
// Registra el ingreso de una venta de hacienda segun el medio de cobro.
async function _ingresoVentaHacienda(tx, req, d, movId, total) {
  const out = { efectivoId: null, bancoMovId: null };
  if (!total || total <= 0) return out;
  const detalle = `Venta hacienda: ${d.cantidad} cab. ${d.categoria}${d.kilos?` · ${d.kilos} kg`:''}`;
  if (d.cobroTipo === 'ctacte') {
    if (!d.clienteId) throw new Error('Elegí el cliente para la venta en cuenta corriente');
    await tx.ctaCte.create({ data: {
      companyId: req.companyId, contactoTipo: 'cliente', contactoId: d.clienteId,
      fecha: d.fecha, detalle, debe: total, haber: 0, referencia: `hacventa-${movId}`,
    }});
  } else if (d.cobroTipo === 'efectivo') {
    const ef = await tx.efectivo.create({ data: {
      companyId: req.companyId, fecha: d.fecha, tipo: 'ingreso', concepto: detalle,
      monto: total, caja: d.caja || null, clasificacion: 'empresa',
    }});
    out.efectivoId = ef.id;
  } else if (d.cobroTipo === 'banco') {
    if (!d.bancoCuentaId) throw new Error('Elegí la cuenta bancaria de la venta');
    const bm = await tx.bancoMovimiento.create({ data: {
      companyId: req.companyId, cuentaId: d.bancoCuentaId, fecha: d.fecha,
      tipo: 'transferencia_in', concepto: detalle, monto: total, userId: req.user?.id || null,
    }});
    out.bancoMovId = bm.id;
  }
  return out;
}

// Lista de movimientos de animales (puede filtrar por campo y/o categoría).
app.get('/api/hacienda-movimientos', requireCompany, requirePermission('stock:read'), async (req, res, next) => {
  try {
    const where = { companyId: req.companyId };
    if (req.query.campoId) where.campoId = String(req.query.campoId);
    if (req.query.categoria) where.categoria = String(req.query.categoria);
    const data = await prisma.haciendaMovimiento.findMany({
      where, orderBy: { fecha: 'desc' },
      include: { campo: { select: { id: true, nombre: true } } },
    });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});

// Crear un movimiento. Si es traslado, crea dos movimientos en una transacción
// (uno saliendo del campo origen, otro entrando al campo destino).
app.post('/api/hacienda-movimientos', requireCompany, requirePermission('stock:create'), async (req, res, next) => {
  try {
    const d = hacMovSchema.parse(req.body);
    const campo = await _verifyCampo(req, d.campoId);
    if (!campo) return res.status(400).json({ ok: false, error: 'Campo no válido' });

    if (d.tipo === 'traslado') {
      if (!d.campoDestino) return res.status(400).json({ ok: false, error: 'Falta el campo destino del traslado' });
      if (d.campoDestino === d.campoId) return res.status(400).json({ ok: false, error: 'El campo origen y destino deben ser distintos' });
      const destino = await _verifyCampo(req, d.campoDestino);
      if (!destino) return res.status(400).json({ ok: false, error: 'Campo destino no válido' });
      if (d.cantidad <= 0) return res.status(400).json({ ok: false, error: 'La cantidad del traslado debe ser positiva' });

      const result = await prisma.$transaction(async (tx) => {
        const out = await tx.haciendaMovimiento.create({
          data: {
            companyId: req.companyId, campoId: d.campoId, categoria: d.categoria,
            fecha: d.fecha, tipo: 'traslado_out', cantidad: d.cantidad,
            campoOrigen: d.campoId, campoDestino: d.campoDestino,
            observaciones: d.observaciones || null,
          },
        });
        const inn = await tx.haciendaMovimiento.create({
          data: {
            companyId: req.companyId, campoId: d.campoDestino, categoria: d.categoria,
            fecha: d.fecha, tipo: 'traslado_in', cantidad: d.cantidad,
            campoOrigen: d.campoId, campoDestino: d.campoDestino,
            observaciones: d.observaciones || null,
          },
        });
        return [out, inn];
      });
      return res.status(201).json({ ok: true, data: result });
    }

    // Venta de hacienda: descuenta cabezas y registra el ingreso (cta cte / efectivo / banco).
    // Si es "a rendimiento", descuenta el stock ahora y el ingreso queda pendiente
    // hasta confirmar los kg/importe definitivos.
    if (d.tipo === 'venta') {
      if (d.cantidad <= 0) return res.status(400).json({ ok: false, error: 'La cantidad debe ser positiva' });
      const total = (d.total != null ? d.total : ((d.kilos || 0) * (d.precioKg || 0))) || 0;
      const esRend = d.modoVenta === 'rendimiento';
      const result = await prisma.$transaction(async (tx) => {
        const mov = await tx.haciendaMovimiento.create({ data: {
          companyId: req.companyId, campoId: d.campoId, categoria: d.categoria,
          fecha: d.fecha, tipo: 'venta', cantidad: d.cantidad, kilos: d.kilos ?? null,
          precioKg: d.precioKg ?? null, total: total || null, clienteId: d.clienteId || null,
          modoVenta: esRend ? 'rendimiento' : 'directo',
          estadoRend: esRend ? 'pendiente' : 'cerrada',
          cobroTipo: esRend ? null : (d.facturaRef ? 'ninguno' : (d.cobroTipo || 'ninguno')),
          facturaRef: d.facturaRef || null,
          observaciones: d.observaciones || null,
        }});
        if (!esRend && !d.facturaRef && d.cobroTipo && d.cobroTipo !== 'ninguno') {
          const links = await _ingresoVentaHacienda(tx, req, d, mov.id, total);
          if (links.efectivoId || links.bancoMovId) {
            await tx.haciendaMovimiento.update({ where: { id: mov.id }, data: { efectivoId: links.efectivoId, bancoMovId: links.bancoMovId } });
          }
        }
        return mov;
      });
      return res.status(201).json({ ok: true, data: result });
    }

    // Cambio de categoría (reclasificación): baja en origen, alta en destino,
    // dentro del MISMO campo. Validado contra la matriz de transición.
    if (d.tipo === 'cambio_categoria') {
      if (!d.categoriaDestino) return res.status(400).json({ ok: false, error: 'Falta la categoría destino del cambio' });
      if (d.categoriaDestino === d.categoria) return res.status(400).json({ ok: false, error: 'La categoría origen y destino deben ser distintas' });
      if (d.cantidad <= 0) return res.status(400).json({ ok: false, error: 'La cantidad debe ser positiva' });
      const cfg = await prisma.categoriaHaciendaConfig.findFirst({ where: { companyId: req.companyId, nombre: d.categoria } });
      const trans = (cfg && Array.isArray(cfg.transiciones)) ? cfg.transiciones : null;
      if (trans && trans.length && !trans.includes(d.categoriaDestino)) {
        return res.status(400).json({ ok: false, error: `"${d.categoria}" no puede pasar a "${d.categoriaDestino}". Permitidas: ${trans.join(', ')}.` });
      }
      const row = await prisma.haciendaMovimiento.create({
        data: {
          companyId: req.companyId, campoId: d.campoId,
          categoria: d.categoria, categoriaDestino: d.categoriaDestino,
          fecha: d.fecha, tipo: 'cambio_categoria', cantidad: d.cantidad,
          kilos: d.kilos ?? null, observaciones: d.observaciones || null,
        },
      });
      return res.status(201).json({ ok: true, data: row });
    }

    // Para los demás tipos: positivos salvo "ajuste" (puede ser +/-).
    if (d.tipo !== 'ajuste' && d.cantidad <= 0) {
      return res.status(400).json({ ok: false, error: 'La cantidad debe ser positiva' });
    }
    const row = await prisma.haciendaMovimiento.create({
      data: {
        companyId: req.companyId, campoId: d.campoId, categoria: d.categoria,
        fecha: d.fecha, tipo: d.tipo, cantidad: d.cantidad,
        kilos: d.kilos ?? null, facturaRef: d.facturaRef || null,
        observaciones: d.observaciones || null,
      },
    });
    res.status(201).json({ ok: true, data: row });
  } catch (e) { next(e); }
});

// Confirmar el rendimiento de una venta "a rendimiento": kg/importe definitivos
// y registro del ingreso (que estaba pendiente).
app.put('/api/hacienda-movimientos/:id/rendimiento', requireCompany, requirePermission('stock:update'), async (req, res, next) => {
  try {
    const mov = await prisma.haciendaMovimiento.findFirst({ where: { id: req.params.id, companyId: req.companyId, tipo: 'venta', modoVenta: 'rendimiento' } });
    if (!mov) return res.status(404).json({ ok: false, error: 'Venta a rendimiento no encontrada' });
    if (mov.estadoRend === 'cerrada') return res.status(400).json({ ok: false, error: 'Esta venta a rendimiento ya fue cerrada' });
    const d = z.object({
      kilos: z.number().nonnegative(),
      precioKg: z.number().nonnegative().nullable().optional(),
      total: z.number().nonnegative().nullable().optional(),
      cobroTipo: z.enum(['ctacte','efectivo','banco','ninguno']).optional(),
      clienteId: z.string().nullable().optional(),
      caja: z.string().nullable().optional(),
      bancoCuentaId: z.string().nullable().optional(),
      fecha: z.coerce.date().optional(),
    }).parse(req.body || {});
    const total = (d.total != null ? d.total : (d.kilos * (d.precioKg || 0))) || 0;
    const dd = { categoria: mov.categoria, cantidad: mov.cantidad, fecha: d.fecha || mov.fecha, kilos: d.kilos, cobroTipo: d.cobroTipo, clienteId: d.clienteId ?? mov.clienteId, caja: d.caja, bancoCuentaId: d.bancoCuentaId };
    const result = await prisma.$transaction(async (tx) => {
      const links = (d.cobroTipo && d.cobroTipo !== 'ninguno') ? await _ingresoVentaHacienda(tx, req, dd, mov.id, total) : { efectivoId: null, bancoMovId: null };
      return tx.haciendaMovimiento.update({ where: { id: mov.id }, data: {
        kilos: d.kilos, precioKg: d.precioKg ?? mov.precioKg, total: total || null,
        clienteId: d.clienteId ?? mov.clienteId, cobroTipo: d.cobroTipo || 'ninguno',
        estadoRend: 'cerrada', efectivoId: links.efectivoId, bancoMovId: links.bancoMovId,
      }});
    });
    res.json({ ok: true, data: result });
  } catch (e) { next(e); }
});

// Edición general de un movimiento de animales (campos seguros). Para movimientos
// "compuestos" (traslado, cambio de categoría) o ventas con cobro/factura, se pide
// borrar y volver a cargar para no descuadrar dinero/contrapartes.
app.put('/api/hacienda-movimientos/:id', requireCompany, requirePermission('stock:update'), async (req, res, next) => {
  try {
    const existing = await prisma.haciendaMovimiento.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    if (['traslado_in', 'traslado_out', 'cambio_categoria'].includes(existing.tipo))
      return res.status(400).json({ ok: false, error: 'Los traslados y cambios de categoría no se editan: borralo y volvé a cargarlo.' });
    if (existing.facturaRef)
      return res.status(400).json({ ok: false, error: 'Este movimiento vino de una factura. Editá la factura para cambiarlo.' });
    if (existing.tipo === 'venta')
      return res.status(400).json({ ok: false, error: 'Las ventas se ajustan desde su flujo (rendimiento) o se borran y recargan.' });
    const d = z.object({
      campoId: z.string().optional(),
      categoria: z.string().min(1).optional(),
      fecha: z.coerce.date().optional(),
      cantidad: z.number().optional(),
      kilos: z.number().nonnegative().nullable().optional(),
      observaciones: z.string().nullable().optional(),
    }).parse(req.body || {});
    if (d.cantidad != null && existing.tipo !== 'ajuste' && d.cantidad <= 0)
      return res.status(400).json({ ok: false, error: 'La cantidad debe ser positiva' });
    const row = await prisma.haciendaMovimiento.update({ where: { id: existing.id }, data: {
      campoId: d.campoId ?? existing.campoId,
      categoria: d.categoria ?? existing.categoria,
      fecha: d.fecha ?? existing.fecha,
      cantidad: d.cantidad != null ? Math.round(d.cantidad) : existing.cantidad,
      kilos: d.kilos !== undefined ? d.kilos : existing.kilos,
      observaciones: d.observaciones !== undefined ? d.observaciones : existing.observaciones,
    } });
    res.json({ ok: true, data: row });
  } catch (e) { next(e); }
});

app.delete('/api/hacienda-movimientos/:id', requireCompany, requirePermission('stock:delete'), async (req, res, next) => {
  try {
    const existing = await prisma.haciendaMovimiento.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    await prisma.$transaction(async (tx) => {
      // Si es una venta, revertir el ingreso que haya generado.
      if (existing.tipo === 'venta') {
        if (existing.efectivoId) await tx.efectivo.deleteMany({ where: { id: existing.efectivoId, companyId: req.companyId } });
        if (existing.bancoMovId) await tx.bancoMovimiento.deleteMany({ where: { id: existing.bancoMovId, companyId: req.companyId } });
        await tx.ctaCte.deleteMany({ where: { companyId: req.companyId, referencia: `hacventa-${existing.id}` } });
      }
      await tx.haciendaMovimiento.delete({ where: { id: existing.id } });
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Resumen por campo y categoría: declarado vs real, con la diferencia.
// El frontend puede armar esto también del lado del navegador, pero tenerlo
// también del lado del servidor permite reportes y mejora performance.
app.get('/api/hacienda-resumen', requireCompany, requirePermission('stock:read'), async (req, res, next) => {
  try {
    const [stocks, movs, campos] = await Promise.all([
      prisma.haciendaStock.findMany({ where: { companyId: req.companyId } }),
      prisma.haciendaMovimiento.findMany({ where: { companyId: req.companyId } }),
      prisma.campo.findMany({ where: { companyId: req.companyId, activo: true }, select: { id: true, nombre: true } }),
    ]);
    // Stock real por (campoId, categoria) a partir de movimientos.
    const real = {};   // key = `${campoId}::${categoria}` -> int
    const signo = (m) => {
      switch (m.tipo) {
        case 'nacimiento': case 'compra': case 'traslado_in':  return  Number(m.cantidad || 0);
        case 'muerte':     case 'venta':  case 'traslado_out': return -Number(m.cantidad || 0);
        case 'ajuste':                                          return  Number(m.cantidad || 0);
        default: return 0;
      }
    };
    movs.forEach(m => {
      if (m.tipo === 'cambio_categoria') {
        // Baja en la categoría origen, alta en la destino (mismo campo).
        const kOut = m.campoId + '::' + m.categoria;
        const kIn  = m.campoId + '::' + (m.categoriaDestino || m.categoria);
        real[kOut] = (real[kOut] || 0) - Number(m.cantidad || 0);
        real[kIn]  = (real[kIn]  || 0) + Number(m.cantidad || 0);
        return;
      }
      const k = m.campoId + '::' + m.categoria;
      real[k] = (real[k] || 0) + signo(m);
    });
    // Armar filas: unión de (declarados) y (categorías que aparecen sólo en movs).
    const claves = new Set([
      ...stocks.map(s => s.campoId + '::' + s.categoria),
      ...Object.keys(real),
    ]);
    const filas = Array.from(claves).map(k => {
      const [campoId, categoria] = k.split('::');
      const decl = stocks.find(s => s.campoId === campoId && s.categoria === categoria);
      const declarado = decl ? decl.declarado : 0;
      const r = real[k] || 0;
      const pesoPromedio = decl?.pesoPromedio ?? null;
      return {
        campoId, categoria,
        stockId: decl ? decl.id : null,
        declarado, real: r,
        diferencia: r - declarado,
        pesoPromedio,
        kilosReal: pesoPromedio != null ? Math.round(r * pesoPromedio) : null,
        kilosDeclarado: pesoPromedio != null ? Math.round(declarado * pesoPromedio) : null,
      };
    });
    res.json({
      ok: true,
      data: {
        campos,
        filas: filas.sort((a, b) => a.campoId.localeCompare(b.campoId) || a.categoria.localeCompare(b.categoria, 'es')),
      },
    });
  } catch (e) { next(e); }
});

// ---------- CONFIG DE CATEGORÍAS DE HACIENDA (especie, rango kg, transiciones) ----------
const CAT_HACIENDA_DEFAULT = [
  { especie:'Bovino',  nombre:'Ternero',           kgMin:120, kgMax:200, pesoPromedio:160, gmdDefault:0.7, transiciones:['Novillito','Torito'], orden:1 },
  { especie:'Bovino',  nombre:'Novillito',         kgMin:201, kgMax:330, pesoPromedio:280, gmdDefault:0.8, transiciones:['Novillo'], orden:2 },
  { especie:'Bovino',  nombre:'Torito',            kgMin:201, kgMax:380, pesoPromedio:300, gmdDefault:0.9, transiciones:['Toro'], orden:3 },
  { especie:'Bovino',  nombre:'Novillo',           kgMin:331, kgMax:520, pesoPromedio:420, gmdDefault:0.8, transiciones:[], orden:4 },
  { especie:'Bovino',  nombre:'Toro',              kgMin:450, kgMax:800, pesoPromedio:600, gmdDefault:0,   transiciones:[], orden:5 },
  { especie:'Bovino',  nombre:'Ternera',           kgMin:120, kgMax:200, pesoPromedio:160, gmdDefault:0.6, transiciones:['Vaquillona'], orden:6 },
  { especie:'Bovino',  nombre:'Vaquillona',        kgMin:201, kgMax:360, pesoPromedio:300, gmdDefault:0.6, transiciones:['Vaca'], orden:7 },
  { especie:'Bovino',  nombre:'Vaca',              kgMin:350, kgMax:550, pesoPromedio:450, gmdDefault:0,   transiciones:[], orden:8 },
  { especie:'Porcino', nombre:'Lechón',            kgMin:5,   kgMax:25,  pesoPromedio:15,  gmdDefault:0.4, transiciones:['Cachorro','Cachorra'], orden:9 },
  { especie:'Porcino', nombre:'Cachorro',          kgMin:26,  kgMax:70,  pesoPromedio:50,  gmdDefault:0.6, transiciones:['Capón','Padrillo'], orden:10 },
  { especie:'Porcino', nombre:'Cachorra',          kgMin:26,  kgMax:70,  pesoPromedio:50,  gmdDefault:0.6, transiciones:['Hembra sin servir','Cerda'], orden:11 },
  { especie:'Porcino', nombre:'Capón',             kgMin:70,  kgMax:130, pesoPromedio:100, gmdDefault:0.7, transiciones:[], orden:12 },
  { especie:'Porcino', nombre:'Padrillo',          kgMin:120, kgMax:300, pesoPromedio:200, gmdDefault:0,   transiciones:[], orden:13 },
  { especie:'Porcino', nombre:'Hembra sin servir', kgMin:70,  kgMax:130, pesoPromedio:100, gmdDefault:0.5, transiciones:['Cerda'], orden:14 },
  { especie:'Porcino', nombre:'Cerda',             kgMin:120, kgMax:280, pesoPromedio:200, gmdDefault:0,   transiciones:[], orden:15 },
];
async function seedCategoriasHacienda(companyId) {
  const n = await prisma.categoriaHaciendaConfig.count({ where: { companyId } });
  if (n > 0) return;
  for (const c of CAT_HACIENDA_DEFAULT) {
    await prisma.categoriaHaciendaConfig.create({ data: { ...c, companyId } });
  }
}
// Une las "Categorías de animales" del Catálogo (tipo 'Categoría animal') dentro
// de la config de hacienda, para que TODAS las especies/categorías estén en un
// solo lugar y aparezcan en movimientos, stock y proyección. Idempotente.
async function mergeCatalogoAnimalesEnConfig(companyId) {
  const cats = await prisma.catalogo.findMany({
    where: { companyId, tipo: { in: ['Categoría animal', 'Categoria animal'] }, activo: true },
  });
  if (!cats.length) return;
  const existentes = new Set((await prisma.categoriaHaciendaConfig.findMany({
    where: { companyId }, select: { nombre: true },
  })).map(c => (c.nombre || '').toLowerCase()));
  for (const c of cats) {
    const nombre = (c.nombre || '').trim();
    if (!nombre || existentes.has(nombre.toLowerCase())) continue;
    try {
      await prisma.categoriaHaciendaConfig.create({ data: {
        companyId, nombre, especie: (c.descripcion || '').trim() || 'Otro',
        transiciones: [], orden: 99,
      } });
      existentes.add(nombre.toLowerCase());
    } catch (e) { /* carrera / único: ignorar */ }
  }
}
// Asegura que cada categoría de animales tenga un Producto del catálogo
// (categoria='hacienda', unidad='cabezas') para unificarse en Stock/Movimientos.
// Si ya hay un producto con el mismo nombre pero sin vincular, lo vincula.
async function sincronizarProductosHacienda(companyId) {
  const cats = await prisma.categoriaHaciendaConfig.findMany({ where: { companyId, activo: true } });
  if (!cats.length) return;
  const prods = await prisma.producto.findMany({
    where: { companyId, categoria: 'hacienda' },
    select: { id: true, nombre: true, categoriaHacienda: true },
  });
  const byCatHac = new Set(prods.filter(p => p.categoriaHacienda).map(p => p.categoriaHacienda.toLowerCase()));
  const byNombre = new Map(prods.map(p => [(p.nombre || '').toLowerCase(), p]));
  for (const c of cats) {
    const nombre = (c.nombre || '').trim();
    if (!nombre || byCatHac.has(nombre.toLowerCase())) continue;
    const nombreFull = `${(c.especie || '').trim()}${c.especie ? ' - ' : ''}${nombre}`;
    // ¿Existe un producto homónimo sin vincular? -> vincularlo.
    const match = byNombre.get(nombre.toLowerCase()) || byNombre.get(nombreFull.toLowerCase());
    if (match) {
      if (!match.categoriaHacienda) {
        await prisma.producto.update({ where: { id: match.id }, data: { categoriaHacienda: nombre } });
      }
      byCatHac.add(nombre.toLowerCase());
      continue;
    }
    await prisma.producto.create({ data: {
      companyId, categoria: 'hacienda', nombre: nombreFull, unidad: 'cabezas',
      stockMinimo: 0, categoriaHacienda: nombre, activo: true,
    } });
    byCatHac.add(nombre.toLowerCase());
  }
}
// Tipos de insumo "de fábrica" + los que el usuario haya agregado en Catálogos → Tipos de insumo.
// Debe coincidir con LEGACY_INS_TIPOS del frontend (AgroCore-web.html).
const INSUMO_TIPOS_BASE = ['Herbicida', 'Insecticida', 'Fungicida', 'Fertilizante', 'Semilla', 'Coadyuvante', 'Insumo'];
async function insumoTipoNombresSet(companyId) {
  const extra = await prisma.catalogo.findMany({ where: { companyId, tipo: 'Tipo de insumo' }, select: { nombre: true } });
  return new Set([...INSUMO_TIPOS_BASE, ...extra.map(e => e.nombre)].map(t => (t || '').trim()).filter(Boolean));
}
// Espeja el catálogo de insumos a la tabla de Productos para que TODOS los insumos
// del catálogo aparezcan en Stock (con existencia 0 hasta que se muevan). Igual que
// sincronizarProductosHacienda pero para insumos. Idempotente (no duplica por nombre).
async function sincronizarProductosInsumos(companyId) {
  const tipos = await insumoTipoNombresSet(companyId);
  const items = await prisma.catalogo.findMany({ where: { companyId, activo: { not: false } } });
  const insumoCat = items.filter(c => tipos.has((c.tipo || '').trim()));
  if (!insumoCat.length) return;
  // Chequeamos contra TODOS los productos activos por nombre normalizado (no solo
  // categoria='insumos' exacta) para NO crear duplicados si la categoría quedó
  // guardada distinta (insumos vs Insumos, o con familia asignada).
  const nrm = (s) => _sinAcentos(s).replace(/\s+/g, ' ').trim();
  const prods = await prisma.producto.findMany({ where: { companyId, activo: true }, select: { nombre: true } });
  const have = new Set(prods.map(p => nrm(p.nombre)));
  for (const c of insumoCat) {
    const nombre = (c.nombre || '').trim();
    if (!nombre || have.has(nrm(nombre))) continue;
    await prisma.producto.create({ data: {
      companyId, categoria: 'insumos', nombre, unidad: 'unidad',
      stockMinimo: 0, activo: true,
      precioReferencia: c.precioReferencia ?? null,
      ultimoCostoMoneda: c.monedaPrecio ?? null,
    } });
    have.add(nrm(nombre));
  }
}
// Igual que los insumos, pero para CEREALES / GRANOS: cada cereal del catálogo se
// materializa como producto de stock (existencia 0 hasta que se mueva), para verlos
// todos en Stock. Idempotente (no duplica por nombre). Copia la categoría del árbol.
const CEREAL_TIPOS = new Set(['cereal', 'cereales', 'grano', 'granos']);
async function sincronizarProductosCereales(companyId) {
  const items = (await prisma.catalogo.findMany({ where: { companyId, activo: { not: false } } }))
    .filter(c => CEREAL_TIPOS.has((c.tipo || '').trim().toLowerCase()));
  if (!items.length) return;
  const nrm = (s) => _sinAcentos(s).replace(/\s+/g, ' ').trim();
  const prods = await prisma.producto.findMany({ where: { companyId, activo: true }, select: { nombre: true } });
  const have = new Set(prods.map(p => nrm(p.nombre)));
  for (const c of items) {
    const nombre = (c.nombre || '').trim();
    if (!nombre || have.has(nrm(nombre))) continue;
    await prisma.producto.create({ data: {
      companyId, categoria: 'cereales', nombre, unidad: 'kg',
      stockMinimo: 0, activo: true,
      categoriaArticuloId: c.categoriaArticuloId ?? null,
      precioReferencia: c.precioReferencia ?? null,
      ultimoCostoMoneda: c.monedaPrecio ?? null,
    } });
    have.add(nrm(nombre));
  }
}
// Devuelve un mapa nombreInsumo(lowercase) -> tipo del catálogo, para etiquetar el
// stock de insumos por su tipo (Herbicida, Fertilizante, etc.) sin guardar el dato.
async function insumoNombreATipo(companyId) {
  const nrm = (s) => _sinAcentos(s || '').replace(/\s+/g, ' ').trim();
  const tipos = await insumoTipoNombresSet(companyId);
  const items = await prisma.catalogo.findMany({ where: { companyId }, select: { nombre: true, tipo: true } });
  const map = {};
  items.forEach(c => { if (tipos.has((c.tipo || '').trim()) && c.nombre) map[nrm(c.nombre)] = (c.tipo || '').trim(); });
  return map;
}
const catHaciendaSchema = z.object({
  especie: z.string().min(1),
  nombre: z.string().min(1),
  kgMin: z.number().nonnegative().nullable().optional(),
  kgMax: z.number().nonnegative().nullable().optional(),
  pesoPromedio: z.number().nonnegative().nullable().optional(),
  gmdDefault: z.number().nonnegative().nullable().optional(),
  transiciones: z.array(z.string()).nullable().optional(),
  orden: z.coerce.number().int().optional(),
  activo: z.boolean().optional(),
});
app.get('/api/categorias-hacienda', requireCompany, requirePermission('stock:read'), async (req, res, next) => {
  try {
    await seedCategoriasHacienda(req.companyId);
    await mergeCatalogoAnimalesEnConfig(req.companyId);
    await sincronizarProductosHacienda(req.companyId);
    const data = await prisma.categoriaHaciendaConfig.findMany({ where: { companyId: req.companyId }, orderBy: [{ orden: 'asc' }, { especie: 'asc' }, { nombre: 'asc' }] });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});
app.post('/api/categorias-hacienda', requireCompany, requirePermission('stock:create'), async (req, res, next) => {
  try {
    const d = catHaciendaSchema.parse(req.body);
    const row = await prisma.categoriaHaciendaConfig.create({ data: {
      companyId: req.companyId, especie: d.especie, nombre: d.nombre,
      kgMin: d.kgMin ?? null, kgMax: d.kgMax ?? null, pesoPromedio: d.pesoPromedio ?? null,
      gmdDefault: d.gmdDefault ?? null, transiciones: d.transiciones ?? [], orden: d.orden ?? 99,
    } });
    res.status(201).json({ ok: true, data: row });
  } catch (e) { next(e); }
});
app.put('/api/categorias-hacienda/:id', requireCompany, requirePermission('stock:update'), async (req, res, next) => {
  try {
    const existing = await prisma.categoriaHaciendaConfig.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    const d = catHaciendaSchema.partial().parse(req.body);
    const row = await prisma.categoriaHaciendaConfig.update({ where: { id: existing.id }, data: d });
    res.json({ ok: true, data: row });
  } catch (e) { next(e); }
});
app.delete('/api/categorias-hacienda/:id', requireCompany, requirePermission('stock:delete'), async (req, res, next) => {
  try {
    const existing = await prisma.categoriaHaciendaConfig.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    const nombre = (existing.nombre || '').trim();
    // No permitir borrar una categoría EN USO (su producto de hacienda tiene movimientos de stock).
    const prod = await prisma.producto.findFirst({
      where: { companyId: req.companyId, categoria: 'hacienda', OR: [{ categoriaHacienda: nombre }, { nombre }] },
      select: { id: true },
    });
    if (prod) {
      const movs = await prisma.movimiento.count({ where: { companyId: req.companyId, productoId: prod.id } });
      if (movs > 0) return res.status(400).json({ ok: false, error: `La categoría "${nombre}" está en uso (${movs} movimiento/s de stock). No se puede eliminar; podés desactivarla desde Stock.` });
    }
    await prisma.$transaction(async (tx) => {
      await tx.categoriaHaciendaConfig.delete({ where: { id: existing.id } });
      // Borrar también la entrada del Catálogo (tipo "Categoría animal") con el mismo
      // nombre, para que el merge automático NO la vuelva a crear en el próximo refresco.
      await tx.catalogo.deleteMany({ where: { companyId: req.companyId, tipo: { in: ['Categoría animal', 'Categoria animal'] }, nombre } });
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

mountCrud({
  path: 'catalogos', modelName: 'catalogo', perm: 'catalogos',
  schema: z.object({
    tipo: z.string().min(1),
    codigo: z.string().nullable().optional(),
    nombre: z.string().min(1),
    descripcion: z.string().nullable().optional(),
    precioReferencia: z.number().nullable().optional(),
    tipoPrecio: z.enum(['por_hectarea', 'total']).nullable().optional(),
    monedaPrecio: z.string().nullable().optional(),
    // Insumos típicos (Labor): [{ productoId, cantidad, unidad }] interpretado por hectárea
    insumosDefault: z.array(z.object({
      productoId: z.string(),
      cantidad: z.number(),
      unidad: z.string().nullable().optional(),
    })).nullable().optional(),
    categoriaArticuloId: z.string().nullable().optional(),   // v2.9.1 — familia del árbol
    activo: z.boolean().optional(),
  }),
  orderBy: { nombre: 'asc' },
  searchFields: ['nombre', 'codigo', 'tipo'],
  // Los catalogos son datos maestros/referencia (cereales, labores, insumos,
  // unidades, bancos, medios externos, etc.) que casi todos los modulos necesitan
  // LEER. La lectura queda abierta a cualquier usuario de la empresa; crear/editar/
  // borrar sigue exigiendo el permiso 'catalogos'.
  readOpen: true,
});

// ============================================================
// WEB PUBLICA + RAIZ + 404 + ERROR HANDLER
// ============================================================
// La web publica de marketing vive en <root>/web/index.html y se sirve en GET /
// (ademas de /web). El sistema completo sigue en GET /app.
const WEB_PUBLIC = path.join(STATIC_DIR, 'web');
app.get('/', (req, res) => {
  // Subdominios de demo / produccion van directo al sistema.
  // La landing publica vive en agrocore.ar (Cloudflare Pages), no aca.
  const host = req.hostname || '';
  const esLocal = host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.');
  if (!esLocal) {
    return res.redirect(302, '/app');
  }
  const indexHtml = path.join(WEB_PUBLIC, 'index.html');
  if (fs.existsSync(indexHtml)) return res.sendFile(indexHtml);
  // Fallback: respuesta de texto si la web aun no esta deployada.
  res.type('text').send(
    `AgroCore API v0.1.0 - puerto ${PORT}\n` +
    `Web publica:                  -> /web/\n` +
    `Sistema (login):              -> /app\n` +
    `GET  /api/health              -> health\n` +
    `POST /api/auth/login          -> { email, password }\n`
  );
});
app.get('/api', (_req, res) => {
  res.type('text').send(
    `AgroCore API v0.1.0 - puerto ${PORT}\n` +
    `GET  /api/health              -> health\n` +
    `POST /api/auth/login          -> { email, password }\n` +
    `Headers para endpoints de negocio:\n` +
    `  Authorization: Bearer <token>\n` +
    `  X-Company-Id:  <companyId>\n`
  );
});

// ============================================================
// DEPÓSITOS (cereal en cerealera, silos propios, galpones)
// ============================================================
const depositoSchema = z.object({
  nombre: z.string().min(1),
  tipo: z.enum(['campo', 'cerealera', 'otro']),
  cuit: z.string().nullable().optional(),
  contacto: z.string().nullable().optional(),
  telefono: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  direccion: z.string().nullable().optional(),
  localidad: z.string().nullable().optional(),
  provincia: z.string().nullable().optional(),
  costoEstadiaMes: z.number().nullable().optional(),
  costoSecadaTn: z.number().nullable().optional(),
  observaciones: z.string().nullable().optional(),
  activo: z.boolean().optional(),
  compartido: z.boolean().optional(),    // si true → companyId NULL, visible para todas
});

// Where clause común: depósitos de la empresa actual + los compartidos (companyId NULL).
// En Prisma 6 hay que envolver el `null` en `{ equals: null }` para que no lo interprete
// como "sin filtro" y devuelva el error "Argument companyId is missing".
function _depositoWhere(req) {
  return { OR: [
    { companyId: req.companyId },
    { companyId: { equals: null }, compartido: true },
  ] };
}

// Asegura que cada campo marcado "es depósito" (o con hacienda cargada) tenga su
// Deposito tipo='campo' vinculado. Migra los campos existentes con hacienda. Idempotente.
async function reconciliarCamposDeposito(companyId) {
  // Campos con hacienda (stock o movimientos) -> deberían ser depósito.
  const [stk, mov] = await Promise.all([
    prisma.haciendaStock.findMany({ where: { companyId }, select: { campoId: true } }),
    prisma.haciendaMovimiento.findMany({ where: { companyId }, select: { campoId: true } }),
  ]);
  const conHacienda = new Set([...stk, ...mov].map(x => x.campoId).filter(Boolean));
  const campos = await prisma.campo.findMany({ where: { companyId, activo: true } });
  const deps = await prisma.deposito.findMany({ where: { companyId, campoId: { not: null } }, select: { campoId: true } });
  const yaDeposito = new Set(deps.map(d => d.campoId));
  for (const c of campos) {
    const debeSer = c.esDeposito || conHacienda.has(c.id);
    if (!debeSer) continue;
    if (!c.esDeposito) { try { await prisma.campo.update({ where: { id: c.id }, data: { esDeposito: true } }); } catch {} }
    if (yaDeposito.has(c.id)) continue;
    try {
      await prisma.deposito.create({ data: {
        companyId, compartido: false, nombre: c.nombre, tipo: 'campo', campoId: c.id,
        localidad: c.localidad || null, provincia: c.provincia || null,
        observaciones: 'Depósito del campo ' + c.nombre,
      } });
      yaDeposito.add(c.id);
    } catch (e) { /* carrera: ignorar */ }
  }
}

app.get('/api/depositos', requireCompany, requirePermission('stock:read'), async (req, res, next) => {
  try {
    try { await reconciliarCamposDeposito(req.companyId); } catch {}
    const data = await prisma.deposito.findMany({
      where: _depositoWhere(req),
      orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
    });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});

app.post('/api/depositos', requireCompany, requirePermission('stock:create'), async (req, res, next) => {
  try {
    const d = depositoSchema.parse(req.body);
    // Si compartido=true, no asociamos a una empresa (companyId NULL)
    const data = { ...d, companyId: d.compartido ? null : req.companyId };
    const row = await prisma.deposito.create({ data });
    res.status(201).json({ ok: true, data: row });
  } catch (e) { next(e); }
});

app.put('/api/depositos/:id', requireCompany, requirePermission('stock:update'), async (req, res, next) => {
  try {
    const existing = await prisma.deposito.findFirst({ where: { id: req.params.id, ..._depositoWhere(req) } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    const d = depositoSchema.partial().parse(req.body);
    // Si cambian el flag compartido, alineamos companyId.
    const data = { ...d };
    if (d.compartido !== undefined) {
      data.companyId = d.compartido ? null : (existing.companyId || req.companyId);
    }
    const row = await prisma.deposito.update({ where: { id: req.params.id }, data });
    res.json({ ok: true, data: row });
  } catch (e) { next(e); }
});

app.delete('/api/depositos/:id', requireCompany, requirePermission('stock:delete'), async (req, res, next) => {
  try {
    const existing = await prisma.deposito.findFirst({ where: { id: req.params.id, ..._depositoWhere(req) } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    // Si tiene movimientos: marcamos inactivo en vez de borrar (preservar historia)
    const movs = await prisma.movimiento.count({ where: { depositoId: req.params.id } });
    if (movs > 0) {
      await prisma.deposito.update({ where: { id: req.params.id }, data: { activo: false } });
      return res.json({ ok: true, info: 'Tiene movimientos: marcado como inactivo' });
    }
    await prisma.deposito.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Stock por depósito: para cada producto, cuánto hay en cada ubicación.
// Útil para saber qué cereal tenés en cada cerealera y cuánto en el campo.
// Acepta ?incluyeCompartidos=false para ver solo lo propio de la empresa actual.
app.get('/api/stock-por-deposito', requireCompany, requirePermission('stock:read'), async (req, res, next) => {
  try {
    const incluyeComp = req.query.incluyeCompartidos !== 'false';
    const productos = await prisma.producto.findMany({ where: { companyId: req.companyId, activo: true } });
    const depWhere = incluyeComp
      ? { OR: [ { companyId: req.companyId }, { companyId: { equals: null }, compartido: true } ], activo: true }
      : { companyId: req.companyId, activo: true };
    const depositos = await prisma.deposito.findMany({ where: depWhere });
    // Movimientos agrupados por producto + depósito + tipo
    const movs = await prisma.movimiento.groupBy({
      by: ['productoId', 'depositoId', 'tipo'],
      where: { companyId: req.companyId },
      _sum: { cantidad: true },
    });
    // Para cada producto, tabla con depósitos (campo + cerealeras)
    const data = productos.map(p => {
      const byDep = {};
      // "campo" = depositoId null
      byDep['__campo__'] = { depositoId: null, nombre: 'Mi campo', tipo: 'campo', existencia: 0, compartido: false };
      depositos.forEach(d => { byDep[d.id] = { depositoId: d.id, nombre: d.nombre, tipo: d.tipo, compartido: d.compartido || false, existencia: 0 }; });
      movs.filter(m => m.productoId === p.id).forEach(m => {
        const key = m.depositoId || '__campo__';
        if (!byDep[key]) return;
        const cant = Number(m._sum?.cantidad || 0);
        byDep[key].existencia += (m.tipo === 'ingreso' ? cant : -cant);
      });
      return { ...p, depositos: Object.values(byDep) };
    });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});

// Entrega de cereal a una cerealera: transferencia atómica de stock entre depósitos.
// Genera un movimiento de egreso del depósito origen (default: campo) + uno de
// ingreso al depósito destino (la cerealera). El producto sigue siendo del cliente.
app.post('/api/entregas-cerealera', requireCompany, requirePermission('stock:create'), async (req, res, next) => {
  try {
    const schema = z.object({
      productoId: z.string(),
      cantidad: z.number().positive(),
      depositoDestinoId: z.string(),
      depositoOrigenId: z.string().nullable().optional(),  // null = campo
      fecha: z.coerce.date(),
      remito: z.string().nullable().optional(),
      observaciones: z.string().nullable().optional(),
    });
    const d = schema.parse(req.body);
    const prod = await prisma.producto.findFirst({ where: { id: d.productoId, companyId: req.companyId } });
    if (!prod) return res.status(404).json({ ok: false, error: 'Producto no encontrado' });
    // Destino puede ser propio o compartido
    const destino = await prisma.deposito.findFirst({ where: { id: d.depositoDestinoId, OR: [ { companyId: req.companyId }, { companyId: { equals: null }, compartido: true } ] } });
    if (!destino) return res.status(404).json({ ok: false, error: 'Depósito destino no encontrado' });
    const result = await prisma.$transaction(async (tx) => {
      const egreso = await tx.movimiento.create({
        data: {
          companyId: req.companyId, productoId: d.productoId, depositoId: d.depositoOrigenId || null,
          fecha: d.fecha, tipo: 'egreso', motivo: 'entrega_cerealera', cantidad: d.cantidad,
          referencia: d.remito || null, observaciones: d.observaciones || `Entrega a ${destino.nombre}`,
          userId: req.user?.id || null,
        },
      });
      const ingreso = await tx.movimiento.create({
        data: {
          companyId: req.companyId, productoId: d.productoId, depositoId: d.depositoDestinoId,
          fecha: d.fecha, tipo: 'ingreso', motivo: 'entrega_cerealera', cantidad: d.cantidad,
          referencia: d.remito || null, observaciones: d.observaciones || 'Ingreso desde campo',
          userId: req.user?.id || null,
        },
      });
      return { egreso, ingreso };
    });
    res.status(201).json({ ok: true, data: result });
  } catch (e) { next(e); }
});

// ============================================================
// LIQUIDACIÓN DE CEREAL: cuando vendés el cereal que tenías en la cerealera.
// Saca el cereal del depósito + crea movimiento positivo en CtaCte por el neto.
// ============================================================
app.get('/api/liquidaciones-cereal', requireCompany, requirePermission('ventas:read'), async (req, res, next) => {
  try {
    const data = await prisma.liquidacionCereal.findMany({
      where: { companyId: req.companyId },
      orderBy: { fecha: 'desc' },
      include: { deposito: true, conceptos: true },
    });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});

app.get('/api/liquidaciones-cereal/:id', requireCompany, requirePermission('ventas:read'), async (req, res, next) => {
  try {
    const data = await prisma.liquidacionCereal.findFirst({
      where: { id: req.params.id, companyId: req.companyId },
      include: { deposito: true, conceptos: true },
    });
    if (!data) return res.status(404).json({ ok: false, error: 'No encontrada' });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});

app.post('/api/liquidaciones-cereal', requireCompany, requirePermission('ventas:create'), async (req, res, next) => {
  try {
    const concSchema = z.object({
      tipo: z.enum(['descuento', 'impuesto']),
      concepto: z.string().min(1),
      importe: z.number(),
      porcentaje: z.number().nullable().optional(),
    });
    const schema = z.object({
      depositoId: z.string(),
      productoId: z.string(),
      clienteId: z.string().nullable().optional(),
      contratoCerealId: z.string().nullable().optional(),
      fecha: z.coerce.date(),
      numero: z.string().nullable().optional(),
      kilosBrutos: z.number().nonnegative(),
      porcMerma: z.number().min(0).max(100).default(0),
      precioPorTn: z.number().nonnegative(),
      conceptos: z.array(concSchema).default([]),
      fechaCobroEst: z.coerce.date().nullable().optional(),
      observaciones: z.string().nullable().optional(),
      viajeIds: z.array(z.string()).nullable().optional(),
    });
    const d = schema.parse(req.body);
    const kilosNetos = d.kilosBrutos * (1 - d.porcMerma / 100);
    const bruto = (kilosNetos / 1000) * d.precioPorTn;
    let totalDescuentos = 0, totalImpuestos = 0;
    d.conceptos.forEach(c => {
      if (c.tipo === 'descuento') totalDescuentos += c.importe;
      else totalImpuestos += c.importe;
    });
    const neto = bruto - totalDescuentos - totalImpuestos;
    const result = await prisma.$transaction(async (tx) => {
      const liq = await tx.liquidacionCereal.create({
        data: {
          companyId: req.companyId, depositoId: d.depositoId, productoId: d.productoId,
          clienteId: d.clienteId || null, contratoCerealId: d.contratoCerealId || null,
          fecha: d.fecha, numero: d.numero || null,
          kilosBrutos: d.kilosBrutos, porcMerma: d.porcMerma, kilosNetos,
          precioPorTn: d.precioPorTn, bruto, totalDescuentos, totalImpuestos, neto,
          fechaCobroEst: d.fechaCobroEst || null,
          observaciones: d.observaciones || null,
          conceptos: { create: d.conceptos.map(c => ({ tipo: c.tipo, concepto: c.concepto, importe: c.importe, porcentaje: c.porcentaje ?? null })) },
        },
      });
      // Egreso de stock del depósito (kilos NETOS, los brutos no salen porque la merma es humedad)
      await tx.movimiento.create({
        data: {
          companyId: req.companyId, productoId: d.productoId, depositoId: d.depositoId,
          fecha: d.fecha, tipo: 'egreso', motivo: 'liquidacion_cerealera',
          cantidad: kilosNetos / 1000,    // a toneladas
          precio: d.precioPorTn, total: bruto,
          referencia: `LIQCER-${liq.id}`,
          observaciones: `Liquidación cereal ${d.numero || ''} — neto ${neto.toFixed(2)}`.replace(/\s+—/, ' —'),
          userId: req.user?.id || null,
        },
      });
      // Si hay cliente, registramos en CtaCte el neto a cobrar
      if (d.clienteId) {
        await tx.ctaCte.create({
          data: {
            companyId: req.companyId, contactoTipo: 'cliente', contactoId: d.clienteId,
            fecha: d.fecha,
            detalle: `Liquidación cereal ${d.numero || ''}`.trim(),
            referencia: `LIQCER-${liq.id}`,
            debe: neto,           // el cliente nos debe el neto a cobrar
            haber: 0,
            vencimiento: d.fechaCobroEst || null,
            categoria: 'liquidacion_cereal',
          },
        });
      }
      if (d.viajeIds && d.viajeIds.length) {
        for (const vid of d.viajeIds) {
          const v = await tx.viaje.findFirst({ where: { id: vid, companyId: req.companyId } });
          if (!v) continue;
          const kv = Number(v.kgDescarga || v.kgNetoDest || v.kgNeto || v.cantidad || 0);
          try { await tx.viajeLiquidacion.create({ data: { companyId: req.companyId, viajeId: vid, liquidacionId: liq.id, kilosAplicados: kv } }); } catch {}
          { const upd = {};
            if (!v.liquidacionCerealId) upd.liquidacionCerealId = liq.id;
            if (d.contratoCerealId && !v.contratoCerealId) upd.contratoCerealId = d.contratoCerealId;
            if (Object.keys(upd).length) { try { await tx.viaje.update({ where: { id: vid }, data: upd }); } catch {} } }
        }
      }
      return liq;
    });
    res.status(201).json({ ok: true, data: result });
  } catch (e) { next(e); }
});

app.put('/api/liquidaciones-cereal/:id/marcar-cobrado', requireCompany, requirePermission('ventas:update'), async (req, res, next) => {
  try {
    const liq = await prisma.liquidacionCereal.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!liq) return res.status(404).json({ ok: false, error: 'No encontrada' });
    const row = await prisma.liquidacionCereal.update({ where: { id: req.params.id }, data: { cobrado: true } });
    res.json({ ok: true, data: row });
  } catch (e) { next(e); }
});
// Revierte los efectos de una liquidación de cereal (stock, cta cte, vínculos de viajes).
async function _revertirLiqCereal(tx, companyId, liq) {
  const refs = [`LIQCER-${liq.id}`, `LIQ-${liq.id.slice(-6).toUpperCase()}`];
  // Egreso de stock (nuevo formato por referencia; legacy por numero+producto+deposito)
  await tx.movimiento.deleteMany({ where: { companyId, referencia: { in: refs } } });
  if (liq.numero) await tx.movimiento.deleteMany({ where: { companyId, motivo: 'liquidacion_cerealera', referencia: liq.numero, productoId: liq.productoId, depositoId: liq.depositoId } });
  // Cuenta a cobrar
  await tx.ctaCte.deleteMany({ where: { companyId, referencia: { in: refs } } });
}
// Quita los vínculos de viajes (posición de granos) de una liquidación de cereal.
async function _desvincularViajesLiqCereal(tx, companyId, liqId) {
  await tx.viajeLiquidacion.deleteMany({ where: { companyId, liquidacionId: liqId } }).catch(() => {});
  await tx.viaje.updateMany({ where: { companyId, liquidacionCerealId: liqId }, data: { liquidacionCerealId: null } }).catch(() => {});
}
app.delete('/api/liquidaciones-cereal/:id', requireCompany, requirePermission('ventas:delete'), async (req, res, next) => {
  try {
    const liq = await prisma.liquidacionCereal.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!liq) return res.status(404).json({ ok: false, error: 'No encontrada' });
    await prisma.$transaction(async (tx) => {
      await _revertirLiqCereal(tx, req.companyId, liq);
      await _desvincularViajesLiqCereal(tx, req.companyId, liq.id);
      await tx.liquidacionCereal.delete({ where: { id: liq.id } });  // conceptos caen por cascada
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});
// EDITAR una liquidación de cereal: revierte y reaplica. Se BLOQUEA si ya está cobrada.
app.put('/api/liquidaciones-cereal/:id', requireCompany, requirePermission('ventas:update'), async (req, res, next) => {
  try {
    const existing = await prisma.liquidacionCereal.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrada' });
    if (existing.cobrado) return res.status(400).json({ ok: false, error: 'La liquidación está marcada como cobrada. Deshacé el cobro antes de editarla.' });
    const concSchema = z.object({ tipo: z.enum(['descuento', 'impuesto']), concepto: z.string().min(1), importe: z.number(), porcentaje: z.number().nullable().optional() });
    const schema = z.object({
      depositoId: z.string(), productoId: z.string(), clienteId: z.string().nullable().optional(),
      contratoCerealId: z.string().nullable().optional(),
      fecha: z.coerce.date(), numero: z.string().nullable().optional(),
      kilosBrutos: z.number().nonnegative(), porcMerma: z.number().min(0).max(100).default(0),
      precioPorTn: z.number().nonnegative(), conceptos: z.array(concSchema).default([]),
      fechaCobroEst: z.coerce.date().nullable().optional(), observaciones: z.string().nullable().optional(),
      viajeIds: z.array(z.string()).nullable().optional(),
    });
    const d = schema.parse(req.body);
    const kilosNetos = d.kilosBrutos * (1 - d.porcMerma / 100);
    const bruto = (kilosNetos / 1000) * d.precioPorTn;
    let totalDescuentos = 0, totalImpuestos = 0;
    d.conceptos.forEach(c => { if (c.tipo === 'descuento') totalDescuentos += c.importe; else totalImpuestos += c.importe; });
    const neto = bruto - totalDescuentos - totalImpuestos;
    await prisma.$transaction(async (tx) => {
      await _revertirLiqCereal(tx, req.companyId, existing);
      await tx.liquidacionCerealConcepto.deleteMany({ where: { liquidacionId: existing.id } });
      await tx.liquidacionCereal.update({ where: { id: existing.id }, data: {
        depositoId: d.depositoId, productoId: d.productoId, clienteId: d.clienteId || null,
        contratoCerealId: d.contratoCerealId || null,
        fecha: d.fecha, numero: d.numero || null, kilosBrutos: d.kilosBrutos, porcMerma: d.porcMerma,
        kilosNetos, precioPorTn: d.precioPorTn, bruto, totalDescuentos, totalImpuestos, neto,
        fechaCobroEst: d.fechaCobroEst || null, observaciones: d.observaciones || null,
        conceptos: { create: d.conceptos.map(c => ({ tipo: c.tipo, concepto: c.concepto, importe: c.importe, porcentaje: c.porcentaje ?? null })) },
      }});
      await tx.movimiento.create({ data: {
        companyId: req.companyId, productoId: d.productoId, depositoId: d.depositoId, fecha: d.fecha,
        tipo: 'egreso', motivo: 'liquidacion_cerealera', cantidad: kilosNetos / 1000, precio: d.precioPorTn, total: bruto,
        referencia: `LIQCER-${existing.id}`, observaciones: `Liquidación cereal ${d.numero || ''} — neto ${neto.toFixed(2)}`.replace(/\s+—/, ' —'),
        userId: req.user?.id || null,
      }});
      if (d.clienteId) {
        await tx.ctaCte.create({ data: {
          companyId: req.companyId, contactoTipo: 'cliente', contactoId: d.clienteId, fecha: d.fecha,
          detalle: `Liquidación cereal ${d.numero || ''}`.trim(), referencia: `LIQCER-${existing.id}`,
          debe: neto, haber: 0, vencimiento: d.fechaCobroEst || null, categoria: 'liquidacion_cereal',
        }});
      }
      // Vínculos con viajes: solo se tocan si el body los trae (la edición manual no los reenvía → se preservan).
      if (Array.isArray(d.viajeIds)) {
        await _desvincularViajesLiqCereal(tx, req.companyId, existing.id);
        for (const vid of d.viajeIds) {
          const v = await tx.viaje.findFirst({ where: { id: vid, companyId: req.companyId } });
          if (!v) continue;
          const kv = Number(v.kgDescarga || v.kgNetoDest || v.kgNeto || v.cantidad || 0);
          try { await tx.viajeLiquidacion.create({ data: { companyId: req.companyId, viajeId: vid, liquidacionId: existing.id, kilosAplicados: kv } }); } catch {}
          { const upd = {};
            if (!v.liquidacionCerealId) upd.liquidacionCerealId = existing.id;
            if (d.contratoCerealId && !v.contratoCerealId) upd.contratoCerealId = d.contratoCerealId;
            if (Object.keys(upd).length) { try { await tx.viaje.update({ where: { id: vid }, data: upd }); } catch {} } }
        }
      }
    });
    const full = await prisma.liquidacionCereal.findUnique({ where: { id: existing.id }, include: { deposito: true, conceptos: true } });
    res.json({ ok: true, data: full });
  } catch (e) { next(e); }
});

// ============================================================
// CONTRATOS DE CEREAL (confirmaciones de negocio). Agrupan el compromiso de
// entrega con un comprador/corredor. Las cartas de porte (viajes) y las
// pesificaciones (liquidaciones) se imputan al contrato via contratoCerealId.
// El tablero calcula: pactado / entregado (salientes y descargados) /
// pendiente de entrega / pesificado / pendiente de pesificar / cobrado.
// ============================================================
const contratoCerealSchema = z.object({
  numeroInterno: z.string().nullable().optional(),
  numeroCorredor: z.string().nullable().optional(),
  fecha: z.coerce.date().nullable().optional(),
  cosecha: z.string().nullable().optional(),
  productoId: z.string().nullable().optional(),
  cereal: z.string().nullable().optional(),
  compradorNombre: z.string().nullable().optional(),
  compradorCuit: z.string().nullable().optional(),
  corredorNombre: z.string().nullable().optional(),
  corredorCuit: z.string().nullable().optional(),
  acopioDepositoId: z.string().nullable().optional(),
  acopioNombre: z.string().nullable().optional(),
  procedencia: z.string().nullable().optional(),
  destino: z.string().nullable().optional(),
  tnsPactadas: z.coerce.number().nonnegative().default(0),
  tipoPrecio: z.enum(['a_fijar','fijo']).default('a_fijar'),
  precioFijo: z.coerce.number().nullable().optional(),
  moneda: z.string().default('USD'),
  pizarra: z.string().nullable().optional(),
  comisionPorc: z.coerce.number().nullable().optional(),
  volatilPorc: z.coerce.number().nullable().optional(),
  contraFlete: z.coerce.number().nullable().optional(),
  gastoEntregador: z.coerce.number().nullable().optional(),
  gastoEntregadorIva: z.coerce.boolean().default(false),
  tarifaFlete: z.coerce.number().nullable().optional(),
  pagoDias: z.coerce.number().int().nullable().optional(),
  porcParcial: z.coerce.number().nullable().optional(),
  porcFinal: z.coerce.number().nullable().optional(),
  plazoEntregaDesde: z.coerce.date().nullable().optional(),
  plazoEntregaHasta: z.coerce.date().nullable().optional(),
  reciboHasta: z.coerce.number().nullable().optional(),
  condiciones: z.string().nullable().optional(),
  observaciones: z.string().nullable().optional(),
  estado: z.enum(['abierto','entregado','pesificado','cerrado','anulado']).optional(),
});

// kg de carga (salientes del campo) de una CP
function _kgCargaViaje(v){ return Number(v.cantidad || v.kgNeto || 0); }
// Arma el tablero de un contrato desde sus viajes y liquidaciones imputados.
function _tableroContrato(c, viajes, liqs) {
  const vs = (viajes || []).filter(v => v.estado !== 'anulada');
  const kgPactados = Number(c.tnsPactadas || 0) * 1000;
  let kgSalientes = 0, kgDescargados = 0;
  for (const v of vs) { kgSalientes += _kgCargaViaje(v); kgDescargados += _kgViaje(v); }
  let kgPesificados = 0, montoPesificado = 0, montoCobrado = 0, liqCobradas = 0;
  for (const l of (liqs || [])) {
    kgPesificados += Number(l.kilosNetos || 0);
    montoPesificado += Number(l.neto || 0);
    if (l.cobrado) { liqCobradas++; montoCobrado += Number(l.neto || 0); }
  }
  const kgPendienteEntrega = Math.max(0, kgPactados - kgDescargados);
  const kgPendientePesificar = Math.max(0, kgDescargados - kgPesificados);
  return {
    kgPactados, kgSalientes, kgDescargados, kgPendienteEntrega,
    kgPesificados, kgPendientePesificar, montoPesificado, montoCobrado,
    cantViajes: vs.length, cantLiquidaciones: (liqs || []).length, liqCobradas,
    avanceEntregaPct: kgPactados > 0 ? Math.round((kgDescargados / kgPactados) * 100) : 0,
    avancePesifPct: kgDescargados > 0 ? Math.round((kgPesificados / kgDescargados) * 100) : 0,
    todoEntregado: kgPactados > 0 && kgDescargados >= kgPactados - 1,
    todoPesificado: kgDescargados > 0 && kgPesificados >= kgDescargados - 1,
  };
}

app.get('/api/contratos-cereal', requireCompany, requirePermission('ventas:read'), async (req, res, next) => {
  try {
    const contratos = await prisma.contratoCereal.findMany({ where: { companyId: req.companyId }, orderBy: [{ fecha: 'desc' }, { createdAt: 'desc' }] });
    const ids = contratos.map(c => c.id);
    const [viajes, liqs, depos] = await Promise.all([
      ids.length ? prisma.viaje.findMany({ where: { companyId: req.companyId, contratoCerealId: { in: ids } }, select: { id: true, contratoCerealId: true, estado: true, cantidad: true, kgNeto: true, kgDescarga: true, kgNetoDest: true } }) : [],
      ids.length ? prisma.liquidacionCereal.findMany({ where: { companyId: req.companyId, contratoCerealId: { in: ids } }, select: { id: true, contratoCerealId: true, kilosNetos: true, neto: true, cobrado: true } }) : [],
      prisma.deposito.findMany({ where: { OR: [{ companyId: req.companyId }, { companyId: null, compartido: true }] }, select: { id: true, nombre: true } }),
    ]);
    const depoN = {}; depos.forEach(d => depoN[d.id] = d.nombre);
    const vByC = {}, lByC = {};
    for (const v of viajes) (vByC[v.contratoCerealId] = vByC[v.contratoCerealId] || []).push(v);
    for (const l of liqs) (lByC[l.contratoCerealId] = lByC[l.contratoCerealId] || []).push(l);
    const data = contratos.map(c => ({ ...c, acopioNombreCalc: c.acopioDepositoId ? (depoN[c.acopioDepositoId] || c.acopioNombre) : c.acopioNombre, tablero: _tableroContrato(c, vByC[c.id], lByC[c.id]) }));
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});

app.get('/api/contratos-cereal/:id', requireCompany, requirePermission('ventas:read'), async (req, res, next) => {
  try {
    const c = await prisma.contratoCereal.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!c) return res.status(404).json({ ok: false, error: 'No encontrado' });
    const [viajes, liqs] = await Promise.all([
      prisma.viaje.findMany({ where: { companyId: req.companyId, contratoCerealId: c.id }, orderBy: { fecha: 'desc' } }),
      prisma.liquidacionCereal.findMany({ where: { companyId: req.companyId, contratoCerealId: c.id }, orderBy: { fecha: 'desc' }, include: { deposito: true } }),
    ]);
    res.json({ ok: true, data: { ...c, viajes, liquidaciones: liqs, tablero: _tableroContrato(c, viajes, liqs) } });
  } catch (e) { next(e); }
});

app.post('/api/contratos-cereal', requireCompany, requirePermission('ventas:create'), async (req, res, next) => {
  try {
    const d = contratoCerealSchema.parse(req.body);
    const row = await prisma.contratoCereal.create({ data: { ...d, companyId: req.companyId } });
    res.status(201).json({ ok: true, data: row });
  } catch (e) { next(e); }
});

app.put('/api/contratos-cereal/:id', requireCompany, requirePermission('ventas:update'), async (req, res, next) => {
  try {
    const existing = await prisma.contratoCereal.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    const d = contratoCerealSchema.partial().parse(req.body);
    const row = await prisma.contratoCereal.update({ where: { id: req.params.id }, data: d });
    res.json({ ok: true, data: row });
  } catch (e) { next(e); }
});

app.delete('/api/contratos-cereal/:id', requireCompany, requirePermission('ventas:delete'), async (req, res, next) => {
  try {
    const existing = await prisma.contratoCereal.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    // Desimputamos CP y liquidaciones (no se borran, solo se sueltan) y borramos el contrato.
    await prisma.$transaction(async (tx) => {
      await tx.viaje.updateMany({ where: { companyId: req.companyId, contratoCerealId: existing.id }, data: { contratoCerealId: null } });
      await tx.liquidacionCereal.updateMany({ where: { companyId: req.companyId, contratoCerealId: existing.id }, data: { contratoCerealId: null } });
      await tx.contratoCereal.delete({ where: { id: existing.id } });
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Compromisos de ENTREGA por contrato de cereal (para avisos/alertas y banners).
// Igual que los créditos con pago en cereal, pero mirando cuánto falta ENTREGAR de
// cada contrato y su plazo de entrega. Devuelve solo los que tienen kg pendientes.
app.get('/api/compromisos-contrato-cereal', requireCompany, requirePermission('ventas:read'), async (req, res, next) => {
  try {
    const contratos = await prisma.contratoCereal.findMany({ where: { companyId: req.companyId, estado: { notIn: ['anulado', 'cerrado'] } } });
    const ids = contratos.map(c => c.id);
    const [viajes, liqs] = await Promise.all([
      ids.length ? prisma.viaje.findMany({ where: { companyId: req.companyId, contratoCerealId: { in: ids } }, select: { contratoCerealId: true, estado: true, cantidad: true, kgNeto: true, kgDescarga: true, kgNetoDest: true } }) : [],
      ids.length ? prisma.liquidacionCereal.findMany({ where: { companyId: req.companyId, contratoCerealId: { in: ids } }, select: { contratoCerealId: true, kilosNetos: true, neto: true, cobrado: true } }) : [],
    ]);
    const vByC = {}, lByC = {};
    for (const v of viajes) (vByC[v.contratoCerealId] = vByC[v.contratoCerealId] || []).push(v);
    for (const l of liqs) (lByC[l.contratoCerealId] = lByC[l.contratoCerealId] || []).push(l);
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const data = [];
    for (const c of contratos) {
      const tab = _tableroContrato(c, vByC[c.id], lByC[c.id]);
      if (tab.kgPendienteEntrega <= 0.5) continue;
      const lim = c.plazoEntregaHasta ? new Date(c.plazoEntregaHasta) : null;
      let diasRestantes = null;
      if (lim) { const l0 = new Date(lim); l0.setHours(0, 0, 0, 0); diasRestantes = Math.round((l0 - hoy) / 86400000); }
      data.push({
        contratoId: c.id, numero: c.numeroInterno || c.numeroCorredor || null,
        cereal: c.cereal || null, cosecha: c.cosecha || null,
        acopio: c.acopioNombre || null, comprador: c.compradorNombre || null,
        pendienteKg: tab.kgPendienteEntrega, pendienteTn: Math.round(tab.kgPendienteEntrega / 1000 * 100) / 100,
        fechaLimite: c.plazoEntregaHasta || null,
        vencido: lim ? lim < hoy : false,
        diasRestantes,
      });
    }
    data.sort((a, b) => {
      if (a.fechaLimite && b.fechaLimite) return new Date(a.fechaLimite) - new Date(b.fechaLimite);
      return a.fechaLimite ? -1 : (b.fechaLimite ? 1 : 0);
    });
    const totalPendienteTn = data.reduce((a, x) => a + x.pendienteTn, 0);
    res.json({ ok: true, data, totalPendienteTn });
  } catch (e) { next(e); }
});

// ============================================================
// POSICIÓN DE GRANOS: las ENTREGAS son los VIAJES con Carta de Porte cuyo destino es
// una cerealera (grano guardado) o venta directa. El viaje ya mueve el stock; acá
// llevamos el seguimiento y el vínculo con la(s) liquidación(es). Saldo = entregado - liquidado.
// ============================================================
function _especieMoneda(nombre) {
  const x = _sinAcentos(nombre || '').toUpperCase();
  if (/SOJA/.test(x)) return 'SOJA';
  if (/MAIZ/.test(x)) return 'MAIZ';
  if (/TRIGO/.test(x)) return 'TRIGO';
  if (/SORGO/.test(x)) return 'SORGO';
  if (/GIRASOL/.test(x)) return 'GIRASOL';
  return null;
}
function _kgViaje(v){ return Number(v.kgDescarga || v.kgNetoDest || v.kgNeto || v.cantidad || 0); }
function _cpViaje(v){ return v.cartaPorte || v.cpeNroComprobante || v.cpeNroCtg || null; }
function _viajeEsEntrega(v){ return (v.destinoTipo === 'cerealera' || v.destinoTipo === 'venta_directa') && _kgViaje(v) > 0; }

// Lista de entregas (viajes con CP a cerealera / venta directa) con estado + liquidaciones vinculadas.
app.get('/api/entregas-grano', requireCompany, requirePermission('stock:read'), async (req, res, next) => {
  try {
    const [viajes, links, liqs, depos] = await Promise.all([
      prisma.viaje.findMany({ where: { companyId: req.companyId, destinoTipo: { in: ['cerealera','venta_directa'] }, estado: { not: 'anulada' } }, orderBy: { fecha: 'desc' } }),
      prisma.viajeLiquidacion.findMany({ where: { companyId: req.companyId } }),
      prisma.liquidacionCereal.findMany({ where: { companyId: req.companyId }, select: { id: true, numero: true, neto: true, cobrado: true, kilosNetos: true } }),
      prisma.deposito.findMany({ where: { OR: [{ companyId: req.companyId }, { companyId: null, compartido: true }] }, select: { id: true, nombre: true } }),
    ]);
    const liqById = {}; liqs.forEach(l => liqById[l.id] = l);
    const depoN = {}; depos.forEach(d => depoN[d.id] = d.nombre);
    const linksByV = {}; links.forEach(k => { (linksByV[k.viajeId] = linksByV[k.viajeId] || []).push(k); });
    const data = viajes.filter(_viajeEsEntrega).map(v => {
      const ls = (linksByV[v.id] || []).slice();
      if (v.liquidacionCerealId && !ls.find(k => k.liquidacionId === v.liquidacionCerealId)) ls.push({ liquidacionId: v.liquidacionCerealId, kilosAplicados: 0 });
      const estado = ls.length ? 'liquidada' : 'pendiente';
      return {
        id: v.id, fecha: v.fecha, cpe: _cpViaje(v), especie: v.producto || null,
        destinoTipo: v.destinoTipo, destino: v.destino || null, depositoId: v.depositoDestinoId || null,
        cerealera: v.depositoDestinoId ? (depoN[v.depositoDestinoId] || null) : null,
        kilos: _kgViaje(v), campanaId: v.campanaId || null, estado,
        liquidaciones: ls.map(k => ({ id: k.liquidacionId, numero: liqById[k.liquidacionId]?.numero || null, neto: liqById[k.liquidacionId]?.neto || 0, cobrado: !!liqById[k.liquidacionId]?.cobrado, kilos: liqById[k.liquidacionId]?.kilosNetos || 0 })),
      };
    });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});
// Vincular / desvincular una liquidación con uno o varios viajes (CP).
app.post('/api/posicion-granos/vincular', requireCompany, requirePermission('ventas:update'), async (req, res, next) => {
  try {
    const schema = z.object({ liquidacionId: z.string(), viajeIds: z.array(z.string()).default([]) });
    const d = schema.parse(req.body);
    const liq = await prisma.liquidacionCereal.findFirst({ where: { id: d.liquidacionId, companyId: req.companyId } });
    if (!liq) return res.status(404).json({ ok: false, error: 'Liquidación no encontrada' });
    let n = 0;
    for (const vid of d.viajeIds) {
      const v = await prisma.viaje.findFirst({ where: { id: vid, companyId: req.companyId } });
      if (!v) continue;
      try { await prisma.viajeLiquidacion.create({ data: { companyId: req.companyId, viajeId: vid, liquidacionId: d.liquidacionId, kilosAplicados: _kgViaje(v) } }); n++; } catch {}
      if (!v.liquidacionCerealId) { try { await prisma.viaje.update({ where: { id: vid }, data: { liquidacionCerealId: d.liquidacionId } }); } catch {} }
    }
    res.json({ ok: true, data: { vinculadas: n } });
  } catch (e) { next(e); }
});
app.delete('/api/posicion-granos/vincular', requireCompany, requirePermission('ventas:update'), async (req, res, next) => {
  try {
    const { liquidacionId, viajeId } = req.query;
    if (!liquidacionId || !viajeId) return res.status(400).json({ ok: false, error: 'Faltan parámetros' });
    await prisma.viajeLiquidacion.deleteMany({ where: { companyId: req.companyId, liquidacionId: String(liquidacionId), viajeId: String(viajeId) } });
    await prisma.viaje.updateMany({ where: { id: String(viajeId), companyId: req.companyId, liquidacionCerealId: String(liquidacionId) }, data: { liquidacionCerealId: null } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});
// Tablero de posición: por especie → entregado (viajes), liquidado (liquidaciones), a liquidar + $ pizarra.
app.get('/api/posicion-granos', requireCompany, requirePermission('stock:read'), async (req, res, next) => {
  try {
    const [viajes, liqs, prods] = await Promise.all([
      prisma.viaje.findMany({ where: { companyId: req.companyId, destinoTipo: { in: ['cerealera','venta_directa'] }, estado: { not: 'anulada' } }, select: { producto: true, kgDescarga: true, kgNetoDest: true, kgNeto: true, cantidad: true, destinoTipo: true } }),
      prisma.liquidacionCereal.findMany({ where: { companyId: req.companyId }, select: { productoId: true, kilosNetos: true, neto: true, cobrado: true } }),
      prisma.producto.findMany({ where: { companyId: req.companyId }, select: { id: true, nombre: true } }),
    ]);
    const prodNombre = {}; prods.forEach(p => prodNombre[p.id] = p.nombre);
    const norm = (s) => _sinAcentos(s || '').replace(/\s+/g, ' ').trim().toUpperCase();
    const acc = {};
    const bump = (label) => { const k = norm(label); return acc[k] || (acc[k] = { especie: label || '(sin especie)', entregado: 0, liquidado: 0, aCobrar: 0 }); };
    viajes.forEach(v => { if (!_viajeEsEntrega(v)) return; bump(v.producto).entregado += _kgViaje(v); });
    liqs.forEach(l => { const r = bump(prodNombre[l.productoId] || ''); r.liquidado += Number(l.kilosNetos || 0); if (!l.cobrado) r.aCobrar += Number(l.neto || 0); });
    const monedas = [...new Set(Object.values(acc).map(r => _especieMoneda(r.especie)).filter(Boolean))];
    const precios = {};
    for (const m of monedas) { try { precios[m] = await getCotizacionARS(m, new Date(), req.companyId); } catch { precios[m] = null; } }
    const porEspecie = Object.values(acc).map(r => {
      const mon = _especieMoneda(r.especie);
      const aLiquidar = r.entregado - r.liquidado;
      const precioTn = mon ? (precios[mon] || null) : null;
      return {
        especie: r.especie,
        entregado: Math.round(r.entregado * 1000) / 1000, liquidado: Math.round(r.liquidado * 1000) / 1000,
        aLiquidar: Math.round(aLiquidar * 1000) / 1000, precioTn,
        valorALiquidar: precioTn != null ? Math.round(aLiquidar * precioTn / 1000) : null,
        aCobrar: Math.round(r.aCobrar * 100) / 100,
      };
    }).filter(r => r.entregado || r.liquidado);
    res.json({ ok: true, data: { porEspecie, precios } });
  } catch (e) { next(e); }
});

// ============================================================
// LIQUIDACIÓN DE HACIENDA: entra como VENTA. Por cada renglón descuenta cabezas
// del stock real (movimiento de venta) y, si se pide, del declarado SENASA del
// campo/categoría. Arma la cuenta a cobrar por el neto. No toca el Libro IVA.
// ============================================================
app.get('/api/liquidaciones-hacienda', requireCompany, requirePermission('ventas:read'), async (req, res, next) => {
  try {
    const data = await prisma.liquidacionHacienda.findMany({
      where: { companyId: req.companyId },
      orderBy: { fecha: 'desc' },
      include: { renglones: true, campo: { select: { id: true, nombre: true } } },
    });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});
app.get('/api/liquidaciones-hacienda/:id', requireCompany, requirePermission('ventas:read'), async (req, res, next) => {
  try {
    const data = await prisma.liquidacionHacienda.findFirst({
      where: { id: req.params.id, companyId: req.companyId },
      include: { renglones: true, campo: { select: { id: true, nombre: true } } },
    });
    if (!data) return res.status(404).json({ ok: false, error: 'No encontrada' });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});
// ============================================================
// FAENA: registro editable que enlaza la liquidacion (salida de lechones vivos)
// y la factura de compra (entrada del faenado por kg). El frontend orquesta la
// creacion/edicion de los dos comprobantes (reutiliza sus endpoints) y guarda acá
// el resumen + los IDs para poder listarla y editarla despues.
// ============================================================
const faenaSchema = z.object({
  fecha: z.coerce.date(),
  frigorifico: z.string().nullable().optional(),
  frigorificoCuit: z.string().nullable().optional(),
  tropa: z.string().nullable().optional(),
  campoId: z.string().nullable().optional(),
  categoria: z.string().nullable().optional(),
  cabezas: z.coerce.number().int().nullable().optional(),
  kgVivo: z.coerce.number().nullable().optional(),
  precioKgVivo: z.coerce.number().nullable().optional(),
  ivaVivo: z.coerce.number().nullable().optional(),
  numeroLiq: z.string().nullable().optional(),
  descontarSenasa: z.boolean().optional().default(true),
  producto: z.string().nullable().optional(),
  lechonesEnteros: z.coerce.number().int().nullable().optional(),
  kgFaenado: z.coerce.number().nullable().optional(),
  precioKgFaenado: z.coerce.number().nullable().optional(),
  ivaFaenado: z.coerce.number().nullable().optional(),
  facturaPv: z.coerce.number().int().nullable().optional(),
  facturaNro: z.coerce.number().int().nullable().optional(),
  fechaFactura: z.coerce.date().nullable().optional(),
  depositoId: z.string().nullable().optional(),
  liquidacionId: z.string().nullable().optional(),
  facturaCompraId: z.string().nullable().optional(),
  observaciones: z.string().nullable().optional(),
});
app.get('/api/faena', requireCompany, requirePermission('ventas:read'), async (req, res, next) => {
  try {
    const data = await prisma.faena.findMany({ where: { companyId: req.companyId }, orderBy: { fecha: 'desc' } });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});
app.post('/api/faena', requireCompany, requirePermission('ventas:create'), async (req, res, next) => {
  try {
    const d = faenaSchema.parse(req.body);
    const row = await prisma.faena.create({ data: { ...d, companyId: req.companyId } });
    res.status(201).json({ ok: true, data: row });
  } catch (e) { next(e); }
});
app.put('/api/faena/:id', requireCompany, requirePermission('ventas:update'), async (req, res, next) => {
  try {
    const ex = await prisma.faena.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!ex) return res.status(404).json({ ok: false, error: 'No encontrada' });
    const d = faenaSchema.partial().parse(req.body);
    const row = await prisma.faena.update({ where: { id: ex.id }, data: d });
    res.json({ ok: true, data: row });
  } catch (e) { next(e); }
});
app.delete('/api/faena/:id', requireCompany, requirePermission('ventas:delete'), async (req, res, next) => {
  try {
    const ex = await prisma.faena.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!ex) return res.status(404).json({ ok: false, error: 'No encontrada' });
    await prisma.faena.delete({ where: { id: ex.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post('/api/liquidaciones-hacienda', requireCompany, requirePermission('ventas:create'), async (req, res, next) => {
  try {
    const rengSchema = z.object({
      especie: z.string().nullable().optional(),
      categoria: z.string().min(1),
      categoriaTexto: z.string().nullable().optional(),
      raza: z.string().nullable().optional(),
      tropa: z.string().nullable().optional(),
      cabezas: z.coerce.number().int().min(1),
      kilos: z.coerce.number().nonnegative().default(0),
      precioKg: z.coerce.number().nonnegative().default(0),
      bruto: z.coerce.number().nonnegative().nullable().optional(),
      alicuotaIva: z.coerce.number().nonnegative().default(10.5),
      iva: z.coerce.number().nonnegative().nullable().optional(),
    });
    const schema = z.object({
      campoId: z.string(),
      clienteId: z.string().nullable().optional(),
      fecha: z.coerce.date(),
      numero: z.string().nullable().optional(),
      cae: z.string().nullable().optional(),
      caeVto: z.coerce.date().nullable().optional(),
      emisorNombre: z.string().nullable().optional(),
      emisorCuit: z.string().nullable().optional(),
      receptorNombre: z.string().nullable().optional(),
      receptorCuit: z.string().nullable().optional(),
      gastosTotal: z.coerce.number().default(0),
      ivaGastos: z.coerce.number().default(0),
      neto: z.coerce.number(),
      fechaCobroEst: z.coerce.date().nullable().optional(),
      descontarSenasa: z.boolean().default(true),
      observaciones: z.string().nullable().optional(),
      renglones: z.array(rengSchema).min(1),
    });
    const d = schema.parse(req.body);
    const campo = await _verifyCampo(req, d.campoId);
    if (!campo) return res.status(400).json({ ok: false, error: 'Campo no válido' });

    const rows = d.renglones.map(r => {
      const bruto = (r.bruto != null && r.bruto > 0) ? r.bruto : (r.kilos * r.precioKg);
      const iva = (r.iva != null) ? r.iva : Math.round(bruto * r.alicuotaIva) / 100;
      return { ...r, bruto: Math.round(bruto * 100) / 100, iva: Math.round(iva * 100) / 100 };
    });
    const brutoTotal = rows.reduce((a, r) => a + r.bruto, 0);
    const ivaBruto = rows.reduce((a, r) => a + r.iva, 0);

    const result = await prisma.$transaction(async (tx) => {
      const liq = await tx.liquidacionHacienda.create({
        data: {
          companyId: req.companyId, campoId: d.campoId, clienteId: d.clienteId || null,
          fecha: d.fecha, numero: d.numero || null, cae: d.cae || null, caeVto: d.caeVto || null,
          emisorNombre: d.emisorNombre || null, emisorCuit: d.emisorCuit || null,
          receptorNombre: d.receptorNombre || null, receptorCuit: d.receptorCuit || null,
          brutoTotal: Math.round(brutoTotal * 100) / 100, ivaBruto: Math.round(ivaBruto * 100) / 100,
          gastosTotal: d.gastosTotal || 0, ivaGastos: d.ivaGastos || 0, neto: d.neto,
          fechaCobroEst: d.fechaCobroEst || null, observaciones: d.observaciones || null,
        },
      });
      for (const r of rows) {
        // 1) Movimiento de venta → descuenta el stock REAL (cabezas + kg)
        const mov = await tx.haciendaMovimiento.create({
          data: {
            companyId: req.companyId, campoId: d.campoId, categoria: r.categoria,
            fecha: d.fecha, tipo: 'venta', cantidad: r.cabezas, kilos: r.kilos || null,
            precioKg: r.precioKg || null, total: r.bruto || null, clienteId: d.clienteId || null,
            modoVenta: 'directo', estadoRend: 'cerrada', cobroTipo: 'ninguno',
            facturaRef: `LIQHAC-${liq.id}`,
            observaciones: `Liquidación hacienda ${d.numero || ''}`.trim(),
          },
        });
        await tx.liquidacionHaciendaRenglon.create({
          data: {
            liquidacionId: liq.id, especie: r.especie || null, categoria: r.categoria,
            categoriaTexto: r.categoriaTexto || null, raza: r.raza || null, tropa: r.tropa || null,
            cabezas: r.cabezas, kilos: r.kilos || 0, precioKg: r.precioKg || 0,
            bruto: r.bruto || 0, alicuotaIva: r.alicuotaIva, iva: r.iva || 0, haciendaMovId: mov.id,
          },
        });
        // 2) Descontar el declarado SENASA del campo/categoría
        if (d.descontarSenasa) {
          const st = await tx.haciendaStock.findFirst({ where: { companyId: req.companyId, campoId: d.campoId, categoria: r.categoria } });
          if (st) {
            await tx.haciendaStock.update({ where: { id: st.id }, data: { declarado: Math.max(0, (st.declarado || 0) - r.cabezas) } });
          }
        }
      }
      // 3) Cuenta a cobrar por el neto (si hay cliente)
      if (d.clienteId) {
        await tx.ctaCte.create({
          data: {
            companyId: req.companyId, contactoTipo: 'cliente', contactoId: d.clienteId,
            fecha: d.fecha, detalle: `Liquidación hacienda ${d.numero || ''}`.trim(),
            referencia: `LIQHAC-${liq.id}`, debe: d.neto, haber: 0,
            vencimiento: d.fechaCobroEst || null, categoria: 'liquidacion_hacienda',
          },
        });
      }
      return liq;
    });
    const full = await prisma.liquidacionHacienda.findUnique({ where: { id: result.id }, include: { renglones: true } });
    res.status(201).json({ ok: true, data: full });
  } catch (e) { next(e); }
});
app.put('/api/liquidaciones-hacienda/:id/marcar-cobrado', requireCompany, requirePermission('ventas:update'), async (req, res, next) => {
  try {
    const liq = await prisma.liquidacionHacienda.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!liq) return res.status(404).json({ ok: false, error: 'No encontrada' });
    const row = await prisma.liquidacionHacienda.update({ where: { id: liq.id }, data: { cobrado: !liq.cobrado } });
    res.json({ ok: true, data: row });
  } catch (e) { next(e); }
});
app.delete('/api/liquidaciones-hacienda/:id', requireCompany, requirePermission('ventas:delete'), async (req, res, next) => {
  try {
    const liq = await prisma.liquidacionHacienda.findFirst({ where: { id: req.params.id, companyId: req.companyId }, include: { renglones: true } });
    if (!liq) return res.status(404).json({ ok: false, error: 'No encontrada' });
    await prisma.$transaction(async (tx) => {
      // Revertir: devolver el declarado SENASA y borrar los movimientos de venta.
      for (const r of liq.renglones) {
        const st = await tx.haciendaStock.findFirst({ where: { companyId: req.companyId, campoId: liq.campoId, categoria: r.categoria } });
        if (st) await tx.haciendaStock.update({ where: { id: st.id }, data: { declarado: (st.declarado || 0) + r.cabezas } });
      }
      await tx.haciendaMovimiento.deleteMany({ where: { companyId: req.companyId, facturaRef: `LIQHAC-${liq.id}` } });
      await tx.ctaCte.deleteMany({ where: { companyId: req.companyId, referencia: `LIQHAC-${liq.id}` } });
      await tx.liquidacionHacienda.delete({ where: { id: liq.id } });
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});
// EDITAR una liquidación de animales: revierte todo (stock/SENASA/cta cte) y lo vuelve a
// aplicar con los datos nuevos, manteniendo el mismo id. Se BLOQUEA si ya está cobrada.
app.put('/api/liquidaciones-hacienda/:id', requireCompany, requirePermission('ventas:update'), async (req, res, next) => {
  try {
    const existing = await prisma.liquidacionHacienda.findFirst({ where: { id: req.params.id, companyId: req.companyId }, include: { renglones: true } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrada' });
    if (existing.cobrado) return res.status(400).json({ ok: false, error: 'La liquidación está marcada como cobrada. Deshacé el cobro (Marcar como no cobrada) antes de editarla.' });
    const rengSchema = z.object({
      especie: z.string().nullable().optional(), categoria: z.string().min(1),
      categoriaTexto: z.string().nullable().optional(), raza: z.string().nullable().optional(),
      tropa: z.string().nullable().optional(), cabezas: z.coerce.number().int().min(1),
      kilos: z.coerce.number().nonnegative().default(0), precioKg: z.coerce.number().nonnegative().default(0),
      bruto: z.coerce.number().nonnegative().nullable().optional(), alicuotaIva: z.coerce.number().nonnegative().default(10.5),
      iva: z.coerce.number().nonnegative().nullable().optional(),
    });
    const schema = z.object({
      campoId: z.string(), clienteId: z.string().nullable().optional(), fecha: z.coerce.date(),
      numero: z.string().nullable().optional(), cae: z.string().nullable().optional(), caeVto: z.coerce.date().nullable().optional(),
      emisorNombre: z.string().nullable().optional(), emisorCuit: z.string().nullable().optional(),
      receptorNombre: z.string().nullable().optional(), receptorCuit: z.string().nullable().optional(),
      gastosTotal: z.coerce.number().default(0), ivaGastos: z.coerce.number().default(0), neto: z.coerce.number(),
      fechaCobroEst: z.coerce.date().nullable().optional(), descontarSenasa: z.boolean().default(true),
      observaciones: z.string().nullable().optional(), renglones: z.array(rengSchema).min(1),
    });
    const d = schema.parse(req.body);
    const campo = await _verifyCampo(req, d.campoId);
    if (!campo) return res.status(400).json({ ok: false, error: 'Campo no válido' });
    const rows = d.renglones.map(r => {
      const bruto = (r.bruto != null && r.bruto > 0) ? r.bruto : (r.kilos * r.precioKg);
      const iva = (r.iva != null) ? r.iva : Math.round(bruto * r.alicuotaIva) / 100;
      return { ...r, bruto: Math.round(bruto * 100) / 100, iva: Math.round(iva * 100) / 100 };
    });
    const brutoTotal = rows.reduce((a, r) => a + r.bruto, 0);
    const ivaBruto = rows.reduce((a, r) => a + r.iva, 0);
    await prisma.$transaction(async (tx) => {
      // 1) REVERTIR lo anterior
      for (const r of existing.renglones) {
        const st = await tx.haciendaStock.findFirst({ where: { companyId: req.companyId, campoId: existing.campoId, categoria: r.categoria } });
        if (st) await tx.haciendaStock.update({ where: { id: st.id }, data: { declarado: (st.declarado || 0) + r.cabezas } });
      }
      await tx.haciendaMovimiento.deleteMany({ where: { companyId: req.companyId, facturaRef: `LIQHAC-${existing.id}` } });
      await tx.ctaCte.deleteMany({ where: { companyId: req.companyId, referencia: `LIQHAC-${existing.id}` } });
      await tx.liquidacionHaciendaRenglon.deleteMany({ where: { liquidacionId: existing.id } });
      // 2) ACTUALIZAR cabecera
      await tx.liquidacionHacienda.update({ where: { id: existing.id }, data: {
        campoId: d.campoId, clienteId: d.clienteId || null, fecha: d.fecha, numero: d.numero || null,
        cae: d.cae || null, caeVto: d.caeVto || null, emisorNombre: d.emisorNombre || null, emisorCuit: d.emisorCuit || null,
        receptorNombre: d.receptorNombre || null, receptorCuit: d.receptorCuit || null,
        brutoTotal: Math.round(brutoTotal * 100) / 100, ivaBruto: Math.round(ivaBruto * 100) / 100,
        gastosTotal: d.gastosTotal || 0, ivaGastos: d.ivaGastos || 0, neto: d.neto,
        fechaCobroEst: d.fechaCobroEst || null, observaciones: d.observaciones || null,
      }});
      // 3) REAPLICAR con los datos nuevos
      for (const r of rows) {
        const mov = await tx.haciendaMovimiento.create({ data: {
          companyId: req.companyId, campoId: d.campoId, categoria: r.categoria, fecha: d.fecha, tipo: 'venta',
          cantidad: r.cabezas, kilos: r.kilos || null, precioKg: r.precioKg || null, total: r.bruto || null,
          clienteId: d.clienteId || null, modoVenta: 'directo', estadoRend: 'cerrada', cobroTipo: 'ninguno',
          facturaRef: `LIQHAC-${existing.id}`, observaciones: `Liquidación animales ${d.numero || ''}`.trim(),
        }});
        await tx.liquidacionHaciendaRenglon.create({ data: {
          liquidacionId: existing.id, especie: r.especie || null, categoria: r.categoria,
          categoriaTexto: r.categoriaTexto || null, raza: r.raza || null, tropa: r.tropa || null,
          cabezas: r.cabezas, kilos: r.kilos || 0, precioKg: r.precioKg || 0,
          bruto: r.bruto || 0, alicuotaIva: r.alicuotaIva, iva: r.iva || 0, haciendaMovId: mov.id,
        }});
        if (d.descontarSenasa) {
          const st = await tx.haciendaStock.findFirst({ where: { companyId: req.companyId, campoId: d.campoId, categoria: r.categoria } });
          if (st) await tx.haciendaStock.update({ where: { id: st.id }, data: { declarado: Math.max(0, (st.declarado || 0) - r.cabezas) } });
        }
      }
      if (d.clienteId) {
        await tx.ctaCte.create({ data: {
          companyId: req.companyId, contactoTipo: 'cliente', contactoId: d.clienteId, fecha: d.fecha,
          detalle: `Liquidación animales ${d.numero || ''}`.trim(), referencia: `LIQHAC-${existing.id}`,
          debe: d.neto, haber: 0, vencimiento: d.fechaCobroEst || null, categoria: 'liquidacion_hacienda',
        }});
      }
    });
    const full = await prisma.liquidacionHacienda.findUnique({ where: { id: existing.id }, include: { renglones: true } });
    res.json({ ok: true, data: full });
  } catch (e) { next(e); }
});

// ============================================================
// MENSAJERÍA INTERNA + ASISTENTE DE CARGA
// Chat de equipo (canal general) + asistente que interpreta frases y carga.
// ============================================================
const _permOk = (req, p) => req.user?.superAdmin || hasPermission(req.membership?.role?.permissions || [], p);
const _sinAcentos = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const _nombreUser = (u) => [u?.nombre, u?.apellido].filter(Boolean).join(' ') || u?.alias || u?.email || 'Usuario';

// Contexto (campos + categorías + lotes + campañas) para interpretar.
async function _ctxAsistente(companyId) {
  const [campos, catHac, lotes, campanas, catGasto, efectivos] = await Promise.all([
    prisma.campo.findMany({ where: { companyId }, select: { id: true, nombre: true } }),
    prisma.categoriaHaciendaConfig.findMany({ where: { companyId }, select: { nombre: true } }).catch(() => []),
    prisma.lote.findMany({ where: { campo: { companyId } }, select: { id: true, nombre: true, campoId: true } }).catch(() => []),
    prisma.campana.findMany({ where: { companyId }, select: { id: true, loteId: true, cultivo: true, ciclo: true, fechaSiembra: true, createdAt: true } }).catch(() => []),
    prisma.categoriaGasto.findMany({ where: { companyId }, select: { id: true, nombre: true, padreId: true } }).catch(() => []),
    prisma.efectivo.findMany({ where: { companyId, caja: { not: null } }, select: { caja: true }, distinct: ['caja'], take: 50 }).catch(() => []),
  ]);
  const [proveedores, clientes, bancos] = await Promise.all([
    prisma.proveedor.findMany({ where: { companyId, activo: { not: false } }, select: { id: true, razonSocial: true, nombreFantasia: true } }).catch(() => []),
    prisma.cliente.findMany({ where: { companyId, activo: { not: false } }, select: { id: true, razonSocial: true, nombreFantasia: true } }).catch(() => []),
    prisma.bancoCuenta.findMany({ where: { companyId, activo: { not: false } }, select: { id: true, banco: true, alias: true } }).catch(() => []),
  ]);
  const cajas = [...new Set((efectivos || []).map(e => (e.caja || '').trim()).filter(Boolean))];
  return { campos, categorias: (catHac || []).map(c => c.nombre).filter(Boolean), lotes: lotes || [], campanas: campanas || [], categoriasGasto: catGasto || [], cajas, proveedores: proveedores || [], clientes: clientes || [], bancos: bancos || [] };
}
// Empresas a las que el usuario tiene acceso (para el bot general multi-empresa).
async function _empresasDeUsuario(req) {
  if (req.user?.superAdmin) {
    const all = await prisma.company.findMany({ where: { activo: { not: false } }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    return all.map(c => ({ id: c.id, name: c.name }));
  }
  return (req.user?.userCompanies || []).map(uc => ({ id: uc.companyId, name: uc.company?.name || 'Empresa' }));
}
// Contexto del asistente COMBINADO de varias empresas: cada entidad-objeto queda
// etiquetada con _cid/_cnombre para saber de qué empresa es (y decidir dónde cargar).
async function _ctxAsistenteMulti(companies) {
  const base = { campos: [], categorias: [], lotes: [], campanas: [], categoriasGasto: [], cajas: [], proveedores: [], clientes: [], bancos: [] };
  for (const co of companies) {
    let c; try { c = await _ctxAsistente(co.id); } catch { continue; }
    const tag = (arr) => (arr || []).map(x => (x && typeof x === 'object') ? { ...x, _cid: co.id, _cnombre: co.name } : x);
    base.campos.push(...tag(c.campos));
    base.lotes.push(...tag(c.lotes));
    base.campanas.push(...tag(c.campanas));
    base.proveedores.push(...tag(c.proveedores));
    base.clientes.push(...tag(c.clientes));
    base.bancos.push(...tag(c.bancos));
    base.categoriasGasto.push(...tag(c.categoriasGasto));
    for (const s of (c.categorias || [])) if (!base.categorias.includes(s)) base.categorias.push(s);
    for (const s of (c.cajas || [])) if (!base.cajas.includes(s)) base.cajas.push(s);
  }
  return base;
}
// Dada una acción interpretada, deduce a qué empresa pertenece (por la entidad matcheada).
// Devuelve companyId o null (null = ambiguo → hay que preguntar, ej: gasto/recordatorio).
function _cidDeAccion(r, ctx) {
  if (!r || !r.params) return null;
  const byId = (arr, id) => (arr || []).find(x => x && x.id === id);
  if (r.accion === 'hacienda_mov' && r.params.campoId) return byId(ctx.campos, r.params.campoId)?._cid || null;
  if (r.accion === 'labor' && r.params.campanaId) return byId(ctx.campanas, r.params.campanaId)?._cid || null;
  if ((r.accion === 'pago' || r.accion === 'cobro') && r.params.contactoId) {
    const arr = r.accion === 'cobro' ? ctx.clientes : ctx.proveedores;
    return byId(arr, r.params.contactoId)?._cid || null;
  }
  return null;
}
// CONSULTAS de solo lectura (stock, animales, lotes, campañas). Devuelve texto o null.
// req: para chequear permisos — la info sensible (plata) no se muestra sin finanzas:read.
async function _consultaAsistente(texto, companyId, ctx, req) {
  const t = _sinAcentos(texto);
  const _puede = (p) => !req || req.user?.superAdmin || _permOk(req, p);
  const puedeFin = _puede('finanzas:read');
  const puedeStock = _puede('stock:read');
  const puedeProd = _puede('produccion:read');
  const _sinPermiso = (que) => `🔒 Con tu usuario no puedo mostrarte ${que}. Pedile a un administrador que te dé el permiso.`;
  // Si es un comando de carga, no es una consulta: que lo maneje otro. (No excluimos "como"
  // para que "¿cómo estoy?" / "¿cómo ando?" caigan en el estado patrimonial de abajo.)
  if (/\b(crear|cargar|carga|cargo|nueva|nuevo|agregar|dar de alta|anota|recorda|acorda)\b/.test(t)) return null;
  // --- CONSULTAS FINANCIERAS: a cobrar / a pagar / estado patrimonial / plata en caja ---
  const _fmtAr = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
  const _factorARS = async (moneda, cot) => moneda === 'ARS' || !moneda ? 1 : (Number(cot) || (await getCotizacionARS(moneda, new Date(), companyId)) || 0);
  const _saldoCtaCte = async (contactoTipo) => {
    const rows = await prisma.ctaCte.findMany({ where: { companyId, contactoTipo }, select: { debe: true, haber: true, moneda: true, cotizacion: true } });
    let ars = 0; const otras = {};
    for (const r of rows) {
      const neto = (Number(r.debe || 0) - Number(r.haber || 0)) * (contactoTipo === 'proveedor' ? -1 : 1);
      const mon = r.moneda || 'ARS';
      if (mon === 'ARS') ars += neto;
      else { const f = await _factorARS(mon, r.cotizacion); if (f) ars += neto * f; otras[mon] = (otras[mon] || 0) + neto; }
    }
    return { ars, otras };
  };
  const _plataCaja = async () => {
    const ef = await prisma.efectivo.findMany({ where: { companyId }, select: { tipo: true, monto: true } });
    return ef.reduce((a, e) => a + (e.tipo === 'ingreso' ? 1 : e.tipo === 'egreso' ? -1 : 0) * Number(e.monto || 0), 0);
  };
  if (/\b(a cobrar|me deben|por cobrar|cuentas a cobrar|cta cte cliente)\b/.test(t)) {
    if (!puedeFin) return _sinPermiso('la información de cuentas a cobrar');
    const s = await _saldoCtaCte('cliente');
    const ex = Object.entries(s.otras).filter(([, n]) => Math.abs(n) > 0.01).map(([m, n]) => `${Math.round(n).toLocaleString('es-AR')} ${m}`);
    return `💰 Te deben (a cobrar): ${_fmtAr(s.ars)}${ex.length ? ` · incluye ${ex.join(', ')}` : ''}. Lo ves en Cuentas a cobrar.`;
  }
  if (/\b(a pagar|debo|por pagar|cuentas a pagar|le debo|les debo)\b/.test(t)) {
    if (!puedeFin) return _sinPermiso('la información de cuentas a pagar');
    const s = await _saldoCtaCte('proveedor');
    const ex = Object.entries(s.otras).filter(([, n]) => Math.abs(n) > 0.01).map(([m, n]) => `${Math.round(n).toLocaleString('es-AR')} ${m}`);
    return `📤 Debés (a pagar): ${_fmtAr(s.ars)}${ex.length ? ` · incluye ${ex.join(', ')}` : ''}. Lo ves en Cuentas a pagar.`;
  }
  if (/\b(estado patrimonial|patrimonio|como estoy|como ando|situacion|resumen financiero|como voy)\b/.test(t)) {
    if (!puedeFin) return _sinPermiso('el estado patrimonial');
    const [cob, pag, caja] = [await _saldoCtaCte('cliente'), await _saldoCtaCte('proveedor'), await _plataCaja()];
    const neto = caja + cob.ars - pag.ars;
    return `📊 Estado (aprox., en pesos):\n• Plata en caja: ${_fmtAr(caja)}\n• A cobrar: ${_fmtAr(cob.ars)}\n• A pagar: ${_fmtAr(pag.ars)}\n• Neto estimado: ${_fmtAr(neto)}\n(No incluye bancos ni el valor del stock/hacienda. Para el detalle: Dashboard y Estado de situación.)`;
  }
  if (/\b(plata en caja|efectivo|cuanta plata|caja|en la caja)\b/.test(t) && !/cobrar|pagar/.test(t)) {
    if (!puedeFin) return _sinPermiso('la plata en caja');
    const caja = await _plataCaja();
    return `💵 Plata en caja (efectivo): ${_fmtAr(caja)}. Lo ves en Control de efectivo.`;
  }
  // --- CEREAL: a liquidar / comprometido a entregar ---
  if (/\b(cereal|grano|granos|soja|maiz|maíz|trigo|sorgo|girasol)\b/.test(t) && /\b(comprometid|entregar|liquidar|a liquidar|posicion|posición|falta)\b/.test(t)) {
    const [viajes, liqs, prods] = await Promise.all([
      prisma.viaje.findMany({ where: { companyId, destinoTipo: { in: ['cerealera', 'venta_directa'] }, estado: { not: 'anulada' } }, select: { producto: true, kgDescarga: true, kgNetoDest: true, kgNeto: true, cantidad: true } }),
      prisma.liquidacionCereal.findMany({ where: { companyId }, select: { productoId: true, kilosNetos: true } }),
      prisma.producto.findMany({ where: { companyId }, select: { id: true, nombre: true } }),
    ]);
    const pn = {}; prods.forEach(p => pn[p.id] = p.nombre);
    const nrm = (s) => _sinAcentos(s || '').replace(/\s+/g, ' ').trim().toUpperCase();
    const acc = {};
    viajes.forEach(v => { const k = nrm(v.producto); if (!k) return; (acc[k] = acc[k] || { nombre: v.producto, ent: 0, liq: 0 }).ent += Number(v.kgDescarga || v.kgNetoDest || v.kgNeto || v.cantidad || 0); });
    liqs.forEach(l => { const k = nrm(pn[l.productoId]); if (!k) return; (acc[k] = acc[k] || { nombre: pn[l.productoId], ent: 0, liq: 0 }).liq += Number(l.kilosNetos || 0); });
    const items = Object.values(acc).map(r => ({ ...r, aliq: r.ent - r.liq })).filter(r => Math.abs(r.aliq) > 1);
    if (!items.length) return 'No tenés grano pendiente de liquidar según los viajes y liquidaciones cargados.';
    const total = items.reduce((a, r) => a + r.aliq, 0);
    return `🌾 A liquidar (entregado sin liquidar): ${items.map(r => `${Math.round(r.aliq).toLocaleString('es-AR')} kg de ${r.nombre}`).join(' · ')}. Total: ${Math.round(total).toLocaleString('es-AR')} kg. Detalle en Posición de granos.`;
  }
  const esConsulta = /\b(cuanto|cuanta|cuantos|cuantas|stock|mostrame|mostra|listame|lista|decime|hay|tengo|ver|consulta|cuales|queda|quedan|existencia|rodeo)\b/.test(t) || /\?/.test(t);
  if (!esConsulta) return null;
  let campo = ctx.campos.find(c => c.nombre && t.includes(_sinAcentos(c.nombre)));

  // --- CAMPOS --- ("cuántos campos tengo")
  if (/\bcampos?\b/.test(t) && !/\b(campan|lote|animal|hacienda|prueba)\b/.test(t)) {
    const cs = ctx.campos || [];
    if (!cs.length) return 'No tenés campos cargados. Cargalos en "Campos y lotes".';
    return `🌾 Tenés ${cs.length} campo${cs.length === 1 ? '' : 's'}: ${cs.map(c => c.nombre).join(', ')}.`;
  }
  // --- LOTES --- (no si preguntan por animales "del lote X")
  if (/\blotes?\b/.test(t) && !/\b(animal|animales|hacienda|vacas?|novillos?|terneros?|toros?|cabezas?|rodeo)\b/.test(t)) {
    let lotes = ctx.lotes; if (campo) lotes = lotes.filter(l => l.campoId === campo.id);
    if (!lotes.length) return `No tengo lotes cargados${campo ? ` en ${campo.nombre}` : ''}. Cargalos en "Campos y lotes".`;
    return `🗺️ ${lotes.length} lote${lotes.length === 1 ? '' : 's'}${campo ? ` en ${campo.nombre}` : ''}: ${lotes.map(l => l.nombre).join(', ')}.`;
  }
  // --- CAMPAÑAS ---
  if (/\bcampan/.test(t)) {
    const camps = ctx.campanas;
    if (!camps.length) return 'No tenés campañas cargadas todavía. Creá una en "Campañas".';
    const lista = camps.slice(0, 20).map(c => { const lote = ctx.lotes.find(l => l.id === c.loteId); return `${c.cultivo || 'campaña'}${c.ciclo ? ' ' + c.ciclo : ''}${lote ? ' (lote ' + lote.nombre + ')' : ''}`; }).join('; ');
    return `🌱 ${camps.length} campaña${camps.length === 1 ? '' : 's'}: ${lista}.`;
  }
  // --- STOCK de un producto ---
  if (/\bstock\b/.test(t) || (/\b(cuanto|cuanta|cuantos|cuantas|queda|quedan)\b/.test(t) && /\bde\b/.test(t) && !/\banimal|hacienda|vaca|novillo|ternero|toro|cabeza/.test(t))) {
    const m = texto.match(/\bde\s+([A-Za-zÁÉÍÓÚÑ0-9\s]+?)[\?\.!]*$/i);
    let termino = m ? m[1].trim().replace(/\b(stock|producto|insumo|queda|quedan)\b/gi, '').trim() : null;
    if (!termino) return null; // sin producto puntual → que responda la ayuda del manual
    const tnorm = _sinAcentos(termino);
    const prods = await prisma.producto.findMany({ where: { companyId, activo: true }, select: { id: true, nombre: true, unidad: true, categoria: true, categoriaHacienda: true } });
    const match = prods.filter(p => { const pn = _sinAcentos(p.nombre); return pn.includes(tnorm) || tnorm.includes(pn); });
    if (!match.length) return `No encontré un producto que se llame "${termino}". Fijate el nombre exacto en Stock.`;
    const answers = [];
    for (const p of match.slice(0, 6)) {
      let ex = 0;
      if ((p.categoria || '').toLowerCase() === 'hacienda') {
        const hmovs = await prisma.haciendaMovimiento.findMany({ where: { companyId }, select: { tipo: true, cantidad: true, categoria: true, categoriaDestino: true } });
        const cat = p.categoriaHacienda || p.nombre;
        hmovs.forEach(mv => { if (mv.tipo === 'cambio_categoria') { if (mv.categoria === cat) ex -= Number(mv.cantidad || 0); if ((mv.categoriaDestino || mv.categoria) === cat) ex += Number(mv.cantidad || 0); return; } if (mv.categoria !== cat) return; ex += (['nacimiento', 'compra', 'traslado_in', 'ajuste'].includes(mv.tipo) ? 1 : -1) * Number(mv.cantidad || 0); });
      } else {
        const g = await prisma.movimiento.groupBy({ by: ['tipo'], where: { companyId, productoId: p.id }, _sum: { cantidad: true } });
        const ing = g.find(x => x.tipo === 'ingreso')?._sum?.cantidad || 0;
        const egr = g.find(x => x.tipo === 'egreso')?._sum?.cantidad || 0;
        ex = Number(ing) - Number(egr);
      }
      answers.push(`${Math.round(ex * 100) / 100} ${p.unidad || 'u'} de ${p.nombre}`);
    }
    return `📦 Stock: ${answers.join(' · ')}.`;
  }
  // --- ANIMALES / HACIENDA ---
  if (/\b(animal|animales|hacienda|vacas?|novillos?|terneros?|vaquillon|toros?|cabezas?|rodeo)\b/.test(t)) {
    const where = { companyId }; if (campo) where.campoId = campo.id;
    const hmovs = await prisma.haciendaMovimiento.findMany({ where, select: { tipo: true, cantidad: true, categoria: true, categoriaDestino: true } });
    if (!hmovs.length) return `No tengo movimientos de animales cargados${campo ? ` en ${campo.nombre}` : ''}.`;
    const byCat = {};
    hmovs.forEach(mv => { if (mv.tipo === 'cambio_categoria') { byCat[mv.categoria] = (byCat[mv.categoria] || 0) - Number(mv.cantidad || 0); const d = mv.categoriaDestino || mv.categoria; byCat[d] = (byCat[d] || 0) + Number(mv.cantidad || 0); return; } const s = ['nacimiento', 'compra', 'traslado_in', 'ajuste'].includes(mv.tipo) ? 1 : -1; byCat[mv.categoria] = (byCat[mv.categoria] || 0) + s * Number(mv.cantidad || 0); });
    const items = Object.entries(byCat).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    const total = items.reduce((a, [, n]) => a + n, 0);
    if (!total) return `No hay animales en existencia${campo ? ` en ${campo.nombre}` : ''} según los movimientos cargados.`;
    return `🐄 ${campo ? `En ${campo.nombre} hay` : 'En total hay'} ${total} animal${total === 1 ? '' : 'es'}: ${items.map(([c, n]) => `${n} ${c}`).join(', ')}.`;
  }
  return null;
}
// Parsea un monto en pesos de una frase: "5000", "$5.000", "5 mil", "5.000,50", "5000 pesos".
function _parseMontoPesos(texto) {
  const t = _sinAcentos(String(texto || '')).toLowerCase();
  const mil = t.match(/(\d+(?:[.,]\d+)?)\s*mil\b/);
  if (mil) return Math.round(parseFloat(mil[1].replace(/\./g, '').replace(',', '.')) * 1000);
  const cands = [];
  const re = /(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)/g;
  let m;
  while ((m = re.exec(t))) {
    const raw = m[1];
    const val = parseFloat(raw.replace(/\./g, '').replace(',', '.'));
    if (!isNaN(val) && val > 0) {
      const antes = t.slice(Math.max(0, m.index - 2), m.index);
      const despues = t.slice(m.index + raw.length, m.index + raw.length + 12);
      const ctxDinero = /\$/.test(antes) || /\s*(pes|mango|luca|\$)/.test(despues);
      cands.push({ val, ctxDinero });
    }
  }
  if (!cands.length) return null;
  const conCtx = cands.find(c => c.ctxDinero);
  return Math.round((conCtx || cands.sort((a, b) => b.val - a.val)[0]).val);
}
// Extrae un concepto de un gasto: "fui a la panaderia" -> Panaderia; "gaste X en nafta" -> Nafta.
function _parseConceptoGasto(texto) {
  const t = ' ' + String(texto || '').trim() + ' ';
  const limpiar = (s) => (s || '')
    .replace(/\b(pesos?|mil|mangos?|lucas?|hoy|ayer|recien|hace un rato|un rato)\b/gi, '')
    .replace(/\$?\s*\d[\d.,]*/g, '')
    .replace(/\s{2,}/g, ' ').replace(/[.,;]+$/, '').trim();
  let m = t.match(/\bfui\s+a\s+(?:el|la|los|las)?\s*([a-záéíóúñ0-9 ]{3,40}?)(?:\s+(?:y|,|\.|por|para|con)|\s*$)/i)
    || t.match(/\b(?:en|de|para)\s+(?:el|la|los|las|un|una)?\s*([a-záéíóúñ0-9 ]{3,40}?)(?:\s+(?:por|y|,|\.|gaste|gasto|pague|pagamos|abone)|\s*$)/i)
    || t.match(/\bcompr(?:e|amos|é|o)\s+(?:el|la|los|las|un|una|unos|unas)?\s*([a-záéíóúñ0-9 ]{3,40}?)(?:\s+(?:por|en|a|y|,|\.)|\s*$)/i);
  let c = limpiar(m ? m[1] : '');
  if (!c || c.length < 2) c = 'Gasto vario';
  return c.charAt(0).toUpperCase() + c.slice(1);
}
// Intenta encontrar una categoría de gasto (raíz o familia) nombrada en la frase.
function _matchCategoriaGasto(texto, ctx) {
  const t = _sinAcentos(texto);
  const cats = ctx.categoriasGasto || [];
  const byId = {}; cats.forEach(c => byId[c.id] = c);
  const hit = cats.find(c => c.nombre && t.includes(_sinAcentos(c.nombre)) && _sinAcentos(c.nombre).length >= 4);
  if (!hit) return null;
  if (hit.padreId && byId[hit.padreId]) return `${byId[hit.padreId].nombre} / ${hit.nombre}`;
  return hit.nombre;
}
// Intérprete por reglas (sin IA). Devuelve { accion, params, resumen } o { error }.
function _interpretarMensaje(texto, ctx) {
  const t = _sinAcentos(texto);
  const nMatch = t.match(/\b(\d+)\b/);
  const numero = nMatch ? parseInt(nMatch[1], 10) : null;
  let campo = ctx.campos.find(c => c.nombre && t.includes(_sinAcentos(c.nombre)));
  if (!campo && ctx.campos.length === 1) campo = ctx.campos[0];
  // Recordatorio / agenda
  if (/\b(recorda|recordar|recordame|acorda|acordate|avisa|avisame|recuerda|agenda|agendar)\b/.test(t)) {
    let fecha = new Date(); fecha.setHours(9, 0, 0, 0);
    if (/manana/.test(t)) fecha.setDate(fecha.getDate() + 1);
    const dm = t.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
    if (dm) { let y = dm[3] ? parseInt(dm[3], 10) : fecha.getFullYear(); if (y < 100) y += 2000; fecha = new Date(y, parseInt(dm[2], 10) - 1, parseInt(dm[1], 10), 9, 0, 0); }
    let titulo = texto.replace(/^\s*(recorda(r|me|te)?|acorda(r|te)?|avisa(r|me)?|recuerda|agenda(r)?)\s*/i, '')
      .replace(/\bel\b|\bla\b|\bpara\b|\bque\b/gi, ' ')
      .replace(/\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?/g, '')
      .replace(/\bmanana\b|\bmañana\b|\bhoy\b/gi, '').replace(/\s{2,}/g, ' ').trim();
    if (!titulo) titulo = texto.trim();
    return { accion: 'recordatorio', params: { titulo, fecha: fecha.toISOString() },
      resumen: `📅 Recordatorio: "${titulo}" para el ${fecha.toLocaleDateString('es-AR')}` };
  }
  // --- PAGO A PROVEEDOR / COBRO A CLIENTE (a cuenta) ---
  // Solo si el nombre del contacto (proveedor/cliente) aparece en la frase; si no,
  // se cae a Gasto/Ingreso simple (ej: "pagué la luz").
  {
    const esPagoV = /\b(pagar|pagale|pagales|pague|pagamos|abonar|abonale|abone|le pague|les pague)\b/.test(t);
    const esCobroV = /\b(cobrar|cobrale|cobre|cobramos|me pagaron|me pago|recibi de|recibimos de)\b/.test(t);
    if (esPagoV || esCobroV) {
      const lista = esCobroV && !esPagoV ? (ctx.clientes || []) : (ctx.proveedores || []);
      const nrm = (s) => _sinAcentos(s || '');
      const toks = t.split(/[^a-z0-9]+/).filter(w => w.length >= 4);
      const match = lista.find(c => { const rs = nrm(c.razonSocial); return rs && (t.includes(rs) || nrm(c.nombreFantasia).length >= 4 && t.includes(nrm(c.nombreFantasia))); })
        || lista.find(c => { const words = (nrm(c.razonSocial).split(/\s+/).filter(w => w.length >= 5)); return words.some(w => toks.includes(w)); });
      if (match) {
        const accion = (esCobroV && !esPagoV) ? 'cobro' : 'pago';
        const monto = _parseMontoPesos(texto);
        const base = { accion, contactoId: match.id, contactoNombre: match.razonSocial, monto: monto || null, metodo: 'efectivo', caja: null, bancoCuentaId: null };
        if (!monto || monto <= 0) {
          return { accion, faltante: 'monto', params: base, pregunta: `¿De cuánto es ${accion === 'cobro' ? 'el cobro de' : 'el pago a'} ${match.razonSocial}? Decime el monto en pesos.` };
        }
        return { accion, params: base, resumen: `${accion === 'cobro' ? '💰 Cobro de' : '📤 Pago a'} ${match.razonSocial}: $${monto.toLocaleString('es-AR')} (a cuenta)` };
      }
    }
  }
  // --- GASTO / PAGO DIARIO (movimiento de caja) ---
  // Verbos de gasto. "compr..." solo cuenta como gasto si NO menciona una categoría de animal
  // (así "compré 5 vacas" sigue yendo a hacienda y "compré pan por 5000" es un gasto).
  {
    const hayAnimal = (ctx.categorias || []).some(c => t.includes(_sinAcentos(c)))
      || /\b(vaca|vacas|novillo|ternero|ternera|toro|vaquillona|cabeza|cabezas|hacienda|animal|animales)\b/.test(t);
    const esGasto = /\b(gaste|gastamos|gasto|gastar|pague|pagamos|page|pagar|abone|abonamos|desembolse)\b/.test(t)
      || (/\bcompr(e|amos|é|o|ar)?\b/.test(t) && !hayAnimal);
    const esIngreso = /\b(cobre|cobramos|cobrar|ingrese|ingresamos|entro|entraron|me pagaron|recibi|recibimos)\b/.test(t);
    if ((esGasto || esIngreso) && !/\?/.test(texto)) {
      const monto = _parseMontoPesos(texto);
      const concepto = _parseConceptoGasto(texto);
      const categoria = _matchCategoriaGasto(texto, ctx);
      const clasif = /\b(personal|propio|mio|mia|dueno|casa|familia)\b/.test(t) ? 'propio' : 'empresa';
      const tipoMov = esIngreso && !esGasto ? 'ingreso' : 'egreso';
      const base = { tipo: tipoMov, monto: monto || null, concepto, categoria: categoria || null, clasificacion: clasif, metodo: 'efectivo', caja: null };
      if (!monto || monto <= 0) {
        // Falta el monto: pedimos ese dato (conversación de varios turnos).
        return { accion: 'gasto', faltante: 'monto', params: base,
          pregunta: `Dale 👍. ¿De cuánto fue ${tipoMov === 'ingreso' ? 'el ingreso' : 'el gasto'}? Decime el monto en pesos (ej: 5000).` };
      }
      const signo = tipoMov === 'ingreso' ? '💰 Ingreso' : '💸 Gasto';
      return { accion: 'gasto', params: base,
        resumen: `${signo} diario: $${monto.toLocaleString('es-AR')} · ${concepto}${categoria ? ` · ${categoria}` : ''}${clasif === 'propio' ? ' · 👤 personal' : ''}` };
    }
  }
  // Animales: nacimiento / muerte / compra
  let tipo = null;
  if (/\bnaci|\bpari|\bnacieron|\bnacio|\bparieron|\bpario/.test(t)) tipo = 'nacimiento';
  else if (/\bmuri|\bmuert|\bmurio|\bmurieron|\bperdi|\bperdieron/.test(t)) tipo = 'muerte';
  else if (/\bcompr/.test(t)) tipo = 'compra';
  if (tipo) {
    const cat = ctx.categorias.find(c => t.includes(_sinAcentos(c)))
      || ctx.categorias.find(c => t.includes(_sinAcentos(c).replace(/a$|o$/, '')));
    if (!numero) return { error: 'No entendí la cantidad. Ej: "nacieron 5 terneros en Montenegro".' };
    if (!cat) return { error: `No reconocí la categoría de animal. Las que tenés: ${ctx.categorias.join(', ') || '(cargá categorías de animales primero)'}.` };
    if (!campo) return { error: 'No reconocí el campo. Decí en qué campo, ej: "en Montenegro".' };
    const lbl = tipo === 'nacimiento' ? 'Nacimiento' : tipo === 'muerte' ? 'Muerte' : 'Compra';
    const params = { campoId: campo.id, campoNombre: campo.nombre, categoria: cat, tipo, cantidad: numero };
    // En compras: intentar capturar kg por cabeza y precio por kg.
    if (tipo === 'compra') {
      const kgCab = (t.match(/de\s*(\d+(?:[.,]\d+)?)\s*(?:kg|kilos?|kgs|hg|kilogramos)\b/) || t.match(/(\d+(?:[.,]\d+)?)\s*(?:kg|kilos?|kgs|hg|kilogramos)\s*(?:cada|c\/u|por\s*cabeza|aprox)/))?.[1];
      const pkg = (t.match(/(\d+(?:[.,]\d+)?)\s*(?:pesos|\$)?\s*(?:por|el|x|\/)\s*(?:kg|kilo)/))?.[1];
      const _n = (s) => s ? Number(String(s).replace(/\./g, '').replace(',', '.')) : null;
      const kgUno = _n(kgCab), precioKg = _n(pkg);
      if (kgUno) params.kilos = Math.round(kgUno * numero * 100) / 100;
      if (precioKg) params.precioKg = precioKg;
      if (params.kilos && precioKg) params.total = Math.round(params.kilos * precioKg * 100) / 100;
    }
    let extra = '';
    if (tipo === 'compra' && (params.kilos || params.precioKg)) {
      extra = ` (${params.kilos ? params.kilos + ' kg' : ''}${params.kilos && params.precioKg ? ' · ' : ''}${params.precioKg ? '$' + params.precioKg + '/kg' : ''})`;
    }
    return { accion: 'hacienda_mov', params, resumen: `🐄 ${lbl} de ${numero} ${cat} en ${campo.nombre}${extra}` };
  }
  // Labor en un lote (cosecha, siembra, pulverización, etc.)
  if (/\blabor|cosech|siembr|sembr|pulveriz|fumig|fertiliz|aplic|apliqu|rastr|arad|laboreo|disquead/.test(t)) {
    let tlab = 'Labor';
    if (/cosech/.test(t)) tlab = 'Cosecha';
    else if (/siembr|sembr/.test(t)) tlab = 'Siembra';
    else if (/pulveriz|fumig|aplic|apliqu/.test(t)) tlab = 'Pulverización';
    else if (/fertiliz/.test(t)) tlab = 'Fertilización';
    else if (/rastr|arad|laboreo|disquead/.test(t)) tlab = 'Laboreo';
    const loteM = t.match(/lote\s+([a-z0-9]+)/);
    let lote = null;
    if (loteM) {
      const tok = loteM[1];                              // ej: "3"
      const nl = (s) => _sinAcentos(s).replace(/^lote\s+/, '').trim(); // "Lote 3" -> "3"
      const cand = ctx.lotes.filter(l => !campo || l.campoId === campo.id);
      lote = cand.find(l => nl(l.nombre) === tok)                       // "3" o "Lote 3"
          || cand.find(l => _sinAcentos(l.nombre) === 'lote ' + tok)    // nombre exacto "lote 3"
          || cand.find(l => _sinAcentos(l.nombre).split(/\s+/).includes(tok)) // "Lote 3 Norte"
          || ctx.lotes.find(l => nl(l.nombre) === tok);                 // sin filtrar por campo
    }
    if (!lote && campo) { const ls = ctx.lotes.filter(l => l.campoId === campo.id); if (ls.length === 1) lote = ls[0]; }
    if (!lote) return { error: 'No reconocí el lote. Ej: "cosecha en el lote 3 de Montenegro".' };
    const camps = ctx.campanas.filter(c => c.loteId === lote.id)
      .sort((a, b) => String(b.ciclo || '').localeCompare(String(a.ciclo || '')) || (new Date(b.fechaSiembra || b.createdAt || 0) - new Date(a.fechaSiembra || a.createdAt || 0)));
    const camp = camps[0];
    if (!camp) return { error: `El lote ${lote.nombre} no tiene campaña cargada. Creala en Campañas y volvé a intentar.` };
    const resp = (texto.match(/emplead[oa]\s+(?:de\s+)?([A-ZÁÉÍÓÚ][\wáéíóúñ]+)/i) || texto.match(/\b(?:la|el)\s+([A-ZÁÉÍÓÚ][\wáéíóúñ]+)\s+(?:termin|hizo|realiz|aplic)/i) || [])[1] || null;
    // Insumo aplicado (ej: "120 litros de Glifosato")
    const insM = texto.match(/(\d+(?:[.,]\d+)?)\s*(litros?|lts?|lt|kg|kilos?|kgs|cc|ml|bolsas?|dosis|gr|gramos?)\b\s*(?:de\s+)?([A-Za-zÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑ0-9\s.]*?)(?:\s+en\b|\s+al\b|\s+sobre\b|[.,]|$)/i);
    const insumoNombre = insM ? insM[3].trim() : null;
    const insumoCantidad = insM ? Number(String(insM[1]).replace(',', '.')) : null;
    const insumoUnidad = insM ? insM[2].toLowerCase() : null;
    const insumo = insM ? `${insM[1]} ${insM[2]} de ${insumoNombre}` : null;
    return { accion: 'labor', params: { campanaId: camp.id, loteNombre: lote.nombre, campoNombre: campo?.nombre || '', tipo: tlab, responsable: resp, insumo, insumoNombre, insumoCantidad, insumoUnidad },
      resumen: `🚜 Labor de ${tlab} en lote ${lote.nombre}${camp.cultivo ? ` (${camp.cultivo}${camp.ciclo ? ' ' + camp.ciclo : ''})` : ''}${insumo ? ` · ${insumo}` : ''}${resp ? ` · ${resp}` : ''}` };
  }
  return { error: 'Perdón, esa no la entendí 🤔. Escribí "ayuda" para ver todo lo que puedo hacer, o probá con algo como "gasté 5000 en nafta".' };
}
// Continúa una carga que quedó a medias (multi-turno): toma el dato que faltaba del
// último mensaje y completa la acción, o vuelve a pedirlo. Devuelve {accion,params,resumen}
// (listo para confirmar), {accion,faltante,pregunta,params} (falta otro dato) o null.
function _completarPendiente(texto, pendiente, ctx) {
  if (!pendiente || !pendiente.accion) return null;
  // "cancelar / dejá / no" → cancelar la carga pendiente.
  if (/\b(cancela|cancelar|deja|dejalo|no importa|olvidalo|nada)\b/.test(_sinAcentos(texto))) {
    return { cancelado: true, mensaje: 'Listo, cancelé eso. ¿Querés cargar otra cosa?' };
  }
  if (pendiente.accion === 'gasto') {
    const p = { ...(pendiente.params || {}) };
    if (pendiente.faltante === 'monto') {
      const monto = _parseMontoPesos(texto);
      if (!monto || monto <= 0) return { accion: 'gasto', faltante: 'monto', params: p, pregunta: 'No te agarré el monto 🤔. Decime solo el número en pesos, ej: 5000.' };
      p.monto = monto;
      const c2 = _parseConceptoGasto(texto);
      if ((!p.concepto || p.concepto === 'Gasto vario') && c2 && c2 !== 'Gasto vario') p.concepto = c2;
      const signo = p.tipo === 'ingreso' ? '💰 Ingreso' : '💸 Gasto';
      return { accion: 'gasto', params: p, resumen: `${signo} diario: $${monto.toLocaleString('es-AR')} · ${p.concepto || ''}${p.categoria ? ` · ${p.categoria}` : ''}` };
    }
  }
  if ((pendiente.accion === 'pago' || pendiente.accion === 'cobro') && pendiente.faltante === 'monto') {
    const p = { ...(pendiente.params || {}) };
    const monto = _parseMontoPesos(texto);
    if (!monto || monto <= 0) return { accion: pendiente.accion, faltante: 'monto', params: p, pregunta: 'No te agarré el monto 🤔. Decime solo el número en pesos, ej: 30000.' };
    p.monto = monto;
    return { accion: pendiente.accion, params: p, resumen: `${pendiente.accion === 'cobro' ? '💰 Cobro de' : '📤 Pago a'} ${p.contactoNombre || ''}: $${monto.toLocaleString('es-AR')} (a cuenta)` };
  }
  return null;
}

// ============================================================
//  BASE DE AYUDA DEL ASISTENTE  (manual incorporado, sin IA)
//  Cuando el usuario PREGUNTA cómo hacer algo, el bot responde el
//  paso a paso y ofrece abrir la pantalla correcta (atajo). Para lo
//  que el bot puede cargar solo (hacienda, labor, recordatorio) además
//  ofrece hacerlo pidiendo los datos con un ejemplo.
// ============================================================
const _AYUDA_KB = [
  { id:'cheque_tercero', terms:['cheque de tercero','cheque tercero','cheques de tercero','cheque recibido','me dieron un cheque','cobre un cheque','endosar','endoso','cheque que me','cheque ajeno'],
    titulo:'Cargar un cheque de tercero',
    pasos:[
      'Entrá a Bancos → Cheques y tocá "Nuevo cheque".',
      'Elegí el tipo "Tercero" (cheque que recibiste). Se habilitan los campos que aplican.',
      'Completá banco, número, importe, fecha de emisión y fecha de pago (cobro).',
      'Cargá el Librador (quién firmó el cheque) y el CUIT del titular; en "En poder de" queda tu empresa.',
      'Si lo endosás a un proveedor, después usalo como medio de pago en la Orden de Pago.',
      'Guardá: el cheque queda en cartera y el sistema te avisa 7 días después para revisar cobro/rechazo.'],
    atajo:{ page:'cheques', label:'Abrir Cheques' } },
  { id:'cheque_propio', terms:['cheque propio','cheque mio','emitir cheque','librar un cheque','pago con cheque','cheque de mi cuenta','chequera'],
    titulo:'Emitir un cheque propio',
    pasos:[
      'Podés emitirlo desde Bancos → Cheques → "Nuevo cheque", tipo "Propio".',
      'O directamente al pagar: en Cuentas a pagar generás la Orden de Pago y elegís "Cheque propio" como medio.',
      'Completá cuenta bancaria, número, importe y fecha de pago (diferido si corresponde).',
      'Al guardar queda registrado el egreso y el cheque en tu chequera.'],
    atajo:{ page:'cheques', label:'Abrir Cheques' } },
  { id:'compra', terms:['compra','cargar una compra','factura de compra','comprobante recibido','factura de proveedor','registrar compra','gasto con factura'],
    titulo:'Cargar una compra / factura de proveedor',
    pasos:[
      'Entrá a Compras → "Nueva compra".',
      'Elegí el proveedor (si no existe, lo creás ahí mismo) y la fecha.',
      'Cargá los renglones (producto/servicio, cantidad, precio) y el IVA; la moneda puede ser $ o US$.',
      'Guardá: genera la cuenta a pagar y, si es un insumo/artículo, suma el stock.',
      'Tip: si tenés el PDF o el Excel de "Mis Comprobantes" de ARCA, usá Importar y se carga solo.'],
    atajo:{ page:'compras', label:'Abrir Compras' } },
  { id:'importar', terms:['importar','importar comprobantes','mis comprobantes','importar pdf','importar excel','importar factura','subir comprobante','importar de arca','importar archivo'],
    titulo:'Importar comprobantes (PDF / Excel de ARCA)',
    pasos:[
      'Para comprobantes RECIBIDOS: Compras → "Importar" y subí el Excel de "Mis Comprobantes Recibidos" de ARCA.',
      'El sistema hace un preview, evita duplicados (por CUIT y número) y da de alta la compra y el proveedor.',
      'Para una factura suelta en PDF podés importarla desde la misma pantalla de compra.',
      'Revisá el preview y confirmá; podés corregir antes de importar.'],
    atajo:{ page:'compras', label:'Abrir Compras' } },
  { id:'venta', terms:['venta','vender','factura de venta','emitir factura','facturar','factura arca','cae','comprobante de venta','nota de credito','nota de debito'],
    titulo:'Emitir una factura de venta (ARCA)',
    pasos:[
      'Entrá a Facturación → "Nueva venta".',
      'Elegí el cliente, la fecha y cargá los renglones (producto, cantidad, precio, IVA).',
      'Todo en una sola pantalla: al emitir se arma el comprobante ARCA por triplicado y el PDF.',
      'Se abre solo para imprimir/descargar y podés enviarlo por WhatsApp o email.',
      'Genera la cuenta a cobrar y descuenta stock. Las NC reingresan stock; las ND no.'],
    atajo:{ page:'facturacion', label:'Abrir Facturación' } },
  { id:'pago_proveedor', terms:['pagar','pago a proveedor','orden de pago','pagar una factura','cancelar deuda','pagar cuenta','como pago'],
    titulo:'Pagar a un proveedor (Orden de Pago)',
    pasos:[
      'Entrá a Cuentas a pagar y buscá al proveedor / la factura.',
      'Tocá "Pagar" y elegí el medio: efectivo, transferencia, cheque propio, cheque de tercero (endoso), tarjeta o entrega de cereal.',
      'Podés cargar el cheque en la misma pantalla del pago.',
      'Se genera la Orden de Pago (imprimible / PDF / WhatsApp / email) con retenciones e importe en letras.'],
    atajo:{ page:'ctasPagar', label:'Abrir Cuentas a pagar' } },
  { id:'cobro', terms:['cobrar','cobro','cobrar una factura','recibir un pago','cuenta a cobrar','recibo','como cobro'],
    titulo:'Cobrar a un cliente',
    pasos:[
      'Entrá a Cuentas a cobrar y buscá al cliente / la factura.',
      'Tocá "Cobrar" y elegí el medio (efectivo, transferencia, cheque de tercero, etc.).',
      'Si el cliente tiene saldo a favor, el sistema te lo ofrece para aplicar.',
      'Se registra el recibo y baja la deuda.'],
    atajo:{ page:'ctasCobrar', label:'Abrir Cuentas a cobrar' } },
  { id:'hacienda', terms:['hacienda','nacimiento','ternero','ternero nacido','murio','muerte de animal','compra de hacienda','movimiento de animales','cambio de categoria','cargar animales','stock ganadero','vacas','novillos'],
    titulo:'Cargar un movimiento de animales',
    pasos:[
      'Entrá a Animales, elegí el campo y tocá "Nuevo movimiento".',
      'Elegí el tipo (nacimiento, muerte, compra, venta, cambio de categoría) y la categoría del animal.',
      'Cargá la cantidad de cabezas (y kg/precio si es compra).',
      'Guardá: actualiza el stock ganadero real y el de SENASA.'],
    atajo:{ page:'hacienda', label:'Abrir Animales' },
    ejemplo:'nacieron 5 terneros en Montenegro' },
  { id:'liq_hacienda', terms:['liquidacion de hacienda','liquidacion hacienda','liquidacion del frigorifico','venta de hacienda','remate','consignatario','liquidacion de venta de animales'],
    titulo:'Cargar una liquidación de animales',
    pasos:[
      'Entrá a Liquidaciones de animales → "Importar PDF" (del frigorífico/consignatario) o cargala a mano.',
      'El sistema lee los renglones y detecta la categoría de cada animal.',
      'Confirmá: descuenta el stock real y el de SENASA y genera la cuenta a cobrar.'],
    atajo:{ page:'liquidacionesHacienda', label:'Abrir Liquidaciones de animales' } },
  { id:'liq_cereal', terms:['liquidacion de cereal','liquidacion de granos','liquidacion cerealera','venta de granos','1116','entrega de cereal'],
    titulo:'Liquidación de cereal',
    pasos:[
      'Entrá a Liquidaciones (cereal) y cargá la liquidación de la cerealera.',
      'Solo aparecen los granos del catálogo.',
      'Se registra el ingreso y el movimiento de stock a pizarra.'],
    atajo:{ page:'liquidaciones', label:'Abrir Liquidaciones' } },
  { id:'labor', terms:['labor','cosecha','siembra','pulverizacion','fumigacion','fertilizacion','laboreo','aplicacion','trabajo en el lote','tarea en el campo'],
    titulo:'Cargar una labor en un lote',
    pasos:[
      'Entrá a Campañas, elegí la campaña del lote y tocá "+ Labor".',
      'Elegí el tipo (cosecha, siembra, pulverización, fertilización, laboreo) y la fecha.',
      'Podés sumar los empleados que la hicieron y, en el modo avanzado, los insumos usados.',
      'Guardá: queda en el historial de la campaña.'],
    atajo:{ page:'campanas', label:'Abrir Campañas' },
    ejemplo:'cosecha en el lote 1 de Campo Prueba' },
  { id:'insumo', terms:['insumo','aplicar insumo','uso de insumo','cargar insumo','semilla','fertilizante','agroquimico a un lote','gastar insumo'],
    titulo:'Cargar el uso de un insumo en un lote',
    pasos:[
      'Entrá a Insumos y tocá "+ Insumo" (respeta los filtros de campaña/ciclo activos).',
      'Elegí primero el tipo y después el producto; cargá cantidad y fecha de aplicación.',
      'Podés cargar varios insumos por lote sin salir.',
      'Guardá: descuenta el stock (salida) con la fecha de aplicación.'],
    atajo:{ page:'insumos', label:'Abrir Insumos' } },
  { id:'stock', terms:['stock','movimiento de stock','ajuste de stock','ingreso de stock','traspaso','conversion','deposito','silo','silobolsa','existencias'],
    titulo:'Mover o ajustar stock',
    pasos:[
      'Entrá a Stock para ver existencias por artículo y depósito.',
      'Tocá "Nuevo movimiento" y usá el buscador con filtro por categoría/familia.',
      'Elegí ingreso, salida, traspaso entre depósitos o conversión (ej: grano ↔ semilla).',
      'Guardá: queda registrado en Movimientos.'],
    atajo:{ page:'stock', label:'Abrir Stock' } },
  { id:'arrendamiento', terms:['arrendamiento','alquiler de campo','contrato de arrendamiento','pagar arrendamiento','quintales','kg novillo'],
    titulo:'Cargar / pagar un arrendamiento',
    pasos:[
      'Entrá a Arrendamientos → "Nuevo contrato" y ponele nombre.',
      'Elegí la modalidad (quintales fijos, % , Kg Novillo, etc.), especie y valuación.',
      'Se generan las cuotas; pagalas con cualquier medio y quedan en Movimientos diarios.'],
    atajo:{ page:'arrendamientos', label:'Abrir Arrendamientos' } },
  { id:'credito', terms:['credito','prestamo','credito bancario','cuota de credito','financiacion','plan de cuotas'],
    titulo:'Cargar un crédito bancario',
    pasos:[
      'Entrá a Créditos → "Nuevo crédito".',
      'Elegí el banco (del catálogo), monto, moneda y tipo de cambio, tasa y cantidad de cuotas (o plan manual).',
      'El sistema arma el plan de cuotas (capital + interés + IVA del interés).',
      'Pagá cada cuota con el medio que quieras; podés editar y cargar cuotas ya pagadas.'],
    atajo:{ page:'creditos', label:'Abrir Créditos' } },
  { id:'cotizacion', terms:['cotizacion','dolar','tipo de cambio','valor del dolar','moneda','cambio'],
    titulo:'Ver / cargar cotizaciones',
    pasos:[
      'Entrá a Cotizaciones: el sistema toma un snapshot diario del dólar.',
      'Podés cargar o corregir una cotización histórica.',
      'Las facturas y cuentas en US$ usan esa cotización; al cobrar/pagar en $ calcula la diferencia de cambio.'],
    atajo:{ page:'cotizaciones', label:'Abrir Cotizaciones' } },
  { id:'recordatorio', terms:['recordatorio','recordar','agenda','calendario','alarma','aviso','tarea pendiente','vencimiento'],
    titulo:'Crear un recordatorio / agenda',
    pasos:[
      'Entrá a Agenda y tocá "Nuevo" para cargar un recordatorio con fecha.',
      'Podés ver el calendario de todas las empresas juntas.',
      'También te aviso yo: decime la frase y lo agendo.'],
    atajo:{ page:'agenda', label:'Abrir Agenda' },
    ejemplo:'recordar vacunar el 15/8' },
  { id:'empleados', terms:['empleado','empleados','planilla','sueldo','jornal','ropa','entrega de ropa','indumentaria','movimiento de empleado','personal','recibo de sueldo'],
    titulo:'Empleados, planilla y entrega de ropa',
    pasos:[
      'Entrá a Empleados para ver el legajo y la planilla de cada uno.',
      'Cargá movimientos (adelantos, jornales, descuentos) eligiendo la categoría; algunos usan cantidad × valor.',
      'Para la ropa/indumentaria cargá el movimiento con la categoría correspondiente; queda en la planilla.',
      'Podés exportar la planilla a PDF/Excel.'],
    atajo:{ page:'empleados', label:'Abrir Empleados' } },
  { id:'viajes', terms:['viaje','flete','transporte','camion','chofer','acoplado','carta de porte','transportista'],
    titulo:'Cargar un viaje / flete',
    pasos:[
      'Entrá a Viajes → "Nuevo viaje".',
      'Elegí origen (campo o depósito/silo), destino, producto y cantidad; podés asociarlo a una campaña.',
      'Al guardar se dan de alta solos el transportista, chofer, camión y acoplado si son nuevos.',
      'Marcá "Pagado" para registrar el pago y, si aplica, la comisión del chofer-empleado.'],
    atajo:{ page:'viajes', label:'Abrir Viajes' } },
  { id:'mensajes', terms:['mensaje','chat','grupo','grupos','mensajeria','avisos','notificaciones','asistente','equipo','comunicar'],
    titulo:'Mensajes, grupos y avisos',
    pasos:[
      'En Mensajes tenés el chat del Equipo, tus Grupos y el Asistente (yo).',
      'Creá un grupo con "➕ Grupo" y elegí los integrantes (cada uno solo ve sus grupos).',
      'Tocá "🔔 Activar avisos" una vez por dispositivo para recibir notificaciones con sonido, incluso con la app cerrada.',
      'Usá "🧪 Probar" para verificar que te llegan.'],
    atajo:{ page:'mensajes', label:'Abrir Mensajes' } },
  { id:'mapa', terms:['mapa','geolocalizacion','ubicacion de campos','mapa de lotes','rinde en el mapa','ubicar campo','coordenadas'],
    titulo:'Mapa de lotes con rindes',
    pasos:[
      'Entrá a Mapa de campos para ver tus campos ubicados en el mapa.',
      'Cargá la ubicación de cada campo (coordenadas o link de Google Maps) en Campos.',
      'Podés dibujar el contorno de un lote a mano.',
      'Los lotes se colorean según el rinde de la campaña.'],
    atajo:{ page:'mapaCampos', label:'Abrir Mapa de campos' } },
  { id:'historial', terms:['historial','comparar campañas','comparador','campañas anteriores','evolucion','resultado de campañas'],
    titulo:'Historial y comparador de campañas',
    pasos:[
      'Entrá a Historial de campañas para ver todas las campañas y sus resultados.',
      'Elegí varias para compararlas (rinde, costos, margen).',
      'Sirve para decidir qué lote/cultivo rindió mejor.'],
    atajo:{ page:'historialCampanas', label:'Abrir Historial de campañas' } },
  { id:'campana', terms:['campaña','nueva campaña','sembrar un lote','crear campaña','cultivo','ciclo'],
    titulo:'Crear una campaña',
    pasos:[
      'Entrá a Campañas → "Nueva".',
      'Ponele un nombre libre, elegí el lote, el cultivo y el ciclo.',
      'Después le cargás insumos, labores y la planilla de resultado económico.'],
    atajo:{ page:'campanas', label:'Abrir Campañas' } },
  { id:'clientes_prov', terms:['cliente','clientes','proveedor','proveedores','alta de cliente','alta de proveedor','contacto'],
    titulo:'Alta de clientes y proveedores',
    pasos:[
      'Entrá a Clientes o Proveedores y tocá "Nuevo".',
      'Cargá razón social, CUIT y condición de IVA.',
      'También se crean solos cuando cargás una compra/venta o un viaje.'],
    atajo:{ page:'clientes', label:'Abrir Clientes' } },
  { id:'movdiarios', terms:['movimiento diario','caja','ingreso de dinero','egreso','gasto sin factura','movimientos diarios','plata','efectivo'],
    titulo:'Movimientos diarios (caja/banco)',
    pasos:[
      'Entrá a Movimientos diarios y tocá "Nuevo".',
      'Elegí ingreso o egreso, el medio (efectivo, banco, tarjeta) y la Categoría + Familia del árbol de gastos.',
      'Podés marcarlo como intercompany si es entre tus empresas.'],
    atajo:{ page:'movDiarios', label:'Abrir Movimientos diarios' } },
  { id:'usuarios', terms:['usuario','usuarios','permiso','permisos','rol','roles','dar acceso','alta de usuario','contraseña'],
    titulo:'Usuarios, roles y permisos',
    pasos:[
      'Entrá a Usuarios para dar de alta a alguien y asignarle empresa(s) y rol.',
      'En Roles definís qué puede ver/hacer cada rol (incluso limitar el stock por tipo de producto).',
      'Podés vincular un usuario con su Empleado/Chofer.'],
    atajo:{ page:'usuarios', label:'Abrir Usuarios' } },
];
function _esPregunta(t){
  return /(^|\s)(como|donde|cuando|cual|cuales|que es|para que|se puede|puedo|podes|podés|puedes|necesito|quiero saber|me explicas|explicame|ayuda|no se como|no entiendo|donde cargo|donde se|donde esta)\b/.test(t) || /\?/.test(t);
}
// Busca la mejor entrada de ayuda por coincidencia de términos. Devuelve entry o null.
function _buscarAyuda(texto){
  const t = _sinAcentos(texto);
  let best = null, bestScore = 0;
  for (const e of _AYUDA_KB){
    let score = 0;
    for (const term of e.terms){ if (t.includes(_sinAcentos(term))) score += term.length; }
    if (score > bestScore){ bestScore = score; best = e; }
  }
  return bestScore > 0 ? best : null;
}
// Charla básica: saludos, agradecimientos y despedidas. Devuelve texto o null.
function _saludoRespuesta(texto){
  const t = _sinAcentos(texto).trim().replace(/[!¡?¿.,]/g,'');
  const palabras = t.split(/\s+/).length;
  // Saludos (solo si el mensaje es corto y arranca saludando; si además pregunta algo, lo maneja la ayuda)
  if (palabras <= 4 && /^(hola|holis|holaa+|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hey|que tal|como estas|como andas|como va|todo bien|que hace|saludos)\b/.test(t)){
    return '¡Hola! 👋 Soy el asistente de AgroCore. Puedo *cargar cosas por vos* (gastos del día, hacienda, labores, recordatorios) o *explicarte cómo se hace algo* en el sistema.\n\nProbá:\n• Un gasto — ej: "hoy fui a la panadería y gasté 5000 pesos"\n• Contame qué hiciste — ej: "nacieron 5 terneros en Montenegro"\n• O preguntame — ej: "¿cómo hago una compra?"\n\nEscribí "ayuda" y te muestro todo lo que puedo hacer. ¿Con qué te doy una mano?';
  }
  // Agradecimientos
  if (palabras <= 4 && /^(gracias|muchas gracias|genial|perfecto|barbaro|buenisimo|joya|excelente|de diez|copado)\b/.test(t)){
    return '¡De nada! 😊 Cuando quieras, contame qué hiciste o preguntame cómo se hace algo.';
  }
  // Despedidas / confirmaciones cortas
  if (palabras <= 3 && /^(chau|adios|nos vemos|hasta luego|hasta mañana|listo|ok|okay|oka|dale|buenas noches)\b/.test(t)){
    return '¡Listo! Cuando quieras seguimos. 👋';
  }
  return null;
}
// ¿Pide ayuda general / no sabe qué hacer?
function _esPedidoAyudaGeneral(t){
  return /\b(que podes hacer|que sabes hacer|que puedo hacer|para que servis|para que sos|^ayuda$|necesito ayuda|dame una mano|ayudame|opciones|menu|no se que hacer|no se como usar|no entiendo nada|como te uso|como funcionas)\b/.test(t) || t.trim()==='ayuda';
}
// Menú de capacidades del asistente.
function _menuAyuda(){
  return 'Te puedo dar una mano con esto 👇\n\n📋 CARGAR POR VOS (me contás y lo registro):\n• Animales → "nacieron 5 terneros en Montenegro"\n• Labores → "cosecha en el lote 1 de Campo Prueba"\n• Recordatorios → "recordar vacunar el 15/8"\n\n📖 EXPLICARTE CÓMO SE HACE (preguntame):\n• "¿cómo cargo un cheque de tercero?"\n• "¿cómo hago una compra o una venta?"\n• "¿cómo importo mis comprobantes?"\n• "¿cómo cargo una liquidación de animales?"\n\nEscribí tu consulta y arrancamos 💪';
}
// Arma el texto de la respuesta de ayuda (paso a paso).
function _textoAyuda(e){
  const pasos = e.pasos.map((p,i)=>`${i+1}. ${p}`).join('\n');
  let msg = `📖 ${e.titulo}\n${pasos}`;
  if (e.ejemplo) msg += `\n\n💡 Si querés, lo hago yo: decime por ejemplo "${e.ejemplo}".`;
  return msg;
}

async function _logMensaje(companyId, canal, userId, rol, autorNombre, texto, meta) {
  return prisma.mensaje.create({ data: { companyId, canal, userId, rol, autorNombre: autorNombre || null, texto, meta: meta || undefined } });
}

// ---------- WEB PUSH (notificaciones aunque la app esté cerrada) ----------
// web-push es dependencia OPCIONAL: si no está instalada, las notificaciones push
// simplemente no se envían (el aviso en la app + sonido siguen funcionando).
let _webpush = null, _webpushTried = false, _vapid = null;
async function _getWebpush() {
  if (_webpush) return _webpush;
  if (_webpushTried) return null;
  _webpushTried = true;
  try { const m = await import('web-push'); _webpush = m.default || m; } catch { _webpush = null; }
  return _webpush;
}
async function _getVapid() {
  if (_vapid) return _vapid;
  const wp = await _getWebpush(); if (!wp) return null;
  let row = await prisma.setting.findUnique({ where: { id: 'push_vapid' } }).catch(() => null);
  if (row?.data?.publicKey && row?.data?.privateKey) { _vapid = row.data; }
  else {
    const keys = wp.generateVAPIDKeys();
    _vapid = { publicKey: keys.publicKey, privateKey: keys.privateKey };
    await prisma.setting.upsert({ where: { id: 'push_vapid' }, create: { id: 'push_vapid', data: _vapid }, update: { data: _vapid } }).catch(() => {});
  }
  try { wp.setVapidDetails('mailto:soporte@agrocore.ar', _vapid.publicKey, _vapid.privateKey); } catch {}
  return _vapid;
}
// Envía una notificación push a todos los usuarios de la empresa (menos el emisor).
async function _pushAMiembros(companyId, exceptUserId, payload) {
  try {
    const wp = await _getWebpush(); if (!wp) return;
    const v = await _getVapid(); if (!v) return;
    const subs = await prisma.pushSubscription.findMany({ where: { companyId, userId: { not: exceptUserId } } });
    const body = JSON.stringify(payload);
    await Promise.all(subs.map(async (s) => {
      try { await wp.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body); }
      catch (e) { if (e?.statusCode === 404 || e?.statusCode === 410) { await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {}); } }
    }));
  } catch {}
}
// Envía push a una lista específica de usuarios (para grupos).
async function _pushAUsuarios(companyId, userIds, payload) {
  try {
    if (!userIds || !userIds.length) return;
    const wp = await _getWebpush(); if (!wp) return;
    const v = await _getVapid(); if (!v) return;
    const subs = await prisma.pushSubscription.findMany({ where: { companyId, userId: { in: userIds.map(String) } } });
    const body = JSON.stringify(payload);
    await Promise.all(subs.map(async (s) => {
      try { await wp.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body); }
      catch (e) { if (e?.statusCode === 404 || e?.statusCode === 410) { await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {}); } }
    }));
  } catch {}
}
// Push del chat COMPARTIDO entre empresas: junta suscripciones de todas las empresas
// del usuario y deduplica por endpoint (un usuario puede estar suscripto en varias).
async function _pushChat(cids, whereExtra, payload) {
  try {
    const wp = await _getWebpush(); if (!wp) return;
    const v = await _getVapid(); if (!v) return;
    const subs = await prisma.pushSubscription.findMany({ where: { companyId: { in: cids }, ...whereExtra } });
    const vistos = new Set();
    const body = JSON.stringify(payload);
    await Promise.all(subs.map(async (s) => {
      if (vistos.has(s.endpoint)) return; vistos.add(s.endpoint);
      try { await wp.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body); }
      catch (e) { if (e?.statusCode === 404 || e?.statusCode === 410) { await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {}); } }
    }));
  } catch {}
}
app.get('/api/push/vapid-public', requireCompany, async (req, res, next) => {
  try { const v = await _getVapid(); res.json({ ok: true, data: { publicKey: v?.publicKey || null } }); } catch (e) { next(e); }
});
app.post('/api/push/subscribe', requireCompany, async (req, res, next) => {
  try {
    const s = req.body?.subscription || req.body;
    if (!s?.endpoint || !s?.keys?.p256dh || !s?.keys?.auth) return res.status(400).json({ ok: false, error: 'Suscripción inválida' });
    const row = await prisma.pushSubscription.upsert({
      where: { endpoint: s.endpoint },
      create: { companyId: req.companyId, userId: req.user.id, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth },
      update: { companyId: req.companyId, userId: req.user.id, p256dh: s.keys.p256dh, auth: s.keys.auth },
    });
    res.status(201).json({ ok: true, data: { id: row.id } });
  } catch (e) { next(e); }
});
app.post('/api/push/unsubscribe', requireCompany, async (req, res, next) => {
  try { const ep = req.body?.endpoint; if (ep) await prisma.pushSubscription.deleteMany({ where: { endpoint: ep, userId: req.user.id } }); res.json({ ok: true }); } catch (e) { next(e); }
});
// Envía un aviso de PRUEBA al propio usuario (para verificar que el push llega).
app.post('/api/push/test', requireCompany, async (req, res, next) => {
  try {
    const wp = await _getWebpush();
    if (!wp) return res.json({ ok: false, error: 'El servidor no tiene web-push instalado.' });
    const v = await _getVapid();
    if (!v) return res.json({ ok: false, error: 'No hay claves de push configuradas.' });
    const subs = await prisma.pushSubscription.findMany({ where: { companyId: req.companyId, userId: req.user.id } });
    if (!subs.length) return res.json({ ok: false, error: 'Este dispositivo no tiene los avisos activados.' });
    const body = JSON.stringify({ title: '🔔 AgroCore', body: 'Aviso de prueba: las notificaciones están funcionando ✅', url: '/app#/mensajes', tag: 'agrocore-test' });
    let enviados = 0;
    await Promise.all(subs.map(async (s) => {
      try { await wp.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body); enviados++; }
      catch (e) { if (e?.statusCode === 404 || e?.statusCode === 410) { await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {}); } }
    }));
    res.json({ ok: enviados > 0, enviados, error: enviados ? null : 'No se pudo entregar el aviso (revisá permisos/servidor).' });
  } catch (e) { next(e); }
});

// Usuarios de la empresa (lista liviana para armar grupos / mostrar autores).
// Accesible a cualquier miembro (no requiere permiso de administrar usuarios).
app.get('/api/company-users', requireCompany, async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { activo: true, oculto: false, userCompanies: { some: { companyId: req.companyId } } },
      select: { id: true, nombre: true, apellido: true, alias: true, email: true },
      orderBy: [{ apellido: 'asc' }, { nombre: 'asc' }],
    });
    res.json({ ok: true, data: users.map(u => ({ id: u.id, nombre: _nombreUser(u) })) });
  } catch (e) { next(e); }
});

// --- Grupos de mensajería ---
function _grupoMiembros(g){ return Array.isArray(g?.miembros) ? g.miembros.map(String) : []; }
// La MENSAJERIA (chat general y grupos) NO se diferencia por empresa: es un espacio
// compartido entre TODAS las empresas del usuario (igual que el asistente). Estos ids
// son el conjunto de empresas del usuario, para leer/escribir mensajes y grupos sin
// importar cuál esté activa.
async function _cidsChat(req){
  const es = await _empresasDeUsuario(req);
  const ids = (es || []).map(e => e.id);
  return ids.length ? ids : [req.companyId];
}
async function _gruposDeUsuario(cids, userId){
  const arr = Array.isArray(cids) ? cids : [cids];
  const all = await prisma.mensajeGrupo.findMany({ where: { companyId: { in: arr } }, orderBy: { nombre: 'asc' } });
  return all.filter(g => _grupoMiembros(g).includes(String(userId)));
}
app.get('/api/grupos', requireCompany, async (req, res, next) => {
  try {
    const cids = await _cidsChat(req);   // grupos compartidos entre todas las empresas del usuario
    const all = await prisma.mensajeGrupo.findMany({ where: { companyId: { in: cids } }, orderBy: { nombre: 'asc' } });
    // Solo el Super Admin ve todos los grupos; el resto ve únicamente los suyos.
    const data = req.user.superAdmin ? all : all.filter(g => _grupoMiembros(g).includes(String(req.user.id)));
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});
app.post('/api/grupos', requireCompany, async (req, res, next) => {
  try {
    const nombre = String(req.body?.nombre || '').trim();
    if (!nombre) return res.status(400).json({ ok: false, error: 'Poné un nombre al grupo' });
    let miembros = Array.isArray(req.body?.miembros) ? req.body.miembros.map(String) : [];
    if (!miembros.includes(String(req.user.id))) miembros.push(String(req.user.id)); // el creador siempre es miembro
    const g = await prisma.mensajeGrupo.create({ data: { companyId: req.companyId, nombre, miembros, creadoPor: req.user.id } });
    res.status(201).json({ ok: true, data: g });
  } catch (e) { next(e); }
});
app.put('/api/grupos/:id', requireCompany, async (req, res, next) => {
  try {
    const cids = await _cidsChat(req);
    const g = await prisma.mensajeGrupo.findFirst({ where: { id: req.params.id, companyId: { in: cids } } });
    if (!g) return res.status(404).json({ ok: false, error: 'Grupo no encontrado' });
    if (!(req.user.superAdmin || g.creadoPor === req.user.id || _permOk(req, 'usuarios:*'))) return res.status(403).json({ ok: false, error: 'Solo el creador o un administrador puede editar el grupo' });
    const data = {};
    if (req.body?.nombre != null) data.nombre = String(req.body.nombre).trim();
    if (Array.isArray(req.body?.miembros)) { let m = req.body.miembros.map(String); if (g.creadoPor && !m.includes(String(g.creadoPor))) m.push(String(g.creadoPor)); data.miembros = m; }
    const row = await prisma.mensajeGrupo.update({ where: { id: g.id }, data });
    res.json({ ok: true, data: row });
  } catch (e) { next(e); }
});
app.delete('/api/grupos/:id', requireCompany, async (req, res, next) => {
  try {
    const cids = await _cidsChat(req);
    const g = await prisma.mensajeGrupo.findFirst({ where: { id: req.params.id, companyId: { in: cids } } });
    if (!g) return res.status(404).json({ ok: false, error: 'Grupo no encontrado' });
    if (!(req.user.superAdmin || g.creadoPor === req.user.id || _permOk(req, 'usuarios:*'))) return res.status(403).json({ ok: false, error: 'Solo el creador o un administrador puede eliminar el grupo' });
    await prisma.mensaje.deleteMany({ where: { companyId: { in: cids }, canal: 'grupo:' + g.id } });
    await prisma.mensajeGrupo.delete({ where: { id: g.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Valida el canal pedido y (para grupos) la pertenencia. Devuelve {canal, grupo} o null.
async function _canalValido(req, canalRaw){
  const canal = String(canalRaw || 'general');
  if (canal === 'general' || canal === 'asistente') return { canal };
  if (canal.startsWith('grupo:')){
    const cids = await _cidsChat(req);   // grupo compartido entre las empresas del usuario
    const g = await prisma.mensajeGrupo.findFirst({ where: { id: canal.slice(6), companyId: { in: cids } } });
    if (!g) return null;
    const ok = req.user.superAdmin || _grupoMiembros(g).includes(String(req.user.id));
    return ok ? { canal, grupo: g } : null;
  }
  return null;
}

// --- Chat (canal general, grupo:<id> o asistente) ---
app.get('/api/mensajes', requireCompany, async (req, res, next) => {
  try {
    const v = await _canalValido(req, req.query.canal);
    if (!v) return res.status(403).json({ ok: false, error: 'No tenés acceso a esa conversación' });
    // El ASISTENTE es un hilo GENERAL del usuario (por userId). El chat GENERAL y los
    // GRUPOS también son COMPARTIDOS entre todas las empresas del usuario: se ven igual
    // desde cualquier empresa (no se diferencian por empresa).
    const cids = await _cidsChat(req);
    const where = v.canal === 'asistente'
      ? { canal: 'asistente', userId: req.user.id }
      : { companyId: { in: cids }, canal: v.canal };
    const data = await prisma.mensaje.findMany({ where, orderBy: { createdAt: 'asc' }, take: 300 });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});
app.post('/api/mensajes', requireCompany, async (req, res, next) => {
  try {
    const v = await _canalValido(req, req.body?.canal || 'general');
    if (!v || v.canal === 'asistente') return res.status(403).json({ ok: false, error: 'No tenés acceso a esa conversación' });
    const texto = String(req.body?.texto || '').trim();
    const fotoUrl = req.body?.fotoUrl || null;
    if (!texto && !fotoUrl) return res.status(400).json({ ok: false, error: 'Mensaje vacío' });
    const autor = _nombreUser(req.user);
    const row = await prisma.mensaje.create({ data: {
      companyId: req.companyId, canal: v.canal, userId: req.user.id, rol: 'user',
      autorNombre: autor, texto: texto || '📷 Foto', fotoUrl: fotoUrl || null,
    }});
    // Aviso push a los demás participantes (chat compartido: en TODAS las empresas del usuario).
    const cids = await _cidsChat(req);
    const titulo = v.grupo ? `💬 ${autor} · ${v.grupo.nombre}` : `💬 ${autor}`;
    const payload = { title: titulo, body: (texto||'📷 Foto').slice(0,140), url: '/app#/mensajes', canal: v.canal, tag: 'chat-'+v.canal };
    if (v.grupo){
      const dest = _grupoMiembros(v.grupo).filter(id => id !== String(req.user.id));
      _pushChat(cids, { userId: { in: dest.map(String) } }, payload);
    } else {
      _pushChat(cids, { userId: { not: req.user.id } }, payload);
    }
    res.status(201).json({ ok: true, data: row });
  } catch (e) { next(e); }
});
app.get('/api/mensajes/no-leidos', requireCompany, async (req, res, next) => {
  try {
    // Chat compartido entre empresas: leemos el "leído" del usuario en TODAS sus empresas
    // y tomamos el más reciente por canal (así, si leyó desde otra empresa, no cuenta de nuevo).
    const cids = await _cidsChat(req);
    const estados = await prisma.chatEstado.findMany({ where: { companyId: { in: cids }, userId: req.user.id } });
    const desdeDe = (canal) => {
      let mx = 0;
      for (const est of estados) {
        const lr = (est?.lastRead && typeof est.lastRead === 'object') ? est.lastRead : {};
        const v = lr[canal] || (canal === 'general' ? (est?.lastReadGeneral || 0) : 0);
        const t = new Date(v).getTime(); if (t > mx) mx = t;
      }
      return new Date(mx);
    };
    const porCanal = {};
    let total = 0;
    // general
    porCanal.general = await prisma.mensaje.count({ where: { companyId: { in: cids }, canal: 'general', createdAt: { gt: desdeDe('general') }, userId: { not: req.user.id } } });
    total += porCanal.general;
    // grupos del usuario (en cualquiera de sus empresas)
    const grupos = await _gruposDeUsuario(cids, req.user.id);
    for (const g of grupos){
      const c = 'grupo:' + g.id;
      const n = await prisma.mensaje.count({ where: { companyId: { in: cids }, canal: c, createdAt: { gt: desdeDe(c) }, userId: { not: req.user.id } } });
      porCanal[c] = n; total += n;
    }
    res.json({ ok: true, data: { noLeidos: total, porCanal } });
  } catch (e) { next(e); }
});
app.post('/api/mensajes/marcar-leido', requireCompany, async (req, res, next) => {
  try {
    const canal = String(req.body?.canal || 'general');
    const est = await prisma.chatEstado.findFirst({ where: { companyId: req.companyId, userId: req.user.id } });
    const lr = (est?.lastRead && typeof est.lastRead === 'object') ? { ...est.lastRead } : {};
    lr[canal] = new Date().toISOString();
    const data = { lastRead: lr };
    if (canal === 'general') data.lastReadGeneral = new Date();
    await prisma.chatEstado.upsert({
      where: { companyId_userId: { companyId: req.companyId, userId: req.user.id } },
      create: { companyId: req.companyId, userId: req.user.id, lastRead: lr, lastReadGeneral: canal === 'general' ? new Date() : null },
      update: data,
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// --- Asistente: interpretar (no ejecuta) ---
app.post('/api/asistente', requireCompany, async (req, res, next) => {
  try {
    const texto = String(req.body?.texto || '').trim();
    if (!texto) return res.status(400).json({ ok: false, error: 'Escribí algo' });
    await _logMensaje(req.companyId, 'asistente', req.user.id, 'user', _nombreUser(req.user), texto);
    // Bot GENERAL multi-empresa: si el usuario tiene más de una empresa, interpretamos con el
    // contexto combinado (así reconoce clientes/campos de cualquier empresa) y luego decidimos
    // en cuál cargar. Con una sola empresa, todo sigue igual que antes.
    const empresas = await _empresasDeUsuario(req);
    const multiEmpresa = (empresas || []).length > 1;
    const ctxActiva = await _ctxAsistente(req.companyId);
    const ctx = multiEmpresa ? await _ctxAsistenteMulti(empresas) : ctxActiva;
    const empresaScope = req.body?.empresaScope || null; // null | <companyId> | 'todas'
    const _tn = _sinAcentos(texto);
    // 0-bis) Si hay una carga a medias (multi-turno), primero intentamos completarla.
    const pendiente = req.body?.pendiente || null;
    let readyPend = null;
    if (pendiente) {
      const rp = _completarPendiente(texto, pendiente, ctx);
      if (rp) {
        if (rp.cancelado) {
          const m = await _logMensaje(req.companyId, 'asistente', req.user.id, 'assistant', 'Asistente', rp.mensaje, { status: 'ayuda' });
          return res.json({ ok: true, status: 'ayuda', mensaje: rp.mensaje, data: m });
        }
        if (rp.faltante) {
          const m = await _logMensaje(req.companyId, 'asistente', req.user.id, 'assistant', 'Asistente', rp.pregunta, { status: 'faltante', accion: rp.accion, faltante: rp.faltante, params: rp.params });
          return res.json({ ok: true, status: 'faltante', accion: rp.accion, faltante: rp.faltante, params: rp.params, mensaje: rp.pregunta, data: m });
        }
        readyPend = rp; // acción completa → sigue al armado de la propuesta
      }
    }
    if (!readyPend) {
    const _tnUnused = 0;
    // 0) Charla básica (saludos, gracias, chau) y pedido de ayuda general.
    const _sal = _saludoRespuesta(texto);
    if (_sal) {
      const m = await _logMensaje(req.companyId, 'asistente', req.user.id, 'assistant', 'Asistente', _sal, { status: 'ayuda', charla: true });
      return res.json({ ok: true, status: 'ayuda', mensaje: _sal, data: m });
    }
    if (_esPedidoAyudaGeneral(_tn)) {
      const msg = _menuAyuda();
      const m = await _logMensaje(req.companyId, 'asistente', req.user.id, 'assistant', 'Asistente', msg, { status: 'ayuda', menu: true });
      return res.json({ ok: true, status: 'ayuda', mensaje: msg, data: m });
    }
    // 0.5) CONSULTAS de solo lectura (stock, animales, lotes, campañas, plata).
    //      Con multi-empresa preguntamos de qué empresa (o todas). Siempre usamos el
    //      contexto POR empresa (no el combinado) para que las cuentas den bien.
    try {
      if (multiEmpresa && empresaScope === 'todas') {
        const partes = [];
        for (const co of empresas) {
          const mem = (req.user.userCompanies || []).find(uc => uc.companyId === co.id);
          const rq = { user: req.user, companyId: co.id, membership: mem || null };
          let cc; try { cc = await _ctxAsistente(co.id); } catch { cc = ctxActiva; }
          const a = await _consultaAsistente(texto, co.id, cc, rq).catch(() => null);
          if (a) partes.push(`🏢 ${co.name}:\n${a}`);
        }
        if (partes.length) {
          const msg = partes.join('\n\n');
          const m = await _logMensaje(req.companyId, 'asistente', req.user.id, 'assistant', 'Asistente', msg, { status: 'ayuda', consulta: true });
          return res.json({ ok: true, status: 'ayuda', mensaje: msg, data: m });
        }
      } else {
        const cid = (empresaScope && empresaScope !== 'todas') ? empresaScope : req.companyId;
        const mem = (req.user.userCompanies || []).find(uc => uc.companyId === cid) || req.membership;
        const rq = (cid === req.companyId) ? req : { user: req.user, companyId: cid, membership: mem || null };
        let cc = ctxActiva; if (cid !== req.companyId) { try { cc = await _ctxAsistente(cid); } catch { cc = ctxActiva; } }
        const _c = await _consultaAsistente(texto, cid, cc, rq);
        if (_c) {
          // Es una consulta. Si hay varias empresas y el usuario no eligió, preguntamos.
          if (multiEmpresa && !empresaScope) {
            const msg = '¿De qué empresa querés el dato? Elegí abajo 👇';
            const m = await _logMensaje(req.companyId, 'asistente', req.user.id, 'assistant', 'Asistente', msg, { status: 'empresa', modo: 'consulta' });
            return res.json({ ok: true, status: 'empresa', modo: 'consulta', texto, empresas, mensaje: msg, data: m });
          }
          const m = await _logMensaje(req.companyId, 'asistente', req.user.id, 'assistant', 'Asistente', _c, { status: 'ayuda', consulta: true });
          return res.json({ ok: true, status: 'ayuda', mensaje: _c, data: m });
        }
      }
    } catch (e) {}
    // 0.7) FACTURAS: por seguridad (IVA discriminado, Libro IVA y CAE de ARCA) el bot NO las
    //      emite/crea; reconoce la intención, lo explica y te lleva a la pantalla correcta.
    if (/\bfactur/.test(_tn) && /\b(compra|venta|vender|emitir|proveedor|cliente|cargar|carga|hacer|nueva|nuevo|registrar)\b/.test(_tn)) {
      const esVenta = /\b(venta|vender|emitir|cliente)\b/.test(_tn) && !/\b(compra|proveedor|recib)\b/.test(_tn);
      const e = _buscarAyuda(esVenta ? 'emitir factura de venta' : 'cargar una compra factura de compra');
      if (e) {
        const intro = esVenta
          ? 'Las facturas de venta con CAE se emiten desde Facturación (por seguridad no las emito yo). Te llevo y las revisás/emitís ahí.'
          : 'Las facturas de compra se cargan en Compras (con ítems e IVA). Si tenés el PDF o el Excel de ARCA, con "Importar" se carga casi solo. Te llevo.';
        const msg = intro + '\n\n' + _textoAyuda(e);
        const m = await _logMensaje(req.companyId, 'asistente', req.user.id, 'assistant', 'Asistente', msg, { status: 'ayuda', ayudaId: e.id });
        return res.json({ ok: true, status: 'ayuda', mensaje: msg, atajo: e.atajo || null, titulo: e.titulo, data: m });
      }
    }
    // 1) Si es una PREGUNTA de "cómo se hace", respondemos con la ayuda del manual.
    if (_esPregunta(_tn)) {
      const e = _buscarAyuda(texto);
      if (e) {
        const msg = _textoAyuda(e);
        const m = await _logMensaje(req.companyId, 'asistente', req.user.id, 'assistant', 'Asistente', msg, { status: 'ayuda', ayudaId: e.id });
        return res.json({ ok: true, status: 'ayuda', mensaje: msg, atajo: e.atajo || null, ejemplo: e.ejemplo || null, titulo: e.titulo, data: m });
      }
    }
    } // fin if(!readyPend)
    let r = readyPend || _interpretarMensaje(texto, ctx);
    // 1.5) IA de RESPALDO: si las reglas no entendieron y la IA está activada, le pedimos
    //      que reescriba el mensaje a un molde conocido y volvemos a procesarlo. La IA no
    //      ejecuta nada: todo pasa igual por la confirmación.
    if (!readyPend && r.error) {
      const ia = await _iaConfig();
      if (ia.enabled) {
        const norm = await _iaNormalizar(texto, ctx, ia);
        if (norm) {
          try {
            const c2 = await _consultaAsistente(norm, req.companyId, ctx, req);
            if (c2) {
              const m = await _logMensaje(req.companyId, 'asistente', req.user.id, 'assistant', 'Asistente', c2, { status: 'ayuda', consulta: true, ia: true });
              return res.json({ ok: true, status: 'ayuda', mensaje: c2, data: m });
            }
          } catch {}
          const r2 = _interpretarMensaje(norm, ctx);
          if (!r2.error) r = r2;  // la IA lo entendió → seguimos con el flujo normal (con confirmación)
        }
      }
    }
    // Falta un dato para completar la carga (ej: el monto del gasto) → lo pedimos.
    if (r.faltante) {
      const m = await _logMensaje(req.companyId, 'asistente', req.user.id, 'assistant', 'Asistente', r.pregunta, { status: 'faltante', accion: r.accion, faltante: r.faltante, params: r.params });
      return res.json({ ok: true, status: 'faltante', accion: r.accion, faltante: r.faltante, params: r.params, mensaje: r.pregunta, data: m });
    }
    if (r.error) {
      // 2) Fallback: si no entendí el comando, intento ofrecer ayuda del manual.
      const e = _buscarAyuda(texto);
      if (e) {
        const msg = _textoAyuda(e);
        const m = await _logMensaje(req.companyId, 'asistente', req.user.id, 'assistant', 'Asistente', msg, { status: 'ayuda', ayudaId: e.id });
        return res.json({ ok: true, status: 'ayuda', mensaje: msg, atajo: e.atajo || null, ejemplo: e.ejemplo || null, titulo: e.titulo, data: m });
      }
      const m = await _logMensaje(req.companyId, 'asistente', req.user.id, 'assistant', 'Asistente', r.error, { status: 'ayuda' });
      return res.json({ ok: true, status: 'ayuda', mensaje: r.error, data: m });
    }
    // Empresa donde se cargará: deducida de la entidad matcheada (campo/campaña/contacto).
    // Si es ambigua (gasto/recordatorio), queda null y el frontend muestra el selector.
    const accionCid = _cidDeAccion(r, ctx) || (multiEmpresa ? null : req.companyId);
    const cidParaCatalogo = accionCid || req.companyId;
    // Si la labor trae un insumo, buscamos el producto en el catálogo y, si no está,
    // ofrecemos crearlo eligiendo la familia (tipo de insumo).
    let familias = null;
    if (r.accion === 'labor' && r.params.insumoNombre) {
      const _n = _sinAcentos(r.params.insumoNombre);
      const prods = await prisma.producto.findMany({ where: { companyId: cidParaCatalogo, activo: true, categoria: 'insumos' }, select: { id: true, nombre: true, unidad: true } });
      const prod = prods.find(p => _sinAcentos(p.nombre) === _n) || prods.find(p => { const pn = _sinAcentos(p.nombre); return pn.includes(_n) || _n.includes(pn); });
      r.params.insumoProductoId = prod?.id || null;
      r.params.insumoExiste = !!prod;
      if (prod && prod.unidad) r.params.insumoUnidad = prod.unidad;
      if (prod) r.params.insumoNombre = prod.nombre; // usar el nombre exacto del catálogo
      if (!prod) { try { familias = [...await insumoTipoNombresSet(cidParaCatalogo)]; } catch { familias = INSUMO_TIPOS_BASE; } }
    }
    const m = await _logMensaje(req.companyId, 'asistente', req.user.id, 'assistant', 'Asistente',
      `Voy a registrar: ${r.resumen}. ¿Confirmás?`, { status: 'propuesta', accion: r.accion, params: r.params, resumen: r.resumen });
    const extra = {};
    // Listas para el editor, tomadas de la empresa que corresponda (la del contacto en
    // pago/cobro; la activa para gasto, que igual puede cambiarse en el selector).
    const ctxExtra = (accionCid && accionCid !== req.companyId) ? await _ctxAsistente(accionCid) : ctxActiva;
    if (r.accion === 'gasto') { extra.categoriasGasto = ctxActiva.categoriasGasto || []; extra.cajas = ctxActiva.cajas || []; }
    if (r.accion === 'pago' || r.accion === 'cobro') { extra.cajas = ctxExtra.cajas || []; extra.bancos = ctxExtra.bancos || []; }
    // Empresa: para acciones con entidad (pago/cobro/hacienda/labor) queda fija en la del
    // dato; para gasto/recordatorio es ambigua y el usuario la elige en el selector.
    const empresaFija = ['pago', 'cobro', 'hacienda_mov', 'labor'].includes(r.accion) && !!accionCid;
    res.json({ ok: true, status: 'propuesta', accion: r.accion, params: r.params, resumen: r.resumen, familias,
      companyId: accionCid || null, empresas: multiEmpresa ? empresas : null, empresaFija,
      ...extra, data: m });
  } catch (e) { next(e); }
});
// --- Asistente: analizar un archivo (PDF/foto) y proponer la acción correspondiente ---
// Reconoce facturas de compra, liquidaciones (cereal/animales), órdenes de trabajo (labor),
// tickets/gastos y cheques. Devuelve una "frase" para reprocesar con el flujo normal del bot
// (gasto/labor → confirmación) o un "atajo" a la pantalla que corresponde.
app.post('/api/asistente/analizar-archivo', requireCompany, upload.single('archivo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Falta el archivo' });
    const ia = await _iaConfig();
    if (!ia.enabled) {
      return res.json({ ok: true, status: 'ayuda', mensaje: '📎 Para leer archivos/fotos necesito la IA activada. Un administrador puede prenderla en Configuración → 🤖 Asistente IA.' });
    }
    const mime = req.file.mimetype || '';
    const isPdf = /pdf$/i.test(mime) || /\.pdf$/i.test(req.file.originalname || '');
    const isImg = /^image\//i.test(mime) || /\.(jpe?g|png|webp|heic)$/i.test(req.file.originalname || '');
    if (!isPdf && !isImg) return res.status(400).json({ ok: false, error: 'Formato no soportado. Subí un PDF o una foto (JPG/PNG).' });
    let textoPdf = null;
    if (isPdf) {
      try { const pdfParse = await getPdfParse(); textoPdf = (await pdfParse(req.file.buffer)).text || ''; } catch { textoPdf = ''; }
    }
    const doc = await _iaAnalizarDocumento({ buffer: req.file.buffer, mime, filename: req.file.originalname, textoPdf }, ia);
    if (!doc || !doc.tipo) {
      const msg = 'No pude reconocer el documento 🤔. Probá con una foto más nítida o cargalo a mano.';
      const m = await _logMensaje(req.companyId, 'asistente', req.user.id, 'assistant', 'Asistente', msg, { status: 'ayuda', archivo: true });
      return res.json({ ok: true, status: 'ayuda', mensaje: msg, data: m });
    }
    const d = doc.datos || {};
    const nOr = (v) => { const n = Number(String(v == null ? '' : v).replace(/[^\d.-]/g, '')); return isFinite(n) && n > 0 ? n : null; };
    let frase = null, atajo = null, mensaje = doc.resumen || 'Documento analizado.';
    if (doc.tipo === 'gasto') {
      const monto = nOr(d.monto); const concepto = (d.concepto || 'gasto').toString().slice(0, 60);
      frase = monto ? `gasté ${monto} en ${concepto}` : null;
      mensaje = `🧾 Parece un gasto${d.concepto ? ` de ${d.concepto}` : ''}${monto ? ` por $${monto.toLocaleString('es-AR')}` : ''}.`;
    } else if (doc.tipo === 'orden_trabajo') {
      const labor = (d.labor || 'labor').toString(); const lote = d.lote ? String(d.lote) : null; const campo = (d.establecimiento || d.campo) ? String(d.establecimiento || d.campo) : null;
      if (lote && campo) frase = `${labor} en el lote ${lote} de ${campo}`;
      else if (lote) frase = `${labor} en el lote ${lote}`;
      const det = [d.establecimiento && `establecimiento ${d.establecimiento}`, d.lote && `lote ${d.lote}`, d.cultivo && `cultivo ${d.cultivo}`, d.hectareas && `${d.hectareas} ha`, d.contratista && `contratista ${d.contratista}`].filter(Boolean).join(' · ');
      mensaje = `🚜 Es una orden de trabajo (${labor})${det ? '. ' + det : ''}. Te propongo cargar la labor; completá lo que falte.`;
      if (!frase) atajo = { page: 'produccion', label: 'Abrir Producción' };
    } else if (doc.tipo === 'factura_compra') {
      atajo = { page: 'compras', label: 'Abrir Compras' };
      mensaje = `📄 Es una factura de compra${d.proveedor ? ` de ${d.proveedor}` : ''}${nOr(d.total) ? ` por $${nOr(d.total).toLocaleString('es-AR')}` : ''}. Te abro la carga ya completada; revisá y confirmá.`;
    } else if (doc.tipo === 'liquidacion_cereal') {
      atajo = { page: 'liquidaciones', label: 'Abrir Liquidaciones de cereal' };
      mensaje = `🌾 Es una liquidación de cereal${d.grano ? ` (${d.grano})` : ''}. Te abro el formulario ya cargado; completá lo que falte y confirmá.`;
    } else if (doc.tipo === 'liquidacion_animales') {
      atajo = { page: 'liquidacionesHacienda', label: 'Abrir Liquidaciones de animales' };
      mensaje = `🐄 Es una liquidación de animales${d.categoria ? ` (${d.categoria})` : ''}. Te abro el formulario ya cargado; confirmá el campo y la categoría y guardá.`;
    } else if (doc.tipo === 'cheque') {
      atajo = { page: 'cheques', label: 'Abrir Cheques' };
      mensaje = `🧾 Es un cheque${d.banco ? ` del ${d.banco}` : ''}${nOr(d.importe) ? ` por $${nOr(d.importe).toLocaleString('es-AR')}` : ''}. Cargalo en Cheques.`;
    } else {
      mensaje = doc.resumen || 'No pude asociarlo a una acción. Cargalo a mano en la pantalla correspondiente.';
    }
    await _logMensaje(req.companyId, 'asistente', req.user.id, 'assistant', 'Asistente', mensaje, { status: 'ayuda', archivo: true, tipo: doc.tipo });
    res.json({ ok: true, tipo: doc.tipo, resumen: doc.resumen || null, frase, atajo, mensaje });
  } catch (e) { next(e); }
});
// --- Asistente: confirmar (ejecuta la acción propuesta) ---
app.post('/api/asistente/confirmar', requireCompany, async (req, res, next) => {
  try {
    const { accion, params } = req.body || {};
    if (!accion || !params) return res.status(400).json({ ok: false, error: 'Falta la acción a confirmar' });
    // Empresa donde se carga: la que eligió el usuario en el bot (puede ser distinta de la activa).
    // Reasignamos req.companyId/membership para que TODO el flujo (y los permisos) apunten a ella.
    const targetCid = req.body?.companyId || req.companyId;
    if (targetCid !== req.companyId) {
      const mem = (req.user.userCompanies || []).find(uc => uc.companyId === targetCid);
      if (!mem && !req.user.superAdmin) return res.status(403).json({ ok: false, error: 'No tenés acceso a esa empresa.' });
      req.companyId = targetCid;
      req.membership = mem || null;
    }
    let resumen = '';
    const quien = _nombreUser(req.user);
    if (accion === 'hacienda_mov') {
      if (!_permOk(req, 'stock:create')) return res.status(403).json({ ok: false, error: 'No tenés permiso para cargar movimientos de animales.' });
      const campo = await prisma.campo.findFirst({ where: { id: params.campoId, companyId: req.companyId } });
      if (!campo) return res.status(400).json({ ok: false, error: 'Campo no válido' });
      const kilos = params.kilos != null ? Number(params.kilos) : null;
      const precioKg = params.precioKg != null ? Number(params.precioKg) : null;
      const total = params.total != null ? Number(params.total) : ((kilos && precioKg) ? Math.round(kilos * precioKg * 100) / 100 : null);
      await prisma.haciendaMovimiento.create({ data: {
        companyId: req.companyId, campoId: params.campoId, categoria: params.categoria,
        fecha: new Date(), tipo: params.tipo, cantidad: parseInt(params.cantidad, 10) || 0,
        kilos: kilos || null, precioKg: precioKg || null, total: total || null,
        observaciones: `Cargado por ${quien} (asistente)`,
      }});
      resumen = `✅ Registrado: ${params.tipo} de ${params.cantidad} ${params.categoria} en ${campo.nombre}`
        + (kilos ? ` · ${kilos} kg` : '') + (precioKg ? ` · $${precioKg}/kg` : '') + ` · lo cargó ${quien}.`;
      if (params.tipo === 'compra') resumen += ' 💡 Registré el stock. Si querés la factura y el proveedor, cargalos en Compras.';
    } else if (accion === 'labor') {
      if (!_permOk(req, 'produccion:create')) return res.status(403).json({ ok: false, error: 'No tenés permiso para cargar labores.' });
      const camp = await prisma.campana.findFirst({ where: { id: params.campanaId, companyId: req.companyId } });
      if (!camp) return res.status(400).json({ ok: false, error: 'Campaña no válida' });
      await prisma.laborAplicada.create({ data: {
        campanaId: params.campanaId, tipo: params.tipo, fecha: new Date(),
        responsable: params.responsable || null, esServicio: false,
        observaciones: `Cargado por ${quien} (asistente)${params.insumo ? ` · Insumo: ${params.insumo}` : ''}`,
      }});
      let extraStock = '';
      // Insumo: crear en el catálogo si hace falta y/o descontar del stock (según lo que eligió el usuario).
      if (params.insumoNombre && (params.descontarStock || params.crearInsumo)) {
        if (_permOk(req, 'stock:create')) {
          let prod = params.insumoProductoId
            ? await prisma.producto.findFirst({ where: { id: params.insumoProductoId, companyId: req.companyId } })
            : null;
          // Evitar duplicados: si ya existe un insumo con ese nombre, usarlo en vez de crear otro.
          if (!prod) prod = await prisma.producto.findFirst({ where: { companyId: req.companyId, categoria: 'insumos', activo: true, nombre: { equals: params.insumoNombre, mode: 'insensitive' } } });
          if (!prod && params.crearInsumo) {
            const fam = String(params.insumoFamilia || 'Insumo').trim();
            try { await prisma.catalogo.create({ data: { companyId: req.companyId, tipo: fam, nombre: params.insumoNombre } }); } catch {}
            prod = await prisma.producto.create({ data: { companyId: req.companyId, categoria: 'insumos', nombre: params.insumoNombre, unidad: params.insumoUnidad || 'unidad', stockMinimo: 0, activo: true } });
            extraStock += ` · ➕ "${params.insumoNombre}" agregado al catálogo (${fam})`;
          }
          if (prod && params.descontarStock && Number(params.insumoCantidad) > 0) {
            await prisma.movimiento.create({ data: {
              companyId: req.companyId, productoId: prod.id, depositoId: null,
              fecha: new Date(), tipo: 'egreso', motivo: 'aplicacion',
              cantidad: Number(params.insumoCantidad),
              observaciones: `Aplicación en lote ${params.loteNombre || ''} (asistente · ${quien})`,
              userId: req.user?.id || null,
            }});
            extraStock += ` · 📦 descontado del stock (${params.insumoCantidad} ${params.insumoUnidad || ''})`;
          }
        } else { extraStock += ' · (sin permiso de stock: el insumo quedó solo anotado)'; }
      }
      resumen = `✅ Registrada labor de ${params.tipo} en lote ${params.loteNombre||''}${params.insumo?` · ${params.insumo}`:''}${params.responsable?` · responsable ${params.responsable}`:''}${extraStock} · lo cargó ${quien}.`;
    } else if (accion === 'gasto') {
      if (!_permOk(req, 'finanzas:create')) return res.status(403).json({ ok: false, error: 'No tenés permiso para cargar movimientos de caja.' });
      const monto = Number(params.monto);
      if (!monto || monto <= 0) return res.status(400).json({ ok: false, error: 'El monto debe ser mayor a 0.' });
      const tipoMov = params.tipo === 'ingreso' ? 'ingreso' : 'egreso';
      const detalleObs = [
        params.categoria ? `Categoría: ${params.categoria}` : null,
        `Cargado por ${quien} (asistente)`,
      ].filter(Boolean).join(' · ');
      await prisma.efectivo.create({ data: {
        companyId: req.companyId, fecha: params.fecha ? new Date(params.fecha) : new Date(), tipo: tipoMov,
        concepto: params.concepto || (tipoMov === 'ingreso' ? 'Ingreso' : 'Gasto vario'),
        monto, caja: params.caja || null, clasificacion: params.clasificacion || 'empresa',
        observaciones: detalleObs || null,
      }});
      const signo = tipoMov === 'ingreso' ? '💰 Ingreso' : '💸 Gasto';
      resumen = `✅ ${signo} registrado: $${monto.toLocaleString('es-AR')} · ${params.concepto || ''}`
        + (params.categoria ? ` · ${params.categoria}` : '')
        + (params.caja ? ` · caja ${params.caja}` : '')
        + ` · lo cargó ${quien}. Lo ves en Movimientos diarios.`;
    } else if (accion === 'recordatorio') {
      if (!_permOk(req, 'agenda:create')) return res.status(403).json({ ok: false, error: 'No tenés permiso para crear recordatorios.' });
      await prisma.recordatorio.create({ data: {
        companyId: req.companyId, userIdCreador: req.user.id,
        titulo: params.titulo, fecha: new Date(params.fecha), categoria: 'otro', prioridad: 'media',
        descripcion: `Cargado por ${quien} (asistente)`,
      }});
      resumen = `✅ Recordatorio creado: "${params.titulo}" · lo cargó ${quien}.`;
    } else {
      return res.status(400).json({ ok: false, error: 'Acción no soportada' });
    }
    const m = await _logMensaje(req.companyId, 'asistente', req.user.id, 'assistant', 'Asistente', resumen, { status: 'hecho', accion });
    res.json({ ok: true, mensaje: resumen, data: m });
  } catch (e) { next(e); }
});

// ============================================================
// CRÉDITOS BANCARIOS + cuotas
// Al crear un crédito se generan automáticamente las N cuotas con sus
// fechas e importes (sistema francés simplificado: cuota total constante).
// ============================================================
function _calcularCuotasFrances({ monto, tasaAnual, cantCuotas, periodicidad, ivaInteresPct }) {
  // tasa por período (mensual, bimestral, etc.)
  const factor = { mensual: 12, bimestral: 6, trimestral: 4, semestral: 2, anual: 1 }[periodicidad] || 12;
  const i = (tasaAnual || 0) / 100 / factor;
  const ivaPct = Number(ivaInteresPct || 0) / 100;
  let cuotaTotal;
  if (i === 0) {
    cuotaTotal = monto / cantCuotas;
  } else {
    cuotaTotal = monto * (i * Math.pow(1 + i, cantCuotas)) / (Math.pow(1 + i, cantCuotas) - 1);
  }
  // Generar el plan: cada cuota con capital + interés del saldo restante (+ IVA del interés)
  let saldo = monto;
  const cuotas = [];
  for (let n = 1; n <= cantCuotas; n++) {
    const interes = saldo * i;
    const capital = cuotaTotal - interes;
    saldo -= capital;
    const otros = Math.max(interes, 0) * ivaPct; // IVA sobre el interés
    cuotas.push({
      numero: n, capital: Math.max(capital, 0), interes: Math.max(interes, 0),
      otros, total: cuotaTotal + otros,
    });
  }
  return cuotas;
}

app.get('/api/creditos', requireCompany, requirePermission('finanzas:read'), async (req, res, next) => {
  try {
    const data = await prisma.credito.findMany({
      where: { companyId: req.companyId },
      orderBy: { fechaPrimera: 'desc' },
      include: { cuotas: { orderBy: { numero: 'asc' } } },
    });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});

app.get('/api/creditos/:id', requireCompany, requirePermission('finanzas:read'), async (req, res, next) => {
  try {
    const data = await prisma.credito.findFirst({
      where: { id: req.params.id, companyId: req.companyId },
      include: { cuotas: { orderBy: { numero: 'asc' } }, entregasCereal: { orderBy: { fecha: 'desc' } } },
    });
    if (!data) return res.status(404).json({ ok: false, error: 'No encontrado' });
    const resumenCereal = esMonedaGranoCereal(data.moneda) ? _resumenCereal(data, data.entregasCereal) : null;
    res.json({ ok: true, data: { ...data, esCereal: esMonedaGranoCereal(data.moneda), resumenCereal } });
  } catch (e) { next(e); }
});

// Esquema de una cuota cargada a mano (plan manual).
const _cuotaManualSchema = z.object({
  numero: z.number().int().positive(),
  vencimiento: z.coerce.date(),
  importeCapital: z.number().nullable().optional(),
  importeInteres: z.number().nullable().optional(),
  importeOtros: z.number().nullable().optional(),
  importeTotal: z.number().nonnegative(),
});

app.post('/api/creditos', requireCompany, requirePermission('finanzas:create'), async (req, res, next) => {
  try {
    const schema = z.object({
      banco: z.string().min(1),
      nroOperacion: z.string().nullable().optional(),
      montoOriginal: z.number().positive(),
      tasaAnual: z.number().nullable().optional(),
      cantCuotas: z.number().int().positive(),
      periodicidad: z.enum(['mensual', 'bimestral', 'trimestral', 'semestral', 'anual']).default('mensual'),
      fechaPrimera: z.coerce.date(),
      destino: z.string().nullable().optional(),
      moneda: z.string().default('ARS'),
      cotizacionAlta: z.number().positive().nullable().optional(),
      planManual: z.boolean().default(false),
      ivaInteresPct: z.number().nullable().optional(),
      cuotas: z.array(_cuotaManualSchema).optional(),  // requerido si planManual
      observaciones: z.string().nullable().optional(),
    });
    const d = schema.parse(req.body);
    const usaManual = d.planManual && Array.isArray(d.cuotas) && d.cuotas.length > 0;
    let cuotasData;
    if (usaManual) {
      // Plan manual: tomamos las cuotas tal cual las cargó el usuario.
      cuotasData = d.cuotas
        .slice()
        .sort((a, b) => a.numero - b.numero)
        .map((c, idx) => ({
          numero: idx + 1, vencimiento: c.vencimiento,
          importeCapital: Number(c.importeCapital || 0),
          importeInteres: Number(c.importeInteres || 0),
          importeOtros: Number(c.importeOtros || 0),
          importeTotal: Number(c.importeTotal || 0),
        }));
    } else {
      // Plan automático (sistema francés).
      const cuotas = _calcularCuotasFrances({
        monto: d.montoOriginal, tasaAnual: d.tasaAnual || 0,
        cantCuotas: d.cantCuotas, periodicidad: d.periodicidad,
        ivaInteresPct: d.ivaInteresPct || 0,
      });
      const monthsStep = { mensual: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12 }[d.periodicidad];
      cuotasData = cuotas.map(c => {
        const venc = new Date(d.fechaPrimera);
        venc.setMonth(venc.getMonth() + (c.numero - 1) * monthsStep);
        return {
          numero: c.numero, vencimiento: venc,
          importeCapital: c.capital, importeInteres: c.interes,
          importeOtros: c.otros || 0, importeTotal: c.total,
        };
      });
    }
    const cantCuotasEf = usaManual ? cuotasData.length : d.cantCuotas;
    const result = await prisma.$transaction(async (tx) => {
      const cred = await tx.credito.create({
        data: {
          companyId: req.companyId, banco: d.banco, nroOperacion: d.nroOperacion || null,
          montoOriginal: d.montoOriginal, tasaAnual: d.tasaAnual || null,
          cantCuotas: cantCuotasEf, periodicidad: d.periodicidad,
          fechaPrimera: d.fechaPrimera, destino: d.destino || null,
          moneda: d.moneda || 'ARS', cotizacionAlta: d.cotizacionAlta || null,
          planManual: !!usaManual, ivaInteresPct: d.ivaInteresPct || null,
          observaciones: d.observaciones || null,
        },
      });
      await tx.cuotaCredito.createMany({ data: cuotasData.map(c => ({ ...c, creditoId: cred.id })) });
      return cred;
    });
    const fullCred = await prisma.credito.findUnique({
      where: { id: result.id },
      include: { cuotas: { orderBy: { numero: 'asc' } } },
    });
    res.status(201).json({ ok: true, data: fullCred });
  } catch (e) { next(e); }
});

app.put('/api/creditos/:id', requireCompany, requirePermission('finanzas:update'), async (req, res, next) => {
  try {
    const existing = await prisma.credito.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    const schema = z.object({
      banco: z.string().optional(),
      nroOperacion: z.string().nullable().optional(),
      montoOriginal: z.number().positive().optional(),
      tasaAnual: z.number().nullable().optional(),
      cantCuotas: z.number().int().positive().optional(),
      periodicidad: z.enum(['mensual', 'bimestral', 'trimestral', 'semestral', 'anual']).optional(),
      fechaPrimera: z.coerce.date().optional(),
      destino: z.string().nullable().optional(),
      estado: z.enum(['activo', 'cancelado', 'refinanciado']).optional(),
      moneda: z.string().optional(),
      cotizacionAlta: z.number().positive().nullable().optional(),
      planManual: z.boolean().optional(),
      ivaInteresPct: z.number().nullable().optional(),
      cuotas: z.array(_cuotaManualSchema).optional(),
      observaciones: z.string().nullable().optional(),
    });
    const d = schema.parse(req.body);
    const planManualEf = d.planManual !== undefined ? d.planManual : existing.planManual;
    const traeCuotasManual = planManualEf && Array.isArray(d.cuotas) && d.cuotas.length > 0;
    // Valores efectivos del plan (lo que vino, o lo que ya tenía)
    const merged = {
      montoOriginal: d.montoOriginal ?? existing.montoOriginal,
      tasaAnual:     d.tasaAnual !== undefined ? d.tasaAnual : existing.tasaAnual,
      cantCuotas:    d.cantCuotas ?? existing.cantCuotas,
      periodicidad:  d.periodicidad ?? existing.periodicidad,
      fechaPrimera:  d.fechaPrimera ?? existing.fechaPrimera,
      ivaInteresPct: d.ivaInteresPct !== undefined ? d.ivaInteresPct : existing.ivaInteresPct,
    };
    // Plan manual: se regenera SOLO si el usuario manda cuotas nuevas.
    // Plan automático: se regenera si cambió monto/tasa/cantidad/periodicidad/fecha/IVA.
    const planCambio = traeCuotasManual || (!planManualEf && (
      (d.montoOriginal !== undefined && d.montoOriginal !== existing.montoOriginal) ||
      (d.tasaAnual     !== undefined && d.tasaAnual     !== existing.tasaAnual) ||
      (d.cantCuotas    !== undefined && d.cantCuotas    !== existing.cantCuotas) ||
      (d.periodicidad  !== undefined && d.periodicidad  !== existing.periodicidad) ||
      (d.ivaInteresPct !== undefined && d.ivaInteresPct !== existing.ivaInteresPct) ||
      (d.fechaPrimera  !== undefined && new Date(d.fechaPrimera).getTime() !== new Date(existing.fechaPrimera).getTime())
    ));
    let cantCuotasFinal = merged.cantCuotas;
    if (traeCuotasManual) cantCuotasFinal = d.cuotas.length;
    await prisma.$transaction(async (tx) => {
      await tx.credito.update({
        where: { id: existing.id },
        data: {
          banco:         d.banco ?? existing.banco,
          nroOperacion:  d.nroOperacion !== undefined ? d.nroOperacion : existing.nroOperacion,
          montoOriginal: merged.montoOriginal,
          tasaAnual:     merged.tasaAnual,
          cantCuotas:    cantCuotasFinal,
          periodicidad:  merged.periodicidad,
          fechaPrimera:  merged.fechaPrimera,
          destino:       d.destino !== undefined ? d.destino : existing.destino,
          estado:        d.estado ?? existing.estado,
          moneda:        d.moneda ?? existing.moneda,
          cotizacionAlta: d.cotizacionAlta !== undefined ? d.cotizacionAlta : existing.cotizacionAlta,
          planManual:    planManualEf, ivaInteresPct: merged.ivaInteresPct,
          observaciones: d.observaciones !== undefined ? d.observaciones : existing.observaciones,
        },
      });
      if (planCambio) {
        await tx.cuotaCredito.deleteMany({ where: { creditoId: existing.id } });
        let cuotasData;
        if (traeCuotasManual) {
          cuotasData = d.cuotas.slice().sort((a, b) => a.numero - b.numero).map((c, idx) => ({
            creditoId: existing.id, numero: idx + 1, vencimiento: c.vencimiento,
            importeCapital: Number(c.importeCapital || 0), importeInteres: Number(c.importeInteres || 0),
            importeOtros: Number(c.importeOtros || 0), importeTotal: Number(c.importeTotal || 0),
          }));
        } else {
          const cuotas = _calcularCuotasFrances({ monto: merged.montoOriginal, tasaAnual: merged.tasaAnual || 0, cantCuotas: merged.cantCuotas, periodicidad: merged.periodicidad, ivaInteresPct: merged.ivaInteresPct || 0 });
          const monthsStep = { mensual: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12 }[merged.periodicidad];
          cuotasData = cuotas.map(c => {
            const venc = new Date(merged.fechaPrimera);
            venc.setMonth(venc.getMonth() + (c.numero - 1) * monthsStep);
            return { creditoId: existing.id, numero: c.numero, vencimiento: venc, importeCapital: c.capital, importeInteres: c.interes, importeOtros: c.otros || 0, importeTotal: c.total };
          });
        }
        await tx.cuotaCredito.createMany({ data: cuotasData });
      }
    });
    const full = await prisma.credito.findUnique({ where: { id: existing.id }, include: { cuotas: { orderBy: { numero: 'asc' } } } });
    res.json({ ok: true, data: full, planRegenerado: planCambio });
  } catch (e) { next(e); }
});

app.delete('/api/creditos/:id', requireCompany, requirePermission('finanzas:delete'), async (req, res, next) => {
  try {
    const existing = await prisma.credito.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    const cuotasPagadas = await prisma.cuotaCredito.count({ where: { creditoId: req.params.id, pagada: true } });
    if (cuotasPagadas > 0) return res.status(400).json({ ok: false, error: `No se puede eliminar: el crédito tiene ${cuotasPagadas} cuota(s) pagada(s). Deshacé esos pagos primero.` });
    await prisma.credito.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Marcar como pagadas todas las cuotas hasta el número N (para cargar créditos
// viejos que ya vienen con varias cuotas pagas). No genera movimiento bancario.
app.post('/api/creditos/:id/marcar-pagadas-hasta', requireCompany, requirePermission('finanzas:update'), async (req, res, next) => {
  try {
    const credito = await prisma.credito.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!credito) return res.status(404).json({ ok: false, error: 'Crédito no encontrado' });
    const d = z.object({
      numero: z.coerce.number().int().min(0),
      fechaPago: z.coerce.date().optional(),
      medioPago: z.string().optional(),
    }).parse(req.body || {});
    const r = await prisma.cuotaCredito.updateMany({
      where: { creditoId: credito.id, numero: { lte: d.numero }, pagada: false },
      data: { pagada: true, fechaPago: d.fechaPago || new Date(), medioPago: d.medioPago || 'historico' },
    });
    res.json({ ok: true, marcadas: r.count });
  } catch (e) { next(e); }
});

app.put('/api/creditos/:credId/cuotas/:cuotaId/pagar', requireCompany, requirePermission('finanzas:update'), async (req, res, next) => {
  try {
    const credito = await prisma.credito.findFirst({ where: { id: req.params.credId, companyId: req.companyId } });
    if (!credito) return res.status(404).json({ ok: false, error: 'Crédito no encontrado' });
    const cuota = await prisma.cuotaCredito.findFirst({ where: { id: req.params.cuotaId, creditoId: req.params.credId } });
    if (!cuota) return res.status(404).json({ ok: false, error: 'Cuota no encontrada' });
    const schema = z.object({
      fechaPago: z.coerce.date().optional(),
      medioPago: z.enum(['efectivo', 'cheque', 'transferencia', 'debito_automatico', 'tarjeta']).optional(),
      referencia: z.string().nullable().optional(),
      observaciones: z.string().nullable().optional(),
      cuentaBancoId: z.string().nullable().optional(),    // si el pago salió de una cuenta bancaria
      caja: z.string().nullable().optional(),             // caja de efectivo de donde sale el pago
      chequeId: z.string().nullable().optional(),         // cheque con el que se paga
      cotizacionPago: z.number().positive().nullable().optional(), // TC del día (créditos en moneda extranjera)
      gastosExtra: z.number().nullable().optional(),       // gastos/IVA adicional cargado a mano al pagar (en ARS)
    });
    const d = schema.parse(req.body || {});
    const fechaPago = d.fechaPago || new Date();
    // Importe en pesos: si el crédito es en otra moneda, la cuota (en su moneda) se
    // convierte al TC del día que ingresa el usuario. En ARS, es el importe tal cual.
    const esMonedaExt = credito.moneda && credito.moneda !== 'ARS';
    const cotiz = esMonedaExt ? (d.cotizacionPago || credito.cotizacionAlta || 1) : 1;
    const gastosExtra = Number(d.gastosExtra || 0);
    const importeArs = Number(cuota.importeTotal || 0) * cotiz + gastosExtra;
    const result = await prisma.$transaction(async (tx) => {
      const row = await tx.cuotaCredito.update({
        where: { id: req.params.cuotaId },
        data: {
          pagada: true, fechaPago, medioPago: d.medioPago || null,
          referencia: d.referencia || null, observaciones: d.observaciones || null,
          cotizacionPago: esMonedaExt ? cotiz : null,
          importePagadoArs: importeArs,
        },
      });
      // Si pagó por transferencia o débito automático y eligió cuenta bancaria,
      // dejamos el movimiento en el extracto del banco (siempre en pesos).
      if ((d.medioPago === 'transferencia' || d.medioPago === 'debito_automatico') && d.cuentaBancoId) {
        const cuenta = await tx.bancoCuenta.findFirst({ where: { id: d.cuentaBancoId, companyId: req.companyId } });
        if (cuenta) {
          const detMon = esMonedaExt ? ` (${fmtMonedaTxt(credito.moneda, cuota.importeTotal)} @ ${cotiz})` : '';
          const detGastos = gastosExtra ? ` + gastos $${gastosExtra.toLocaleString('es-AR')}` : '';
          await tx.bancoMovimiento.create({
            data: {
              companyId: req.companyId, cuentaId: d.cuentaBancoId,
              fecha: fechaPago, tipo: 'cuota_credito',
              concepto: `Cuota ${cuota.numero} · ${credito.banco}${credito.nroOperacion ? ' #' + credito.nroOperacion : ''}${detMon}${detGastos}`,
              monto: importeArs,
              contraparte: credito.banco, referencia: d.referencia || null,
              cuotaCreditoId: cuota.id, observaciones: d.observaciones || null,
              userId: req.user?.id || null,
            },
          });
        }
      }
      // Pago en EFECTIVO: egreso de la caja elegida. Pago con CHEQUE: se entrega/endosa.
      const concepto = `Cuota ${cuota.numero} · ${credito.banco || ''}${credito.nroOperacion ? ' #' + credito.nroOperacion : ''}`.trim();
      if (d.medioPago === 'efectivo' || d.medioPago === 'tarjeta') {
        await tx.efectivo.create({ data: {
          companyId: req.companyId, fecha: fechaPago, tipo: 'egreso', concepto,
          monto: importeArs, caja: d.caja || null, clasificacion: 'empresa',
          observaciones: [(d.medioPago === 'tarjeta' && d.caja ? 'Tarjeta: ' + d.caja : null), d.observaciones].filter(Boolean).join(' · ') || null,
        }});
      } else if (d.medioPago === 'cheque' && d.chequeId) {
        const ch = await tx.cheque.findFirst({ where: { id: d.chequeId, companyId: req.companyId } });
        if (ch) await tx.cheque.update({ where: { id: ch.id }, data: {
          estado: ch.tipo === 'propio' ? 'entregado' : 'endosado', fechaEndoso: fechaPago,
          enPoderDe: credito.banco || ch.enPoderDe, observaciones: d.observaciones || ch.observaciones,
        }});
      }
      return row;
    });
    res.json({ ok: true, data: result, importePagadoArs: importeArs });
  } catch (e) { next(e); }
});

// ============================================================
// CRÉDITOS POR CEREAL — entregas parciales de grano (comprometido a entregar)
// ============================================================
const GRANO_MONEDAS = { SOJA: 'Soja', MAIZ: 'Maíz', TRIGO: 'Trigo', SORGO: 'Sorgo', GIRASOL: 'Girasol', CEBADA: 'Cebada', CENTENO: 'Centeno', AVENA: 'Avena' };
function esMonedaGranoCereal(m) { return !!GRANO_MONEDAS[String(m || '').toUpperCase()]; }
// Obligación total en toneladas de un crédito de cereal (suma de cuotas o el monto original).
function _obligacionCerealTn(credito) {
  const cuotas = credito.cuotas || [];
  const sumCuotas = cuotas.reduce((a, c) => a + Number(c.importeTotal || 0), 0);
  return sumCuotas > 0.001 ? sumCuotas : Number(credito.montoOriginal || 0);
}
// Fecha límite de entrega = vencimiento de la última cuota (o la primera si no hay).
function _fechaLimiteCereal(credito) {
  const cuotas = credito.cuotas || [];
  if (cuotas.length) return cuotas.reduce((max, c) => (new Date(c.vencimiento) > new Date(max) ? c.vencimiento : max), cuotas[0].vencimiento);
  return credito.fechaPrimera;
}
// Busca (o crea) el producto de grano del stock para la moneda-grano del crédito.
async function _resolverProductoGrano(tx, companyId, moneda, productoIdPreferido) {
  if (productoIdPreferido) {
    const p = await tx.producto.findFirst({ where: { id: productoIdPreferido, companyId } });
    if (p) return p;
  }
  const nombre = GRANO_MONEDAS[String(moneda || '').toUpperCase()] || null;
  if (!nombre) return null;
  let p = await tx.producto.findFirst({ where: { companyId, nombre: { equals: nombre, mode: 'insensitive' } } });
  if (p) return p;
  p = await tx.producto.create({ data: { companyId, categoria: 'granos', nombre, unidad: 'tn', stockMinimo: 0, activo: true } });
  return p;
}
// Resumen de un crédito de cereal: obligación, entregado y pendiente (tn).
function _resumenCereal(credito, entregas) {
  const obligacion = _obligacionCerealTn(credito);
  const entregado = (entregas || []).reduce((a, e) => a + Number(e.cantidad || 0), 0);
  const pendiente = Math.max(0, Math.round((obligacion - entregado) * 1000) / 1000);
  return { obligacion, entregado, pendiente, grano: GRANO_MONEDAS[String(credito.moneda || '').toUpperCase()] || credito.moneda, fechaLimite: _fechaLimiteCereal(credito) };
}

// Lista de entregas de un crédito.
app.get('/api/creditos/:id/entregas', requireCompany, requirePermission('finanzas:read'), async (req, res, next) => {
  try {
    const credito = await prisma.credito.findFirst({ where: { id: req.params.id, companyId: req.companyId }, include: { cuotas: true } });
    if (!credito) return res.status(404).json({ ok: false, error: 'Crédito no encontrado' });
    const entregas = await prisma.entregaCereal.findMany({ where: { creditoId: credito.id, companyId: req.companyId }, orderBy: { fecha: 'desc' } });
    res.json({ ok: true, data: entregas, resumen: _resumenCereal(credito, entregas) });
  } catch (e) { next(e); }
});

// Registrar una entrega parcial de cereal contra el crédito.
app.post('/api/creditos/:id/entregas', requireCompany, requirePermission('finanzas:update'), async (req, res, next) => {
  try {
    const schema = z.object({
      fecha: z.coerce.date(),
      cantidad: z.number().positive(),        // toneladas
      depositoId: z.string().nullable().optional(),
      productoId: z.string().nullable().optional(),
      viajeId: z.string().nullable().optional(),
      precioPizarra: z.number().nonnegative().nullable().optional(),
      observaciones: z.string().nullable().optional(),
      permitirNegativo: z.boolean().optional(),
    });
    const d = schema.parse(req.body);
    const credito = await prisma.credito.findFirst({ where: { id: req.params.id, companyId: req.companyId }, include: { cuotas: { orderBy: { numero: 'asc' } } } });
    if (!credito) return res.status(404).json({ ok: false, error: 'Crédito no encontrado' });
    if (!esMonedaGranoCereal(credito.moneda)) return res.status(400).json({ ok: false, error: 'Este crédito no es en cereal (su moneda no es un grano).' });
    const entregasPrev = await prisma.entregaCereal.findMany({ where: { creditoId: credito.id, companyId: req.companyId } });
    const resumen = _resumenCereal(credito, entregasPrev);
    if (d.cantidad > resumen.pendiente + 0.001) {
      return res.status(400).json({ ok: false, error: `La entrega (${d.cantidad} tn) supera lo pendiente de entregar (${resumen.pendiente} tn).` });
    }
    const result = await prisma.$transaction(async (tx) => {
      // 1) Egreso de stock del depósito que sale.
      const prod = await _resolverProductoGrano(tx, req.companyId, credito.moneda, d.productoId);
      let movimientoId = null;
      if (prod) {
        const mov = await tx.movimiento.create({ data: {
          companyId: req.companyId, productoId: prod.id,
          fecha: d.fecha, tipo: 'egreso', motivo: 'entrega_credito',
          cantidad: d.cantidad, precio: d.precioPizarra || null,
          total: d.precioPizarra ? d.cantidad * d.precioPizarra : null,
          referencia: 'CREDITO ' + (credito.nroOperacion || credito.banco || ''),
          depositoId: d.depositoId || null,
          observaciones: `Entrega de cereal a cuenta del crédito ${credito.banco || ''}${credito.nroOperacion ? ' #' + credito.nroOperacion : ''}${d.observaciones ? ' · ' + d.observaciones : ''}`,
          userId: req.user?.id || null,
        }});
        movimientoId = mov.id;
      }
      // 2) Registrar la entrega.
      const entrega = await tx.entregaCereal.create({ data: {
        companyId: req.companyId, creditoId: credito.id,
        fecha: d.fecha, cantidad: d.cantidad,
        productoId: prod?.id || null, depositoId: d.depositoId || null,
        viajeId: d.viajeId || null, movimientoId,
        precioPizarra: d.precioPizarra || null, observaciones: d.observaciones || null,
      }});
      // 3) Marcar cuotas pagadas de forma acumulativa (pago parcial en grano).
      const entregadoNew = resumen.entregado + d.cantidad;
      let running = 0;
      for (const c of credito.cuotas) {
        running += Number(c.importeTotal || 0);
        if (!c.pagada && running <= entregadoNew + 0.001) {
          await tx.cuotaCredito.update({ where: { id: c.id }, data: { pagada: true, fechaPago: d.fecha, medioPago: 'entrega_cereal', observaciones: (c.observaciones ? c.observaciones + ' · ' : '') + 'Cubierta con entrega de cereal' } });
        }
      }
      // 4) Si se completó la obligación, marcar el crédito cancelado.
      if (entregadoNew >= resumen.obligacion - 0.001) {
        await tx.credito.update({ where: { id: credito.id }, data: { estado: 'cancelado' } });
      }
      return entrega;
    });
    res.status(201).json({ ok: true, data: result });
  } catch (e) { next(e); }
});

// Revertir (borrar) una entrega de cereal: devuelve el stock y reabre las cuotas.
app.delete('/api/creditos/:id/entregas/:eid', requireCompany, requirePermission('finanzas:delete'), async (req, res, next) => {
  try {
    const credito = await prisma.credito.findFirst({ where: { id: req.params.id, companyId: req.companyId }, include: { cuotas: { orderBy: { numero: 'asc' } } } });
    if (!credito) return res.status(404).json({ ok: false, error: 'Crédito no encontrado' });
    const entrega = await prisma.entregaCereal.findFirst({ where: { id: req.params.eid, creditoId: credito.id, companyId: req.companyId } });
    if (!entrega) return res.status(404).json({ ok: false, error: 'Entrega no encontrada' });
    await prisma.$transaction(async (tx) => {
      if (entrega.movimientoId) { await tx.movimiento.deleteMany({ where: { id: entrega.movimientoId, companyId: req.companyId } }); }
      await tx.entregaCereal.delete({ where: { id: entrega.id } });
      // Recalcular entregado y reabrir cuotas que ya no estén cubiertas.
      const restantes = await tx.entregaCereal.findMany({ where: { creditoId: credito.id, companyId: req.companyId } });
      const entregado = restantes.reduce((a, e) => a + Number(e.cantidad || 0), 0);
      let running = 0;
      for (const c of credito.cuotas) {
        running += Number(c.importeTotal || 0);
        if (c.pagada && c.medioPago === 'entrega_cereal' && running > entregado + 0.001) {
          await tx.cuotaCredito.update({ where: { id: c.id }, data: { pagada: false, fechaPago: null, medioPago: null } });
        }
      }
      if (credito.estado === 'cancelado') await tx.credito.update({ where: { id: credito.id }, data: { estado: 'activo' } });
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Resumen de compromisos de entrega de cereal (para avisos, Flujo de Fondos y Dashboard).
app.get('/api/compromisos-cereal', requireCompany, requirePermission('finanzas:read'), async (req, res, next) => {
  try {
    const creditos = await prisma.credito.findMany({
      where: { companyId: req.companyId, estado: { not: 'cancelado' } },
      include: { cuotas: true, entregasCereal: true },
    });
    const hoy = new Date();
    const data = [];
    for (const c of creditos) {
      if (!esMonedaGranoCereal(c.moneda)) continue;
      const r = _resumenCereal(c, c.entregasCereal);
      if (r.pendiente <= 0.001) continue;
      data.push({
        creditoId: c.id, banco: c.banco, nroOperacion: c.nroOperacion || null,
        moneda: c.moneda, grano: r.grano,
        obligacion: r.obligacion, entregado: r.entregado, pendiente: r.pendiente,
        fechaLimite: r.fechaLimite,
        vencido: r.fechaLimite ? new Date(r.fechaLimite) < hoy : false,
      });
    }
    const totalPendiente = data.reduce((a, x) => a + x.pendiente, 0);
    res.json({ ok: true, data, totalPendiente });
  } catch (e) { next(e); }
});

// Mueve el recurso REAL (caja de efectivo / cheque / banco) de la empresa actual
// para un pago diario. Deja el asiento en el módulo correspondiente, que es lo que
// alimenta "Movimientos diarios". Devuelve el registro creado/actualizado.
async function _moverRecursoPagoDiario(tx, req, o) {
  const obs = o.observaciones || null;
  if (o.metodo === 'efectivo' || o.metodo === 'externo' || o.metodo === 'tarjeta') {
    // "tarjeta" (tarjeta de crédito, solo etiqueta) y "externo" (billetera) se
    // registran como una caja del módulo Efectivo con su nombre. NO tocan bancos.
    return tx.efectivo.create({ data: {
      companyId: req.companyId, fecha: o.fecha, tipo: 'egreso', concepto: o.concepto,
      monto: o.monto, caja: o.caja || null, clasificacion: o.clasificacion || 'empresa', observaciones: obs,
    }});
  }
  if (o.metodo === 'transferencia' || o.metodo === 'debito') {
    if (!o.bancoCuentaId) throw Object.assign(new Error('Falta la cuenta bancaria'), { status: 400 });
    const cuenta = await tx.bancoCuenta.findFirst({ where: { id: o.bancoCuentaId, companyId: req.companyId } });
    if (!cuenta) throw Object.assign(new Error('Cuenta bancaria no encontrada'), { status: 404 });
    const tipoMov = o.metodo === 'debito' ? 'debito' : 'transferencia_out';
    return tx.bancoMovimiento.create({ data: {
      companyId: req.companyId, cuentaId: o.bancoCuentaId, fecha: o.fecha, tipo: tipoMov,
      concepto: o.concepto, monto: o.monto, contraparte: o.contraparte || null, observaciones: obs,
      userId: req.user?.id || null,
    }});
  }
  if (o.metodo === 'cheque') {
    if (!o.chequeId) throw Object.assign(new Error('Falta el cheque'), { status: 400 });
    const ch = await tx.cheque.findFirst({ where: { id: o.chequeId, companyId: req.companyId } });
    if (!ch) throw Object.assign(new Error('Cheque no encontrado'), { status: 404 });
    const nuevoEstado = ch.tipo === 'propio' ? 'entregado' : 'endosado';
    return tx.cheque.update({ where: { id: ch.id }, data: {
      estado: nuevoEstado, beneficiario: o.contraparte || ch.beneficiario, fechaEndoso: o.fecha,
      enPoderDe: o.contraparte || ch.enPoderDe, observaciones: obs || ch.observaciones,
    }});
  }
  throw Object.assign(new Error('Método de pago inválido'), { status: 400 });
}

// Pagar una cuota de arrendamiento (por índice) con cualquier método. Marca la cuota
// como pagada y refleja el egreso en Movimientos diarios (caja/cheque/banco).
app.put('/api/arrendamientos/:id/cuotas/:idx/pagar', requireCompany, requirePermission('finanzas:update'), async (req, res, next) => {
  try {
    const arr = await prisma.arrendamiento.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!arr) return res.status(404).json({ ok: false, error: 'Arrendamiento no encontrado' });
    const idx = Number(req.params.idx);
    const cuotas = Array.isArray(arr.cuotas) ? arr.cuotas.map(c => ({ ...c })) : [];
    if (!cuotas[idx]) return res.status(404).json({ ok: false, error: 'Cuota no encontrada' });
    if (cuotas[idx].pagado) return res.status(400).json({ ok: false, error: 'La cuota ya está pagada' });
    const schema = z.object({
      fecha: z.coerce.date().optional(),
      metodo: z.enum(['efectivo', 'cheque', 'transferencia', 'debito', 'externo', 'tarjeta']),
      monto: z.number().positive(),
      caja: z.string().nullable().optional(),
      chequeId: z.string().nullable().optional(),
      bancoCuentaId: z.string().nullable().optional(),
      contraparte: z.string().nullable().optional(),
      observaciones: z.string().nullable().optional(),
    });
    const d = schema.parse(req.body || {});
    const fecha = d.fecha || new Date();
    const concepto = `Arrendamiento ${arr.propietario}${cuotas[idx].etiqueta ? ' · ' + cuotas[idx].etiqueta : ''}`;
    const result = await prisma.$transaction(async (tx) => {
      await _moverRecursoPagoDiario(tx, req, {
        metodo: d.metodo, monto: d.monto, fecha, concepto,
        caja: d.caja, chequeId: d.chequeId, bancoCuentaId: d.bancoCuentaId,
        contraparte: d.contraparte || arr.propietario, observaciones: d.observaciones,
      });
      cuotas[idx] = { ...cuotas[idx], pagado: true, pago: {
        fecha, metodo: d.metodo, monto: d.monto,
        caja: d.caja || null, chequeId: d.chequeId || null, bancoCuentaId: d.bancoCuentaId || null,
      }};
      const todasPagas = cuotas.length > 0 && cuotas.every(c => c.pagado);
      return tx.arrendamiento.update({ where: { id: arr.id }, data: { cuotas, pagado: todasPagas ? true : arr.pagado } });
    });
    res.json({ ok: true, data: result });
  } catch (e) { next(e); }
});

// ============================================================
// LABOR AVANZADA: carga una labor con insumos consumidos + empleado %
// Diferencia con /api/aplicaciones: maneja stock real de insumos y crea
// un MovimientoEmpleado en la planilla del empleado si cobra porcentaje.
// ============================================================
app.post('/api/labores-avanzada', requireCompany, requirePermission('produccion:create'), async (req, res, next) => {
  try {
    const insumoItemSchema = z.object({
      productoId: z.string(),
      cantidad: z.number().positive(),
      precioUnit: z.number().nullable().optional(),
      observaciones: z.string().nullable().optional(),
    });
    const schema = z.object({
      campanaId: z.string().nullable().optional(),
      esServicio: z.boolean().optional(),        // labor realizada a un tercero (facturable)
      clienteId: z.string().nullable().optional(),
      tipo: z.string().min(1),
      fecha: z.coerce.date(),
      hectareasAplicadas: z.number().nullable().optional(),
      costo: z.number().nullable().optional(),
      monedaCosto: z.string().nullable().optional(),
      observaciones: z.string().nullable().optional(),
      empleadoId: z.string().nullable().optional(),
      precioReferencia: z.number().nullable().optional(),
      tipoPrecio: z.enum(['por_hectarea', 'total']).nullable().optional(),
      porcentajeEmpleado: z.number().nullable().optional(),
      // Varios empleados que hicieron la MISMA labor (ej. un lote sembrado entre 2).
      // Cada uno con las hectáreas que hizo y su % de cobro. Si no se manda, se usa
      // empleadoId/porcentajeEmpleado (compatibilidad con la versión anterior).
      empleados: z.array(z.object({
        empleadoId: z.string(),
        hectareas: z.number().nullable().optional(),
        porcentaje: z.number().nullable().optional(),
      })).optional(),
      insumos: z.array(insumoItemSchema).default([]),
    });
    const d = schema.parse(req.body);
    // Servicio a terceros: requiere cliente; la campaña es opcional (labor sin campo propio).
    if (d.esServicio) {
      if (!d.clienteId) return res.status(400).json({ ok: false, error: 'Elegí el cliente del servicio' });
      const cli = await prisma.cliente.findFirst({ where: { id: d.clienteId, companyId: req.companyId } });
      if (!cli) return res.status(404).json({ ok: false, error: 'Cliente no encontrado' });
    }
    if (d.campanaId) {
      const camp = await prisma.campana.findFirst({ where: { id: d.campanaId, companyId: req.companyId } });
      if (!camp) return res.status(404).json({ ok: false, error: 'Campaña no encontrada' });
    } else if (!d.esServicio) {
      return res.status(400).json({ ok: false, error: 'Falta la campaña' });
    }

    // Normalizamos la lista de empleados (nuevo formato array, o el viejo simple).
    let listaEmp = [];
    if (Array.isArray(d.empleados) && d.empleados.length) {
      listaEmp = d.empleados.filter(e => e.empleadoId);
    } else if (d.empleadoId) {
      listaEmp = [{ empleadoId: d.empleadoId, hectareas: d.hectareasAplicadas ?? null, porcentaje: d.porcentajeEmpleado ?? null }];
    }
    // Traemos los empleados y calculamos la ganancia de cada uno.
    const baseDe = (haEmp) => d.tipoPrecio === 'por_hectarea'
      ? Number(haEmp != null ? haEmp : (d.hectareasAplicadas || 0)) * Number(d.precioReferencia || 0)
      : Number(d.precioReferencia || 0);
    const empCalcs = [];
    for (const e of listaEmp) {
      const emp = await prisma.empleado.findFirst({ where: { id: e.empleadoId, companyId: req.companyId } });
      if (!emp) return res.status(404).json({ ok: false, error: 'Empleado no encontrado' });
      const pct = e.porcentaje != null ? e.porcentaje : (emp.porcentajeDefault ?? null);
      let ganancia = null;
      if (emp.cobraPorcentaje && d.precioReferencia != null && pct != null) {
        ganancia = baseDe(e.hectareas) * (pct / 100);
      }
      empCalcs.push({ emp, hectareas: e.hectareas ?? null, porcentaje: pct, ganancia });
    }
    const gananciaTotal = empCalcs.reduce((a, c) => a + (c.ganancia || 0), 0) || null;
    const responsable = empCalcs.length ? empCalcs.map(c => `${c.emp.nombre} ${c.emp.apellido}`).join(' + ') : null;
    const primero = empCalcs[0] || null;

    const result = await prisma.$transaction(async (tx) => {
      // 1) Crear la labor (el primer empleado queda como referencia principal)
      const labor = await tx.laborAplicada.create({
        data: {
          campanaId: d.campanaId || null,
          esServicio: d.esServicio || false,
          clienteId: d.esServicio ? (d.clienteId || null) : null,
          tipo: d.tipo, fecha: d.fecha,
          hectareasAplicadas: d.hectareasAplicadas ?? null,
          costo: d.costo ?? null,
          monedaCosto: d.monedaCosto || 'USD',
          observaciones: d.observaciones || null,
          empleadoId: primero ? primero.emp.id : null,
          precioReferencia: d.precioReferencia ?? null,
          tipoPrecio: d.tipoPrecio || null,
          porcentajeEmpleado: primero ? (primero.porcentaje ?? null) : null,
          gananciaEmpleado: gananciaTotal,
          responsable,
        },
      });
      // 2) Insumos consumidos: por cada uno, crear LaborInsumo + movimiento de egreso
      for (const it of d.insumos) {
        const prod = await tx.producto.findFirst({ where: { id: it.productoId, companyId: req.companyId } });
        if (!prod) throw Object.assign(new Error('Insumo no encontrado: ' + it.productoId), { status: 400 });
        const total = (it.precioUnit || 0) * it.cantidad;
        const mov = await tx.movimiento.create({
          data: {
            companyId: req.companyId, productoId: it.productoId, depositoId: null,
            fecha: d.fecha, tipo: 'egreso', motivo: 'aplicacion',
            cantidad: it.cantidad, precio: it.precioUnit ?? null, total: total || null,
            referencia: `LAB-${labor.id.slice(-6).toUpperCase()}`,
            observaciones: `Consumido en labor: ${d.tipo}`,
            userId: req.user?.id || null,
          },
        });
        await tx.laborInsumo.create({
          data: {
            laborId: labor.id, productoId: it.productoId,
            cantidad: it.cantidad, unidad: prod.unidad,
            precioUnit: it.precioUnit ?? null, total: total || null,
            movimientoId: mov.id, observaciones: it.observaciones || null,
          },
        });
      }
      // 3) Ganancia: un MovimientoEmpleado por cada empleado que cobra %.
      const periodo = d.fecha.toISOString().slice(0, 7); // YYYY-MM
      let primerMovEmpId = null;
      for (const c of empCalcs) {
        if (c.ganancia != null && c.ganancia > 0) {
          const haTxt = (c.hectareas != null ? c.hectareas : d.hectareasAplicadas);
          const movEmp = await tx.movimientoEmpleado.create({
            data: {
              companyId: req.companyId, empleadoId: c.emp.id,
              fecha: d.fecha, periodo, tipo: 'ganancia', categoria: 'labor',
              concepto: `Labor ${d.tipo}${haTxt ? ' · ' + haTxt + ' ha' : ''} (${c.porcentaje}%)`,
              monto: c.ganancia,
              observaciones: `Generado automáticamente por labor ${labor.id}`,
            },
          });
          if (!primerMovEmpId) primerMovEmpId = movEmp.id;
        }
      }
      if (primerMovEmpId) {
        await tx.laborAplicada.update({ where: { id: labor.id }, data: { movimientoEmpleadoId: primerMovEmpId } });
      }
      return labor;
    });
    res.status(201).json({ ok: true, data: result });
  } catch (e) { next(e); }
});

// ============================================================
// SERVICIOS A TERCEROS: labores facturables realizadas a un cliente.
// (Son LaborAplicada con esServicio=true y campanaId null.)
// ============================================================
app.get('/api/labores-servicio', requireCompany, requirePermission('produccion:read'), async (req, res, next) => {
  try {
    // Scope por empresa vía el cliente (LaborAplicada no tiene companyId propio).
    const labs = await prisma.laborAplicada.findMany({
      where: { esServicio: true, cliente: { companyId: req.companyId } },
      orderBy: { fecha: 'desc' },
      include: {
        cliente: true,
        empleado: true,
        insumos: true,   // LaborInsumo no tiene relación 'producto'; resolvemos el nombre aparte
      },
    });
    // Nombres de los productos consumidos (sin relación en el modelo).
    const prodIds = [...new Set(labs.flatMap(l => l.insumos.map(i => i.productoId)).filter(Boolean))];
    const prods = prodIds.length
      ? await prisma.producto.findMany({ where: { id: { in: prodIds }, companyId: req.companyId }, select: { id: true, nombre: true } })
      : [];
    const prodNombre = Object.fromEntries(prods.map(p => [p.id, p.nombre]));
    // Resolvemos las facturas vinculadas (para saber cuáles ya se facturaron).
    const facIds = labs.map(l => l.facturaId).filter(Boolean);
    const facs = facIds.length
      ? await prisma.factura.findMany({ where: { id: { in: facIds }, companyId: req.companyId } })
      : [];
    const facById = Object.fromEntries(facs.map(f => [f.id, f]));
    const data = labs.map(l => {
      const fac = l.facturaId ? facById[l.facturaId] : null;
      return {
        id: l.id,
        fecha: l.fecha,
        tipo: l.tipo,
        clienteId: l.clienteId,
        clienteNombre: l.cliente?.nombre || l.cliente?.razonSocial || '—',
        empleadoId: l.empleadoId || null,
        empleadoNombre: l.empleado ? `${l.empleado.apellido || ''}, ${l.empleado.nombre || ''}`.replace(/^,\s*/, '').trim() : null,
        hectareasAplicadas: l.hectareasAplicadas,
        precioReferencia: l.precioReferencia,
        tipoPrecio: l.tipoPrecio,
        costo: l.costo,
        moneda: l.monedaCosto || 'ARS',
        responsable: l.responsable,
        gananciaEmpleado: l.gananciaEmpleado,
        observaciones: l.observaciones,
        // Precio total de la labor cobrado al cliente (sin insumos).
        precioLabor: l.tipoPrecio === 'por_hectarea'
          ? Number(l.precioReferencia || 0) * Number(l.hectareasAplicadas || 0)
          : Number(l.precioReferencia || 0),
        insumos: l.insumos.map(i => ({
          id: i.id, productoId: i.productoId,
          nombre: prodNombre[i.productoId] || '—', unidad: i.unidad,
          cantidad: i.cantidad, precioUnit: i.precioUnit, total: i.total,
        })),
        facturaId: l.facturaId || null,
        facturado: !!fac,
        factura: fac ? {
          id: fac.id, tipo: fac.tipo, puntoVenta: fac.puntoVenta,
          numero: fac.numero, total: fac.total, estado: fac.estado,
        } : null,
      };
    });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});

// ============================================================
// FLUJO PROYECTADO ("estado de situación"): unifica ingresos y egresos
// futuros desde múltiples fuentes y los ordena por fecha.
// ============================================================
// === HELPER: arma la data del Estado de situación ===
// Devuelve items, vencidos, saldo inicial, serie acumulada y totales.
// Acepta una o varias companies. Si se pasan varias y el user no es super admin,
// se filtran a las que tiene acceso.
async function _construirFlujoProyectado(req, opts = {}) {
  const dias = Number(opts.dias || req.query.dias || 180);
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const horizonte = new Date(hoy);
  horizonte.setDate(horizonte.getDate() + dias);

  // Resolver empresas a incluir
  let companyIds = [req.companyId];
  const requested = opts.empresas || req.query.empresas;
  if (requested) {
    const arr = String(requested).split(',').map(s => s.trim()).filter(Boolean);
    if (arr.length) {
      if (req.user.superAdmin) {
        companyIds = arr;
      } else {
        const userCmps = new Set((req.user.userCompanies || []).map(uc => uc.companyId));
        companyIds = arr.filter(id => userCmps.has(id));
        if (!companyIds.length) companyIds = [req.companyId];
      }
    }
  }

  // === Saldo inicial (idea 1) ===
  // Sumamos saldos de cuentas bancarias (ARS/USD por separado) + efectivo en cajas.
  const cuentas = await prisma.bancoCuenta.findMany({
    where: { companyId: { in: companyIds }, activo: true },
  });
  const cuentasIds = cuentas.map(c => c.id);
  const movsAgg = cuentasIds.length ? await prisma.bancoMovimiento.groupBy({
    by: ['cuentaId', 'tipo'],
    where: { cuentaId: { in: cuentasIds } },
    _sum: { monto: true },
  }) : [];
  const saldoPorCuenta = {};
  for (const c of cuentas) saldoPorCuenta[c.id] = { moneda: c.moneda || 'ARS', saldo: Number(c.saldoInicial || 0) };
  for (const m of movsAgg) {
    const sign = BANCO_TIPOS_INGRESO.includes(m.tipo) ? 1 : (BANCO_TIPOS_EGRESO.includes(m.tipo) ? -1 : 0);
    if (saldoPorCuenta[m.cuentaId]) saldoPorCuenta[m.cuentaId].saldo += sign * Number(m._sum.monto || 0);
  }
  let bancosARS = 0, bancosUSD = 0;
  for (const v of Object.values(saldoPorCuenta)) {
    if (v.moneda === 'USD') bancosUSD += v.saldo; else bancosARS += v.saldo;
  }
  // Efectivo: sumar ingresos − egresos en cajas (excluye transferencias entre cajas)
  const efectivos = await prisma.efectivo.findMany({
    where: { companyId: { in: companyIds }, tipo: { in: ['ingreso', 'egreso'] } },
    select: { tipo: true, monto: true },
  });
  let efectivoTotal = 0;
  for (const e of efectivos) {
    efectivoTotal += (e.tipo === 'ingreso' ? 1 : -1) * Number(e.monto || 0);
  }
  const saldoInicialARS = bancosARS + efectivoTotal;

  // === Items proyectados y vencidos ===
  const items = [];
  const vencidos = [];
  function push(fecha, ev) {
    const f = new Date(fecha);
    f.setHours(0,0,0,0);
    if (f < hoy) vencidos.push({ ...ev, fecha: f });
    else if (f <= horizonte) items.push({ ...ev, fecha: f });
  }

  // 1) Cheques
  const cheques = await prisma.cheque.findMany({
    where: { companyId: { in: companyIds } },
  });
  const estadosOk = ['en_cartera', 'pendiente', 'emitido', 'depositado'];
  for (const ch of cheques) {
    if (!estadosOk.includes(ch.estado || '')) continue;
    if (!ch.fechaPago) continue;
    const esIngreso = ch.tipo === 'terceros';
    push(ch.fechaPago, {
      tipo: esIngreso ? 'ingreso' : 'egreso',
      categoria: 'cheque',
      concepto: `${esIngreso ? 'Cheque de terceros' : 'Cheque propio'} ${ch.nroCheque || ''} ${ch.banco || ''}`.trim(),
      importe: Number(ch.monto || 0), ref: ch.id,
      contacto: ch.beneficiario || ch.librador || null,
      empresaId: ch.companyId,
    });
  }

  // 2) Cuentas corrientes (debe / haber)
  const ctas = await prisma.ctaCte.findMany({
    where: { companyId: { in: companyIds }, vencimiento: { not: null }, pagado: false },
  });
  for (const c of ctas) {
    const debe = Number(c.debe || 0);
    const haber = Number(c.haber || 0);
    const saldo = debe - haber;
    if (Math.abs(saldo) < 0.01) continue;
    // El signo depende del TIPO de contacto:
    //  - proveedor: saldo a favor de él (debe) = le vamos a PAGAR → egreso.
    //  - cliente: saldo a su cargo (debe) = nos va a PAGAR → ingreso.
    //  - libre/otros: debe = a cobrar (ingreso), haber = a pagar (egreso).
    let tipo, montoOrigen;
    if (c.contactoTipo === 'proveedor') { tipo = saldo > 0 ? 'egreso' : 'ingreso'; montoOrigen = Math.abs(saldo); }
    else if (c.contactoTipo === 'cliente') { tipo = saldo > 0 ? 'ingreso' : 'egreso'; montoOrigen = Math.abs(saldo); }
    else if (debe > 0 && haber === 0) { tipo = 'ingreso'; montoOrigen = debe; }
    else if (haber > 0 && debe === 0) { tipo = 'egreso'; montoOrigen = haber; }
    else continue;
    const moneda = c.moneda || 'ARS';
    const cot = moneda === 'ARS' ? 1 : (c.cotizacion || 1);
    push(c.vencimiento, {
      tipo, categoria: 'cta_cte',
      concepto: c.detalle || c.nombreLibre || 'Cuenta corriente',
      importe: montoOrigen * cot,   // ARS-equivalente (para display por defecto)
      moneda, montoOrigen,          // para reproyectar en otra moneda / simulador
      ref: c.id,
      contacto: c.nombreLibre || c.contactoTipo || null,
      empresaId: c.companyId,
    });
  }

  // 3) Cuotas de créditos no pagadas
  const cuotas = await prisma.cuotaCredito.findMany({
    where: { credito: { companyId: { in: companyIds } }, pagada: false },
    include: { credito: { select: { banco: true, nroOperacion: true, companyId: true } } },
  });
  for (const q of cuotas) {
    push(q.vencimiento, {
      tipo: 'egreso', categoria: 'credito',
      concepto: `Cuota ${q.numero} · ${q.credito.banco}${q.credito.nroOperacion ? ' #' + q.credito.nroOperacion : ''}`,
      importe: Number(q.importeTotal || 0), ref: q.id,
      contacto: q.credito.banco,
      empresaId: q.credito.companyId,
    });
  }

  // 4) Liquidaciones de cereal
  const liqs = await prisma.liquidacionCereal.findMany({
    where: { companyId: { in: companyIds }, fechaCobroEst: { not: null }, cobrado: false },
    include: { deposito: { select: { nombre: true } } },
  });
  for (const l of liqs) {
    push(l.fechaCobroEst, {
      tipo: 'ingreso', categoria: 'cereal',
      concepto: `Liquidación cereal · ${l.deposito?.nombre || 'Cerealera'}`,
      importe: Number(l.neto || 0), ref: l.id,
      empresaId: l.companyId,
    });
  }

  // 5) Arrendamientos (valoriza cuotas en especie / kg novillo / efectivo a la
  //    última cotización conocida y proyecta cada cuota en su vencimiento).
  const _cotRows = await prisma.cotizacion.findMany({ where: { companyId: null }, orderBy: { fecha: 'desc' } });
  const _cotMap = {}; for (const cr of _cotRows) { if (_cotMap[cr.moneda] == null) _cotMap[cr.moneda] = Number(cr.valor || 0); }
  // Respaldo: si la tabla no tiene la cotización, usamos la del scraping en vivo.
  for (const [k, v] of Object.entries(_liveCotizMap())) { if (_cotMap[k] == null || !_cotMap[k]) _cotMap[k] = v; }
  const _arrCot = (mon) => (!mon || mon === 'ARS') ? 1 : Number(_cotMap[mon] || 0);
  const arrs = await prisma.arrendamiento.findMany({
    where: { companyId: { in: companyIds }, pagado: false },
    include: { campo: { select: { nombre: true } } },
  });
  for (const a of arrs) {
    const mod = a.modalidad || (a.tipoPago === 'En especie' ? 'quintales' : (a.tipoPago === 'Porcentual' ? 'porcentaje' : (a.tipoPago === 'Kg Novillo' ? 'kgnovillo' : 'efectivo')));
    if (mod === 'porcentaje') continue; // depende del rinde: no proyectable
    const ha = Number(a.hectareas || 0);
    const valQq  = (qqHa) => Number(qqHa || 0) * ha * 0.1 * _arrCot(_claveGrano(a.grano));
    const valKgn = (kg)   => Number(kg || 0) * _arrCot('KGN');
    const valEf  = (imp)  => Number(imp || 0) * _arrCot(a.moneda || 'ARS');
    const nombre = (extra) => `Arrendamiento ${a.propietario}${extra ? ' · ' + extra : ''}${a.campo?.nombre ? ' · ' + a.campo.nombre : ''}`;
    const cuotasArr = Array.isArray(a.cuotas) ? a.cuotas.filter(c => !c.pagado) : [];
    if (cuotasArr.length) {
      for (const c of cuotasArr) {
        if (!c.vencimiento) continue;
        // Cantidad cargada en la cuota (qq/ha, kg novillo o importe). Si es 0, la
        // cuota está vacía y se saltea. Si tiene cantidad pero falta la cotización,
        // igual se muestra el vencimiento (importe estimado 0 hasta cargar pizarra).
        const raw = mod === 'quintales' ? Number(c.quintalesHa || 0) : mod === 'kgnovillo' ? Number(c.kgNovillo || 0) : Number(c.importe || 0);
        if (raw <= 0) continue;
        const importe = mod === 'quintales' ? valQq(c.quintalesHa) : mod === 'kgnovillo' ? valKgn(c.kgNovillo) : valEf(c.importe);
        push(c.vencimiento, {
          tipo: 'egreso', categoria: 'arrendamiento',
          concepto: nombre(c.etiqueta), importe, ref: a.id, contacto: a.propietario,
          empresaId: a.companyId,
        });
      }
    } else if (a.vencimiento) {
      const rawU = mod === 'quintales'
        ? (Number(a.quintalesHaBlanco || 0) + Number(a.quintalesHaNegro || 0))
        : mod === 'kgnovillo' ? Number(a.kgNovilloHa || a.importeHa || 0)
        : Number(a.importeHa || 0);
      const importe = mod === 'quintales'
        ? valQq(Number(a.quintalesHaBlanco || 0) + Number(a.quintalesHaNegro || 0))
        : mod === 'kgnovillo' ? valKgn(Number(a.kgNovilloHa || a.importeHa || 0) * ha)
        : valEf(Number(a.importeHa || 0) * ha);
      if (rawU > 0) push(a.vencimiento, {
        tipo: 'egreso', categoria: 'arrendamiento',
        concepto: nombre(), importe, ref: a.id, contacto: a.propietario,
        empresaId: a.companyId,
      });
    }
  }

  // 6) Facturas de venta pendientes de cobro (cta corriente, no anuladas)
  //    Tomamos vencimiento estimado como fecha + 30 días si no hay campo explícito.
  const facturas = await prisma.factura.findMany({
    where: { companyId: { in: companyIds }, estado: { not: 'anulada' }, condicionVenta: 'cuenta_corriente' },
    include: { cliente: { select: { razonSocial: true } } },
  });
  for (const f of facturas) {
    // Estimar vencimiento: 30 días después de la fecha de emision
    const venc = new Date(f.fecha);
    venc.setDate(venc.getDate() + 30);
    // Si ya cobró (se podría detectar por CtaCte pagada), saltamos. Por simplicidad
    // asumimos que la CtaCte que genera la factura es la fuente de verdad. Para no
    // duplicar con item #2, NO incluimos facturas que tengan una CtaCte abierta del
    // mismo importe. Como heurística simple: solo incluimos si no existe CtaCte
    // con referencia a esta factura. Pero el modelo CtaCte no guarda facturaId,
    // así que por ahora SIEMPRE las metemos pero las marcamos con categoría
    // "factura" para que el usuario pueda filtrarlas si percibe duplicado.
    const fMon = f.moneda || 'ARS';
    const fCot = fMon === 'ARS' ? 1 : (f.cotizacion || 1);
    push(venc, {
      tipo: 'ingreso', categoria: 'factura',
      concepto: `Factura ${f.tipo}-${f.puntoVenta}-${f.numero} · ${f.cliente?.razonSocial || 'Cliente'}`,
      importe: Number(f.total || 0) * fCot, moneda: fMon, montoOrigen: Number(f.total || 0),
      ref: f.id,
      contacto: f.cliente?.razonSocial || null,
      empresaId: f.companyId,
    });
  }

  // 7) Viajes facturados (con flete a cobrar/pagar)
  // Estado "facturado" → tarifa × kg/1000 es lo que el transporte cobra (egreso).
  // Solo si tiene tarifa y kgDescarga.
  const viajes = await prisma.viaje.findMany({
    where: { companyId: { in: companyIds }, estado: 'facturado', tarifa: { gt: 0 } },
  });
  for (const v of viajes) {
    const kg = Number(v.kgDescarga || v.cantidad || 0);
    const importe = (Number(v.tarifa || 0) * kg) / 1000;
    if (importe <= 0) continue;
    // Estimación: 15 días post facturación
    const venc = new Date(v.fecha);
    venc.setDate(venc.getDate() + 15);
    push(venc, {
      tipo: 'egreso', categoria: 'viaje',
      concepto: `Flete ${v.producto || 'viaje'} ${v.origen || ''} → ${v.destino || ''}`,
      importe, ref: v.id,
      contacto: v.transportista || null,
      empresaId: v.companyId,
    });
  }

  // === Normalizar moneda/montoOrigen para el simulador (los que no la traen son ARS) ===
  const _normMon = (ev) => { if (ev.moneda == null) ev.moneda = 'ARS'; if (ev.montoOrigen == null) ev.montoOrigen = ev.importe; return ev; };
  items.forEach(_normMon); vencidos.forEach(_normMon);

  // === Sort + totales ===
  items.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  vencidos.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  const totalIngresos = items.filter(i => i.tipo === 'ingreso').reduce((a, b) => a + b.importe, 0);
  const totalEgresos = items.filter(i => i.tipo === 'egreso').reduce((a, b) => a + b.importe, 0);
  const vencidosIngresos = vencidos.filter(i => i.tipo === 'ingreso').reduce((a, b) => a + b.importe, 0);
  const vencidosEgresos = vencidos.filter(i => i.tipo === 'egreso').reduce((a, b) => a + b.importe, 0);
  const saldoFinal = saldoInicialARS + totalIngresos - totalEgresos;

  // === Serie acumulada día a día (idea 2) ===
  // Generamos un punto por cada cambio de saldo (cada item) para el gráfico.
  const serieAcumulada = [];
  let saldoCorriente = saldoInicialARS;
  serieAcumulada.push({ fecha: hoy.toISOString().slice(0,10), saldo: Math.round(saldoCorriente) });
  for (const it of items) {
    const sign = it.tipo === 'ingreso' ? 1 : -1;
    saldoCorriente += sign * it.importe;
    serieAcumulada.push({ fecha: new Date(it.fecha).toISOString().slice(0,10), saldo: Math.round(saldoCorriente) });
  }

  return {
    saldoInicial: {
      bancosARS: Math.round(bancosARS),
      bancosUSD: Math.round(bancosUSD * 100) / 100,
      efectivo: Math.round(efectivoTotal),
      total: Math.round(saldoInicialARS),
    },
    vencidos: {
      items: vencidos.map(v => ({ ...v, fecha: v.fecha.toISOString() })),
      totalIngresos: Math.round(vencidosIngresos),
      totalEgresos: Math.round(vencidosEgresos),
      neto: Math.round(vencidosIngresos - vencidosEgresos),
    },
    items: items.map(i => ({ ...i, fecha: i.fecha.toISOString() })),
    totalIngresos: Math.round(totalIngresos),
    totalEgresos: Math.round(totalEgresos),
    saldo: Math.round(totalIngresos - totalEgresos),
    saldoFinal: Math.round(saldoFinal),
    serieAcumulada,
    empresas: companyIds,
    horizonteDias: dias,
  };
}

app.get('/api/flujo-proyectado', requireCompany, async (req, res, next) => {
  try {
    const data = await _construirFlujoProyectado(req);
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});

// === Exportar Estado de situación a Excel (idea 8) ===
app.get('/api/flujo-proyectado/export', requireCompany, async (req, res, next) => {
  try {
    const data = await _construirFlujoProyectado(req);
    const wb = XLSX.utils.book_new();
    // Hoja Resumen
    const resumen = [
      ['Estado de situación — Resumen'],
      [''],
      ['Horizonte (días)', data.horizonteDias],
      ['Empresas incluidas', data.empresas.length],
      [''],
      ['Saldo inicial (bancos ARS + efectivo)', data.saldoInicial.total],
      ['Saldo bancos USD', data.saldoInicial.bancosUSD],
      [''],
      ['Total a ingresar (proyectado)', data.totalIngresos],
      ['Total a pagar (proyectado)', data.totalEgresos],
      ['Saldo neto proyectado', data.saldo],
      ['Saldo final proyectado', data.saldoFinal],
      [''],
      ['VENCIDOS — a cobrar (atrasado)', data.vencidos.totalIngresos],
      ['VENCIDOS — a pagar (atrasado)', data.vencidos.totalEgresos],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumen), 'Resumen');
    // Hoja Items proyectados
    const headProy = ['Fecha', 'Tipo', 'Categoría', 'Concepto', 'Contacto', 'Importe'];
    const rowsProy = data.items.map(i => [
      new Date(i.fecha).toLocaleDateString('es-AR'),
      i.tipo, i.categoria, i.concepto, i.contacto || '', i.importe,
    ]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headProy, ...rowsProy]), 'Proyectado');
    // Hoja Vencidos
    const rowsVenc = data.vencidos.items.map(i => [
      new Date(i.fecha).toLocaleDateString('es-AR'),
      i.tipo, i.categoria, i.concepto, i.contacto || '', i.importe,
    ]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headProy, ...rowsVenc]), 'Vencidos');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `Estado-de-situacion-${new Date().toISOString().slice(0,10)}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (e) { next(e); }
});

// ============================================================
// BANCOS: cuentas + movimientos. Saldo = saldoInicial + Σ(montos por signo del tipo)
// ============================================================

// Tipos de movimiento: cuáles suman al saldo y cuáles restan.
const BANCO_TIPOS_INGRESO = ['deposito', 'transferencia_in', 'cheque_cobrado', 'credito_acreditado', 'interes'];
const BANCO_TIPOS_EGRESO  = ['extraccion', 'transferencia_out', 'cheque_pagado', 'cuota_credito', 'comision', 'impuesto', 'debito'];
const BANCO_TIPOS_TODOS   = [...BANCO_TIPOS_INGRESO, ...BANCO_TIPOS_EGRESO, 'otro', 'ajuste_in', 'ajuste_out'];

const bancoCuentaSchema = z.object({
  nombre: z.string().nullable().optional(),
  banco: z.string().min(1),
  sucursal: z.string().nullable().optional(),
  tipo: z.enum(['cta_cte', 'caja_ahorro', 'usd', 'otro']).optional(),
  moneda: z.enum(['ARS', 'USD', 'EUR']).optional(),
  numero: z.string().nullable().optional(),
  cbu: z.string().nullable().optional(),
  alias: z.string().nullable().optional(),
  titular: z.string().nullable().optional(),
  saldoInicial: z.number().optional(),
  fechaInicial: z.coerce.date().nullable().optional(),
  esBilleteraVirtual: z.boolean().optional(),
  observaciones: z.string().nullable().optional(),
  activo: z.boolean().optional(),
});

// Devuelve cuentas con saldo calculado (saldoInicial + Σ ingresos − Σ egresos).
// Empresas del grupo economico del usuario (sus companies). Las cuentas bancarias
// se comparten a nivel GRUPO: se ven y operan (transferencias) entre razones sociales
// del mismo grupo. Cada cuenta/movimiento conserva su companyId (razon social real).
async function _cidsGrupo(req){
  const es = await _empresasDeUsuario(req);
  const ids = (es || []).map(e => e.id);
  return ids.length ? ids : [req.companyId];
}
app.get('/api/banco-cuentas', requireCompany, requirePermission('finanzas:read'), async (req, res, next) => {
  try {
    // Por defecto solo las cuentas de la empresa actual. Con ?grupo=1 se traen las de
    // TODAS las empresas del grupo (se usa para elegir la cuenta destino en transferencias).
    const esGrupo = String(req.query.grupo || '') === '1';
    const cids = esGrupo ? await _cidsGrupo(req) : [req.companyId];
    const cuentas = await prisma.bancoCuenta.findMany({
      where: { companyId: { in: cids } },
      include: { company: { select: { name: true } } },
      orderBy: [{ activo: 'desc' }, { banco: 'asc' }],
    });
    const movs = await prisma.bancoMovimiento.groupBy({
      by: ['cuentaId', 'tipo'],
      where: { companyId: { in: cids } },
      _sum: { monto: true },
    });
    const data = cuentas.map(c => {
      let saldo = Number(c.saldoInicial || 0);
      movs.filter(m => m.cuentaId === c.id).forEach(m => {
        const monto = Number(m._sum?.monto || 0);
        if (BANCO_TIPOS_INGRESO.includes(m.tipo)) saldo += monto;
        else if (BANCO_TIPOS_EGRESO.includes(m.tipo)) saldo -= monto;
      });
      const { company, ...rest } = c;
      return { ...rest, saldo, empresaNombre: company?.name || null };
    });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});

app.post('/api/banco-cuentas', requireCompany, requirePermission('finanzas:create'), async (req, res, next) => {
  try {
    const d = bancoCuentaSchema.parse(req.body);
    const row = await prisma.bancoCuenta.create({ data: { ...d, companyId: req.companyId } });
    res.status(201).json({ ok: true, data: row });
  } catch (e) { next(e); }
});

app.put('/api/banco-cuentas/:id', requireCompany, requirePermission('finanzas:update'), async (req, res, next) => {
  try {
    const existing = await prisma.bancoCuenta.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    const d = bancoCuentaSchema.partial().parse(req.body);
    const row = await prisma.bancoCuenta.update({ where: { id: req.params.id }, data: d });
    // Traza puntual para diagnosticar el guardado de la fecha del saldo inicial.
    console.log('[banco-cuentas PUT]', req.params.id,
      '| fechaInicial recibida:', req.body?.fechaInicial,
      '| parseada:', d.fechaInicial,
      '| guardada:', row.fechaInicial);
    res.json({ ok: true, data: row });
  } catch (e) { next(e); }
});

app.delete('/api/banco-cuentas/:id', requireCompany, requirePermission('finanzas:delete'), async (req, res, next) => {
  try {
    const existing = await prisma.bancoCuenta.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    const movs = await prisma.bancoMovimiento.count({ where: { cuentaId: req.params.id } });
    if (movs > 0) {
      await prisma.bancoCuenta.update({ where: { id: req.params.id }, data: { activo: false } });
      return res.json({ ok: true, info: 'Tiene movimientos: marcada como inactiva' });
    }
    await prisma.bancoCuenta.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Movimientos de una cuenta (con filtro opcional por fechas / tipo)
app.get('/api/banco-cuentas/:id/movimientos', requireCompany, requirePermission('finanzas:read'), async (req, res, next) => {
  try {
    // Solo se abren las cuentas de la empresa actual (los movimientos de la cuenta
    // pertenecen a la empresa dueña de la cuenta).
    const where = { companyId: req.companyId, cuentaId: req.params.id };
    if (req.query.desde) where.fecha = { ...where.fecha, gte: new Date(String(req.query.desde)) };
    if (req.query.hasta) where.fecha = { ...where.fecha, lte: new Date(String(req.query.hasta)) };
    if (req.query.tipo) where.tipo = String(req.query.tipo);
    const data = await prisma.bancoMovimiento.findMany({
      where, orderBy: [{ fecha: 'desc' }, { createdAt: 'desc' }],
      include: { user: { select: { id: true, nombre: true, apellido: true, alias: true } }, cuentaContra: { select: { id: true, banco: true, alias: true } } },
    });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});

// Todos los movimientos bancarios de la empresa (para la vista general de Movimientos diarios).
app.get('/api/banco-movimientos', requireCompany, requirePermission('finanzas:read'), async (req, res, next) => {
  try {
    const where = { companyId: req.companyId };
    if (req.query.desde) where.fecha = { ...where.fecha, gte: new Date(String(req.query.desde)) };
    if (req.query.hasta) where.fecha = { ...where.fecha, lte: new Date(String(req.query.hasta)) };
    const data = await prisma.bancoMovimiento.findMany({
      where, orderBy: [{ fecha: 'desc' }, { createdAt: 'desc' }],
      include: { user: { select: { id: true, nombre: true, apellido: true, alias: true } } },
    });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});

const bancoMovSchema = z.object({
  cuentaId: z.string(),
  fecha: z.coerce.date(),
  tipo: z.enum(BANCO_TIPOS_TODOS),
  concepto: z.string().min(1),
  monto: z.number().positive(),
  contraparte: z.string().nullable().optional(),
  referencia: z.string().nullable().optional(),
  cuentaContraId: z.string().nullable().optional(),     // solo en transferencias internas
  cajaEfectivo: z.string().nullable().optional(),       // depósito/extracción vinculado a una caja de efectivo
  chequeId: z.string().nullable().optional(),
  cuotaCreditoId: z.string().nullable().optional(),
  observaciones: z.string().nullable().optional(),
});

// Crear movimiento bancario manual. Si es transferencia entre cuentas propias,
// crea automáticamente el movimiento espejo (out → in) para que ambos saldos
// queden consistentes.
// ============================================================
// MOVIMIENTOS DIARIOS — centro unificado para cargar cualquier gasto/ingreso
// del día con cualquier método (efectivo / cheque / transferencia).
//
// El endpoint orquesta los modelos existentes según el método elegido:
//   - efectivo      → crea Efectivo (ingreso o egreso) en la caja indicada
//   - transferencia → crea BancoMovimiento (transferencia_in/out) en la cuenta
//   - cheque        → marca el cheque elegido como endosado/depositado
//
// El "concepto" + "categoría" + "clasificación" (empresa/propio) se preservan
// en el movimiento creado.
// ============================================================
// Mueve el RECURSO de la firma que financia un movimiento Intercompany (la firma
// "origen"): saca efectivo de una caja suya, endosa/entrega un cheque suyo, o hace
// una transferencia_out de una cuenta bancaria suya. Se llama dentro de una tx.
//   recurso: 'efectivo' | 'transferencia' | 'cheque' | 'deuda'(sin mover recurso)
async function _intercompanyMoverRecurso(tx, o) {
  const { empresaOrigenId, recurso, monto, fecha, concepto, observaciones, userId } = o;
  if (recurso === 'efectivo') {
    await tx.efectivo.create({ data: {
      companyId: empresaOrigenId, fecha, tipo: 'egreso',
      concepto, monto, caja: o.cajaOrigen || null,
      clasificacion: 'empresa', observaciones: observaciones || null,
    }});
  } else if (recurso === 'transferencia') {
    if (!o.bancoCuentaIdOrigen) throw new Error('Elegí la cuenta bancaria de la otra empresa');
    const cta = await tx.bancoCuenta.findFirst({ where: { id: o.bancoCuentaIdOrigen, companyId: empresaOrigenId } });
    if (!cta) throw new Error('Cuenta bancaria de la otra empresa no encontrada');
    await tx.bancoMovimiento.create({ data: {
      companyId: empresaOrigenId, cuentaId: o.bancoCuentaIdOrigen, fecha,
      tipo: 'transferencia_out', concepto, monto,
      contraparte: concepto, observaciones: observaciones || null, userId: userId || null,
    }});
  } else if (recurso === 'cheque') {
    if (!o.chequeIdOrigen) throw new Error('Elegí el cheque de la otra empresa');
    const ch = await tx.cheque.findFirst({ where: { id: o.chequeIdOrigen, companyId: empresaOrigenId } });
    if (!ch) throw new Error('Cheque de la otra empresa no encontrado');
    await tx.cheque.update({ where: { id: ch.id }, data: {
      estado: ch.tipo === 'propio' ? 'entregado' : 'endosado',
      fechaEndoso: fecha,
      beneficiario: concepto || ch.beneficiario,
      enPoderDe: concepto || ch.enPoderDe,
      observaciones: observaciones || ch.observaciones,
    }});
  }
  // 'deuda' (o vacío): no se mueve ningún recurso, queda solo la deuda intercompany.
}

app.post('/api/movimientos-diarios', requireCompany, requirePermission('finanzas:create'), async (req, res, next) => {
  try {
    const schema = z.object({
      fecha: z.coerce.date(),
      tipo: z.enum(['ingreso', 'egreso', 'ajuste_in', 'ajuste_out']),
      concepto: z.string().min(1),
      categoria: z.string().nullable().optional(),
      clasificacion: z.string().nullable().optional(),   // "empresa" | "propio"
      monto: z.number().positive(),
      metodo: z.enum(['efectivo', 'cheque', 'transferencia', 'debito', 'externo', 'tarjeta', 'intercompany']),
      // Datos según método
      caja: z.string().nullable().optional(),            // efectivo / externo (nombre del medio)
      chequeId: z.string().nullable().optional(),        // cheque (cheque existente)
      bancoCuentaId: z.string().nullable().optional(),   // transferencia
      // Intercompany: otra firma del grupo pone los fondos (solo para egresos).
      empresaOrigenId: z.string().nullable().optional(),        // firma que financia
      recursoIntercompany: z.enum(['efectivo','cheque','transferencia','deuda']).nullable().optional(),
      cajaOrigen: z.string().nullable().optional(),             // caja de la otra firma (efectivo)
      chequeIdOrigen: z.string().nullable().optional(),         // cheque de la otra firma
      bancoCuentaIdOrigen: z.string().nullable().optional(),    // cuenta de la otra firma (transferencia)
      // Contraparte opcional (texto libre) — solo descriptivo
      contraparte: z.string().nullable().optional(),
      observaciones: z.string().nullable().optional(),
    });
    const d = schema.parse(req.body);
    const detalleObs = [
      d.categoria ? `Categoría: ${d.categoria}` : null,
      d.contraparte ? `Contraparte: ${d.contraparte}` : null,
      d.observaciones,
    ].filter(Boolean).join(' · ');
    let resultado;

    if (d.metodo === 'efectivo' || d.metodo === 'externo' || d.metodo === 'tarjeta') {
      // "externo" (billetera virtual) y "tarjeta" (tarjeta de crédito, solo etiqueta)
      // se registran como una caja del módulo Efectivo (el nombre es la caja). NO tocan bancos.
      resultado = await prisma.efectivo.create({
        data: {
          companyId: req.companyId,
          fecha: d.fecha,
          tipo: d.tipo,
          concepto: d.concepto,
          monto: d.monto,
          caja: d.caja || null,
          clasificacion: d.clasificacion || 'empresa',
          observaciones: detalleObs || null,
        },
      });
    } else if (d.metodo === 'transferencia' || d.metodo === 'debito') {
      if (!d.bancoCuentaId) return res.status(400).json({ ok: false, error: 'Falta la cuenta bancaria' });
      const cuenta = await prisma.bancoCuenta.findFirst({ where: { id: d.bancoCuentaId, companyId: req.companyId } });
      if (!cuenta) return res.status(404).json({ ok: false, error: 'Cuenta bancaria no encontrada' });
      // Débito bancario: egreso 'debito' (ej. pago de tarjeta/servicios); ingreso => depósito.
      const tipoMov = d.metodo === 'debito'
        ? (d.tipo === 'ingreso' ? 'deposito' : 'debito')
        : (d.tipo === 'ingreso' ? 'transferencia_in' : 'transferencia_out');
      resultado = await prisma.bancoMovimiento.create({
        data: {
          companyId: req.companyId,
          cuentaId: d.bancoCuentaId,
          fecha: d.fecha,
          tipo: tipoMov,
          concepto: d.concepto,
          monto: d.monto,
          contraparte: d.contraparte || null,
          observaciones: detalleObs || null,
          userId: req.user?.id || null,
        },
      });
    } else if (d.metodo === 'cheque') {
      if (!d.chequeId) return res.status(400).json({ ok: false, error: 'Falta el cheque' });
      const ch = await prisma.cheque.findFirst({ where: { id: d.chequeId, companyId: req.companyId } });
      if (!ch) return res.status(404).json({ ok: false, error: 'Cheque no encontrado' });
      // Egreso (pago con cheque): propio se entrega, tercero se endosa; sale de cartera.
      // Ingreso (deposito de un cheque propio en cartera): queda depositado.
      const esEgreso = d.tipo === 'egreso';
      const nuevoEstado = esEgreso ? (ch.tipo === 'propio' ? 'entregado' : 'endosado') : 'depositado';
      resultado = await prisma.cheque.update({
        where: { id: ch.id },
        data: {
          estado: nuevoEstado,
          beneficiario: d.contraparte || ch.beneficiario,
          fechaEndoso: esEgreso ? d.fecha : ch.fechaEndoso,
          enPoderDe: esEgreso ? (d.contraparte || ch.enPoderDe) : ch.enPoderDe,
          observaciones: detalleObs || ch.observaciones,
        },
      });
    } else if (d.metodo === 'intercompany') {
      // Gasto de esta empresa cubierto por otra firma del grupo. Solo egresos.
      if (d.tipo !== 'egreso') return res.status(400).json({ ok: false, error: 'Intercompany solo aplica a egresos/gastos' });
      if (!d.empresaOrigenId) return res.status(400).json({ ok: false, error: 'Elegí la firma del grupo que pone los fondos' });
      if (d.empresaOrigenId === req.companyId) return res.status(400).json({ ok: false, error: 'La firma que financia no puede ser la misma' });
      if (!_userTieneAcceso(req, d.empresaOrigenId)) return res.status(403).json({ ok: false, error: 'No tenés acceso a la firma que financia' });
      const tienePerm = req.user.superAdmin || (req.user.userCompanies || []).some(uc =>
        uc.companyId === req.companyId &&
        ((uc.role?.permissions || []).includes('finanzas:intercompany') ||
         (uc.role?.permissions || []).includes('finanzas:*') ||
         (uc.role?.permissions || []).includes('*:*')));
      if (!tienePerm) return res.status(403).json({ ok: false, error: 'No tenés permiso finanzas:intercompany' });
      const recurso = d.recursoIntercompany || 'deuda';
      resultado = await prisma.$transaction(async (tx) => {
        const interRef = `ic_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
        // Esta empresa (destino) queda debiendo a la otra: haber = monto.
        await tx.ctaCte.create({ data: {
          companyId: req.companyId, contactoTipo: 'intercompany',
          empresaContraparteId: d.empresaOrigenId, intercompanyRef: interRef,
          fecha: d.fecha, detalle: d.concepto + ' — cubierto por otra firma del grupo',
          haber: d.monto, observaciones: detalleObs || null,
        }});
        // La firma origen queda con saldo a favor: debe = monto.
        await tx.ctaCte.create({ data: {
          companyId: d.empresaOrigenId, contactoTipo: 'intercompany',
          empresaContraparteId: req.companyId, intercompanyRef: interRef,
          fecha: d.fecha, detalle: 'Gasto pagado para otra firma del grupo: ' + d.concepto,
          debe: d.monto, observaciones: detalleObs || null,
        }});
        await tx.intercompanyMovimiento.create({ data: {
          fecha: d.fecha, empresaOrigenId: d.empresaOrigenId, empresaDestinoId: req.companyId,
          monto: d.monto, motivo: d.concepto, intercompanyRef: interRef,
          observaciones: detalleObs || null, userId: req.user?.id || null,
        }});
        // Mover el recurso REAL de la firma origen (su caja / cheque / banco).
        await _intercompanyMoverRecurso(tx, {
          empresaOrigenId: d.empresaOrigenId, recurso, monto: d.monto, fecha: d.fecha,
          concepto: d.concepto, observaciones: detalleObs || null, userId: req.user?.id || null,
          cajaOrigen: d.cajaOrigen, chequeIdOrigen: d.chequeIdOrigen, bancoCuentaIdOrigen: d.bancoCuentaIdOrigen,
        });
        return { intercompanyRef: interRef };
      });
    }

    res.status(201).json({ ok: true, data: { id: resultado?.id, metodo: d.metodo, tipo: d.tipo } });
  } catch (e) { next(e); }
});

// ============================================================
// CONCILIACION BANCARIA mensual por cuenta. Al confirmar un periodo (YYYY-MM)
// de una cuenta, sus movimientos de ese mes quedan bloqueados (no se crean, ni
// editan, ni borran) hasta reabrir la conciliacion.
// ============================================================
function _periodoDe(fecha) {
  const d = new Date(fecha);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function _finDeMes(periodo) {
  const [y, m] = periodo.split('-').map(Number);
  return new Date(y, m, 0, 23, 59, 59, 999);   // dia 0 del mes siguiente = ultimo dia del mes
}
// Devuelve la conciliacion que bloquea (cuenta+mes) o null. Se busca por cuenta+periodo
// (la cuenta es unica), asi funciona tambien con cuentas de otras empresas del grupo.
async function _conciliacionBloqueo(companyId, cuentaId, fecha) {
  if (!cuentaId || !fecha) return null;
  return prisma.conciliacionBancaria.findFirst({ where: { cuentaId, periodo: _periodoDe(fecha) } });
}
// Saldo de la cuenta hasta el fin del periodo (foto para la conciliacion).
async function _saldoCuentaHasta(companyId, cuentaId, hasta) {
  const cuenta = await prisma.bancoCuenta.findFirst({ where: { id: cuentaId } });
  if (!cuenta) return 0;
  let saldo = Number(cuenta.saldoInicial || 0);
  const movs = await prisma.bancoMovimiento.findMany({ where: { cuentaId, fecha: { lte: hasta } }, select: { tipo: true, monto: true } });
  for (const m of movs) {
    const monto = Number(m.monto || 0);
    if (BANCO_TIPOS_INGRESO.includes(m.tipo)) saldo += monto;
    else if (BANCO_TIPOS_EGRESO.includes(m.tipo)) saldo -= monto;
  }
  return saldo;
}

app.get('/api/conciliaciones', requireCompany, requirePermission('finanzas:read'), async (req, res, next) => {
  try {
    const cids = await _cidsGrupo(req);
    const where = { companyId: { in: cids } };
    if (req.query.cuentaId) where.cuentaId = String(req.query.cuentaId);
    const data = await prisma.conciliacionBancaria.findMany({ where, orderBy: { periodo: 'desc' } });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});

app.post('/api/conciliaciones', requireCompany, requirePermission('finanzas:update'), async (req, res, next) => {
  try {
    const d = z.object({
      cuentaId: z.string().min(1),
      periodo: z.string().regex(/^\d{4}-\d{2}$/, 'Periodo debe ser YYYY-MM'),
      saldoExtracto: z.number().nullable().optional(),
      observaciones: z.string().nullable().optional(),
    }).parse(req.body);
    const cids = await _cidsGrupo(req);
    const cuenta = await prisma.bancoCuenta.findFirst({ where: { id: d.cuentaId, companyId: { in: cids } } });
    if (!cuenta) return res.status(404).json({ ok: false, error: 'Cuenta no encontrada' });
    const yaExiste = await prisma.conciliacionBancaria.findFirst({ where: { cuentaId: d.cuentaId, periodo: d.periodo } });
    if (yaExiste) return res.status(400).json({ ok: false, error: 'Ese mes ya está conciliado para esta cuenta.' });
    const saldoSistema = await _saldoCuentaHasta(cuenta.companyId, d.cuentaId, _finDeMes(d.periodo));
    const row = await prisma.conciliacionBancaria.create({
      data: {
        companyId: cuenta.companyId, cuentaId: d.cuentaId, periodo: d.periodo,
        saldoExtracto: d.saldoExtracto ?? null, saldoSistema,
        observaciones: d.observaciones || null, userId: req.user?.id || null,
      },
    });
    res.status(201).json({ ok: true, data: row });
  } catch (e) { next(e); }
});

// Reabrir (borrar) una conciliacion → desbloquea el mes de esa cuenta.
app.delete('/api/conciliaciones/:id', requireCompany, requirePermission('finanzas:update'), async (req, res, next) => {
  try {
    const cids = await _cidsGrupo(req);
    const existing = await prisma.conciliacionBancaria.findFirst({ where: { id: req.params.id, companyId: { in: cids } } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrada' });
    await prisma.conciliacionBancaria.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post('/api/banco-movimientos', requireCompany, requirePermission('finanzas:create'), async (req, res, next) => {
  try {
    const d = bancoMovSchema.parse(req.body);
    const cids = await _cidsGrupo(req);
    const cuenta = await prisma.bancoCuenta.findFirst({ where: { id: d.cuentaId, companyId: { in: cids } } });
    if (!cuenta) return res.status(404).json({ ok: false, error: 'Cuenta no encontrada' });
    { const bloq = await _conciliacionBloqueo(req.companyId, d.cuentaId, d.fecha);
      if (bloq) return res.status(400).json({ ok: false, error: `El mes ${bloq.periodo} de esta cuenta está conciliado. Reabrí la conciliación para cargar movimientos en ese mes.` }); }
    { if (d.cuentaContraId) { const bloq2 = await _conciliacionBloqueo(req.companyId, d.cuentaContraId, d.fecha);
      if (bloq2) return res.status(400).json({ ok: false, error: `El mes ${bloq2.periodo} de la cuenta destino está conciliado. Reabrí la conciliación primero.` }); } }
    // Transferencia interna: validar cuenta destino y crear el espejo en transacción.
    // La cuenta destino puede ser de otra empresa del mismo grupo económico.
    const esTransferInterna = (d.tipo === 'transferencia_out' || d.tipo === 'transferencia_in') && d.cuentaContraId;
    if (esTransferInterna) {
      const otra = await prisma.bancoCuenta.findFirst({ where: { id: d.cuentaContraId, companyId: { in: cids } } });
      if (!otra) return res.status(400).json({ ok: false, error: 'Cuenta destino no encontrada' });
      if (d.cuentaContraId === d.cuentaId) return res.status(400).json({ ok: false, error: 'Origen y destino deben ser distintos' });
      const result = await prisma.$transaction(async (tx) => {
        const outMov = await tx.bancoMovimiento.create({
          data: {
            companyId: cuenta.companyId, cuentaId: d.cuentaId, fecha: d.fecha,
            tipo: 'transferencia_out', concepto: d.concepto, monto: d.monto,
            contraparte: otra.banco + (otra.alias ? ' · ' + otra.alias : ''),
            referencia: d.referencia || null, cuentaContraId: d.cuentaContraId,
            observaciones: d.observaciones || null, userId: req.user?.id || null,
          },
        });
        const inMov = await tx.bancoMovimiento.create({
          data: {
            companyId: otra.companyId, cuentaId: d.cuentaContraId, fecha: d.fecha,
            tipo: 'transferencia_in', concepto: d.concepto, monto: d.monto,
            contraparte: cuenta.banco + (cuenta.alias ? ' · ' + cuenta.alias : ''),
            referencia: d.referencia || null, cuentaContraId: d.cuentaId,
            observaciones: d.observaciones || null, userId: req.user?.id || null,
          },
        });
        return { outMov, inMov };
      });
      return res.status(201).json({ ok: true, data: result });
    }
    // Movimiento interno caja <-> banco: depósito de efectivo en la cuenta, o extracción a efectivo.
    // Crea el movimiento bancario + su espejo en la caja de efectivo (una sola operación).
    const esCajaBanco = (d.tipo === 'deposito' || d.tipo === 'extraccion') && d.cajaEfectivo;
    if (esCajaBanco) {
      const cuentaTxt = cuenta.banco + (cuenta.alias ? ' · ' + cuenta.alias : '');
      const result = await prisma.$transaction(async (tx) => {
        const bancoMov = await tx.bancoMovimiento.create({
          data: {
            companyId: cuenta.companyId, cuentaId: d.cuentaId, fecha: d.fecha,
            tipo: d.tipo, concepto: d.concepto, monto: d.monto,
            contraparte: d.contraparte || ('Efectivo · ' + d.cajaEfectivo),
            referencia: d.referencia || null, observaciones: d.observaciones || null,
            userId: req.user?.id || null,
          },
        });
        // Depósito en banco => SALE plata de la caja (egreso). Extracción => ENTRA a la caja (ingreso).
        await tx.efectivo.create({
          data: {
            companyId: req.companyId, fecha: d.fecha,
            tipo: d.tipo === 'deposito' ? 'egreso' : 'ingreso',
            concepto: (d.tipo === 'deposito' ? 'Depósito en ' : 'Extracción de ') + cuentaTxt,
            monto: d.monto, caja: d.cajaEfectivo, clasificacion: 'empresa',
            observaciones: d.observaciones || null,
          },
        });
        return bancoMov;
      });
      return res.status(201).json({ ok: true, data: result });
    }
    const { cajaEfectivo, ...rest } = d;   // cajaEfectivo no es columna del movimiento bancario
    const row = await prisma.bancoMovimiento.create({
      data: { ...rest, companyId: cuenta.companyId, userId: req.user?.id || null },
    });
    res.status(201).json({ ok: true, data: row });
  } catch (e) { next(e); }
});

app.put('/api/banco-movimientos/:id', requireCompany, requirePermission('finanzas:update'), async (req, res, next) => {
  try {
    const cids = await _cidsGrupo(req);
    const existing = await prisma.bancoMovimiento.findFirst({ where: { id: req.params.id, companyId: { in: cids } } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    const schema = bancoMovSchema.partial().extend({ conciliado: z.boolean().optional(), syncMirror: z.boolean().optional() });
    const parsed = schema.parse(req.body);
    // Bloqueo por conciliación: ni el mes original ni el mes destino pueden estar conciliados.
    { const bloqOrig = await _conciliacionBloqueo(req.companyId, existing.cuentaId, existing.fecha);
      const bloqDest = await _conciliacionBloqueo(req.companyId, parsed.cuentaId || existing.cuentaId, parsed.fecha || existing.fecha);
      const bloq = bloqOrig || bloqDest;
      if (bloq) return res.status(400).json({ ok: false, error: `El mes ${bloq.periodo} está conciliado. Reabrí la conciliación para modificar este movimiento.` }); }
    // syncMirror y cajaEfectivo no son columnas del movimiento.
    const { syncMirror, cajaEfectivo, ...d } = parsed;
    const esTransfer = (existing.tipo === 'transferencia_in' || existing.tipo === 'transferencia_out') && existing.cuentaContraId;
    const otroTipo = existing.tipo === 'transferencia_in' ? 'transferencia_out' : 'transferencia_in';
    // ¿Se cambió la cuenta destino? (transferido por error a la cuenta equivocada)
    const cambiaDestino = esTransfer && d.cuentaContraId && d.cuentaContraId !== existing.cuentaContraId;

    if (esTransfer && cambiaDestino) {
      // Rehacemos el espejo: lo borramos de la cuenta destino anterior y lo creamos en la nueva.
      // La cuenta destino puede ser de otra empresa del grupo económico.
      const destinoId = d.cuentaContraId;
      if (destinoId === existing.cuentaId) return res.status(400).json({ ok: false, error: 'Origen y destino deben ser distintos' });
      const cuentaOrig = await prisma.bancoCuenta.findFirst({ where: { id: existing.cuentaId, companyId: { in: cids } } });
      const cuentaDest = await prisma.bancoCuenta.findFirst({ where: { id: destinoId, companyId: { in: cids } } });
      if (!cuentaDest) return res.status(400).json({ ok: false, error: 'Cuenta destino no encontrada' });
      // El mes de la nueva cuenta destino tampoco puede estar conciliado.
      { const bloqNueva = await _conciliacionBloqueo(req.companyId, destinoId, d.fecha || existing.fecha);
        if (bloqNueva) return res.status(400).json({ ok: false, error: `El mes ${bloqNueva.periodo} de la cuenta destino está conciliado. Reabrí la conciliación primero.` }); }
      const nuevaFecha    = d.fecha        !== undefined ? d.fecha        : existing.fecha;
      const nuevoMonto    = d.monto        !== undefined ? d.monto        : existing.monto;
      const nuevoConcepto = d.concepto     !== undefined ? d.concepto     : existing.concepto;
      const nuevaObs      = d.observaciones!== undefined ? d.observaciones: existing.observaciones;
      const result = await prisma.$transaction(async (tx) => {
        // 1) este movimiento: nuevos datos + cuentaContraId destino + contraparte
        const row = await tx.bancoMovimiento.update({ where: { id: req.params.id }, data: {
          ...d, cuentaContraId: destinoId,
          contraparte: cuentaDest.banco + (cuentaDest.alias ? ' · ' + cuentaDest.alias : ''),
        }});
        // 2) borrar el espejo viejo (en la cuenta destino anterior)
        await tx.bancoMovimiento.deleteMany({ where: {
          cuentaId: existing.cuentaContraId, cuentaContraId: existing.cuentaId,
          tipo: otroTipo, fecha: existing.fecha, monto: existing.monto,
        }});
        // 3) crear el espejo nuevo en la cuenta destino corregida
        await tx.bancoMovimiento.create({ data: {
          companyId: cuentaDest.companyId, cuentaId: destinoId, fecha: nuevaFecha,
          tipo: otroTipo, concepto: nuevoConcepto, monto: nuevoMonto,
          contraparte: cuentaOrig ? (cuentaOrig.banco + (cuentaOrig.alias ? ' · ' + cuentaOrig.alias : '')) : null,
          referencia: existing.referencia || null, cuentaContraId: existing.cuentaId,
          observaciones: nuevaObs || null, userId: req.user?.id || null,
        }});
        return row;
      });
      return res.json({ ok: true, data: result });
    }

    if (esTransfer && syncMirror) {
      // Actualiza también el movimiento espejo de la otra cuenta (mismos monto/fecha/concepto/obs).
      const result = await prisma.$transaction(async (tx) => {
        const row = await tx.bancoMovimiento.update({ where: { id: req.params.id }, data: d });
        await tx.bancoMovimiento.updateMany({
          where: {
            cuentaId: existing.cuentaContraId, cuentaContraId: existing.cuentaId,
            tipo: otroTipo, fecha: existing.fecha, monto: existing.monto,
          },
          data: {
            ...(d.fecha !== undefined ? { fecha: d.fecha } : {}),
            ...(d.monto !== undefined ? { monto: d.monto } : {}),
            ...(d.concepto !== undefined ? { concepto: d.concepto } : {}),
            ...(d.observaciones !== undefined ? { observaciones: d.observaciones } : {}),
          },
        });
        return row;
      });
      return res.json({ ok: true, data: result });
    }
    const row = await prisma.bancoMovimiento.update({ where: { id: req.params.id }, data: d });
    res.json({ ok: true, data: row });
  } catch (e) { next(e); }
});

app.delete('/api/banco-movimientos/:id', requireCompany, requirePermission('finanzas:delete'), async (req, res, next) => {
  try {
    const cids = await _cidsGrupo(req);
    const existing = await prisma.bancoMovimiento.findFirst({ where: { id: req.params.id, companyId: { in: cids } } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    { const bloq = await _conciliacionBloqueo(req.companyId, existing.cuentaId, existing.fecha);
      if (bloq) return res.status(400).json({ ok: false, error: `El mes ${bloq.periodo} de esta cuenta está conciliado. Reabrí la conciliación para borrar el movimiento.` }); }
    // Si este movimiento vino de depositar/cobrar un cheque, al borrarlo volvemos el cheque a cartera.
    if (existing.chequeId && (existing.tipo === 'cheque_cobrado' || existing.tipo === 'cheque_pagado')) {
      await prisma.cheque.updateMany({ where: { id: existing.chequeId, companyId: { in: cids } }, data: { estado: 'en_cartera', fechaEndoso: null } });
    }
    // Si fue parte de una transferencia interna, borrar también el espejo (puede estar en otra empresa del grupo)
    if (existing.cuentaContraId && (existing.tipo === 'transferencia_in' || existing.tipo === 'transferencia_out')) {
      const otroTipo = existing.tipo === 'transferencia_in' ? 'transferencia_out' : 'transferencia_in';
      await prisma.bancoMovimiento.deleteMany({
        where: { cuentaId: existing.cuentaContraId, cuentaContraId: existing.cuentaId,
                 tipo: otroTipo, fecha: existing.fecha, monto: existing.monto },
      });
    }
    await prisma.bancoMovimiento.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ============================================================
// SYSTEM: chequeo de actualizaciones
// /api/system/version se declara como ruta publica antes del authMiddleware.
// /api/system/check-update requiere login (solo super admins lo usan).
// ============================================================
// === INSTALAR ACTUALIZACION REMOTAMENTE ===
// Lanza Update-AgroCore.ps1 como proceso desacoplado. La API responde de
// inmediato porque el script va a matar Node como parte del update.
// El cliente debe hacer polling de /api/system/version hasta detectar el cambio.
app.post('/api/admin/instalar-actualizacion', authMiddleware, async (req, res, next) => {
  try {
    if (!req.user.superAdmin) return res.status(403).json({ ok: false, error: 'Solo el Super Admin puede instalar actualizaciones' });
    if (os.platform() !== 'win32') {
      return res.status(400).json({ ok: false, error: 'La actualización remota solo funciona en servidores Windows. En Linux ejecutá manualmente el script.' });
    }
    // ---- Update CONSCIENTE DE LA INSTANCIA (v1.2.6) ----
    // Cada instancia (Demo, Peiretti, Borghi) debe actualizarse A SI MISMA.
    // Antes esto estaba hardcodeado a C:\AgroCore con InstallDir por defecto,
    // asi que tocar "Instalar" en Borghi terminaba actualizando Demo y matando
    // TODOS los node de la maquina. Ahora pasamos la carpeta, el puerto y el
    // nombre de servicio de ESTA instancia, y el script opera solo sobre ella.
    const installDir = STATIC_DIR;                       // raiz de ESTA instancia
    const servicio   = (process.env.AGROCORE_SERVICE || '').trim(); // nombre del servicio Windows (vacio = VBS/npm)
    // Update-AgroCore.ps1 propio de la instancia; si no tiene, caemos al de
    // C:\AgroCore (el script actua sobre -InstallDir, no sobre donde vive).
    let scriptPath = path.join(installDir, 'Update-AgroCore.ps1');
    if (!fs.existsSync(scriptPath)) scriptPath = path.join('C:', 'AgroCore', 'Update-AgroCore.ps1');
    if (!fs.existsSync(scriptPath)) {
      return res.status(500).json({ ok: false, error: 'No se encontró Update-AgroCore.ps1' });
    }
    // Lanzar como proceso totalmente desacoplado. Usamos un "wrapper" cmd que
    // a su vez llama a powershell para que cuando matemos node.exe no se mate
    // a sí mismo. Sin shell intermedio y stdio:ignore, sobrevive a la muerte
    // del proceso padre (Node).
    // (spawn ya está importado arriba con ESM; no usar require — el módulo es ESM)
    const psArgs = [
      '-WindowStyle', 'Hidden',
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      '-Unattended',
      '-InstallDir', installDir,
      '-Puerto', String(PORT),
    ];
    if (servicio) psArgs.push('-Servicio', servicio);
    const child = spawn(
      'cmd.exe',
      ['/c', 'start', '""', '/b', 'powershell.exe', ...psArgs],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }
    );
    child.unref();
    res.json({ ok: true, mensaje: `Actualización lanzada para ${process.env.AGROCORE_INSTANCIA || 'esta instancia'} (puerto ${PORT}). Se reinicia en 30-90 segundos.` });
  } catch (e) { next(e); }
});

// ============================================================
// PARSER DE PDF DE FACTURA ELECTRÓNICA ARCA (AFIP)
// Extrae los datos del código QR (URL afip.gob.ar/fe/qr/?p=<base64>),
// decodifica el JSON estándar de ARCA y devuelve los datos parseados
// para autopoblar el form de carga de factura.
// ============================================================
const FACT_TIPO_AFIP = {
  1: 'A', 6: 'B', 11: 'C', 51: 'M',         // Facturas
  2: 'NDA', 7: 'NDB', 12: 'NDC',            // Notas de débito
  3: 'NCA', 8: 'NCB', 13: 'NCC',            // Notas de crédito
};
app.post('/api/admin/parse-factura-pdf', authMiddleware, requireCompany, upload.single('archivo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Falta el archivo PDF' });
    if (!/\.pdf$/i.test(req.file.originalname || '')) {
      return res.status(400).json({ ok: false, error: 'El archivo debe ser un PDF' });
    }
    let texto = '';
    let pdfParse;
    try {
      pdfParse = await getPdfParse();
    } catch (e) {
      return res.status(501).json({ ok: false,
        error: 'El parser de PDF no está disponible en este servidor (pdf-parse no instalado). Reinstalá las dependencias con: cd C:\\AgroCore\\backend; npm install pdf-parse. Mientras tanto, cargá la factura a mano.' });
    }
    try {
      const data = await pdfParse(req.file.buffer);
      texto = data.text || '';
    } catch (e) {
      return res.status(400).json({ ok: false, error: 'No pude leer el PDF: ' + e.message });
    }

    // === Helpers de parseo ===
    const num = (s) => {
      if (s == null || s === '') return null;
      let n = String(s).replace(/[$\s]/g, '');
      // Formato AR: "1.830.150,00" → "1830150.00"  | "1830150,00" → "1830150.00"
      if (/,\d{1,2}$/.test(n)) {
        n = n.replace(/\./g, '').replace(',', '.');
      } else if (/\.\d{1,2}$/.test(n)) {
        // formato US-like; sacar comas
        n = n.replace(/,/g, '');
      } else {
        n = n.replace(/[,.]/g, '');
      }
      const v = Number(n);
      return isFinite(v) ? v : null;
    };
    const fechaArg = (s) => {
      if (!s) return null;
      const m = String(s).match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
      if (!m) return null;
      const dd = m[1].padStart(2, '0');
      const mm = m[2].padStart(2, '0');
      let yy = m[3]; if (yy.length === 2) yy = '20' + yy;
      return `${yy}-${mm}-${dd}`;
    };
    const matchEtiqueta = (etiquetaRe) => {
      // Envolvemos en grupo no capturante para que un '|' en la etiqueta no rompa el regex
      const re = new RegExp('(?:' + etiquetaRe + ')[^\\n]*?(\\$\\s*)?([\\d.,]+)', 'i');
      const mm = texto.match(re);
      if (!mm) return null;
      return num(mm[2]);
    };
    const matchSimple = (re) => { const mm = texto.match(re); return mm ? mm[1] : null; };
    // CUITs: cualquier número de 11 dígitos (con o sin guiones)
    const cuitsRaw = [...texto.matchAll(/\b(\d{2}[-]?\d{8}[-]?\d{1})\b/g)].map(m => m[1].replace(/-/g,''));
    const cuitsUnicos = [...new Set(cuitsRaw)];

    // Inicialización
    let qrData = null;
    let fuenteQr = false;

    // === Intento 1: buscar QR de ARCA como texto en el PDF ===
    const reQr = /https?:\/\/(?:www\.)?afip\.gob\.ar\/fe\/qr\/?\?p=([A-Za-z0-9+/=_-]+)/i;
    const m = texto.match(reQr);
    if (m) {
      try {
        let b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4 !== 0) b64 += '=';
        const jsonStr = Buffer.from(b64, 'base64').toString('utf8');
        qrData = JSON.parse(jsonStr);
        fuenteQr = true;
      } catch (e) { /* sigue al parser de texto */ }
    }

    // === Resultado base (vacío) ===
    const resultado = {
      fuente: fuenteQr ? 'QR_ARCA' : 'TEXTO_PDF',
      cae: null, caeVencimiento: null,
      fecha: null,
      cuitEmisor: null, razonSocialEmisor: null,
      cuitReceptor: null, razonSocialReceptor: null,
      puntoVenta: null, numero: null,
      tipoCmpCodigo: null, tipoCmpLetra: null,
      total: null, netoGravado: null,
      iva21: null, iva105: null, iva27: null, iva25: null, iva5: null,
      moneda: 'PES', cotizacion: 1,
    };

    // === Si vino del QR, llenar con los datos oficiales ===
    if (fuenteQr && qrData) {
      const tipoCmp = Number(qrData.tipoCmp || 0);
      resultado.cae = String(qrData.codAut || '');
      resultado.fecha = qrData.fecha || null;
      resultado.cuitEmisor = String(qrData.cuit || '');
      resultado.puntoVenta = Number(qrData.ptoVta || 0);
      resultado.tipoCmpCodigo = tipoCmp;
      resultado.tipoCmpLetra = FACT_TIPO_AFIP[tipoCmp] || 'B';
      resultado.numero = Number(qrData.nroCmp || 0);
      resultado.total = Number(qrData.importe || 0);
      resultado.moneda = qrData.moneda || 'PES';
      resultado.cotizacion = Number(qrData.ctz || 1);
      resultado.cuitReceptor = String(qrData.nroDocRec || '');
    }

    // === Nombre de archivo ARCA: {cuitEmisor}_{tipoCod}_{ptoVta}_{nro}.pdf ===
    // Es una fuente MUY confiable (el QR es aún mejor). El texto de los PDF de ARCA
    // "comprobante en línea" viene desordenado, así que esto evita confundir emisor
    // con receptor y perder PV/número. No pisa lo que ya trajo el QR.
    const fnMatch = String(req.file.originalname || '').match(/(\d{11})[_-](\d{2,3})[_-](\d{4,5})[_-](\d{7,8})/);
    if (fnMatch && !fuenteQr) {
      resultado.cuitEmisor = fnMatch[1];
      const tipoFn = Number(fnMatch[2]);
      if (tipoFn) {
        resultado.tipoCmpCodigo = tipoFn;
        // Solo si es una letra simple (Factura A/B/C/M). Para NC/ND ("NCC"/"NDA")
        // dejamos que el resto del parseo defina letra y clase.
        if (FACT_TIPO_AFIP[tipoFn] && FACT_TIPO_AFIP[tipoFn].length === 1) {
          resultado.tipoCmpLetra = FACT_TIPO_AFIP[tipoFn];
        }
      }
      resultado.puntoVenta = Number(fnMatch[3]);
      resultado.numero = Number(fnMatch[4]);
    }

    // === Parser de TEXTO (siempre se ejecuta, complementa el QR y es el único método cuando el QR no está como texto) ===
    // Punto de Venta + Número — soporta varios formatos de distintos sistemas.
    const mPv = texto.match(/Punto\s+de\s+Venta\s*:?\s*0*(\d{1,5})(?!\d)/i);
    if (mPv && !resultado.puntoVenta) resultado.puntoVenta = Number(mPv[1]);
    const mNro = texto.match(/(?:Comp\.\s*Nro|Comprobante\s+Nro|N[°º]\s*Comp)\s*:?\s*0*(\d{1,8})(?!\d)/i);
    if (mNro && !resultado.numero) resultado.numero = Number(mNro[1]);
    // Compacto CON letra: "A 0005-00007755" / "A-0005-00022327" → letra + PV + Nro.
    // (Muy común en Facturas y Notas de crédito/débito de sistemas de gestión.)
    const mLetraNum = texto.match(/(?:^|[\s"'“”])([ABCEM])[\s-]+(\d{4,5})\s*-\s*(\d{7,8})\b/);
    if (mLetraNum) {
      if (!resultado.tipoCmpLetra) resultado.tipoCmpLetra = mLetraNum[1].toUpperCase();
      if (!resultado.puntoVenta) resultado.puntoVenta = Number(mLetraNum[2]);
      if (!resultado.numero) resultado.numero = Number(mLetraNum[3]);
    }
    // Compacto SIN letra: "0002-00006490". Puede haber varios (CAI, IIBB, etc.); si ya
    // conocemos el PV elegimos el que coincida, si no el primero.
    if (!resultado.puntoVenta || !resultado.numero) {
      const todos = [...texto.matchAll(/\b(\d{4,5})\s*-\s*(\d{7,8})\b/g)];
      let elegido = resultado.puntoVenta ? todos.find(m => Number(m[1]) === Number(resultado.puntoVenta)) : null;
      if (!elegido) elegido = todos[0];
      if (elegido) {
        if (!resultado.puntoVenta) resultado.puntoVenta = Number(elegido[1]);
        if (!resultado.numero) resultado.numero = Number(elegido[2]);
      }
    }
    // AFIP "Comprobante en línea": PV(5) y Nro(8) concatenados sin guión → 13 dígitos
    // ("0000100000105" = PV 00001 + Nro 00000105). Último recurso.
    if (!resultado.puntoVenta || !resultado.numero) {
      const m13 = texto.match(/\b(\d{5})(\d{8})\b/);
      if (m13) {
        if (!resultado.puntoVenta) resultado.puntoVenta = Number(m13[1]);
        if (!resultado.numero) resultado.numero = Number(m13[2]);
      }
    }
    // Fecha de emisión
    const mFecha = texto.match(/Fecha\s+de\s+Emisi[oó]n\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
    if (mFecha && !resultado.fecha) resultado.fecha = fechaArg(mFecha[1]);
    // Si no hay fecha etiquetada, tomamos la primera fecha del documento.
    if (!resultado.fecha) {
      const mF2 = texto.match(/\b(\d{1,2}[\/]\d{1,2}[\/]\d{4})\b/);
      if (mF2) resultado.fecha = fechaArg(mF2[1]);
    }
    // CAE — el número puede estar pegado a la etiqueta o suelto (el pdf-parse
    // suele separar etiquetas de valores). El CAE de ARCA es siempre de 14 dígitos.
    const mCae = texto.match(/CAE\s*N?[°º]?\s*:?\s*(\d{10,16})/i);
    if (mCae && !resultado.cae) resultado.cae = mCae[1];
    if (!resultado.cae) {
      const m14 = texto.match(/\b(\d{14})\b/);   // CAE = 14 dígitos (no lo es CUIT=11 ni PV+Nro=13)
      if (m14) resultado.cae = m14[1];
    }
    const mCaeVto = texto.match(/(?:Vto|Vencimiento)\.?\s*de(?:l)?\s*CAE\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
    if (mCaeVto) resultado.caeVencimiento = fechaArg(mCaeVto[1]);
    // Vto con mes en inglés ("Vto.:Jul 17 2026") típico de algunos sistemas.
    if (!resultado.caeVencimiento) {
      const _MESES_EN = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
      const mV = texto.match(/Vto\.?\s*:?\s*([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})/i);
      if (mV) {
        const mm = _MESES_EN[mV[1].toLowerCase()];
        if (mm) resultado.caeVencimiento = `${mV[3]}-${mm}-${String(mV[2]).padStart(2,'0')}`;
      }
    }

    // Tipo de comprobante: letra (A/B/C/E/M) + clase (factura / nota de crédito / débito).
    // 1) Por código AFIP "COD. NNN" — OJO: "011" tiene 3 dígitos (antes se leía "01").
    const mCod = texto.match(/COD\.\s*0*(\d{1,3})(?!\d)/i);
    if (mCod) {
      const cod = Number(mCod[1]);
      resultado.tipoCmpCodigo = cod;
      const comb = FACT_TIPO_AFIP[cod] || '';   // 'A','C','NCA','NDB'...
      if (!resultado.tipoCmpLetra && comb) resultado.tipoCmpLetra = (comb.replace(/^N[CD]/, '') || comb);
      if (/^NC/.test(comb)) resultado.clase = 'nota_credito';
      else if (/^ND/.test(comb)) resultado.clase = 'nota_debito';
    }
    // 2) Clase por texto (si no vino del código).
    if (!resultado.clase) {
      if (/NOTA\s*(?:DE\s*)?CR[EÉ]DITO/i.test(texto)) resultado.clase = 'nota_credito';
      else if (/NOTA\s*(?:DE\s*)?D[EÉ]BITO/i.test(texto)) resultado.clase = 'nota_debito';
      else if (/\bRECIBO\b/i.test(texto)) resultado.clase = 'recibo';
      else resultado.clase = 'factura';
    }
    // 3) Letra por texto: "FACTURA A", "NOTA DE CREDITO A", con o sin comillas.
    if (!resultado.tipoCmpLetra) {
      const mLetra = texto.match(/(?:FACTURA|NOTA\s*(?:DE\s*)?CR[EÉ]DITO|NOTA\s*(?:DE\s*)?D[EÉ]BITO|RECIBO)\s*["'“”]?\s*([ABCEM])\b/i);
      if (mLetra) resultado.tipoCmpLetra = mLetra[1].toUpperCase();
    }
    // 4) Letra sola en su propio renglón cerca del inicio (ej. la "C" debajo de "FACTURA").
    if (!resultado.tipoCmpLetra) {
      const sola = texto.split(/\r?\n/).slice(0, 45).map(l => l.trim())
        .find(l => /^["'“”]?[ABCEM]["'“”]?$/.test(l));
      if (sola) resultado.tipoCmpLetra = sola.replace(/[^ABCEMabcem]/g, '').toUpperCase();
    }
    if (!resultado.tipoCmpLetra) resultado.tipoCmpLetra = 'B';

    // === Moneda extranjera (dólar) + cotización ===
    // Detecta "U$S", "US$", "DÓLARES"; toma la cotización de "TC: 1.461,50" o "tipo de cambio".
    const _arNum = (s) => Number(String(s).replace(/\./g, '').replace(',', '.'));
    if (!resultado.moneda || resultado.moneda === 'PES') {
      // Dólar puede aparecer como U$S, US$, U$D, USD o "dólares".
      if (/U\$[SD]|US\$|\bUSD\b|D[OÓ]LAR/i.test(texto)) {
        resultado.moneda = 'DOL';
        const mTc = texto.match(/TC\s*:?\s*([\d.]*\d,\d{1,4})/i) || texto.match(/tipo\s+de\s+cambio[^\d]{0,40}([\d.]*\d,\d{1,4})/i);
        if (mTc) resultado.cotizacion = _arNum(mTc[1]);
        // Total en dólares "U$S 137,82" / "U$D 10.645,58" / "TOTAL US$ ..." si no salió de las etiquetas.
        if (!resultado.total) {
          const mTot = texto.match(/(?:U\$[SD]|US\$|USD)\s*([\d.]*\d,\d{2})/i);
          if (mTot) resultado.total = _arNum(mTot[1]);
        }
      }
    }

    // Importes (ARCA usa "1.830.150,00")
    if (!resultado.total)        resultado.total        = matchEtiqueta('Importe\\s+Total');
    if (!resultado.netoGravado)  resultado.netoGravado  = matchEtiqueta('Importe\\s+Neto\\s+Gravado|Subtotal');
    // Respaldo: si el texto viene desordenado (ARCA online) y no encontramos el total
    // junto a su etiqueta, tomamos el MAYOR monto con formato "$/,00" del comprobante
    // (el Importe Total casi siempre es el más grande).
    if (!resultado.total) {
      const montos = [...texto.matchAll(/(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})/g)]
        .map(mm => num(mm[1])).filter(v => v && v > 0);
      if (montos.length) resultado.total = Math.max(...montos);
    }
    // En Factura C (Monotributo) no hay IVA discriminado: neto = total.
    if (!resultado.netoGravado && resultado.total && (resultado.tipoCmpLetra === 'C')) {
      resultado.netoGravado = resultado.total;
    }
    resultado.iva21  = matchEtiqueta('IVA\\s*21\\s*%?') || resultado.iva21;
    resultado.iva105 = matchEtiqueta('IVA\\s*10[.,]5\\s*%?') || resultado.iva105;
    resultado.iva27  = matchEtiqueta('IVA\\s*27\\s*%?') || resultado.iva27;
    resultado.iva25  = matchEtiqueta('IVA\\s*2[.,]5\\s*%?') || resultado.iva25;
    resultado.iva5   = matchEtiqueta('IVA\\s*5\\s*%?') || resultado.iva5;

    // CUIT emisor / receptor. Los CUIT con etiqueta "CUIT:" suelen ser del receptor
    // (en el bloque del comprador). El emisor viene del nombre de archivo / QR; si no,
    // tomamos el primer "CUIT:" del texto. El receptor es un "CUIT:" distinto del emisor.
    const reCuitLine = /C\.?U\.?I\.?T\.?\s*:?\s*(\d{2}[-]?\d{8}[-]?\d{1})/gi;
    const cuitsEnContexto = [...texto.matchAll(reCuitLine)].map(m => m[1].replace(/-/g,''));
    if (!resultado.cuitEmisor && cuitsEnContexto.length >= 1) {
      resultado.cuitEmisor = cuitsEnContexto[0];
    }
    if (!resultado.cuitReceptor) {
      resultado.cuitReceptor = cuitsEnContexto.find(c => c !== resultado.cuitEmisor) || null;
    }

    // Razón social emisor. OJO: el texto de los PDF de ARCA viene desordenado, así que
    // NO usamos "\s*" (saltaría a la etiqueta siguiente, ej. "Domicilio:"). Primero
    // probamos el nombre suelto que aparece bajo ORIGINAL/DUPLICADO (formato ARCA online).
    const _esEtiqueta = (s) => /^(Domicilio|Condici[oó]n|C\.?U\.?I\.?T|Apellido|Ingresos|Fecha|Punto|Comp|Per[ií]odo|Raz[oó]n|IVA|COD)\b/i.test(s || '');
    let rsE = null;
    const mEmiName = texto.match(/(?:ORIGINAL|DUPLICADO)\s*\n\s*([A-ZÁÉÍÓÚÑ0-9][^\n]{2,80})/);
    if (mEmiName && !_esEtiqueta(mEmiName[1])) rsE = mEmiName[1].trim();
    if (!rsE) {
      const mRsE = texto.match(/Raz[oó]n\s+Social\s*:[ \t]*([^\n]+)/i);
      if (mRsE && !_esEtiqueta(mRsE[1])) rsE = mRsE[1].trim();
    }
    if (rsE) resultado.razonSocialEmisor = rsE.replace(/\s{2,}/g, ' ').slice(0, 120);
    // Razón social receptor (solo en la misma línea; si no, queda null).
    const mRsR = texto.match(/Apellido\s+y\s+Nombre\s*\/\s*Raz[oó]n\s+Social\s*:[ \t]*([^\n]+)/i);
    if (mRsR && !_esEtiqueta(mRsR[1])) resultado.razonSocialReceptor = mRsR[1].trim().replace(/\s{2,}/g, ' ').slice(0, 120);

    // === Descripción del item ===
    // Heurística: buscar las líneas entre la cabecera "Código Producto / Servicio..." y
    // las líneas de totales ("Importe Neto Gravado"). Tomar las líneas que tengan texto
    // alfabético (no solo números) y concatenarlas en una sola descripción.
    const lineas = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let descripcionItem = null;
    const idxHdr = lineas.findIndex(l => /C[oó]digo\s+Producto\s*\/\s*Servicio|Producto\s*\/\s*Servicio/i.test(l));
    const idxFin = lineas.findIndex(l => /Importe\s+Otros\s+Tributos|Importe\s+Neto\s+Gravado|Subtotal\s*:/i.test(l));
    if (idxHdr >= 0 && idxFin > idxHdr) {
      // Filtrar líneas que parezcan descripción (tienen letras) y no sean solo cabecera
      const candidatas = lineas.slice(idxHdr + 1, idxFin).filter(l => {
        if (l.length < 4) return false;
        if (/^[\d.,%$\s\-]+$/.test(l)) return false; // solo números/símbolos
        if (/^(Cantidad|U\.\s*medida|Precio|Bonif|Subtotal|Alicuota|IVA)$/i.test(l)) return false;
        return /[A-Za-zÁÉÍÓÚáéíóúÑñ]{3,}/.test(l);
      });
      if (candidatas.length) descripcionItem = candidatas.join(' ').replace(/\s{2,}/g, ' ').slice(0, 400);
    }
    // Fallback: si no encontramos descripción, usar "Producto / Servicio: <razon social emisor> Factura X PV-NRO"
    resultado.descripcionItem = descripcionItem;
    // Cantidad y unidad: extraer del bloque del item (heurística simple)
    if (idxHdr >= 0 && idxFin > idxHdr) {
      const bloque = lineas.slice(idxHdr + 1, idxFin).join(' ');
      const mCant = bloque.match(/(\d+(?:[.,]\d+)?)\s*(toneladas?|tn|kg|kilos?|litros?|lt|unidades?|u|m³|m3|m²|m2|hor[ao]s?|d[ií]as?|servicios?)/i);
      if (mCant) {
        resultado.cantidadItem = num(mCant[1]);
        resultado.unidadItem = mCant[2];
      }
    }

    res.json({
      ok: true,
      data: resultado,
      diagnostico: {
        fuente: resultado.fuente,
        tieneQR: fuenteQr,
        cuitsDetectados: cuitsUnicos,
        primerasLineas: lineas.slice(0, 25),
      },
    });
  } catch (e) { next(e); }
});

// ============================================================
// PARSER de LIQUIDACIÓN DE HACIENDA (Liquidación de compra por faena/venta).
// Extrae header (número, fecha, CAE, emisor/receptor), los renglones de
// animales (categoría/raza, kg, precio, bruto, IVA) detectando el tipo de
// animal, y el Importe Neto. Los números por renglón vienen concatenados en el
// texto del PDF; se separan usando la restricción cantidad × precio ≈ bruto.
// ============================================================
// ---- LIQUIDACIÓN PRIMARIA DE GRANOS (cereal): parser + import ----
function _parseLiquidacionCereal(t) {
  t = t || '';
  const num = (s) => { if (s == null || s === '') return null; let n = String(s).replace(/[$\s]/g, ''); if (/,\d{1,2}$/.test(n)) n = n.replace(/\./g, '').replace(',', '.'); else if (/\.\d{1,2}$/.test(n)) n = n.replace(/,/g, ''); else n = n.replace(/[,.]/g, ''); const v = Number(n); return isFinite(v) ? v : null; };
  const fechaArg = (s) => { if (!s) return null; const m = String(s).match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/); if (!m) return null; let y = m[3]; if (y.length === 2) y = '20' + y; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; };
  const coe = (t.match(/C\.O\.E\.:\s*(\d+)/) || [])[1] || null;
  const fecha = fechaArg((t.match(/Fecha:\s*([0-3]?\d[\/\-][01]?\d[\/\-]\d{4})/) || [])[1] || (t.match(/([0-3]?\d[\/\-][01]?\d[\/\-]\d{4}),/) || [])[1]);
  // Comprador (nuestro cliente): usa "C.U.I.T.:" con puntos; el corredor usa "CUIT:" sin puntos.
  const cuitIdx = t.search(/C\.U\.I\.T\.:\s*\d{11}/);
  const compradorCuit = (t.match(/C\.U\.I\.T\.:\s*(\d{11})/) || [])[1] || null;
  let compradorNombre = null;
  if (cuitIdx >= 0) { const rs = [...t.slice(0, cuitIdx).matchAll(/Razón Social:\s*(.+)/g)]; if (rs.length) compradorNombre = rs[rs.length - 1][1].trim(); }
  const gm = t.match(/(\d{1,2})\s*-\s*(MA[IÍ]Z|SOJA|MAN[IÍ][A-Z ]*|TRIGO|SORGO|GIRASOL|CEBADA|CENTENO|AVENA|ALPISTE|LINO|POROTO[A-Z ]*)/i);
  const granoNombre = gm ? gm[2].trim().toUpperCase().replace(/\s+/g, ' ') : null;
  const op = t.match(/([\d.,]+)\s*Kg\$([\d.,]+?\.\d{2})\$([\d.,]+?\.\d{2})(\d{1,2}(?:\.\d{1,2})?)\$([\d.,]+?\.\d{2})\$([\d.,]+?\.\d{2})/);
  let cantidadKg = null, precioKg = null, subtotal = null, alic = null, iva = null, cIva = null;
  if (op) { cantidadKg = num(op[1]); precioKg = num(op[2]); subtotal = num(op[3]); alic = num(op[4]); iva = num(op[5]); cIva = num(op[6]); }
  const deducciones = num((t.match(/([\d][\d.,]*)\s*Total Deducciones:/) || t.match(/Total Deducciones:\s*\$?\s*([\d.,]+)/) || [])[1]) || 0;
  let retenciones = num((t.match(/Total Retenciones Afip:\s*\$?\s*([\d.,]+)/) || [])[1]);
  if (retenciones == null) { const rz = t.slice(Math.max(0, t.indexOf('RETENCIONES'))); const rr = [...rz.matchAll(/\d{1,2}%\$\s*([\d.,]+)/g)].map(x => num(x[1])).filter(Boolean); retenciones = rr.reduce((a, b) => a + b, 0); }
  // Neto = "Importe Neto a Pagar" (preferido) o cIva - deducciones - retenciones.
  let neto = null; const li = t.search(/Importe\s+Neto\s+a\s+Pagar/i);
  if (li >= 0 && cIva) { const w = t.slice(Math.max(0, li - 120), li + 120); const cand = [...w.matchAll(/([\d][\d.,]*\.\d{2})/g)].map(x => num(x[1])).filter(v => v && v < cIva * 0.999 && v > cIva * 0.4); if (cand.length) neto = Math.max(...cand); }
  if (neto == null && cIva != null) neto = Math.round((cIva - deducciones - (retenciones || 0)) * 100) / 100;
  return { numero: coe, fecha, compradorNombre, compradorCuit, granoNombre, cantidadKg, precioKg, subtotal, alicuotaIva: alic, iva, operacionCIva: cIva, deducciones, retenciones: retenciones || 0, neto };
}
app.post('/api/admin/parse-liquidacion-cereal-pdf', authMiddleware, requireCompany, upload.single('archivo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Falta el archivo PDF' });
    if (!/\.pdf$/i.test(req.file.originalname || '')) return res.status(400).json({ ok: false, error: 'El archivo debe ser un PDF' });
    let pdfParse; try { pdfParse = await getPdfParse(); } catch { return res.status(501).json({ ok: false, error: 'El parser de PDF no está disponible. Cargá la liquidación a mano.' }); }
    let texto = ''; try { texto = (await pdfParse(req.file.buffer)).text || ''; } catch (e) { return res.status(400).json({ ok: false, error: 'No pude leer el PDF: ' + e.message }); }
    if (!/LIQUIDACI[ÓO]N\s+PRIMARIA\s+DE\s+GRANOS/i.test(texto)) return res.status(400).json({ ok: false, error: 'No parece una Liquidación Primaria de Granos. Verificá el PDF.' });
    const data = _parseLiquidacionCereal(texto);
    const prods = await prisma.producto.findMany({ where: { companyId: req.companyId, activo: true, categoria: 'cereales' }, select: { id: true, nombre: true } });
    let productoId = null;
    if (data.granoNombre) { const _g = _sinAcentos(data.granoNombre.split(' ')[0]); const pm = prods.find(p => _sinAcentos(p.nombre).includes(_g) || _g.includes(_sinAcentos(p.nombre))); productoId = pm?.id || null; }
    let clienteId = null, clienteNombre = null;
    if (data.compradorCuit) { const cl = await prisma.cliente.findFirst({ where: { companyId: req.companyId, cuit: data.compradorCuit } }); if (cl) { clienteId = cl.id; clienteNombre = cl.razonSocial; } }
    res.json({ ok: true, data: { ...data, productoId, clienteId, clienteNombre } });
  } catch (e) { next(e); }
});
app.post('/api/liquidaciones-cereal/importar', requireCompany, requirePermission('ventas:create'), async (req, res, next) => {
  try {
    const schema = z.object({
      depositoId: z.string().min(1),
      productoId: z.string().min(1),
      clienteId: z.string().nullable().optional(),
      clienteNuevo: z.object({ razonSocial: z.string().min(1), cuit: z.string().nullable().optional() }).nullable().optional(),
      fecha: z.coerce.date(),
      numero: z.string().nullable().optional(),
      cantidadKg: z.number().positive(),
      precioKg: z.number().nonnegative().nullable().optional(),
      operacionCIva: z.number().nonnegative().nullable().optional(),
      deducciones: z.number().nonnegative().default(0),
      retenciones: z.number().nonnegative().default(0),
      neto: z.number(),
      observaciones: z.string().nullable().optional(),
      viajeIds: z.array(z.string()).nullable().optional(),
    });
    const d = schema.parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      // Cliente: dedupe por CUIT o alta.
      let clienteId = d.clienteId || null;
      if (!clienteId && d.clienteNuevo) {
        let cl = d.clienteNuevo.cuit ? await tx.cliente.findFirst({ where: { companyId: req.companyId, cuit: d.clienteNuevo.cuit } }) : null;
        if (!cl) cl = await tx.cliente.create({ data: { companyId: req.companyId, razonSocial: d.clienteNuevo.razonSocial, cuit: d.clienteNuevo.cuit || null, condIVA: 'RI', activo: true } });
        clienteId = cl.id;
      }
      const kilosNetos = d.cantidadKg;
      const precioPorTn = d.precioKg != null ? d.precioKg * 1000 : (d.operacionCIva && kilosNetos ? d.operacionCIva / (kilosNetos / 1000) : 0);
      const bruto = d.operacionCIva != null ? d.operacionCIva : d.neto;
      const liq = await tx.liquidacionCereal.create({ data: {
        companyId: req.companyId, depositoId: d.depositoId, productoId: d.productoId, clienteId: clienteId || null,
        fecha: d.fecha, numero: d.numero || null,
        kilosBrutos: d.cantidadKg, porcMerma: 0, kilosNetos,
        precioPorTn, bruto, totalDescuentos: d.deducciones, totalImpuestos: d.retenciones, neto: d.neto,
        observaciones: d.observaciones || `Importada de LPG${d.numero ? ' C.O.E. ' + d.numero : ''}`,
      }});
      // Egreso de stock del depósito (kilos a toneladas).
      await tx.movimiento.create({ data: {
        companyId: req.companyId, productoId: d.productoId, depositoId: d.depositoId,
        fecha: d.fecha, tipo: 'egreso', motivo: 'liquidacion_cerealera',
        cantidad: kilosNetos / 1000, precio: precioPorTn, total: bruto,
        referencia: d.numero || null, observaciones: `Liquidación cereal (import) — neto ${d.neto.toFixed(2)}`,
        userId: req.user?.id || null,
      }});
      // Deuda del cliente (cuenta a cobrar) por el neto.
      if (clienteId) {
        await tx.ctaCte.create({ data: {
          companyId: req.companyId, contactoTipo: 'cliente', contactoId: clienteId, fecha: d.fecha,
          detalle: `Liquidación cereal ${d.numero || ''}`.trim(), referencia: `LIQ-${liq.id.slice(-6).toUpperCase()}`,
          debe: d.neto, haber: 0, categoria: 'liquidacion_cereal',
        }});
      }
      // Vincular con los viajes (CP) seleccionados — posición de granos.
      if (d.viajeIds && d.viajeIds.length) {
        for (const vid of d.viajeIds) {
          const v = await tx.viaje.findFirst({ where: { id: vid, companyId: req.companyId } });
          if (!v) continue;
          const kv = Number(v.kgDescarga || v.kgNetoDest || v.kgNeto || v.cantidad || 0);
          try { await tx.viajeLiquidacion.create({ data: { companyId: req.companyId, viajeId: vid, liquidacionId: liq.id, kilosAplicados: kv } }); } catch {}
          if (!v.liquidacionCerealId) { try { await tx.viaje.update({ where: { id: vid }, data: { liquidacionCerealId: liq.id } }); } catch {} }
        }
      }
      return { liq, clienteId };
    });
    res.status(201).json({ ok: true, data: result.liq, clienteCreado: !d.clienteId && !!result.clienteId });
  } catch (e) { next(e); }
});
// ---- Depurar productos DUPLICADOS en Stock (mismo nombre + categoría) ----
// Conserva el producto con stock (y su unidad), le hereda la familia del duplicado,
// reasigna referencias y borra el/los duplicados vacíos.
async function _gruposDuplicados(companyId) {
  const prods = await prisma.producto.findMany({ where: { companyId, activo: true }, select: { id: true, nombre: true, categoria: true, unidad: true, categoriaArticuloId: true, sku: true, codigoBarras: true, precioReferencia: true, updatedAt: true } });
  const movs = await prisma.movimiento.groupBy({ by: ['productoId', 'tipo'], where: { companyId }, _sum: { cantidad: true }, _count: { _all: true } });
  const stat = {};
  movs.forEach(m => { const s = stat[m.productoId] || (stat[m.productoId] = { ing: 0, egr: 0, cnt: 0 }); if (m.tipo === 'ingreso') s.ing += Number(m._sum.cantidad || 0); else if (m.tipo === 'egreso') s.egr += Number(m._sum.cantidad || 0); s.cnt += m._count._all; });
  const norm = (s) => _sinAcentos(s).replace(/\s+/g, ' ').trim();
  // Agrupamos SOLO por nombre normalizado: así detecta el mismo producto aunque la
  // categoría/familia haya quedado guardada distinta (insumos vs Insumos vs Herbicida).
  const groups = {};
  prods.forEach(p => { const k = norm(p.nombre); if (!k) return; (groups[k] || (groups[k] = [])).push({ ...p, existencia: (stat[p.id]?.ing || 0) - (stat[p.id]?.egr || 0), movs: stat[p.id]?.cnt || 0 }); });
  const dups = [];
  for (const k in groups) {
    const arr = groups[k]; if (arr.length < 2) continue;
    // Canónico = el que está en el Catálogo (tiene familia). Luego más reciente / con código.
    // El stock, movimientos y la unidad se MUEVEN a ese.
    const rank = (p) => [(p.categoriaArticuloId ? 1 : 0), (p.sku || p.codigoBarras ? 1 : 0), new Date(p.updatedAt).getTime(), p.movs];
    arr.sort((a, b) => { const ra = rank(a), rb = rank(b); for (let i = 0; i < ra.length; i++) { if (rb[i] !== ra[i]) return rb[i] - ra[i]; } return 0; });
    dups.push({ categoria: arr[0].categoria, nombre: arr[0].nombre, canonicalId: arr[0].id, items: arr.map(p => ({ id: p.id, nombre: p.nombre, categoria: p.categoria, unidad: p.unidad, familia: !!p.categoriaArticuloId, existencia: Math.round(p.existencia * 100) / 100, movs: p.movs, esCanonico: p.id === arr[0].id })) });
  }
  return dups;
}
// Alinea la FAMILIA (categoriaArticuloId) de cada producto con la que define su ítem
// del Catálogo (su "tipo": Herbicida, Fungicida, etc.). Devuelve la cantidad a corregir;
// si apply=true, la aplica. Así Stock muestra la familia consistente con el Catálogo.
async function _repararFamiliasDesdeCatalogo(companyId, apply) {
  const nrm = (s) => _sinAcentos(s).replace(/\s+/g, ' ').trim();
  const [nodos, items, prods] = await Promise.all([
    prisma.categoriaArticulo.findMany({ where: { companyId }, select: { id: true, nombre: true } }),
    prisma.catalogo.findMany({ where: { companyId }, select: { nombre: true, tipo: true, categoriaArticuloId: true } }),
    prisma.producto.findMany({ where: { companyId, activo: true }, select: { id: true, nombre: true, categoriaArticuloId: true } }),
  ]);
  const byName = {}; nodos.forEach(n => { byName[nrm(n.nombre)] = n.id; });
  const famByProd = {};
  items.forEach(it => { const fid = it.categoriaArticuloId || byName[nrm(it.tipo)]; if (fid) famByProd[nrm(it.nombre)] = fid; });
  let cnt = 0;
  for (const p of prods) {
    const fid = famByProd[nrm(p.nombre)];
    if (fid && p.categoriaArticuloId !== fid) { cnt++; if (apply) await prisma.producto.update({ where: { id: p.id }, data: { categoriaArticuloId: fid } }); }
  }
  return cnt;
}
app.get('/api/admin/stock/duplicados', requireCompany, requirePermission('stock:read'), async (req, res, next) => {
  try {
    const grupos = await _gruposDuplicados(req.companyId);
    let familias = 0; try { familias = await _repararFamiliasDesdeCatalogo(req.companyId, false); } catch {}
    let huerfanos = 0; try { huerfanos = (await _limpiarHaciendaHuerfana(req.companyId, false)).del; } catch {}
    res.json({ ok: true, data: grupos, familias, huerfanos });
  } catch (e) { next(e); }
});
// Elimina productos de HACIENDA cuya categoria de animal ya no existe en el catalogo
// de Animales (catHaciendaConfig). Ej: quedo solo Bovino y sobran Cabra, Chivo, etc.
// Si el producto tiene movimientos/referencias se DESACTIVA (no se pierde historial);
// si no tiene nada, se BORRA. En preview (apply=false) solo cuenta los que se borrarian.
async function _limpiarHaciendaHuerfana(companyId, apply) {
  const nrm = (s) => _sinAcentos(s || '').replace(/\s+/g, ' ').trim();
  const cats = await prisma.categoriaHaciendaConfig.findMany({ where: { companyId, activo: true }, select: { nombre: true } });
  const vivos = new Set(cats.map(c => nrm(c.nombre)));
  if (!vivos.size) return { del: 0, off: 0 }; // sin catalogo de hacienda no hay referencia autoritativa
  const prods = await prisma.producto.findMany({ where: { companyId, categoria: 'hacienda' }, select: { id: true, nombre: true, categoriaHacienda: true } });
  let del = 0, off = 0;
  for (const p of prods) {
    const key = nrm(p.categoriaHacienda || (p.nombre || '').split(' - ').pop());
    if (vivos.has(key)) continue; // sigue en el catalogo de Animales -> se queda
    if (!apply) { del++; continue; }
    const [nm, ia, fi, fci] = await Promise.all([
      prisma.movimiento.count({ where: { productoId: p.id } }),
      prisma.insumoAplicado.count({ where: { productoId: p.id } }),
      prisma.facturaItem.count({ where: { productoId: p.id } }),
      prisma.facturaCompraItem.count({ where: { productoId: p.id } }),
    ]);
    let hm = 0; try { hm = await prisma.haciendaMovimiento.count({ where: { companyId, categoria: p.categoriaHacienda || p.nombre } }); } catch {}
    if (nm + ia + fi + fci + hm === 0) {
      try { await prisma.producto.delete({ where: { id: p.id } }); del++; }
      catch { try { await prisma.producto.update({ where: { id: p.id }, data: { activo: false } }); off++; } catch {} }
    } else {
      try { await prisma.producto.update({ where: { id: p.id }, data: { activo: false } }); off++; } catch {}
    }
  }
  return { del, off };
}
app.post('/api/admin/stock/depurar-duplicados', requireCompany, requirePermission('stock:create'), async (req, res, next) => {
  try {
    if (!(req.user.superAdmin || _permOk(req, 'usuarios:*'))) return res.status(403).json({ ok: false, error: 'Solo un administrador puede depurar duplicados.' });
    const grupos = await _gruposDuplicados(req.companyId);
    let fusionados = 0, eliminados = 0; const errores = [];
    for (const g of grupos) {
      try {
        await prisma.$transaction(async (tx) => {
          const can = await tx.producto.findUnique({ where: { id: g.canonicalId } });
          for (const it of g.items) {
            if (it.id === g.canonicalId) continue;
            const dup = await tx.producto.findUnique({ where: { id: it.id } });
            await tx.movimiento.updateMany({ where: { productoId: it.id }, data: { productoId: g.canonicalId } });
            await tx.insumoAplicado.updateMany({ where: { productoId: it.id }, data: { productoId: g.canonicalId } });
            await tx.facturaItem.updateMany({ where: { productoId: it.id }, data: { productoId: g.canonicalId } });
            await tx.facturaCompraItem.updateMany({ where: { productoId: it.id }, data: { productoId: g.canonicalId } });
            try { await tx.liquidacionCereal.updateMany({ where: { productoId: it.id }, data: { productoId: g.canonicalId } }); } catch {}
            const upd = {};
            if (!can.categoriaArticuloId && dup.categoriaArticuloId) upd.categoriaArticuloId = dup.categoriaArticuloId;
            if (!can.sku && dup.sku) upd.sku = dup.sku;
            if (!can.codigoBarras && dup.codigoBarras) upd.codigoBarras = dup.codigoBarras;
            if (can.precioReferencia == null && dup.precioReferencia != null) upd.precioReferencia = dup.precioReferencia;
            // Heredar la unidad "real" del que se borra si el canónico tiene una genérica.
            if (/(unidad|^u$)/i.test(can.unidad || '') && dup.unidad && !/(unidad|^u$)/i.test(dup.unidad)) upd.unidad = dup.unidad;
            if (dup.ultimoCostoCompra != null && can.ultimoCostoCompra == null) { upd.ultimoCostoCompra = dup.ultimoCostoCompra; upd.ultimoCostoMoneda = dup.ultimoCostoMoneda || null; }
            if (Object.keys(upd).length) { await tx.producto.update({ where: { id: g.canonicalId }, data: upd }); Object.assign(can, upd); }
            await tx.producto.delete({ where: { id: it.id } });
            eliminados++;
          }
        });
        fusionados++;
      } catch (e) { errores.push(`${g.nombre}: ${e.message}`); }
    }
    let familias = 0; try { familias = await _repararFamiliasDesdeCatalogo(req.companyId, true); } catch {}
    let huerfanos = { del: 0, off: 0 }; try { huerfanos = await _limpiarHaciendaHuerfana(req.companyId, true); } catch {}
    res.json({ ok: true, data: { grupos: grupos.length, fusionados, eliminados, familias, huerfanos: huerfanos.del + huerfanos.off, huerfanosDel: huerfanos.del, huerfanosOff: huerfanos.off, errores } });
  } catch (e) { next(e); }
});
// Detecta la categoría del sistema a partir del texto "Categoría / Raza".
function _detectCategoriaHacienda(txt) {
  const x = (txt || '').toLowerCase();
  const map = [
    ['novillito','Novillito'], ['vaquillona','Vaquillona'], ['novillo','Novillo'],
    ['torito','Torito'], ['ternera','Ternera'], ['ternero','Ternero'],
    ['vaquilla','Vaquillona'], ['vaca','Vaca'], ['toro','Toro'], ['buey','Buey'],
    ['lechon','Lechón'], ['lechón','Lechón'], ['capon','Capón'], ['capón','Capón'],
    ['cachorra','Cachorra'], ['cachorro','Cachorro'], ['cerda','Cerda'], ['padrillo','Padrillo'],
    ['oveja','Oveja'], ['cordero','Cordero'], ['carnero','Carnero'], ['capon ovino','Capón'],
  ];
  for (const [k, v] of map) { if (x.includes(k)) return v; }
  return null;
}
app.post('/api/admin/parse-liquidacion-hacienda-pdf', authMiddleware, requireCompany, upload.single('archivo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Falta el archivo PDF' });
    if (!/\.pdf$/i.test(req.file.originalname || '')) return res.status(400).json({ ok: false, error: 'El archivo debe ser un PDF' });
    let pdfParse;
    try { pdfParse = await getPdfParse(); }
    catch (e) { return res.status(501).json({ ok: false, error: 'El parser de PDF no está disponible (pdf-parse no instalado). Cargá la liquidación a mano.' }); }
    let texto = '';
    try { texto = (await pdfParse(req.file.buffer)).text || ''; }
    catch (e) { return res.status(400).json({ ok: false, error: 'No pude leer el PDF: ' + e.message }); }

    const num = (s) => {
      if (s == null || s === '') return null;
      let n = String(s).replace(/[$\s]/g, '');
      if (/,\d{1,2}$/.test(n)) n = n.replace(/\./g, '').replace(',', '.');
      else if (/\.\d{1,2}$/.test(n)) n = n.replace(/,/g, '');
      else n = n.replace(/[,.]/g, '');
      const v = Number(n); return isFinite(v) ? v : null;
    };
    const fechaArg = (s) => {
      if (!s) return null;
      const m = String(s).match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
      if (!m) return null;
      let yy = m[3]; if (yy.length === 2) yy = '20' + yy;
      return `${yy}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    };
    // Separa "cantidad(int) precio(money) bruto(money)" pegados, usando cant*precio≈bruto.
    const parse3 = (s) => {
      const decs = [...s.matchAll(/\.\d{2}/g)];
      if (decs.length < 2) return { cantidad: null, precio: null, bruto: num(s) };
      const dFirst = decs[0].index, dLast = decs[decs.length - 1].index;
      const bruto = num(s.slice(dFirst + 3, dLast) + s.slice(dLast, dLast + 3));
      const pre = s.slice(0, dFirst), preDec = s.slice(dFirst + 1, dFirst + 3);
      const digits = pre.replace(/[^\d]/g, '');
      let best = null;
      for (let cut = 1; cut < digits.length; cut++) {
        const cant = Number(digits.slice(0, cut)), precio = Number(digits.slice(cut) + '.' + preDec);
        if (!precio) continue;
        const err = Math.abs(cant * precio - bruto) / (bruto || 1);
        if (best === null || err < best.err) best = { cant, precio, err };
      }
      if (best && best.err < 0.03) return { cantidad: best.cant, precio: best.precio, bruto };
      return { cantidad: null, precio: null, bruto };
    };

    const numero = (texto.match(/N°\s*([\d]{2,5}-[\d]{4,8})/) || [])[1]
      || ((texto.match(/(\d{4,5})\s*-\s*(\d{6,8})/) || []).slice(1).join('-') || null);  // ej "00013 - 00000087"
    const fecha = fechaArg((texto.match(/([0-3]?\d[\/\-][01]?\d[\/\-]\d{2,4})\s*Fecha/) || [])[1]) || fechaArg((texto.match(/Fecha[:\s]*([0-3]?\d[\/\-][01]?\d[\/\-]\d{2,4})/i) || [])[1]);
    // CAE: en algunos templates el nro va ANTES del rótulo "CAE N°" (ej. LIVORNO), en otros después.
    const cae = (texto.match(/(\d{14})\s*CAE\s*N/i) || [])[1] || (texto.match(/CAE\s*N[^0-9]{0,8}(\d{14})/i) || [])[1] || (texto.match(/CAE[^0-9]{0,8}(\d{14})/i) || [])[1] || null;
    const caeVto = fechaArg((texto.match(/Vto\.?\s*de\s*CAE[:\s]*([0-3]?\d[\/\-][01]?\d[\/\-]\d{2,4})/i) || [])[1]);
    const emisorCuit = (texto.match(/(\d{11})CUIT:/) || [])[1] || null;
    const emisorNombre = (texto.match(/\n([A-ZÁÉÍÓÚÑ][^\n]*?S\.?\s?R\.?\s?L\.?|[A-ZÁÉÍÓÚÑ][^\n]*?S\.?\s?A\.?)\n/) || [])[1] || null;
    const recM = texto.match(/Receptor[\s\S]{0,60}?(\d{11})CUIT:([^\n]+?)Nombre/i);
    const receptorCuit = recM ? recM[1] : null;
    const receptorNombre = recM ? recM[2].trim() : null;

    // Renglones. Hay DOS formatos de columnas en las liquidaciones:
    //  (A) clásico: la categoría va ANTES y los importes DESPUÉS de "Kg. Vivo".
    //  (B) invertido (ej. LIVORNO): importes ANTES, cabezas justo DESPUÉS de "Kg. Vivo",
    //      y la categoría/raza en la línea SIGUIENTE. Se detecta por el encabezado.
    const invertido = /\$ ?IVA[\s\S]{0,60}Cabezas[\s\S]{0,12}Categor/i.test(texto);
    const secEnd = texto.indexOf('Importe Bruto:');   // usado también abajo para el Importe Neto
    const renglones = [];
    if (invertido) {
      // Ej: "149,940.0010.501,428,000.005,100.00280Kg. Vivo20\nPorcina Lechones Livianos"
      //   antes de "Kg. Vivo": $IVA %IVA $Bruto $UM(precio) Cantidad(kg)  ·  después: Cabezas  ·  línea sig.: categoría
      const MONEY = /\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2}/g;
      const reInv = /([\d.,]{6,})Kg\.?\s*Vivo(\d{1,4})\s*\n([^\n]+)/g;
      let mm;
      while ((mm = reInv.exec(texto))) {
        const blob = mm[1];
        const cabezas = parseInt(mm[2], 10) || null;
        const catTexto = mm[3].replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
        const toks = blob.match(MONEY) || [];
        const vals = toks.map(num).filter(v => v != null);
        // cantidad (kg) = entero pegado DESPUÉS del último importe
        let kilos = null;
        if (toks.length) { const lastTok = toks[toks.length - 1]; const idx = blob.lastIndexOf(lastTok); const tail = blob.slice(idx + lastTok.length).replace(/[^\d]/g, ''); kilos = tail ? parseInt(tail, 10) : null; }
        const bruto = vals.length ? Math.max(...vals) : null;               // $ Bruto = el mayor
        const precioKg = vals.length ? vals[vals.length - 1] : null;        // $ UM = el último importe
        const alic = vals.find(v => v > 0 && v <= 30) || 10.5;              // % IVA (alicuota chica)
        renglones.push({
          especie: (catTexto.match(/(Bovin|Porcin|Ovin|Equin|Caprin)[oa]?/i) || [])[0] || null,
          categoriaTexto: catTexto || null,
          raza: (catTexto.match(/\/\s*(.+)$/) || [])[1] || null,
          categoria: _detectCategoriaHacienda(catTexto),
          tropa: null,
          cabezas,
          kilos, precioKg, bruto,
          alicuotaIva: alic, iva: bruto ? Math.round(bruto * alic) / 100 : null,
        });
      }
    } else {
      const secStart = texto.indexOf('$ Bruto% IVA$ IVA');
      const sec = secStart >= 0 ? texto.slice(secStart, secEnd > secStart ? secEnd : undefined) : texto;
      const re = /(\d+)Kg\.?\s*Vivo([\d.,]+)/g;
      let m, last = 0;
      while ((m = re.exec(sec))) {
        const chunk = sec.slice(last, m.index); last = re.lastIndex;
        let raw = m[2];
        const alic = num((raw.match(/(\d{1,2}\.\d{2})$/) || [])[1]) || 10.5;
        raw = raw.replace(/(\d{1,2}\.\d{2})$/, '');
        const p = parse3(raw);
        const em = chunk.match(/(Bovino|Porcino|Ovino|Equino|Caprino)[\s\S]*/i);
        const catTexto = (em ? em[0] : chunk).replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
        // m[1] trae N° Tropa + Cabezas PEGADOS (ej "390748" = tropa 39074 + 8 cabezas).
        // Los separamos usando los kilos: el corte cuyo peso/cabeza sea plausible.
        let tropa = m[1] || null, cabezas = null;
        const _kg = p.cantidad;
        if (_kg && m[1] && m[1].length >= 2) {
          const cands = [];
          for (const nd of [1, 2]) {
            if (m[1].length > nd) { const cab = parseInt(m[1].slice(-nd), 10); if (cab > 0) cands.push({ cab, tropa: m[1].slice(0, -nd), w: _kg / cab }); }
          }
          const enRango = cands.filter(c => c.w >= 60 && c.w <= 900); // peso/cabeza típico (bovino/ovino/porcino)
          if (enRango[0]) { cabezas = enRango[0].cab; tropa = enRango[0].tropa; }
        }
        renglones.push({
          especie: (chunk.match(/(Bovino|Porcino|Ovino|Equino|Caprino)/i) || [])[1] || null,
          categoriaTexto: catTexto || null,
          raza: (catTexto.match(/\/\s*(.+)$/) || [])[1] || null,
          categoria: _detectCategoriaHacienda(catTexto),
          tropa,
          cabezas,   // autodetectado desde los kilos; el usuario lo puede corregir
          kilos: p.cantidad, precioKg: p.precio, bruto: p.bruto,
          alicuotaIva: alic, iva: p.bruto ? Math.round(p.bruto * alic) / 100 : null,
        });
      }
    }
    const brutoTotal = renglones.reduce((a, r) => a + (r.bruto || 0), 0);
    const ivaBruto = renglones.reduce((a, r) => a + (r.iva || 0), 0);
    // Importe Neto: el mayor valor de la zona de totales (bruto + iva + gastos).
    const totZona = texto.slice(secEnd >= 0 ? secEnd : 0);
    const vals = [...totZona.matchAll(/(\d{1,3}(?:,\d{3})+\.\d{2})/g)].map(x => num(x[1])).filter(Boolean);
    const neto = vals.length ? Math.max(...vals) : null;
    // Gastos e impuestos (informativo): neto - bruto - iva (si el neto es mayor).
    const gastosMasIva = (neto != null) ? Math.max(0, Math.round((neto - brutoTotal - ivaBruto) * 100) / 100) : 0;

    res.json({ ok: true, data: {
      numero, fecha, cae, caeVto, emisorCuit, emisorNombre, receptorCuit, receptorNombre,
      renglones, brutoTotal: Math.round(brutoTotal * 100) / 100, ivaBruto: Math.round(ivaBruto * 100) / 100,
      gastosMasIva, neto,
    }});
  } catch (e) { next(e); }
});

// Parser del PDF de la FACTURA del frigorifico (faenado, ej. LIVORNO factura A).
// Extrae emisor (frigorifico), numero, fecha, kg totales, precio/kg, IVA y medias
// reses -> se usa para prefilear el paso 2 del asistente de Faena.
app.post('/api/admin/parse-factura-frigorifico-pdf', authMiddleware, requireCompany, upload.single('archivo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Falta el archivo' });
    let pdfParse; try { pdfParse = await getPdfParse(); } catch { return res.status(501).json({ ok: false, error: 'El parser de PDF no está disponible. Cargá la factura a mano.' }); }
    let texto = ''; try { texto = (await pdfParse(req.file.buffer)).text || ''; } catch (e) { return res.status(400).json({ ok: false, error: 'No pude leer el PDF: ' + e.message }); }
    // num() tolerante para importes con miles/decimales de 2 dígitos.
    const num = (s) => { if (s == null || s === '') return null; let n = String(s).replace(/[$\s]/g, ''); if (/,\d{1,2}$/.test(n)) n = n.replace(/\./g, '').replace(',', '.'); else if (/\.\d{1,2}$/.test(n)) n = n.replace(/,/g, ''); else n = n.replace(/[,.]/g, ''); const v = Number(n); return isFinite(v) ? v : null; };
    const fechaArg = (s) => { if (!s) return null; const m = String(s).match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/); if (!m) return null; let yy = m[3]; if (yy.length === 2) yy = '20' + yy; return `${yy}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; };
    const comp = texto.match(/Comprobante\s*N[°º:\s]*([\d]{3,5})\s*-\s*([\d]{6,8})/i);
    const facturaPv = comp ? parseInt(comp[1], 10) : null;
    const facturaNro = comp ? parseInt(comp[2], 10) : null;
    const fechaFactura = fechaArg((texto.match(/Fecha\s*Emisi[oó]n[:\s]*([0-3]?\d[\/\-][01]?\d[\/\-]\d{2,4})/i) || [])[1]) || fechaArg((texto.match(/([0-3]?\d[\/\-][01]?\d[\/\-]\d{2,4})/) || [])[1]);
    const frigorificoCuit = (texto.match(/CUIT[:\s]*([23]\d[\- ]?\d{8}[\- ]?\d)/i) || [])[1] || (texto.match(/(30[\- ]?\d{8}[\- ]?\d)/) || [])[1] || null;
    let frigorifico = (texto.match(/(LIVORNO[^\n]{0,20}|[A-ZÁÉÍÓÚÑ][A-Za-z.\s]{2,40}FRIGOR[IÍ]FICO)/i) || [])[1] || null;
    if (frigorifico) frigorifico = frigorifico.replace(/\s{2,}/g, ' ').trim();
    const kgFaenado = num((texto.match(/Total\s*Cantidad\s*([\d.,]+)/i) || [])[1]);
    const mediasRes = num((texto.match(/Cant\.?\s*Secund\.?\s*([\d.,]+)/i) || [])[1]);
    const subtotal = num((texto.match(/SubTotal\s*([\d.,]+)/i) || [])[1]);
    const ivaFaenado = num((texto.match(/IVA[^%\n]{0,12}(\d{1,2}[.,]\d{1,2})\s*%/i) || [])[1]) || 10.5;
    // Precio/kg robusto: subtotal (neto) / kg. Evita el precio de 4 decimales del renglón.
    let precioKgFaenado = (subtotal && kgFaenado) ? Math.round((subtotal / kgFaenado) * 100) / 100 : null;
    const lechonesEnteros = mediasRes ? Math.round(mediasRes / 2) : null;
    res.json({ ok: true, data: {
      frigorifico, frigorificoCuit, facturaPv, facturaNro, fechaFactura,
      kgFaenado, precioKgFaenado, ivaFaenado, lechonesEnteros, mediasRes,
    }});
  } catch (e) { next(e); }
});

// Parser del PDF de la CONFIRMACION DE NEGOCIO / SLIP del acopio (ej. Agrocampo).
// Extrae los datos del contrato de cereal para prefilear el alta del contrato.
app.post('/api/admin/parse-confirmacion-cereal-pdf', authMiddleware, requireCompany, upload.single('archivo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Falta el archivo' });
    let pdfParse; try { pdfParse = await getPdfParse(); } catch { return res.status(501).json({ ok: false, error: 'El parser de PDF no está disponible. Cargá el contrato a mano.' }); }
    let texto = ''; try { texto = (await pdfParse(req.file.buffer)).text || ''; } catch (e) { return res.status(400).json({ ok: false, error: 'No pude leer el PDF: ' + e.message }); }
    const T = texto.replace(/ /g, ' ');
    const num = (s) => { if (s == null || s === '') return null; let n = String(s).replace(/[$\sU]/gi, '').replace(/[°º]/g, ''); if (/,\d{1,2}$/.test(n)) n = n.replace(/\./g, '').replace(',', '.'); else if (/\.\d{1,2}$/.test(n)) n = n.replace(/,/g, ''); else n = n.replace(/[,.]/g, ''); const v = Number(n); return isFinite(v) ? v : null; };
    const fechaArg = (s) => { if (!s) return null; const m = String(s).match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/); if (!m) return null; let yy = m[3]; if (yy.length === 2) yy = '20' + yy; return `${yy}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`; };
    const g = (re) => { const m = T.match(re); return m ? m[1].trim() : null; };
    const numeroInterno  = g(/Contrato\s*Interno\s*([0-9]{3,8})/i);
    const numeroCorredor = g(/Contrato\s*Corredor\s*([0-9]{4}\s*-\s*[0-9]{3,8})/i)?.replace(/\s+/g,'') || g(/([0-9]{4}-[0-9]{3,8})/);
    const cosecha        = g(/Cosecha\s*([0-9]{2}\s*-\s*[0-9]{2})/i)?.replace(/\s+/g,'');
    const fecha          = fechaArg(g(/FECHA\s*([0-3]?\d[\/\-][01]?\d[\/\-]\d{2,4})/i)) || fechaArg(g(/([0-3]?\d[\/\-][01]?\d[\/\-]\d{2,4})/));
    // Comprador / Corredor (nombre + CUIT). El corredor suele aparecer antes del comprador.
    const corredorNombre = g(/Corredor\s*\n?\s*([A-ZÁÉÍÓÚÑ][A-Za-z0-9.\s&]{3,60}?)\s*CUIT/i);
    const corredorCuit   = g(/Corredor[\s\S]{0,80}?CUIT\s*N?[°º:\s]*([23]\d[\- ]?\d{8}[\- ]?\d)/i);
    const compradorNombre= g(/Comprador\s*\n?\s*([A-ZÁÉÍÓÚÑ][A-Za-z0-9.\s&]{3,60}?)\s*CUIT/i);
    const compradorCuit  = g(/Comprador[\s\S]{0,80}?CUIT\s*N?[°º:\s]*([23]\d[\- ]?\d{8}[\- ]?\d)/i);
    const procedencia    = g(/Procedencia[:\s]*([A-ZÁÉÍÓÚÑ][A-Za-z.\s]{2,30}?)\s*(?:Destino|Producto|Comision)/i);
    const destino        = g(/Destino[:\s]*([A-ZÁÉÍÓÚÑ][A-Za-z.\s]{2,30}?)\s*(?:Producto|Comision|Procedencia|\n)/i);
    const cereal         = g(/Producto[:\s]*([A-ZÁÉÍÓÚÑ]{3,20})/i);
    const comisionPorc   = num(g(/Comision[:\s]*([\d.,]+)\s*%/i));
    const tnsPactadas    = num(g(/Tns[:\s]*([\d.,]+)/i));
    const volatilPorc    = num(g(/Volatil[:\s]*([\d.,]+)/i));
    const pagoDias       = num(g(/Pago[:\s]*([\d]+)\s*D/i));
    const contraFlete    = num(g(/Contra\s*Flete[:\s]*U?\$*\s*([\d.,]+)/i));
    const gastoEntregador= num(g(/Gto\.?\s*Entregador[:\s]*(?:SI|NO)?\s*\$?\s*([\d.,]+)/i));
    const gastoEntregadorIva = /Gto\.?\s*Entregador[^\n]*\+\s*IVA/i.test(T);
    const tarifaFlete    = num(g(/Tar\.?\s*Flete[:\s]*\$?\s*([\d.,]+)/i));
    const porcParcial    = num(g(/%?\s*Parcial[:\s]*([\d.,]+)/i));
    const porcFinal      = num(g(/%?\s*Final[:\s]*([\d.,]+)/i));
    const reciboHasta    = num(g(/Recibo\s*hasta\s*([\d.,]+)\s*%/i));
    const esAfijar       = /\bAFC\b|a\s*fijar/i.test(T);
    const pizarra        = /Pizarra\s*Rosario/i.test(T) ? 'Pizarra Rosario' : null;
    // Plazo de entrega: "01/10/ al 31/12/2026" (el desde puede no traer año → toma el del hasta)
    let plazoEntregaDesde = null, plazoEntregaHasta = null;
    const pe = T.match(/Plazo\s*de\s*Entrega\s*([0-3]?\d[\/\-][01]?\d(?:[\/\-]\d{2,4})?)\s*al?\s*([0-3]?\d[\/\-][01]?\d[\/\-]\d{2,4})/i);
    if (pe) {
      plazoEntregaHasta = fechaArg(pe[2]);
      let desde = pe[1];
      if (!/[\/\-]\d{2,4}$/.test(desde.replace(/\/$/,''))) { const yy = (pe[2].match(/(\d{2,4})$/)||[])[1]; desde = desde.replace(/\/$/,'') + '/' + yy; }
      plazoEntregaDesde = fechaArg(desde);
    }
    res.json({ ok: true, data: {
      numeroInterno, numeroCorredor, cosecha, fecha,
      compradorNombre, compradorCuit, corredorNombre, corredorCuit,
      procedencia, destino, cereal, comisionPorc, tnsPactadas, volatilPorc, pagoDias,
      contraFlete, gastoEntregador, gastoEntregadorIva, tarifaFlete,
      porcParcial, porcFinal, reciboHasta, pizarra,
      tipoPrecio: esAfijar ? 'a_fijar' : 'fijo', moneda: 'USD',
      plazoEntregaDesde, plazoEntregaHasta,
    }});
  } catch (e) { next(e); }
});

// ============================================================
// COBROS Y PAGOS: pago/cobro general con multi-comprobante e Intercompany.
// ============================================================
// Helper: valida que el usuario tenga acceso a una empresa dada (super admin
// puede a todas; resto solo a las que tiene membresia).
function _userTieneAcceso(req, companyId) {
  if (req.user.superAdmin) return true;
  return (req.user.userCompanies || []).some(uc => uc.companyId === companyId);
}

// === GET cuentas pendientes (clientes que nos deben / proveedores que les debemos) ===
// Devuelve la lista de comprobantes pendientes filtrada por contactoTipo y opcionalmente
// por contactoId. Util para armar el modal de pago / cobro masivo.
// === POST registrar pago a proveedor (multi-comprobante + multi-metodo) ===
// Body:
//   proveedorId: ID del proveedor
//   comprobantes: [{ ctaCteId, importeAplicado }]
//   metodo: 'efectivo' | 'cheque' | 'transferencia' | 'intercompany'
//   monto: total que se paga (suma de comprobantes)
//   // Segun metodo:
//   cajaOrigen?: para efectivo
//   chequeId?: para cheque (cheque de terceros que se endosa al proveedor)
//   bancoCuentaId?: para transferencia
//   empresaOrigenId?: para intercompany (la firma del grupo que pone los fondos)
//   recursoIntercompany?: 'cheque' | 'transferencia' | 'efectivo' (opcional, default 'transferencia')
//   chequeIdInterco?: si recursoIntercompany='cheque', cheque de la otra firma a usar
//   cuentaOrigenInterco?: si transferencia desde la otra firma
//   fecha: fecha del pago
//   observaciones?
app.post('/api/pagos-proveedores', requireCompany, requirePermission('finanzas:create'), async (req, res, next) => {
  try {
    const schema = z.object({
      proveedorId: z.string().min(1),
      comprobantes: z.array(z.object({
        ctaCteId: z.string().min(1),
        importeAplicado: z.number().positive(),
      })).min(0),  // 0 = pago "a cuenta" (sin comprobante puntual)
      // Notas de crédito / créditos a cuenta que se aplican para reducir lo que
      // se paga en efectivo. Cada uno es un haber puro (debe=0) de la cta cte.
      creditos: z.array(z.object({
        ctaCteId: z.string().min(1),
        importeAplicado: z.number().positive(),
      })).optional().default([]),
      metodo: z.enum(['efectivo', 'cheque', 'transferencia', 'intercompany', 'cereal', 'externo', 'tarjeta']),
      monto: z.number().nonnegative(),   // 0 = solo vinculación (NC cubre todo, sin plata)
      fecha: z.coerce.date(),
      cajaOrigen: z.string().nullable().optional(),
      chequeId: z.string().nullable().optional(),
      // Cheque PROPIO nuevo cargado en la misma pantalla del pago (sin darlo de
      // alta antes en Tesorería). Se crea y se entrega al proveedor en un paso.
      nuevoCheque: z.object({
        formato: z.enum(['fisico', 'electronico']).optional().default('fisico'),
        banco: z.string().nullable().optional(),
        cuenta: z.string().nullable().optional(),
        nroCheque: z.string().min(1),
        fechaEmision: z.coerce.date().nullable().optional(),
        fechaPago: z.coerce.date(),
        monto: z.number().nullable().optional(),
        librador: z.string().nullable().optional(),
      }).nullable().optional(),
      bancoCuentaId: z.string().nullable().optional(),
      empresaOrigenId: z.string().nullable().optional(),
      // Intercompany: cómo pone los fondos la firma origen (mueve SU recurso).
      recursoIntercompany: z.enum(['efectivo','cheque','transferencia','deuda']).nullable().optional(),
      cajaInterco: z.string().nullable().optional(),            // caja de la firma origen (efectivo)
      chequeIdInterco: z.string().nullable().optional(),        // cheque de la firma origen
      bancoCuentaIdInterco: z.string().nullable().optional(),   // cuenta de la firma origen (transferencia)
      monedaPago: z.string().nullable().optional(),     // moneda con la que se paga (default = la de la deuda)
      cotizacionPago: z.number().positive().nullable().optional(), // ARS por unidad de monedaPago, al día del pago
      // Entrega de cereal (canje): se paga una deuda en grano entregando ese grano.
      cerealProductoId: z.string().nullable().optional(),  // producto cereal del stock que se entrega
      depositoId: z.string().nullable().optional(),        // cerealera/silo de donde sale
      precioPizarra: z.number().nonnegative().nullable().optional(), // ARS por tn al día de la entrega (valuación)
      observaciones: z.string().nullable().optional(),
    });
    const d = schema.parse(req.body);
    const sumaAplicada = d.comprobantes.reduce((a, c) => a + c.importeAplicado, 0);
    const sumaCreditos = d.creditos.reduce((a, c) => a + c.importeAplicado, 0);
    // d.monto = lo que efectivamente sale de caja/banco (en monedaPago). Si se paga
    // en la MISMA moneda de la deuda, debe coincidir con (comprobantes − notas de crédito).
    // Si se paga en otra moneda (ej: deuda USD, pago ARS) no se exige igualdad.
    const _mismaMoneda = !d.monedaPago;
    if (d.comprobantes.length && _mismaMoneda && Math.abs((sumaAplicada - sumaCreditos) - d.monto) > 0.01) {
      return res.status(400).json({ ok: false, error: 'El neto (comprobantes ' + sumaAplicada.toFixed(2) + ' − notas de crédito ' + sumaCreditos.toFixed(2) + ') no coincide con el monto pagado (' + d.monto + ')' });
    }
    if (sumaCreditos > sumaAplicada + 0.01) {
      return res.status(400).json({ ok: false, error: 'Las notas de crédito aplicadas (' + sumaCreditos.toFixed(2) + ') superan el total de comprobantes tildados (' + sumaAplicada.toFixed(2) + ')' });
    }

    // Validar Intercompany
    if (d.metodo === 'intercompany') {
      if (!d.empresaOrigenId) return res.status(400).json({ ok: false, error: 'Falta empresaOrigenId para pago Intercompany' });
      if (d.empresaOrigenId === req.companyId) return res.status(400).json({ ok: false, error: 'La empresa origen no puede ser la misma que la activa' });
      if (!_userTieneAcceso(req, d.empresaOrigenId)) return res.status(403).json({ ok: false, error: 'No tenés acceso a la empresa origen del Intercompany' });
      // Verificar permiso de intercompany
      const tienePermInterco = req.user.superAdmin || (req.user.userCompanies || []).some(uc =>
        uc.companyId === req.companyId &&
        ((uc.role?.permissions || []).includes('finanzas:intercompany') ||
         (uc.role?.permissions || []).includes('finanzas:*') ||
         (uc.role?.permissions || []).includes('*:*'))
      );
      if (!tienePermInterco) return res.status(403).json({ ok: false, error: 'No tenés permiso finanzas:intercompany' });
    }

    // Resolver el proveedor (para el motivo)
    const prov = await prisma.proveedor.findFirst({ where: { id: d.proveedorId, companyId: req.companyId } });
    if (!prov) return res.status(404).json({ ok: false, error: 'Proveedor no encontrado' });

    const result = await prisma.$transaction(async (tx) => {
      // 1. Marcar/disminuir las CtaCte pendientes del proveedor
      // Convención del sistema: saldo = debe - haber. La factura de compra deja
      // debe=total (le debemos). Pagar = contra-asiento con haber=importe.
      let deudaArs = 0;        // valor contable (ARS) de la deuda que se está saldando
      let deudaArsConocida = true;
      let monedaDeuda = null;
      let credRestante = sumaCreditos;   // notas de crédito a repartir entre las facturas (FIFO)
      for (const c of d.comprobantes) {
        const cc = await tx.ctaCte.findFirst({ where: { id: c.ctaCteId, companyId: req.companyId, contactoTipo: 'proveedor', contactoId: d.proveedorId } });
        if (!cc) throw new Error('Comprobante no encontrado: ' + c.ctaCteId);
        const saldoPendiente = Number(cc.debe || 0) - Number(cc.haber || 0);
        if (c.importeAplicado > saldoPendiente + 0.01) {
          throw new Error('Importe aplicado (' + c.importeAplicado + ') excede el saldo pendiente del comprobante (' + saldoPendiente + ')');
        }
        monedaDeuda = cc.moneda || 'ARS';
        const cotDeuda = (cc.moneda && cc.moneda !== 'ARS') ? (cc.cotizacion ?? null) : 1;
        if (cotDeuda == null) deudaArsConocida = false; else deudaArs += c.importeAplicado * cotDeuda;
        // Parte de este comprobante cubierta por notas de crédito vs. por plata.
        const credAplic = Math.min(credRestante, c.importeAplicado);
        credRestante = Math.round((credRestante - credAplic) * 100) / 100;
        const cashPortion = Math.round((c.importeAplicado - credAplic) * 100) / 100;
        // Marcar como pagado si se cancela todo el saldo del comprobante (plata + NC).
        if (Math.abs(c.importeAplicado - saldoPendiente) < 0.01) {
          await tx.ctaCte.update({ where: { id: cc.id }, data: { pagado: true } });
        }
        // Contra-asiento del PAGO (parte en plata). Fila aparte y SALDADA (pagado:true)
        // para que no reaparezca como pendiente ni como saldo a favor. El comprobante
        // original conserva su importe total. Si las NC cubren todo, no hay fila de pago.
        if (cashPortion > 0.01) {
          await tx.ctaCte.create({ data: {
            companyId: req.companyId,
            contactoTipo: 'proveedor', contactoId: d.proveedorId,
            fecha: d.fecha,
            detalle: 'Pago de ' + (cc.detalle || 'comprobante ' + cc.id.slice(-6)),
            moneda: cc.moneda || 'ARS', cotizacion: cc.cotizacion ?? null,
            haber: cashPortion,
            referencia: cc.referencia, pagado: true,
            observaciones: 'Pago via ' + d.metodo + (d.observaciones ? ' · ' + d.observaciones : ''),
          }});
        }
      }
      // Aplicar NOTAS DE CRÉDITO / créditos a cuenta tildados. NO se toca su importe:
      // el haber original queda visible en la cuenta. Se marca SALDADA (pagado) cuando
      // se consume del todo; si es parcial, se reduce el haber para dejar el remanente.
      for (const cr of d.creditos) {
        const cc = await tx.ctaCte.findFirst({ where: { id: cr.ctaCteId, companyId: req.companyId, contactoTipo: 'proveedor', contactoId: d.proveedorId } });
        if (!cc) throw new Error('Nota de crédito no encontrada: ' + cr.ctaCteId);
        const disponible = Number(cc.haber || 0) - Number(cc.debe || 0); // haber puro
        if (disponible <= 0.01) throw new Error('El comprobante tildado como crédito no tiene saldo a favor');
        if (cr.importeAplicado > disponible + 0.01) throw new Error('Importe de la nota de crédito (' + cr.importeAplicado + ') excede su saldo (' + disponible.toFixed(2) + ')');
        const restante = Math.round((disponible - cr.importeAplicado) * 100) / 100;
        if (restante <= 0.01) {
          // Consumo total: dejamos el importe original y la marcamos saldada.
          await tx.ctaCte.update({ where: { id: cc.id }, data: {
            pagado: true,
            observaciones: (cc.observaciones ? cc.observaciones + ' · ' : '') + 'Aplicada a comprobantes el ' + new Date(d.fecha).toISOString().slice(0,10),
          }});
        } else {
          // Consumo parcial: reducimos el haber para que el remanente siga disponible.
          await tx.ctaCte.update({ where: { id: cc.id }, data: {
            haber: Math.round((Number(cc.haber || 0) - cr.importeAplicado) * 100) / 100,
            observaciones: (cc.observaciones ? cc.observaciones + ' · ' : '') + 'Aplicada parcialmente el ' + new Date(d.fecha).toISOString().slice(0,10),
          }});
        }
      }
      // Pago "a cuenta" (sin comprobantes): haber suelto en la cta cte del proveedor.
      // Reduce el saldo y, si excede la deuda, deja saldo a favor.
      if (d.comprobantes.length === 0 && d.monto > 0.01) {
        await tx.ctaCte.create({ data: {
          companyId: req.companyId,
          contactoTipo: 'proveedor', contactoId: d.proveedorId,
          fecha: d.fecha,
          detalle: 'Pago a cuenta',
          moneda: d.monedaPago || 'ARS', cotizacion: d.cotizacionPago ?? null,
          haber: d.monto,
          observaciones: 'Pago a cuenta via ' + d.metodo + (d.observaciones ? ' · ' + d.observaciones : ''),
        }});
      }
      // Diferencia de cambio (ARS): si la deuda estaba en otra moneda y se pagó con
      // una cotización distinta a la del comprobante, la contabilidad en pesos no cierra.
      if (d.monedaPago && monedaDeuda && monedaDeuda !== 'ARS' && deudaArsConocida) {
        const cotPago = d.monedaPago === 'ARS' ? 1 : (d.cotizacionPago || await getCotizacionARS(d.monedaPago, d.fecha, req.companyId));
        if (cotPago) {
          const pagoArs = d.monto * cotPago;
          const difPnL = deudaArs - pagoArs; // pagamos menos pesos que el valor de la deuda => ganancia
          if (Math.abs(difPnL) > 0.5) {
            await tx.ctaCte.create({ data: {
              companyId: req.companyId, contactoTipo: 'libre',
              nombreLibre: 'Diferencia de cambio — ' + prov.razonSocial,
              fecha: d.fecha, categoria: 'Diferencia de cambio', moneda: 'ARS', cotizacion: 1,
              detalle: `Dif. de cambio por pago de deuda en ${monedaDeuda} (${difPnL >= 0 ? 'ganancia' : 'pérdida'})`,
              debe: difPnL >= 0 ? difPnL : 0,
              haber: difPnL < 0 ? -difPnL : 0,
              pagado: true,
              observaciones: `Deuda ${Math.round(deudaArs)} ARS · pagado ${Math.round(pagoArs)} ARS`,
            }});
          }
        }
      }

      // 2. Registrar el movimiento del recurso usado — SOLO si sale plata. Si el
      // neto es 0 (las notas de crédito cubren todo) es una simple vinculación.
      if (d.monto > 0.01) {
      if (d.metodo === 'cheque') {
        if (!d.chequeId && !d.nuevoCheque) throw new Error('Falta el cheque para pago con cheque');
        if (d.nuevoCheque) {
          // Cheque PROPIO nuevo: se crea y se entrega al proveedor en un solo paso.
          const nc = d.nuevoCheque;
          await tx.cheque.create({ data: {
            companyId: req.companyId,
            tipo: 'propio', formato: nc.formato || 'fisico',
            banco: nc.banco || null, cuenta: nc.cuenta || null,
            nroCheque: nc.nroCheque,
            fechaEmision: nc.fechaEmision || d.fecha,
            fechaPago: nc.fechaPago,
            monto: (nc.monto != null ? nc.monto : d.monto),
            beneficiario: prov.razonSocial,
            librador: nc.librador || null,
            fechaEndoso: d.fecha,
            enPoderDe: prov.razonSocial,
            estado: 'entregado',
            observaciones: d.observaciones || ('Cheque propio entregado a ' + prov.razonSocial),
          }});
        } else {
          const ch = await tx.cheque.findFirst({ where: { id: d.chequeId, companyId: req.companyId } });
          if (!ch) throw new Error('Cheque no encontrado');
          // Propio: se ENTREGA al proveedor. Tercero: se ENDOSA. En ambos casos sale de cartera
          // y se registran beneficiario, fecha de salida y en poder de quién queda (el proveedor).
          await tx.cheque.update({ where: { id: ch.id }, data: {
            estado: ch.tipo === 'propio' ? 'entregado' : 'endosado',
            beneficiario: prov.razonSocial || ch.beneficiario,
            fechaEndoso: d.fecha,
            enPoderDe: prov.razonSocial || ch.enPoderDe,
            observaciones: d.observaciones || ch.observaciones,
          }});
        }
      } else if (d.metodo === 'transferencia') {
        if (!d.bancoCuentaId) throw new Error('Falta bancoCuentaId para transferencia');
        await tx.bancoMovimiento.create({ data: {
          companyId: req.companyId, cuentaId: d.bancoCuentaId,
          fecha: d.fecha, tipo: 'transferencia_out',
          concepto: 'Pago a ' + prov.razonSocial,
          monto: d.monto, contraparte: prov.razonSocial,
          observaciones: d.observaciones || null,
          userId: req.user?.id || null,
        }});
      } else if (d.metodo === 'efectivo') {
        await tx.efectivo.create({ data: {
          companyId: req.companyId,
          fecha: d.fecha, tipo: 'egreso',
          concepto: 'Pago a ' + prov.razonSocial,
          monto: d.monto,
          caja: d.cajaOrigen || null,
          clasificacion: 'empresa',
          observaciones: d.observaciones || null,
        }});
      } else if (d.metodo === 'externo' || d.metodo === 'tarjeta') {
        // Billetera / medio externo (Mercado Pago, etc.) o Tarjeta de crédito (solo
        // etiqueta): no impacta banco, se registra como una "caja" en Control de
        // Efectivo con el nombre del medio/tarjeta.
        const esTarjeta = d.metodo === 'tarjeta';
        await tx.efectivo.create({ data: {
          companyId: req.companyId,
          fecha: d.fecha, tipo: 'egreso',
          concepto: 'Pago a ' + prov.razonSocial,
          monto: d.monto,
          caja: d.cajaOrigen || (esTarjeta ? 'Tarjeta de crédito' : 'Medio externo'),
          clasificacion: 'empresa',
          observaciones: [(d.cajaOrigen ? (esTarjeta ? 'Tarjeta: ' : 'Medio: ') + d.cajaOrigen : null), d.observaciones].filter(Boolean).join(' · ') || null,
        }});
      } else if (d.metodo === 'cereal') {
        // Canje: entregamos grano para cancelar una deuda en toneladas.
        // d.monto = toneladas entregadas (en la moneda/grano de la deuda).
        if (!d.cerealProductoId) throw new Error('Elegí el cereal que se entrega');
        const prod = await tx.producto.findFirst({ where: { id: d.cerealProductoId, companyId: req.companyId } });
        if (!prod) throw new Error('Cereal no encontrado en el stock');
        const pizarra = Number(d.precioPizarra || 0);
        await tx.movimiento.create({ data: {
          companyId: req.companyId, productoId: prod.id,
          fecha: d.fecha, tipo: 'egreso', motivo: 'entrega_canje',
          cantidad: d.monto, // toneladas
          precio: pizarra || null,
          total: pizarra ? d.monto * pizarra : null,
          contraparteId: d.proveedorId, contraparteTipo: 'proveedor',
          referencia: 'CANJE',
          depositoId: d.depositoId || null,
          observaciones: `Entrega de cereal a ${prov.razonSocial} por canje${d.observaciones ? ' · ' + d.observaciones : ''}`,
          userId: req.user?.id || null,
        }});
      } else if (d.metodo === 'intercompany') {
        // Crear los dos asientos espejo + IntercompanyMovimiento
        const interRef = `ic_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
        // En la empresa activa (DESTINO): haber = monto (le debemos a la otra firma)
        await tx.ctaCte.create({ data: {
          companyId: req.companyId,
          contactoTipo: 'intercompany',
          empresaContraparteId: d.empresaOrigenId,
          intercompanyRef: interRef,
          fecha: d.fecha,
          detalle: 'Pago a ' + prov.razonSocial + ' cubierto por otra firma del grupo',
          haber: d.monto,
          observaciones: d.observaciones || null,
        }});
        // En la empresa origen (ORIGEN): debe = monto (saldo a favor)
        await tx.ctaCte.create({ data: {
          companyId: d.empresaOrigenId,
          contactoTipo: 'intercompany',
          empresaContraparteId: req.companyId,
          intercompanyRef: interRef,
          fecha: d.fecha,
          detalle: 'Pago realizado para otra firma del grupo (proveedor: ' + prov.razonSocial + ')',
          debe: d.monto,
          observaciones: d.observaciones || null,
        }});
        // Header de auditoria
        await tx.intercompanyMovimiento.create({ data: {
          fecha: d.fecha,
          empresaOrigenId: d.empresaOrigenId,
          empresaDestinoId: req.companyId,
          monto: d.monto,
          motivo: 'Pago a ' + prov.razonSocial,
          proveedorId: d.proveedorId,
          intercompanyRef: interRef,
          observaciones: d.observaciones || null,
          userId: req.user?.id || null,
        }});
        // Mover el recurso REAL de la firma origen (su caja / cheque / banco).
        await _intercompanyMoverRecurso(tx, {
          empresaOrigenId: d.empresaOrigenId, recurso: d.recursoIntercompany || 'deuda',
          monto: d.monto, fecha: d.fecha, concepto: 'Pago a ' + prov.razonSocial,
          observaciones: d.observaciones || null, userId: req.user?.id || null,
          cajaOrigen: d.cajaInterco, chequeIdOrigen: d.chequeIdInterco, bancoCuentaIdOrigen: d.bancoCuentaIdInterco,
        });
      }
      } // fin "if (d.monto > 0.01)"

      return { ok: true, comprobantesAplicados: d.comprobantes.length, creditosAplicados: d.creditos.length };
    });

    res.json({ ok: true, ...result });
  } catch (e) { next(e); }
});

// === POST registrar cobro de cliente (multi-comprobante + multi-metodo) ===
// Mismo esquema que pago a proveedor pero inverso.
app.post('/api/cobros-clientes', requireCompany, requirePermission('finanzas:create'), async (req, res, next) => {
  try {
    const schema = z.object({
      clienteId: z.string().min(1),
      comprobantes: z.array(z.object({
        ctaCteId: z.string().min(1),
        importeAplicado: z.number().positive(),
      })).min(0),  // 0 = cobro "a cuenta" (sin comprobante puntual)
      // Notas de crédito de venta / créditos a cuenta que reducen lo que se cobra.
      creditos: z.array(z.object({
        ctaCteId: z.string().min(1),
        importeAplicado: z.number().positive(),
      })).optional().default([]),
      metodo: z.enum(['efectivo', 'cheque', 'transferencia', 'externo', 'tarjeta', 'intercompany']),
      monto: z.number().nonnegative(),   // 0 = solo vinculación (NC cubre todo)
      fecha: z.coerce.date(),
      cajaDestino: z.string().nullable().optional(),
      chequeId: z.string().nullable().optional(),  // si recibimos un cheque NUEVO de terceros
      bancoCuentaId: z.string().nullable().optional(),
      empresaDestinoId: z.string().nullable().optional(),  // si el cliente paga a otra firma del grupo
      monedaPago: z.string().nullable().optional(),
      cotizacionPago: z.number().positive().nullable().optional(),
      observaciones: z.string().nullable().optional(),
    });
    const d = schema.parse(req.body);
    const sumaAplicada = d.comprobantes.reduce((a, c) => a + c.importeAplicado, 0);
    const sumaCreditos = d.creditos.reduce((a, c) => a + c.importeAplicado, 0);
    if (d.comprobantes.length && !d.monedaPago && Math.abs((sumaAplicada - sumaCreditos) - d.monto) > 0.01) {
      return res.status(400).json({ ok: false, error: 'El neto (comprobantes ' + sumaAplicada.toFixed(2) + ' − notas de crédito ' + sumaCreditos.toFixed(2) + ') no coincide con el monto cobrado (' + d.monto + ')' });
    }
    if (sumaCreditos > sumaAplicada + 0.01) {
      return res.status(400).json({ ok: false, error: 'Las notas de crédito aplicadas superan el total de comprobantes tildados' });
    }
    if (d.metodo === 'intercompany') {
      if (!d.empresaDestinoId) return res.status(400).json({ ok: false, error: 'Falta empresaDestinoId para Intercompany' });
      if (d.empresaDestinoId === req.companyId) return res.status(400).json({ ok: false, error: 'La empresa destino no puede ser la misma' });
      if (!_userTieneAcceso(req, d.empresaDestinoId)) return res.status(403).json({ ok: false, error: 'No tenés acceso a la empresa destino' });
      const tienePerm = req.user.superAdmin || (req.user.userCompanies || []).some(uc =>
        uc.companyId === req.companyId &&
        ((uc.role?.permissions || []).includes('finanzas:intercompany') ||
         (uc.role?.permissions || []).includes('finanzas:*') ||
         (uc.role?.permissions || []).includes('*:*'))
      );
      if (!tienePerm) return res.status(403).json({ ok: false, error: 'No tenés permiso finanzas:intercompany' });
    }
    const cli = await prisma.cliente.findFirst({ where: { id: d.clienteId, companyId: req.companyId } });
    if (!cli) return res.status(404).json({ ok: false, error: 'Cliente no encontrado' });

    const result = await prisma.$transaction(async (tx) => {
      let deudaArs = 0, deudaArsConocida = true, monedaDeuda = null;
      let credRestante = sumaCreditos;   // notas de crédito a repartir entre las facturas (FIFO)
      for (const c of d.comprobantes) {
        const cc = await tx.ctaCte.findFirst({ where: { id: c.ctaCteId, companyId: req.companyId, contactoTipo: 'cliente', contactoId: d.clienteId } });
        if (!cc) throw new Error('Comprobante no encontrado');
        const saldoPendiente = Number(cc.debe || 0) - Number(cc.haber || 0);
        if (c.importeAplicado > saldoPendiente + 0.01) throw new Error('Importe excede saldo pendiente');
        monedaDeuda = cc.moneda || 'ARS';
        const cotDeuda = (cc.moneda && cc.moneda !== 'ARS') ? (cc.cotizacion ?? null) : 1;
        if (cotDeuda == null) deudaArsConocida = false; else deudaArs += c.importeAplicado * cotDeuda;
        const credAplic = Math.min(credRestante, c.importeAplicado);
        credRestante = Math.round((credRestante - credAplic) * 100) / 100;
        const cashPortion = Math.round((c.importeAplicado - credAplic) * 100) / 100;
        if (Math.abs(c.importeAplicado - saldoPendiente) < 0.01) {
          await tx.ctaCte.update({ where: { id: cc.id }, data: { pagado: true } });
        }
        // Contra-asiento del cobro (parte en plata). Fila aparte y SALDADA; el
        // comprobante original conserva su importe total. Si las NC cubren todo, no hay fila.
        if (cashPortion > 0.01) {
          await tx.ctaCte.create({ data: {
            companyId: req.companyId,
            contactoTipo: 'cliente', contactoId: d.clienteId,
            fecha: d.fecha,
            detalle: 'Cobro de ' + (cc.detalle || 'comprobante ' + cc.id.slice(-6)),
            moneda: cc.moneda || 'ARS', cotizacion: cc.cotizacion ?? null,
            haber: cashPortion,
            referencia: cc.referencia, pagado: true,
            observaciones: 'Cobro via ' + d.metodo + (d.observaciones ? ' · ' + d.observaciones : ''),
          }});
        }
      }
      // Aplicar NOTAS DE CRÉDITO / créditos a cuenta tildados (no se toca su importe).
      for (const cr of d.creditos) {
        const cc = await tx.ctaCte.findFirst({ where: { id: cr.ctaCteId, companyId: req.companyId, contactoTipo: 'cliente', contactoId: d.clienteId } });
        if (!cc) throw new Error('Nota de crédito no encontrada: ' + cr.ctaCteId);
        const disponible = Number(cc.haber || 0) - Number(cc.debe || 0);
        if (disponible <= 0.01) throw new Error('El comprobante tildado como crédito no tiene saldo a favor');
        if (cr.importeAplicado > disponible + 0.01) throw new Error('Importe de la nota de crédito excede su saldo');
        const restante = Math.round((disponible - cr.importeAplicado) * 100) / 100;
        if (restante <= 0.01) {
          await tx.ctaCte.update({ where: { id: cc.id }, data: {
            pagado: true,
            observaciones: (cc.observaciones ? cc.observaciones + ' · ' : '') + 'Aplicada a comprobantes el ' + new Date(d.fecha).toISOString().slice(0,10),
          }});
        } else {
          await tx.ctaCte.update({ where: { id: cc.id }, data: {
            haber: Math.round((Number(cc.haber || 0) - cr.importeAplicado) * 100) / 100,
            observaciones: (cc.observaciones ? cc.observaciones + ' · ' : '') + 'Aplicada parcialmente el ' + new Date(d.fecha).toISOString().slice(0,10),
          }});
        }
      }
      // Cobro "a cuenta" (sin comprobantes): haber suelto en la cta cte del cliente.
      if (d.comprobantes.length === 0 && d.monto > 0.01) {
        await tx.ctaCte.create({ data: {
          companyId: req.companyId,
          contactoTipo: 'cliente', contactoId: d.clienteId,
          fecha: d.fecha,
          detalle: 'Cobro a cuenta',
          moneda: d.monedaPago || 'ARS', cotizacion: d.cotizacionPago ?? null,
          haber: d.monto,
          observaciones: 'Cobro a cuenta via ' + d.metodo + (d.observaciones ? ' · ' + d.observaciones : ''),
        }});
      }
      // Diferencia de cambio (ARS) al cobrar una deuda en otra moneda.
      if (d.monedaPago && monedaDeuda && monedaDeuda !== 'ARS' && deudaArsConocida) {
        const cotPago = d.monedaPago === 'ARS' ? 1 : (d.cotizacionPago || await getCotizacionARS(d.monedaPago, d.fecha, req.companyId));
        if (cotPago) {
          const cobroArs = d.monto * cotPago;
          const difPnL = cobroArs - deudaArs; // cobramos más pesos que el valor de la deuda => ganancia
          if (Math.abs(difPnL) > 0.5) {
            await tx.ctaCte.create({ data: {
              companyId: req.companyId, contactoTipo: 'libre',
              nombreLibre: 'Diferencia de cambio — ' + cli.razonSocial,
              fecha: d.fecha, categoria: 'Diferencia de cambio', moneda: 'ARS', cotizacion: 1,
              detalle: `Dif. de cambio por cobro de deuda en ${monedaDeuda} (${difPnL >= 0 ? 'ganancia' : 'pérdida'})`,
              debe: difPnL >= 0 ? difPnL : 0,
              haber: difPnL < 0 ? -difPnL : 0,
              pagado: true,
              observaciones: `Deuda ${Math.round(deudaArs)} ARS · cobrado ${Math.round(cobroArs)} ARS`,
            }});
          }
        }
      }
      // Registrar el recurso recibido — SOLO si entra plata. Neto 0 = vinculación.
      if (d.monto > 0.01) {
      if (d.metodo === 'cheque') {
        // El cliente nos da un cheque de terceros → ya viene creado con chequeId
        if (!d.chequeId) throw new Error('Falta chequeId del cheque recibido');
      } else if (d.metodo === 'transferencia') {
        if (!d.bancoCuentaId) throw new Error('Falta bancoCuentaId');
        await tx.bancoMovimiento.create({ data: {
          companyId: req.companyId, cuentaId: d.bancoCuentaId,
          fecha: d.fecha, tipo: 'transferencia_in',
          concepto: 'Cobro de ' + cli.razonSocial,
          monto: d.monto, contraparte: cli.razonSocial,
          observaciones: d.observaciones || null,
          userId: req.user?.id || null,
        }});
      } else if (d.metodo === 'efectivo') {
        await tx.efectivo.create({ data: {
          companyId: req.companyId,
          fecha: d.fecha, tipo: 'ingreso',
          concepto: 'Cobro de ' + cli.razonSocial,
          monto: d.monto,
          caja: d.cajaDestino || null,
          clasificacion: 'empresa',
          observaciones: d.observaciones || null,
        }});
      } else if (d.metodo === 'externo' || d.metodo === 'tarjeta') {
        // Billetera / medio externo o Tarjeta de crédito (solo etiqueta): no impacta
        // banco, se registra como una "caja" en Control de Efectivo con su nombre.
        const esTarjeta = d.metodo === 'tarjeta';
        await tx.efectivo.create({ data: {
          companyId: req.companyId,
          fecha: d.fecha, tipo: 'ingreso',
          concepto: 'Cobro de ' + cli.razonSocial,
          monto: d.monto,
          caja: d.cajaDestino || (esTarjeta ? 'Tarjeta de crédito' : 'Medio externo'),
          clasificacion: 'empresa',
          observaciones: [(d.cajaDestino ? (esTarjeta ? 'Tarjeta: ' : 'Medio: ') + d.cajaDestino : null), d.observaciones].filter(Boolean).join(' · ') || null,
        }});
      } else if (d.metodo === 'intercompany') {
        // El cliente le paga a otra firma del grupo (firma destino). El cobro
        // queda pero los fondos entran a empresaDestinoId.
        const interRef = `ic_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
        // En la empresa activa (la del cliente): debe = monto a favor de la otra
        await tx.ctaCte.create({ data: {
          companyId: req.companyId,
          contactoTipo: 'intercompany',
          empresaContraparteId: d.empresaDestinoId,
          intercompanyRef: interRef,
          fecha: d.fecha,
          detalle: 'Cobro de ' + cli.razonSocial + ' recibido por otra firma del grupo',
          debe: d.monto,
          observaciones: d.observaciones || null,
        }});
        // En la empresa destino: haber (le debe a nosotros)
        await tx.ctaCte.create({ data: {
          companyId: d.empresaDestinoId,
          contactoTipo: 'intercompany',
          empresaContraparteId: req.companyId,
          intercompanyRef: interRef,
          fecha: d.fecha,
          detalle: 'Recibió cobro por cuenta de otra firma del grupo (cliente: ' + cli.razonSocial + ')',
          haber: d.monto,
          observaciones: d.observaciones || null,
        }});
        await tx.intercompanyMovimiento.create({ data: {
          fecha: d.fecha,
          empresaOrigenId: req.companyId,   // la que tenia el cliente (acreedora)
          empresaDestinoId: d.empresaDestinoId,
          monto: d.monto,
          motivo: 'Cobro de ' + cli.razonSocial,
          clienteId: d.clienteId,
          intercompanyRef: interRef,
          observaciones: d.observaciones || null,
          userId: req.user?.id || null,
        }});
      }
      } // fin "if (d.monto > 0.01)"
      return { ok: true, comprobantesAplicados: d.comprobantes.length, creditosAplicados: d.creditos.length };
    });
    res.json({ ok: true, ...result });
  } catch (e) { next(e); }
});

// === GET saldos Intercompany (matriz de saldos entre todas las firmas accesibles) ===
app.get('/api/intercompany/saldos', authMiddleware, async (req, res, next) => {
  try {
    // Empresas a las que el usuario tiene acceso
    const empresasAcceso = req.user.superAdmin
      ? (await prisma.company.findMany({ where: { activo: true }, select: { id: true, name: true } }))
      : (req.user.userCompanies || []).map(uc => ({ id: uc.companyId, name: uc.company?.name || uc.companyId }));
    if (empresasAcceso.length < 2) {
      return res.json({ ok: true, empresas: empresasAcceso, matriz: [], totalRegistros: 0 });
    }
    // Sumar saldos por empresa origen + empresa destino
    const ctas = await prisma.ctaCte.findMany({
      where: {
        companyId: { in: empresasAcceso.map(e => e.id) },
        contactoTipo: 'intercompany',
      },
      select: { companyId: true, empresaContraparteId: true, debe: true, haber: true },
    });
    // matriz[firmaA][firmaB] = saldo neto de A vs B (positivo: B le debe a A)
    const matriz = {};
    for (const e of empresasAcceso) matriz[e.id] = {};
    for (const c of ctas) {
      const a = c.companyId, b = c.empresaContraparteId;
      if (!b) continue;
      if (!matriz[a]) matriz[a] = {};
      matriz[a][b] = (matriz[a][b] || 0) + Number(c.debe || 0) - Number(c.haber || 0);
    }
    res.json({ ok: true, empresas: empresasAcceso, matriz, totalRegistros: ctas.length });
  } catch (e) { next(e); }
});

// === GET movimientos Intercompany detallados entre dos empresas ===
app.get('/api/intercompany/movimientos', authMiddleware, async (req, res, next) => {
  try {
    const a = String(req.query.empresaA || '');
    const b = String(req.query.empresaB || '');
    if (!a || !b) return res.status(400).json({ ok: false, error: 'Faltan empresaA / empresaB' });
    if (!_userTieneAcceso(req, a) || !_userTieneAcceso(req, b)) return res.status(403).json({ ok: false, error: 'Sin acceso a una de las empresas' });
    const movs = await prisma.intercompanyMovimiento.findMany({
      where: {
        OR: [
          { empresaOrigenId: a, empresaDestinoId: b },
          { empresaOrigenId: b, empresaDestinoId: a },
        ],
      },
      orderBy: { fecha: 'desc' },
      include: { empresaOrigen: { select: { name: true } }, empresaDestino: { select: { name: true } } },
    });
    res.json({ ok: true, data: movs });
  } catch (e) { next(e); }
});

app.get('/api/system/check-update', authMiddleware, async (_req, res, next) => {
  try {
    // Si no está configurado AGROCORE_REPO en el .env, no hay forma de chequear.
    // Devolvemos un mensaje claro para que el frontend lo muestre como info,
    // no como error. Esto pasa típicamente cuando todavía no se publicó la
    // primera release del repo.
    const repo = process.env.AGROCORE_REPO;
    if (!repo) {
      return res.json({
        ok: true, version: AGROCORE_VERSION, latest: null, updated: true,
        noRepo: true,
        info: 'El chequeo remoto de versiones no está configurado. Para activarlo, agregá AGROCORE_REPO="usuario/repositorio" al .env del backend.',
      });
    }
    const url = `https://api.github.com/repos/${repo}/releases/latest`;
    let latest = null;
    try {
      const r = await fetch(url, { headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'AgroCore' }, signal: AbortSignal.timeout(5000) });
      if (r.status === 404) {
        return res.json({ ok: true, version: AGROCORE_VERSION, latest: null, updated: true,
          info: `El repositorio ${repo} no tiene releases publicadas todavía.` });
      }
      if (r.ok) {
        const data = await r.json();
        latest = String(data.tag_name || '').replace(/^v/, '');
      }
    } catch (e) {
      return res.json({ ok: true, version: AGROCORE_VERSION, latest: null, updated: true,
        warning: 'No se pudo consultar GitHub: ' + e.message });
    }
    if (!latest) return res.json({ ok: true, version: AGROCORE_VERSION, latest: null, updated: true });
    const cmp = (a, b) => {
      const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
      for (let i = 0; i < 3; i++) { const x = pa[i] || 0, y = pb[i] || 0; if (x !== y) return x - y; }
      return 0;
    };
    const updated = cmp(AGROCORE_VERSION, latest) >= 0;
    res.json({ ok: true, version: AGROCORE_VERSION, latest, updated });
  } catch (e) { next(e); }
});

// ============================================================
// ADMIN: backup PostgreSQL completo + limpiar movimientos de empresa.
// Endpoints sensibles — solo super admin.
// ============================================================
const requireSuperAdmin = (req, res, next) => {
  if (!req.user?.superAdmin) return res.status(403).json({ ok: false, error: 'Solo Super Admin' });
  next();
};

// (multer 'upload' ya está definido cerca del tope del archivo — usado por endpoints
// de importación, parser PDF, etc. Mantenemos esta línea como referencia histórica.)

// Multer aparte para restores: backup completo .sql puede ser de varios MB y
// crecer con el uso del sistema. Usamos disco para no comer RAM.
const uploadRestore = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_req, file, cb) => cb(null, `agrocore-restore-${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g,'_')}`),
  }),
  limits: { fileSize: 500 * 1024 * 1024 },        // hasta 500 MB
});

// === BACKUP COMPLETO ===
// Lanza pg_dump como subprocess y devuelve el .sql como descarga.
// El archivo se buffereia en memoria (un dump de AgroCore es chico),
// validamos el exit code ANTES de mandar headers, y si falla devolvemos
// JSON con el error real — no un archivo vacío.

// Busca pg_dump en PATH primero, después en los install paths típicos de
// PostgreSQL en Windows. Devuelve la ruta completa o null si no se encuentra.
function _findPgDump() {
  const tried = [];
  const candidatos = ['pg_dump'];                  // 1) PATH primero
  if (process.env.PGBIN) candidatos.push(path.join(process.env.PGBIN, os.platform()==='win32'?'pg_dump.exe':'pg_dump'));
  if (os.platform() === 'win32') {
    // En Windows en español Explorer muestra "Archivos de programa", pero el path
    // real en NTFS sigue siendo "Program Files" (sin traducción) — no hay que
    // traducirlo. Cubrimos todas las versiones razonables + arquitecturas.
    for (const v of ['18','17','16','15','14','13','12','11','10']) {
      candidatos.push(`C:\\Program Files\\PostgreSQL\\${v}\\bin\\pg_dump.exe`);
      candidatos.push(`C:\\Program Files (x86)\\PostgreSQL\\${v}\\bin\\pg_dump.exe`);
    }
  } else {
    candidatos.push('/usr/bin/pg_dump', '/usr/local/bin/pg_dump', '/opt/homebrew/bin/pg_dump');
  }
  for (const c of candidatos) {
    try {
      // Si el candidato es un path absoluto, chequeamos existencia primero
      const esRuta = c.includes('/') || c.includes('\\');
      if (esRuta && !fs.existsSync(c)) { tried.push(`${c} → no existe`); continue; }
      const out = execFileSync(c, ['--version'], { stdio: ['ignore','pipe','pipe'], timeout: 3000 }).toString().trim();
      console.log('[BACKUP] pg_dump encontrado en:', c, '·', out);
      return { path: c, version: out, tried };
    } catch (e) {
      tried.push(`${c} → ${e.code || e.message}`);
    }
  }
  console.warn('[BACKUP] pg_dump no encontrado. Intentos:\n  ' + tried.join('\n  '));
  return { path: null, tried };
}

app.get('/api/admin/backup', authMiddleware, requireSuperAdmin, async (req, res, next) => {
  try {
    let dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) return res.status(500).json({ ok: false, error: 'DATABASE_URL no configurada en el server' });
    // Prisma agrega "?schema=public" al final del URL — pg_dump no acepta ese
    // parámetro y aborta con "parámetro de URI no válido: schema". Lo sacamos.
    // Mismo con cualquier otro query param de Prisma (connection_limit, etc.).
    dbUrl = dbUrl.split('?')[0];

    const found = _findPgDump();
    if (!found.path) {
      return res.status(500).json({
        ok: false,
        error: 'pg_dump no se encuentra en el server. Instalá PostgreSQL o agregá su carpeta bin al PATH del sistema y reiniciá AgroCore.',
        intentos: found.tried,
      });
    }
    const pgDumpPath = found.path;

    // pg_dump --no-owner --no-acl da un .sql portable.
    // Buffereamos la salida (un dump de AgroCore son pocos MB), validamos
    // exit code, y recién ahí mandamos headers + body. Sino el cliente
    // descarga "agrocore-backup-...sql" vacío cuando pg_dump falla.
    const proc = spawn(pgDumpPath, ['--no-owner', '--no-acl', '--encoding=UTF8', dbUrl], {
      env: { ...process.env, PGCLIENTENCODING: 'UTF8' },
      windowsHide: true,
    });
    const chunks = [];
    let stderr = '';
    proc.stdout.on('data', (d) => chunks.push(d));
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (e) => {
      console.error('[BACKUP] spawn error:', e);
      if (!res.headersSent) res.status(500).json({ ok: false, error: 'Error al ejecutar pg_dump: ' + e.message });
    });
    proc.on('close', (code) => {
      if (code !== 0 || chunks.length === 0) {
        console.error('[BACKUP] pg_dump fallo. exit=', code, 'stderr=', stderr);
        if (!res.headersSent) {
          return res.status(500).json({
            ok: false,
            error: `pg_dump fallo con código ${code}. ${stderr.split('\n').slice(0, 5).join(' · ')}`.trim(),
          });
        }
        return;
      }
      const buf = Buffer.concat(chunks);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `agrocore-backup-${stamp}.sql`;
      res.setHeader('Content-Type', 'application/sql; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', String(buf.length));
      res.end(buf);
      console.log(`[BACKUP] OK ${filename} (${buf.length} bytes)`);
    });
  } catch (e) { next(e); }
});

// === RESTAURAR BACKUP ===
// Recibe un archivo .sql generado por pg_dump y lo aplica con psql.
// Es una operación que PISA TODA la base — requiere confirmación 'RESTAURAR'
// en el form. Se ejecuta en una transacción para que si algo falla, todo
// queda intacto (ROLLBACK automático). Solo Super Admin.

// Busca psql en PATH + paths típicos de PostgreSQL (mismo enfoque que pg_dump).
function _findPsql() {
  const tried = [];
  const candidatos = ['psql'];
  if (process.env.PGBIN) candidatos.push(path.join(process.env.PGBIN, os.platform()==='win32'?'psql.exe':'psql'));
  if (os.platform() === 'win32') {
    for (const v of ['18','17','16','15','14','13','12','11','10']) {
      candidatos.push(`C:\\Program Files\\PostgreSQL\\${v}\\bin\\psql.exe`);
      candidatos.push(`C:\\Program Files (x86)\\PostgreSQL\\${v}\\bin\\psql.exe`);
    }
  } else {
    candidatos.push('/usr/bin/psql', '/usr/local/bin/psql', '/opt/homebrew/bin/psql');
  }
  for (const c of candidatos) {
    try {
      const esRuta = c.includes('/') || c.includes('\\');
      if (esRuta && !fs.existsSync(c)) { tried.push(`${c} → no existe`); continue; }
      const out = execFileSync(c, ['--version'], { stdio: ['ignore','pipe','pipe'], timeout: 3000 }).toString().trim();
      console.log('[RESTORE] psql encontrado en:', c, '·', out);
      return { path: c, version: out, tried };
    } catch (e) { tried.push(`${c} → ${e.code || e.message}`); }
  }
  console.warn('[RESTORE] psql no encontrado. Intentos:\n  ' + tried.join('\n  '));
  return { path: null, tried };
}

app.post('/api/admin/restore', authMiddleware, requireSuperAdmin, uploadRestore.single('archivo'), async (req, res, next) => {
  let tmpFile = null;
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Falta el archivo .sql' });
    tmpFile = req.file.path;

    // Confirmación dura: en el form viene "confirmacion" que tiene que ser exacto.
    if (req.body?.confirmacion !== 'RESTAURAR') {
      return res.status(400).json({ ok: false, error: 'Falta confirmación. Tipeá RESTAURAR exacto para confirmar.' });
    }

    let dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) return res.status(500).json({ ok: false, error: 'DATABASE_URL no configurada' });
    dbUrl = dbUrl.split('?')[0];     // sacar query params estilo Prisma

    const found = _findPsql();
    if (!found.path) {
      return res.status(500).json({
        ok: false,
        error: 'psql no se encuentra en el server. Es el cliente de PostgreSQL — viene con la instalación de PostgreSQL.',
        intentos: found.tried,
      });
    }

    // Ejecutar psql con el .sql como input. Usamos -1 (single-transaction) para
    // que si algo falla a mitad de camino, se hace ROLLBACK y la base queda
    // como estaba (no a mitad de restaurar). -v ON_ERROR_STOP=1 corta al primer
    // error (sino sigue ejecutando comandos rotos).
    const args = ['-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', tmpFile, dbUrl];
    console.log('[RESTORE] arrancando restore desde', tmpFile, `(${req.file.size} bytes)`);

    const proc = spawn(found.path, args, {
      env: { ...process.env, PGCLIENTENCODING: 'UTF8' },
      windowsHide: true,
    });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', (code) => {
      // Limpiar archivo temporal SIEMPRE
      try { fs.unlinkSync(tmpFile); } catch {}
      if (code !== 0) {
        console.error('[RESTORE] psql falló. exit=', code);
        console.error('[RESTORE] stderr:', stderr.slice(0, 2000));
        return res.status(500).json({
          ok: false,
          error: `psql falló con código ${code}. La base quedó intacta (rollback). Mirá la consola del backend para más detalle.`,
          detalle: stderr.split('\n').slice(-15).join('\n').trim(),
        });
      }
      console.log('[RESTORE] OK', req.file.originalname);
      // Contamos cuántos COMMENT/INSERT/COPY se ejecutaron — solo para feedback
      const lineas = stdout.split('\n').length + stderr.split('\n').filter(l => l.includes('NOTICE')).length;
      res.json({
        ok: true,
        archivo: req.file.originalname,
        tamano: req.file.size,
        notice: stderr.split('\n').filter(l => l.includes('NOTICE')).length,
      });
    });
    proc.on('error', (e) => {
      try { fs.unlinkSync(tmpFile); } catch {}
      if (!res.headersSent) res.status(500).json({ ok: false, error: 'Error al ejecutar psql: ' + e.message });
    });
  } catch (e) {
    if (tmpFile) { try { fs.unlinkSync(tmpFile); } catch {} }
    next(e);
  }
});

// === LIMPIAR EMPRESA ===
// Borra todos los movimientos contables y, según el scope, también stock,
// bancos/cajas, producción y empleados. Catálogos compartidos NUNCA se tocan.
// Operación destructiva — requiere confirmación con texto "BORRAR" en el body.
// ============================================================
// PREPARAR PARA ENTREGA AL CLIENTE
// Diagnóstico + ejecución de la limpieza típica antes de entregar el sistema:
//   - usuarios seed (Admin/admin123, Super/super123)
//   - super admin todavía con password "super123"
//   - roles builtin sin usuarios asignados
//   - empresas que parecen de prueba (nombre con "demo", "prueba", "test")
// Solo Super Admin. El frontend muestra checkboxes para que elija qué ejecutar.
// ============================================================
app.get('/api/admin/preparar-entrega/diagnostico', authMiddleware, requireSuperAdmin, async (req, res, next) => {
  try {
    // Detectar usuarios seed por alias case-insensitive
    const seedUsers = await prisma.user.findMany({
      where: { OR: [
        { alias: { equals: 'Admin', mode: 'insensitive' } },
        { alias: { equals: 'Super', mode: 'insensitive' } },
      ] },
      select: { id: true, alias: true, nombre: true, apellido: true, email: true, superAdmin: true, activo: true },
    });

    // Verificar si el password del usuario actual sigue siendo el default "super123"
    let miPasswordEsDemo = false;
    try {
      const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { passwordHash: true } });
      if (me?.passwordHash) miPasswordEsDemo = await bcrypt.compare('super123', me.passwordHash);
    } catch {}

    // Roles builtin sin usuarios asignados (no incluimos "admin" que es base)
    const rolesBuiltin = await prisma.role.findMany({
      where: { builtin: true, key: { not: 'admin' } },
      select: { id: true, key: true, label: true, _count: { select: { userCompanies: true } } },
    });
    const rolesBuiltinSinUso = rolesBuiltin
      .filter(r => r._count.userCompanies === 0)
      .map(r => ({ id: r.id, key: r.key, label: r.label }));

    // Empresas que parecen de prueba
    const empresasDemo = await prisma.company.findMany({
      where: { OR: [
        { name: { contains: 'demo', mode: 'insensitive' } },
        { name: { contains: 'prueba', mode: 'insensitive' } },
        { name: { contains: 'test', mode: 'insensitive' } },
      ] },
      select: { id: true, name: true, razonSocial: true, cuit: true },
    });

    // Contar super admins activos totales
    const superAdmins = await prisma.user.count({ where: { superAdmin: true, activo: true } });

    res.json({ ok: true,
      seedUsers, miPasswordEsDemo, rolesBuiltinSinUso, empresasDemo,
      superAdminsActivos: superAdmins,
      yo: { id: req.user.id, alias: req.user.alias, nombre: req.user.nombre, email: req.user.email },
    });
  } catch (e) { next(e); }
});

app.post('/api/admin/preparar-entrega/ejecutar', authMiddleware, requireSuperAdmin, async (req, res, next) => {
  try {
    const schema = z.object({
      borrarSeedUsers: z.array(z.string()).optional().default([]),       // IDs de seed users a borrar
      borrarRolesBuiltin: z.array(z.string()).optional().default([]),    // IDs de roles builtin a borrar
      borrarEmpresasDemo: z.array(z.string()).optional().default([]),    // IDs de empresas demo a borrar (force=true por defecto en esta operación)
      confirmacion: z.literal('PREPARAR'),
    });
    const d = schema.parse(req.body);
    const yo = req.user.id;
    const acciones = [];
    const errores = [];

    // 1. Borrar usuarios seed seleccionados
    for (const uid of d.borrarSeedUsers) {
      if (uid === yo) { errores.push({ tipo: 'user', id: uid, error: 'No te podés borrar a vos mismo' }); continue; }
      try {
        // Limpiar memberships y prefs primero
        await prisma.userCompany.deleteMany({ where: { userId: uid } });
        await prisma.userPreference.deleteMany({ where: { userId: uid } }).catch(()=>null);
        await prisma.movimiento.updateMany({ where: { userId: uid }, data: { userId: null } }).catch(()=>null);
        await prisma.user.delete({ where: { id: uid } });
        acciones.push({ tipo: 'user', id: uid, accion: 'borrado' });
      } catch (e) {
        errores.push({ tipo: 'user', id: uid, error: String(e?.message || e) });
      }
    }

    // 2. Borrar roles builtin seleccionados (solo si no tienen usuarios)
    for (const rid of d.borrarRolesBuiltin) {
      try {
        const r = await prisma.role.findUnique({ where: { id: rid } });
        if (!r) { errores.push({ tipo: 'role', id: rid, error: 'No encontrado' }); continue; }
        if (r.key === 'admin') { errores.push({ tipo: 'role', id: rid, error: 'Rol "admin" no se borra' }); continue; }
        const enUso = await prisma.userCompany.count({ where: { roleId: rid } });
        if (enUso > 0) {
          // Reasignar a lectura primero
          const lectura = await prisma.role.findFirst({ where: { key: 'lectura' } });
          if (lectura && lectura.id !== rid) {
            await prisma.userCompany.updateMany({ where: { roleId: rid }, data: { roleId: lectura.id } });
          } else {
            errores.push({ tipo: 'role', id: rid, error: 'Rol en uso y sin rol "Lectura" para reasignar' });
            continue;
          }
        }
        await prisma.role.delete({ where: { id: rid } });
        acciones.push({ tipo: 'role', id: rid, accion: 'borrado' });
      } catch (e) {
        errores.push({ tipo: 'role', id: rid, error: String(e?.message || e) });
      }
    }

    // 3. Borrar empresas demo (cascada completa)
    for (const eid of d.borrarEmpresasDemo) {
      try {
        await prisma.$transaction(async (tx) => {
          const m = (model) => tx[model] ? tx[model].deleteMany({ where: { companyId: eid } }).catch(()=>null) : null;
          await tx.userCompany.deleteMany({ where: { companyId: eid } });
          // Hojas/items
          await m('facturaItem'); await m('facturaCompraItem'); await m('laborInsumo');
          await m('liquidacionCerealConcepto'); await m('cuotaCredito'); await m('insumoAplicado');
          // Cabeceras
          await m('movimientoEmpleado'); await m('liquidacionSueldo'); await m('liquidacionCereal');
          await m('credito'); await m('laborAplicada'); await m('cheque');
          await m('factura'); await m('facturaCompra'); await m('ctaCte');
          await m('efectivo'); await m('flujoCaja'); await m('arrendamiento');
          await m('viaje'); await m('haciendaMovimiento'); await m('haciendaStock');
          await m('bancoMovimiento'); await m('bancoCuenta'); await m('movimiento');
          // Maestros
          await m('lote'); await m('campana'); await m('campo');
          await m('empleado'); await m('cliente'); await m('proveedor'); await m('catalogo');
          if (tx.deposito) await tx.deposito.deleteMany({ where: { companyId: eid } }).catch(()=>null);
          await tx.company.delete({ where: { id: eid } });
        });
        acciones.push({ tipo: 'company', id: eid, accion: 'borrada' });
      } catch (e) {
        errores.push({ tipo: 'company', id: eid, error: String(e?.message || e) });
      }
    }

    res.json({ ok: true, acciones, errores });
  } catch (e) { next(e); }
});

app.post('/api/admin/limpiar-empresa', authMiddleware, requireSuperAdmin, async (req, res, next) => {
  try {
    const schema = z.object({
      companyId: z.string().min(1),
      confirmacion: z.literal('BORRAR'),       // anti-accidente: hay que tipear BORRAR exacto
      scope: z.object({
        stock:        z.boolean().optional(),
        bancosCajas:  z.boolean().optional(),
        produccion:   z.boolean().optional(),
        empleados:    z.boolean().optional(),
      }).default({}),
    });
    const { companyId, scope } = schema.parse(req.body);
    const empresa = await prisma.company.findUnique({ where: { id: companyId } });
    if (!empresa) return res.status(404).json({ ok: false, error: 'Empresa no encontrada' });

    const resumen = await prisma.$transaction(async (tx) => {
      const log = {};
      // --- Movimientos contables (siempre se borran) ---
      log.bancoMovs       = (await tx.bancoMovimiento.deleteMany({ where: { companyId } })).count;
      log.cuotas          = (await tx.cuotaCredito.deleteMany({ where: { credito: { companyId } } })).count;
      log.creditos        = (await tx.credito.deleteMany({ where: { companyId } })).count;
      log.liqConceptos    = (await tx.liquidacionCerealConcepto.deleteMany({ where: { liquidacion: { companyId } } })).count;
      log.liquidaciones   = (await tx.liquidacionCereal.deleteMany({ where: { companyId } })).count;
      log.cheques         = (await tx.cheque.deleteMany({ where: { companyId } })).count;
      log.ctasCtes        = (await tx.ctaCte.deleteMany({ where: { companyId } })).count;
      log.facItems        = (await tx.facturaItem.deleteMany({ where: { factura: { companyId } } })).count;
      log.facturas        = (await tx.factura.deleteMany({ where: { companyId } })).count;
      log.facCompraItems  = (await tx.facturaCompraItem.deleteMany({ where: { facturaCompra: { companyId } } })).count;
      log.facCompras      = (await tx.facturaCompra.deleteMany({ where: { companyId } })).count;
      log.efectivo        = (await tx.efectivo.deleteMany({ where: { companyId } })).count;
      log.flujoCaja       = (await tx.flujoCaja.deleteMany({ where: { companyId } })).count;
      log.arrendamientos  = (await tx.arrendamiento.deleteMany({ where: { companyId } })).count;
      log.viajes          = (await tx.viaje.deleteMany({ where: { companyId } })).count;
      log.haciendaMovs    = (await tx.haciendaMovimiento.deleteMany({ where: { companyId } })).count;
      log.haciendaStock   = (await tx.haciendaStock.deleteMany({ where: { companyId } })).count;

      // --- Stock (opcional) ---
      if (scope.stock) {
        log.movimientos = (await tx.movimiento.deleteMany({ where: { companyId } })).count;
        log.liqCerealDeps = (await tx.liquidacionCereal.deleteMany({ where: { companyId } })).count; // por las dudas
        log.entregas = 0;  // las entregas son solo movimientos
      }

      // --- Bancos y cajas (opcional) ---
      if (scope.bancosCajas) {
        log.bancoCuentas = (await tx.bancoCuenta.deleteMany({ where: { companyId } })).count;
        // Las "cajas" están en Catalogo con tipo "Caja". El usuario las quiere limpiar.
        log.cajas = (await tx.catalogo.deleteMany({ where: { companyId, tipo: 'Caja' } })).count;
      }

      // --- Empleados (opcional) ---
      if (scope.empleados) {
        log.movsEmpleado    = (await tx.movimientoEmpleado.deleteMany({ where: { companyId } })).count;
        log.liquidacionesEmp = (await tx.liquidacionSueldo.deleteMany({ where: { companyId } })).count;
        log.empleados       = (await tx.empleado.deleteMany({ where: { companyId } })).count;
      } else {
        // Aunque no borre empleados, sí limpio sus planillas — sino no tiene sentido
        // (los movs quedan colgados si borraste todo lo demás).
        log.movsEmpleado     = (await tx.movimientoEmpleado.deleteMany({ where: { companyId } })).count;
        log.liquidacionesEmp = (await tx.liquidacionSueldo.deleteMany({ where: { companyId } })).count;
      }

      // --- Producción (opcional) ---
      if (scope.produccion) {
        // borrar en orden: insumos/labores → campañas → lotes → campos
        log.laborInsumos = (await tx.laborInsumo.deleteMany({ where: { labor: { campana: { companyId } } } })).count;
        log.labores      = (await tx.laborAplicada.deleteMany({ where: { campana: { companyId } } })).count;
        log.insumosAplic = (await tx.insumoAplicado.deleteMany({ where: { campana: { companyId } } })).count;
        log.campanas     = (await tx.campana.deleteMany({ where: { companyId } })).count;
        log.lotes        = (await tx.lote.deleteMany({ where: { campo: { companyId } } })).count;
        log.campos       = (await tx.campo.deleteMany({ where: { companyId } })).count;
      }

      // --- Depósitos cerealera (opcional, junto con stock) ---
      if (scope.stock) {
        log.depositos = (await tx.deposito.deleteMany({ where: { companyId } })).count;
      }

      return log;
    });

    res.json({ ok: true, empresa: empresa.name, resumen });
  } catch (e) { next(e); }
});

// === PLANTILLAS EXCEL ===
// Genera un .xlsx con una pestaña por entidad, con encabezado de columnas y
// una fila de ejemplo. El usuario completa, lo sube y se importa.
const PLANTILLAS = {
  clientes: {
    headers: ['razonSocial*', 'cuit', 'condIVA', 'email', 'telefono', 'direccion', 'localidad', 'provincia', 'observaciones'],
    ejemplo: ['Estancia La Cecilia SA', '30-12345678-9', 'Responsable Inscripto', 'admin@laceciliasa.com.ar', '11-4567-8910', 'Ruta 8 km 134', 'Pergamino', 'Buenos Aires', 'Cliente histórico'],
    instrucciones: 'Importa clientes a la empresa actual. razonSocial es obligatorio. condIVA: Responsable Inscripto / Monotributo / Exento / ConsumidorFinal.',
  },
  proveedores: {
    headers: ['razonSocial*', 'cuit', 'condIVA', 'email', 'telefono', 'direccion', 'localidad', 'provincia', 'observaciones'],
    ejemplo: ['Agroquímicos del Sur SRL', '30-99887766-5', 'Responsable Inscripto', 'ventas@agroquimicossur.com.ar', '11-4321-9876', 'Av. Industrial 200', 'Rosario', 'Santa Fe', ''],
    instrucciones: 'Importa proveedores. razonSocial es obligatorio.',
  },
  productos: {
    headers: ['categoria*', 'nombre*', 'unidad*', 'codigo', 'stockMinimo', 'precioReferencia', 'observaciones'],
    ejemplo: ['granos', 'Soja 1ra', 'tn', 'SOJ1', '0', '0', 'Soja primera calidad'],
    instrucciones: 'categoria: granos / insumos / hacienda / repuestos / combustibles / otros. unidad: tn, kg, lt, cabezas, unidad.',
  },
  cheques: {
    headers: ['tipo*', 'formato', 'banco', 'nroCheque*', 'fechaEmision*', 'fechaPago*', 'monto*', 'beneficiario', 'librador', 'estado', 'observaciones'],
    ejemplo: ['terceros', 'fisico', 'Banco Nación', 'A12345678', '2026-01-15', '2026-03-15', '500000', '', 'Juan Pérez', 'en_cartera', ''],
    instrucciones: 'tipo: propio / terceros. formato: fisico / electronico. estado: en cartera / emitido / depositado / cobrado / pagado / rechazado. Fechas en formato YYYY-MM-DD.',
  },
  arrendamientos: {
    headers: ['propietario*', 'hectareas*', 'importeHa', 'tipoPago', 'vencimiento', 'observaciones'],
    ejemplo: ['Juan Pérez', '120', '250000', 'efectivo', '2026-08-01', ''],
    instrucciones: 'tipoPago: efectivo / quintales / %. Fechas en YYYY-MM-DD.',
  },
  empleados: {
    headers: ['nombre*', 'apellido*', 'dni', 'cuil', 'puesto', 'sueldo', 'fechaIngreso', 'telefono', 'email', 'tipo', 'cobraPorcentaje', 'porcentajeDefault'],
    ejemplo: ['Luciano', 'Operaciones', '30123456', '20-30123456-7', 'Maquinista', '500000', '2025-01-01', '11-1234-5678', '', 'propio', 'false', ''],
    instrucciones: 'tipo: propio / externo. cobraPorcentaje: true / false. porcentajeDefault: solo si cobraPorcentaje=true.',
  },
  'cuentas-bancarias': {
    headers: ['banco*', 'tipo', 'moneda', 'numero', 'cbu', 'alias', 'titular', 'saldoInicial', 'fechaInicial', 'observaciones'],
    ejemplo: ['Banco Nación', 'cta_cte', 'ARS', '0123-45678901', '0110123456789012345678', 'AGROCORE.SA.NACION', 'AgroCore SA', '0', '2026-01-01', ''],
    instrucciones: 'tipo: cta_cte / caja_ahorro / usd / otro. moneda: ARS / USD / EUR. Fechas en YYYY-MM-DD.',
  },
  'saldos-clientes': {
    headers: ['cuit_o_razonSocial*', 'detalle', 'importe*', 'vencimiento'],
    ejemplo: ['30-12345678-9', 'Saldo inicial', '850000', '2026-02-01'],
    instrucciones: 'Carga saldos iniciales de clientes (lo que deben). Busca por CUIT primero, después por razón social. importe positivo = el cliente nos debe.',
  },
  'saldos-proveedores': {
    headers: ['cuit_o_razonSocial*', 'detalle', 'importe*', 'vencimiento'],
    ejemplo: ['30-99887766-5', 'Saldo inicial', '320000', '2026-02-15'],
    instrucciones: 'Carga saldos iniciales de proveedores (lo que les debemos). importe positivo = les debemos.',
  },
  'stock-inicial': {
    headers: ['producto*', 'deposito', 'cantidad*', 'precio_unit', 'observaciones'],
    ejemplo: ['Soja 1ra', 'Mi campo', '450', '465000', 'Saldo inicial'],
    instrucciones: 'producto: nombre exacto del producto (como está cargado). deposito: nombre del depósito ("Mi campo" para el implícito) o vacío. Genera un movimiento de ingreso con motivo "saldo_inicial".',
  },
  // === Plantillas de gastos consolidados ===
  // Reemplazan los Excel del cliente con estructura libre por persona.
  // Se consolidan todos los gastos en UNA tabla plana y se importan al
  // Control de Efectivo del sistema con caja = nombre de la persona/oficina.
  'gastos-administrativos': {
    headers: ['fecha*', 'caja*', 'tipo*', 'monto*', 'concepto', 'observaciones'],
    ejemplo: ['2026-07-01', 'Oficina', 'egreso', '3300', 'Yerba', ''],
    instrucciones: 'Consolida los GASTOS ADMINISTRATIVOS por persona/sector en una tabla plana. caja: nombre de la persona o sector (Oficina, Damian, Marcos, Vicki, Denise, etc.) — se carga como caja en Control de Efectivo. tipo: ingreso (era Activo en la planilla original) o egreso (era Pasivo). Las cajas se crean automáticamente si no existen.',
  },
  'gastos-propios': {
    headers: ['fecha*', 'caja*', 'tipo*', 'monto*', 'clasificacion', 'concepto', 'observaciones'],
    ejemplo: ['2026-07-07', 'Luciano', 'egreso', '300000', 'familia', 'GERCHU', ''],
    instrucciones: 'Consolida los GASTOS PROPIOS (chanchito Luciano/Lucas, alquileres, etc.) en una tabla plana. caja: nombre (Luciano, Lucas, Sofi, Damian, Ingrid, Vicki, Denise, etc.). tipo: ingreso o egreso. clasificacion: empresa (gasto del negocio) / propio (gasto personal) / familia (gasto familiar). Se cargan en Control de Efectivo.',
  },
  'gastos-empleados': {
    headers: ['empleado*', 'fecha*', 'tipo*', 'categoria', 'concepto*', 'monto*', 'horas', 'valor_hora', 'observaciones'],
    ejemplo: ['Mariano Salvatierra', '2026-07-01', 'ganancia', 'horas', 'Horas julio', '50000', '8', '6250', ''],
    instrucciones: 'Consolida los GASTOS DE EMPLEADOS (una fila por movimiento de planilla). empleado: nombre completo exacto como está en el sistema. tipo: ganancia (sueldo, horas, premio) o gasto (adelanto, compra personal, descuento). categoria: sueldo / horas / adelanto / compra / premio / descuento / otro. Si tipo=ganancia y categoria=horas, también cargá horas + valor_hora. Se cargan en la planilla del empleado del mes según la fecha.',
  },
};

app.get('/api/admin/plantilla/:tipo', authMiddleware, requireSuperAdmin, async (req, res, next) => {
  try {
    const tipo = req.params.tipo;
    const def = PLANTILLAS[tipo];
    if (!def) return res.status(404).json({ ok: false, error: 'Plantilla no encontrada: ' + tipo });
    // Hoja con encabezado en fila 1, ejemplo en fila 2, instrucciones en una segunda hoja
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([def.headers, def.ejemplo]);
    // Anchura razonable de columnas
    ws['!cols'] = def.headers.map(() => ({ wch: 22 }));
    XLSX.utils.book_append_sheet(wb, ws, 'Datos');
    const wsInfo = XLSX.utils.aoa_to_sheet([
      ['Plantilla: ' + tipo],
      [''],
      ['Instrucciones:'],
      [def.instrucciones],
      [''],
      ['• Las columnas marcadas con * son obligatorias.'],
      ['• La fila 2 es un EJEMPLO — borrala y empezá a cargar tus datos desde la fila 2.'],
      ['• Guardá el archivo como .xlsx y subilo desde Configuración → Importación.'],
    ]);
    wsInfo['!cols'] = [{ wch: 100 }];
    XLSX.utils.book_append_sheet(wb, wsInfo, 'Instrucciones');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="plantilla-${tipo}.xlsx"`);
    res.end(buf);
  } catch (e) { next(e); }
});

// === PLANTILLAS MODELO para las "Planillas Especiales" ===
// Cada tipo de IMPORT_CLIENTE_TIPOS tiene una plantilla con UNA O VARIAS hojas.
// Cada hoja: { nombre, headers, ejemplo (matriz de filas) }
// Plus opcional: una hoja "Instrucciones" generada genéricamente.
const PLANTILLAS_CLIENTE = {
  cheques: {
    descripcion: 'Cheques (propios y de terceros). Una hoja por estado.',
    hojas: [
      { nombre: 'Fisicos a tercero', headers: ['Banco', 'Numero', 'Monto', 'Fecha emision', 'Fecha pago', 'Beneficiario', 'Estado', 'Observaciones'],
        ejemplo: [['Galicia', '00012345', 150000, '01/03/2026', '15/04/2026', 'Proveedor SA', 'emitido', 'pago de factura']] },
      { nombre: 'E-Cheq propios', headers: ['Banco', 'Numero', 'Monto', 'Fecha emision', 'Fecha pago', 'Beneficiario', 'Estado', 'Observaciones'],
        ejemplo: [['Santander', 'EC-00567', 220000, '02/03/2026', '20/05/2026', 'Otro Proveedor SRL', 'emitido', '']] },
      { nombre: 'E-Cheq de terceros', headers: ['Banco', 'Numero', 'Monto', 'Fecha emision', 'Fecha pago', 'Librador', 'Estado', 'Observaciones'],
        ejemplo: [['Macro', 'EC-99001', 300000, '01/02/2026', '10/04/2026', 'Cliente SA', 'en_cartera', '']] },
    ],
  },
  creditos: {
    descripcion: 'Una hoja por banco con su plan de cuotas.',
    hojas: [
      { nombre: 'Galicia (ejemplo)', headers: ['Concepto', 'Capital', 'Tasa', 'Plazo (meses)', 'Fecha inicio', 'Observaciones'],
        ejemplo: [['Credito UVA 2025', 5000000, 95, 36, '01/03/2026', 'garantia hipotecaria']] },
      { nombre: 'Plan de cuotas (ejemplo)', headers: ['Cuota Nro', 'Fecha vencimiento', 'Capital', 'Interes', 'Total cuota', 'Estado (pendiente/abonada)'],
        ejemplo: [[1, '01/04/2026', 138888, 75000, 213888, 'pendiente'], [2, '01/05/2026', 138888, 73000, 211888, 'pendiente']] },
    ],
  },
  'cartas-porte': {
    descripcion: 'Lista de cartas de porte para crear como Viajes.',
    hojas: [
      { nombre: 'Cartas de porte', headers: ['Fecha', 'CTG', 'Carta de Porte', 'Producto', 'Origen', 'Destino', 'Chofer', 'Patente', 'Peso neto (kg)', 'Tarifa $/ton', 'Observaciones'],
        ejemplo: [['10/03/2026', 'CTG12345678', 'CP-001', 'Soja', 'Campo La Esperanza', 'Acopio San Pedro', 'Juan Perez', 'AC123XX', 30000, 4500, '']] },
    ],
  },
  efectivo: {
    descripcion: 'Una hoja por caja (nombre del dueño u oficina). Cada fila = un ingreso o egreso.',
    hojas: [
      { nombre: 'OFICINA', headers: ['Fecha', 'Concepto', 'Ingreso', 'Egreso', 'Observaciones'],
        ejemplo: [['01/03/2026', 'cobro factura X', 250000, '', ''], ['02/03/2026', 'pago combustible', '', 80000, 'YPF Ruta 9']] },
      { nombre: 'LUCAS', headers: ['Fecha', 'Concepto', 'Ingreso', 'Egreso', 'Observaciones'],
        ejemplo: [['03/03/2026', 'retiro caja', '', 100000, 'gastos personales']] },
    ],
  },
  'cerdos-ventas': {
    descripcion: 'Ventas de cerdos. Una hoja por categoria o una sola hoja.',
    hojas: [
      { nombre: 'Ventas Cerdos', headers: ['Fecha', 'Cantidad (cabezas)', 'Categoria', 'Total KG', 'Precio KG', 'Total $', 'Destino', 'Observaciones'],
        ejemplo: [['05/03/2026', 50, 'Capon', 5500, 1800, 9900000, 'Frigorifico Rio IV', '']] },
    ],
  },
  transferencias: {
    descripcion: 'Transferencias bancarias salientes. Una sola hoja con todas.',
    hojas: [
      { nombre: 'Todas', headers: ['Fecha real', 'Banco', 'Empresa', 'Tipo de cuenta', 'Monto', 'Detalle de transferencia', 'Quien la realizo', 'Observaciones'],
        ejemplo: [['07/03/2026', 'Galicia', 'Mi Empresa SA', 'cta cte', 500000, 'Pago Acopio', 'Maria', '']] },
    ],
  },
  'ctacte-saldos': {
    descripcion: 'Saldos pendientes de Cuentas Corrientes (libres, sin factura asociada).',
    hojas: [
      { nombre: 'Resumen', headers: ['Nombre', 'Saldo', 'Prioridad (1-5)', 'Estado (pendiente/pagado)', 'Fecha de pago', 'Observaciones'],
        ejemplo: [['Proveedor X SA', 350000, 1, 'pendiente', '30/04/2026', 'flete pendiente'], ['Cliente Y SRL', 120000, 3, 'pagado', '01/03/2026', '']] },
    ],
  },
  'stock-hacienda': {
    descripcion: 'Stock de animales por campo/Renspa. Una hoja por establecimiento.',
    hojas: [
      { nombre: 'Renspa 12345 (ejemplo)', headers: ['Campo', 'Renspa', 'Especie', 'Categoria', 'Stock real (cabezas)', 'Observaciones'],
        ejemplo: [['La Esperanza', '12.345.6.78901/01', 'Bovino', 'Vaca', 250, ''], ['La Esperanza', '12.345.6.78901/01', 'Bovino', 'Ternero', 120, '']] },
    ],
  },
  'hectareas-sembradas': {
    descripcion: 'Hectareas sembradas por empresa. Una hoja por empresa.',
    hojas: [
      { nombre: 'Mi Empresa (ejemplo)', headers: ['Renspa', 'Campo', 'Cultivo', 'Has sembradas', 'Observaciones'],
        ejemplo: [['12.345.6.78901/01', 'La Esperanza', 'Soja', 250, ''], ['12.345.6.78901/01', 'La Esperanza', 'Maiz', 80, '']] },
    ],
  },
  'pyme-ventas': {
    descripcion: 'Ventas de animales menor. Una hoja por categoria.',
    hojas: [
      { nombre: 'Lechon', headers: ['Fecha', 'Cantidad', 'Cliente', 'Precio unitario', 'Total', 'Pago (pago/no pago)', 'Observaciones'],
        ejemplo: [['01/03/2026', 5, 'Carniceria del Centro', 60000, 300000, 'pago', '']] },
      { nombre: 'Cordero', headers: ['Fecha', 'Cantidad', 'Cliente', 'Precio unitario', 'Total', 'Pago (pago/no pago)', 'Observaciones'],
        ejemplo: [['02/03/2026', 3, 'Restaurant La Estancia', 80000, 240000, 'no pago', 'cobrar fin de mes']] },
    ],
  },
  proveedores: {
    descripcion: 'Catalogo de proveedores.',
    hojas: [
      { nombre: 'Proveedores', headers: ['Razon social', 'Nombre fantasia', 'CUIT', 'Telefono', 'Email', 'Direccion', 'Localidad', 'Provincia', 'Horarios', 'Observaciones'],
        ejemplo: [['Acopio San Pedro SA', 'Acopio SP', '30-12345678-9', '03467-555000', 'ventas@acopiosp.com.ar', 'Ruta 9 km 250', 'San Pedro', 'Buenos Aires', 'L a V 8 a 17', '']] },
    ],
  },
};

// GET /api/admin/importar-cliente/plantilla/:tipo — genera Excel modelo
app.get('/api/admin/importar-cliente/plantilla/:tipo', authMiddleware, async (req, res, next) => {
  try {
    const tipo = req.params.tipo;
    const def = PLANTILLAS_CLIENTE[tipo];
    if (!def) return res.status(404).json({ ok: false, error: 'Plantilla modelo no encontrada para ' + tipo });
    const wb = XLSX.utils.book_new();
    for (const hoja of def.hojas) {
      const aoa = [hoja.headers, ...(hoja.ejemplo || [])];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = hoja.headers.map(() => ({ wch: 22 }));
      XLSX.utils.book_append_sheet(wb, ws, hoja.nombre.slice(0, 31));
    }
    // Hoja de instrucciones
    const wsInfo = XLSX.utils.aoa_to_sheet([
      ['Plantilla modelo: ' + tipo],
      [''],
      [def.descripcion || ''],
      [''],
      ['Notas:'],
      ['• Los nombres de las hojas son SUGERENCIAS — el importador detecta las hojas por palabras clave, podes usar otros nombres.'],
      ['• Los nombres de las columnas son SUGERENCIAS — el importador detecta las columnas por palabras clave (mayusculas/acentos/espacios tolerantes).'],
      ['• La primera fila de datos de cada hoja es un EJEMPLO. Borrala y empeza a cargar desde la fila 2.'],
      ['• Guarda el archivo como .xlsx y subilo desde Configuracion > Importacion > Planillas Especiales.'],
      ['• Despues de importar, podes revisar el resultado en el historial de importaciones y deshacer si hubo errores.'],
    ]);
    wsInfo['!cols'] = [{ wch: 110 }];
    XLSX.utils.book_append_sheet(wb, wsInfo, 'Instrucciones');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="plantilla-modelo-${tipo}.xlsx"`);
    res.end(buf);
  } catch (e) { next(e); }
});

// === IMPORTACIÓN POR TIPO ===
// ============================================================
// IMPORTACIONES ADAPTADAS — formatos REALES del cliente, no las plantillas
// estándar. Cada importador entiende un archivo Excel específico tal como
// vienen de planillas administrativas históricas y los carga al sistema.
// ============================================================

// Helpers para parsear fechas/montos en distintos formatos comunes en Excel
function _parseFechaArg(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number') {              // serial de Excel
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(epoch.getTime() + v * 86400000 + 12 * 3600000);  // +12h: fija el día sin importar la zona
  }
  const s = String(v).trim();
  // dd/mm/yyyy o dd/mm/yy
  const m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (m) {
    let yyyy = +m[3]; if (yyyy < 100) yyyy += 2000;
    // Mediodía UTC: evita que en un server en UTC la fecha se corra un día al mostrarla en Argentina.
    return new Date(Date.UTC(yyyy, +m[2]-1, +m[1], 12, 0, 0));
  }
  const d = new Date(s); return isNaN(d.getTime()) ? null : d;
}
function _parseMonto(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  // "u$s32,840.75", " $1,000.00", "21479544.98", etc.
  const s = String(v).replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}(\D|$))/g, '').replace(/,/g, '.');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}
function _normalizar(s) { return String(s||'').trim().toLowerCase(); }

// ============================================================
// HELPERS DE HISTORIAL DE IMPORTACIONES
// Cada importacion crea un ImportLote y los registros se "registran" en
// recordsCreados (mapa { modelo: [ids] }) para poder revertirlos despues.
// ============================================================
async function _crearImportLote(req, tipo) {
  return prisma.importLote.create({ data: {
    companyId: req.companyId, tipo,
    userId: req.user?.id || null,
    archivoNombre: req.file?.originalname || null,
    estado: 'activo',
  }});
}
function _registrarRecord(records, modelo, id) {
  if (!records[modelo]) records[modelo] = [];
  records[modelo].push(id);
}
async function _cerrarImportLote(loteId, records, importados, fallos, diagnostico) {
  return prisma.importLote.update({
    where: { id: loteId },
    data: { recordsCreados: records, importados, fallos, diagnostico: diagnostico || null },
  });
}

// === Importar CONTROL DE CHEQUES del cliente ===
// Entiende las 3 hojas: "Cheques fisicos a tercero", "echeq a tercero", "echeq emitidos"
app.post('/api/admin/importar-cliente/cheques', authMiddleware, requireCompany, requirePermission('finanzas:create'), upload.single('archivo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Falta el archivo' });
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    let ok = 0; const errores = [];
    // Hoja 1: Cheques físicos a tercero (recibidos)
    const sh1 = wb.SheetNames.find(n => /fisic.*tercer/i.test(n));
    if (sh1) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sh1], { defval: null, raw: false });
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        try {
          const nro = r['Numero de cheque'] || r['Número de cheque'];
          if (!nro) continue;
          const fRec = _parseFechaArg(r['Fecha de recepcion'] || r['Fecha de recepcion '] || r['Fecha de entrega']);
          await prisma.cheque.create({ data: {
            companyId: req.companyId,
            tipo: 'terceros',
            formato: /electron/i.test(r['Tipo de cheque'] || '') ? 'electronico' : 'fisico',
            banco: r['Banco Emisor'] || r['Banco'] || null,
            nroCheque: String(nro),
            fechaEmision: fRec || new Date(),
            fechaRecepcion: fRec || null,
            fechaPago:    _parseFechaArg(r['Fecha de pago']) || new Date(),
            monto: _parseMonto(r['Monto']) || 0,
            librador: r['Titular'] || null,
            cuitTitular: r['CUIT Titular'] || r['Cuit Titular'] || r['Cuit titular'] || null,
            endosante: r['Origen'] || r['Endosante'] || null,
            beneficiario: r['Destino'] || null,
            enPoderDe: r['Quien lo recibe'] || r['Quien lo recibe '] || null,
            estado: _normalizar(r['Estado'] || '').includes('depositad') ? 'depositado'
                  : _normalizar(r['Estado'] || '').includes('cobrad') ? 'cobrado'
                  : 'en_cartera',
            observaciones: [r['Destino'] && `Destino: ${r['Destino']}`, r['Observaciones'] || r['observaciones'] || null].filter(Boolean).join(' · ') || null,
          }});
          ok++;
        } catch (e) { errores.push({ hoja: sh1, fila: i+2, error: e.message }); }
      }
    }
    // Hoja 2: echeq a tercero
    const sh2 = wb.SheetNames.find(n => /echeq.*tercer/i.test(n));
    if (sh2) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sh2], { defval: null, raw: false });
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        try {
          const nro = r['Columna 1'] || r['Numero'];
          if (!nro) continue;
          // Estado: priorizamos el ESTADO FINAL del cheque endosado (Rechazado/Caducado)
          // y si no, el destino (Endosado/Depositado/Vendido). Así no se pierden los
          // rechazados/caducados.
          const dest = _normalizar(r['Destino del cheque'] || '');
          const fin  = _normalizar(r['Estado del cheque endosado'] || '');
          const est0 = _normalizar(r['Estado'] || '');
          let estadoCh;
          if (fin.includes('rechaz') || fin.includes('echazad') || est0.includes('rechaz') || dest.includes('rechaz')) estadoCh = 'rechazado';
          else if (fin.includes('anulad') || dest.includes('anulad') || est0.includes('anulad')) estadoCh = 'rechazado';
          else if (fin.includes('caduc') || est0.includes('caduc') || dest.includes('caduc')) estadoCh = 'rechazado';
          else if (dest.includes('endosad')) estadoCh = 'endosado';
          else if (dest.includes('depositad')) estadoCh = 'depositado';
          else if (dest.includes('vendido') || dest.includes('cobrad') || dest.includes('pagad') || fin.includes('pagad') || fin.includes('cobrad')) estadoCh = 'cobrado';
          else estadoCh = 'en_cartera';
          const fReD = _parseFechaArg(r['Fecha de recepcion'] || r['Fecha de recepcion ']);
          const fEndD = _parseFechaArg(r['Fecha del movimiento del endoso']);
          await prisma.cheque.create({ data: {
            companyId: req.companyId,
            tipo: 'terceros',
            formato: 'electronico',
            banco: r['Banco'] || null,
            nroCheque: String(nro),
            // No suele venir fecha de emision: usamos la de recepcion si esta, si no la de pago.
            fechaEmision: fReD || _parseFechaArg(r['Fecha de pago']) || new Date(),
            fechaRecepcion: fReD || null,
            fechaPago:    _parseFechaArg(r['Fecha de pago']) || new Date(),
            fechaEndoso:  fEndD || null,
            monto: _parseMonto(r['Importe']) || 0,
            librador: r['Titular'] || null,
            cuitTitular: r['Cuit titular'] || r['CUIT Titular'] || r['Cuit Titular'] || null,
            endosante: r['Endosante'] || null,
            beneficiario: r['A quien se endoso'] || null,
            estado: estadoCh,
            observaciones: [
              r['empresa'] && `Empresa: ${r['empresa']}`,
              r['VIA'] && `Vía: ${r['VIA']}`,
              r['Destino del cheque'] && `Destino: ${r['Destino del cheque']}`,
              r['Estado del cheque endosado'] && `Estado endoso: ${r['Estado del cheque endosado']}`,
              r['Observaciones'] || r['observaciones'] || null,
            ].filter(Boolean).join(' · ') || null,
          }});
          ok++;
        } catch (e) { errores.push({ hoja: sh2, fila: i+2, error: e.message }); }
      }
    }
    // Hoja 3: echeq emitidos (propios)
    const sh3 = wb.SheetNames.find(n => /echeq.*emit/i.test(n));
    if (sh3) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sh3], { defval: null, raw: false });
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        try {
          const nro = r['BAYRA '] || r['BAYRA'] || r['Numero'];
          if (!nro) continue;
          await prisma.cheque.create({ data: {
            companyId: req.companyId,
            tipo: 'propio',
            formato: 'electronico',
            banco: r['Banco'] || null,
            nroCheque: String(nro),
            fechaEmision: _parseFechaArg(r['Fecha de pago']) || new Date(),
            fechaPago:    _parseFechaArg(r['Fecha de pago']) || new Date(),
            monto: _parseMonto(r['Importe']) || 0,
            beneficiario: r['Beneficiario'] || null,
            estado: _normalizar(r['Estado'] || '').includes('pagad') ? 'pagado' : 'emitido',
            observaciones: [r['empresa'] && `Empresa: ${r['empresa']}`, (r['Cuit']||r['Cuit Beneficiario']) && `CUIT: ${r['Cuit']||r['Cuit Beneficiario']}`].filter(Boolean).join(' · ') || null,
          }});
          ok++;
        } catch (e) { errores.push({ hoja: sh3, fila: i+2, error: e.message }); }
      }
    }
    res.json({ ok: true, importados: ok, fallos: errores.length, errores: errores.slice(0, 100) });
  } catch (e) { next(e); }
});

// === Importar CREDITOS BANCARIOS del cliente ===
// Una hoja por banco con plan de cuotas. Cada hoja tiene: Cuota, Vencimiento, Estado, Monto, Fecha entrega, Notas.
// Creamos un Crédito por cada hoja y sus cuotas.
app.post('/api/admin/importar-cliente/creditos', authMiddleware, requireCompany, requirePermission('finanzas:create'), upload.single('archivo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Falta el archivo' });
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    // Las hojas que NO son crédito (resumen/flujo)
    const skipShs = ['cuadro guia','flujo de fondos'];
    let creditos = 0, cuotas = 0; const errores = [];
    for (const shName of wb.SheetNames) {
      if (skipShs.includes(_normalizar(shName))) continue;
      try {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[shName], { defval: null, raw: false });
        const cuotasData = rows.filter(r => r['Cuota '] || r['Cuota']).map(r => ({
          numero: parseInt(r['Cuota '] || r['Cuota']),
          vencimiento: _parseFechaArg(r['Vencimiento']),
          importeTotal: _parseMonto(r['Monto total a abonar']) || 0,
          pagada: _normalizar(r['Estado']).includes('abonad') || _normalizar(r['Estado']).includes('pagad'),
          fechaPago: _parseFechaArg(r['Fecha de entrega']),
          observaciones: r['Notas'] || null,
        })).filter(c => c.numero && c.vencimiento);
        if (!cuotasData.length) continue;
        const montoOriginal = cuotasData.reduce((a, c) => a + c.importeTotal, 0);
        const banco = shName.split(/[\s(]/)[0] || shName;
        await prisma.$transaction(async (tx) => {
          const cred = await tx.credito.create({ data: {
            companyId: req.companyId,
            banco,
            nroOperacion: shName,
            montoOriginal,
            cantCuotas: cuotasData.length,
            periodicidad: 'mensual',
            fechaPrimera: cuotasData[0].vencimiento,
            observaciones: `Importado: ${shName}`,
          }});
          for (const c of cuotasData) {
            await tx.cuotaCredito.create({ data: {
              creditoId: cred.id, numero: c.numero, vencimiento: c.vencimiento,
              importeCapital: 0, importeInteres: 0, importeOtros: 0, importeTotal: c.importeTotal,
              pagada: c.pagada, fechaPago: c.fechaPago, observaciones: c.observaciones,
            }});
            cuotas++;
          }
        });
        creditos++;
      } catch (e) { errores.push({ hoja: shName, error: e.message }); }
    }
    res.json({ ok: true, creditos, cuotas, fallos: errores.length, errores });
  } catch (e) { next(e); }
});

// === Importar CARTAS DE PORTE como Viajes ===
app.post('/api/admin/importar-cliente/cartas-porte', authMiddleware, requireCompany, requirePermission('logistica:create'), upload.single('archivo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Falta el archivo' });
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sh = wb.SheetNames.find(n => /carta.*porte/i.test(n)) || wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sh], { defval: null, raw: false });
    // Separa CUIT y nombre. Acepta columnas separadas (CUIT + nombre) o el formato
    // viejo con todo junto ("30-71711442-2 J.H. B"): en ese caso extrae el CUIT.
    const cuitNom = (cuitCol, nomCol) => {
      const m = [cuitCol, nomCol].map(x => x == null ? '' : String(x)).join(' ').match(/\d{2}-?\d{7,8}-?\d/);
      const cuit = (cuitCol && String(cuitCol).trim()) ? String(cuitCol).trim() : (m ? m[0] : null);
      let nombre = (nomCol != null ? String(nomCol) : '').trim();
      if (m && nombre.includes(m[0])) nombre = nombre.replace(m[0], '').trim();
      return { cuit: cuit || null, nombre: nombre || null };
    };
    let ok = 0; const errores = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        if (!r['N° Carta Porte'] && !r['N° CTG']) continue;
        const anulTxt = String(r['P.N Final'] || '') + ' ' + String(r['Rte. Comercial Venta Primaria'] || r['Rte Comercial'] || '') + ' ' + String(r['Estado'] || '');
        const anulada = /anulad/i.test(anulTxt);
        const pnCP    = _parseMonto(r['P.N CP']);
        const pnFinal = /anulad/i.test(String(r['P.N Final'] || '')) ? null : _parseMonto(r['P.N Final']);
        const rteP  = cuitNom(r['Rte Comercial CUIT'],     r['Rte Comercial']     || r['Rte. Comercial Venta Primaria']);
        const rteS  = cuitNom(r['Rte Comercial Sec CUIT'], r['Rte Comercial Sec'] || r['Rte. Comercial Venta Secundaria']);
        const dtar  = cuitNom(r['Destinatario CUIT'],      r['Destinatario']);
        const dest  = cuitNom(r['Destino CUIT'],           r['Destino']);
        // Campaña: si existe una campaña con ese nombre, la vinculamos.
        let campanaId = null;
        if (r['Campaña']) { const c = await prisma.campana.findFirst({ where: { companyId: req.companyId, nombre: { contains: String(r['Campaña']).trim() } }, select: { id: true } }); campanaId = c?.id || null; }
        const estado = anulada ? 'anulada' : (pnFinal > 0 ? 'descargado' : (pnCP > 0 ? 'cargado' : 'pendiente'));
        await prisma.viaje.create({ data: {
          companyId: req.companyId,
          fecha: _parseFechaArg(r['Fecha']) || new Date(),
          campanaId,
          producto: r['Producto'] || null,
          chofer: r['Chofer'] || null,
          destino: dest.nombre || dtar.nombre || null,
          cartaPorte: r['N° Carta Porte'] ? String(r['N° Carta Porte']) : null,
          ctg: r['N° CTG'] ? String(r['N° CTG']) : null,
          cantidad: (pnCP != null ? pnCP : pnFinal),   // kg cargados (PN CP); si no hay, cae al final
          kgNeto: pnCP != null ? pnCP : null,          // Peso Neto Carta de Porte = carga
          kgDescarga: pnFinal != null ? pnFinal : null,
          kgNetoDest: pnFinal != null ? pnFinal : null, // Peso Neto Final = descarga
          pagadorFlete: r['Flete pagador'] || null,
          estado,
          observaciones: [
            r['Campaña'] && `Campaña ${r['Campaña']}`,
            r['Titular Carta Porte'] && `Titular: ${r['Titular Carta Porte']}`,
            rteP.nombre && `Rte. comercial: ${rteP.nombre}${rteP.cuit ? ' (' + rteP.cuit + ')' : ''}`,
            rteS.nombre && rteS.nombre !== rteP.nombre && `Rte. comercial sec.: ${rteS.nombre}${rteS.cuit ? ' (' + rteS.cuit + ')' : ''}`,
            dtar.nombre && `Destinatario: ${dtar.nombre}${dtar.cuit ? ' (' + dtar.cuit + ')' : ''}`,
            dest.cuit && `CUIT destino: ${dest.cuit}`,
            anulada && 'ANULADA',
          ].filter(Boolean).join(' · ') || null,
        }});
        ok++;
      } catch (e) { errores.push({ fila: i+2, error: e.message }); }
    }
    res.json({ ok: true, importados: ok, fallos: errores.length, errores: errores.slice(0, 50) });
  } catch (e) { next(e); }
});

// === Importar CONTROL EFECTIVO del cliente ===
// Hoja "DIARI0" (o las hojas por persona) con: Fecha, Ingreso, Recibido por, Cuenta de, Egreso, Entregado a, Disponible
app.post('/api/admin/importar-cliente/efectivo', authMiddleware, requireCompany, requirePermission('finanzas:create'), upload.single('archivo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Falta el archivo' });
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    let ok = 0; const errores = [];
    for (const shName of wb.SheetNames) {
      if (!/^(diari|oficina|lucas|luciano|caja)/i.test(shName)) continue;
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[shName], { defval: null, raw: false });
      const caja = shName.toUpperCase();
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        try {
          const ing = _parseMonto(r['Ingreso']);
          const egr = _parseMonto(r['Egreso']);
          const fecha = _parseFechaArg(r['Fecha']);
          if (!fecha || (!ing && !egr)) continue;
          await prisma.efectivo.create({ data: {
            companyId: req.companyId,
            fecha,
            tipo: ing ? 'ingreso' : 'egreso',
            caja,
            monto: ing || egr || 0,
            concepto: r['Cuenta de'] || r['Entregado a '] || r['Recibido por'] || 'Importado',
            clasificacion: 'empresa',
            observaciones: [r['Recibido por'] && `De: ${r['Recibido por']}`, r['Entregado a '] && `Para: ${r['Entregado a ']}`].filter(Boolean).join(' · ') || null,
          }});
          ok++;
        } catch (e) { errores.push({ hoja: shName, fila: i+2, error: e.message }); }
      }
    }
    res.json({ ok: true, importados: ok, fallos: errores.length, errores: errores.slice(0, 50) });
  } catch (e) { next(e); }
});

// === Importar CERDOS (ventas) ===
// Acepta tanto la planilla "VENTAS CERDOS" (una sola hoja de ventas) como la "PYME"
// con varias hojas por categoría (Lechón, Capón, etc.). Detecta hojas y columnas
// por palabras clave para tolerar mayúsculas, acentos, espacios y nombres variados.
app.post('/api/admin/importar-cliente/cerdos-ventas', authMiddleware, requireCompany, requirePermission('stock:create'), upload.single('archivo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Falta el archivo' });
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });

    // Helper local: detectar columna por keywords (case + acentos tolerantes)
    function findKey(row, ...keywords) {
      if (!row) return null;
      const keys = Object.keys(row);
      for (const kw of keywords) {
        const kwN = _normalizar(kw);
        const k = keys.find(key => _normalizar(key).includes(kwN));
        if (k) return k;
      }
      return null;
    }

    // 1) Decidir qué hojas procesar.
    // 1a) Hojas cuyo nombre matchee con keywords típicas de ventas/cerdos
    const KW_HOJA = /vent|cerdo|hacienda|salid|egreso|movim|lech|cap[oó]n|chancho|pyme/i;
    let hojasAProcesar = wb.SheetNames.filter(n => KW_HOJA.test(n));
    // 1b) Si no encontró por nombre, ir hoja por hoja y quedarse con las que tengan
    //     al menos columnas Fecha y Cantidad (o equivalente).
    if (hojasAProcesar.length === 0) {
      for (const sh of wb.SheetNames) {
        const rs = XLSX.utils.sheet_to_json(wb.Sheets[sh], { defval: null, raw: false });
        if (rs.length > 0 && findKey(rs[0], 'fecha') && findKey(rs[0], 'cantidad', 'cabeza', 'cant')) {
          hojasAProcesar.push(sh);
        }
      }
    }
    if (hojasAProcesar.length === 0) {
      return res.status(400).json({ ok: false,
        error: 'No se encontró ninguna hoja con datos de ventas de cerdos. Esperaba una hoja llamada "Ventas", "Cerdos", "Lechón", "Capón", etc., o una hoja cualquiera con columnas Fecha y Cantidad.',
        diagnostico: { hojas_disponibles: wb.SheetNames } });
    }

    // 2) Lote de importación (para Deshacer después).
    const lote = await _crearImportLote(req, 'cerdos-ventas');
    const records = {};

    let ok = 0; const errores = []; const diag = [];

    // Cache de productos por categoría (Cerdos / Lechón / Capón / ...). Si la hoja
    // se llama "Lechón" creamos producto "Lechones" categoría hacienda. Si no
    // matchea ninguna categoría conocida, todo va a "Cerdos".
    const prodCache = new Map();
    async function getOrCreateProducto(nombre) {
      const key = nombre.toLowerCase();
      if (prodCache.has(key)) return prodCache.get(key);
      let p = await prisma.producto.findFirst({
        where: { companyId: req.companyId, nombre: { equals: nombre, mode: 'insensitive' } },
      });
      if (!p) {
        p = await prisma.producto.create({ data: {
          companyId: req.companyId, categoria: 'hacienda', nombre, unidad: 'cabezas',
        }});
        _registrarRecord(records, 'Producto', p.id);
      }
      prodCache.set(key, p);
      return p;
    }

    function detectarProducto(nombreHoja) {
      const n = _normalizar(nombreHoja);
      if (n.includes('lech')) return 'Lechones';
      if (n.includes('capon')) return 'Capones';
      if (n.includes('chancho')) return 'Chanchos';
      return 'Cerdos';
    }

    for (const sh of hojasAProcesar) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sh], { defval: null, raw: false });
      if (rows.length === 0) { diag.push({ hoja: sh, filas: 0, mensaje: 'vacía' }); continue; }

      const kFecha   = findKey(rows[0], 'fecha');
      const kCant    = findKey(rows[0], 'cantidad', 'cabeza', 'cant');
      const kPrecio  = findKey(rows[0], 'precio kg', 'precio kilo', 'precio unitario', 'precio');
      const kTotalKg = findKey(rows[0], 'total kg', 'kilos totales', 'kg total', 'peso total', 'kilos', 'kg');
      const kTotalIm = findKey(rows[0], 'total $', 'total pesos', 'importe total', 'importe', 'total');
      const kDestino = findKey(rows[0], 'destino', 'cliente', 'comprador');
      const kCateg   = findKey(rows[0], 'categoria', 'clase', 'tipo de animal');
      const kObs     = findKey(rows[0], 'observac', 'comentario', 'detalle');

      if (!kFecha || !kCant) {
        diag.push({ hoja: sh, filas: rows.length,
          mensaje: 'No se detectaron columnas Fecha y/o Cantidad — hoja saltada',
          columnas: Object.keys(rows[0]) });
        continue;
      }

      const nombreProd = detectarProducto(sh);
      const prod = await getOrCreateProducto(nombreProd);

      let okHoja = 0; let saltadas = 0;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        try {
          const cant = _parseMonto(r[kCant]);
          const fecha = _parseFechaArg(r[kFecha]);
          if (!cant || !fecha) { saltadas++; continue; }
          const obs = [
            kDestino && r[kDestino] && `Destino: ${r[kDestino]}`,
            kTotalKg && r[kTotalKg] && `${r[kTotalKg]} kg`,
            kCateg   && r[kCateg]   && `Categoría: ${r[kCateg]}`,
            kObs     && r[kObs]     && String(r[kObs]),
            `Hoja: ${sh}`,
          ].filter(Boolean).join(' · ');
          const mov = await prisma.movimiento.create({ data: {
            companyId: req.companyId, productoId: prod.id,
            fecha, tipo: 'egreso', motivo: 'venta',
            cantidad: cant,
            precio: kPrecio ? _parseMonto(r[kPrecio]) : null,
            total: kTotalIm ? _parseMonto(r[kTotalIm]) : null,
            observaciones: obs,
            userId: req.user?.id || null,
          }});
          _registrarRecord(records, 'Movimiento', mov.id);
          okHoja++;
        } catch (e) { errores.push({ hoja: sh, fila: i+2, error: e.message }); }
      }
      ok += okHoja;
      diag.push({ hoja: sh, filas_total: rows.length, importadas: okHoja, saltadas, producto: nombreProd,
        columnas_detectadas: {
          fecha: kFecha, cantidad: kCant, precio: kPrecio, totalKg: kTotalKg,
          totalImporte: kTotalIm, destino: kDestino, categoria: kCateg,
        } });
    }

    await _cerrarImportLote(lote, records, req.file.originalname);
    res.json({ ok: true, importados: ok, fallos: errores.length, errores: errores.slice(0, 50),
      diagnostico: { hojas_disponibles: wb.SheetNames, hojas_procesadas: diag } });
  } catch (e) { next(e); }
});

// === Importar TRANSFERENCIAS bancarias (Excel del cliente) ===
// Hojas esperadas: "Todas" (todas las transferencias hechas) y opcionalmente "No estan pasadas".
// Columnas: Fecha real | Fecha pasada al grupo | Banco | Empresa | Tipo de cuenta |
//           Monto | Detalle de transferencia | Quien la realizó | (Si) | observaciones
// Crea BancoCuenta automáticamente para cada banco que no exista, y un BancoMovimiento por fila
// con tipo = "transferencia_out" (egreso por transferencia).
app.post('/api/admin/importar-cliente/transferencias', authMiddleware, requireCompany, requirePermission('finanzas:create'), upload.single('archivo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Falta el archivo' });
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    let ok = 0; const errores = [];
    // Crear el lote de importacion para poder deshacerlo despues
    const lote = await _crearImportLote(req, 'transferencias');
    const records = {};
    // Cache de cuentas bancarias para no buscar/crear por cada fila.
    // Si la cuenta la CREAMOS nosotros (no existia), la trackeamos para poder
    // deshacerla. Si ya existia, no la trackeamos.
    const cuentasCache = new Map(); // key = banco normalizado
    async function getOrCreateCuenta(banco) {
      if (!banco) return null;
      const key = _normalizar(banco);
      if (cuentasCache.has(key)) return cuentasCache.get(key);
      let cuenta = await prisma.bancoCuenta.findFirst({
        where: { companyId: req.companyId, banco: { equals: banco, mode: 'insensitive' } },
      });
      if (!cuenta) {
        cuenta = await prisma.bancoCuenta.create({ data: {
          companyId: req.companyId, banco: banco.trim(),
          tipo: 'cta_cte', moneda: 'ARS', titular: null,
        }});
        _registrarRecord(records, 'BancoCuenta', cuenta.id);
      }
      cuentasCache.set(key, cuenta);
      return cuenta;
    }

    // Procesar hoja "Todas" (la principal). Si no existe usar la primera.
    const shTodas = wb.SheetNames.find(n => /todas/i.test(n)) || wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[shTodas], { defval: null, raw: false });
    if (rows.length === 0) {
      return res.json({ ok: true, importados: 0, fallos: 0, errores: [],
        diagnostico: { hojas: wb.SheetNames, hoja_procesada: shTodas, filas_leidas: 0,
          mensaje: 'La hoja no tiene filas con datos. Verificá que el archivo no esté vacío y que la primera fila sean los headers.' } });
    }
    // Buscar columnas por palabras clave (tolera mayúsculas, espacios extra, acentos)
    function findKey(row, ...keywords) {
      const keys = Object.keys(row);
      for (const kw of keywords) {
        const kwN = _normalizar(kw);
        const k = keys.find(key => _normalizar(key).includes(kwN));
        if (k) return k;
      }
      return null;
    }
    const kBanco   = findKey(rows[0], 'banco');
    const kMonto   = findKey(rows[0], 'monto', 'importe');
    const kFecha   = findKey(rows[0], 'fecha real', 'fecha de cuando se realiz', 'fecha');
    const kEmpresa = findKey(rows[0], 'empresa');
    const kDetalle = findKey(rows[0], 'detalle de transferencia', 'detalle', 'transferencia');
    const kQuien   = findKey(rows[0], 'quien la realiz', 'quien');
    const kObs     = findKey(rows[0], 'observac');

    if (!kBanco || !kMonto || !kFecha) {
      return res.status(400).json({ ok: false,
        error: 'No se encontraron las columnas obligatorias Banco, Monto y Fecha. Verificá que estén en la fila 1 del Excel.',
        diagnostico: { hoja_procesada: shTodas, columnas_excel: Object.keys(rows[0]),
          columnas_detectadas: { banco: kBanco, monto: kMonto, fecha: kFecha } } });
    }

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        const banco = r[kBanco];
        const monto = _parseMonto(r[kMonto]);
        const fecha = _parseFechaArg(r[kFecha]);
        if (!banco || !monto || !fecha) continue;
        const cuenta = await getOrCreateCuenta(banco);
        if (!cuenta) continue;
        const empresa = kEmpresa ? (r[kEmpresa] || '') : '';
        const detalle = kDetalle ? (r[kDetalle] || 'Transferencia') : 'Transferencia';
        const quien   = kQuien ? (r[kQuien] || '') : '';
        const obs     = kObs ? (r[kObs] || '') : '';
        const mov = await prisma.bancoMovimiento.create({ data: {
          companyId: req.companyId, cuentaId: cuenta.id,
          fecha, tipo: 'transferencia_out', concepto: String(detalle),
          monto: Math.abs(monto),
          contraparte: String(detalle).length > 100 ? String(detalle).slice(0, 100) : String(detalle),
          observaciones: [empresa && `Empresa: ${empresa}`, quien && `Operó: ${quien}`, obs].filter(Boolean).join(' · ') || null,
          userId: req.user?.id || null,
        }});
        _registrarRecord(records, 'BancoMovimiento', mov.id);
        ok++;
      } catch (e) { errores.push({ hoja: shTodas, fila: i+2, error: e.message }); }
    }
    const diag = { hoja_procesada: shTodas, filas_leidas: rows.length,
      columnas_detectadas: { banco: kBanco, monto: kMonto, fecha: kFecha, empresa: kEmpresa, detalle: kDetalle } };
    await _cerrarImportLote(lote.id, records, ok, errores.length, diag);
    res.json({ ok: true, importados: ok, fallos: errores.length, errores: errores.slice(0, 100), loteId: lote.id, diagnostico: diag });
  } catch (e) { next(e); }
});

// === Importar SALDOS DE CUENTAS CORRIENTES (Excel del cliente) ===
// Hoja "Resumen": deudas y créditos pendientes con proveedores/clientes.
// Header está en fila 3 (porque fila 1-2 son leyenda de colores).
// Columnas: Nombre del cliente/proveedor | Saldo total | Transferencia o echeq |
//           Fecha de la solicitud | Prioridad | Estado de la cuenta |
//           Observaciones | Fecha de pago | Reclaman
// Carga cada fila como CtaCte con contactoTipo='libre' y haber=saldoTotal (deuda a pagar).
app.post('/api/admin/importar-cliente/ctacte-saldos', authMiddleware, requireCompany, requirePermission('finanzas:create'), upload.single('archivo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Falta el archivo' });
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    let ok = 0; const errores = [];
    const lote = await _crearImportLote(req, 'ctacte-saldos');
    const records = {};
    const shResumen = wb.SheetNames.find(n => /resumen/i.test(n)) || wb.SheetNames[0];
    const ws = wb.Sheets[shResumen];
    // Leer todo como arreglo de arreglos (para manejar bien el offset del header en fila 3)
    const allRows = XLSX.utils.sheet_to_json(ws, { defval: null, header: 1, raw: false });
    // El header está en fila 3 (index 2). Encontrar la columna por nombre.
    const header = (allRows[2] || []).map(c => _normalizar(c));
    const idx = {
      nombre:    header.findIndex(c => c && c.includes('nombre')),
      saldo:     header.findIndex(c => c && c.includes('saldo')),
      tipo:      header.findIndex(c => c && (c.includes('transferencia') || c.includes('echeq'))),
      prioridad: header.findIndex(c => c && c.includes('prioridad')),
      estado:    header.findIndex(c => c && c.includes('estado')),
      obs:       header.findIndex(c => c && c.includes('observaciones')),
      vence:     header.findIndex(c => c && c.includes('pago')),
      reclaman:  header.findIndex(c => c && c.includes('reclam')),
    };
    if (idx.nombre < 0 || idx.saldo < 0) {
      return res.status(400).json({ ok: false, error: 'No se encontraron las columnas Nombre y Saldo total en fila 3 de la hoja Resumen.' });
    }
    // Empezar a leer datos desde fila 4 (index 3)
    for (let i = 3; i < allRows.length; i++) {
      const r = allRows[i];
      if (!r || r.every(c => c === null || c === '' )) continue;
      try {
        const nombre = r[idx.nombre];
        const saldo  = _parseMonto(r[idx.saldo]);
        if (!nombre || !saldo) continue;
        const estado = _normalizar(r[idx.estado] || '');
        const pagado = estado.includes('pagad') || estado.includes('saldad');
        const prioridad = r[idx.prioridad] || '';
        const tipoPago  = r[idx.tipo] || '';
        const reclaman  = r[idx.reclaman] || '';
        const obsExtra  = r[idx.obs] || '';
        const vence     = _parseFechaArg(r[idx.vence]);
        const cc = await prisma.ctaCte.create({ data: {
          companyId: req.companyId,
          contactoTipo: 'libre',
          nombreLibre: String(nombre).trim(),
          fecha: new Date(),
          vencimiento: vence,
          detalle: `Saldo importado (${tipoPago || 'pago'})${prioridad ? ' — ' + prioridad : ''}`,
          categoria: 'Otro',
          haber: saldo,
          pagado,
          observaciones: [
            tipoPago && `Tipo: ${tipoPago}`,
            estado && `Estado: ${estado}`,
            reclaman && `Reclaman: ${reclaman}`,
            obsExtra,
          ].filter(Boolean).join(' · ') || null,
        }});
        _registrarRecord(records, 'CtaCte', cc.id);
        ok++;
      } catch (e) { errores.push({ hoja: shResumen, fila: i+1, error: e.message }); }
    }
    await _cerrarImportLote(lote.id, records, ok, errores.length, { hoja_procesada: shResumen });
    res.json({ ok: true, importados: ok, fallos: errores.length, errores: errores.slice(0, 100), loteId: lote.id });
  } catch (e) { next(e); }
});

// === Importar STOCK DE HACIENDA (Excel del cliente) ===
// Una hoja por Renspa/campo. Cada hoja:
//   - Fila 1: "RENSPA: <código>" y "FECHA:"
//   - Fila 3: header — Especie | Categoria | Stock | Cambio | Stock real | Diferencia | Notas
//   - Datos desde fila 4
//   - Última fila: TOTAL (se ignora)
// Crea/actualiza HaciendaStock por (campo, categoria) con declarado = Stock real.
// El campo se crea automáticamente si no existe (nombre = nombre de la hoja).
app.post('/api/admin/importar-cliente/stock-hacienda', authMiddleware, requireCompany, requirePermission('stock:create'), upload.single('archivo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Falta el archivo' });
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    let ok = 0; const errores = [];
    const lote = await _crearImportLote(req, 'stock-hacienda');
    const records = {};
    const camposCache = new Map();
    async function getOrCreateCampo(nombre) {
      if (!nombre) return null;
      const key = _normalizar(nombre);
      if (camposCache.has(key)) return camposCache.get(key);
      let campo = await prisma.campo.findFirst({
        where: { companyId: req.companyId, nombre: { equals: nombre, mode: 'insensitive' } },
      });
      if (!campo) {
        campo = await prisma.campo.create({ data: {
          companyId: req.companyId, nombre: nombre.trim(), activo: true,
        }});
        _registrarRecord(records, 'Campo', campo.id);
      }
      camposCache.set(key, campo);
      return campo;
    }

    for (const shName of wb.SheetNames) {
      try {
        const ws = wb.Sheets[shName];
        const allRows = XLSX.utils.sheet_to_json(ws, { defval: null, header: 1, raw: false });
        // Detectar header (busca fila con "Especie" en alguna columna, primeras 10 filas)
        let headerRowIdx = -1;
        for (let r = 0; r < Math.min(10, allRows.length); r++) {
          if ((allRows[r] || []).some(c => _normalizar(c) === 'especie')) {
            headerRowIdx = r; break;
          }
        }
        if (headerRowIdx < 0) continue;
        const header = allRows[headerRowIdx].map(c => _normalizar(c));
        const idx = {
          especie:  header.findIndex(c => c === 'especie'),
          categoria:header.findIndex(c => c && c.includes('categoria')),
          stockReal:header.findIndex(c => c && c.includes('stock real')),
          stock:    header.findIndex(c => c === 'stock'),
          obs:      header.findIndex(c => c && (c.includes('nota') || c.includes('observ'))),
        };
        // Crear (o tomar) el campo correspondiente a esta hoja
        const campo = await getOrCreateCampo(shName);
        if (!campo) continue;
        // Empezar a procesar desde la fila siguiente al header
        for (let i = headerRowIdx + 1; i < allRows.length; i++) {
          const r = allRows[i];
          if (!r) continue;
          const especie = r[idx.especie];
          const cat     = r[idx.categoria];
          // Saltar fila TOTAL
          if (_normalizar(especie) === 'total' || _normalizar(cat) === 'total') continue;
          if (!especie && !cat) continue;
          const stockReal = _parseMonto(r[idx.stockReal] >= 0 ? r[idx.stockReal] : null) ?? _parseMonto(r[idx.stock]);
          if (stockReal === null || stockReal === undefined) continue;
          const catCompleta = [especie, cat].filter(Boolean).join(' - ').trim();
          if (!catCompleta) continue;
          try {
            // Si ya existia un stock con esa combinacion, no podemos "deshacer"
            // su valor previo. Marcamos solo los CREADOS, no los actualizados.
            const existente = await prisma.haciendaStock.findUnique({
              where: { companyId_campoId_categoria: {
                companyId: req.companyId, campoId: campo.id, categoria: catCompleta,
              }},
            });
            const upserted = await prisma.haciendaStock.upsert({
              where: { companyId_campoId_categoria: {
                companyId: req.companyId, campoId: campo.id, categoria: catCompleta,
              }},
              create: {
                companyId: req.companyId, campoId: campo.id,
                categoria: catCompleta, declarado: Math.round(stockReal),
                observaciones: r[idx.obs] || null,
              },
              update: { declarado: Math.round(stockReal), observaciones: r[idx.obs] || undefined },
            });
            if (!existente) _registrarRecord(records, 'HaciendaStock', upserted.id);
            ok++;
          } catch (e) { errores.push({ hoja: shName, fila: i+1, error: e.message }); }
        }
      } catch (e) { errores.push({ hoja: shName, fila: 0, error: e.message }); }
    }
    await _cerrarImportLote(lote.id, records, ok, errores.length, { hojas_procesadas: wb.SheetNames });
    res.json({ ok: true, importados: ok, fallos: errores.length, errores: errores.slice(0, 100), loteId: lote.id });
  } catch (e) { next(e); }
});

// === Importar HECTAREAS SEMBRADAS por empresa/campo/cultivo ===
// Excel con una hoja por empresa (LLSP, El Pistrin, Peiretti Gerardo, etc.) y
// columnas: Renspa | Campo | Cultivo | Ha sembradas (header en fila 2).
// Las filas vienen "agrupadas" por Renspa+Campo: solo aparecen en la primera
// fila de cada grupo, las siguientes filas estan en blanco — hay que hacer
// forward-fill. Por cada (Campo, Cultivo) crea un Lote con hectareas=Has.
// Si el Campo no existe en la empresa actual, lo crea con el Renspa en obs.
// IMPORTANTE: este importador usa la EMPRESA ACTIVA del usuario, NO la de la
// hoja del Excel. Si querés cargar las 3 empresas, hay que cambiar de empresa
// e importar 3 veces (una por hoja).
app.post('/api/admin/importar-cliente/hectareas-sembradas', authMiddleware, requireCompany, requirePermission('produccion:create'), upload.single('archivo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Falta el archivo' });
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    let ok = 0; const errores = [];
    const lote = await _crearImportLote(req, 'hectareas-sembradas');
    const records = {};

    const camposCache = new Map();
    async function getOrCreateCampoConRenspa(nombre, renspa) {
      if (!nombre) return null;
      const key = _normalizar(nombre);
      if (camposCache.has(key)) return camposCache.get(key);
      let campo = await prisma.campo.findFirst({
        where: { companyId: req.companyId, nombre: { equals: nombre, mode: 'insensitive' } },
      });
      if (!campo) {
        campo = await prisma.campo.create({ data: {
          companyId: req.companyId, nombre: String(nombre).trim(),
          observaciones: renspa ? `RENSPA: ${renspa}` : null, activo: true,
        }});
        _registrarRecord(records, 'Campo', campo.id);
      } else if (renspa && !_normalizar(campo.observaciones || '').includes('renspa')) {
        // Actualizar Renspa si no estaba cargado
        try {
          await prisma.campo.update({ where: { id: campo.id }, data: {
            observaciones: campo.observaciones ? `${campo.observaciones} · RENSPA: ${renspa}` : `RENSPA: ${renspa}`,
          }});
        } catch {}
      }
      camposCache.set(key, campo);
      return campo;
    }

    const hojasDiag = [];
    for (const shName of wb.SheetNames) {
      const ws = wb.Sheets[shName];
      const allRows = XLSX.utils.sheet_to_json(ws, { defval: null, header: 1, raw: false });
      // Detectar header (busca fila con "Cultivo" o "cultivo" en primeras 10 filas)
      let headerRowIdx = -1;
      for (let r = 0; r < Math.min(10, allRows.length); r++) {
        if ((allRows[r] || []).some(c => _normalizar(c) === 'cultivo')) { headerRowIdx = r; break; }
      }
      if (headerRowIdx < 0) {
        hojasDiag.push({ hoja: shName, error: 'No se encontro la columna Cultivo' });
        continue;
      }
      const header = allRows[headerRowIdx].map(c => _normalizar(c));
      const idx = {
        renspa:   header.findIndex(c => c && c.includes('renspa')),
        campo:    header.findIndex(c => c === 'campo'),
        cultivo:  header.findIndex(c => c && c.includes('cultivo')),
        has:      header.findIndex(c => c && (c.includes('sembrad') || c.includes('ha '))),
      };
      // forward-fill de Renspa y Campo
      let lastRenspa = null, lastCampo = null;
      let okHoja = 0;
      for (let i = headerRowIdx + 1; i < allRows.length; i++) {
        const r = allRows[i];
        if (!r) continue;
        const renspaCell = idx.renspa >= 0 ? r[idx.renspa] : null;
        const campoCell  = idx.campo  >= 0 ? r[idx.campo]  : null;
        if (renspaCell) lastRenspa = String(renspaCell).trim();
        if (campoCell)  lastCampo  = String(campoCell).trim();
        const cultivo = r[idx.cultivo];
        const has     = _parseMonto(r[idx.has]);
        if (!lastCampo || !cultivo || !has) continue;
        try {
          const campo = await getOrCreateCampoConRenspa(lastCampo, lastRenspa);
          if (!campo) continue;
          const loteNuevo = await prisma.lote.create({ data: {
            campoId: campo.id,
            nombre: String(cultivo).trim(),
            hectareas: has,
            observaciones: `Sembrado · importado desde ${shName}`,
            activo: true,
          }});
          _registrarRecord(records, 'Lote', loteNuevo.id);
          okHoja++; ok++;
        } catch (e) { errores.push({ hoja: shName, fila: i+1, error: e.message }); }
      }
      hojasDiag.push({ hoja: shName, importados: okHoja });
    }
    await _cerrarImportLote(lote.id, records, ok, errores.length, { hojas: hojasDiag });
    res.json({ ok: true, importados: ok, fallos: errores.length, errores: errores.slice(0, 100), loteId: lote.id, diagnostico: { hojas: hojasDiag } });
  } catch (e) { next(e); }
});

// === Importar PYME — VENTAS DE HACIENDA MENOR ===
// Excel con 1 hoja, columnas (header fila 1):
//   Fecha grupo | Tipo (Lechon/Cordero/Chivito/cancha) | KG | Estado (Pago/No pago)
//   | Precio por KG | Total | Entregado a | Notas
// Por cada fila crea:
//   - Producto categoria=hacienda con nombre=Tipo (solo si no existe)
//   - Movimiento egreso del producto con cantidad=KG, precio, total
//   - Si Estado != "Pago", suma a CtaCte como "libre" con el "Entregado a" como nombre
app.post('/api/admin/importar-cliente/pyme-ventas', authMiddleware, requireCompany, requirePermission('stock:create'), upload.single('archivo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Falta el archivo' });
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    let ok = 0; const errores = [];
    const lote = await _crearImportLote(req, 'pyme-ventas');
    const records = {};

    const productosCache = new Map();
    async function getOrCreateProducto(tipo) {
      const key = _normalizar(tipo);
      if (productosCache.has(key)) return productosCache.get(key);
      // Mapear "cancha" -> "Cancha", capitalizar
      const nombre = String(tipo).trim().replace(/^\w/, c => c.toUpperCase());
      let prod = await prisma.producto.findFirst({
        where: { companyId: req.companyId, nombre: { equals: nombre, mode: 'insensitive' } },
      });
      if (!prod) {
        prod = await prisma.producto.create({ data: {
          companyId: req.companyId, categoria: 'hacienda', nombre, unidad: 'kg',
        }});
        _registrarRecord(records, 'Producto', prod.id);
      }
      productosCache.set(key, prod);
      return prod;
    }

    const shVentas = wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[shVentas], { defval: null, raw: false });
    if (rows.length === 0) {
      await _cerrarImportLote(lote.id, records, 0, 0, { mensaje: 'Hoja vacia' });
      return res.json({ ok: true, importados: 0, fallos: 0, loteId: lote.id });
    }
    function findKey(row, ...keywords) {
      const keys = Object.keys(row);
      for (const kw of keywords) {
        const kwN = _normalizar(kw);
        const k = keys.find(key => _normalizar(key).includes(kwN));
        if (k) return k;
      }
      return null;
    }
    const kFecha   = findKey(rows[0], 'fecha');
    const kTipo    = findKey(rows[0], 'tipo');
    const kKg      = findKey(rows[0], 'kg');
    const kEstado  = findKey(rows[0], 'estado');
    const kPrecio  = findKey(rows[0], 'precio por kg', 'precio');
    const kTotal   = findKey(rows[0], 'total');
    const kCliente = findKey(rows[0], 'entregado a', 'cliente');
    const kNotas   = findKey(rows[0], 'notas', 'observ');
    if (!kFecha || !kTipo || !kKg) {
      return res.status(400).json({ ok: false,
        error: 'No se encontraron las columnas Fecha, Tipo y KG.',
        diagnostico: { columnas_excel: Object.keys(rows[0]) } });
    }

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        const fecha = _parseFechaArg(r[kFecha]);
        const tipo  = r[kTipo];
        const kg    = _parseMonto(r[kKg]);
        if (!fecha || !tipo || !kg) continue;
        const prod = await getOrCreateProducto(tipo);
        const precio = kPrecio ? _parseMonto(r[kPrecio]) : null;
        const total  = kTotal  ? _parseMonto(r[kTotal])  : (precio ? kg * precio : null);
        const cliente = kCliente ? (r[kCliente] || '') : '';
        const notas   = kNotas   ? (r[kNotas]   || '') : '';
        const estado  = kEstado  ? _normalizar(r[kEstado] || '') : '';
        const mov = await prisma.movimiento.create({ data: {
          companyId: req.companyId, productoId: prod.id,
          fecha, tipo: 'egreso', motivo: 'venta',
          cantidad: kg, precio, total,
          observaciones: [cliente && `Cliente: ${cliente}`, notas].filter(Boolean).join(' · ') || null,
          userId: req.user?.id || null,
        }});
        _registrarRecord(records, 'Movimiento', mov.id);
        // Si NO está pago, sumar a cuentas a cobrar
        if (estado && !estado.includes('pago') && cliente && total) {
          const cc = await prisma.ctaCte.create({ data: {
            companyId: req.companyId, contactoTipo: 'libre',
            nombreLibre: String(cliente).trim(),
            fecha, detalle: `Venta ${prod.nombre} ${kg} kg`,
            categoria: 'Otro', debe: total, pagado: false,
            observaciones: 'Importado desde PyME ventas (sin cobrar)',
          }});
          _registrarRecord(records, 'CtaCte', cc.id);
        }
        ok++;
      } catch (e) { errores.push({ fila: i+2, error: e.message }); }
    }
    await _cerrarImportLote(lote.id, records, ok, errores.length, null);
    res.json({ ok: true, importados: ok, fallos: errores.length, errores: errores.slice(0, 100), loteId: lote.id });
  } catch (e) { next(e); }
});

// === Importar PROVEEDORES desde hoja "Proveedores" de CUENTAS CORRIENTES.xlsx ===
// Columnas: Proveedores | Telefono | Mail | Cuit | Horarios
app.post('/api/admin/importar-cliente/proveedores', authMiddleware, requireCompany, requirePermission('contactos:create'), upload.single('archivo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Falta el archivo' });
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    let ok = 0; const errores = [];
    const lote = await _crearImportLote(req, 'proveedores');
    const records = {};

    // Buscar la hoja Proveedores (sino usar la primera)
    const shProv = wb.SheetNames.find(n => /provee/i.test(n)) || wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[shProv], { defval: null, raw: false });
    if (rows.length === 0) {
      await _cerrarImportLote(lote.id, records, 0, 0, { mensaje: 'Hoja vacia' });
      return res.json({ ok: true, importados: 0, fallos: 0, loteId: lote.id });
    }
    function findKey(row, ...keywords) {
      const keys = Object.keys(row);
      for (const kw of keywords) {
        const kwN = _normalizar(kw);
        const k = keys.find(key => _normalizar(key).includes(kwN));
        if (k) return k;
      }
      return null;
    }
    const kNombre   = findKey(rows[0], 'proveedor', 'razon social', 'razonsocial', 'nombre');
    const kTel      = findKey(rows[0], 'telefono', 'tel');
    const kMail     = findKey(rows[0], 'mail', 'email');
    const kCuit     = findKey(rows[0], 'cuit');
    const kHorarios = findKey(rows[0], 'horario');
    if (!kNombre) {
      return res.status(400).json({ ok: false,
        error: 'No se encontró la columna Proveedores/Nombre/Razón social.',
        diagnostico: { hoja_procesada: shProv, columnas_excel: Object.keys(rows[0]) } });
    }

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        const razon = r[kNombre];
        if (!razon || !String(razon).trim()) continue;
        const razonStr = String(razon).trim();
        // Evitar duplicados: si ya existe un proveedor con la misma razon social, saltar
        const existente = await prisma.proveedor.findFirst({
          where: { companyId: req.companyId, razonSocial: { equals: razonStr, mode: 'insensitive' } },
        });
        if (existente) continue;
        const tel  = kTel  ? r[kTel]  : null;
        const mail = kMail ? r[kMail] : null;
        const cuit = kCuit ? r[kCuit] : null;
        const hor  = kHorarios ? r[kHorarios] : null;
        const prov = await prisma.proveedor.create({ data: {
          companyId: req.companyId, razonSocial: razonStr,
          cuit: cuit ? String(cuit).trim() : null,
          telefono: tel ? String(tel).trim() : null,
          email: mail ? String(mail).trim() : null,
          observaciones: hor ? `Horarios: ${hor}` : null,
          activo: true,
        }});
        _registrarRecord(records, 'Proveedor', prov.id);
        ok++;
      } catch (e) { errores.push({ fila: i+2, error: e.message }); }
    }
    await _cerrarImportLote(lote.id, records, ok, errores.length, { hoja_procesada: shProv });
    res.json({ ok: true, importados: ok, fallos: errores.length, errores: errores.slice(0, 100), loteId: lote.id });
  } catch (e) { next(e); }
});

// === HISTORIAL DE IMPORTACIONES ===
// Lista los ultimos 50 lotes de la empresa activa, con resumen y estado.
app.get('/api/admin/importaciones', authMiddleware, requireCompany, async (req, res, next) => {
  try {
    const lotes = await prisma.importLote.findMany({
      where: { companyId: req.companyId },
      orderBy: { fecha: 'desc' },
      take: 50,
    });
    // Incluir nombre del user que importo
    const userIds = [...new Set(lotes.map(l => l.userId).filter(Boolean))];
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, nombre: true, apellido: true, alias: true } })
      : [];
    const usersMap = new Map(users.map(u => [u.id, u]));
    res.json({ ok: true, data: lotes.map(l => ({
      id: l.id, tipo: l.tipo, fecha: l.fecha,
      archivoNombre: l.archivoNombre,
      importados: l.importados, fallos: l.fallos,
      estado: l.estado, fechaDeshecho: l.fechaDeshecho,
      usuario: l.userId ? (() => { const u = usersMap.get(l.userId); return u ? [u.nombre, u.apellido].filter(Boolean).join(' ') || u.alias : null; })() : null,
      // Cantidad por modelo para mostrar el "alcance" del lote
      recordsResumen: l.recordsCreados ? Object.fromEntries(Object.entries(l.recordsCreados).map(([k, v]) => [k, (v || []).length])) : null,
    })) });
  } catch (e) { next(e); }
});

// === DESHACER LOTE DE IMPORTACION ===
// Borra todos los registros que el lote creo, en orden inverso (hijos primero
// para evitar FK violations). Marca el lote como deshecho.
// IMPORTANTE: el deshacer NO restaura registros que el lote habia actualizado
// (HaciendaStock con upsert que pisaba un valor previo). Esos quedan como
// estan. Solo se borran registros que fueron CREADOS por la importacion.
app.post('/api/admin/importaciones/:id/deshacer', authMiddleware, requireCompany, async (req, res, next) => {
  try {
    const lote = await prisma.importLote.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!lote) return res.status(404).json({ ok: false, error: 'Lote no encontrado' });
    if (lote.estado !== 'activo') return res.status(400).json({ ok: false, error: 'El lote ya fue deshecho previamente' });

    const records = lote.recordsCreados || {};
    // Mapa de modelo Prisma -> nombre del accessor de Prisma Client
    // (la convencion es camelCase del nombre del modelo).
    const accessorByModel = {
      'BancoMovimiento': 'bancoMovimiento',
      'BancoCuenta':     'bancoCuenta',
      'CtaCte':          'ctaCte',
      'HaciendaStock':   'haciendaStock',
      'Campo':           'campo',
      'Movimiento':      'movimiento',
      'Cheque':          'cheque',
      'Viaje':           'viaje',
      'Cliente':         'cliente',
      'Proveedor':       'proveedor',
      'Producto':        'producto',
      'Credito':         'credito',
      'CuotaCredito':    'cuotaCredito',
    };
    // Orden de borrado: hijos primero. Si un modelo no esta en esta lista lo
    // borramos al final con "los demas".
    const ordenBorrado = [
      'BancoMovimiento', 'CuotaCredito', 'Movimiento',
      'Cheque', 'Viaje', 'CtaCte',
      'HaciendaStock',
      'Credito',
      'BancoCuenta',  // antes de Campo/Producto/Cliente/Proveedor porque puede tener FK indirecta
      'Producto', 'Cliente', 'Proveedor',
      'Campo',
    ];
    let borrados = 0;
    const errores = [];
    for (const modelo of ordenBorrado) {
      const ids = records[modelo];
      if (!ids || !ids.length) continue;
      const accessor = accessorByModel[modelo];
      if (!accessor || !prisma[accessor]) {
        errores.push({ modelo, error: 'Accessor de Prisma no encontrado' });
        continue;
      }
      try {
        const r = await prisma[accessor].deleteMany({ where: { id: { in: ids } } });
        borrados += r.count;
      } catch (e) {
        errores.push({ modelo, error: String(e.message || e) });
      }
    }
    // Borrar tambien cualquier modelo "extra" no listado
    for (const [modelo, ids] of Object.entries(records)) {
      if (ordenBorrado.includes(modelo)) continue;
      const accessor = accessorByModel[modelo];
      if (!accessor || !prisma[accessor]) continue;
      try {
        const r = await prisma[accessor].deleteMany({ where: { id: { in: ids } } });
        borrados += r.count;
      } catch (e) { errores.push({ modelo, error: String(e.message || e) }); }
    }
    await prisma.importLote.update({
      where: { id: lote.id },
      data: { estado: 'deshecho', fechaDeshecho: new Date() },
    });
    res.json({ ok: true, borrados, errores: errores.length ? errores : undefined });
  } catch (e) { next(e); }
});

app.post('/api/admin/importar/:tipo', authMiddleware, requireCompany, upload.single('archivo'), async (req, res, next) => {
  try {
    const tipo = req.params.tipo;
    if (!PLANTILLAS[tipo]) return res.status(404).json({ ok: false, error: 'Tipo no soportado' });
    if (!req.file) return res.status(400).json({ ok: false, error: 'Falta el archivo' });
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames.find(n => /datos/i.test(n)) || wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
    let ok = 0;
    const errores = [];
    // Importadores por tipo
    const importers = {
      clientes: async (r) => {
        if (!r['razonSocial*'] && !r.razonSocial) throw new Error('Falta razonSocial');
        return prisma.cliente.create({ data: {
          companyId: req.companyId,
          razonSocial: r['razonSocial*'] || r.razonSocial,
          cuit: r.cuit || null, condIVA: r.condIVA || null,
          email: r.email || null, telefono: String(r.telefono || '') || null,
          direccion: r.direccion || null, localidad: r.localidad || null, provincia: r.provincia || null,
          observaciones: r.observaciones || null,
        }});
      },
      proveedores: async (r) => {
        if (!r['razonSocial*'] && !r.razonSocial) throw new Error('Falta razonSocial');
        return prisma.proveedor.create({ data: {
          companyId: req.companyId,
          razonSocial: r['razonSocial*'] || r.razonSocial,
          cuit: r.cuit || null, condIVA: r.condIVA || null,
          email: r.email || null, telefono: String(r.telefono || '') || null,
          direccion: r.direccion || null, localidad: r.localidad || null, provincia: r.provincia || null,
          observaciones: r.observaciones || null,
        }});
      },
      productos: async (r) => {
        if (!r['categoria*'] && !r.categoria) throw new Error('Falta categoría');
        if (!r['nombre*'] && !r.nombre) throw new Error('Falta nombre');
        if (!r['unidad*'] && !r.unidad) throw new Error('Falta unidad');
        return prisma.producto.create({ data: {
          companyId: req.companyId,
          categoria: r['categoria*'] || r.categoria,
          nombre: r['nombre*'] || r.nombre,
          unidad: r['unidad*'] || r.unidad,
          stockMinimo: Number(r.stockMinimo || 0),
          precioReferencia: r.precioReferencia ? Number(r.precioReferencia) : null,
          observaciones: r.observaciones || null,
        }});
      },
      cheques: async (r) => {
        return prisma.cheque.create({ data: {
          companyId: req.companyId,
          tipo: r['tipo*'] || r.tipo,
          formato: r.formato || null,
          banco: r.banco || null,
          nroCheque: String(r['nroCheque*'] || r.nroCheque),
          fechaEmision: new Date(r['fechaEmision*'] || r.fechaEmision),
          fechaPago: new Date(r['fechaPago*'] || r.fechaPago),
          monto: Number(r['monto*'] || r.monto),
          beneficiario: r.beneficiario || null,
          librador: r.librador || null,
          estado: r.estado || 'en_cartera',
          observaciones: r.observaciones || null,
        }});
      },
      arrendamientos: async (r) => {
        return prisma.arrendamiento.create({ data: {
          companyId: req.companyId,
          propietario: r['propietario*'] || r.propietario,
          hectareas: Number(r['hectareas*'] || r.hectareas),
          importeHa: r.importeHa ? Number(r.importeHa) : null,
          tipoPago: r.tipoPago || null,
          vencimiento: r.vencimiento ? new Date(r.vencimiento) : null,
          observaciones: r.observaciones || null,
        }});
      },
      empleados: async (r) => {
        return prisma.empleado.create({ data: {
          companyId: req.companyId,
          nombre: r['nombre*'] || r.nombre,
          apellido: r['apellido*'] || r.apellido,
          dni: String(r.dni || '') || null,
          cuil: r.cuil || null,
          puesto: r.puesto || null,
          sueldo: r.sueldo ? Number(r.sueldo) : null,
          fechaIngreso: r.fechaIngreso ? new Date(r.fechaIngreso) : null,
          telefono: String(r.telefono || '') || null,
          email: r.email || null,
          tipo: r.tipo || 'propio',
          cobraPorcentaje: String(r.cobraPorcentaje).toLowerCase() === 'true',
          porcentajeDefault: r.porcentajeDefault ? Number(r.porcentajeDefault) : null,
        }});
      },
      'cuentas-bancarias': async (r) => {
        return prisma.bancoCuenta.create({ data: {
          companyId: req.companyId,
          banco: r['banco*'] || r.banco,
          tipo: r.tipo || 'cta_cte',
          moneda: r.moneda || 'ARS',
          numero: r.numero ? String(r.numero) : null,
          cbu: r.cbu ? String(r.cbu) : null,
          alias: r.alias || null,
          titular: r.titular || null,
          saldoInicial: Number(r.saldoInicial || 0),
          fechaInicial: r.fechaInicial ? new Date(r.fechaInicial) : null,
          observaciones: r.observaciones || null,
        }});
      },
      'saldos-clientes': async (r) => {
        const key = String(r['cuit_o_razonSocial*'] || r.cuit_o_razonSocial || '');
        const cli = await prisma.cliente.findFirst({ where: { companyId: req.companyId, OR: [{ cuit: key }, { razonSocial: key }] } });
        if (!cli) throw new Error('Cliente no encontrado: ' + key);
        return prisma.ctaCte.create({ data: {
          companyId: req.companyId, contactoTipo: 'cliente', contactoId: cli.id,
          fecha: new Date(), detalle: r.detalle || 'Saldo inicial',
          debe: Number(r['importe*'] || r.importe), haber: 0,
          vencimiento: r.vencimiento ? new Date(r.vencimiento) : null,
          categoria: 'saldo_inicial',
        }});
      },
      'saldos-proveedores': async (r) => {
        const key = String(r['cuit_o_razonSocial*'] || r.cuit_o_razonSocial || '');
        const prov = await prisma.proveedor.findFirst({ where: { companyId: req.companyId, OR: [{ cuit: key }, { razonSocial: key }] } });
        if (!prov) throw new Error('Proveedor no encontrado: ' + key);
        return prisma.ctaCte.create({ data: {
          companyId: req.companyId, contactoTipo: 'proveedor', contactoId: prov.id,
          fecha: new Date(), detalle: r.detalle || 'Saldo inicial',
          debe: 0, haber: Number(r['importe*'] || r.importe),
          vencimiento: r.vencimiento ? new Date(r.vencimiento) : null,
          categoria: 'saldo_inicial',
        }});
      },
      'stock-inicial': async (r) => {
        const nombreProd = String(r['producto*'] || r.producto || '');
        const prod = await prisma.producto.findFirst({ where: { companyId: req.companyId, nombre: nombreProd } });
        if (!prod) throw new Error('Producto no encontrado: ' + nombreProd);
        let depositoId = null;
        if (r.deposito && r.deposito !== 'Mi campo') {
          const dep = await prisma.deposito.findFirst({ where: { companyId: req.companyId, nombre: r.deposito } });
          if (!dep) throw new Error('Depósito no encontrado: ' + r.deposito);
          depositoId = dep.id;
        }
        return prisma.movimiento.create({ data: {
          companyId: req.companyId, productoId: prod.id, depositoId,
          fecha: new Date(), tipo: 'ingreso', motivo: 'saldo_inicial',
          cantidad: Number(r['cantidad*'] || r.cantidad),
          precio: r.precio_unit ? Number(r.precio_unit) : null,
          observaciones: r.observaciones || 'Importado desde plantilla',
          userId: req.user?.id || null,
        }});
      },
      'gastos-administrativos': async (r) => {
        const fecha = _parseFechaArg(r['fecha*'] || r.fecha);
        const caja = String(r['caja*'] || r.caja || '').trim();
        const tipo = _normalizar(r['tipo*'] || r.tipo);
        const monto = _parseMonto(r['monto*'] || r.monto);
        if (!fecha) throw new Error('Falta fecha');
        if (!caja) throw new Error('Falta caja');
        if (!['ingreso','egreso'].includes(tipo)) throw new Error('tipo debe ser "ingreso" o "egreso"');
        if (!monto || monto <= 0) throw new Error('monto inválido');
        return prisma.efectivo.create({ data: {
          companyId: req.companyId,
          fecha, tipo, caja,
          monto,
          concepto: r.concepto || 'Gasto administrativo',
          clasificacion: 'empresa',
          observaciones: r.observaciones || 'Importado desde plantilla gastos-administrativos',
        }});
      },
      'gastos-propios': async (r) => {
        const fecha = _parseFechaArg(r['fecha*'] || r.fecha);
        const caja = String(r['caja*'] || r.caja || '').trim();
        const tipo = _normalizar(r['tipo*'] || r.tipo);
        const monto = _parseMonto(r['monto*'] || r.monto);
        const clasifRaw = _normalizar(r.clasificacion || 'empresa');
        // Mapeamos familia/otro → propio (el sistema solo tiene empresa/propio)
        const clasificacion = (clasifRaw === 'empresa') ? 'empresa' : 'propio';
        if (!fecha) throw new Error('Falta fecha');
        if (!caja) throw new Error('Falta caja');
        if (!['ingreso','egreso'].includes(tipo)) throw new Error('tipo debe ser "ingreso" o "egreso"');
        if (!monto || monto <= 0) throw new Error('monto inválido');
        return prisma.efectivo.create({ data: {
          companyId: req.companyId,
          fecha, tipo, caja,
          monto,
          concepto: r.concepto || 'Gasto propio',
          clasificacion,
          observaciones: [r.observaciones, clasifRaw && clasifRaw !== 'empresa' && clasifRaw !== 'propio' && `Subtipo: ${clasifRaw}`].filter(Boolean).join(' · ') || 'Importado',
        }});
      },
      'gastos-empleados': async (r) => {
        const nomEmp = String(r['empleado*'] || r.empleado || '').trim();
        if (!nomEmp) throw new Error('Falta empleado');
        const partes = nomEmp.split(/\s+/);
        const nombre = partes[0];
        const apellido = partes.slice(1).join(' ');
        // Buscar empleado por nombre completo (más tolerante con espacios extra)
        const empleado = await prisma.empleado.findFirst({
          where: {
            companyId: req.companyId,
            OR: [
              { AND: [{ nombre: { equals: nombre, mode: 'insensitive' } }, { apellido: { equals: apellido, mode: 'insensitive' } }] },
              { AND: [{ nombre: { contains: nombre, mode: 'insensitive' } }, { apellido: { contains: apellido, mode: 'insensitive' } }] },
            ],
          },
        });
        if (!empleado) throw new Error('Empleado no encontrado: ' + nomEmp);
        const fecha = _parseFechaArg(r['fecha*'] || r.fecha);
        const tipo = _normalizar(r['tipo*'] || r.tipo);
        const monto = _parseMonto(r['monto*'] || r.monto);
        if (!fecha) throw new Error('Falta fecha');
        if (!['ganancia','gasto'].includes(tipo)) throw new Error('tipo debe ser "ganancia" o "gasto"');
        if (!monto || monto <= 0) throw new Error('monto inválido');
        const periodo = fecha.toISOString().slice(0, 7);
        return prisma.movimientoEmpleado.create({ data: {
          companyId: req.companyId, empleadoId: empleado.id,
          fecha, periodo, tipo,
          categoria: (r.categoria || 'otro').toString().toLowerCase(),
          concepto: r['concepto*'] || r.concepto || 'Importado',
          horas: r.horas ? Number(r.horas) : null,
          valorHora: r.valor_hora ? Number(r.valor_hora) : null,
          monto,
          observaciones: r.observaciones || 'Importado desde plantilla gastos-empleados',
        }});
      },
    };
    const importer = importers[tipo];
    if (!importer) return res.status(400).json({ ok: false, error: 'Importador no implementado para ' + tipo });
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        await importer(r);
        ok++;
      } catch (err) {
        errores.push({ fila: i + 2, error: err.message });
      }
    }
    res.json({ ok: true, importados: ok, fallos: errores.length, errores });
  } catch (e) { next(e); }
});

// === CONTROL DE STOCK ===
// Exporta xlsx con productos × depósitos + columna "Conteo" vacía para que el
// usuario haga el conteo físico y vuelva a subir. Al importar, se generan
// movimientos de ajuste con motivo "control_stock".
app.get('/api/admin/control-stock/exportar', authMiddleware, requireCompany, requirePermission('stock:read'), async (req, res, next) => {
  try {
    const filterCat = req.query.categoria || null;
    const productos = await prisma.producto.findMany({
      where: { companyId: req.companyId, activo: true, ...(filterCat ? { categoria: String(filterCat) } : {}) },
      orderBy: { nombre: 'asc' },
    });
    const depositos = await prisma.deposito.findMany({
      where: { OR: [{ companyId: req.companyId }, { companyId: null, compartido: true }], activo: true },
    });
    const movs = await prisma.movimiento.groupBy({
      by: ['productoId', 'depositoId', 'tipo'],
      where: { companyId: req.companyId },
      _sum: { cantidad: true },
    });
    // Filas: una por (producto × depósito), incluyendo "__campo__" (depositoId null)
    const wb = XLSX.utils.book_new();
    const headers = ['producto*', 'categoria', 'unidad', 'depositoId', 'deposito', 'stockSistema', 'conteo'];
    const aoa = [headers];
    productos.forEach(p => {
      // __campo__ + cada depósito
      const ubics = [{ id: '__campo__', nombre: 'Mi campo', depositoId: '' }, ...depositos.map(d => ({ id: d.id, nombre: d.nombre, depositoId: d.id }))];
      ubics.forEach(u => {
        const ing = movs.filter(m => m.productoId === p.id && (m.depositoId === (u.id === '__campo__' ? null : u.id)) && m.tipo === 'ingreso').reduce((a, m) => a + Number(m._sum?.cantidad || 0), 0);
        const egr = movs.filter(m => m.productoId === p.id && (m.depositoId === (u.id === '__campo__' ? null : u.id)) && m.tipo === 'egreso').reduce((a, m) => a + Number(m._sum?.cantidad || 0), 0);
        const stock = ing - egr;
        if (stock !== 0 || u.id === '__campo__') {
          aoa.push([p.nombre, p.categoria, p.unidad, u.depositoId, u.nombre, stock, '']);
        }
      });
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = headers.map(() => ({ wch: 18 }));
    XLSX.utils.book_append_sheet(wb, ws, 'Datos');
    const wsInfo = XLSX.utils.aoa_to_sheet([
      ['Control de stock'],
      [''],
      ['Instrucciones:'],
      ['1. Imprimí esta planilla y hacé el conteo físico en cada depósito.'],
      ['2. En la columna "conteo" cargá la cantidad REAL encontrada.'],
      ['3. Las filas que no completes (conteo vacío) no generan ajuste.'],
      ['4. Subí el archivo al sistema y se generan movimientos de ajuste'],
      ['   con motivo "control_stock" para igualar el sistema al conteo real.'],
      ['5. Cada ajuste queda firmado con tu usuario y la fecha actual.'],
    ]);
    wsInfo['!cols'] = [{ wch: 100 }];
    XLSX.utils.book_append_sheet(wb, wsInfo, 'Instrucciones');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="control-stock-${stamp}.xlsx"`);
    res.end(buf);
  } catch (e) { next(e); }
});

app.post('/api/admin/control-stock/importar', authMiddleware, requireCompany, requirePermission('stock:update'), upload.single('archivo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Falta el archivo' });
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames.find(n => /datos/i.test(n)) || wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
    let ajustes = 0, sinCambio = 0, sinConteo = 0;
    const errores = [];
    const fecha = new Date();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        const conteo = r.conteo;
        if (conteo === null || conteo === undefined || conteo === '') { sinConteo++; continue; }
        const stockSistema = Number(r.stockSistema || 0);
        const conteoNum = Number(conteo);
        const diff = conteoNum - stockSistema;
        if (diff === 0) { sinCambio++; continue; }
        const nombreProd = r['producto*'] || r.producto;
        const prod = await prisma.producto.findFirst({ where: { companyId: req.companyId, nombre: nombreProd } });
        if (!prod) throw new Error('Producto no encontrado: ' + nombreProd);
        const depositoId = r.depositoId ? String(r.depositoId) : null;
        // tipo según signo
        const tipo = diff > 0 ? 'ingreso' : 'egreso';
        await prisma.movimiento.create({ data: {
          companyId: req.companyId, productoId: prod.id, depositoId,
          fecha, tipo, motivo: 'control_stock',
          cantidad: Math.abs(diff),
          observaciones: `Ajuste por control de stock — sistema: ${stockSistema}, conteo: ${conteoNum}`,
          userId: req.user?.id || null,
        }});
        ajustes++;
      } catch (err) {
        errores.push({ fila: i + 2, error: err.message });
      }
    }
    res.json({ ok: true, ajustes, sinCambio, sinConteo, fallos: errores.length, errores });
  } catch (e) { next(e); }
});

// ============================================================
// AGENDA / RECORDATORIOS
// ============================================================
// La Agenda muestra DOS tipos de recordatorios:
//   1) Manuales: cargados por el usuario en la tabla "Recordatorio".
//   2) Automáticos: extraídos al vuelo de CuotaCredito + Cheque + CtaCte.
//      No se guardan en DB. Tienen id "auto:cuota:xxx" / "auto:cheque:xxx" /
//      "auto:ctacte:xxx" y origen='auto'. Si el usuario quiere ocultarlos,
//      guardamos un registro en RecordatorioOculto y dejan de aparecer.
async function _construirRecordatoriosAuto(companyId, opts = {}) {
  const horizonteDias = opts.horizonteDias != null ? opts.horizonteDias : 365; // hasta 1 año adelante por default
  const incluirVencidos = opts.incluirVencidos !== false;
  const today = new Date(); today.setHours(0,0,0,0);
  const limiteFuturo = new Date(today); limiteFuturo.setDate(limiteFuturo.getDate() + horizonteDias);

  // Ocultos
  const ocultos = await prisma.recordatorioOculto.findMany({ where: { companyId } });
  const setOcultos = new Set(ocultos.map(o => `${o.refTipo}:${o.refId}`));

  const items = [];

  // 1) Cuotas de crédito pendientes
  const cuotas = await prisma.cuotaCredito.findMany({
    where: {
      pagada: false,
      credito: { companyId },
      vencimiento: { lte: limiteFuturo },
    },
    include: { credito: true },
    orderBy: { vencimiento: 'asc' },
  });
  for (const c of cuotas) {
    if (setOcultos.has(`cuota_credito:${c.id}`)) continue;
    const venc = new Date(c.vencimiento); venc.setHours(0,0,0,0);
    if (!incluirVencidos && venc < today) continue;
    items.push({
      id: `auto:cuota:${c.id}`,
      origen: 'auto',
      autoTipo: 'cuota_credito',
      autoRefId: c.id,
      titulo: `Cuota ${c.numero} crédito ${c.credito.banco || c.credito.entidad || ''}`.trim(),
      descripcion: `Importe: $${(c.importeTotal||0).toFixed(2)} · ${c.credito.descripcion || ''}`.trim(),
      fecha: c.vencimiento,
      categoria: 'credito',
      prioridad: 'media',
      avisarDiasAntes: 15,
      completado: false,
      repetir: 'ninguno',
      relacionTipo: 'credito',
      relacionId: c.creditoId,
    });
  }

  // 2) Cheques propios con fecha de pago próxima (no cobrados/rechazados)
  const cheques = await prisma.cheque.findMany({
    where: {
      companyId,
      tipo: 'propio',
      estado: { notIn: ['cobrado','rechazado'] },
      fechaPago: { lte: limiteFuturo },
    },
    orderBy: { fechaPago: 'asc' },
  });
  for (const ch of cheques) {
    if (setOcultos.has(`cheque:${ch.id}`)) continue;
    const fp = new Date(ch.fechaPago); fp.setHours(0,0,0,0);
    if (!incluirVencidos && fp < today) continue;
    items.push({
      id: `auto:cheque:${ch.id}`,
      origen: 'auto',
      autoTipo: 'cheque',
      autoRefId: ch.id,
      titulo: `Cheque propio Nro ${ch.nroCheque}${ch.banco?` (${ch.banco})`:''}`,
      descripcion: `Beneficiario: ${ch.beneficiario||'-'} · $${(ch.monto||0).toFixed(2)}`,
      fecha: ch.fechaPago,
      categoria: 'vencimiento',
      prioridad: 'media',
      avisarDiasAntes: 15,
      completado: false,
      repetir: 'ninguno',
      relacionTipo: 'cheque',
      relacionId: ch.id,
    });
  }

  // 2b) Cheques pendientes de resolución: aviso 7 DÍAS DESPUÉS del vencimiento
  //     para recordar revisar si finalmente se pagó o se rechazó.
  const chequesRevisar = await prisma.cheque.findMany({
    where: {
      companyId,
      estado: { notIn: ['cobrado', 'rechazado', 'anulado'] },
      fechaPago: { lte: limiteFuturo },
    },
    orderBy: { fechaPago: 'asc' },
  });
  for (const ch of chequesRevisar) {
    if (setOcultos.has(`cheque_revisar:${ch.id}`)) continue;
    const fr = new Date(ch.fechaPago); fr.setDate(fr.getDate() + 7); fr.setHours(0, 0, 0, 0);
    if (fr > limiteFuturo) continue;
    if (!incluirVencidos && fr < today) continue;
    items.push({
      id: `auto:cheque_revisar:${ch.id}`,
      origen: 'auto',
      autoTipo: 'cheque_revisar',
      autoRefId: ch.id,
      titulo: `Revisar cheque Nº ${ch.nroCheque}${ch.banco ? ` (${ch.banco})` : ''}: ¿se pagó o se rechazó?`,
      descripcion: `${ch.tipo === 'propio' ? 'Propio' : 'Terceros'} · venció ${new Date(ch.fechaPago).toLocaleDateString('es-AR')} · $${(ch.monto || 0).toFixed(2)}`,
      fecha: fr.toISOString(),
      categoria: 'vencimiento',
      prioridad: 'alta',
      avisarDiasAntes: 0,
      completado: false,
      repetir: 'ninguno',
      relacionTipo: 'cheque',
      relacionId: ch.id,
    });
  }

  // 3) CtaCte con vencimiento (facturas pendientes + libres) — debe > haber pagado
  const ctas = await prisma.ctaCte.findMany({
    where: {
      companyId,
      vencimiento: { not: null, lte: limiteFuturo },
      pagado: false,
    },
    orderBy: { vencimiento: 'asc' },
  });
  // Cargar contactos para nombres
  const clienteIds = [...new Set(ctas.filter(c => c.contactoTipo==='cliente' && c.contactoId).map(c => c.contactoId))];
  const provIds    = [...new Set(ctas.filter(c => c.contactoTipo==='proveedor' && c.contactoId).map(c => c.contactoId))];
  const [clientes, proveedores] = await Promise.all([
    clienteIds.length ? prisma.cliente.findMany({ where: { id: { in: clienteIds } } }) : Promise.resolve([]),
    provIds.length    ? prisma.proveedor.findMany({ where: { id: { in: provIds } } }) : Promise.resolve([]),
  ]);
  const mapCli = Object.fromEntries(clientes.map(x => [x.id, x.razonSocial || x.nombre || '']));
  const mapPrv = Object.fromEntries(proveedores.map(x => [x.id, x.razonSocial || x.nombre || '']));
  for (const c of ctas) {
    if (setOcultos.has(`ctacte:${c.id}`)) continue;
    const v = new Date(c.vencimiento); v.setHours(0,0,0,0);
    if (!incluirVencidos && v < today) continue;
    const monto = Math.max(c.debe || 0, c.haber || 0);
    let contactoNombre = c.nombreLibre || '';
    if (c.contactoTipo === 'cliente' && mapCli[c.contactoId]) contactoNombre = mapCli[c.contactoId];
    else if (c.contactoTipo === 'proveedor' && mapPrv[c.contactoId]) contactoNombre = mapPrv[c.contactoId];
    const esCobrar = c.contactoTipo === 'cliente' || (c.debe || 0) > 0 && c.contactoTipo !== 'proveedor';
    const verbo = c.contactoTipo === 'proveedor' ? 'Pagar a' : c.contactoTipo === 'cliente' ? 'Cobrar de' : 'Vence';
    items.push({
      id: `auto:ctacte:${c.id}`,
      origen: 'auto',
      autoTipo: 'ctacte',
      autoRefId: c.id,
      titulo: `${verbo} ${contactoNombre || c.detalle}`.trim(),
      descripcion: `${c.detalle} · $${monto.toFixed(2)}${c.categoria?` · ${c.categoria}`:''}`,
      fecha: c.vencimiento,
      categoria: 'vencimiento',
      prioridad: 'media',
      avisarDiasAntes: 15,
      completado: false,
      repetir: 'ninguno',
      relacionTipo: 'ctacte',
      relacionId: c.id,
    });
  }

  // 4) Arrendamientos: vencimiento de cada cuota no pagada (o del contrato si no
  //    tiene cuotas). Los arrendamientos NO se limitan al horizonte porque suelen
  //    ser anuales (a cosecha), y el usuario quiere verlos aunque falte más de 1 año.
  const arrends = await prisma.arrendamiento.findMany({
    where: { companyId, pagado: false },
    include: { campo: { select: { nombre: true } } },
  });
  const _cotRowsA = await prisma.cotizacion.findMany({ where: { companyId: null }, orderBy: { fecha: 'desc' } });
  const _cotA = {}; for (const cr of _cotRowsA) { if (_cotA[cr.moneda] == null) _cotA[cr.moneda] = Number(cr.valor || 0); }
  for (const [k, v] of Object.entries(_liveCotizMap())) { if (_cotA[k] == null || !_cotA[k]) _cotA[k] = v; }
  const _cotOf = (mon) => (!mon || mon === 'ARS') ? 1 : Number(_cotA[mon] || 0);
  for (const a of arrends) {
    const mod = a.modalidad || (a.tipoPago === 'En especie' ? 'quintales' : (a.tipoPago === 'Porcentual' ? 'porcentaje' : (a.tipoPago === 'Kg Novillo' ? 'kgnovillo' : 'efectivo')));
    if (mod === 'porcentaje') continue; // depende del rinde
    const ha = Number(a.hectareas || 0);
    const nombreBase = `${a.propietario || ''}${a.campo?.nombre ? ' · ' + a.campo.nombre : ''}`.trim();
    const descDe = (c) => {
      if (mod === 'quintales') { const ars = Number(c.quintalesHa||0)*ha*0.1*_cotOf(_claveGrano(a.grano)); return `${Number(c.quintalesHa||0)} qq/ha${ars?` · ≈ $${Math.round(ars).toLocaleString('es-AR')}`:''}`; }
      if (mod === 'kgnovillo') { const ars = Number(c.kgNovillo||0)*_cotOf('KGN'); return `${Number(c.kgNovillo||0)} kg novillo${ars?` · ≈ $${Math.round(ars).toLocaleString('es-AR')}`:''}`; }
      const ars = Number(c.importe||0)*_cotOf(a.moneda||'ARS'); return `$${Math.round(ars).toLocaleString('es-AR')}`;
    };
    const empujar = (fechaISO, refId, etiqueta, desc) => {
      if (!fechaISO) return;
      if (setOcultos.has(`arrendamiento:${refId}`)) return;
      const v = new Date(fechaISO); v.setHours(0,0,0,0);
      if (!incluirVencidos && v < today) return;   // sin tope futuro: los arrendamientos siempre se muestran
      items.push({
        id: `auto:arrendamiento:${refId}`,
        origen: 'auto', autoTipo: 'arrendamiento', autoRefId: refId,
        titulo: `Arrendamiento ${nombreBase}${etiqueta ? ' · ' + etiqueta : ''}`.trim(),
        descripcion: desc, fecha: fechaISO,
        categoria: 'vencimiento', prioridad: 'media', avisarDiasAntes: 15,
        completado: false, repetir: 'ninguno', relacionTipo: 'arrendamiento', relacionId: a.id,
      });
    };
    const cuotasArr = Array.isArray(a.cuotas) ? a.cuotas : [];
    const pend = cuotasArr.map((c, idx) => ({ c, idx })).filter(x => !x.c.pagado && x.c.vencimiento);
    if (pend.length) {
      for (const { c, idx } of pend) empujar(c.vencimiento, `${a.id}:${idx}`, c.etiqueta || `Cuota ${idx + 1}`, `Vence cuota · ${descDe(c)}`);
    } else if (a.vencimiento && !cuotasArr.length) {
      const desc = mod === 'efectivo'
        ? `$${Math.round(ha * Number(a.importeHa || 0) * _cotOf(a.moneda || 'ARS')).toLocaleString('es-AR')}`
        : 'Vencimiento de arrendamiento';
      empujar(a.vencimiento, a.id, '', desc);
    }
  }

  return items;
}

app.get('/api/recordatorios', requireCompany, requirePermission('agenda:read'), async (req, res, next) => {
  try {
    const { estado = 'pendiente', desde, hasta } = req.query;
    const where = { companyId: req.companyId };
    if (estado === 'pendiente') where.completado = false;
    else if (estado === 'completado') where.completado = true;
    if (desde || hasta) {
      where.fecha = {};
      if (desde) where.fecha.gte = new Date(desde);
      if (hasta) where.fecha.lte = new Date(hasta);
    }
    const manuales = await prisma.recordatorio.findMany({ where, orderBy: { fecha: 'asc' } });
    const manualesConOrigen = manuales.map(r => ({ ...r, origen: 'manual' }));
    // Los completados no muestran automáticos (no aplica)
    let autos = [];
    if (estado !== 'completado') {
      autos = await _construirRecordatoriosAuto(req.companyId, {});
      if (desde || hasta) {
        autos = autos.filter(a => {
          const f = new Date(a.fecha);
          if (desde && f < new Date(desde)) return false;
          if (hasta && f > new Date(hasta)) return false;
          return true;
        });
      }
    }
    const all = [...manualesConOrigen, ...autos].sort((a,b) => new Date(a.fecha) - new Date(b.fecha));
    res.json({ ok: true, data: all });
  } catch (e) { next(e); }
});

app.get('/api/recordatorios/alertas', requireCompany, requirePermission('agenda:read'), async (req, res, next) => {
  try {
    const today = new Date(); today.setHours(0,0,0,0);
    const manuales = await prisma.recordatorio.findMany({
      where: { companyId: req.companyId, completado: false },
      orderBy: { fecha: 'asc' },
    });
    const autos = await _construirRecordatoriosAuto(req.companyId, {});
    const all = [
      ...manuales.map(r => ({ ...r, origen: 'manual' })),
      ...autos,
    ];
    const alertas = all.filter(r => {
      const f = new Date(r.fecha); f.setHours(0,0,0,0);
      const diasRestantes = Math.round((f.getTime() - today.getTime()) / (1000*60*60*24));
      return diasRestantes <= (r.avisarDiasAntes || 15);
    }).map(r => {
      const f = new Date(r.fecha); f.setHours(0,0,0,0);
      const diasRestantes = Math.round((f.getTime() - today.getTime()) / (1000*60*60*24));
      return { ...r, diasRestantes };
    }).sort((a,b) => a.diasRestantes - b.diasRestantes);
    res.json({ ok: true, data: alertas });
  } catch (e) { next(e); }
});

// Calendario consolidado de TODAS las empresas del usuario (o todas si superAdmin).
// Cada evento viene etiquetado con la empresa y un color estable, y se devuelve
// una "leyenda" con el par empresa/color para pintar la UI. No usa requireCompany
// porque es una vista transversal a varias empresas.
const CAL_COLORES_EMPRESA = [
  '#15803d', '#b45309', '#1d4ed8', '#7c3aed', '#be123c', '#0891b2',
  '#ca8a04', '#4d7c0f', '#c026d3', '#0f766e', '#9f1239', '#4338ca',
];
app.get('/api/recordatorios/todas-empresas', async (req, res, next) => {
  try {
    const { estado = 'pendiente', desde, hasta } = req.query;

    // Empresas accesibles: superAdmin ve todas las activas; el resto, solo
    // aquellas donde su rol tiene permiso de agenda:read.
    let empresas;
    if (req.user.superAdmin) {
      empresas = await prisma.company.findMany({ where: { activo: true }, orderBy: { name: 'asc' } });
    } else {
      empresas = (req.user.userCompanies || [])
        .filter((uc) => hasPermission(uc.role?.permissions || [], 'agenda:read'))
        .map((uc) => uc.company)
        .filter(Boolean)
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }

    const leyenda = empresas.map((emp, i) => ({
      companyId: emp.id,
      companyName: emp.name,
      color: CAL_COLORES_EMPRESA[i % CAL_COLORES_EMPRESA.length],
    }));
    const colorDe = new Map(leyenda.map((l) => [l.companyId, l.color]));

    const out = [];
    for (const emp of empresas) {
      const color = colorDe.get(emp.id);
      // Manuales
      const where = { companyId: emp.id };
      if (estado === 'pendiente') where.completado = false;
      else if (estado === 'completado') where.completado = true;
      if (desde || hasta) {
        where.fecha = {};
        if (desde) where.fecha.gte = new Date(desde);
        if (hasta) where.fecha.lte = new Date(hasta);
      }
      const manuales = await prisma.recordatorio.findMany({ where, orderBy: { fecha: 'asc' } });
      for (const r of manuales) {
        out.push({ ...r, origen: 'manual', companyId: emp.id, companyName: emp.name, companyColor: color });
      }
      // Automáticos (no aplican a "completado")
      if (estado !== 'completado') {
        let autos = await _construirRecordatoriosAuto(emp.id, {});
        if (desde || hasta) {
          autos = autos.filter((a) => {
            const f = new Date(a.fecha);
            if (desde && f < new Date(desde)) return false;
            if (hasta && f > new Date(hasta)) return false;
            return true;
          });
        }
        for (const a of autos) {
          out.push({ ...a, companyId: emp.id, companyName: emp.name, companyColor: color });
        }
      }
    }
    out.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
    res.json({ ok: true, data: out, empresas: leyenda });
  } catch (e) { next(e); }
});

const recordatorioSchema = z.object({
  titulo: z.string().min(1),
  descripcion: z.string().nullable().optional(),
  fecha: z.coerce.date(),
  categoria: z.enum(['vacunacion','credito','vencimiento','campania','impuesto','evento','otro']).optional(),
  prioridad: z.enum(['alta','media','baja']).optional(),
  avisarDiasAntes: z.number().int().min(0).max(365).optional(),
  relacionTipo: z.string().nullable().optional(),
  relacionId: z.string().nullable().optional(),
  repetir: z.enum(['ninguno','mensual','anual']).optional(),
});

app.post('/api/recordatorios', requireCompany, requirePermission('agenda:create'), async (req, res, next) => {
  try {
    const input = recordatorioSchema.parse(req.body);
    const r = await prisma.recordatorio.create({
      data: { ...input, companyId: req.companyId, userIdCreador: req.user?.id || null },
    });
    res.status(201).json({ ok: true, data: r });
  } catch (e) { next(e); }
});

app.put('/api/recordatorios/:id', requireCompany, requirePermission('agenda:update'), async (req, res, next) => {
  try {
    const existing = await prisma.recordatorio.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    const input = recordatorioSchema.partial().parse(req.body);
    const r = await prisma.recordatorio.update({ where: { id: req.params.id }, data: input });
    res.json({ ok: true, data: r });
  } catch (e) { next(e); }
});

app.post('/api/recordatorios/:id/completar', requireCompany, requirePermission('agenda:update'), async (req, res, next) => {
  try {
    const id = req.params.id;
    // Auto-generado: lo ocultamos (el "completado real" se maneja en el módulo original)
    if (id.startsWith('auto:')) {
      const parts = id.split(':');
      if (parts.length < 3) return res.status(400).json({ ok: false, error: 'ID inválido' });
      const refTipo = parts[1] === 'cuota' ? 'cuota_credito' : parts[1];
      const refId = parts.slice(2).join(':');
      await prisma.recordatorioOculto.upsert({
        where: { companyId_refTipo_refId: { companyId: req.companyId, refTipo, refId } },
        create: { companyId: req.companyId, refTipo, refId },
        update: { ocultadoEn: new Date() },
      });
      return res.json({ ok: true, oculto: true });
    }
    const existing = await prisma.recordatorio.findFirst({ where: { id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    let nuevaFecha = null;
    if (existing.repetir === 'mensual') {
      nuevaFecha = new Date(existing.fecha);
      nuevaFecha.setMonth(nuevaFecha.getMonth() + 1);
    } else if (existing.repetir === 'anual') {
      nuevaFecha = new Date(existing.fecha);
      nuevaFecha.setFullYear(nuevaFecha.getFullYear() + 1);
    }
    const r = nuevaFecha
      ? await prisma.recordatorio.update({ where: { id }, data: { fecha: nuevaFecha, completado: false, completadoEn: null } })
      : await prisma.recordatorio.update({ where: { id }, data: { completado: true, completadoEn: new Date() } });
    res.json({ ok: true, data: r });
  } catch (e) { next(e); }
});

app.delete('/api/recordatorios/:id', requireCompany, requirePermission('agenda:delete'), async (req, res, next) => {
  try {
    const id = req.params.id;
    // Auto-generado: lo ocultamos (no borramos el origen)
    if (id.startsWith('auto:')) {
      const parts = id.split(':'); // auto:tipo:realId
      if (parts.length < 3) return res.status(400).json({ ok: false, error: 'ID inválido' });
      const refTipo = parts[1] === 'cuota' ? 'cuota_credito' : parts[1];
      const refId = parts.slice(2).join(':');
      await prisma.recordatorioOculto.upsert({
        where: { companyId_refTipo_refId: { companyId: req.companyId, refTipo, refId } },
        create: { companyId: req.companyId, refTipo, refId },
        update: { ocultadoEn: new Date() },
      });
      return res.json({ ok: true, oculto: true });
    }
    const existing = await prisma.recordatorio.findFirst({ where: { id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    await prisma.recordatorio.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Restaurar un recordatorio automático previamente ocultado
app.post('/api/recordatorios/restaurar-auto', requireCompany, requirePermission('agenda:update'), async (req, res, next) => {
  try {
    const { refTipo, refId } = req.body || {};
    if (!refTipo || !refId) return res.status(400).json({ ok: false, error: 'Faltan refTipo y refId' });
    await prisma.recordatorioOculto.deleteMany({ where: { companyId: req.companyId, refTipo, refId } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});


// ============================================================
// CARTAS DE PORTE ELECTRÓNICAS (CPE / WSCPE de ARCA)
// ============================================================
// Implementación pragmática:
//   - En modo "homo" sin certificado real, devolvemos respuestas MOCK
//     (CTG empieza con "99" para distinguir de reales).
//   - En modo "homo" con cert real, llamamos al WSCPE de homologación de ARCA.
//   - En modo "prod" exigimos cert real y llamamos al WSCPE productivo.
//
// El WSCPE expone (entre otros):
//   - dummy                — health check (auth/db/serv)
//   - autorizarCPEAutomotor — alta de CPE para camión
//   - consultarCPEAutomotor — estado del CPE por nroCTG
//   - confirmarArriboCPE   — confirma que el cereal llegó al destino
//   - anularCPE            — anula un CPE emitido
//
// Las funciones devuelven { ok, ctg, comprobante, mensaje, mock?: bool, raw? }.

function _cpeMockCtg() {
  // CTG mock: empieza con 99 y son 12 dígitos en total
  return '99' + Math.floor(1e9 + Math.random() * 9e9).toString().slice(0, 10);
}

async function _arcaWsCpeCall({ companyId, modo, operacion, bodyXmlInner }) {
  // Si no hay cert configurado o el modo es homo, intentamos primero el WS real,
  // pero si falla por configuración, caemos a mock para no bloquear pruebas.
  const c = await prisma.company.findUnique({
    where: { id: companyId },
    select: { arcaCuit: true, arcaCertCrt: true, arcaPrivadaKey: true },
  });
  const tieneCert = !!(c?.arcaCertCrt && c?.arcaPrivadaKey && c?.arcaCuit);
  if (!tieneCert) {
    if (modo === 'prod') {
      throw new Error('Para emitir CPE en producción tenés que configurar el certificado de ARCA en Configuración → ARCA.');
    }
    // MOCK
    return { __mock: true };
  }
  let token, sign;
  try {
    const ta = await _getTAforService({ companyId, modo, service: 'wsctg' });
    token = ta.token; sign = ta.sign;
  } catch (e) {
    if (modo === 'homo') return { __mock: true, __mockReason: 'WSAA: ' + e.message };
    throw e;
  }
  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cpe="http://impl.service.wscpe.afip.gov/wscpe/">
  <soapenv:Header/>
  <soapenv:Body>
    <cpe:${operacion}>
      <cpe:request>
        <cpe:auth>
          <cpe:token>${_arcaXmlEsc(token)}</cpe:token>
          <cpe:sign>${_arcaXmlEsc(sign)}</cpe:sign>
          <cpe:cuitRepresentado>${_arcaXmlEsc(c.arcaCuit)}</cpe:cuitRepresentado>
        </cpe:auth>
        ${bodyXmlInner}
      </cpe:request>
    </cpe:${operacion}>
  </soapenv:Body>
</soapenv:Envelope>`;
  let res, xml;
  try {
    res = await fetch(_arcaUrl('wscpe', modo), {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '' },
      body: envelope,
    });
    xml = await res.text();
  } catch (e) {
    if (modo === 'homo') return { __mock: true, __mockReason: 'WSCPE conn: ' + e.message };
    throw new Error('No se pudo conectar a WSCPE: ' + e.message);
  }
  if (!res.ok) {
    const f = _arcaXmlGet(xml, 'faultstring') || xml.slice(0, 400);
    if (modo === 'homo') return { __mock: true, __mockReason: `WSCPE ${res.status}: ${f}` };
    throw new Error(`WSCPE error ${res.status}: ${f}`);
  }
  return { xml };
}

async function _arcaAutorizarCPE({ companyId, modo, viaje }) {
  // Construye el body XML típico de autorizarCPEAutomotor.
  // En la práctica el body real es enorme; armamos los campos mínimos.
  const body = `
        <cpe:solicitud>
          <cpe:tipoCPE>74</cpe:tipoCPE>
          <cpe:cuitSolicitante>${_arcaXmlEsc(viaje.cpeOrigenCuit || '')}</cpe:cuitSolicitante>
          <cpe:nroOrden>${_arcaXmlEsc(viaje.id.slice(-8))}</cpe:nroOrden>
          <cpe:planta>${_arcaXmlEsc(viaje.cpeOrigenRenspa || '')}</cpe:planta>
          <cpe:datosCarga>
            <cpe:codigoGrano>${_arcaXmlEsc(viaje.producto || '')}</cpe:codigoGrano>
            <cpe:cosecha>${new Date().getFullYear()}</cpe:cosecha>
            <cpe:pesoNeto>${_arcaXmlEsc(String(Math.round(viaje.cantidad || 0)))}</cpe:pesoNeto>
          </cpe:datosCarga>
          <cpe:destino>
            <cpe:cuit>${_arcaXmlEsc(viaje.cpeDestinoCuit || '')}</cpe:cuit>
          </cpe:destino>
          <cpe:transportista>
            <cpe:cuit>${_arcaXmlEsc(viaje.transporteCuit || '')}</cpe:cuit>
          </cpe:transportista>
          <cpe:chofer>
            <cpe:cuit>${_arcaXmlEsc(viaje.choferCuit || '')}</cpe:cuit>
          </cpe:chofer>
          <cpe:dominio>${_arcaXmlEsc(viaje.patente || '')}</cpe:dominio>
        </cpe:solicitud>`;
  const r = await _arcaWsCpeCall({ companyId, modo, operacion: 'autorizarCPEAutomotor', bodyXmlInner: body });
  if (r.__mock) {
    const ctg = _cpeMockCtg();
    return {
      ok: true, mock: true, mockReason: r.__mockReason || 'Sin certificado real',
      ctg,
      comprobante: 'A' + String(Math.floor(Math.random()*999999)).padStart(6,'0'),
      mensaje: 'CPE emitida en modo simulado (homologación / mock). Cuando configures el certificado real, el sistema usará el WS real de ARCA.',
    };
  }
  // Parseo de respuesta real
  const ctg = _arcaXmlGet(r.xml, 'nroCTG') || _arcaXmlGet(r.xml, 'CTG');
  const comp = _arcaXmlGet(r.xml, 'nroComprobante') || _arcaXmlGet(r.xml, 'numeroComprobante');
  const errDsc = _arcaXmlGet(r.xml, 'descripcion');
  const errCod = _arcaXmlGet(r.xml, 'codigo');
  if (!ctg) throw new Error(`ARCA WSCPE: ${errCod || ''} ${errDsc || 'sin CTG en respuesta'}`.trim());
  return { ok: true, mock: false, ctg, comprobante: comp, mensaje: 'CPE autorizada por ARCA', raw: r.xml.slice(0, 2000) };
}

async function _arcaConsultarCPE({ companyId, modo, nroCtg }) {
  const body = `<cpe:nroCTG>${_arcaXmlEsc(nroCtg)}</cpe:nroCTG>`;
  const r = await _arcaWsCpeCall({ companyId, modo, operacion: 'consultarCPEAutomotor', bodyXmlInner: body });
  if (r.__mock) {
    return { ok: true, mock: true, ctg: nroCtg, estado: 'EMITIDA', mensaje: 'Consulta simulada (sin cert real)' };
  }
  const estado = _arcaXmlGet(r.xml, 'estado') || 'DESCONOCIDO';
  return { ok: true, mock: false, ctg: nroCtg, estado, raw: r.xml.slice(0, 2000) };
}

async function _arcaConfirmarArriboCPE({ companyId, modo, nroCtg, kgDescarga }) {
  const body = `
        <cpe:nroCTG>${_arcaXmlEsc(nroCtg)}</cpe:nroCTG>
        <cpe:pesoNetoDescargado>${_arcaXmlEsc(String(Math.round(kgDescarga||0)))}</cpe:pesoNetoDescargado>`;
  const r = await _arcaWsCpeCall({ companyId, modo, operacion: 'confirmarArriboCPE', bodyXmlInner: body });
  if (r.__mock) {
    return { ok: true, mock: true, mensaje: 'Arribo confirmado en modo simulado' };
  }
  const errDsc = _arcaXmlGet(r.xml, 'descripcion');
  if (errDsc) return { ok: true, mensaje: errDsc };
  return { ok: true, mensaje: 'Arribo confirmado', raw: r.xml.slice(0,1000) };
}

async function _arcaAnularCPE({ companyId, modo, nroCtg, motivo }) {
  const body = `
        <cpe:nroCTG>${_arcaXmlEsc(nroCtg)}</cpe:nroCTG>
        <cpe:motivo>${_arcaXmlEsc(motivo || 'Anulación solicitada por el emisor')}</cpe:motivo>`;
  const r = await _arcaWsCpeCall({ companyId, modo, operacion: 'anularCPE', bodyXmlInner: body });
  if (r.__mock) return { ok: true, mock: true, mensaje: 'CPE anulada en modo simulado' };
  return { ok: true, mensaje: 'CPE anulada', raw: r.xml.slice(0,1000) };
}

// ===== Endpoints REST CPE =====
// Heartbeat WSCPE (dummy)
app.get('/api/arca/cpe/probar', authMiddleware, requireCompany, requirePermission('logistica:read'), async (req, res, next) => {
  try {
    const c = await prisma.company.findUnique({ where: { id: req.companyId }, select: { arcaModo: true, arcaCuit: true, arcaCertCrt: true } });
    const modo = c?.arcaModo === 'homo' ? 'homo' : 'prod';
    if (!c?.arcaCertCrt) {
      return res.json({ ok: true, modo, simulado: true, mensaje: 'Sin certificado cargado. En modo homologación las CPE se generan simuladas (mock). Configurá el certificado en Configuración → ARCA para usar el WS real.' });
    }
    res.json({ ok: true, modo, simulado: false, mensaje: 'Certificado presente. El sistema llamará al WSCPE real cuando emitas una CPE.' });
  } catch (e) { next(e); }
});

// Modificar datos CPE de un viaje (sólo los campos del módulo CPE — no toca el CTG ni el estado)
app.put('/api/viajes/:id/cpe', authMiddleware, requireCompany, requirePermission('logistica:update'), async (req, res, next) => {
  try {
    const viaje = await prisma.viaje.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!viaje) return res.status(404).json({ ok: false, error: 'Viaje no encontrado' });
    const datos = req.body || {};
    const ALLOW = ['cpeOrigenCuit','cpeOrigenRenspa','cpeDestinoCuit','cpeDestinatarioCuit','cpeCorredorCuit','cpeIntermediarioCuit','cpeObservaciones','cpeTipo'];
    const update = {};
    for (const k of ALLOW) if (datos[k] !== undefined) update[k] = datos[k] || null;
    const r = await prisma.viaje.update({ where: { id: viaje.id }, data: update });
    res.json({ ok: true, data: r });
  } catch (e) { next(e); }
});

// Eliminar la CPE del viaje en AgroCore (NO la anula en ARCA — si querés anular usá /anular).
// Limpia todos los campos cpe* dejando el viaje sin CPE asociada.
app.delete('/api/viajes/:id/cpe', authMiddleware, requireCompany, requirePermission('logistica:update'), async (req, res, next) => {
  try {
    const viaje = await prisma.viaje.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!viaje) return res.status(404).json({ ok: false, error: 'Viaje no encontrado' });
    const r = await prisma.viaje.update({ where: { id: viaje.id }, data: {
      cpeTipo: null, cpeNroCtg: null, cpeNroComprobante: null, cpeEstado: null,
      cpeFechaEmision: null, cpeFechaArribo: null, cpeFechaAnulacion: null, cpeMotivoAnulacion: null,
      cpePdfUrl: null, cpeRespuestaArca: null,
    }});
    res.json({ ok: true, data: r });
  } catch (e) { next(e); }
});

// Emitir CPE para un viaje
app.post('/api/viajes/:id/cpe/emitir', authMiddleware, requireCompany, requirePermission('logistica:update'), async (req, res, next) => {
  try {
    const viaje = await prisma.viaje.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!viaje) return res.status(404).json({ ok: false, error: 'Viaje no encontrado' });
    if (viaje.cpeNroCtg && viaje.cpeEstado !== 'anulada') {
      return res.status(400).json({ ok: false, error: 'Este viaje ya tiene una CPE emitida (CTG ' + viaje.cpeNroCtg + '). Anulala antes de emitir una nueva.' });
    }
    // Tomamos datos extra del body si vienen
    const datos = req.body || {};
    const viajeAct = await prisma.viaje.update({ where: { id: viaje.id }, data: {
      cpeOrigenCuit: datos.cpeOrigenCuit || viaje.cpeOrigenCuit,
      cpeOrigenRenspa: datos.cpeOrigenRenspa || viaje.cpeOrigenRenspa,
      cpeDestinoCuit: datos.cpeDestinoCuit || viaje.cpeDestinoCuit,
      cpeDestinatarioCuit: datos.cpeDestinatarioCuit || viaje.cpeDestinatarioCuit,
      cpeCorredorCuit: datos.cpeCorredorCuit || viaje.cpeCorredorCuit,
      cpeIntermediarioCuit: datos.cpeIntermediarioCuit || viaje.cpeIntermediarioCuit,
      cpeObservaciones: datos.cpeObservaciones || viaje.cpeObservaciones,
      cpeTipo: 'automotor',
    }});
    const company = await prisma.company.findUnique({ where: { id: req.companyId }, select: { arcaModo: true } });
    const modo = company?.arcaModo === 'homo' ? 'homo' : 'prod';
    const r = await _arcaAutorizarCPE({ companyId: req.companyId, modo, viaje: viajeAct });
    const final = await prisma.viaje.update({ where: { id: viaje.id }, data: {
      cpeNroCtg: r.ctg,
      cpeNroComprobante: r.comprobante || null,
      cpeEstado: 'emitida',
      cpeFechaEmision: new Date(),
      cpeRespuestaArca: r,
      // Espejamos en los campos legacy del Viaje para que aparezcan en el listado y exports
      ctg: r.ctg,
      cartaPorte: r.comprobante || viaje.cartaPorte || r.ctg,
    }});
    res.json({ ok: true, data: final, info: r });
  } catch (e) { next(e); }
});

// Consultar estado en ARCA
app.get('/api/viajes/:id/cpe/consultar', authMiddleware, requireCompany, requirePermission('logistica:read'), async (req, res, next) => {
  try {
    const viaje = await prisma.viaje.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!viaje) return res.status(404).json({ ok: false, error: 'Viaje no encontrado' });
    if (!viaje.cpeNroCtg) return res.status(400).json({ ok: false, error: 'Este viaje no tiene CPE emitida' });
    const company = await prisma.company.findUnique({ where: { id: req.companyId }, select: { arcaModo: true } });
    const modo = company?.arcaModo === 'homo' ? 'homo' : 'prod';
    const r = await _arcaConsultarCPE({ companyId: req.companyId, modo, nroCtg: viaje.cpeNroCtg });
    res.json({ ok: true, info: r });
  } catch (e) { next(e); }
});

// Confirmar arribo (cuando el cereal se descarga)
app.post('/api/viajes/:id/cpe/confirmar-arribo', authMiddleware, requireCompany, requirePermission('logistica:update'), async (req, res, next) => {
  try {
    const viaje = await prisma.viaje.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!viaje) return res.status(404).json({ ok: false, error: 'Viaje no encontrado' });
    if (!viaje.cpeNroCtg) return res.status(400).json({ ok: false, error: 'Este viaje no tiene CPE emitida' });
    const kg = Number(req.body?.kgDescarga || viaje.kgDescarga || viaje.cantidad || 0);
    const company = await prisma.company.findUnique({ where: { id: req.companyId }, select: { arcaModo: true } });
    const modo = company?.arcaModo === 'homo' ? 'homo' : 'prod';
    const r = await _arcaConfirmarArriboCPE({ companyId: req.companyId, modo, nroCtg: viaje.cpeNroCtg, kgDescarga: kg });
    const final = await prisma.viaje.update({ where: { id: viaje.id }, data: {
      cpeEstado: 'confirmada',
      cpeFechaArribo: new Date(),
      kgDescarga: kg,
    }});
    res.json({ ok: true, data: final, info: r });
  } catch (e) { next(e); }
});

// Anular CPE
app.post('/api/viajes/:id/cpe/anular', authMiddleware, requireCompany, requirePermission('logistica:update'), async (req, res, next) => {
  try {
    const viaje = await prisma.viaje.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!viaje) return res.status(404).json({ ok: false, error: 'Viaje no encontrado' });
    if (!viaje.cpeNroCtg) return res.status(400).json({ ok: false, error: 'Este viaje no tiene CPE emitida' });
    const motivo = (req.body?.motivo || '').trim();
    if (!motivo) return res.status(400).json({ ok: false, error: 'Falta el motivo de anulación' });
    const company = await prisma.company.findUnique({ where: { id: req.companyId }, select: { arcaModo: true } });
    const modo = company?.arcaModo === 'homo' ? 'homo' : 'prod';
    const r = await _arcaAnularCPE({ companyId: req.companyId, modo, nroCtg: viaje.cpeNroCtg, motivo });
    const final = await prisma.viaje.update({ where: { id: viaje.id }, data: {
      cpeEstado: 'anulada',
      cpeFechaAnulacion: new Date(),
      cpeMotivoAnulacion: motivo,
    }});
    res.json({ ok: true, data: final, info: r });
  } catch (e) { next(e); }
});

// ============================================================
// LOGÍSTICA — Transportistas, Choferes, Camiones (v0.8.2)
// ============================================================
const transportistaSchema = z.object({
  nombre: z.string().min(1),
  cuit: z.string().nullable().optional(),
  telefono: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  direccion: z.string().nullable().optional(),
  observaciones: z.string().nullable().optional(),
  propio: z.boolean().optional(),
  activo: z.boolean().optional(),
});
const camionSchema = z.object({
  patente: z.string().min(1),
  patenteAcoplado: z.string().nullable().optional(),
  tipo: z.string().nullable().optional(),
  marca: z.string().nullable().optional(),
  modelo: z.string().nullable().optional(),
  anio: z.coerce.number().int().nullable().optional(),
  transportistaId: z.string().nullable().optional(),
  observaciones: z.string().nullable().optional(),
  activo: z.boolean().optional(),
});
const choferSchema = z.object({
  nombre: z.string().min(1),
  cuit: z.string().nullable().optional(),
  licencia: z.string().nullable().optional(),
  telefono: z.string().nullable().optional(),
  transportistaId: z.string().nullable().optional(),
  camionId: z.string().nullable().optional(),       // chasis habitual
  acopladoId: z.string().nullable().optional(),     // acoplado habitual
  empleadoId: z.string().nullable().optional(),     // si el chofer es empleado (camión propio)
  comisionTipo: z.enum(['porcentaje', 'monto_fijo', 'por_tn']).nullable().optional(),
  comisionValor: z.coerce.number().nullable().optional(),
  observaciones: z.string().nullable().optional(),
  activo: z.boolean().optional(),
});
// Acoplado / batea (entidad propia, espejo de Camion)
const acopladoSchema = z.object({
  patente: z.string().min(1),
  tipo: z.string().nullable().optional(),
  marca: z.string().nullable().optional(),
  modelo: z.string().nullable().optional(),
  anio: z.coerce.number().int().nullable().optional(),
  transportistaId: z.string().nullable().optional(),
  observaciones: z.string().nullable().optional(),
  activo: z.boolean().optional(),
});

// === Transportistas ===
app.get('/api/transportistas', requireCompany, requirePermission('logistica:read'), async (req, res, next) => {
  try {
    const data = await prisma.transportista.findMany({
      where: { companyId: req.companyId },
      orderBy: { nombre: 'asc' },
      include: { _count: { select: { choferes: true, camiones: true, viajes: true } } },
    });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});
app.post('/api/transportistas', requireCompany, requirePermission('logistica:create'), async (req, res, next) => {
  try {
    const input = transportistaSchema.parse(req.body);
    const r = await prisma.transportista.create({ data: { ...input, companyId: req.companyId } });
    res.status(201).json({ ok: true, data: r });
  } catch (e) { next(e); }
});
app.put('/api/transportistas/:id', requireCompany, requirePermission('logistica:update'), async (req, res, next) => {
  try {
    const existing = await prisma.transportista.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    const input = transportistaSchema.partial().parse(req.body);
    const r = await prisma.transportista.update({ where: { id: req.params.id }, data: input });
    // Si pasó a ser transporte PROPIO, damos de baja el proveedor espejo auto-creado
    // (sólo si no tiene facturas de compra cargadas, para no romper histórico).
    if (input.propio === true) {
      try {
        const cuitNorm = (r.cuit || '').replace(/[-.\s]/g, '');
        const provs = await prisma.proveedor.findMany({
          where: { companyId: req.companyId, activo: true },
          include: { _count: { select: { facturasCompra: true } } },
        });
        const prov = provs.find(p =>
          (cuitNorm && (p.cuit || '').replace(/[-.\s]/g, '') === cuitNorm) ||
          (p.razonSocial || '').trim().toLowerCase() === (r.nombre || '').trim().toLowerCase()
        );
        if (prov && (prov._count?.facturasCompra || 0) === 0) {
          await prisma.proveedor.update({ where: { id: prov.id }, data: {
            activo: false,
            observaciones: (prov.observaciones ? prov.observaciones + ' · ' : '') + 'Dado de baja: el transportista pasó a ser transporte propio',
          }});
        }
      } catch (_) {}
    }
    res.json({ ok: true, data: r });
  } catch (e) { next(e); }
});
app.delete('/api/transportistas/:id', requireCompany, requirePermission('logistica:delete'), async (req, res, next) => {
  try {
    const existing = await prisma.transportista.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    await prisma.transportista.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// === Camiones ===
app.get('/api/camiones', requireCompany, requirePermission('logistica:read'), async (req, res, next) => {
  try {
    const where = { companyId: req.companyId };
    if (req.query.transportistaId) where.transportistaId = String(req.query.transportistaId);
    const data = await prisma.camion.findMany({
      where, orderBy: { patente: 'asc' },
      include: { transportista: true, _count: { select: { choferes: true, viajes: true } } },
    });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});
app.post('/api/camiones', requireCompany, requirePermission('logistica:create'), async (req, res, next) => {
  try {
    const input = camionSchema.parse(req.body);
    const r = await prisma.camion.create({ data: { ...input, companyId: req.companyId } });
    res.status(201).json({ ok: true, data: r });
  } catch (e) { next(e); }
});
app.put('/api/camiones/:id', requireCompany, requirePermission('logistica:update'), async (req, res, next) => {
  try {
    const existing = await prisma.camion.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    const input = camionSchema.partial().parse(req.body);
    const r = await prisma.camion.update({ where: { id: req.params.id }, data: input });
    res.json({ ok: true, data: r });
  } catch (e) { next(e); }
});
app.delete('/api/camiones/:id', requireCompany, requirePermission('logistica:delete'), async (req, res, next) => {
  try {
    const existing = await prisma.camion.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    await prisma.camion.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// === Acoplados (espejo de Camiones) ===
app.get('/api/acoplados', requireCompany, requirePermission('logistica:read'), async (req, res, next) => {
  try {
    const where = { companyId: req.companyId };
    if (req.query.transportistaId) where.transportistaId = String(req.query.transportistaId);
    const data = await prisma.acoplado.findMany({
      where, orderBy: { patente: 'asc' },
      include: { transportista: true, _count: { select: { choferes: true, viajes: true } } },
    });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});
app.post('/api/acoplados', requireCompany, requirePermission('logistica:create'), async (req, res, next) => {
  try {
    const input = acopladoSchema.parse(req.body);
    const r = await prisma.acoplado.create({ data: { ...input, companyId: req.companyId } });
    res.status(201).json({ ok: true, data: r });
  } catch (e) { next(e); }
});
app.put('/api/acoplados/:id', requireCompany, requirePermission('logistica:update'), async (req, res, next) => {
  try {
    const existing = await prisma.acoplado.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    const input = acopladoSchema.partial().parse(req.body);
    const r = await prisma.acoplado.update({ where: { id: req.params.id }, data: input });
    res.json({ ok: true, data: r });
  } catch (e) { next(e); }
});
app.delete('/api/acoplados/:id', requireCompany, requirePermission('logistica:delete'), async (req, res, next) => {
  try {
    const existing = await prisma.acoplado.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    await prisma.acoplado.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// === Choferes ===
app.get('/api/choferes', requireCompany, requirePermission('logistica:read'), async (req, res, next) => {
  try {
    const where = { companyId: req.companyId };
    if (req.query.transportistaId) where.transportistaId = String(req.query.transportistaId);
    const data = await prisma.chofer.findMany({
      where, orderBy: { nombre: 'asc' },
      include: { transportista: true, camion: { include: { transportista: true } }, acoplado: true, _count: { select: { viajes: true } } },
    });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});
app.post('/api/choferes', requireCompany, requirePermission('logistica:create'), async (req, res, next) => {
  try {
    const input = choferSchema.parse(req.body);
    const r = await prisma.chofer.create({ data: { ...input, companyId: req.companyId } });
    res.status(201).json({ ok: true, data: r });
  } catch (e) { next(e); }
});
app.put('/api/choferes/:id', requireCompany, requirePermission('logistica:update'), async (req, res, next) => {
  try {
    const existing = await prisma.chofer.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    const input = choferSchema.partial().parse(req.body);
    const r = await prisma.chofer.update({ where: { id: req.params.id }, data: input });
    res.json({ ok: true, data: r });
  } catch (e) { next(e); }
});
app.delete('/api/choferes/:id', requireCompany, requirePermission('logistica:delete'), async (req, res, next) => {
  try {
    const existing = await prisma.chofer.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    await prisma.chofer.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// === Importar catálogos desde los viajes ya cargados ===
// Recorre los viajes históricos de la empresa y da de alta los transportistas,
// choferes, camiones y acoplados (+ proveedores de flete) que todavía no estén
// en el catálogo. También deja el viaje vinculado por ID. Idempotente.
app.post('/api/logistica/importar-de-viajes', requireCompany, requirePermission('logistica:create'), async (req, res, next) => {
  try {
    const viajes = await prisma.viaje.findMany({
      where: { companyId: req.companyId },
      select: {
        id: true, transportista: true, transporteCuit: true, chofer: true, choferCuit: true,
        patente: true, patenteAcoplado: true, tipoCamion: true,
        transportistaId: true, choferId: true, camionId: true, acopladoId: true,
      },
      orderBy: { fecha: 'asc' },
    });
    const counts = { transportistas: 0, choferes: 0, camiones: 0, acoplados: 0, proveedores: 0, viajesVinculados: 0 };
    for (const v of viajes) {
      const ids = await _autoAltaLogisticaViaje(req.companyId, v, counts);
      // Vincular el viaje si algún ID quedó sin setear.
      const patch = {};
      for (const k of ['transportistaId', 'choferId', 'camionId', 'acopladoId']) {
        if (ids[k] && !v[k]) patch[k] = ids[k];
      }
      if (Object.keys(patch).length) {
        await prisma.viaje.update({ where: { id: v.id }, data: patch });
        counts.viajesVinculados++;
      }
    }
    res.json({ ok: true, revisados: viajes.length, ...counts });
  } catch (e) { next(e); }
});


// Parser común de PDF CPE — extrae los campos del texto desordenado que devuelve pdf-parse.
// Estrategia v0.8.14:
//   1) Recolectar todos los CUITs+razon del texto en orden de aparición.
//   2) Para campos que vienen "inline" (etiqueta + valor en LA MISMA línea), regex específico.
//   3) Para los demás, mapeo posicional: detectar las etiquetas presentes en el texto
//      (en orden) y asignar el i-ésimo CUIT al i-ésimo campo no-vacío.
//   4) Importante: NO buscar nada en catalogos. Devolver CUIT + Razón Social EXACTOS del PDF.
function _parsearTextoCPE(txt) {
  const PRODUCTOS = ['Soja','Maíz','Maiz','Trigo','Girasol','Sorgo','Cebada','Avena','Centeno','Lino','Arroz','Colza','Cártamo','Cartamo'];
  const PROVS = ['BUENOS AIRES','CABA','CATAMARCA','CHACO','CHUBUT','CORDOBA','CÓRDOBA','CORRIENTES','ENTRE RIOS','ENTRE RÍOS','FORMOSA','JUJUY','LA PAMPA','LA RIOJA','MENDOZA','MISIONES','NEUQUEN','NEUQUÉN','RIO NEGRO','RÍO NEGRO','SALTA','SAN JUAN','SAN LUIS','SANTA CRUZ','SANTA FE','SANTIAGO DEL ESTERO','TIERRA DEL FUEGO','TUCUMAN','TUCUMÁN'];
  const get = (re) => { const m = txt.match(re); return m ? m[1].trim() : null; };

  // 1) TODOS los CUIT-RAZON en orden de aparición. Usamos un regex que captura la razón hasta el próximo separador claro.
  const todosCuits = [];
  const reCuit = /(\d{11})\s*-\s*([A-ZÁÉÍÓÚÑ&\.][A-ZÁÉÍÓÚÑa-záéíóúñ&\.\s,]+?)(?=\n|\s{2,}[A-Z][a-z]|Flete pagador|Chofer|Intermediario|Representante|Destinatario|Destino|Empresa|Corredor|Mercado|Rte\.|Remitente|Titular|A\s*-|B\s*-|$)/g;
  let mm;
  while ((mm = reCuit.exec(txt)) !== null) {
    let razon = mm[2].trim();
    // Limpiar trailing words que sean etiquetas pegadas
    razon = razon.replace(/(?:\s*Flete pagador|Chofer|Intermediario|Representante|Destinatario|Destino|Empresa Transportista|Corredor|Mercado a Término|Rte\.|Remitente|Titular).*$/i, '').trim();
    todosCuits.push({ cuit: mm[1], razon });
  }

  // 2) Inline ESTRICTO (sin cruzar newlines)
  const cuitRazonInlineEstricto = (etiqueta) => {
    const re = new RegExp(etiqueta.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[ \\t]*:?[ \\t]*(\\d{11})[ \\t]*-[ \\t]*([^\\n]+)', 'i');
    const m = txt.match(re);
    if (!m) return { cuit: null, razon: null };
    let razon = m[2].trim();
    razon = razon.replace(/(?:\s*Flete pagador|Chofer|Intermediario|Representante|Destinatario|Destino|Empresa Transportista|Corredor|Mercado a Término|Rte\.|Remitente|Titular).*$/i, '').trim();
    return { cuit: m[1], razon };
  };

  // El Chofer suele venir inline ("Chofer :20XXXX - NOMBRE")
  const chofer = cuitRazonInlineEstricto('Chofer');

  // 3) Orden estándar de campos en la CPE oficial (en el orden visual del PDF)
  // Para cada campo, identificamos si EXISTE en el texto y si tiene CUIT inline.
  // ORDEN POSICIONAL: solo los campos que TÍPICAMENTE están con valor en una CPE
  // de operación normal de granos (basado en el formato real de ARCA). Los demás
  // (Remitente, Mercado a Término, Corredor Primaria, Rte Com Sec, etc.) suelen
  // estar vacíos y NO se asignan por posición — si tienen valor, vienen inline
  // (chofer típicamente). Esto evita el desfase cuando hay campos vacíos.
  const CAMPOS_ORDEN = [
    { key: 'titular',         et: 'Titular Carta de Porte' },
    { key: 'rteComercialPrim',et: 'Rte. Comercial Venta Primaria' },
    { key: 'corredorSec',     et: 'Corredor Venta Secundaria' },
    { key: 'repEntregador',   et: 'Representante entregador' },
    { key: 'destinatario',    et: 'Destinatario' },
    { key: 'destino',         et: 'Destino' },
    { key: 'transportista',   et: 'Empresa Transportista' },
    { key: 'fletePagador',    et: 'Flete pagador' },
  ];

  // Para cada campo, intentar primero inline; si no, marcar como "necesita posicional"
  const asignados = {};
  const usadosCuits = new Set();
  for (const c of CAMPOS_ORDEN) {
    const r = cuitRazonInlineEstricto(c.et);
    if (r.cuit) {
      asignados[c.key] = r;
      // Marcar este CUIT como ya usado para no asignarlo después por posicional
      usadosCuits.add(r.cuit + '|' + r.razon);
    }
  }

  // Para los que no se asignaron, mapeo posicional: tomar el siguiente CUIT no usado.
  // Pero ojo, el orden de los CUITs en el texto SIGUE el orden de las etiquetas
  // CON VALOR (en el orden estándar). Detectamos qué etiquetas existen en el texto:
  const cuitsLibres = todosCuits.filter(c => !usadosCuits.has(c.cuit + '|' + c.razon));
  let idx = 0;
  for (const c of CAMPOS_ORDEN) {
    if (asignados[c.key]) continue;
    // ¿Existe la etiqueta en el texto?
    const reEt = new RegExp(c.et.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (!reEt.test(txt)) continue;
    // Asignar el siguiente CUIT libre
    if (idx < cuitsLibres.length) {
      asignados[c.key] = cuitsLibres[idx];
      idx++;
    } else {
      asignados[c.key] = { cuit: null, razon: null };
    }
  }

  // Helper para obtener el campo asignado
  const A = (k) => asignados[k] || { cuit: null, razon: null };

  // Grano: producto conocido cerca de la sección B
  let grano = null;
  const idxB = txt.search(/B\s*-\s*GRANO/i);
  const idxC = txt.search(/C\s*-\s*PROCEDENCIA/i);
  if (idxB >= 0 && idxC > idxB) {
    const secB = txt.slice(idxB, idxC);
    for (const p of PRODUCTOS) {
      if (new RegExp('\\b' + p + '\\b', 'i').test(secB)) { grano = p; break; }
    }
  }
  const tipoGrano = grano;
  const campania = get(/Campaña\s*:?\s*(\d{4})/i);

  // Pesos
  let pesoBruto = get(/Peso\s*Bruto\s+(\d{3,7})/i);
  let pesoTara  = get(/Peso\s*Tara\s+(\d{3,7})/i);
  let pesoNeto  = get(/Peso\s*Neto\s+(\d{3,7})/i);
  if (!pesoBruto || !pesoTara || !pesoNeto) {
    if (idxB >= 0 && idxC > idxB) {
      const secB = txt.slice(idxB, idxC);
      const grande = secB.match(/\b(\d{8,12})\b/);
      let bruto2 = null, tara2 = null;
      if (grande) {
        const s = grande[1];
        if (s.length === 10) { bruto2 = s.slice(0,5); tara2 = s.slice(5); }
        else if (s.length === 8) { bruto2 = s.slice(0,4); tara2 = s.slice(4); }
      }
      const sueltos = (secB.match(/\b\d{3,7}\b/g) || []).map(Number).filter(n => n > 100 && n < 100000);
      const unicos = [...new Set(sueltos)].sort((a,b) => b-a);
      if (!pesoBruto && bruto2) pesoBruto = bruto2;
      else if (!pesoBruto && unicos.length) pesoBruto = String(unicos[0]);
      if (!pesoTara && tara2) pesoTara = tara2;
      else if (!pesoTara && unicos.length >= 2) {
        const candTara = unicos.find(n => n < Number(pesoBruto));
        if (candTara) pesoTara = String(candTara);
      }
      if (!pesoNeto && pesoBruto && pesoTara) {
        pesoNeto = String(Number(pesoBruto) - Number(pesoTara));
      } else if (!pesoNeto) {
        const candNeto = unicos.find(n => n >= 1000 && n <= 50000);
        if (candNeto) pesoNeto = String(candNeto);
      }
    }
  }

  // Origen
  let origenLocalidad = null, origenProvincia = null;
  if (idxC >= 0) {
    const idxD = txt.search(/D\s*-\s*DESTINO/i);
    const secC = txt.slice(idxC, idxD > idxC ? idxD : txt.length);
    // Localidad de origen: TODO lo que sigue a "Localidad" hasta "Provincia" o fin de línea
    // (captura nombres compuestos como "CORONEL MOLDES", no solo la primera palabra).
    let m1 = secC.match(/Localidad\s*:?\s*([A-ZÁÉÍÓÚÑ0-9º°.\-][A-ZÁÉÍÓÚÑ0-9º°.\- ]*?)\s*(?:Provincia\b|Prov\.?\b|Renspa|C\.?P\.?\b|$)/im);
    if (m1) origenLocalidad = m1[1].replace(/\s+/g, ' ').trim();
    // Caso "Localidad:Provincia<VALOR>" pegado (sin localidad entre los dos rótulos)
    if (!origenLocalidad) {
      const pegado = secC.match(/Localidad:\s*Provincia\s*([A-ZÁÉÍÓÚÑ .\-]+)/i);
      if (pegado) {
        let val = pegado[1].replace(/\s+/g, ' ').trim();
        for (const prov of PROVS) {
          if (val.toUpperCase().endsWith(prov.toUpperCase())) { origenProvincia = prov; val = val.slice(0, -prov.length).trim(); break; }
        }
        origenLocalidad = val || null;
      }
    }
    if (!origenProvincia) {
      for (const prov of PROVS) {
        if (secC.toUpperCase().includes(prov.toUpperCase())) { origenProvincia = prov; break; }
      }
    }
    // Si la localidad quedó pegada a la provincia (ej "CORONEL MOLDES CORDOBA"), la separamos.
    if (origenLocalidad && origenProvincia) {
      const up = origenLocalidad.toUpperCase(), pu = origenProvincia.toUpperCase();
      if (up === pu) origenLocalidad = null;
      else if (up.endsWith(' ' + pu)) origenLocalidad = origenLocalidad.slice(0, -(pu.length + 1)).trim();
    }
  }
  const origenRenspa = get(/(\d{2}\.\d{3}\.\d\.\d{4,}\/?[A-Z0-9]*)/);

  // Destino
  let destinoEsCampo = null, destinoPlanta = null, destinoDireccion = null, destinoLocalidad = null, destinoProvincia = null;
  const idxD = txt.search(/D\s*-\s*DESTINO/i);
  if (idxD >= 0) {
    const idxE = txt.search(/E\s*-\s*DATOS/i);
    const secD = txt.slice(idxD, idxE > idxD ? idxE : txt.length);
    destinoEsCampo = (secD.match(/Es un campo\s*:?\s*(Si|No|Sí)/i) || [])[1] || null;
    destinoPlanta  = (secD.match(/N°\s*Planta\s*(\d+)/i) || [])[1] || null;
    const dir = secD.match(/Dirección[:\s]*([^\n]+)/i);
    if (dir) destinoDireccion = dir[1].trim();
    for (const prov of PROVS) {
      if (secD.toUpperCase().includes(prov.toUpperCase())) { destinoProvincia = prov; break; }
    }
    const localidades = secD.match(/^([A-ZÁÉÍÓÚÑ ]{4,})$/gm);
    if (localidades) {
      for (const l of localidades) {
        const lt = l.trim();
        if (!PROVS.some(p => p.toUpperCase() === lt.toUpperCase()) && lt !== 'No' && lt !== 'Si' && !/^\d/.test(lt)) {
          destinoLocalidad = lt;
          break;
        }
      }
    }
  }

  // Dominios
  let dominioCamion = null, dominioAcoplado = null;
  const mDom2 = txt.match(/([A-Z]{2,3}\s*\d{3,4}\s*[A-Z]{0,2})\s*[-–\/]\s*([A-Z]{2,3}\s*\d{3,4}\s*[A-Z]{0,2})/);
  if (mDom2) {
    dominioCamion = mDom2[1].replace(/\s+/g, '');
    dominioAcoplado = mDom2[2].replace(/\s+/g, '');
  } else {
    const mDom1 = txt.match(/Dominios?\s*:?\s*\n*\s*([A-Z]{2,3}\s*\d{3,4}\s*[A-Z]{0,2})/i);
    if (mDom1) dominioCamion = mDom1[1].replace(/\s+/g,'');
  }

  const partidaFecha = get(/(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{2}:\d{2}(?::\d{2})?)/);
  let kmsARecorrer = get(/Kms\.\s*a\s*recorrer\s*:?\s*(\d+)/i);
  if (!kmsARecorrer) {
    const m2 = txt.match(/Partida[\s\S]{0,200}?\n(\d{1,4})\n+(\d+)\s*\n+Tarifa/);
    if (m2) kmsARecorrer = m2[1];
  }
  // Tarifa: bidireccional (antes o después de "Tarifa:")
  let tarifa = get(/Tarifa\s*:?\s*\n*\s*([\d][\d\.,]*)/i);
  if (!tarifa) tarifa = get(/([\d][\d\.,]*)\s*\n+\s*Tarifa\s*:?/i);
  const observaciones = get(/Observaciones\s*:?\s*([^\n]+)/i);

  const cpeNroCtg = get(/CTG\s*:?\s*(\d{11,})/i);
  const cpeNroComprobante = get(/(\d{5}-\d{8})/);
  const fechaEmisionTxt = get(/(\d{1,2}\/\d{1,2}\/\d{4})/);

  return {
    cpeNroCtg, cpeNroComprobante, fechaEmisionTxt, fechaVtoTxt: null,
    titularCuit: A('titular').cuit,                 titularRazon: A('titular').razon,
    remitenteCuit: A('remitente').cuit,             remitenteRazon: A('remitente').razon,
    rteComercialPrimCuit: A('rteComercialPrim').cuit, rteComercialPrimRazon: A('rteComercialPrim').razon,
    corredorPrimCuit: A('corredorPrim').cuit,       corredorPrimRazon: A('corredorPrim').razon,
    corredorSecCuit: A('corredorSec').cuit,         corredorSecRazon: A('corredorSec').razon,
    destinatarioCuit: A('destinatario').cuit,       destinatarioRazon: A('destinatario').razon,
    destinoCuit: A('destino').cuit,                 destinoRazon: A('destino').razon,
    transportistaCuit: A('transportista').cuit,     transportistaRazon: A('transportista').razon,
    fletePagadorCuit: A('fletePagador').cuit,       fletePagadorRazon: A('fletePagador').razon,
    choferCuit: A('chofer').cuit || chofer.cuit,    choferRazon: A('chofer').razon || chofer.razon,
    intermediarioCuit: A('intermediario').cuit,     intermediarioRazon: A('intermediario').razon,
    repEntregadorCuit: A('repEntregador').cuit,     repEntregadorRazon: A('repEntregador').razon,
    repRecibidorCuit: A('repRecibidor').cuit,       repRecibidorRazon: A('repRecibidor').razon,
    grano, tipoGrano, campania,
    pesoBruto, pesoTara, pesoNeto,
    origenLocalidad, origenProvincia, origenRenspa,
    destinoEsCampo, destinoPlanta, destinoDireccion, destinoLocalidad, destinoProvincia,
    dominioCamion, dominioAcoplado,
    partidaFecha, kmsARecorrer, tarifa, observaciones,
    todosCuitsDetectados: todosCuits,
  };
}

// Parser de PDF de CPE oficial de ARCA. Tolerante a layouts variables:
// algunos PDFs vienen con valores inline ("Chofer: 20XXXXX - NOMBRE") y otros con
// las etiquetas y valores en líneas separadas (por tablas de ARCA). Estrategias:
//   1) Para cada campo intentamos regex inline (mismo renglón)
//   2) Fallback: buscar el CUIT en las próximas líneas tras la etiqueta
//   3) Pesos: buscar números 4-6 dígitos cerca de "Peso Bruto/Tara/Neto"
//   4) Dominios: regex de patentes argentinas (AAA999 o AA999AA)
app.post('/api/arca/cpe/parsear-pdf', authMiddleware, requireCompany, requirePermission('logistica:read'), upload.single('archivo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Falta el archivo' });
    let pdfParse;
    try { pdfParse = await getPdfParse(); }
    catch (e) { return res.status(500).json({ ok: false, error: 'pdf-parse no disponible: ' + e.message }); }
    const data = await pdfParse(req.file.buffer);
    const txt = data.text || '';
    const out = _parsearTextoCPE(txt);
    res.json({ ok: true, data: out, textoCrudo: txt.slice(0, 4000) });
  } catch (e) { next(e); }
});

// Crear un viaje nuevo a partir del PDF de ARCA — usa el mismo parser que parsear-pdf
app.post('/api/arca/cpe/importar-como-viaje', authMiddleware, requireCompany, requirePermission('logistica:create'), upload.single('archivo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Falta el archivo' });
    let pdfParse;
    try { pdfParse = await getPdfParse(); }
    catch (e) { return res.status(500).json({ ok: false, error: 'pdf-parse no disponible: ' + e.message }); }
    const data = await pdfParse(req.file.buffer);
    const txt = data.text || '';
    const d = _parsearTextoCPE(txt);
    // Fecha del viaje desde partida
    let fechaIso = new Date();
    if (d.partidaFecha) {
      const mm = d.partidaFecha.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(\d{2}):(\d{2})/);
      if (mm) fechaIso = new Date(`${mm[3]}-${mm[2].padStart(2,'0')}-${mm[1].padStart(2,'0')}T${mm[4]}:${mm[5]}:00`);
    }
    const v = await prisma.viaje.create({ data: {
      companyId: req.companyId,
      fecha: fechaIso,
      origen: d.origenLocalidad || null,
      destino: d.destinoLocalidad || null,
      producto: d.grano || null,
      transportista: d.transportistaRazon || null,
      transporteCuit: d.transportistaCuit || null,
      chofer: d.choferRazon || null,
      choferCuit: d.choferCuit || null,
      patente: d.dominioCamion || null,
      patenteAcoplado: d.dominioAcoplado || null,
      cantidad: d.pesoNeto ? Number(d.pesoNeto) : null,
      kgTara:  d.pesoTara  ? Number(d.pesoTara)  : null,
      kgBruto: d.pesoBruto ? Number(d.pesoBruto) : null,
      kgNeto:  d.pesoNeto  ? Number(d.pesoNeto)  : null,
      km: d.kmsARecorrer ? Number(d.kmsARecorrer) : null,
      tarifa: d.tarifa ? Number(String(d.tarifa).replace(/\./g,'').replace(',','.')) : null,
      pagadorFlete: d.fletePagadorRazon || null,
      ctg: d.cpeNroCtg || null,
      cartaPorte: d.cpeNroComprobante || d.cpeNroCtg || null,
      estado: 'cargado',
      observaciones: 'Importado desde PDF de ARCA' + (d.observaciones?` · ${d.observaciones}`:''),
      cpeNroCtg: d.cpeNroCtg, cpeNroComprobante: d.cpeNroComprobante,
      cpeEstado: 'emitida', cpeTipo: 'automotor',
      cpeFechaEmision: new Date(),
      cpeOrigenCuit: d.titularCuit || null,
      cpeOrigenRenspa: d.origenRenspa || null,
      cpeDestinoCuit: d.destinoCuit || null,
      cpeDestinatarioCuit: d.destinatarioCuit || null,
      cpeCorredorCuit: d.corredorPrimCuit || null,
      cpeIntermediarioCuit: d.intermediarioCuit || null,
      cpeObservaciones: d.observaciones || null,
      cpeRespuestaArca: { importadoDesdePDF: true, data: d },
    }});
    res.status(201).json({ ok: true, data: v, info: {
      mensaje: 'Viaje creado desde PDF',
      ctg: d.cpeNroCtg, transportista: d.transportistaRazon, chofer: d.choferRazon,
      producto: d.grano, pesoNeto: d.pesoNeto, origen: d.origenLocalidad, destino: d.destinoLocalidad,
    } });
  } catch (e) { next(e); }
});


// Estáticos finales (después de todos los /api/*)
app.use('/web', express.static(WEB_PUBLIC));
app.use((req, res) => res.status(404).json({ ok: false, error: 'Not found', path: req.path }));

app.use((err, _req, res, _next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({
      ok: false, error: 'Datos invalidos',
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  if (err.code === 'P2002') return res.status(409).json({ ok: false, error: 'Registro duplicado', fields: err.meta?.target });
  if (err.code === 'P2025') return res.status(404).json({ ok: false, error: 'No encontrado' });
  console.error('[ERROR]', err);
  res.status(err.status || 500).json({ ok: false, error: err.message || 'Error interno' });
});

// ============================================================
// START
// ============================================================
// Forzamos bind en IPv4 (0.0.0.0) para evitar el problema clasico de
// Windows donde Node escucha en IPv6 (::) y el navegador, con "localhost",
// se resuelve a IPv4 (127.0.0.1), tirando ERR_CONNECTION_REFUSED.
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`\nAgroCore API escuchando en http://localhost:${PORT} (bind ${HOST})`);
  console.log(`   Health: http://localhost:${PORT}/api/health`);
  const lan = getLanIps();
  if (lan.length) {
    console.log(`\n   Accedé desde esta PC:   http://127.0.0.1:${PORT}/app`);
    console.log(`   Accedé desde la red LAN (otras PCs / celulares):`);
    lan.forEach(i => console.log(`     http://${i.address}:${PORT}/app   (${i.iface})`));
    console.log(`\n   Si desde otra PC no puede conectar, correr una sola vez:`);
    console.log(`     ABRIR-PUERTO-3100.bat  (clic derecho → Ejecutar como administrador)\n`);
  }
  // Pre-cargar cotizaciones al arrancar
  (async () => {
    await fetchDolar().then(d => { if (d) { _cotCache.dolar = d; _cotCache.dolarTime = Date.now(); } });
    await fetchCereales().then(c => {
      if (c) {
        _cotCache.cereales = c;
        _cotCache.cerealesTime = Date.now();
        console.log(`[cotizaciones] Cereales precargados (${c.fuente})`);
      }
    });
  })();
  // Auto-refresh de cereales cada 6 horas (BCR publica 1 vez al día; chequeamos varias veces).
  // Si solo obtenemos "Referencia" y ya teníamos datos reales cacheados, NO los pisamos.
  setInterval(async () => {
    const c = await fetchCereales();
    if (!c) return;
    const actualEsReal = _cotCache.cereales && _cotCache.cereales.fuente !== 'Referencia';
    if (c.fuente === 'Referencia' && actualEsReal) {
      console.log('[cotizaciones] Fuentes reales fallaron, mantenemos caché previa.');
      return;
    }
    _cotCache.cereales = c;
    _cotCache.cerealesTime = Date.now();
    console.log(`[cotizaciones] Cereales refrescados (${c.fuente})`);
  }, 6 * 60 * 60 * 1000);
  // Auto-refresh de dólar cada 10 minutos
  setInterval(async () => {
    const d = await fetchDolar();
    if (d) { _cotCache.dolar = d; _cotCache.dolarTime = Date.now(); }
  }, 10 * 60 * 1000);

  // Pre-cargar noticias del agro y refrescar cada 30 min.
  (async () => {
    const items = await fetchNoticias();
    if (items.length) {
      _notCache.items = items; _notCache.time = Date.now();
      console.log(`[noticias] Precargadas ${items.length} noticias del agro.`);
    }
  })();
  setInterval(async () => {
    const items = await fetchNoticias();
    if (items.length) {
      _notCache.items = items; _notCache.time = Date.now();
      console.log(`[noticias] Refrescadas ${items.length} noticias del agro.`);
    }
  }, NOT_TTL);
});

process.on('SIGINT', async () => {
  console.log('\n  Cerrando Prisma...');
  await prisma.$disconnect();
  process.exit(0);
});