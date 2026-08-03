-- v2.21.0 - Historial de campanas: analisis de suelo por campana. Aditiva e idempotente.

ALTER TABLE "Campana" ADD COLUMN IF NOT EXISTS "analisisSuelo" TEXT;
