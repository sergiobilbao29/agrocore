-- v2.143.0: préstamo de fichas de animales (prestado / afuera; puede volver)
ALTER TABLE "Animal" ADD COLUMN IF NOT EXISTS "prestadoA" TEXT;
ALTER TABLE "Animal" ADD COLUMN IF NOT EXISTS "prestamoFecha" TIMESTAMP(3);
ALTER TABLE "Animal" ADD COLUMN IF NOT EXISTS "prestamoVuelta" TIMESTAMP(3);
