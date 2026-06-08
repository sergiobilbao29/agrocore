-- Mejora #3 del usuario: permitir registrar la cantidad real de hectáreas
-- aplicadas (puede ser menor que el total del lote, ej. cuando se aplica
-- solo en el alrededor del lote).
-- Campo opcional para no romper aplicaciones existentes; NULL = lote completo.

-- AlterTable
ALTER TABLE "InsumoAplicado" ADD COLUMN "hectareasAplicadas" DOUBLE PRECISION;
ALTER TABLE "LaborAplicada"  ADD COLUMN "hectareasAplicadas" DOUBLE PRECISION;
