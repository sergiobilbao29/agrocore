-- v2.339.0 - Catalogo propio por empresa: no autogenerar productos agro/ganaderia. Idempotente.
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "catalogoManual" BOOLEAN NOT NULL DEFAULT false;
