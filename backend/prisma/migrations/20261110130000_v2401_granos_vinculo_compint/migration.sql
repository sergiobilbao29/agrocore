-- Granos cta: vinculo a comprobante interno de compra ya cargado (importar kilos sin recargar)
ALTER TABLE "GranoCtaMov" ADD COLUMN "facturaCompraId" TEXT;
