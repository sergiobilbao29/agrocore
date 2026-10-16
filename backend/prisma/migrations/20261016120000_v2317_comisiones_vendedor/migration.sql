-- v2.317.0 - Comisiones de vendedores (Etapa 2).
-- Config de comision en Vendedor + cuenta corriente (VendedorMovimiento). Idempotente.

ALTER TABLE "Vendedor" ADD COLUMN IF NOT EXISTS "pagoUnico"   DOUBLE PRECISION;
ALTER TABLE "Vendedor" ADD COLUMN IF NOT EXISTS "mensualidad" DOUBLE PRECISION;
ALTER TABLE "Vendedor" ADD COLUMN IF NOT EXISTS "moneda"      TEXT NOT NULL DEFAULT 'USD';

CREATE TABLE IF NOT EXISTS "VendedorMovimiento" (
  "id"         TEXT NOT NULL,
  "vendedorId" TEXT NOT NULL,
  "fecha"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tipo"       TEXT NOT NULL,
  "detalle"    TEXT NOT NULL,
  "debe"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "haber"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "moneda"     TEXT NOT NULL DEFAULT 'USD',
  "periodo"    TEXT,
  "companyId"  TEXT,
  "referencia" TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VendedorMovimiento_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "VendedorMovimiento_vendedorId_idx"         ON "VendedorMovimiento"("vendedorId");
CREATE INDEX IF NOT EXISTS "VendedorMovimiento_vendedorId_periodo_idx" ON "VendedorMovimiento"("vendedorId", "periodo");
