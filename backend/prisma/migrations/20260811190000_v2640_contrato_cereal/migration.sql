-- v2.64.0 - Contrato de cereal (confirmacion de negocio): compromiso de entrega
-- con comprador/corredor, precio (a fijar/fijo), plazo y condiciones. Las cartas
-- de porte (viajes) y las pesificaciones (liquidaciones) se imputan al contrato.
-- Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS "ContratoCereal" (
  "id"                 TEXT NOT NULL,
  "companyId"          TEXT NOT NULL,
  "numeroInterno"      TEXT,
  "numeroCorredor"     TEXT,
  "fecha"              TIMESTAMP(3),
  "cosecha"            TEXT,
  "productoId"         TEXT,
  "cereal"             TEXT,
  "compradorNombre"    TEXT,
  "compradorCuit"      TEXT,
  "corredorNombre"     TEXT,
  "corredorCuit"       TEXT,
  "acopioDepositoId"   TEXT,
  "acopioNombre"       TEXT,
  "procedencia"        TEXT,
  "destino"            TEXT,
  "tnsPactadas"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  "tipoPrecio"         TEXT NOT NULL DEFAULT 'a_fijar',
  "precioFijo"         DOUBLE PRECISION,
  "moneda"             TEXT NOT NULL DEFAULT 'USD',
  "pizarra"            TEXT,
  "comisionPorc"       DOUBLE PRECISION,
  "volatilPorc"        DOUBLE PRECISION,
  "contraFlete"        DOUBLE PRECISION,
  "gastoEntregador"    DOUBLE PRECISION,
  "gastoEntregadorIva" BOOLEAN NOT NULL DEFAULT false,
  "tarifaFlete"        DOUBLE PRECISION,
  "pagoDias"           INTEGER,
  "porcParcial"        DOUBLE PRECISION,
  "porcFinal"          DOUBLE PRECISION,
  "plazoEntregaDesde"  TIMESTAMP(3),
  "plazoEntregaHasta"  TIMESTAMP(3),
  "reciboHasta"        DOUBLE PRECISION,
  "condiciones"        TEXT,
  "observaciones"      TEXT,
  "estado"             TEXT NOT NULL DEFAULT 'abierto',
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContratoCereal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ContratoCereal_companyId_idx" ON "ContratoCereal"("companyId");
CREATE INDEX IF NOT EXISTS "ContratoCereal_estado_idx" ON "ContratoCereal"("estado");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ContratoCereal_companyId_fkey') THEN
    ALTER TABLE "ContratoCereal" ADD CONSTRAINT "ContratoCereal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Imputacion de cartas de porte y liquidaciones al contrato.
ALTER TABLE "Viaje"             ADD COLUMN IF NOT EXISTS "contratoCerealId" TEXT;
ALTER TABLE "LiquidacionCereal" ADD COLUMN IF NOT EXISTS "contratoCerealId" TEXT;
CREATE INDEX IF NOT EXISTS "Viaje_contratoCerealId_idx" ON "Viaje"("contratoCerealId");
CREATE INDEX IF NOT EXISTS "LiquidacionCereal_contratoCerealId_idx" ON "LiquidacionCereal"("contratoCerealId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Viaje_contratoCerealId_fkey') THEN
    ALTER TABLE "Viaje" ADD CONSTRAINT "Viaje_contratoCerealId_fkey" FOREIGN KEY ("contratoCerealId") REFERENCES "ContratoCereal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LiquidacionCereal_contratoCerealId_fkey') THEN
    ALTER TABLE "LiquidacionCereal" ADD CONSTRAINT "LiquidacionCereal_contratoCerealId_fkey" FOREIGN KEY ("contratoCerealId") REFERENCES "ContratoCereal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
