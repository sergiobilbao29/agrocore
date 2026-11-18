-- Moneda en Efectivo (consumos de tarjeta en dólares)
ALTER TABLE "Efectivo" ADD COLUMN IF NOT EXISTS "moneda" TEXT NOT NULL DEFAULT 'ARS';
ALTER TABLE "Efectivo" ADD COLUMN IF NOT EXISTS "cotizacion" DOUBLE PRECISION;
