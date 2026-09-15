-- v2.215.0 — Deducciones del comprador en liquidaciones de cereal (flete/gastos)
CREATE TABLE IF NOT EXISTS "LiquidacionDeduccion" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "liquidacionId" TEXT NOT NULL,
  "concepto" TEXT NOT NULL,
  "importe" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "facturaCompraId" TEXT,
  "proveedorId" TEXT,
  "ctaCteLiqId" TEXT,
  "ctaCtePagoId" TEXT,
  "observaciones" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LiquidacionDeduccion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LiquidacionDeduccion_liquidacionId_idx" ON "LiquidacionDeduccion"("liquidacionId");
CREATE INDEX IF NOT EXISTS "LiquidacionDeduccion_companyId_idx" ON "LiquidacionDeduccion"("companyId");
DO $$ BEGIN
  ALTER TABLE "LiquidacionDeduccion" ADD CONSTRAINT "LiquidacionDeduccion_liquidacionId_fkey"
    FOREIGN KEY ("liquidacionId") REFERENCES "LiquidacionCereal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
