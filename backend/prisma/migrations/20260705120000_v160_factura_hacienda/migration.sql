-- v1.6.0 (Fase 4) — Compras/ventas de hacienda por Facturación.
-- Campo + cabezas por renglón de factura (la cantidad de la línea son kg) y
-- enlace de la factura en el movimiento de hacienda (para revertir).
-- Idempotente.
ALTER TABLE "FacturaItem"        ADD COLUMN IF NOT EXISTS "campoId" TEXT;
ALTER TABLE "FacturaItem"        ADD COLUMN IF NOT EXISTS "cabezas" DOUBLE PRECISION;
ALTER TABLE "FacturaCompraItem"  ADD COLUMN IF NOT EXISTS "campoId" TEXT;
ALTER TABLE "FacturaCompraItem"  ADD COLUMN IF NOT EXISTS "cabezas" DOUBLE PRECISION;
ALTER TABLE "HaciendaMovimiento" ADD COLUMN IF NOT EXISTS "facturaRef" TEXT;
