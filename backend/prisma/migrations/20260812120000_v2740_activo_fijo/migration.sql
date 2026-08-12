-- v2.74.0 - Activo Fijo / Bienes de Uso + control de Mantenimiento.
-- Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS "ActivoFijo" (
  "id"             TEXT NOT NULL,
  "companyId"      TEXT NOT NULL,
  "tipo"           TEXT NOT NULL DEFAULT 'maquinaria',
  "nombre"         TEXT NOT NULL,
  "marca"          TEXT,
  "modelo"         TEXT,
  "anio"           INTEGER,
  "identificacion" TEXT,
  "fechaAlta"      TIMESTAMP(3),
  "valorOrigen"    DOUBLE PRECISION DEFAULT 0,
  "moneda"         TEXT NOT NULL DEFAULT 'ARS',
  "amortiza"       BOOLEAN NOT NULL DEFAULT true,
  "vidaUtilAnios"  INTEGER,
  "valorResidual"  DOUBLE PRECISION DEFAULT 0,
  "estado"         TEXT NOT NULL DEFAULT 'activo',
  "fechaBaja"      TIMESTAMP(3),
  "valorVenta"     DOUBLE PRECISION,
  "controlaUso"    BOOLEAN NOT NULL DEFAULT false,
  "unidadUso"      TEXT,
  "usoActual"      DOUBLE PRECISION DEFAULT 0,
  "ubicacion"      TEXT,
  "observaciones"  TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActivoFijo_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MantenimientoActivo" (
  "id"            TEXT NOT NULL,
  "companyId"     TEXT NOT NULL,
  "activoFijoId"  TEXT NOT NULL,
  "fecha"         TIMESTAMP(3) NOT NULL,
  "tipo"          TEXT NOT NULL DEFAULT 'service',
  "usoLectura"    DOUBLE PRECISION,
  "descripcion"   TEXT,
  "detalle"       TEXT,
  "taller"        TEXT,
  "costo"         DOUBLE PRECISION DEFAULT 0,
  "moneda"        TEXT NOT NULL DEFAULT 'ARS',
  "proximoUso"    DOUBLE PRECISION,
  "proximaFecha"  TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MantenimientoActivo_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ActivoFijo_companyId_idx" ON "ActivoFijo"("companyId");
CREATE INDEX IF NOT EXISTS "ActivoFijo_tipo_idx" ON "ActivoFijo"("tipo");
CREATE INDEX IF NOT EXISTS "MantenimientoActivo_companyId_idx" ON "MantenimientoActivo"("companyId");
CREATE INDEX IF NOT EXISTS "MantenimientoActivo_activoFijoId_idx" ON "MantenimientoActivo"("activoFijoId");

-- FKs con guarda para no fallar si ya existen.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ActivoFijo_companyId_fkey') THEN
    ALTER TABLE "ActivoFijo" ADD CONSTRAINT "ActivoFijo_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MantenimientoActivo_companyId_fkey') THEN
    ALTER TABLE "MantenimientoActivo" ADD CONSTRAINT "MantenimientoActivo_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MantenimientoActivo_activoFijoId_fkey') THEN
    ALTER TABLE "MantenimientoActivo" ADD CONSTRAINT "MantenimientoActivo_activoFijoId_fkey"
      FOREIGN KEY ("activoFijoId") REFERENCES "ActivoFijo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
