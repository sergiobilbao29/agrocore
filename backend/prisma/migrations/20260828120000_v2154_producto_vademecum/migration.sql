-- v2.154.0: vínculo del producto (insumo) con el principio activo del vademécum
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "vademecumId" TEXT;
