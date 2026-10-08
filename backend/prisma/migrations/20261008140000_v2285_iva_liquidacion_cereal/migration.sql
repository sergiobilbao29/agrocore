-- IVA en la liquidación de cereal (se SUMA al neto a cobrar)
ALTER TABLE "LiquidacionCereal" ADD COLUMN IF NOT EXISTS "alicuotaIva" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "LiquidacionCereal" ADD COLUMN IF NOT EXISTS "iva" DOUBLE PRECISION NOT NULL DEFAULT 0;
