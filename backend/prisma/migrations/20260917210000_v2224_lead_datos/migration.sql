-- v2.224.0 — Leads: provincia, ciudad, varios contactos y flag de mantenimiento mensual
ALTER TABLE "TrialSignup" ADD COLUMN "provincia" TEXT;
ALTER TABLE "TrialSignup" ADD COLUMN "ciudad" TEXT;
ALTER TABLE "TrialSignup" ADD COLUMN "contactos" JSONB;
ALTER TABLE "TrialSignup" ADD COLUMN "mantenimiento" BOOLEAN NOT NULL DEFAULT false;
