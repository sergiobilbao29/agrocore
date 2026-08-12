-- v2.78.0 - Campana forrajera multicorte: tipoCampana + eventos de corte.
-- Aditiva e idempotente.

ALTER TABLE "Campana" ADD COLUMN IF NOT EXISTS "tipoCampana" TEXT DEFAULT 'cosecha_unica';

CREATE TABLE IF NOT EXISTS "CorteForraje" (
  "id"               TEXT NOT NULL,
  "companyId"        TEXT NOT NULL,
  "campanaId"        TEXT NOT NULL,
  "fecha"            TIMESTAMP(3) NOT NULL,
  "trabajo"          TEXT NOT NULL DEFAULT 'enrollado',
  "destino"          TEXT NOT NULL DEFAULT 'galpon',
  "cantidad"         DOUBLE PRECISION NOT NULL DEFAULT 0,
  "unidad"           TEXT NOT NULL DEFAULT 'rollos',
  "productoId"       TEXT,
  "costoContratista" DOUBLE PRECISION DEFAULT 0,
  "costoInsumos"     DOUBLE PRECISION DEFAULT 0,
  "moneda"           TEXT NOT NULL DEFAULT 'ARS',
  "costoUnitario"    DOUBLE PRECISION DEFAULT 0,
  "movimientoStockId" TEXT,
  "observaciones"    TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CorteForraje_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CorteForraje_companyId_idx" ON "CorteForraje"("companyId");
CREATE INDEX IF NOT EXISTS "CorteForraje_campanaId_idx" ON "CorteForraje"("campanaId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CorteForraje_companyId_fkey') THEN
    ALTER TABLE "CorteForraje" ADD CONSTRAINT "CorteForraje_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CorteForraje_campanaId_fkey') THEN
    ALTER TABLE "CorteForraje" ADD CONSTRAINT "CorteForraje_campanaId_fkey"
      FOREIGN KEY ("campanaId") REFERENCES "Campana"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
