-- v2.4.0 — Seguro / ART del empleado
-- Idempotente: en instalaciones que ya la tengan no cambia nada.
ALTER TABLE "Empleado" ADD COLUMN IF NOT EXISTS "aseguradora" TEXT;
ALTER TABLE "Empleado" ADD COLUMN IF NOT EXISTS "aseguradoraTel" TEXT;
ALTER TABLE "Empleado" ADD COLUMN IF NOT EXISTS "seguroActivo" BOOLEAN NOT NULL DEFAULT false;
