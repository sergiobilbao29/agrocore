-- v2.353.0 - Otros impuestos y percepciones en facturas de compra. Idempotente.
ALTER TABLE "FacturaCompra" ADD COLUMN IF NOT EXISTS "otrosTributos" JSONB;
ALTER TABLE "FacturaCompra" ADD COLUMN IF NOT EXISTS "totalOtrosTributos" DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "TributoCatalogo" (
  "id"        TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "nombre"    TEXT NOT NULL,
  "tipo"      TEXT NOT NULL DEFAULT 'fijo',
  "alicuota"  DOUBLE PRECISION NOT NULL DEFAULT 0,
  "base"      TEXT NOT NULL DEFAULT 'neto',
  "activo"    BOOLEAN NOT NULL DEFAULT true,
  "orden"     INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TributoCatalogo_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "TributoCatalogo_companyId_idx" ON "TributoCatalogo"("companyId");
DO $$ BEGIN
  ALTER TABLE "TributoCatalogo" ADD CONSTRAINT "TributoCatalogo_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
