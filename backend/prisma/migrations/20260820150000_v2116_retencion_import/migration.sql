-- v2.116.0: campos de importación en Retencion (importar sufridas de ARCA + export SICORE/SIRE)
ALTER TABLE "Retencion" ADD COLUMN IF NOT EXISTS "origen" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "Retencion" ADD COLUMN IF NOT EXISTS "importLote" TEXT;
ALTER TABLE "Retencion" ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;
CREATE INDEX IF NOT EXISTS "Retencion_importLote_idx" ON "Retencion"("importLote");
CREATE INDEX IF NOT EXISTS "Retencion_dedupeKey_idx" ON "Retencion"("dedupeKey");
