-- v1.7.0 — Mapeo producto -> categoría de hacienda (para vincular el stock de
-- Productos con el stock de hacienda nutrido por los movimientos). Idempotente.
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "categoriaHacienda" TEXT;
