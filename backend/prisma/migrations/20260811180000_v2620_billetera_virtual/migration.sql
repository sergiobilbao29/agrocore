-- v2.62.0 - BancoCuenta: marca de Billetera Virtual (Naranja X, Mercado Pago, etc).
-- Mismo tratamiento que una cuenta bancaria pero se puede filtrar aparte. Aditiva.
ALTER TABLE "BancoCuenta" ADD COLUMN IF NOT EXISTS "esBilleteraVirtual" BOOLEAN NOT NULL DEFAULT false;
