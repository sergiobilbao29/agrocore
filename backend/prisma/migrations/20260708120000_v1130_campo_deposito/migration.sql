-- v1.13.0 — Los campos pueden funcionar como depósitos. Idempotente.
ALTER TABLE "Campo"    ADD COLUMN IF NOT EXISTS "esDeposito" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Deposito" ADD COLUMN IF NOT EXISTS "campoId" TEXT;
CREATE INDEX IF NOT EXISTS "Deposito_campoId_idx" ON "Deposito"("campoId");
