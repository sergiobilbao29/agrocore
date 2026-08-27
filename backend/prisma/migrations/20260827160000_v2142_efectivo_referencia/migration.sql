-- v2.142.0: vincular movimientos de efectivo con su origen (ej. cobro contado de factura)
ALTER TABLE "Efectivo" ADD COLUMN IF NOT EXISTS "referencia" TEXT;
CREATE INDEX IF NOT EXISTS "Efectivo_referencia_idx" ON "Efectivo"("referencia");
