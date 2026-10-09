-- Etapa 2 Centros de costo: imputacion de compras y gastos a centros de costo.
-- Opt-in por empresa. Origen polimorfico (factura de compra / efectivo / banco).

CREATE TABLE IF NOT EXISTS "ImputacionCC" (
  "id"                TEXT NOT NULL,
  "companyId"         TEXT NOT NULL,
  "centroCostoId"     TEXT NOT NULL,
  "origenTipo"        TEXT NOT NULL,
  "modo"              TEXT NOT NULL DEFAULT 'directo',
  "monto"             DOUBLE PRECISION NOT NULL DEFAULT 0,
  "porcentaje"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  "fecha"             TIMESTAMP(3) NOT NULL,
  "facturaCompraId"   TEXT,
  "efectivoId"        TEXT,
  "bancoMovimientoId" TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ImputacionCC_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ImputacionCC_companyId_idx" ON "ImputacionCC"("companyId");
CREATE INDEX IF NOT EXISTS "ImputacionCC_centroCostoId_idx" ON "ImputacionCC"("centroCostoId");
CREATE INDEX IF NOT EXISTS "ImputacionCC_fecha_idx" ON "ImputacionCC"("fecha");
CREATE INDEX IF NOT EXISTS "ImputacionCC_facturaCompraId_idx" ON "ImputacionCC"("facturaCompraId");
CREATE INDEX IF NOT EXISTS "ImputacionCC_efectivoId_idx" ON "ImputacionCC"("efectivoId");
CREATE INDEX IF NOT EXISTS "ImputacionCC_bancoMovimientoId_idx" ON "ImputacionCC"("bancoMovimientoId");

DO $$ BEGIN
  ALTER TABLE "ImputacionCC" ADD CONSTRAINT "ImputacionCC_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ImputacionCC" ADD CONSTRAINT "ImputacionCC_centroCostoId_fkey" FOREIGN KEY ("centroCostoId") REFERENCES "CentroCosto"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ImputacionCC" ADD CONSTRAINT "ImputacionCC_facturaCompraId_fkey" FOREIGN KEY ("facturaCompraId") REFERENCES "FacturaCompra"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ImputacionCC" ADD CONSTRAINT "ImputacionCC_efectivoId_fkey" FOREIGN KEY ("efectivoId") REFERENCES "Efectivo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ImputacionCC" ADD CONSTRAINT "ImputacionCC_bancoMovimientoId_fkey" FOREIGN KEY ("bancoMovimientoId") REFERENCES "BancoMovimiento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
