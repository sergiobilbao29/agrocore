-- v2.316.0 - Red de vendedores / partners (Etapa 1: datos).
-- Modelo Vendedor (global), vinculo Empresa->vendedor y Lead->vendedor, y "se factura a".
-- Idempotente.

CREATE TABLE IF NOT EXISTS "Vendedor" (
  "id"             TEXT NOT NULL,
  "nombre"         TEXT NOT NULL,
  "email"          TEXT,
  "telefono"       TEXT,
  "cuit"           TEXT,
  "activo"         BOOLEAN NOT NULL DEFAULT true,
  "comisionEscala" JSONB,
  "userId"         TEXT,
  "notas"          TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Vendedor_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Vendedor_userId_idx" ON "Vendedor"("userId");

ALTER TABLE "Company"     ADD COLUMN IF NOT EXISTS "vendedorId" TEXT;
ALTER TABLE "Company"     ADD COLUMN IF NOT EXISTS "facturarA"  TEXT NOT NULL DEFAULT 'cliente';
ALTER TABLE "TrialSignup" ADD COLUMN IF NOT EXISTS "vendedorId" TEXT;

CREATE INDEX IF NOT EXISTS "TrialSignup_vendedorId_idx" ON "TrialSignup"("vendedorId");
