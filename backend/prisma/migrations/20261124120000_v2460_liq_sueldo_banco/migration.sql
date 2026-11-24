-- v2.460 — Liquidación de sueldo por transferencia genera movimiento bancario.
-- Guarda el id del BancoMovimiento creado para poder revertirlo al anular.
ALTER TABLE "LiquidacionSueldo" ADD COLUMN IF NOT EXISTS "bancoMovimientoId" TEXT;
