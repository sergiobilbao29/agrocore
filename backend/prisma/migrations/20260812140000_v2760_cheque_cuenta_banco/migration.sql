-- v2.76.0 - Cheque: cuenta bancaria donde se deposita/acredita (para separar
-- "depositado" (en transito) de "cobrado/acreditado"). Aditiva e idempotente.
ALTER TABLE "Cheque" ADD COLUMN IF NOT EXISTS "cuentaBancoId" TEXT;
