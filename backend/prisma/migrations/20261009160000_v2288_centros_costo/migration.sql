-- Centros de costo (gestión analítica). Opt-in por empresa.
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "usaCentrosCosto" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "CentroCosto" (
  "id"            TEXT NOT NULL,
  "companyId"     TEXT NOT NULL,
  "nombre"        TEXT NOT NULL,
  "clasificacion" TEXT,
  "campoId"       TEXT,
  "peso"          DOUBLE PRECISION NOT NULL DEFAULT 0,
  "orden"         INTEGER,
  "observaciones" TEXT,
  "activo"        BOOLEAN NOT NULL DEFAULT true,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CentroCosto_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CentroCosto_companyId_idx" ON "CentroCosto"("companyId");
CREATE INDEX IF NOT EXISTS "CentroCosto_campoId_idx" ON "CentroCosto"("campoId");

DO $$ BEGIN
  ALTER TABLE "CentroCosto" ADD CONSTRAINT "CentroCosto_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CentroCosto" ADD CONSTRAINT "CentroCosto_campoId_fkey" FOREIGN KEY ("campoId") REFERENCES "Campo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
