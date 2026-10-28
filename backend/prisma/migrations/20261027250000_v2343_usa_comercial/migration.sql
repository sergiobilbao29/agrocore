-- v2.343.0 - Modulo Comercial opt-in por empresa (vendedores/partners/leads/abonos). Idempotente.
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "usaComercial" BOOLEAN NOT NULL DEFAULT false;
