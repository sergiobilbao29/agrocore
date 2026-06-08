-- Pedido:
-- 1) Configuración global del sistema: contactos (asesor comercial, logística
--    camiones, contador). Tabla Setting clave-valor con una sola fila id="global".
-- 2) Ampliar Viaje con todos los datos de la operativa de fletes:
--    kg carga (ya existe como cantidad), kg descarga (ya existe), CTG separado
--    de carta de porte, tarifa $/ton, CUITs de transporte y chofer, patente del
--    acoplado, tipo de camión, estado del viaje, y vinculación a la factura de
--    compra del transportista.

-- ----- Setting -------------------------------------------------------------
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- Fila inicial vacía. El backend hace upsert siempre con id='global'.
INSERT INTO "Setting" ("id", "data", "updatedAt") VALUES ('global', '{}'::jsonb, NOW());

-- ----- Viaje: campos nuevos -----------------------------------------------
ALTER TABLE "Viaje" ADD COLUMN "ctg" TEXT;
ALTER TABLE "Viaje" ADD COLUMN "tarifa" DOUBLE PRECISION;
ALTER TABLE "Viaje" ADD COLUMN "transporteCuit" TEXT;
ALTER TABLE "Viaje" ADD COLUMN "choferCuit" TEXT;
ALTER TABLE "Viaje" ADD COLUMN "patenteAcoplado" TEXT;
ALTER TABLE "Viaje" ADD COLUMN "tipoCamion" TEXT;
ALTER TABLE "Viaje" ADD COLUMN "estado" TEXT NOT NULL DEFAULT 'pendiente';
ALTER TABLE "Viaje" ADD COLUMN "facturaCompraId" TEXT;

-- Indices
CREATE INDEX "Viaje_estado_idx" ON "Viaje"("estado");
CREATE INDEX "Viaje_facturaCompraId_idx" ON "Viaje"("facturaCompraId");

-- FK a la factura de compra del transportista (SET NULL si se borra la factura)
ALTER TABLE "Viaje" ADD CONSTRAINT "Viaje_facturaCompraId_fkey"
  FOREIGN KEY ("facturaCompraId") REFERENCES "FacturaCompra"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
