-- v2.59.0 - Conciliacion bancaria mensual por cuenta. Aditiva e idempotente.
-- Al confirmar un periodo (YYYY-MM) para una cuenta, los movimientos de esa
-- cuenta en ese mes quedan bloqueados hasta reabrir la conciliacion.

CREATE TABLE IF NOT EXISTS "ConciliacionBancaria" (
  "id"            TEXT NOT NULL,
  "companyId"     TEXT NOT NULL,
  "cuentaId"      TEXT NOT NULL,
  "periodo"       TEXT NOT NULL,
  "fecha"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "saldoExtracto" DOUBLE PRECISION,
  "saldoSistema"  DOUBLE PRECISION,
  "observaciones" TEXT,
  "userId"        TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConciliacionBancaria_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ConciliacionBancaria_cuentaId_periodo_key" ON "ConciliacionBancaria"("cuentaId", "periodo");
CREATE INDEX IF NOT EXISTS "ConciliacionBancaria_companyId_idx" ON "ConciliacionBancaria"("companyId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ConciliacionBancaria_companyId_fkey') THEN
    ALTER TABLE "ConciliacionBancaria" ADD CONSTRAINT "ConciliacionBancaria_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ConciliacionBancaria_cuentaId_fkey') THEN
    ALTER TABLE "ConciliacionBancaria" ADD CONSTRAINT "ConciliacionBancaria_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "BancoCuenta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
