-- Resumen (estado de cuenta) de tarjeta de crédito
CREATE TABLE IF NOT EXISTS "ResumenTarjeta" (
  "id"            TEXT NOT NULL,
  "companyId"     TEXT NOT NULL,
  "tarjeta"       TEXT,
  "numero"        TEXT,
  "fechaCierre"   TIMESTAMP(3),
  "vencimiento"   TIMESTAMP(3),
  "totalPesos"    DOUBLE PRECISION,
  "totalDolares"  DOUBLE PRECISION,
  "minimoPesos"   DOUBLE PRECISION,
  "estado"        TEXT NOT NULL DEFAULT 'pendiente',
  "origen"        TEXT,
  "detalle"       JSONB,
  "pagoFecha"     TIMESTAMP(3),
  "pagoMetodo"    TEXT,
  "pagoImporte"   DOUBLE PRECISION,
  "movEfectivoId" TEXT,
  "movBancoId"    TEXT,
  "cardIngresoId" TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResumenTarjeta_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ResumenTarjeta_companyId_idx"   ON "ResumenTarjeta"("companyId");
CREATE INDEX IF NOT EXISTS "ResumenTarjeta_tarjeta_idx"     ON "ResumenTarjeta"("tarjeta");
CREATE INDEX IF NOT EXISTS "ResumenTarjeta_vencimiento_idx" ON "ResumenTarjeta"("vencimiento");
DO $$ BEGIN
  ALTER TABLE "ResumenTarjeta" ADD CONSTRAINT "ResumenTarjeta_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
