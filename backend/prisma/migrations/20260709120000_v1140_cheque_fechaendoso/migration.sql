-- v1.14.0 — Fecha de endoso/entrega del cheque. Idempotente.
ALTER TABLE "Cheque" ADD COLUMN IF NOT EXISTS "fechaEndoso" TIMESTAMP(3);
