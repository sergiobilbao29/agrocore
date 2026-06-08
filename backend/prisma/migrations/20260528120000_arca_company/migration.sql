-- Integración ARCA / WSCTG (Carta de Porte de Granos) por empresa.
-- Cada empresa carga su certificado y clave privada generados con el portal
-- de AFIP/ARCA. El sistema usa esos archivos para consultar el estado de los
-- CTGs (Carta de Porte de Granos) y completar el viaje automáticamente con
-- los kg descargados que devuelve ARCA.
--
-- NOTA: cert y key son sensibles. En producción deberían ir encriptados a nivel
-- aplicación con una llave maestra (KMS). Para esta primera fase se guardan tal
-- cual; la migración a AWS contempla el encriptado at-rest.

ALTER TABLE "Company" ADD COLUMN "arcaCuit" TEXT;
ALTER TABLE "Company" ADD COLUMN "arcaCertCrt" TEXT;
ALTER TABLE "Company" ADD COLUMN "arcaPrivadaKey" TEXT;
ALTER TABLE "Company" ADD COLUMN "arcaConfigAt" TIMESTAMP(3);
