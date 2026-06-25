-- v1.4.0 (Fase 1) — Hacienda: doble stock (cabezas + kg), cambio de categoría
-- y configuración de categorías (especie, rangos de kg, transiciones).
-- Idempotente. Las FKs las reconcilia prisma db push.

-- Doble stock: peso promedio por categoría
ALTER TABLE "HaciendaStock" ADD COLUMN IF NOT EXISTS "pesoPromedio" DOUBLE PRECISION;

-- Movimientos: kilos del movimiento + categoría destino (para cambio_categoria)
ALTER TABLE "HaciendaMovimiento" ADD COLUMN IF NOT EXISTS "kilos"            DOUBLE PRECISION;
ALTER TABLE "HaciendaMovimiento" ADD COLUMN IF NOT EXISTS "categoriaDestino" TEXT;

-- Configuración de categorías de hacienda
CREATE TABLE IF NOT EXISTS "CategoriaHaciendaConfig" (
  "id"           TEXT NOT NULL,
  "companyId"    TEXT NOT NULL,
  "especie"      TEXT NOT NULL,
  "nombre"       TEXT NOT NULL,
  "kgMin"        DOUBLE PRECISION,
  "kgMax"        DOUBLE PRECISION,
  "pesoPromedio" DOUBLE PRECISION,
  "gmdDefault"   DOUBLE PRECISION,
  "transiciones" JSONB,
  "orden"        INTEGER NOT NULL DEFAULT 0,
  "activo"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CategoriaHaciendaConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CategoriaHaciendaConfig_companyId_nombre_key" ON "CategoriaHaciendaConfig"("companyId","nombre");
CREATE INDEX IF NOT EXISTS "CategoriaHaciendaConfig_companyId_idx" ON "CategoriaHaciendaConfig"("companyId");
