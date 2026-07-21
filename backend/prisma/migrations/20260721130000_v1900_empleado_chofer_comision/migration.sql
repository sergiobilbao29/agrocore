-- v1.90.0 — Asegura TODAS las columnas de "transporte propio" y "comisión de
-- chofer-empleado". Idempotente (IF NOT EXISTS): sirve tanto si la v1.89.0 ya
-- corrió (y le faltan las columnas del Empleado agregadas después) como si no.
ALTER TABLE "Transportista"      ADD COLUMN IF NOT EXISTS "propio"             BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Chofer"             ADD COLUMN IF NOT EXISTS "empleadoId"          TEXT;
ALTER TABLE "Chofer"             ADD COLUMN IF NOT EXISTS "comisionTipo"        TEXT;
ALTER TABLE "Chofer"             ADD COLUMN IF NOT EXISTS "comisionValor"       DOUBLE PRECISION;
ALTER TABLE "MovimientoEmpleado" ADD COLUMN IF NOT EXISTS "viajeId"             TEXT;
ALTER TABLE "Empleado"           ADD COLUMN IF NOT EXISTS "esChofer"            BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Empleado"           ADD COLUMN IF NOT EXISTS "comisionViajeTipo"   TEXT;
ALTER TABLE "Empleado"           ADD COLUMN IF NOT EXISTS "comisionViajeValor"  DOUBLE PRECISION;
