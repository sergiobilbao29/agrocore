-- v2.5.0 — (1) Vínculo Usuario↔Empleado↔Chofer  (2) Rol: categorías de stock visibles
-- Idempotente: en instalaciones que ya las tengan no cambia nada.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "empleadoId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "choferId" TEXT;
ALTER TABLE "Role" ADD COLUMN IF NOT EXISTS "stockCategorias" JSONB;

-- (3) Entregas parciales de cereal contra créditos tomados en grano.
CREATE TABLE IF NOT EXISTS "EntregaCereal" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "creditoId" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "cantidad" DOUBLE PRECISION NOT NULL,
    "productoId" TEXT,
    "depositoId" TEXT,
    "viajeId" TEXT,
    "movimientoId" TEXT,
    "precioPizarra" DOUBLE PRECISION,
    "observaciones" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EntregaCereal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "EntregaCereal_companyId_idx" ON "EntregaCereal"("companyId");
CREATE INDEX IF NOT EXISTS "EntregaCereal_creditoId_idx" ON "EntregaCereal"("creditoId");
DO $$ BEGIN
  ALTER TABLE "EntregaCereal" ADD CONSTRAINT "EntregaCereal_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "EntregaCereal" ADD CONSTRAINT "EntregaCereal_creditoId_fkey"
    FOREIGN KEY ("creditoId") REFERENCES "Credito"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
