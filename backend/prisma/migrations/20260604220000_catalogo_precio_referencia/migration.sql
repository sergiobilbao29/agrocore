-- Catálogo: precio sugerido + tipo de precio, principalmente para labores.
-- Cuando se carga una nueva Labor avanzada y se elige un tipo del catálogo,
-- el form precarga estos valores (siguen editables).
ALTER TABLE "Catalogo" ADD COLUMN "precioReferencia" DOUBLE PRECISION;
ALTER TABLE "Catalogo" ADD COLUMN "tipoPrecio" TEXT;
