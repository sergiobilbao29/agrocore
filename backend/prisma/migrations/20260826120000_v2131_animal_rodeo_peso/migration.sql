-- v2.131.0 — Vínculo Ficha de animal ↔ Rodeo + peso individual (IoT / balanza).
ALTER TABLE "Animal" ADD COLUMN IF NOT EXISTS "rodeoId" TEXT;
ALTER TABLE "Animal" ADD COLUMN IF NOT EXISTS "pesoKg" DOUBLE PRECISION;
ALTER TABLE "Animal" ADD COLUMN IF NOT EXISTS "pesoFecha" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Animal_rodeoId_idx" ON "Animal"("rodeoId");
DO $$ BEGIN
  ALTER TABLE "Animal" ADD CONSTRAINT "Animal_rodeoId_fkey"
    FOREIGN KEY ("rodeoId") REFERENCES "Rodeo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
