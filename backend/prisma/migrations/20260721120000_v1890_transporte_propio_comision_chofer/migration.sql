-- v1.89.0 — Transporte propio (sin proveedor) + comisión de chofer-empleado por viaje
ALTER TABLE "Transportista" ADD COLUMN IF NOT EXISTS "propio" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Chofer" ADD COLUMN IF NOT EXISTS "empleadoId" TEXT;
ALTER TABLE "Chofer" ADD COLUMN IF NOT EXISTS "comisionTipo" TEXT;
ALTER TABLE "Chofer" ADD COLUMN IF NOT EXISTS "comisionValor" DOUBLE PRECISION;
ALTER TABLE "MovimientoEmpleado" ADD COLUMN IF NOT EXISTS "viajeId" TEXT;
ALTER TABLE "Empleado" ADD COLUMN IF NOT EXISTS "esChofer" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Empleado" ADD COLUMN IF NOT EXISTS "comisionViajeTipo" TEXT;
ALTER TABLE "Empleado" ADD COLUMN IF NOT EXISTS "comisionViajeValor" DOUBLE PRECISION;
