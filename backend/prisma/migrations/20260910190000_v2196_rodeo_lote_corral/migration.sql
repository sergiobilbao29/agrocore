-- v2.196: ubicar el rodeo/lote de engorde en lote y corral (feedlot). Stock sigue por campo.
ALTER TABLE "Rodeo" ADD COLUMN IF NOT EXISTS "loteId" TEXT;
ALTER TABLE "Rodeo" ADD COLUMN IF NOT EXISTS "corral" TEXT;
CREATE INDEX IF NOT EXISTS "Rodeo_loteId_idx" ON "Rodeo"("loteId");
DO $$ BEGIN
  ALTER TABLE "Rodeo" ADD CONSTRAINT "Rodeo_loteId_fkey"
    FOREIGN KEY ("loteId") REFERENCES "Lote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
