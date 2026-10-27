-- v2.332.0 - Plan Canje: la fabrica entrega un producto y recibe grano (o viceversa),
-- con una paridad/relacion fija. Movimiento en especie. Idempotente.

CREATE TABLE IF NOT EXISTS "CanjeParidad" (
  "id"                TEXT NOT NULL,
  "companyId"         TEXT NOT NULL,
  "nombre"            TEXT NOT NULL,
  "entregaProductoId" TEXT NOT NULL,
  "recibeProductoId"  TEXT NOT NULL,
  "factor"            DOUBLE PRECISION NOT NULL,
  "activo"            BOOLEAN NOT NULL DEFAULT true,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CanjeParidad_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CanjeParidad_companyId_idx" ON "CanjeParidad"("companyId");

CREATE TABLE IF NOT EXISTS "Canje" (
  "id"                TEXT NOT NULL,
  "companyId"         TEXT NOT NULL,
  "fecha"             TIMESTAMP(3) NOT NULL,
  "tipo"              TEXT NOT NULL DEFAULT 'venta',
  "contactoTipo"      TEXT,
  "contactoId"        TEXT,
  "contactoNombre"    TEXT,
  "entregaProductoId" TEXT NOT NULL,
  "entregaCant"       DOUBLE PRECISION NOT NULL,
  "entregaDepositoId" TEXT,
  "recibeProductoId"  TEXT NOT NULL,
  "recibeCant"        DOUBLE PRECISION NOT NULL,
  "recibeDepositoId"  TEXT,
  "factor"            DOUBLE PRECISION,
  "observaciones"     TEXT,
  "userId"            TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Canje_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Canje_companyId_idx" ON "Canje"("companyId");
CREATE INDEX IF NOT EXISTS "Canje_fecha_idx" ON "Canje"("fecha");

DO $$ BEGIN
  ALTER TABLE "CanjeParidad" ADD CONSTRAINT "CanjeParidad_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Canje" ADD CONSTRAINT "Canje_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
