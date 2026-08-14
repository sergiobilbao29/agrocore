-- v2.96.0 - Empleado que cobra por dia (sueldo base = jornal x dias). Aditiva e idempotente.

ALTER TABLE "Empleado" ADD COLUMN IF NOT EXISTS "porDia"  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Empleado" ADD COLUMN IF NOT EXISTS "diasMes" INTEGER;
