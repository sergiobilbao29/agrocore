-- v1.89.0 — Transporte propio (sin proveedor) + comisión de chofer-empleado por viaje
ALTER TABLE "Transportista" ADD COLUMN IF NOT EXISTS "propio" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Chofer" ADD COLUMN IF NOT EXISTS "empleadoId" TEXT;
ALTER TABLE "Chofer" ADD COLUMN IF NOT EXISTS "comisionTipo" TEXT;
ALTER TABLE "Chofer" ADD COLUMN IF NOT EXISTS "comisionValor" DOUBLE PRECISION;
ALTER TABLE "MovimientoEmpleado" ADD COLUMN IF NOT EXISTS "viajeId" TEXT;
