-- v1.1.0 consolidacion: agregar campos que estan en schema.prisma pero faltan en migraciones
-- 100% idempotente: solo ALTER ... ADD COLUMN IF NOT EXISTS y CREATE ... IF NOT EXISTS.
-- NO usar DO $$ BEGIN ... EXCEPTION (Prisma marca toda la migracion como failed si emite warnings).

-- Company
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "pais"    TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;

-- User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "fotoUrl" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "oculto"  BOOLEAN NOT NULL DEFAULT false;

-- Cliente / Proveedor
ALTER TABLE "Cliente"   ADD COLUMN IF NOT EXISTS "pais" TEXT;
ALTER TABLE "Proveedor" ADD COLUMN IF NOT EXISTS "pais" TEXT;

-- Cheque
ALTER TABLE "Cheque" ADD COLUMN IF NOT EXISTS "cuenta" TEXT;

-- CtaCte
ALTER TABLE "CtaCte" ADD COLUMN IF NOT EXISTS "empresaContraparteId" TEXT;
ALTER TABLE "CtaCte" ADD COLUMN IF NOT EXISTS "intercompanyRef"      TEXT;

-- Empleado
ALTER TABLE "Empleado" ADD COLUMN IF NOT EXISTS "fotoUrl"   TEXT;
ALTER TABLE "Empleado" ADD COLUMN IF NOT EXISTS "localidad" TEXT;
ALTER TABLE "Empleado" ADD COLUMN IF NOT EXISTS "provincia" TEXT;

-- Viaje (campos legacy/extra)
ALTER TABLE "Viaje" ADD COLUMN IF NOT EXISTS "kgDescarga"   DOUBLE PRECISION;
ALTER TABLE "Viaje" ADD COLUMN IF NOT EXISTS "cdp"          TEXT;
ALTER TABLE "Viaje" ADD COLUMN IF NOT EXISTS "pagadorFlete" TEXT;
ALTER TABLE "Viaje" ADD COLUMN IF NOT EXISTS "km"           DOUBLE PRECISION;
ALTER TABLE "Viaje" ADD COLUMN IF NOT EXISTS "combustible"  DOUBLE PRECISION;
ALTER TABLE "Viaje" ADD COLUMN IF NOT EXISTS "peajes"       DOUBLE PRECISION;
ALTER TABLE "Viaje" ADD COLUMN IF NOT EXISTS "comida"       DOUBLE PRECISION;
ALTER TABLE "Viaje" ADD COLUMN IF NOT EXISTS "varios"       DOUBLE PRECISION;
ALTER TABLE "Viaje" ADD COLUMN IF NOT EXISTS "total"        DOUBLE PRECISION;

-- Bug #5: cheques con estado 'en cartera' (espacio) -> 'en_cartera' (subrayado)
UPDATE "Cheque" SET "estado" = 'en_cartera' WHERE "estado" = 'en cartera';

-- IntercompanyMovimiento + ImportLote se manejan en v121_patch con los nombres correctos
-- del schema.prisma (empresaOrigenId/empresaDestinoId, no companyOrigenId/companyDestinoId).
-- Aqui no creamos esas tablas para evitar el conflicto con tablas creadas por db push previo.
