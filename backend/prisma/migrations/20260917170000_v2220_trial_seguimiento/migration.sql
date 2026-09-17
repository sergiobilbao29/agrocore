-- v2.220.0 — Seguimiento comercial de los leads de la prueba gratuita (CRM interno)
ALTER TABLE "TrialSignup" ADD COLUMN "segEstado" TEXT;
ALTER TABLE "TrialSignup" ADD COLUMN "segFecha" TIMESTAMP(3);
ALTER TABLE "TrialSignup" ADD COLUMN "segNotas" TEXT;
