-- Campos de seguimiento comercial adicionales para los leads de prueba (TrialSignup)
ALTER TABLE "TrialSignup" ADD COLUMN IF NOT EXISTS "origen" TEXT;
ALTER TABLE "TrialSignup" ADD COLUMN IF NOT EXISTS "segPrimerContacto" TIMESTAMP(3);
ALTER TABLE "TrialSignup" ADD COLUMN IF NOT EXISTS "segUltimoContacto" TIMESTAMP(3);
