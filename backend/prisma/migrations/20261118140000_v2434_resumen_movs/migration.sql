-- Vincular gastos de tarjeta (Efectivo) a un resumen importado
ALTER TABLE "Efectivo" ADD COLUMN IF NOT EXISTS "resumenId" TEXT;
CREATE INDEX IF NOT EXISTS "Efectivo_resumenId_idx" ON "Efectivo"("resumenId");
