-- v1.2.9 — Campos extra de cheque: recepción, CUIT titular, endosante, en poder de.
-- Idempotente. Las FKs/constraints (no hay nuevas) las reconcilia prisma db push.

ALTER TABLE "Cheque" ADD COLUMN IF NOT EXISTS "cuitTitular"    TEXT;
ALTER TABLE "Cheque" ADD COLUMN IF NOT EXISTS "endosante"      TEXT;
ALTER TABLE "Cheque" ADD COLUMN IF NOT EXISTS "fechaRecepcion" TIMESTAMP(3);
ALTER TABLE "Cheque" ADD COLUMN IF NOT EXISTS "enPoderDe"      TEXT;
