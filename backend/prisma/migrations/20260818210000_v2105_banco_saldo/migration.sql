-- v2.105.0 - Guardar el saldo real del banco por movimiento (del resumen importado).
-- Aditiva e idempotente.
ALTER TABLE "BancoMovimiento" ADD COLUMN IF NOT EXISTS "saldoBanco" DOUBLE PRECISION;
