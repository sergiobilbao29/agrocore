-- Origen de la factura: distingue facturas emitidas desde AgroCore
-- (con CAE generado por el sistema) de las que ya fueron emitidas
-- directamente en el portal de ARCA y se cargan manualmente al sistema
-- para tener la trazabilidad completa.
--
-- Valores:
--   'agrocore'    -> emitida desde el sistema (default)
--   'arca_externa'-> ya emitida en ARCA antes de entrar al sistema
ALTER TABLE "Factura" ADD COLUMN "origen" TEXT NOT NULL DEFAULT 'agrocore';
