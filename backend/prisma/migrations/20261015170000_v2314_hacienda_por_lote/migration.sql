-- v2.314.0 - Stock de hacienda por lote/potrero (multi-categoria + traslado parcial lote<->lote).
-- Agrega loteId a HaciendaStock y HaciendaMovimiento, y loteOrigen/loteDestino a los movimientos.
-- Backward-compatible: loteId NULL = nivel campo (como antes). Idempotente.

ALTER TABLE "HaciendaStock"      ADD COLUMN IF NOT EXISTS "loteId" TEXT;
ALTER TABLE "HaciendaMovimiento" ADD COLUMN IF NOT EXISTS "loteId" TEXT;
ALTER TABLE "HaciendaMovimiento" ADD COLUMN IF NOT EXISTS "loteOrigen" TEXT;
ALTER TABLE "HaciendaMovimiento" ADD COLUMN IF NOT EXISTS "loteDestino" TEXT;

-- Reemplazar el unique (companyId, campoId, categoria) por (companyId, campoId, loteId, categoria).
DROP INDEX IF EXISTS "HaciendaStock_companyId_campoId_categoria_key";
CREATE UNIQUE INDEX IF NOT EXISTS "HaciendaStock_companyId_campoId_loteId_categoria_key"
  ON "HaciendaStock"("companyId", "campoId", "loteId", "categoria");

CREATE INDEX IF NOT EXISTS "HaciendaStock_loteId_idx"      ON "HaciendaStock"("loteId");
CREATE INDEX IF NOT EXISTS "HaciendaMovimiento_loteId_idx" ON "HaciendaMovimiento"("loteId");
