-- v2.3.0 — Numeración correlativa de comprobantes internos (OP / Recibo)
-- Idempotente: en instalaciones que ya la tengan no cambia nada.
CREATE TABLE IF NOT EXISTS "SecuenciaComprobante" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "puntoVenta" INTEGER NOT NULL DEFAULT 1,
    "proximoNumero" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SecuenciaComprobante_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SecuenciaComprobante_companyId_tipo_puntoVenta_key"
    ON "SecuenciaComprobante"("companyId", "tipo", "puntoVenta");

DO $$ BEGIN
  ALTER TABLE "SecuenciaComprobante" ADD CONSTRAINT "SecuenciaComprobante_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
