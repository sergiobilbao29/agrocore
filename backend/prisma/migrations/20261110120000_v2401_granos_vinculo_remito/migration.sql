-- Granos cta: vinculo a remito de compra ya cargado (para importar kilos sin recargar)
ALTER TABLE "GranoCtaMov" ADD COLUMN "remitoCompraId" TEXT;
