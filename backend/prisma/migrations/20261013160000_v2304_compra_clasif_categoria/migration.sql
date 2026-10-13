-- v2.304.0 - Factura de compra: clasificacion (empresa/particular/socio) y categoria de gasto.
-- Idempotente.
ALTER TABLE "FacturaCompra" ADD COLUMN IF NOT EXISTS "clasificacion" TEXT DEFAULT 'empresa';
ALTER TABLE "FacturaCompra" ADD COLUMN IF NOT EXISTS "categoriaGastoId" TEXT;
CREATE INDEX IF NOT EXISTS "FacturaCompra_categoriaGastoId_idx" ON "FacturaCompra"("categoriaGastoId");
