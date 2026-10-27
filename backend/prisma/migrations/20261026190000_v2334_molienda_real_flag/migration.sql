-- v2.334.0 - Molienda tanda corta: flag de modulo por empresa + rendimiento real. Idempotente.
ALTER TABLE "Company"       ADD COLUMN IF NOT EXISTS "usaProduccionIndustrial" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ParteMolienda" ADD COLUMN IF NOT EXISTS "modoReal" BOOLEAN NOT NULL DEFAULT false;
