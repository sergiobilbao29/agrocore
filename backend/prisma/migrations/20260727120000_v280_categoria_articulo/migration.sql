-- v2.8.0 — Arbol de categorias/familias de articulos + atributos de Producto.
-- Idempotente y ADITIVA: no borra ni modifica datos existentes. Se puede correr
-- varias veces sin efecto. El campo Producto.categoria (plano) sigue existiendo
-- como compat; estas columnas lo complementan.

-- Nuevo maestro: arbol de categorias por empresa (padre/hijo).
CREATE TABLE IF NOT EXISTS "CategoriaArticulo" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "padreId" TEXT,
    "icono" TEXT,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CategoriaArticulo_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CategoriaArticulo_companyId_idx" ON "CategoriaArticulo"("companyId");
CREATE INDEX IF NOT EXISTS "CategoriaArticulo_padreId_idx" ON "CategoriaArticulo"("padreId");

-- Atributos de articulo en Producto (estandar ERP). Todos nulleables.
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "sku" TEXT;
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "codigoBarras" TEXT;
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "ivaDefault" DOUBLE PRECISION;
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "tipoArticulo" TEXT;
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "categoriaArticuloId" TEXT;
CREATE INDEX IF NOT EXISTS "Producto_categoriaArticuloId_idx" ON "Producto"("categoriaArticuloId");
