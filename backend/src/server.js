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
const AGROCORE_VERSION = '1.66.0';
const AGROCORE_BUILD = new Date('2026-06-25').toISOString().slice(0, 10);

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
app.get('/app', (_req, res) => res.sendFile(path.join(STATIC_DIR, 'AgroCore-web.html')));
app.use('/assets', express.static(path.join(STATIC_DIR, 'assets'), { fallthrough: true }));

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
];
function _hoy0() { const d = new Date(); d.setHours(0,0,0,0); return d; }
// Guarda el valor de hoy para cada moneda (global, companyId=null). Idempotente por día.
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
      await prisma.cotizacion.upsert({
        where: { companyId_moneda_fecha: { companyId: null, moneda: f.moneda, fecha } },
        update: { valor: f.valor, fuente: f.fuente },
        create: { companyId: null, moneda: f.moneda, fecha, valor: f.valor, fuente: f.fuente },
      });
    } catch (e) { /* ignore */ }
  }
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
app.post('/api/cotizaciones-historico', requireCompany, requirePermission('finanzas:create'), async (req, res, next) => {
  try {
    const d = z.object({ moneda: z.string().min(1), fecha: z.coerce.date(), valor: z.number().positive() }).parse(req.body);
    const fecha = new Date(d.fecha); fecha.setHours(0,0,0,0);
    const row = await prisma.cotizacion.upsert({
      where: { companyId_moneda_fecha: { companyId: null, moneda: d.moneda, fecha } },
      update: { valor: d.valor, fuente: 'manual' },
      create: { companyId: null, moneda: d.moneda, fecha, valor: d.valor, fuente: 'manual' },
    });
    res.json({ ok: true, data: row });
  } catch (e) { next(e); }
});
app.delete('/api/cotizaciones-historico/:id', requireCompany, requirePermission('finanzas:delete'), async (req, res, next) => {
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
  const companies = u.userCompanies.map((uc) => ({
    id: uc.company.id, name: uc.company.name,
    color: uc.company.color || null,
    logoUrl: uc.company.logoUrl || null,
    roleLabel: uc.role.label,
    role: { key: uc.role.key, label: uc.role.label, permissions: uc.role.permissions },
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

async function _autoSembrarCatalogosDesdeTemplate(newCompanyId) {
  const templateId = await _findTemplateCompany(newCompanyId);
  if (!templateId) return 0;
  return _copiarCatalogos(templateId, newCompanyId);
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
    });
    const d = schema.parse(req.body || {});
    const exclude = (d.excludeTipos && d.excludeTipos.length ? d.excludeTipos : ['Banco', 'Caja']).map(t => t.toLowerCase());

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
    let total = 0;
    for (const tid of targetIds) {
      try {
        const copiados = await _copiarCatalogos(d.sourceCompanyId, tid, exclude);
        resultados.push({ companyId: tid, copiados, error: null });
        total += copiados;
      } catch (e) {
        resultados.push({ companyId: tid, copiados: 0, error: String(e.message || e) });
      }
    }
    res.json({ ok: true, resultados, total, excludeTipos: exclude });
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
function mountCrud({ path, modelName, perm, schema, orderBy = { createdAt: 'desc' }, include, searchFields = [], injectUserId = false }) {
  const full = `/api/${path}`;
  const model = () => prisma[modelName];

  app.get(full, requireCompany, requirePermission(`${perm}:read`), async (req, res, next) => {
    try {
      const where = { companyId: req.companyId };
      const q = req.query.q?.toString().trim();
      if (q && searchFields.length) {
        where.OR = searchFields.map((f) => ({ [f]: { contains: q, mode: 'insensitive' } }));
      }
      res.json({ ok: true, data: await model().findMany({ where, orderBy, include }) });
    } catch (e) { next(e); }
  });

  app.get(`${full}/:id`, requireCompany, requirePermission(`${perm}:read`), async (req, res, next) => {
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
      await model().delete({ where: { id: req.params.id } });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
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
  }),
  orderBy: { nombre: 'asc' },
  searchFields: ['nombre', 'categoria'],
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
    // Aseguramos que cada categoría de animal tenga su producto, para verlos todos en Stock.
    try { await sincronizarProductosHacienda(req.companyId); } catch {}
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
    // nutre de los movimientos de hacienda (cabezas reales + kg estimados).
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
      return { ...p, existencia, bajoMinimo: existencia < Number(p.stockMinimo || 0) };
    });
    res.json({ ok: true, data });
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
});
mountCrud({
  path: 'proveedores', modelName: 'proveedor', perm: 'contactos',
  schema: clienteSchema.extend({ rubro: z.string().nullable().optional() }),
  orderBy: { razonSocial: 'asc' },
  searchFields: ['razonSocial', 'nombreFantasia', 'cuit', 'rubro'],
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
  }),
  include: { lote: { include: { campo: true } } },
  searchFields: ['nombre', 'cultivo', 'variedad', 'ciclo'],
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
  // Detectar productos de HACIENDA: mueven el stock de hacienda (cabezas + kg),
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
  // 2) Stock de hacienda (la "cantidad" de la línea son los kg; las cabezas vienen aparte)
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
  // Revertir también los movimientos de hacienda generados por la factura.
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
  // Hacienda: campo del que sale/entra + cabezas (la "cantidad" de la línea son kg).
  campoId: z.string().nullable().optional(),
  cabezas: z.number().nullable().optional(),
});

