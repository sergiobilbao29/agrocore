-- v2.70.0 - Empleado: precio por dia (jornal) para empleados que cobran por jornada.
-- Aditiva e idempotente.
ALTER TABLE "Empleado" ADD COLUMN IF NOT EXISTS "jornalDiario" DOUBLE PRECISION;
