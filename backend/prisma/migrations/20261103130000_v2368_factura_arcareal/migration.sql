-- v2.368.0: marca de CAE real de ARCA en Factura (para bloquear anular/borrar; se anula con NC)
ALTER TABLE "Factura" ADD COLUMN "arcaReal" BOOLEAN NOT NULL DEFAULT false;
