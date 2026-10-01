-- v2.269.0: Al marcar una Orden de Trabajo como realizada, se registran la labor y los
-- insumos en la campaña. Agregamos el vínculo ordenTrabajoId para poder revertirlo al reabrir.

ALTER TABLE "OrdenTrabajo" ADD COLUMN IF NOT EXISTS "aplicadoEnCampana" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "InsumoAplicado" ADD COLUMN IF NOT EXISTS "ordenTrabajoId" TEXT;
ALTER TABLE "LaborAplicada"  ADD COLUMN IF NOT EXISTS "ordenTrabajoId" TEXT;

CREATE INDEX IF NOT EXISTS "InsumoAplicado_ordenTrabajoId_idx" ON "InsumoAplicado"("ordenTrabajoId");
CREATE INDEX IF NOT EXISTS "LaborAplicada_ordenTrabajoId_idx"  ON "LaborAplicada"("ordenTrabajoId");
