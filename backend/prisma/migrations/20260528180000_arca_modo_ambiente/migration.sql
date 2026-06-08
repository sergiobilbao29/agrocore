-- Toggle de ambiente AFIP por empresa. Aplica a TODOS los servicios (WSCTG,
-- WSFE, etc.) — un cert de homologación sirve para homo de todos los webservices,
-- y lo mismo con producción. Default 'prod' para empresas existentes.

ALTER TABLE "Company" ADD COLUMN "arcaModo" TEXT NOT NULL DEFAULT 'prod';
