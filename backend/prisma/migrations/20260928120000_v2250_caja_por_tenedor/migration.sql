-- v2.250.0 — Modo "caja por tenedor" (opt-in por empresa)
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "cajaPorTenedor" BOOLEAN NOT NULL DEFAULT false;
