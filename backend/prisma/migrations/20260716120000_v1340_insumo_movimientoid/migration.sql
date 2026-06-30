-- v1.34.0 — Uso de insumo descuenta stock.
-- Vinculamos cada aplicación de insumo con el movimiento de egreso que genera,
-- para poder ajustarlo al editar y revertirlo al borrar.
ALTER TABLE "InsumoAplicado" ADD COLUMN IF NOT EXISTS "movimientoId" TEXT;