app.get('/api/facturas', requireCompany, requirePermission('ventas:read'), async (req, res, next) => {
  try {
    const { desde, hasta } = req.query;
    const where = { companyId: req.companyId };
    if (desde || hasta) { where.fecha = {}; if (desde) where.fecha.gte = new Date(desde); if (hasta) where.fecha.lte = new Date(hasta); }
    res.json({ ok: true, data: await prisma.factura.findMany({ where, orderBy: { fecha: 'desc' }, include: { cliente: true, items: true } }) });
  } catch (e) { next(e); }
});

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
    res.json({ ok: true, data: row });
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
      items: z.array(itemFacSchema).min(1),
    });
    const input = schema.parse(req.body);
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
      const f = await tx.factura.create({
        data: {
          companyId: req.companyId, clienteId: input.clienteId || null,
          tipo: input.tipo, puntoVenta: input.puntoVenta, numero: input.numero, fecha: input.fecha,
          condicionVenta: input.condicionVenta, observaciones: input.observaciones,
          moneda: _mon, cotizacion: _cot,
          subtotal: totales.subtotal, iva: totales.iva, total: totales.total,
          cae, caeVto, estado: 'autorizada',
          origen: input.origen,
          items: { create: totales.items },
        },
        include: { cliente: true, items: true },
      });
      await crearMovimientosDesdeFactura(tx, {
        companyId: req.companyId, factura: f, tipo: 'egreso', motivo: 'venta',
        contraparteId: input.clienteId || null, contraparteTipo: 'cliente', refPrefix: 'VTA',
        userId: req.user?.id || null, depositoId: input.depositoId || null,
      });
      // Movimiento de cuenta corriente: el cliente queda debiendo el total.
      await crearCtaCteDesdeFactura(tx, {
        companyId: req.companyId, factura: f,
        contactoTipo: 'cliente', contactoId: input.clienteId || null,
        refPrefix: 'FAC', motivo: 'Factura',
        condicion: input.condicionVenta, condicionDias: input.condicionDias,
        vencimientoFecha: input.vencimientoFecha || null,
      });
      return f;
    });
    res.status(201).json({ ok: true, data: factura });
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

// ---------- COMPRAS ----------
app.get('/api/facturas-compra', requireCompany, requirePermission('compras:read'), async (req, res, next) => {
  try {
    const { desde, hasta } = req.query;
    const where = { companyId: req.companyId };
    if (desde || hasta) { where.fecha = {}; if (desde) where.fecha.gte = new Date(desde); if (hasta) where.fecha.lte = new Date(hasta); }
    res.json({ ok: true, data: await prisma.facturaCompra.findMany({ where, orderBy: { fecha: 'desc' }, include: { proveedor: true, items: true } }) });
  } catch (e) { next(e); }
});

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
    res.json({ ok: true, data: row });
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

