-- Remito de compra: alicuota de IVA por renglon (para discriminar el importe)
ALTER TABLE "RemitoCompraItem" ADD COLUMN "alicuotaIva" DOUBLE PRECISION NOT NULL DEFAULT 0;
