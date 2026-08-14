-- v2.92.0 - Seguro en Activos Fijos + Adjuntos (fotos/PDF). Aditiva e idempotente.

-- Campos de seguro en ActivoFijo
ALTER TABLE "ActivoFijo" ADD COLUMN IF NOT EXISTS "asegurado"      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ActivoFijo" ADD COLUMN IF NOT EXISTS "aseguradora"    TEXT;
ALTER TABLE "ActivoFijo" ADD COLUMN IF NOT EXISTS "seguroTipo"     TEXT;
ALTER TABLE "ActivoFijo" ADD COLUMN IF NOT EXISTS "polizaNumero"   TEXT;
ALTER TABLE "ActivoFijo" ADD COLUMN IF NOT EXISTS "polizaDesde"    TIMESTAMP(3);
ALTER TABLE "ActivoFijo" ADD COLUMN IF NOT EXISTS "polizaHasta"    TIMESTAMP(3);
ALTER TABLE "ActivoFijo" ADD COLUMN IF NOT EXISTS "seguroContacto" TEXT;

-- Tabla de adjuntos
CREATE TABLE IF NOT EXISTS "Adjunto" (
  "id"           TEXT NOT NULL,
  "companyId"    TEXT NOT NULL,
  "entidadTipo"  TEXT NOT NULL,
  "entidadId"    TEXT NOT NULL,
  "activoFijoId" TEXT,
  "nombre"       TEXT NOT NULL,
  "descripcion"  TEXT,
  "mime"         TEXT NOT NULL,
  "tamano"       INTEGER NOT NULL DEFAULT 0,
  "storageKey"   TEXT NOT NULL,
  "userId"       TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Adjunto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Adjunto_companyId_idx" ON "Adjunto"("companyId");
CREATE INDEX IF NOT EXISTS "Adjunto_entidadTipo_entidadId_idx" ON "Adjunto"("entidadTipo", "entidadId");
CREATE INDEX IF NOT EXISTS "Adjunto_activoFijoId_idx" ON "Adjunto"("activoFijoId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Adjunto_companyId_fkey') THEN
    ALTER TABLE "Adjunto" ADD CONSTRAINT "Adjunto_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Adjunto_activoFijoId_fkey') THEN
    ALTER TABLE "Adjunto" ADD CONSTRAINT "Adjunto_activoFijoId_fkey"
      FOREIGN KEY ("activoFijoId") REFERENCES "ActivoFijo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
