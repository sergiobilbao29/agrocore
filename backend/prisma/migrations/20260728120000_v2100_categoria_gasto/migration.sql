-- v2.10.0 - Arbol de categorias de GASTO (padre/hijo) para Movimientos Diarios.
-- Aditiva e idempotente: crea la tabla si no existe. No toca datos existentes.

CREATE TABLE IF NOT EXISTS "CategoriaGasto" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "padreId" TEXT,
    "icono" TEXT,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CategoriaGasto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CategoriaGasto_companyId_idx" ON "CategoriaGasto"("companyId");
CREATE INDEX IF NOT EXISTS "CategoriaGasto_padreId_idx" ON "CategoriaGasto"("padreId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CategoriaGasto_companyId_fkey') THEN
    ALTER TABLE "CategoriaGasto" ADD CONSTRAINT "CategoriaGasto_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CategoriaGasto_padreId_fkey') THEN
    ALTER TABLE "CategoriaGasto" ADD CONSTRAINT "CategoriaGasto_padreId_fkey"
      FOREIGN KEY ("padreId") REFERENCES "CategoriaGasto"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
