-- v2.357.0 - Retenciones P3: certificados (estado) + liquidación practicadas + créditos sufridas. Idempotente.

ALTER TABLE "Retencion" ADD COLUMN IF NOT EXISTS "estado"          TEXT;
ALTER TABLE "Retencion" ADD COLUMN IF NOT EXISTS "periodo"         TEXT;
ALTER TABLE "Retencion" ADD COLUMN IF NOT EXISTS "ingresadoRef"    TEXT;
ALTER TABLE "Retencion" ADD COLUMN IF NOT EXISTS "aplicadoCredito" DOUBLE PRECISION NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "Retencion_ingresadoRef_idx" ON "Retencion"("ingresadoRef");

CREATE TABLE IF NOT EXISTS "PagoFiscal" (
  "id"            TEXT NOT NULL,
  "companyId"     TEXT NOT NULL,
  "fecha"         TIMESTAMP(3) NOT NULL,
  "impuesto"      TEXT NOT NULL,
  "periodo"       TEXT NOT NULL,
  "jurisdiccion"  TEXT,
  "sistema"       TEXT,
  "importe"       DOUBLE PRECISION NOT NULL,
  "cantidad"      INTEGER NOT NULL DEFAULT 0,
  "metodo"        TEXT NOT NULL DEFAULT 'transferencia',
  "bancoCuentaId" TEXT,
  "cajaOrigen"    TEXT,
  "observaciones" TEXT,
  "userId"        TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PagoFiscal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PagoFiscal_companyId_idx" ON "PagoFiscal"("companyId");
CREATE INDEX IF NOT EXISTS "PagoFiscal_impuesto_idx"  ON "PagoFiscal"("impuesto");
CREATE INDEX IF NOT EXISTS "PagoFiscal_periodo_idx"   ON "PagoFiscal"("periodo");
DO $$ BEGIN
  ALTER TABLE "PagoFiscal" ADD CONSTRAINT "PagoFiscal_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "AplicacionCreditoFiscal" (
  "id"              TEXT NOT NULL,
  "companyId"       TEXT NOT NULL,
  "retencionId"     TEXT NOT NULL,
  "fecha"           TIMESTAMP(3) NOT NULL,
  "impuesto"        TEXT NOT NULL,
  "periodoDDJJ"     TEXT NOT NULL,
  "importeAplicado" DOUBLE PRECISION NOT NULL,
  "observaciones"   TEXT,
  "userId"          TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AplicacionCreditoFiscal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AplicacionCreditoFiscal_companyId_idx"   ON "AplicacionCreditoFiscal"("companyId");
CREATE INDEX IF NOT EXISTS "AplicacionCreditoFiscal_retencionId_idx" ON "AplicacionCreditoFiscal"("retencionId");
CREATE INDEX IF NOT EXISTS "AplicacionCreditoFiscal_periodoDDJJ_idx" ON "AplicacionCreditoFiscal"("periodoDDJJ");
DO $$ BEGIN
  ALTER TABLE "AplicacionCreditoFiscal" ADD CONSTRAINT "AplicacionCreditoFiscal_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
