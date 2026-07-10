-- v1.75.0: Planilla resultado economico + campaña en viajes y movimientos (rinde real)
ALTER TABLE "Campana"    ADD COLUMN IF NOT EXISTS "planilla"  JSONB;
ALTER TABLE "Viaje"      ADD COLUMN IF NOT EXISTS "campanaId" TEXT;
ALTER TABLE "Movimiento" ADD COLUMN IF NOT EXISTS "campanaId" TEXT;
CREATE INDEX IF NOT EXISTS "Movimiento_campanaId_idx" ON "Movimiento"("campanaId");
CREATE INDEX IF NOT EXISTS "Viaje_campanaId_idx" ON "Viaje"("campanaId");
