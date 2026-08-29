-- v2.168: vincular la labor de un rodeo con empleado (comisión) o servicio de terceros

ALTER TABLE "RodeoEvento" ADD COLUMN IF NOT EXISTS "empleadoId" TEXT;
ALTER TABLE "RodeoEvento" ADD COLUMN IF NOT EXISTS "porcentajeEmpleado" DOUBLE PRECISION;
ALTER TABLE "RodeoEvento" ADD COLUMN IF NOT EXISTS "movimientoEmpleadoId" TEXT;
