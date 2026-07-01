-- v1.44.0 — Garantiza que la cuenta bancaria tenga la columna del saldo de apertura
-- y su fecha, por si alguna base quedó desincronizada (idempotente).
ALTER TABLE "BancoCuenta" ADD COLUMN IF NOT EXISTS "saldoInicial" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "BancoCuenta" ADD COLUMN IF NOT EXISTS "fechaInicial" TIMESTAMP(3);
