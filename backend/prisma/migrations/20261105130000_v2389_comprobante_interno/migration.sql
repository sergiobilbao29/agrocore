-- v2.389 — Comprobante interno en Compras y Ventas.
-- Un comprobante puede nacer como "interno" (nº propio CI-####, sin factura fiscal)
-- y facturarse después sobre el MISMO registro, conservando el nº interno.
-- Aditivo, reversible, sin tocar datos existentes.
ALTER TABLE "Factura" ADD COLUMN "numeroInterno" TEXT;
ALTER TABLE "Factura" ADD COLUMN "esInterno" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "FacturaCompra" ADD COLUMN "numeroInterno" TEXT;
ALTER TABLE "FacturaCompra" ADD COLUMN "esInterno" BOOLEAN NOT NULL DEFAULT false;
