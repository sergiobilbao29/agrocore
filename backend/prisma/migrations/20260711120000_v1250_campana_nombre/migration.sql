-- v1.25.x — Campaña: nombre libre (opcional)
-- Idempotente.
ALTER TABLE "Campana" ADD COLUMN IF NOT EXISTS "nombre" TEXT;
