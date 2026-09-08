-- v2.184: prueba gratuita self-service (plan trial con vencimiento y extensión única).
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "plan" TEXT NOT NULL DEFAULT 'full';
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "trialEndsAt" TIMESTAMP(3);
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "trialExtended" BOOLEAN NOT NULL DEFAULT false;

-- Registro público de prueba gratuita (alta pendiente hasta confirmar email).
CREATE TABLE IF NOT EXISTS "TrialSignup" (
  "id"           TEXT NOT NULL,
  "email"        TEXT NOT NULL,
  "cuit"         TEXT,
  "nombre"       TEXT NOT NULL,
  "empresa"      TEXT NOT NULL,
  "telefono"     TEXT,
  "actividad"    TEXT,
  "passwordHash" TEXT NOT NULL,
  "token"        TEXT NOT NULL,
  "expiresAt"    TIMESTAMP(3) NOT NULL,
  "verifiedAt"   TIMESTAMP(3),
  "companyId"    TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrialSignup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "TrialSignup_token_key" ON "TrialSignup"("token");
CREATE INDEX IF NOT EXISTS "TrialSignup_email_idx" ON "TrialSignup"("email");
