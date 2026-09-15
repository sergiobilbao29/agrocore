-- v2.213.0 — Sociedad/UTE: carga centralizada + campos externos con campo "sombra"
-- Campo sombra para campos externos de socios (viven bajo la ownerCompany de la sociedad).
ALTER TABLE "Campo" ADD COLUMN IF NOT EXISTS "esExternoSociedad" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Campo" ADD COLUMN IF NOT EXISTS "sociedadId" TEXT;
-- Marca de que el link de la sociedad apunta a un campo sombra externo.
ALTER TABLE "SociedadCampo" ADD COLUMN IF NOT EXISTS "esExterno" BOOLEAN NOT NULL DEFAULT false;
