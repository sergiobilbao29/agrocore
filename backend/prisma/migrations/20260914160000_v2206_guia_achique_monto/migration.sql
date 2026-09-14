-- v2.206.0 — Achique como monto $ directo en la Guía DT-e (además de por kilos).
-- Útil para guías (ej. faena/servicio) que no tienen kilos cargados para valorizar el achique.
ALTER TABLE "GuiaHacienda" ADD COLUMN IF NOT EXISTS "achiqueMonto" DOUBLE PRECISION NOT NULL DEFAULT 0;
