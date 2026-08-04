-- v2.26.0 - Contorno del lote para el mapa. Aditiva e idempotente.
ALTER TABLE "Lote" ADD COLUMN IF NOT EXISTS "geojson" JSONB;
ALTER TABLE "Lote" ADD COLUMN IF NOT EXISTS "centro" TEXT;
