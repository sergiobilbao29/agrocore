-- v2.204.0 — Cuenta que se liquida en la Guía DT-e:
-- total del negocio (totalEstimado) - achique (kilos) + IVA - retenciones = neto estimado.
ALTER TABLE "GuiaHacienda" ADD COLUMN IF NOT EXISTS "achiqueKg" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "GuiaHacienda" ADD COLUMN IF NOT EXISTS "achiquePrecio" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "GuiaHacienda" ADD COLUMN IF NOT EXISTS "retencionesMonto" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "GuiaHacienda" ADD COLUMN IF NOT EXISTS "netoEstimado" DOUBLE PRECISION NOT NULL DEFAULT 0;
-- Backfill: guías existentes -> neto = total del negocio + IVA (sin achique ni retenciones).
UPDATE "GuiaHacienda" SET "netoEstimado" = "totalEstimado" + "ivaEstimado" WHERE "netoEstimado" = 0;
