-- v2.20.0 - Control de entrega de ropa/indumentaria a empleados. Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS "EntregaRopa" (
  "id"            TEXT NOT NULL,
  "companyId"     TEXT NOT NULL,
  "empleadoId"    TEXT NOT NULL,
  "fecha"         TIMESTAMP(3) NOT NULL,
  "prenda"        TEXT NOT NULL,
  "talle"         TEXT,
  "cantidad"      INTEGER NOT NULL DEFAULT 1,
  "observaciones" TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EntregaRopa_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EntregaRopa_companyId_idx" ON "EntregaRopa"("companyId");
CREATE INDEX IF NOT EXISTS "EntregaRopa_empleadoId_idx" ON "EntregaRopa"("empleadoId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EntregaRopa_companyId_fkey') THEN
    ALTER TABLE "EntregaRopa" ADD CONSTRAINT "EntregaRopa_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EntregaRopa_empleadoId_fkey') THEN
    ALTER TABLE "EntregaRopa" ADD CONSTRAINT "EntregaRopa_empleadoId_fkey"
      FOREIGN KEY ("empleadoId") REFERENCES "Empleado"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
