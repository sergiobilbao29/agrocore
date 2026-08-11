-- v2.62.0 - Faena: registro editable que enlaza la liquidacion (salida de vivos)
-- y la factura de compra (entrada del faenado). Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS "Faena" (
  "id"               TEXT NOT NULL,
  "companyId"        TEXT NOT NULL,
  "fecha"            TIMESTAMP(3) NOT NULL,
  "frigorifico"      TEXT,
  "frigorificoCuit"  TEXT,
  "tropa"            TEXT,
  "campoId"          TEXT,
  "categoria"        TEXT,
  "cabezas"          INTEGER,
  "kgVivo"           DOUBLE PRECISION,
  "precioKgVivo"     DOUBLE PRECISION,
  "ivaVivo"          DOUBLE PRECISION,
  "numeroLiq"        TEXT,
  "descontarSenasa"  BOOLEAN NOT NULL DEFAULT true,
  "producto"         TEXT,
  "lechonesEnteros"  INTEGER,
  "kgFaenado"        DOUBLE PRECISION,
  "precioKgFaenado"  DOUBLE PRECISION,
  "ivaFaenado"       DOUBLE PRECISION,
  "facturaPv"        INTEGER,
  "facturaNro"       INTEGER,
  "fechaFactura"     TIMESTAMP(3),
  "depositoId"       TEXT,
  "liquidacionId"    TEXT,
  "facturaCompraId"  TEXT,
  "observaciones"    TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Faena_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Faena_companyId_idx" ON "Faena"("companyId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Faena_companyId_fkey') THEN
    ALTER TABLE "Faena" ADD CONSTRAINT "Faena_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
