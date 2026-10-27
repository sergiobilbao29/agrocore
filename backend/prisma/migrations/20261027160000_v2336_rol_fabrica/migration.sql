-- v2.336.0 - Rol del articulo en la fabrica/molienda (materia_prima / producto_final). Idempotente.
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "rolFabrica" TEXT;
