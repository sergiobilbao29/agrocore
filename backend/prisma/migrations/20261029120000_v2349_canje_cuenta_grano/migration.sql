-- v2.349.0 - Cuenta corriente de canje en especie (saldada en grano/soja). Idempotente.
CREATE TABLE IF NOT EXISTS "CanjeCtaMov" (
  "id"             TEXT NOT NULL,
  "companyId"      TEXT NOT NULL,
  "fecha"          TIMESTAMP(3) NOT NULL,
  "contactoTipo"   TEXT NOT NULL,
  "contactoId"     TEXT NOT NULL,
  "contactoNombre" TEXT,
  "tipo"           TEXT NOT NULL,
  "productoId"     TEXT,
  "cantidad"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "factor"         DOUBLE PRECISION NOT NULL DEFAULT 1,
  "equivSoja"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "depositoId"     TEXT,
  "generaStock"    BOOLEAN NOT NULL DEFAULT true,
  "referencia"     TEXT,
  "observaciones"  TEXT,
  "userId"         TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CanjeCtaMov_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CanjeCtaMov_companyId_idx" ON "CanjeCtaMov"("companyId");
CREATE INDEX IF NOT EXISTS "CanjeCtaMov_contactoTipo_contactoId_idx" ON "CanjeCtaMov"("contactoTipo", "contactoId");
CREATE INDEX IF NOT EXISTS "CanjeCtaMov_fecha_idx" ON "CanjeCtaMov"("fecha");
DO $$ BEGIN
  ALTER TABLE "CanjeCtaMov" ADD CONSTRAINT "CanjeCtaMov_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
