-- v2.9.1 — Familia (nodo del arbol CategoriaArticulo) en los items del Catalogo.
-- Idempotente y ADITIVA: columna nueva nulleable. No borra ni modifica datos.
ALTER TABLE "Catalogo" ADD COLUMN IF NOT EXISTS "categoriaArticuloId" TEXT;
CREATE INDEX IF NOT EXISTS "Catalogo_categoriaArticuloId_idx" ON "Catalogo"("categoriaArticuloId");
