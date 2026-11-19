-- v2.452: Unificacion de articulos. producto pasa a ser la fuente unica de los
-- articulos de insumo/cereal (se migran desde catalogo y se apaga el sync que los duplica).
-- Solo agrega columnas (aditivo, no destructivo). La migracion de datos la hace el
-- endpoint idempotente /api/admin/unificar-articulos (por empresa, con respaldo).
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "predefinido" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "articulosUnificados" BOOLEAN NOT NULL DEFAULT false;
