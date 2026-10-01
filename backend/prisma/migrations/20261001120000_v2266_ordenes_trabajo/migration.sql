-- Órdenes de Trabajo (v2.266)
CREATE TABLE IF NOT EXISTS "OrdenTrabajo" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "puntoVenta" INTEGER NOT NULL DEFAULT 1,
  "numero" INTEGER NOT NULL,
  "fecha" TIMESTAMP(3) NOT NULL,
  "fechaLabor" TIMESTAMP(3),
  "contratistaId" TEXT,
  "estado" TEXT NOT NULL DEFAULT 'pendiente',
  "observaciones" TEXT,
  "descuentaStock" BOOLEAN NOT NULL DEFAULT false,
  "depositoId" TEXT,
  "stockMovido" BOOLEAN NOT NULL DEFAULT false,
  "fechaRealizada" TIMESTAMP(3),
  "facturaCompraId" TEXT,
  "userId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrdenTrabajo_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "OrdenTrabajoRenglon" (
  "id" TEXT NOT NULL,
  "ordenId" TEXT NOT NULL,
  "campanaId" TEXT,
  "campo" TEXT,
  "lote" TEXT,
  "cultivo" TEXT,
  "hectareas" DOUBLE PRECISION,
  "labor" TEXT NOT NULL,
  "observacion" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrdenTrabajoRenglon_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "OrdenTrabajoInsumo" (
  "id" TEXT NOT NULL,
  "renglonId" TEXT NOT NULL,
  "productoId" TEXT,
  "nombre" TEXT NOT NULL,
  "unidad" TEXT,
  "dosis" DOUBLE PRECISION,
  "total" DOUBLE PRECISION,
  "movimientoId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrdenTrabajoInsumo_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "OrdenTrabajo_companyId_idx" ON "OrdenTrabajo"("companyId");
CREATE INDEX IF NOT EXISTS "OrdenTrabajo_contratistaId_idx" ON "OrdenTrabajo"("contratistaId");
CREATE INDEX IF NOT EXISTS "OrdenTrabajo_estado_idx" ON "OrdenTrabajo"("estado");
CREATE INDEX IF NOT EXISTS "OrdenTrabajoRenglon_ordenId_idx" ON "OrdenTrabajoRenglon"("ordenId");
CREATE INDEX IF NOT EXISTS "OrdenTrabajoInsumo_renglonId_idx" ON "OrdenTrabajoInsumo"("renglonId");
DO $$ BEGIN
  ALTER TABLE "OrdenTrabajo" ADD CONSTRAINT "OrdenTrabajo_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "OrdenTrabajo" ADD CONSTRAINT "OrdenTrabajo_contratistaId_fkey" FOREIGN KEY ("contratistaId") REFERENCES "Proveedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "OrdenTrabajoRenglon" ADD CONSTRAINT "OrdenTrabajoRenglon_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "OrdenTrabajo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "OrdenTrabajoInsumo" ADD CONSTRAINT "OrdenTrabajoInsumo_renglonId_fkey" FOREIGN KEY ("renglonId") REFERENCES "OrdenTrabajoRenglon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
