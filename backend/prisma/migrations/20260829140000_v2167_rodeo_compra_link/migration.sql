-- v2.167: vincular la compra (ingreso) de un rodeo con el circuito comercial

ALTER TABLE "RodeoEvento" ADD COLUMN IF NOT EXISTS "proveedorId" TEXT;
ALTER TABLE "RodeoEvento" ADD COLUMN IF NOT EXISTS "facturaCompraId" TEXT;
