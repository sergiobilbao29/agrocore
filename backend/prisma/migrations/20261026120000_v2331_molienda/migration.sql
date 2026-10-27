-- v2.331.0 - Molienda / Fabrica: transformacion de un insumo origen (Soja grano)
-- en coproductos (Expeller, Aceite, Merma) con rendimientos por % y costeo de
-- fabricacion. Produccion propia. Idempotente.

-- Producto: costo de fabricacion y margen de venta para los coproductos.
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "costoFabricacionKg" DOUBLE PRECISION;
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "margenVentaPct"     DOUBLE PRECISION;

-- Receta de molienda
CREATE TABLE IF NOT EXISTS "FormulaMolienda" (
  "id"               TEXT NOT NULL,
  "companyId"        TEXT NOT NULL,
  "nombre"           TEXT NOT NULL,
  "origenProductoId" TEXT NOT NULL,
  "activo"           BOOLEAN NOT NULL DEFAULT true,
  "observaciones"    TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FormulaMolienda_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "FormulaMolienda_companyId_idx" ON "FormulaMolienda"("companyId");
CREATE INDEX IF NOT EXISTS "FormulaMolienda_origenProductoId_idx" ON "FormulaMolienda"("origenProductoId");

-- Items (coproductos) de la receta
CREATE TABLE IF NOT EXISTS "FormulaMoliendaItem" (
  "id"                TEXT NOT NULL,
  "companyId"         TEXT NOT NULL,
  "formulaId"         TEXT NOT NULL,
  "productoId"        TEXT NOT NULL,
  "rendimientoPct"    DOUBLE PRECISION NOT NULL,
  "coefCosto"         DOUBLE PRECISION,
  "depositoDestinoId" TEXT,
  "esMerma"           BOOLEAN NOT NULL DEFAULT false,
  "orden"             INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "FormulaMoliendaItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "FormulaMoliendaItem_companyId_idx" ON "FormulaMoliendaItem"("companyId");
CREATE INDEX IF NOT EXISTS "FormulaMoliendaItem_formulaId_idx" ON "FormulaMoliendaItem"("formulaId");
CREATE INDEX IF NOT EXISTS "FormulaMoliendaItem_productoId_idx" ON "FormulaMoliendaItem"("productoId");

-- Parte de molienda (lote procesado)
CREATE TABLE IF NOT EXISTS "ParteMolienda" (
  "id"               TEXT NOT NULL,
  "companyId"        TEXT NOT NULL,
  "fecha"            TIMESTAMP(3) NOT NULL,
  "formulaId"        TEXT NOT NULL,
  "depositoOrigenId" TEXT,
  "kgProcesados"     DOUBLE PRECISION NOT NULL,
  "costoOrigenUnit"  DOUBLE PRECISION NOT NULL DEFAULT 0,
  "costoProduccion"  DOUBLE PRECISION NOT NULL DEFAULT 0,
  "costoTotal"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "centroCostoId"    TEXT,
  "observaciones"    TEXT,
  "resultados"       JSONB,
  "userId"           TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ParteMolienda_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ParteMolienda_companyId_idx" ON "ParteMolienda"("companyId");
CREATE INDEX IF NOT EXISTS "ParteMolienda_fecha_idx" ON "ParteMolienda"("fecha");
CREATE INDEX IF NOT EXISTS "ParteMolienda_formulaId_idx" ON "ParteMolienda"("formulaId");

-- FKs (idempotentes via DO block)
DO $$ BEGIN
  ALTER TABLE "FormulaMolienda" ADD CONSTRAINT "FormulaMolienda_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "FormulaMoliendaItem" ADD CONSTRAINT "FormulaMoliendaItem_formulaId_fkey" FOREIGN KEY ("formulaId") REFERENCES "FormulaMolienda"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ParteMolienda" ADD CONSTRAINT "ParteMolienda_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ParteMolienda" ADD CONSTRAINT "ParteMolienda_formulaId_fkey" FOREIGN KEY ("formulaId") REFERENCES "FormulaMolienda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
