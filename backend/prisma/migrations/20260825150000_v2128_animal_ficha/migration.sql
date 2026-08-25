-- v2.128.0 — Módulo Animales: ficha individual (360°) genérica + eventos/costos + IoT-ready
-- Idempotente: CREATE TABLE IF NOT EXISTS + índices IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "Animal" (
  "id"              TEXT NOT NULL,
  "companyId"       TEXT NOT NULL,
  "especie"         TEXT NOT NULL DEFAULT 'equino',
  "nombre"          TEXT NOT NULL,
  "sexo"            TEXT,
  "fechaNac"        TIMESTAMP(3),
  "pelaje"          TEXT,
  "raza"            TEXT,
  "categoria"       TEXT,
  "estado"          TEXT NOT NULL DEFAULT 'activo',
  "microchip"       TEXT,
  "caravanaRfid"    TEXT,
  "caravanaVisual"  TEXT,
  "nroRegistro"     TEXT,
  "pasaporte"       TEXT,
  "padreId"         TEXT,
  "padreNombre"     TEXT,
  "madreId"         TEXT,
  "madreNombre"     TEXT,
  "receptoraId"     TEXT,
  "receptoraNombre" TEXT,
  "campoId"         TEXT,
  "ubicacion"       TEXT,
  "moneda"          TEXT NOT NULL DEFAULT 'ARS',
  "fechaIngreso"    TIMESTAMP(3),
  "costoIngreso"    DOUBLE PRECISION DEFAULT 0,
  "origen"          TEXT,
  "valuacion"       DOUBLE PRECISION,
  "fechaVenta"      TIMESTAMP(3),
  "precioVenta"     DOUBLE PRECISION,
  "monedaVenta"     TEXT,
  "clienteId"       TEXT,
  "ventaRef"        TEXT,
  "externo"         BOOLEAN NOT NULL DEFAULT false,
  "propietario"     TEXT,
  "foto"            TEXT,
  "observaciones"   TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Animal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AnimalEvento" (
  "id"                TEXT NOT NULL,
  "companyId"         TEXT NOT NULL,
  "animalId"          TEXT NOT NULL,
  "fecha"             TIMESTAMP(3) NOT NULL,
  "tipo"              TEXT NOT NULL,
  "concepto"          TEXT,
  "costo"             DOUBLE PRECISION DEFAULT 0,
  "moneda"            TEXT NOT NULL DEFAULT 'ARS',
  "empleadoId"        TEXT,
  "productoId"        TEXT,
  "cantidad"          DOUBLE PRECISION,
  "movimientoStockId" TEXT,
  "proximaFecha"      TIMESTAMP(3),
  "datos"             TEXT,
  "observaciones"     TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnimalEvento_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Animal_companyId_idx" ON "Animal"("companyId");
CREATE INDEX IF NOT EXISTS "Animal_companyId_especie_idx" ON "Animal"("companyId","especie");
CREATE INDEX IF NOT EXISTS "Animal_companyId_estado_idx" ON "Animal"("companyId","estado");
CREATE INDEX IF NOT EXISTS "Animal_caravanaRfid_idx" ON "Animal"("caravanaRfid");
CREATE INDEX IF NOT EXISTS "Animal_microchip_idx" ON "Animal"("microchip");
CREATE INDEX IF NOT EXISTS "AnimalEvento_companyId_idx" ON "AnimalEvento"("companyId");
CREATE INDEX IF NOT EXISTS "AnimalEvento_animalId_idx" ON "AnimalEvento"("animalId");
CREATE INDEX IF NOT EXISTS "AnimalEvento_companyId_proximaFecha_idx" ON "AnimalEvento"("companyId","proximaFecha");

DO $$ BEGIN
  ALTER TABLE "Animal" ADD CONSTRAINT "Animal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AnimalEvento" ADD CONSTRAINT "AnimalEvento_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AnimalEvento" ADD CONSTRAINT "AnimalEvento_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