app.delete('/api/facturas-compra/:id', requireCompany, requirePermission('compras:delete'), async (req, res, next) => {
  try {
    const existing = await prisma.facturaCompra.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrada' });
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
    const items = await prisma.ctaCte.findMany({
      where: {
        companyId: req.companyId,
        contactoTipo: tipo,
        ...(contactoId ? { contactoId } : {}),
        pagado: false,
        OR: [ { debe: { gt: 0 } }, { haber: { gt: 0 } } ],
      },
      orderBy: { fecha: 'asc' },
    });
    res.json({ ok: true, data: items });
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
      color: z.string().nullable().optional(),
      pagado: z.boolean().optional(),
    })).nullable().optional(),
    observaciones: z.string().nullable().optional(),
  }),
  orderBy: { vencimiento: 'asc' },
  searchFields: ['propietario','nombre'],
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
  estado: z.enum(['pendiente','cargado','descargado','facturado','pagado']).optional(),
  facturaCompraId: z.string().nullable().optional(),
  observaciones: z.string().nullable().optional(),
  // Destino del cereal (registrar a dónde va para luego cargar la liquidación)
  destinoTipo: z.enum(['cerealera','venta_directa','otro']).nullable().optional(),
  depositoDestinoId: z.string().nullable().optional(),
  liquidacionCerealId: z.string().nullable().optional(),

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
  if (prev && prev.estado === 'pagado') return 'pagado';
  if (d.facturaCompraId)                return 'facturado';
  if (Number(d.kgDescarga || 0) > 0)    return 'descargado';
  if (Number(d.cantidad || 0) > 0)      return 'cargado';
  return 'pendiente';
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

app.post('/api/viajes', requireCompany, requirePermission('logistica:create'), async (req, res, next) => {
  try {
    const d = viajeSchema.parse(req.body);
    if (d.facturaCompraId) {
      const f = await prisma.facturaCompra.findFirst({ where: { id: d.facturaCompraId, companyId: req.companyId } });
      if (!f) return res.status(400).json({ ok: false, error: 'Factura de compra no válida' });
    }
    const estado = deriveEstadoViaje(d, null);
    const row = await prisma.viaje.create({
      data: { ...d, companyId: req.companyId, estado },
      include: { facturaCompra: { include: { proveedor: true } } },
    });
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
    const estado = d.estado ?? deriveEstadoViaje(merged, existing);
    const row = await prisma.viaje.update({
      where: { id: req.params.id },
      data: { ...d, estado },
      include: { facturaCompra: { include: { proveedor: true } } },
    });
    res.json({ ok: true, data: row });
  } catch (e) { next(e); }
});

app.delete('/api/viajes/:id', requireCompany, requirePermission('logistica:delete'), async (req, res, next) => {
  try {
    const existing = await prisma.viaje.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
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
    const r = await prisma.viaje.deleteMany({ where: { companyId: req.companyId } });
    res.json({ ok: true, deleted: r.count });
  } catch (e) { next(e); }
});

