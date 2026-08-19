-- v2.113.0 - Rol con visibilidad limitada a ciertas campañas (Socio).
-- Aditiva e idempotente.
ALTER TABLE "Role" ADD COLUMN IF NOT EXISTS "campanaIds" JSONB;
