-- v2.341.0 - Sociedades por lote: permite aportar un lote especifico (o campo completo). Idempotente.
ALTER TABLE "SociedadCampo" ADD COLUMN IF NOT EXISTS "loteId" TEXT;
ALTER TABLE "SociedadCampo" ADD COLUMN IF NOT EXISTS "loteNombre" TEXT;
