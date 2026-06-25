-- v1.9.0 (Multimoneda Fase 1) — Cotizaciones históricas + moneda/cotización en
-- facturas (compra/venta) y cuenta corriente. Idempotente.

-- Tabla de cotizaciones (ARS por 1 unidad de la moneda/grano).
CREATE TABLE IF NOT EXISTS "Cotizacion" (
  "id"        TEXT NOT NULL,
  "companyId" TEXT,
  "fecha"     TIMESTAMP(3) NOT NULL,
  "moneda"    TEXT NOT NULL,
  "valor"     DOUBLE PRECISION NOT NULL,
  "fuente"    TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Cotizacion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Cotizacion_companyId_moneda_fecha_key" ON "Cotizacion"("companyId", "moneda", "fecha");
CREATE INDEX IF NOT EXISTS "Cotizacion_moneda_fecha_idx" ON "Cotizacion"("moneda", "fecha");

-- Moneda + cotización en comprobantes (default ARS para no romper lo existente).
ALTER TABLE "Factura"       ADD COLUMN IF NOT EXISTS "moneda" TEXT NOT NULL DEFAULT 'ARS';
ALTER TABLE "Factura"       ADD COLUMN IF NOT EXISTS "cotizacion" DOUBLE PRECISION;
ALTER TABLE "FacturaCompra" ADD COLUMN IF NOT EXISTS "moneda" TEXT NOT NULL DEFAULT 'ARS';
ALTER TABLE "FacturaCompra" ADD COLUMN IF NOT EXISTS "cotizacion" DOUBLE PRECISION;
ALTER TABLE "CtaCte"        ADD COLUMN IF NOT EXISTS "moneda" TEXT NOT NULL DEFAULT 'ARS';
ALTER TABLE "CtaCte"        ADD COLUMN IF NOT EXISTS "cotizacion" DOUBLE PRECISION;
