-- v2.179: datos bancarios del empleado para la planilla de pagos.
ALTER TABLE "Empleado" ADD COLUMN IF NOT EXISTS "alias" TEXT;
ALTER TABLE "Empleado" ADD COLUMN IF NOT EXISTS "cbu" TEXT;
ALTER TABLE "Empleado" ADD COLUMN IF NOT EXISTS "bancoNombre" TEXT;
