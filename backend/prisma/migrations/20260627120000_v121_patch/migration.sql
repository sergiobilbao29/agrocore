-- v1.2.1 PATCH: agregar TODOS los campos que faltan (de v1.1.0 consolidada + v1.2.0)
-- 100% idempotente, sin DO $$ blocks que pueden fallar en migrate deploy.
-- Si una migracion anterior fallo parcialmente, esto la "completa" agregando lo que falta.

-- ====== Campo ======
ALTER TABLE "Campo" ADD COLUMN IF NOT EXISTS "titularidad"     TEXT;
ALTER TABLE "Campo" ADD COLUMN IF NOT EXISTS "ubicacion"       TEXT;
ALTER TABLE "Campo" ADD COLUMN IF NOT EXISTS "renspa"          TEXT;
ALTER TABLE "Campo" ADD COLUMN IF NOT EXISTS "renspas"         JSONB;
ALTER TABLE "Campo" ADD COLUMN IF NOT EXISTS "tipoExplotacion" TEXT;
ALTER TABLE "Campo" ADD COLUMN IF NOT EXISTS "geolocalizacion" TEXT;

-- ====== Company ======
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "pais"    TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;

-- ====== User ======
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "fotoUrl" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "oculto"  BOOLEAN NOT NULL DEFAULT false;

-- ====== Cliente / Proveedor ======
ALTER TABLE "Cliente"   ADD COLUMN IF NOT EXISTS "pais" TEXT;
ALTER TABLE "Proveedor" ADD COLUMN IF NOT EXISTS "pais" TEXT;

-- ====== Cheque ======
ALTER TABLE "Cheque" ADD COLUMN IF NOT EXISTS "cuenta" TEXT;

-- ====== CtaCte ======
ALTER TABLE "CtaCte" ADD COLUMN IF NOT EXISTS "empresaContraparteId" TEXT;
ALTER TABLE "CtaCte" ADD COLUMN IF NOT EXISTS "intercompanyRef"      TEXT;

-- ====== Empleado ======
ALTER TABLE "Empleado" ADD COLUMN IF NOT EXISTS "fotoUrl"   TEXT;
ALTER TABLE "Empleado" ADD COLUMN IF NOT EXISTS "localidad" TEXT;
ALTER TABLE "Empleado" ADD COLUMN IF NOT EXISTS "provincia" TEXT;

-- ====== Viaje ======
ALTER TABLE "Viaje" ADD COLUMN IF NOT EXISTS "kgDescarga"   DOUBLE PRECISION;
ALTER TABLE "Viaje" ADD COLUMN IF NOT EXISTS "cdp"          TEXT;
ALTER TABLE "Viaje" ADD COLUMN IF NOT EXISTS "pagadorFlete" TEXT;
ALTER TABLE "Viaje" ADD COLUMN IF NOT EXISTS "km"           DOUBLE PRECISION;
ALTER TABLE "Viaje" ADD COLUMN IF NOT EXISTS "combustible"  DOUBLE PRECISION;
ALTER TABLE "Viaje" ADD COLUMN IF NOT EXISTS "peajes"       DOUBLE PRECISION;
ALTER TABLE "Viaje" ADD COLUMN IF NOT EXISTS "comida"       DOUBLE PRECISION;
ALTER TABLE "Viaje" ADD COLUMN IF NOT EXISTS "varios"       DOUBLE PRECISION;
ALTER TABLE "Viaje" ADD COLUMN IF NOT EXISTS "total"        DOUBLE PRECISION;

-- ====== IntercompanyMovimiento (NOMBRES CORRECTOS - matching schema.prisma) ======
-- Si no existe, se crea con el schema correcto.
-- Si ya existe (creada por db push), los ALTER de abajo se aseguran que tenga todas las columnas.
CREATE TABLE IF NOT EXISTS "IntercompanyMovimiento" (
  "id"                  TEXT NOT NULL,
  "fecha"               TIMESTAMP(3) NOT NULL,
  "empresaOrigenId"     TEXT NOT NULL,
  "empresaDestinoId"    TEXT NOT NULL,
  "monto"               DOUBLE PRECISION NOT NULL,
  "motivo"              TEXT NOT NULL,
  "intercompanyRef"     TEXT NOT NULL,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IntercompanyMovimiento_pkey" PRIMARY KEY ("id")
);
-- Columnas opcionales (por si la tabla ya existia parcial):
ALTER TABLE "IntercompanyMovimiento" ADD COLUMN IF NOT EXISTS "proveedorId"       TEXT;
ALTER TABLE "IntercompanyMovimiento" ADD COLUMN IF NOT EXISTS "clienteId"         TEXT;
ALTER TABLE "IntercompanyMovimiento" ADD COLUMN IF NOT EXISTS "chequeId"          TEXT;
ALTER TABLE "IntercompanyMovimiento" ADD COLUMN IF NOT EXISTS "bancoMovimientoId" TEXT;
ALTER TABLE "IntercompanyMovimiento" ADD COLUMN IF NOT EXISTS "efectivoId"        TEXT;
ALTER TABLE "IntercompanyMovimiento" ADD COLUMN IF NOT EXISTS "observaciones"     TEXT;
ALTER TABLE "IntercompanyMovimiento" ADD COLUMN IF NOT EXISTS "userId"            TEXT;

-- ====== ImportLote ======
CREATE TABLE IF NOT EXISTS "ImportLote" (
  "id"              TEXT NOT NULL,
  "companyId"       TEXT NOT NULL,
  "tipo"            TEXT NOT NULL,
  "fecha"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId"          TEXT,
  "archivoNombre"   TEXT,
  "importados"      INTEGER NOT NULL DEFAULT 0,
  "fallos"          INTEGER NOT NULL DEFAULT 0,
  "recordsCreados"  JSONB,
  "estado"          TEXT NOT NULL DEFAULT 'activo',
  "fechaDeshecho"   TIMESTAMP(3),
  "diagnostico"     JSONB,
  CONSTRAINT "ImportLote_pkey" PRIMARY KEY ("id")
);

-- Normalizacion: cheques 'en cartera' (espacio) -> 'en_cartera' (subrayado)
UPDATE "Cheque" SET "estado" = 'en_cartera' WHERE "estado" = 'en cartera';
