-- v1.64.0: clase de comprobante en factura de compra (factura / nota de crédito / nota de débito)
ALTER TABLE "FacturaCompra" ADD COLUMN IF NOT EXISTS "clase" TEXT NOT NULL DEFAULT 'factura';
