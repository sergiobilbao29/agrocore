-- v2.355.0 - Datos fiscales de retenciones + catálogo de regímenes. Idempotente.

-- Config fiscal de la empresa (agente de retención)
ALTER TABLE "Company"   ADD COLUMN IF NOT EXISTS "condGanancias"   TEXT;
ALTER TABLE "Company"   ADD COLUMN IF NOT EXISTS "fiscalRetencion" JSONB;

-- Datos fiscales de contactos (NO se presumen por el nombre)
ALTER TABLE "Cliente"   ADD COLUMN IF NOT EXISTS "condGanancias"   TEXT;
ALTER TABLE "Cliente"   ADD COLUMN IF NOT EXISTS "fiscalRetencion" JSONB;
ALTER TABLE "Proveedor" ADD COLUMN IF NOT EXISTS "condGanancias"   TEXT;
ALTER TABLE "Proveedor" ADD COLUMN IF NOT EXISTS "fiscalRetencion" JSONB;

-- Catálogo de regímenes de retención/percepción (por empresa, versionado)
CREATE TABLE IF NOT EXISTS "RegimenRetencion" (
  "id"                  TEXT NOT NULL,
  "companyId"           TEXT NOT NULL,
  "nombre"              TEXT NOT NULL,
  "naturaleza"          TEXT NOT NULL DEFAULT 'practicada',
  "clase"               TEXT NOT NULL DEFAULT 'retencion',
  "organismo"           TEXT,
  "impuesto"            TEXT NOT NULL,
  "jurisdiccion"        TEXT,
  "codigoRegimen"       TEXT,
  "tipoOperacion"       TEXT,
  "baseCalculo"         TEXT NOT NULL DEFAULT 'neto',
  "alicuota"            DOUBLE PRECISION NOT NULL DEFAULT 0,
  "alicuotaNoInscripto" DOUBLE PRECISION,
  "minimoNoSujeto"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "minimoRetencion"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "importeFijo"         DOUBLE PRECISION,
  "escala"              JSONB,
  "acumulaPeriodo"      BOOLEAN NOT NULL DEFAULT false,
  "redondeo"            TEXT NOT NULL DEFAULT '2dec',
  "sistema"             TEXT,
  "vigenciaDesde"       TIMESTAMP(3),
  "vigenciaHasta"       TIMESTAMP(3),
  "version"             INTEGER NOT NULL DEFAULT 1,
  "activo"              BOOLEAN NOT NULL DEFAULT true,
  "orden"              INTEGER NOT NULL DEFAULT 0,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RegimenRetencion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "RegimenRetencion_companyId_idx"  ON "RegimenRetencion"("companyId");
CREATE INDEX IF NOT EXISTS "RegimenRetencion_impuesto_idx"   ON "RegimenRetencion"("impuesto");
CREATE INDEX IF NOT EXISTS "RegimenRetencion_naturaleza_idx" ON "RegimenRetencion"("naturaleza");
DO $$ BEGIN
  ALTER TABLE "RegimenRetencion" ADD CONSTRAINT "RegimenRetencion_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
