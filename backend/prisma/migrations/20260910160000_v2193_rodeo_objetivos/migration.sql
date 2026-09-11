-- v2.193: objetivos/presupuesto por rodeo para el tablero de eficiencia (semaforizacion).
ALTER TABLE "Rodeo" ADD COLUMN IF NOT EXISTS "objetivoCostoKg" DOUBLE PRECISION;
ALTER TABLE "Rodeo" ADD COLUMN IF NOT EXISTS "objetivoGpd"     DOUBLE PRECISION;
