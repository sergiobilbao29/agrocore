-- Etapa 4 Centros de Costo: imputar VENTAS (ingresos) y SUELDOS, + centro de costo por empleado.
-- Idempotente: se puede correr varias veces sin romper.

-- 1) Nuevas columnas en ImputacionCC
ALTER TABLE "ImputacionCC" ADD COLUMN IF NOT EXISTS "facturaId" TEXT;
ALTER TABLE "ImputacionCC" ADD COLUMN IF NOT EXISTS "liquidacionSueldoId" TEXT;

-- 2) Centro de costo por defecto del empleado
ALTER TABLE "Empleado" ADD COLUMN IF NOT EXISTS "centroCostoId" TEXT;

-- 3) Indices
CREATE INDEX IF NOT EXISTS "ImputacionCC_facturaId_idx" ON "ImputacionCC"("facturaId");
CREATE INDEX IF NOT EXISTS "ImputacionCC_liquidacionSueldoId_idx" ON "ImputacionCC"("liquidacionSueldoId");

-- 4) Foreign keys (con guarda para no duplicar)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ImputacionCC_facturaId_fkey') THEN
    ALTER TABLE "ImputacionCC"
      ADD CONSTRAINT "ImputacionCC_facturaId_fkey"
      FOREIGN KEY ("facturaId") REFERENCES "Factura"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ImputacionCC_liquidacionSueldoId_fkey') THEN
    ALTER TABLE "ImputacionCC"
      ADD CONSTRAINT "ImputacionCC_liquidacionSueldoId_fkey"
      FOREIGN KEY ("liquidacionSueldoId") REFERENCES "LiquidacionSueldo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
