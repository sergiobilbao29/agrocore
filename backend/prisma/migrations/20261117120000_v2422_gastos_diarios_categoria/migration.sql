-- Movimientos diarios: guardar la categoría de gasto (árbol) y la clasificación
-- empresa/propio en los movimientos de efectivo y de banco, para que el
-- Reporte de Gastos por categoría los incluya.
ALTER TABLE "Efectivo" ADD COLUMN IF NOT EXISTS "categoriaGastoId" TEXT;
ALTER TABLE "BancoMovimiento" ADD COLUMN IF NOT EXISTS "clasificacion" TEXT;
ALTER TABLE "BancoMovimiento" ADD COLUMN IF NOT EXISTS "categoriaGastoId" TEXT;
CREATE INDEX IF NOT EXISTS "Efectivo_categoriaGastoId_idx" ON "Efectivo"("categoriaGastoId");
CREATE INDEX IF NOT EXISTS "BancoMovimiento_categoriaGastoId_idx" ON "BancoMovimiento"("categoriaGastoId");
