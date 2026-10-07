-- v2.277 - Presupuesto de campana (plan proyectado vs real). Aditivo.
ALTER TABLE "Campana" ADD COLUMN IF NOT EXISTS "presupuesto" JSONB;
