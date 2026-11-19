-- v2.447: costos indirectos individualizados del parte de molienda (luz, gasoil, personal…)
ALTER TABLE "ParteMolienda" ADD COLUMN "costosIndirectos" JSONB;
