-- v1.1.0 consolidación: agregar campos que están en schema.prisma pero faltan en migraciones
-- Es idempotente: usa IF NOT EXISTS para no romper si ya existe la columna (db pushed previo).

-- Company
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "pais" TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;

-- User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "fotoUrl" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "oculto" BOOLEAN NOT NULL DEFAULT false;

-- Cliente / Proveedor
ALTER TABLE "Cliente"   ADD COLUMN IF NOT EXISTS "pais" TEXT;
ALTER TABLE "Proveedor" ADD COLUMN IF NOT EXISTS "pais" TEXT;

-- Cheque
ALTER TABLE "Cheque" ADD COLUMN IF NOT EXISTS "cuenta" TEXT;

-- CtaCte
ALTER TABLE "CtaCte" ADD COLUMN IF NOT EXISTS "empresaContraparteId" TEXT;
ALTER TABLE "CtaCte" ADD COLUMN IF NOT EXISTS "intercompanyRef" TEXT;

-- Empleado
ALTER TABLE "Empleado" ADD COLUMN IF NOT EXISTS "fotoUrl"   TEXT;
ALTER TABLE "Empleado" ADD COLUMN IF NOT EXISTS "localidad" TEXT;
ALTER TABLE "Empleado" ADD COLUMN IF NOT EXISTS "provincia" TEXT;

-- Viaje (campos legacy/extra)
ALTER TABLE "Viaje" ADD COLUMN IF NOT EXISTS "kgDescarga"  DOUBLE PRECISION;
ALTER TABLE "Viaje" ADD COLUMN IF NOT EXISTS "cdp"         TEXT;
ALTER TABLE "Viaje" ADD COLUMN IF NOT EXISTS "pagadorFlete" TEXT;
ALTER TABLE "Viaje" ADD COLUMN IF NOT EXISTS "km"          DOUBLE PRECISION;
ALTER TABLE "Viaje" ADD COLUMN IF NOT EXISTS "combustible" DOUBLE PRECISION;
ALTER TABLE "Viaje" ADD COLUMN IF NOT EXISTS "peajes"      DOUBLE PRECISION;
ALTER TABLE "Viaje" ADD COLUMN IF NOT EXISTS "comida"      DOUBLE PRECISION;
ALTER TABLE "Viaje" ADD COLUMN IF NOT EXISTS "varios"      DOUBLE PRECISION;
ALTER TABLE "Viaje" ADD COLUMN IF NOT EXISTS "total"       DOUBLE PRECISION;

-- Modelos enteros que faltan: IntercompanyMovimiento + ImportLote
CREATE TABLE IF NOT EXISTS "IntercompanyMovimiento" (
  "id"                    TEXT NOT NULL,
  "companyOrigenId"       TEXT NOT NULL,
  "companyDestinoId"      TEXT NOT NULL,
  "fecha"                 TIMESTAMP(3) NOT NULL,
  "monto"                 DOUBLE PRECISION NOT NULL,
  "concepto"              TEXT,
  "userId"                TEXT,
  "ctaCteOrigenRef"       TEXT,
  "ctaCteDestinoRef"      TEXT,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IntercompanyMovimiento_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "IntercompanyMovimiento_companyOrigenId_fecha_idx"
  ON "IntercompanyMovimiento"("companyOrigenId","fecha");
CREATE INDEX IF NOT EXISTS "IntercompanyMovimiento_companyDestinoId_fecha_idx"
  ON "IntercompanyMovimiento"("companyDestinoId","fecha");
DO $$ BEGIN
  ALTER TABLE "IntercompanyMovimiento" ADD CONSTRAINT "IntercompanyMovimiento_companyOrigenId_fkey"
    FOREIGN KEY ("companyOrigenId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "IntercompanyMovimiento" ADD CONSTRAINT "IntercompanyMovimiento_companyDestinoId_fkey"
    FOREIGN KEY ("companyDestinoId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "IntercompanyMovimiento" ADD CONSTRAINT "IntercompanyMovimiento_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

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
CREATE INDEX IF NOT EXISTS "ImportLote_companyId_fecha_idx" ON "ImportLote"("companyId","fecha");
DO $$ BEGIN
  ALTER TABLE "ImportLote" ADD CONSTRAINT "ImportLote_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Bug #5: cheques con estado 'en cartera' (espacio) → 'en_cartera' (subrayado)
UPDATE "Cheque" SET "estado" = 'en_cartera' WHERE "estado" = 'en cartera';
