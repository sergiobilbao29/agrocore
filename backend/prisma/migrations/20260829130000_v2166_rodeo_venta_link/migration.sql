-- v2.166: vincular la venta de un rodeo con el circuito comercial

ALTER TABLE "RodeoEvento" ADD COLUMN IF NOT EXISTS "clienteId" TEXT;
ALTER TABLE "RodeoEvento" ADD COLUMN IF NOT EXISTS "facturaId" TEXT;
ALTER TABLE "RodeoEvento" ADD COLUMN IF NOT EXISTS "liquidacionHaciendaId" TEXT;
