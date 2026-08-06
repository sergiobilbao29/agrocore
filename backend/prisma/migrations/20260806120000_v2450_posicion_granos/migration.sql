-- v2.45.0 - Posicion de granos: vinculo N:M entre Viaje (entrega con CP) y Liquidacion. Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS "ViajeLiquidacion" (
  "id"             TEXT NOT NULL,
  "companyId"      TEXT NOT NULL,
  "viajeId"        TEXT NOT NULL,
  "liquidacionId"  TEXT NOT NULL,
  "kilosAplicados" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ViajeLiquidacion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ViajeLiquidacion_viajeId_liquidacionId_key" ON "ViajeLiquidacion"("viajeId", "liquidacionId");
CREATE INDEX IF NOT EXISTS "ViajeLiquidacion_companyId_idx" ON "ViajeLiquidacion"("companyId");
CREATE INDEX IF NOT EXISTS "ViajeLiquidacion_liquidacionId_idx" ON "ViajeLiquidacion"("liquidacionId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ViajeLiquidacion_companyId_fkey') THEN
    ALTER TABLE "ViajeLiquidacion" ADD CONSTRAINT "ViajeLiquidacion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ViajeLiquidacion_viajeId_fkey') THEN
    ALTER TABLE "ViajeLiquidacion" ADD CONSTRAINT "ViajeLiquidacion_viajeId_fkey" FOREIGN KEY ("viajeId") REFERENCES "Viaje"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ViajeLiquidacion_liquidacionId_fkey') THEN
    ALTER TABLE "ViajeLiquidacion" ADD CONSTRAINT "ViajeLiquidacion_liquidacionId_fkey" FOREIGN KEY ("liquidacionId") REFERENCES "LiquidacionCereal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
