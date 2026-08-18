-- v2.101.0 - Deshacer importación de resumen bancario: tag de lote. Aditiva e idempotente.

ALTER TABLE "BancoMovimiento" ADD COLUMN IF NOT EXISTS "importLote" TEXT;
CREATE INDEX IF NOT EXISTS "BancoMovimiento_importLote_idx" ON "BancoMovimiento"("importLote");
