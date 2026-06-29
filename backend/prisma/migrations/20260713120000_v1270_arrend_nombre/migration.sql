-- v1.27 — Arrendamiento: nombre del contrato (opcional). Idempotente.
ALTER TABLE "Arrendamiento" ADD COLUMN IF NOT EXISTS "nombre" TEXT;
