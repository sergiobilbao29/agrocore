-- v1.97.0 — FIX crítico: la columna User.alias (y fotoUrl/oculto por las dudas)
-- estaba en el schema pero NINGUNA migración la creaba, así que toda instalación
-- NUEVA quedaba con la tabla User incompleta y el login fallaba (Prisma pide
-- columnas que la base no tiene). Idempotente: no rompe instalaciones existentes.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "alias"   TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "fotoUrl" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "oculto"  BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS "User_alias_key" ON "User"("alias");