// Cambio manual de estado (sobre todo para forzar "pagado" sin esperar al
// hook automático del cobro/pago).
app.post('/api/viajes/:id/estado', requireCompany, requirePermission('logistica:update'), async (req, res, next) => {
  try {
    const { estado } = z.object({ estado: z.enum(['pendiente','cargado','descargado','facturado','pagado']) }).parse(req.body);
    const existing = await prisma.viaje.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    const row = await prisma.viaje.update({ where: { id: req.params.id }, data: { estado } });
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
    localidad: z.string().nullable().optional(),
    provincia: z.string().nullable().optional(),
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
  { codigo:'otro_gasto', nombre:'Otro gasto',              mov:'gasto',    modo:'monto', unidad:null, orden:4, especial:false },
];
async function seedCategoriasPlanilla(companyId) {
  const n = await prisma.categoriaPlanilla.count({ where: { companyId } });
  if (n > 0) return;
  await prisma.categoriaPlanilla.createMany({
    data: CATEGORIAS_PLANILLA_DEFAULT.map(c => ({ ...c, companyId })),
    skipDuplicates: true,
  });
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
  medioPago: z.enum(['efectivo', 'cheque', 'transferencia']),
  caja: z.string().nullable().optional(),
  banco: z.string().nullable().optional(),
  nroCheque: z.string().nullable().optional(),
  referencia: z.string().nullable().optional(),
  incluirSueldoBase: z.boolean().optional(),
  observaciones: z.string().nullable().optional(),
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

    if (d.medioPago === 'efectivo' && !d.caja) {
      return res.status(400).json({ ok: false, error: 'Elegí la caja de la que sale el pago en efectivo' });
    }
    if (d.medioPago === 'cheque' && !d.nroCheque) {
      return res.status(400).json({ ok: false, error: 'Ingresá el número de cheque' });
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

      // Sólo generamos el pago en otros módulos si el neto es positivo.
      if (neto > 0 && d.medioPago === 'efectivo') {
        const ef = await tx.efectivo.create({
          data: {
            companyId: req.companyId,
            fecha: d.fecha,
            tipo: 'egreso',
            concepto: `Sueldo ${nombreCompleto} · ${d.periodo}`,
            monto: neto,
            caja: d.caja,
            clasificacion: 'empresa',
            observaciones: `Liquidación de sueldo ${d.periodo}`,
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
          caja: d.medioPago === 'efectivo' ? d.caja : null,
          banco: d.medioPago !== 'efectivo' ? (d.banco || null) : null,
          nroCheque: d.medioPago === 'cheque' ? d.nroCheque : null,
          referencia: d.referencia || null,
          efectivoId,
          chequeId,
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

// Lista de movimientos de hacienda (puede filtrar por campo y/o categoría).
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

// Edición general de un movimiento de hacienda (campos seguros). Para movimientos
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
// Asegura que cada categoría de hacienda tenga un Producto del catálogo
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
    activo: z.boolean().optional(),
  }),
  orderBy: { nombre: 'asc' },
  searchFields: ['nombre', 'codigo', 'tipo'],
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
      fecha: z.coerce.date(),
      numero: z.string().nullable().optional(),
      kilosBrutos: z.number().nonnegative(),
      porcMerma: z.number().min(0).max(100).default(0),
      precioPorTn: z.number().nonnegative(),
      conceptos: z.array(concSchema).default([]),
      fechaCobroEst: z.coerce.date().nullable().optional(),
      observaciones: z.string().nullable().optional(),
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
          clienteId: d.clienteId || null, fecha: d.fecha, numero: d.numero || null,
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
          referencia: d.numero || null,
          observaciones: `Liquidación cereal — neto ${neto.toFixed(2)}`,
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
            referencia: `LIQ-${liq.id.slice(-6).toUpperCase()}`,
            debe: neto,           // el cliente nos debe el neto a cobrar
            haber: 0,
            vencimiento: d.fechaCobroEst || null,
            categoria: 'liquidacion_cereal',
          },
        });
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
      include: { cuotas: { orderBy: { numero: 'asc' } } },
    });
    if (!data) return res.status(404).json({ ok: false, error: 'No encontrado' });
    res.json({ ok: true, data });
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
      medioPago: z.enum(['efectivo', 'cheque', 'transferencia', 'debito_automatico']).optional(),
      referencia: z.string().nullable().optional(),
      observaciones: z.string().nullable().optional(),
      cuentaBancoId: z.string().nullable().optional(),    // si el pago salió de una cuenta bancaria
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
      return row;
    });
    res.json({ ok: true, data: result, importePagadoArs: importeArs });
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
      campanaId: z.string(),
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
    const camp = await prisma.campana.findFirst({ where: { id: d.campanaId, companyId: req.companyId } });
    if (!camp) return res.status(404).json({ ok: false, error: 'Campaña no encontrada' });

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
          campanaId: d.campanaId, tipo: d.tipo, fecha: d.fecha,
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

  // 5) Arrendamientos
  const arrs = await prisma.arrendamiento.findMany({
    where: { companyId: { in: companyIds }, vencimiento: { not: null }, pagado: false },
    include: { campo: { select: { nombre: true } } },
  });
  for (const a of arrs) {
    const importe = (Number(a.hectareas || 0) * Number(a.importeHa || 0)) || 0;
    push(a.vencimiento, {
      tipo: 'egreso', categoria: 'arrendamiento',
      concepto: `Arrendamiento ${a.propietario}${a.campo?.nombre ? ' · ' + a.campo.nombre : ''}`,
      importe, ref: a.id, contacto: a.propietario,
      empresaId: a.companyId,
    });
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
  observaciones: z.string().nullable().optional(),
  activo: z.boolean().optional(),
});

