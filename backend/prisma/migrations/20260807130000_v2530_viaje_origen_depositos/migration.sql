-- v2.53.0 — Viaje: carga desde varios depósitos de origen.
-- Guarda [{ depositoId, kg }] para egresar stock de cada depósito por sus kg.
ALTER TABLE "Viaje" ADD COLUMN IF NOT EXISTS "origenDepositos" JSONB;
