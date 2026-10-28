-- v2.347.0 - Empresa aislada (total) del grupo. Idempotente.
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "aislada" BOOLEAN NOT NULL DEFAULT false;
-- v2.347.0 - Código corto legible del parte de molienda (ej. MOL-2210-1). Idempotente.
ALTER TABLE "ParteMolienda" ADD COLUMN IF NOT EXISTS "codigo" TEXT;
