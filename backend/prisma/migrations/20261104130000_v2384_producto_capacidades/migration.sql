-- v2.384 — Capacidades combinables del artículo (Producto). Aditivo + backfill reversible.
-- Clasificar (árbol) y usar (estas flags) son cosas distintas.
ALTER TABLE "Producto" ADD COLUMN "controlaStock"         BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Producto" ADD COLUMN "sePuedeComprar"        BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Producto" ADD COLUMN "sePuedeVender"         BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Producto" ADD COLUMN "seConsumeEnProduccion" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Producto" ADD COLUMN "seObtieneEnProduccion" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Producto" ADD COLUMN "esServicio"            BOOLEAN NOT NULL DEFAULT false;

-- Backfill desde los datos existentes (no borra nada; solo deriva las nuevas flags).
UPDATE "Producto" SET "seConsumeEnProduccion" = true WHERE "rolFabrica" = 'materia_prima';
UPDATE "Producto" SET "seObtieneEnProduccion" = true WHERE "rolFabrica" = 'producto_final';
UPDATE "Producto" SET "esServicio" = true, "controlaStock" = false WHERE "tipoArticulo" = 'servicio';
