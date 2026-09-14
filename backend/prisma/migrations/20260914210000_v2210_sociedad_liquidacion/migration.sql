-- v2.210.0 — Liquidación de la participación de socios en la Sociedad/UTE (fase 2).
ALTER TABLE "Sociedad" ADD COLUMN IF NOT EXISTS "liquidacion" JSONB;
