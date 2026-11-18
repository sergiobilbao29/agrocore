-- Gasto de tarjeta de crédito: ficha enriquecida sobre Efectivo
ALTER TABLE "Efectivo" ADD COLUMN IF NOT EXISTS "vencimiento" TIMESTAMP(3);
ALTER TABLE "Efectivo" ADD COLUMN IF NOT EXISTS "interes" DOUBLE PRECISION;
ALTER TABLE "Efectivo" ADD COLUMN IF NOT EXISTS "articuloTipo" TEXT;
ALTER TABLE "Efectivo" ADD COLUMN IF NOT EXISTS "articuloRefId" TEXT;
ALTER TABLE "Efectivo" ADD COLUMN IF NOT EXISTS "articuloLabel" TEXT;
ALTER TABLE "Efectivo" ADD COLUMN IF NOT EXISTS "bancoTarjeta" TEXT;
CREATE INDEX IF NOT EXISTS "Efectivo_vencimiento_idx" ON "Efectivo"("vencimiento");
