-- v1.93.0 — Origen del cereal en viajes: puede salir de un depósito (silo/silobolsa)
-- acumulado, no sólo de una campaña. Excluyente con campanaId.
ALTER TABLE "Viaje" ADD COLUMN IF NOT EXISTS "depositoOrigenId" TEXT;
