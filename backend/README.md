# AgroCore — Backend API

Backend REST para el sistema de gestión agrícola AgroCore.

Stack: **Node.js 20+** · **Express** · **Prisma ORM** · **PostgreSQL 16**

---

## 1. Requisitos previos

- Node.js 20 LTS o superior (instalado: `node --version`)
- npm 10+ (incluido con Node)
- PostgreSQL 16 corriendo en `localhost:5432`
- Base de datos `agrocore` creada y usuario `agrocore` con permisos

Si todavía no tenés la base lista, desde `psql` como superusuario:

```sql
CREATE USER agrocore WITH PASSWORD 'agrocore_dev_2026';
CREATE DATABASE agrocore OWNER agrocore;
GRANT ALL PRIVILEGES ON DATABASE agrocore TO agrocore;
```

---

## 2. Setup inicial (solo la primera vez)

```bash
# 1. Entrar al backend
cd backend

# 2. Instalar dependencias
npm install

# 3. Generar cliente Prisma + correr la primera migración
npx prisma migrate dev --name init

# 4. (opcional) Ver la base con Prisma Studio
npx prisma studio
```

La migración crea todas las tablas en Postgres según `prisma/schema.prisma`.

---

## 3. Correr en desarrollo

```bash
npm run dev
```

El server queda en **http://localhost:3000**.

Probar que anda:

```
http://localhost:3000/api/health
```

Debería responder algo como:

```json
{
  "ok": true,
  "service": "agrocore-api",
  "version": "0.1.0",
  "db": "up",
  "time": "2026-04-22T..."
}
```

---

## 4. Variables de entorno (`.env`)

| Variable        | Descripción                                              |
|-----------------|----------------------------------------------------------|
| `DATABASE_URL`  | Cadena de conexión Postgres                              |
| `JWT_SECRET`    | Secreto para firmar tokens (cambiar en producción)       |
| `PORT`          | Puerto HTTP local (default 3000)                         |
| `CORS_ORIGIN`   | Orígenes permitidos (en dev `*`, en prod el dominio real)|

**Nunca subas `.env` al repositorio.** Ya está en `.gitignore`.

---

## 5. Comandos útiles

```bash
npm run dev              # arranca server con auto-reload
npm start                # arranca server una sola vez
npm run db:migrate       # nueva migración (te pide nombre)
npm run db:push          # sincroniza schema sin crear migración (prototipos)
npm run db:studio        # UI web para ver/editar la base
npm run db:generate      # regenera cliente Prisma
npm run db:seed          # (más adelante) carga datos iniciales
```

---

## 6. Estructura del proyecto

```
backend/
├── .env                 ← config local (NO se sube)
├── .gitignore
├── package.json
├── README.md
├── prisma/
│   ├── schema.prisma    ← modelo de datos
│   └── migrations/      ← (se crea automáticamente)
└── src/
    └── server.js        ← entry point
```

En las próximas fases se agregan `src/routes/`, `src/middleware/`, `src/services/`.

---

## 7. Roadmap

- **Fase 2 (actual):** scaffold + `/api/health` + schema completo.
- **Fase 3:** endpoints REST por módulo + autenticación JWT + permisos.
- **Fase 4:** adaptar el frontend AgroCore.html para consumir la API.
- **Fase 5:** exposición vía Cloudflare Tunnel (URL pública HTTPS gratuita).
- **Futuro:** migración a AWS (RDS + EC2/ECS). El único cambio necesario es el `DATABASE_URL`.
