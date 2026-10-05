-- v2.271.0: vencimiento(s) de pago en facturas de compra (servicios)
ALTER TABLE "FacturaCompra" ADD COLUMN IF NOT EXISTS "fechaVencimiento" TIMESTAMP(3);
ALTER TABLE "FacturaCompra" ADD COLUMN IF NOT EXISTS "vencimientos" JSONB;
CREATE INDEX IF NOT EXISTS "FacturaCompra_fechaVencimiento_idx" ON "FacturaCompra"("fechaVencimiento");