// Devuelve cuentas con saldo calculado (saldoInicial + Σ ingresos − Σ egresos).
app.get('/api/banco-cuentas', requireCompany, requirePermission('finanzas:read'), async (req, res, next) => {
  try {
    const cuentas = await prisma.bancoCuenta.findMany({
      where: { companyId: req.companyId },
      orderBy: [{ activo: 'desc' }, { banco: 'asc' }],
    });
    const movs = await prisma.bancoMovimiento.groupBy({
      by: ['cuentaId', 'tipo'],
      where: { companyId: req.companyId },
      _sum: { monto: true },
    });
    const data = cuentas.map(c => {
      let saldo = Number(c.saldoInicial || 0);
      movs.filter(m => m.cuentaId === c.id).forEach(m => {
        const monto = Number(m._sum?.monto || 0);
        if (BANCO_TIPOS_INGRESO.includes(m.tipo)) saldo += monto;
        else if (BANCO_TIPOS_EGRESO.includes(m.tipo)) saldo -= monto;
      });
      return { ...c, saldo };
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
      metodo: z.enum(['efectivo', 'cheque', 'transferencia', 'debito', 'externo', 'intercompany']),
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

    if (d.metodo === 'efectivo' || d.metodo === 'externo') {
      // "externo" (billetera virtual / medio externo) se registra como una caja
      // del módulo Efectivo (el nombre del medio es la caja). NO toca bancos.
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

app.post('/api/banco-movimientos', requireCompany, requirePermission('finanzas:create'), async (req, res, next) => {
  try {
    const d = bancoMovSchema.parse(req.body);
    const cuenta = await prisma.bancoCuenta.findFirst({ where: { id: d.cuentaId, companyId: req.companyId } });
    if (!cuenta) return res.status(404).json({ ok: false, error: 'Cuenta no encontrada' });
    // Transferencia interna: validar cuenta destino y crear el espejo en transacción
    const esTransferInterna = (d.tipo === 'transferencia_out' || d.tipo === 'transferencia_in') && d.cuentaContraId;
    if (esTransferInterna) {
      const otra = await prisma.bancoCuenta.findFirst({ where: { id: d.cuentaContraId, companyId: req.companyId } });
      if (!otra) return res.status(400).json({ ok: false, error: 'Cuenta destino no encontrada' });
      if (d.cuentaContraId === d.cuentaId) return res.status(400).json({ ok: false, error: 'Origen y destino deben ser distintos' });
      const result = await prisma.$transaction(async (tx) => {
        const outMov = await tx.bancoMovimiento.create({
          data: {
            companyId: req.companyId, cuentaId: d.cuentaId, fecha: d.fecha,
            tipo: 'transferencia_out', concepto: d.concepto, monto: d.monto,
            contraparte: otra.banco + (otra.alias ? ' · ' + otra.alias : ''),
            referencia: d.referencia || null, cuentaContraId: d.cuentaContraId,
            observaciones: d.observaciones || null, userId: req.user?.id || null,
          },
        });
        const inMov = await tx.bancoMovimiento.create({
          data: {
            companyId: req.companyId, cuentaId: d.cuentaContraId, fecha: d.fecha,
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
            companyId: req.companyId, cuentaId: d.cuentaId, fecha: d.fecha,
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
      data: { ...rest, companyId: req.companyId, userId: req.user?.id || null },
    });
    res.status(201).json({ ok: true, data: row });
  } catch (e) { next(e); }
});

app.put('/api/banco-movimientos/:id', requireCompany, requirePermission('finanzas:update'), async (req, res, next) => {
  try {
    const existing = await prisma.bancoMovimiento.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    const schema = bancoMovSchema.partial().extend({ conciliado: z.boolean().optional(), syncMirror: z.boolean().optional() });
    const parsed = schema.parse(req.body);
    // syncMirror y cajaEfectivo no son columnas del movimiento.
    const { syncMirror, cajaEfectivo, ...d } = parsed;
    const esTransfer = (existing.tipo === 'transferencia_in' || existing.tipo === 'transferencia_out') && existing.cuentaContraId;
    if (esTransfer && syncMirror) {
      // Actualiza también el movimiento espejo de la otra cuenta (mismos monto/fecha/concepto/obs).
      const otroTipo = existing.tipo === 'transferencia_in' ? 'transferencia_out' : 'transferencia_in';
      const result = await prisma.$transaction(async (tx) => {
        const row = await tx.bancoMovimiento.update({ where: { id: req.params.id }, data: d });
        await tx.bancoMovimiento.updateMany({
          where: {
            companyId: req.companyId, cuentaId: existing.cuentaContraId, cuentaContraId: existing.cuentaId,
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
    const existing = await prisma.bancoMovimiento.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    // Si fue parte de una transferencia interna, borrar también el espejo
    if (existing.cuentaContraId && (existing.tipo === 'transferencia_in' || existing.tipo === 'transferencia_out')) {
      const otroTipo = existing.tipo === 'transferencia_in' ? 'transferencia_out' : 'transferencia_in';
      await prisma.bancoMovimiento.deleteMany({
        where: { companyId: req.companyId, cuentaId: existing.cuentaContraId, cuentaContraId: existing.cuentaId,
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
    resultado.iva21  = matchEtiqueta('IVA\\s*21\\s*%?') || resultado.iva21;
    resultado.iva105 = matchEtiqueta('IVA\\s*10[.,]5\\s*%?') || resultado.iva105;
    resultado.iva27  = matchEtiqueta('IVA\\s*27\\s*%?') || resultado.iva27;
    resultado.iva25  = matchEtiqueta('IVA\\s*2[.,]5\\s*%?') || resultado.iva25;
    resultado.iva5   = matchEtiqueta('IVA\\s*5\\s*%?') || resultado.iva5;

    // CUIT emisor: el que aparece DESPUÉS de "CUIT:" (suelen ser 2: emisor primero, después receptor)
    // Si el QR ya nos lo dio, usamos ese para identificar el otro como receptor.
    const reCuitLine = /C\.?U\.?I\.?T\.?\s*:?\s*(\d{2}[-]?\d{8}[-]?\d{1})/gi;
    const cuitsEnContexto = [...texto.matchAll(reCuitLine)].map(m => m[1].replace(/-/g,''));
    if (cuitsEnContexto.length >= 1 && !resultado.cuitEmisor) {
      resultado.cuitEmisor = cuitsEnContexto[0];
    }
    if (cuitsEnContexto.length >= 2 && !resultado.cuitReceptor) {
      // Receptor = el segundo CUIT que aparece bajo "CUIT:"
      resultado.cuitReceptor = cuitsEnContexto.find(c => c !== resultado.cuitEmisor) || cuitsEnContexto[1];
    }

    // Razón social emisor: buscamos "Razón Social: NOMBRE" antes del CUIT emisor
    const mRsE = texto.match(/Raz[oó]n\s+Social\s*:?\s*([^\n]+)/i);
    if (mRsE) resultado.razonSocialEmisor = mRsE[1].trim().replace(/\s{2,}/g, ' ').slice(0, 120);
    // Razón social receptor: a veces aparece como "Apellido y Nombre / Razón Social:"
    const mRsR = texto.match(/Apellido\s+y\s+Nombre\s*\/\s*Raz[oó]n\s+Social\s*:?\s*([^\n]+)/i);
    if (mRsR) resultado.razonSocialReceptor = mRsR[1].trim().replace(/\s{2,}/g, ' ').slice(0, 120);

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
      metodo: z.enum(['efectivo', 'cheque', 'transferencia', 'intercompany', 'cereal']),
      monto: z.number().positive(),
      fecha: z.coerce.date(),
      cajaOrigen: z.string().nullable().optional(),
      chequeId: z.string().nullable().optional(),
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
    // d.monto = lo que efectivamente sale de caja/banco (en monedaPago). Si se paga
    // en la MISMA moneda de la deuda, debe coincidir con la suma aplicada. Si se paga
    // en otra moneda (ej: deuda USD, pago ARS), son magnitudes distintas y no se exige igualdad.
    const _mismaMoneda = !d.monedaPago;
    if (d.comprobantes.length && _mismaMoneda && Math.abs(sumaAplicada - d.monto) > 0.01) {
      return res.status(400).json({ ok: false, error: 'La suma de los comprobantes (' + sumaAplicada + ') no coincide con el monto pagado (' + d.monto + ')' });
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
        // Marcar como pagado si se cancela todo el saldo del comprobante.
        if (Math.abs(c.importeAplicado - saldoPendiente) < 0.01) {
          await tx.ctaCte.update({ where: { id: cc.id }, data: { pagado: true } });
        }
        // Contra-asiento: haber = importeAplicado (reduce debe-haber), en la moneda de la deuda.
        await tx.ctaCte.create({ data: {
          companyId: req.companyId,
          contactoTipo: 'proveedor', contactoId: d.proveedorId,
          fecha: d.fecha,
          detalle: 'Pago de ' + (cc.detalle || 'comprobante ' + cc.id.slice(-6)),
          moneda: cc.moneda || 'ARS', cotizacion: cc.cotizacion ?? null,
          haber: c.importeAplicado,
          referencia: cc.referencia,
          observaciones: 'Pago via ' + d.metodo + (d.observaciones ? ' · ' + d.observaciones : ''),
        }});
      }
      // Pago "a cuenta" (sin comprobantes): haber suelto en la cta cte del proveedor.
      // Reduce el saldo y, si excede la deuda, deja saldo a favor.
      if (d.comprobantes.length === 0) {
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

      // 2. Registrar el movimiento del recurso usado
      if (d.metodo === 'cheque') {
        if (!d.chequeId) throw new Error('Falta chequeId para pago con cheque');
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

      return { ok: true, comprobantesAplicados: d.comprobantes.length };
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
      metodo: z.enum(['efectivo', 'cheque', 'transferencia', 'intercompany']),
      monto: z.number().positive(),
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
    if (d.comprobantes.length && !d.monedaPago && Math.abs(sumaAplicada - d.monto) > 0.01) {
      return res.status(400).json({ ok: false, error: 'La suma de comprobantes no coincide con el monto cobrado' });
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
      for (const c of d.comprobantes) {
        const cc = await tx.ctaCte.findFirst({ where: { id: c.ctaCteId, companyId: req.companyId, contactoTipo: 'cliente', contactoId: d.clienteId } });
        if (!cc) throw new Error('Comprobante no encontrado');
        const saldoPendiente = Number(cc.debe || 0) - Number(cc.haber || 0);
        if (c.importeAplicado > saldoPendiente + 0.01) throw new Error('Importe excede saldo pendiente');
        monedaDeuda = cc.moneda || 'ARS';
        const cotDeuda = (cc.moneda && cc.moneda !== 'ARS') ? (cc.cotizacion ?? null) : 1;
        if (cotDeuda == null) deudaArsConocida = false; else deudaArs += c.importeAplicado * cotDeuda;
        if (Math.abs(c.importeAplicado - saldoPendiente) < 0.01) {
          await tx.ctaCte.update({ where: { id: cc.id }, data: { pagado: true } });
        }
        await tx.ctaCte.create({ data: {
          companyId: req.companyId,
          contactoTipo: 'cliente', contactoId: d.clienteId,
          fecha: d.fecha,
          detalle: 'Cobro de ' + (cc.detalle || 'comprobante ' + cc.id.slice(-6)),
          moneda: cc.moneda || 'ARS', cotizacion: cc.cotizacion ?? null,
          haber: c.importeAplicado,
          referencia: cc.referencia,
          observaciones: 'Cobro via ' + d.metodo + (d.observaciones ? ' · ' + d.observaciones : ''),
        }});
      }
      // Cobro "a cuenta" (sin comprobantes): haber suelto en la cta cte del cliente.
      if (d.comprobantes.length === 0) {
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
      // Registrar el recurso recibido
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
      return { ok: true, comprobantesAplicados: d.comprobantes.length };
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
    descripcion: 'Stock de hacienda por campo/Renspa. Una hoja por establecimiento.',
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
    descripcion: 'Ventas de hacienda menor. Una hoja por categoria.',
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
    return new Date(epoch.getTime() + v * 86400000);
  }
  const s = String(v).trim();
  // dd/mm/yyyy o dd/mm/yy
  const m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (m) {
    let yyyy = +m[3]; if (yyyy < 100) yyyy += 2000;
    return new Date(yyyy, +m[2]-1, +m[1]);
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
          await prisma.cheque.create({ data: {
            companyId: req.companyId,
            tipo: 'terceros',
            formato: /electron/i.test(r['Tipo de cheque'] || '') ? 'electronico' : 'fisico',
            banco: r['Banco Emisor'] || null,
            nroCheque: String(nro),
            fechaEmision: _parseFechaArg(r['Fecha de recepcion '] || r['Fecha de entrega']) || new Date(),
            fechaPago:    _parseFechaArg(r['Fecha de pago']) || new Date(),
            monto: _parseMonto(r['Monto']) || 0,
            librador: r['Titular'] || null,
            beneficiario: r['Destino'] || null,
            estado: _normalizar(r['Estado'] || '').includes('depositad') ? 'depositado'
                  : _normalizar(r['Estado'] || '').includes('cobrad') ? 'cobrado'
                  : 'en_cartera',
            observaciones: [r['Origen'] && `Origen: ${r['Origen']}`, r['Destino'] && `Destino: ${r['Destino']}`, r['Quien lo recibe '] && `Recibido por: ${r['Quien lo recibe ']}`].filter(Boolean).join(' · ') || null,
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
          const estadoTxt = _normalizar(r['Destino del cheque'] || r['Estado'] || '');
          await prisma.cheque.create({ data: {
            companyId: req.companyId,
            tipo: 'terceros',
            formato: 'electronico',
            banco: r['Banco'] || null,
            nroCheque: String(nro),
            fechaEmision: _parseFechaArg(r['Fecha de pago']) || new Date(),
            fechaPago:    _parseFechaArg(r['Fecha de pago']) || new Date(),
            monto: _parseMonto(r['Importe']) || 0,
            librador: r['Titular'] || null,
            beneficiario: r['A quien se endoso'] || null,
            estado: estadoTxt.includes('endosad') ? 'endosado'
                  : estadoTxt.includes('depositad') ? 'depositado'
                  : estadoTxt.includes('cobrad') || estadoTxt.includes('pagad') ? 'cobrado'
                  : 'en_cartera',
            observaciones: [r['empresa'] && `Empresa: ${r['empresa']}`, r['Endosante'] && `Endosante: ${r['Endosante']}`, r['Fecha del movimiento del endoso'] && `Endoso: ${r['Fecha del movimiento del endoso']}`].filter(Boolean).join(' · ') || null,
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
            observaciones: r['empresa'] ? `Empresa: ${r['empresa']}` : null,
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
    let ok = 0; const errores = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        if (!r['N° Carta Porte'] && !r['N° CTG']) continue;
        await prisma.viaje.create({ data: {
          companyId: req.companyId,
          fecha: _parseFechaArg(r['Fecha']) || new Date(),
          producto: r['Producto'] || null,
          chofer: r['Chofer'] || null,
          destino: r['Destinatario'] || r['Destino'] || null,
          cartaPorte: r['N° Carta Porte'] ? String(r['N° Carta Porte']) : null,
          ctg: r['N° CTG'] ? String(r['N° CTG']) : null,
          cantidad: _parseMonto(r['P.N Final'] || r['P.N CP']),
          flete: _parseMonto(r['Flete pagador']),
          estado: 'descargado',
          observaciones: [r['Campaña'] && `Campaña ${r['Campaña']}`, r['Titular Carta Porte'] && `Titular: ${r['Titular Carta Porte']}`, r['Rte. Comercial Venta Primaria'] && `Rte: ${r['Rte. Comercial Venta Primaria']}`].filter(Boolean).join(' · ') || null,
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