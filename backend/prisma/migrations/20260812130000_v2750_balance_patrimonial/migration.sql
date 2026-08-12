-- v2.75.0 - Estado de Situacion Patrimonial: lineas manuales de ajuste.
-- Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS "BalanceAjusteManual" (
  "id"        TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "seccion"   TEXT NOT NULL,
  "rubro"     TEXT NOT NULL,
  "monto"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "moneda"    TEXT NOT NULL DEFAULT 'ARS',
  "notas"     TEXT,
  "orden"     INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BalanceAjusteManual_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BalanceAjusteManual_companyId_idx" ON "BalanceAjusteManual"("companyId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BalanceAjusteManual_companyId_fkey') THEN
    ALTER TABLE "BalanceAjusteManual" ADD CONSTRAINT "BalanceAjusteManual_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
