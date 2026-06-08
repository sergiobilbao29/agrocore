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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = process.env.STATIC_DIR || path.resolve(__dirname, '..', '..');

const prisma = new PrismaClient();
const app = express();

// Versión actual del sistema. Se incrementa con cada release.
// Endpoint /api/system/version la expone para que el frontend la muestre
// y para que el script Update-AgroCore.ps1 compare antes de pullear.
const AGROCORE_VERSION = '0.7.0';
const AGROCORE_BUILD = new Date('2026-06-08').toISOString().slice(0, 10);

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
    res.status(201).json({ ok: true, data: c });
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
    if (existing.builtin) return res.status(400).json({ ok: false, error: 'Rol de sistema no editable' });
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
    const where = req.user.superAdmin ? {} : { userCompanies: { some: { companyId: req.companyId } } };
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
    const productos = await prisma.producto.findMany({
      where: { companyId: req.companyId, activo: true },
      orderBy: { nombre: 'asc' },
    });
    const movs = await prisma.movimiento.groupBy({
      by: ['productoId', 'tipo'],
      where: { companyId: req.companyId },
      _sum: { cantidad: true },
    });
    const data = productos.map((p) => {
      const ing = movs.find((m) => m.productoId === p.id && m.tipo === 'ingreso')?._sum?.cantidad || 0;
      const egr = movs.find((m) => m.productoId === p.id && m.tipo === 'egreso')?._sum?.cantidad || 0;
      const existencia = Number(ing) - Number(egr);
      return { ...p, existencia, bajoMinimo: existencia < Number(p.stockMinimo || 0) };
    });
    res.json({ ok: true, data });
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
    observaciones: z.string().nullable().optional(),
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
        unidadHa: x.cantidad, precioUnit: null,
        costoHa: x.costo, hectareasAplicadas: x.hectareasAplicadas,
        fecha: x.fecha, observaciones: x.observaciones })),
      ...lab.map(x => ({ id: x.id, campanaId: x.campanaId, tipo: 'labor',
        item: x.tipo, subtipo: null,
        unidadHa: null, precioUnit: null,
        costoHa: x.costo, hectareasAplicadas: x.hectareasAplicadas,
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
      const row = await prisma.insumoAplicado.create({
        data: { campanaId: d.campanaId, nombre: d.item, cantidad: d.unidadHa || 0,
          unidad: d.subtipo || 'u/ha', fecha, costo: d.costoHa || 0,
          hectareasAplicadas: d.hectareasAplicadas ?? null,
          observaciones: d.observaciones || null },
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
app.delete('/api/aplicaciones/:id', requireCompany, requirePermission('produccion:delete'), async (req, res, next) => {
  try {
    const id = req.params.id;
    // Intentar borrar como insumo, si no existe probar como labor
    const ins = await prisma.insumoAplicado.findFirst({ where: { id, campana: { companyId: req.companyId } } });
    if (ins) { await prisma.insumoAplicado.delete({ where: { id } }); return res.json({ ok: true }); }
    const lab = await prisma.laborAplicada.findFirst({ where: { id, campana: { companyId: req.companyId } } });
    if (lab) { await prisma.laborAplicada.delete({ where: { id } }); return res.json({ ok: true }); }
    res.status(404).json({ ok: false, error: 'No encontrado' });
  } catch (e) { next(e); }
});

mountCrud({
  path: 'campanas', modelName: 'campana', perm: 'produccion',
  schema: z.object({
    loteId: z.string(),
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
  searchFields: ['cultivo', 'variedad', 'ciclo'],
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
             alicuotaIva: alic, subtotal: sub, ivaImporte: ivaImp, total: sub + ivaImp };
  });
  return { items: det, subtotal, iva, total: subtotal + iva };
}

// Helpers para generar/borrar movimientos de stock asociados a facturas.
// Usamos el campo `referencia` del Movimiento como link inverso: "VTA-{facturaId}" o "CPR-{facturaCompraId}".
async function crearMovimientosDesdeFactura(tx, { companyId, factura, tipo, motivo, contraparteId, contraparteTipo, refPrefix, userId }) {
  // tipo = "ingreso" (compra) o "egreso" (venta)
  const items = (factura.items || []).filter(it => it.productoId);
  if (!items.length) return 0;
  const ref = `${refPrefix}-${factura.id}`;
  const data = items.map(it => ({
    companyId, productoId: it.productoId,
    fecha: factura.fecha, tipo, motivo,
    cantidad: Number(it.cantidad),
    precio: Number(it.precioUnit) || null,
    total: Number(it.subtotal) || null,
    contraparteId: contraparteId || null,
    contraparteTipo: contraparteTipo || null,
    referencia: ref,
    observaciones: `Generado automaticamente por ${motivo} ${factura.tipo} ${String(factura.puntoVenta).padStart(4,'0')}-${String(factura.numero).padStart(8,'0')}`,
    userId: userId || null,
  }));
  await tx.movimiento.createMany({ data });
  return items.length;
}

async function borrarMovimientosDeFactura(tx, { companyId, refPrefix, facturaId }) {
  return tx.movimiento.deleteMany({
    where: { companyId, referencia: `${refPrefix}-${facturaId}` },
  });
}

// Genera el movimiento de Cuenta Corriente al crear una factura. El campo
// `referencia` (FAC-{id} o FACC-{id}) sirve de link inverso para poder
// borrarlo si la factura se anula o elimina.
async function crearCtaCteDesdeFactura(tx, { companyId, factura, contactoTipo, contactoId, refPrefix, motivo }) {
  if (!contactoId) return; // sin cliente/proveedor registrado no hay cuenta corriente
  const compNum = `${String(factura.puntoVenta).padStart(4, '0')}-${String(factura.numero).padStart(8, '0')}`;
  await tx.ctaCte.create({
    data: {
      companyId,
      contactoTipo, contactoId,
      fecha: factura.fecha,
      detalle: `${motivo} ${factura.tipo} ${compNum}`,
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

const itemFacSchema = z.object({
  productoId: z.string().nullable().optional(),
  descripcion: z.string().min(1), cantidad: z.number(),
  precioUnit: z.number(), alicuotaIva: z.number().optional(),
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
    const totales = calcFactura(input.items);
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
      const f = await tx.factura.create({
        data: {
          companyId: req.companyId, clienteId: input.clienteId || null,
          tipo: input.tipo, puntoVenta: input.puntoVenta, numero: input.numero, fecha: input.fecha,
          condicionVenta: input.condicionVenta, observaciones: input.observaciones,
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
        userId: req.user?.id || null,
      });
      // Movimiento de cuenta corriente: el cliente queda debiendo el total.
      await crearCtaCteDesdeFactura(tx, {
        companyId: req.companyId, factura: f,
        contactoTipo: 'cliente', contactoId: input.clienteId || null,
        refPrefix: 'FAC', motivo: 'Factura',
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
      puntoVenta: z.number().int(),
      numero: z.number().int(),
      fecha: z.coerce.date(),
      condicionCompra: z.string().nullable().optional(),
      observaciones: z.string().nullable().optional(),
      items: z.array(itemFacSchema).min(1),
    });
    const input = schema.parse(req.body);
    const totales = calcFactura(input.items);
    // Transaccion: crear factura compra + sumar stock con movimientos ingreso.
    const factura = await prisma.$transaction(async (tx) => {
      const f = await tx.facturaCompra.create({
        data: {
          companyId: req.companyId, proveedorId: input.proveedorId || null,
          tipo: input.tipo, puntoVenta: input.puntoVenta, numero: input.numero, fecha: input.fecha,
          condicionCompra: input.condicionCompra, observaciones: input.observaciones,
          subtotal: totales.subtotal, iva: totales.iva, total: totales.total,
          items: { create: totales.items },
        },
        include: { proveedor: true, items: true },
      });
      await crearMovimientosDesdeFactura(tx, {
        companyId: req.companyId, factura: f, tipo: 'ingreso', motivo: 'compra',
        contraparteId: input.proveedorId || null, contraparteTipo: 'proveedor', refPrefix: 'CPR',
        userId: req.user?.id || null,
      });
      // Movimiento de cuenta corriente: le quedamos debiendo al proveedor.
      await crearCtaCteDesdeFactura(tx, {
        companyId: req.companyId, factura: f,
        contactoTipo: 'proveedor', contactoId: input.proveedorId || null,
        refPrefix: 'FACC', motivo: 'Compra',
      });
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
    estado: z.string().optional(),
    observaciones: z.string().nullable().optional(),
  }),
  orderBy: { fechaPago: 'asc' },
  searchFields: ['nroCheque', 'banco', 'beneficiario', 'librador'],
});

// ============================================================
// CHEQUE → BANCO: cambiar estado del cheque y, si corresponde, generar
// (o eliminar) el movimiento bancario asociado.
//   Tercero depositado/cobrado → INGRESO en cuenta (cheque_cobrado)
//   Propio   pagado/cobrado    → EGRESO en cuenta (cheque_pagado)
// Si vuelve a "en cartera"/"emitido"/"anulado"/"rechazado": elimina el movimiento.
// ============================================================
const CHEQUE_BANCO_ESTADOS_INGRESO = new Set(['depositado', 'cobrado']); // terceros
const CHEQUE_BANCO_ESTADOS_EGRESO  = new Set(['pagado', 'cobrado']);     // propios

function _chequeMovTipo(cheque) {
  if (cheque.tipo === 'terceros' && CHEQUE_BANCO_ESTADOS_INGRESO.has(cheque.estado)) return 'cheque_cobrado';
  if (cheque.tipo === 'propio'   && CHEQUE_BANCO_ESTADOS_EGRESO.has(cheque.estado))  return 'cheque_pagado';
  return null;
}

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
        data: { estado: d.estado },
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
    propietario: z.string().min(1),
    hectareas: z.number(),
    importeHa: z.number().nullable().optional(),
    tipoPago: z.string().nullable().optional(),
    vencimiento: z.coerce.date().nullable().optional(),
    pagado: z.boolean().optional(),
    observaciones: z.string().nullable().optional(),
  }),
  orderBy: { vencimiento: 'asc' },
  searchFields: ['propietario'],
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
    const estadosPendientes = ['en cartera', 'emitido', 'depositado'];

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
        efectivo: { saldo: saldoEfectivo, movimientos: ef.length },
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
  cdp: z.string().nullable().optional(),
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
        declarado: d.declarado || 0, observaciones: d.observaciones || null,
      },
      update: {
        declarado: d.declarado ?? 0,
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
const HAC_TIPOS = ['nacimiento','muerte','compra','venta','traslado','ajuste'];
const hacMovSchema = z.object({
  campoId: z.string(),
  categoria: z.string().min(1),
  fecha: z.coerce.date(),
  tipo: z.enum(HAC_TIPOS),
  cantidad: z.number().int(),  // permite negativo para ajuste; resto positivos
  campoDestino: z.string().nullable().optional(),  // requerido si tipo='traslado'
  observaciones: z.string().nullable().optional(),
});

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

    // Para los demás tipos: positivos salvo "ajuste" (puede ser +/-).
    if (d.tipo !== 'ajuste' && d.cantidad <= 0) {
      return res.status(400).json({ ok: false, error: 'La cantidad debe ser positiva' });
    }
    const row = await prisma.haciendaMovimiento.create({
      data: {
        companyId: req.companyId, campoId: d.campoId, categoria: d.categoria,
        fecha: d.fecha, tipo: d.tipo, cantidad: d.cantidad,
        observaciones: d.observaciones || null,
      },
    });
    res.status(201).json({ ok: true, data: row });
  } catch (e) { next(e); }
});

app.delete('/api/hacienda-movimientos/:id', requireCompany, requirePermission('stock:delete'), async (req, res, next) => {
  try {
    const existing = await prisma.haciendaMovimiento.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    await prisma.haciendaMovimiento.delete({ where: { id: req.params.id } });
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
      return {
        campoId, categoria,
        stockId: decl ? decl.id : null,
        declarado, real: r,
        diferencia: r - declarado,
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

mountCrud({
  path: 'catalogos', modelName: 'catalogo', perm: 'catalogos',
  schema: z.object({
    tipo: z.string().min(1),
    codigo: z.string().nullable().optional(),
    nombre: z.string().min(1),
    descripcion: z.string().nullable().optional(),
    precioReferencia: z.number().nullable().optional(),
    tipoPrecio: z.enum(['por_hectarea', 'total']).nullable().optional(),
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
app.use('/web', express.static(WEB_PUBLIC));
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

app.get('/api/depositos', requireCompany, requirePermission('stock:read'), async (req, res, next) => {
  try {
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
function _calcularCuotasFrances({ monto, tasaAnual, cantCuotas, periodicidad }) {
  // tasa por período (mensual, bimestral, etc.)
  const factor = { mensual: 12, bimestral: 6, trimestral: 4, semestral: 2 }[periodicidad] || 12;
  const i = (tasaAnual || 0) / 100 / factor;
  let cuotaTotal;
  if (i === 0) {
    cuotaTotal = monto / cantCuotas;
  } else {
    cuotaTotal = monto * (i * Math.pow(1 + i, cantCuotas)) / (Math.pow(1 + i, cantCuotas) - 1);
  }
  // Generar el plan: cada cuota con capital + interés del saldo restante
  let saldo = monto;
  const cuotas = [];
  for (let n = 1; n <= cantCuotas; n++) {
    const interes = saldo * i;
    const capital = cuotaTotal - interes;
    saldo -= capital;
    cuotas.push({ numero: n, capital: Math.max(capital, 0), interes: Math.max(interes, 0), total: cuotaTotal });
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

app.post('/api/creditos', requireCompany, requirePermission('finanzas:create'), async (req, res, next) => {
  try {
    const schema = z.object({
      banco: z.string().min(1),
      nroOperacion: z.string().nullable().optional(),
      montoOriginal: z.number().positive(),
      tasaAnual: z.number().nullable().optional(),
      cantCuotas: z.number().int().positive(),
      periodicidad: z.enum(['mensual', 'bimestral', 'trimestral', 'semestral']).default('mensual'),
      fechaPrimera: z.coerce.date(),
      destino: z.string().nullable().optional(),
      observaciones: z.string().nullable().optional(),
    });
    const d = schema.parse(req.body);
    const cuotas = _calcularCuotasFrances({
      monto: d.montoOriginal, tasaAnual: d.tasaAnual || 0,
      cantCuotas: d.cantCuotas, periodicidad: d.periodicidad,
    });
    const monthsStep = { mensual: 1, bimestral: 2, trimestral: 3, semestral: 6 }[d.periodicidad];
    const result = await prisma.$transaction(async (tx) => {
      const cred = await tx.credito.create({
        data: {
          companyId: req.companyId, banco: d.banco, nroOperacion: d.nroOperacion || null,
          montoOriginal: d.montoOriginal, tasaAnual: d.tasaAnual || null,
          cantCuotas: d.cantCuotas, periodicidad: d.periodicidad,
          fechaPrimera: d.fechaPrimera, destino: d.destino || null,
          observaciones: d.observaciones || null,
        },
      });
      const cuotasData = cuotas.map(c => {
        const venc = new Date(d.fechaPrimera);
        venc.setMonth(venc.getMonth() + (c.numero - 1) * monthsStep);
        return {
          creditoId: cred.id, numero: c.numero, vencimiento: venc,
          importeCapital: c.capital, importeInteres: c.interes,
          importeOtros: 0, importeTotal: c.total,
        };
      });
      await tx.cuotaCredito.createMany({ data: cuotasData });
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
      destino: z.string().nullable().optional(),
      estado: z.enum(['activo', 'cancelado', 'refinanciado']).optional(),
      observaciones: z.string().nullable().optional(),
    });
    const d = schema.parse(req.body);
    const row = await prisma.credito.update({ where: { id: req.params.id }, data: d });
    res.json({ ok: true, data: row });
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
    });
    const d = schema.parse(req.body || {});
    const fechaPago = d.fechaPago || new Date();
    const result = await prisma.$transaction(async (tx) => {
      const row = await tx.cuotaCredito.update({
        where: { id: req.params.cuotaId },
        data: { pagada: true, fechaPago, medioPago: d.medioPago || null, referencia: d.referencia || null, observaciones: d.observaciones || null },
      });
      // Si pagó por transferencia o débito automático y eligió cuenta bancaria,
      // dejamos el movimiento en el extracto del banco.
      if ((d.medioPago === 'transferencia' || d.medioPago === 'debito_automatico') && d.cuentaBancoId) {
        const cuenta = await tx.bancoCuenta.findFirst({ where: { id: d.cuentaBancoId, companyId: req.companyId } });
        if (cuenta) {
          await tx.bancoMovimiento.create({
            data: {
              companyId: req.companyId, cuentaId: d.cuentaBancoId,
              fecha: fechaPago, tipo: 'cuota_credito',
              concepto: `Cuota ${cuota.numero} · ${credito.banco}${credito.nroOperacion ? ' #' + credito.nroOperacion : ''}`,
              monto: Number(cuota.importeTotal || 0),
              contraparte: credito.banco, referencia: d.referencia || null,
              cuotaCreditoId: cuota.id, observaciones: d.observaciones || null,
              userId: req.user?.id || null,
            },
          });
        }
      }
      return row;
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
      campanaId: z.string(),
      tipo: z.string().min(1),
      fecha: z.coerce.date(),
      hectareasAplicadas: z.number().nullable().optional(),
      costo: z.number().nullable().optional(),
      observaciones: z.string().nullable().optional(),
      empleadoId: z.string().nullable().optional(),
      precioReferencia: z.number().nullable().optional(),
      tipoPrecio: z.enum(['por_hectarea', 'total']).nullable().optional(),
      porcentajeEmpleado: z.number().nullable().optional(),
      insumos: z.array(insumoItemSchema).default([]),
    });
    const d = schema.parse(req.body);
    const camp = await prisma.campana.findFirst({ where: { id: d.campanaId, companyId: req.companyId } });
    if (!camp) return res.status(404).json({ ok: false, error: 'Campaña no encontrada' });
    // Cálculo de ganancia del empleado
    let gananciaEmpleado = null;
    let empleado = null;
    if (d.empleadoId) {
      empleado = await prisma.empleado.findFirst({ where: { id: d.empleadoId, companyId: req.companyId } });
      if (!empleado) return res.status(404).json({ ok: false, error: 'Empleado no encontrado' });
      if (empleado.cobraPorcentaje && d.precioReferencia != null && d.porcentajeEmpleado != null) {
        const base = d.tipoPrecio === 'por_hectarea'
          ? (d.hectareasAplicadas || 0) * d.precioReferencia
          : d.precioReferencia;
        gananciaEmpleado = base * (d.porcentajeEmpleado / 100);
      }
    }
    const result = await prisma.$transaction(async (tx) => {
      // 1) Crear la labor
      const labor = await tx.laborAplicada.create({
        data: {
          campanaId: d.campanaId, tipo: d.tipo, fecha: d.fecha,
          hectareasAplicadas: d.hectareasAplicadas ?? null,
          costo: d.costo ?? null,
          observaciones: d.observaciones || null,
          empleadoId: d.empleadoId || null,
          precioReferencia: d.precioReferencia ?? null,
          tipoPrecio: d.tipoPrecio || null,
          porcentajeEmpleado: d.porcentajeEmpleado ?? null,
          gananciaEmpleado,
          responsable: empleado ? `${empleado.nombre} ${empleado.apellido}` : null,
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
      // 3) Ganancia del empleado: si aplica, crear MovimientoEmpleado en la planilla del mes
      if (gananciaEmpleado != null && gananciaEmpleado > 0) {
        const periodo = d.fecha.toISOString().slice(0, 7); // YYYY-MM
        const movEmp = await tx.movimientoEmpleado.create({
          data: {
            companyId: req.companyId, empleadoId: d.empleadoId,
            fecha: d.fecha, periodo, tipo: 'ganancia', categoria: 'labor',
            concepto: `Labor ${d.tipo}${d.hectareasAplicadas ? ' · ' + d.hectareasAplicadas + ' ha' : ''} (${d.porcentajeEmpleado}%)`,
            monto: gananciaEmpleado,
            observaciones: `Generado automáticamente por labor ${labor.id}`,
          },
        });
        await tx.laborAplicada.update({ where: { id: labor.id }, data: { movimientoEmpleadoId: movEmp.id } });
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
app.get('/api/flujo-proyectado', requireCompany, async (req, res, next) => {
  try {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const horizonte = new Date(hoy);
    horizonte.setDate(horizonte.getDate() + Number(req.query.dias || 180));   // 180 días por default
    const items = [];

    // 1) Cheques a depositar (terceros, en cartera, futuros) → ingreso
    //    y cheques propios a pagar (no anulados, no acreditados) → egreso
    const cheques = await prisma.cheque.findMany({
      where: { companyId: req.companyId, fechaPago: { gte: hoy, lte: horizonte } },
    });
    for (const ch of cheques) {
      const estadosOk = ['en_cartera', 'pendiente', 'emitido', 'depositado'];
      if (!estadosOk.includes(ch.estado || '')) continue;
      const esIngreso = ch.tipo === 'terceros';
      items.push({
        fecha: ch.fechaPago, tipo: esIngreso ? 'ingreso' : 'egreso',
        categoria: 'cheque', concepto: `${ch.tipo === 'terceros' ? 'Cheque de terceros' : 'Cheque propio'} ${ch.nroCheque || ''} ${ch.banco || ''}`.trim(),
        importe: Number(ch.monto || 0), ref: ch.id,
        contacto: ch.beneficiario || ch.librador || null,
      });
    }

    // 2) Cuentas corrientes con vencimiento futuro y no pagadas
    const ctas = await prisma.ctaCte.findMany({
      where: { companyId: req.companyId, vencimiento: { gte: hoy, lte: horizonte }, pagado: false },
    });
    for (const c of ctas) {
      const esIngreso = c.tipo === 'debe';   // el cliente nos debe = nos va a entrar
      items.push({
        fecha: c.vencimiento, tipo: esIngreso ? 'ingreso' : 'egreso',
        categoria: 'cta_cte', concepto: c.concepto || 'Cuenta corriente',
        importe: Number(c.importe || 0), ref: c.id,
        contacto: c.contactoTipo + ':' + c.contactoId,
      });
    }

    // 3) Cuotas de créditos no pagadas
    const cuotas = await prisma.cuotaCredito.findMany({
      where: { credito: { companyId: req.companyId }, vencimiento: { gte: hoy, lte: horizonte }, pagada: false },
      include: { credito: { select: { banco: true, nroOperacion: true } } },
    });
    for (const q of cuotas) {
      items.push({
        fecha: q.vencimiento, tipo: 'egreso', categoria: 'credito',
        concepto: `Cuota ${q.numero} · ${q.credito.banco}${q.credito.nroOperacion ? ' #' + q.credito.nroOperacion : ''}`,
        importe: Number(q.importeTotal || 0), ref: q.id,
        contacto: q.credito.banco,
      });
    }

    // 4) Liquidaciones de cereal con fecha estimada de cobro y no cobradas
    const liqs = await prisma.liquidacionCereal.findMany({
      where: { companyId: req.companyId, fechaCobroEst: { gte: hoy, lte: horizonte }, cobrado: false },
      include: { deposito: { select: { nombre: true } } },
    });
    for (const l of liqs) {
      items.push({
        fecha: l.fechaCobroEst, tipo: 'ingreso', categoria: 'cereal',
        concepto: `Liquidación cereal · ${l.deposito.nombre}`,
        importe: Number(l.neto || 0), ref: l.id,
      });
    }

    // 5) Arrendamientos a pagar (no pagados con vencimiento próximo)
    const arrs = await prisma.arrendamiento.findMany({
      where: { companyId: req.companyId, vencimiento: { gte: hoy, lte: horizonte }, pagado: false },
      include: { campo: { select: { nombre: true } } },
    });
    for (const a of arrs) {
      // El importe se calcula como hectáreas × importeHa (cuando aplica)
      const importe = (Number(a.hectareas || 0) * Number(a.importeHa || 0)) || 0;
      items.push({
        fecha: a.vencimiento, tipo: 'egreso', categoria: 'arrendamiento',
        concepto: `Arrendamiento ${a.propietario}${a.campo?.nombre ? ' · ' + a.campo.nombre : ''}`,
        importe, ref: a.id, contacto: a.propietario,
      });
    }

    items.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
    const totalIngresos = items.filter(i => i.tipo === 'ingreso').reduce((a, b) => a + b.importe, 0);
    const totalEgresos = items.filter(i => i.tipo === 'egreso').reduce((a, b) => a + b.importe, 0);
    res.json({ ok: true, data: { items, totalIngresos, totalEgresos, saldo: totalIngresos - totalEgresos, horizonteDias: Number(req.query.dias || 180) } });
  } catch (e) { next(e); }
});

// ============================================================
// BANCOS: cuentas + movimientos. Saldo = saldoInicial + Σ(montos por signo del tipo)
// ============================================================

// Tipos de movimiento: cuáles suman al saldo y cuáles restan.
const BANCO_TIPOS_INGRESO = ['deposito', 'transferencia_in', 'cheque_cobrado', 'credito_acreditado', 'interes'];
const BANCO_TIPOS_EGRESO  = ['extraccion', 'transferencia_out', 'cheque_pagado', 'cuota_credito', 'comision', 'impuesto'];
const BANCO_TIPOS_TODOS   = [...BANCO_TIPOS_INGRESO, ...BANCO_TIPOS_EGRESO, 'otro'];

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

const bancoMovSchema = z.object({
  cuentaId: z.string(),
  fecha: z.coerce.date(),
  tipo: z.enum(BANCO_TIPOS_TODOS),
  concepto: z.string().min(1),
  monto: z.number().positive(),
  contraparte: z.string().nullable().optional(),
  referencia: z.string().nullable().optional(),
  cuentaContraId: z.string().nullable().optional(),     // solo en transferencias internas
  chequeId: z.string().nullable().optional(),
  cuotaCreditoId: z.string().nullable().optional(),
  observaciones: z.string().nullable().optional(),
});

// Crear movimiento bancario manual. Si es transferencia entre cuentas propias,
// crea automáticamente el movimiento espejo (out → in) para que ambos saldos
// queden consistentes.
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
    const row = await prisma.bancoMovimiento.create({
      data: { ...d, companyId: req.companyId, userId: req.user?.id || null },
    });
    res.status(201).json({ ok: true, data: row });
  } catch (e) { next(e); }
});

app.put('/api/banco-movimientos/:id', requireCompany, requirePermission('finanzas:update'), async (req, res, next) => {
  try {
    const existing = await prisma.bancoMovimiento.findFirst({ where: { id: req.params.id, companyId: req.companyId } });
    if (!existing) return res.status(404).json({ ok: false, error: 'No encontrado' });
    const schema = bancoMovSchema.partial().extend({ conciliado: z.boolean().optional() });
    const d = schema.parse(req.body);
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

// Multer en memoria — para uploads chicos (plantillas Excel < 10MB)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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
    ejemplo: ['terceros', 'fisico', 'Banco Nación', 'A12345678', '2026-01-15', '2026-03-15', '500000', '', 'Juan Pérez', 'en cartera', ''],
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
app.post('/api/admin/importar-cliente/cerdos-ventas', authMiddleware, requireCompany, requirePermission('stock:create'), upload.single('archivo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Falta el archivo' });
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const shVentas = wb.SheetNames.find(n => /vent/i.test(n));
    if (!shVentas) return res.status(400).json({ ok: false, error: 'No se encontró la hoja VENTAS' });
    // Buscar (o crear) un producto "Cerdos" categoría hacienda
    let prod = await prisma.producto.findFirst({ where: { companyId: req.companyId, nombre: { equals: 'Cerdos', mode: 'insensitive' } } });
    if (!prod) {
      prod = await prisma.producto.create({ data: {
        companyId: req.companyId, categoria: 'hacienda', nombre: 'Cerdos', unidad: 'cabezas',
      }});
    }
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[shVentas], { defval: null, raw: false });
    let ok = 0; const errores = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        const cant = _parseMonto(r['CANTIDAD']);
        const fecha = _parseFechaArg(r['FECHA']);
        if (!cant || !fecha) continue;
        await prisma.movimiento.create({ data: {
          companyId: req.companyId, productoId: prod.id,
          fecha, tipo: 'egreso', motivo: 'venta',
          cantidad: cant,
          precio: _parseMonto(r['PRECIO KG']),
          total: _parseMonto(r['TOTAL $']),
          observaciones: [r['DESTINO'] && `Destino: ${r['DESTINO']}`, r['TOTAL KG'] && `${r['TOTAL KG']} kg`].filter(Boolean).join(' · '),
          userId: req.user?.id || null,
        }});
        ok++;
      } catch (e) { errores.push({ fila: i+2, error: e.message }); }
    }
    res.json({ ok: true, importados: ok, fallos: errores.length, errores: errores.slice(0, 50) });
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