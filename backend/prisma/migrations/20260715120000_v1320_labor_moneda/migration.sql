-- v1.32 — Multimoneda en labores: moneda del precio de referencia (catálogo) y del costo aplicado.
-- Idempotente.
ALTER TABLE "Catalogo"      ADD COLUMN IF NOT EXISTS "monedaPrecio" TEXT;
ALTER TABLE "LaborAplicada" ADD COLUMN IF NOT EXISTS "monedaCosto"  TEXT;
