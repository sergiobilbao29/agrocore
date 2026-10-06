-- v2.276 - Empaque / procesamiento hortícolas (cebolla, papa) + doble unidad. Aditivo.

-- Producto: doble unidad de medida (opcional)
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "unidad2" TEXT;
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "kgPorUnidad2" DOUBLE PRECISION;

-- Orden de empaque / procesamiento
CREATE TABLE IF NOT EXISTS "OrdenEmpaque" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "fecha" TIMESTAMP(3) NOT NULL,
  "numero" INTEGER,
  "campanaId" TEXT,
  "productoGranelId" TEXT NOT NULL,
  "kgEntrada" DOUBLE PRECISION NOT NULL,
  "salidas" JSONB NOT NULL,
  "materiales" JSONB,
  "kgMerma" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "observaciones" TEXT,
  "estado" TEXT NOT NULL DEFAULT 'confirmada',
  "movIds" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrdenEmpaque_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "OrdenEmpaque_companyId_idx" ON "OrdenEmpaque"("companyId");
CREATE INDEX IF NOT EXISTS "OrdenEmpaque_fecha_idx" ON "OrdenEmpaque"("fecha");
