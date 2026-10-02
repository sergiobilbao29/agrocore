-- v2.270.0: Circuito de compras — Remito de entrada -> Factura de proveedor.
-- El remito suma stock; la factura vinculada no lo duplica. Soporta parciales y devoluciones.

-- 1) Flags en FacturaCompra
ALTER TABLE "FacturaCompra" ADD COLUMN IF NOT EXISTS "vinculadaRemito" BOOLEAN NOT NULL DEFAULT false;

-- 2) RemitoCompra
CREATE TABLE IF NOT EXISTS "RemitoCompra" (
  "id"              TEXT PRIMARY KEY,
  "companyId"       TEXT NOT NULL,
  "proveedorId"     TEXT,
  "tipo"            TEXT NOT NULL DEFAULT 'entrada',
  "numero"          INTEGER,
  "numeroProveedor" TEXT,
  "fecha"           TIMESTAMP(3) NOT NULL,
  "depositoId"      TEXT,
  "moneda"          TEXT NOT NULL DEFAULT 'ARS',
  "cotizacion"      DOUBLE PRECISION,
  "estado"          TEXT NOT NULL DEFAULT 'pendiente',
  "remitoOrigenId"  TEXT,
  "stockMovido"     BOOLEAN NOT NULL DEFAULT true,
  "observaciones"   TEXT,
  "userId"          TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "RemitoCompra_companyId_idx"   ON "RemitoCompra"("companyId");
CREATE INDEX IF NOT EXISTS "RemitoCompra_proveedorId_idx" ON "RemitoCompra"("proveedorId");
CREATE INDEX IF NOT EXISTS "RemitoCompra_estado_idx"      ON "RemitoCompra"("estado");
CREATE INDEX IF NOT EXISTS "RemitoCompra_tipo_idx"        ON "RemitoCompra"("tipo");

-- 3) RemitoCompraItem
CREATE TABLE IF NOT EXISTS "RemitoCompraItem" (
  "id"                 TEXT PRIMARY KEY,
  "remitoCompraId"     TEXT NOT NULL,
  "productoId"         TEXT,
  "descripcion"        TEXT NOT NULL,
  "cantidad"           DOUBLE PRECISION NOT NULL,
  "cantidadFacturada"  DOUBLE PRECISION NOT NULL DEFAULT 0,
  "cantidadDevuelta"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "precioEstim"        DOUBLE PRECISION,
  "unidad"             TEXT,
  "campoId"            TEXT,
  "cabezas"            DOUBLE PRECISION,
  "remitoOrigenItemId" TEXT
);
CREATE INDEX IF NOT EXISTS "RemitoCompraItem_remitoCompraId_idx" ON "RemitoCompraItem"("remitoCompraId");
CREATE INDEX IF NOT EXISTS "RemitoCompraItem_productoId_idx"     ON "RemitoCompraItem"("productoId");

-- 4) RemitoFacturaLink
CREATE TABLE IF NOT EXISTS "RemitoFacturaLink" (
  "id"              TEXT PRIMARY KEY,
  "companyId"       TEXT NOT NULL,
  "facturaCompraId" TEXT NOT NULL,
  "remitoCompraId"  TEXT NOT NULL,
  "remitoItemId"    TEXT,
  "cantidad"        DOUBLE PRECISION NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "RemitoFacturaLink_facturaCompraId_idx" ON "RemitoFacturaLink"("facturaCompraId");
CREATE INDEX IF NOT EXISTS "RemitoFacturaLink_remitoCompraId_idx"  ON "RemitoFacturaLink"("remitoCompraId");

-- 5) Foreign keys (con guardas para que sea idempotente)
DO $$ BEGIN
  ALTER TABLE "RemitoCompra" ADD CONSTRAINT "RemitoCompra_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "RemitoCompra" ADD CONSTRAINT "RemitoCompra_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "RemitoCompra" ADD CONSTRAINT "RemitoCompra_depositoId_fkey" FOREIGN KEY ("depositoId") REFERENCES "Deposito"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "RemitoCompra" ADD CONSTRAINT "RemitoCompra_remitoOrigenId_fkey" FOREIGN KEY ("remitoOrigenId") REFERENCES "RemitoCompra"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "RemitoCompraItem" ADD CONSTRAINT "RemitoCompraItem_remitoCompraId_fkey" FOREIGN KEY ("remitoCompraId") REFERENCES "RemitoCompra"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "RemitoCompraItem" ADD CONSTRAINT "RemitoCompraItem_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "RemitoFacturaLink" ADD CONSTRAINT "RemitoFacturaLink_facturaCompraId_fkey" FOREIGN KEY ("facturaCompraId") REFERENCES "FacturaCompra"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "RemitoFacturaLink" ADD CONSTRAINT "RemitoFacturaLink_remitoCompraId_fkey" FOREIGN KEY ("remitoCompraId") REFERENCES "RemitoCompra"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "RemitoFacturaLink" ADD CONSTRAINT "RemitoFacturaLink_remitoItemId_fkey" FOREIGN KEY ("remitoItemId") REFERENCES "RemitoCompraItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
