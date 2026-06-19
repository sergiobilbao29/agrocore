-- Campo: tipo de explotacion + multiples RENSPAs + geolocalizacion
ALTER TABLE "Campo" ADD COLUMN "tipoExplotacion" TEXT;
ALTER TABLE "Campo" ADD COLUMN "renspas"         JSONB;
ALTER TABLE "Campo" ADD COLUMN "geolocalizacion" TEXT;
