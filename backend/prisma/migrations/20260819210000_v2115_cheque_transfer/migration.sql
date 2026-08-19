-- v2.115.0 - Transferencia de cheque entre empresas del mismo grupo economico.
-- Aditiva e idempotente.
ALTER TABLE "Cheque" ADD COLUMN IF NOT EXISTS "transferRef" TEXT;
ALTER TABLE "Cheque" ADD COLUMN IF NOT EXISTS "origenEmpresaId" TEXT;
ALTER TABLE "Cheque" ADD COLUMN IF NOT EXISTS "destinoEmpresaId" TEXT;
CREATE INDEX IF NOT EXISTS "Cheque_transferRef_idx" ON "Cheque"("transferRef");
