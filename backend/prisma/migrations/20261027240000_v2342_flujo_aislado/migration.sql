-- v2.342.0 - Flujo aislado por empresa: la empresa activa con este flag no ve el flujo de las demas. Idempotente.
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "flujoAislado" BOOLEAN NOT NULL DEFAULT false;
