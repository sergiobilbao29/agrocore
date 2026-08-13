-- v2.77.0 - Rodeo / Lote de engorde-cria + eventos (costo por kg de carne).
-- Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS "Rodeo" (
  "id"             TEXT NOT NULL,
  "companyId"      TEXT NOT NULL,
  "nombre"         TEXT NOT NULL,
  "sistema"        TEXT NOT NULL DEFAULT 'feedlot',
  "campoId"        TEXT,
  "categoria"      TEXT,
  "fechaInicio"    TIMESTAMP(3),
  "fechaFin"       TIMESTAMP(3),
  "estado"         TEXT NOT NULL DEFAULT 'activo',
  "cabezasInicial" INTEGER NOT NULL DEFAULT 0,
  "kgInicial"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "observaciones"  TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Rodeo_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RodeoEvento" (
  "id"            TEXT NOT NULL,
  "companyId"     TEXT NOT NULL,
  "rodeoId"       TEXT NOT NULL,
  "fecha"         TIMESTAMP(3) NOT NULL,
  "tipo"          TEXT NOT NULL,
  "concepto"      TEXT,
  "cabezas"       INTEGER,
  "kg"            DOUBLE PRECISION,
  "monto"         DOUBLE PRECISION DEFAULT 0,
  "moneda"        TEXT NOT NULL DEFAULT 'ARS',
  "fleteComision" DOUBLE PRECISION DEFAULT 0,
  "productoId"    TEXT,
  "cantidad"      DOUBLE PRECISION,
  "movimientoStockId" TEXT,
  "observaciones" TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RodeoEvento_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Rodeo_companyId_idx" ON "Rodeo"("companyId");
CREATE INDEX IF NOT EXISTS "Rodeo_campoId_idx" ON "Rodeo"("campoId");
CREATE INDEX IF NOT EXISTS "RodeoEvento_companyId_idx" ON "RodeoEvento"("companyId");
CREATE INDEX IF NOT EXISTS "RodeoEvento_rodeoId_idx" ON "RodeoEvento"("rodeoId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Rodeo_companyId_fkey') THEN
    ALTER TABLE "Rodeo" ADD CONSTRAINT "Rodeo_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Rodeo_campoId_fkey') THEN
    ALTER TABLE "Rodeo" ADD CONSTRAINT "Rodeo_campoId_fkey"
      FOREIGN KEY ("campoId") REFERENCES "Campo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RodeoEvento_companyId_fkey') THEN
    ALTER TABLE "RodeoEvento" ADD CONSTRAINT "RodeoEvento_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RodeoEvento_rodeoId_fkey') THEN
    ALTER TABLE "RodeoEvento" ADD CONSTRAINT "RodeoEvento_rodeoId_fkey"
      FOREIGN KEY ("rodeoId") REFERENCES "Rodeo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
