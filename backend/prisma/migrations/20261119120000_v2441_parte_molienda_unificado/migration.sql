-- v2.441: parte de molienda unificado (planilla de producción de expeller)
-- Materias primas realmente consumidas (kg variables), horas de jornada y merma de secado.
ALTER TABLE "ParteMolienda" ADD COLUMN "horaInicio" TEXT;
ALTER TABLE "ParteMolienda" ADD COLUMN "horaFin" TEXT;
ALTER TABLE "ParteMolienda" ADD COLUMN "entradas" JSONB;
ALTER TABLE "ParteMolienda" ADD COLUMN "mermaSecadoKg" DOUBLE PRECISION;
