-- v2.192: vínculo cliente↔proveedor (misma persona con ambos roles) + compensación de cuentas.
-- Cliente y Proveedor comparten vinculoId cuando son la misma entidad.
ALTER TABLE "Cliente"   ADD COLUMN IF NOT EXISTS "vinculoId" TEXT;
ALTER TABLE "Proveedor" ADD COLUMN IF NOT EXISTS "vinculoId" TEXT;
CREATE INDEX IF NOT EXISTS "Cliente_vinculoId_idx"   ON "Cliente"("vinculoId");
CREATE INDEX IF NOT EXISTS "Proveedor_vinculoId_idx" ON "Proveedor"("vinculoId");

-- Compensación: netea cta a cobrar (cliente) contra cta a pagar (proveedor). No mueve caja/banco.
CREATE TABLE IF NOT EXISTS "Compensacion" (
  "id"            TEXT NOT NULL,
  "companyId"     TEXT NOT NULL,
  "fecha"         TIMESTAMP(3) NOT NULL,
  "clienteId"     TEXT NOT NULL,
  "proveedorId"   TEXT NOT NULL,
  "monto"         DOUBLE PRECISION NOT NULL,
  "moneda"        TEXT NOT NULL DEFAULT 'ARS',
  "ccClienteId"   TEXT,
  "ccProveedorId" TEXT,
  "referencia"    TEXT,
  "observaciones" TEXT,
  "userId"        TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Compensacion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Compensacion_companyId_idx"   ON "Compensacion"("companyId");
CREATE INDEX IF NOT EXISTS "Compensacion_clienteId_idx"   ON "Compensacion"("clienteId");
CREATE INDEX IF NOT EXISTS "Compensacion_proveedorId_idx" ON "Compensacion"("proveedorId");

DO $$ BEGIN
  ALTER TABLE "Compensacion" ADD CONSTRAINT "Compensacion_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
