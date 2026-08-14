-- v2.90.0 - Retenciones y percepciones (sufridas / practicadas). Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS "Retencion" (
  "id"                TEXT NOT NULL,
  "companyId"         TEXT NOT NULL,
  "naturaleza"        TEXT NOT NULL,
  "clase"             TEXT NOT NULL DEFAULT 'retencion',
  "impuesto"          TEXT NOT NULL,
  "regimen"           TEXT,
  "jurisdiccion"      TEXT,
  "fecha"             TIMESTAMP(3) NOT NULL,
  "contactoTipo"      TEXT,
  "contactoId"        TEXT,
  "contactoNombre"    TEXT,
  "cuit"              TEXT,
  "numeroCertificado" TEXT,
  "baseImponible"     DOUBLE PRECISION,
  "alicuota"          DOUBLE PRECISION,
  "importe"           DOUBLE PRECISION NOT NULL,
  "comprobanteRef"    TEXT,
  "moneda"            TEXT NOT NULL DEFAULT 'ARS',
  "observaciones"     TEXT,
  "userId"            TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Retencion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Retencion_companyId_idx" ON "Retencion"("companyId");
CREATE INDEX IF NOT EXISTS "Retencion_fecha_idx" ON "Retencion"("fecha");
CREATE INDEX IF NOT EXISTS "Retencion_naturaleza_idx" ON "Retencion"("naturaleza");
CREATE INDEX IF NOT EXISTS "Retencion_impuesto_idx" ON "Retencion"("impuesto");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Retencion_companyId_fkey') THEN
    ALTER TABLE "Retencion" ADD CONSTRAINT "Retencion_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
