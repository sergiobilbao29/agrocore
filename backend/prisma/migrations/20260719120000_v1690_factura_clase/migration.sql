-- v1.69.0: Nota de Crédito / Débito en ventas
ALTER TABLE "Factura" ADD COLUMN IF NOT EXISTS "clase" TEXT NOT NULL DEFAULT 'factura';
