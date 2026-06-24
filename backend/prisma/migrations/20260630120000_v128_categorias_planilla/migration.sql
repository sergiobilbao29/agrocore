-- v1.2.8 — Categorías de planilla configurables + cantidad/valor genéricos.
-- Idempotente. Las FKs las reconcilia `prisma db push` del actualizador.

-- Campos genéricos "cantidad × valor" en los movimientos de la planilla
ALTER TABLE "MovimientoEmpleado" ADD COLUMN IF NOT EXISTS "cantidad"      DOUBLE PRECISION;
ALTER TABLE "MovimientoEmpleado" ADD COLUMN IF NOT EXISTS "valorUnitario" DOUBLE PRECISION;
ALTER TABLE "MovimientoEmpleado" ADD COLUMN IF NOT EXISTS "unidad"        TEXT;

-- Tabla de categorías configurables (ganancia/gasto, monto o cantidad×valor)
CREATE TABLE IF NOT EXISTS "CategoriaPlanilla" (
  "id"        TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "nombre"    TEXT NOT NULL,
  "codigo"    TEXT NOT NULL,
  "mov"       TEXT NOT NULL,
  "modo"      TEXT NOT NULL DEFAULT 'monto',
  "unidad"    TEXT,
  "orden"     INTEGER NOT NULL DEFAULT 0,
  "especial"  BOOLEAN NOT NULL DEFAULT false,
  "activo"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CategoriaPlanilla_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CategoriaPlanilla_companyId_codigo_key" ON "CategoriaPlanilla"("companyId","codigo");
CREATE INDEX IF NOT EXISTS "CategoriaPlanilla_companyId_idx" ON "CategoriaPlanilla"("companyId");
