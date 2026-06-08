-- Viaje: campos para registrar destino del cereal y vincular liquidación.
-- destinoTipo:
--   'cerealera'      -> el cereal va a un depósito tipo cerealera (depositoDestinoId)
--   'venta_directa'  -> se vende directo, después se carga una liquidación (liquidacionCerealId)
--   'otro'           -> destino texto libre, sin trazabilidad de stock
ALTER TABLE "Viaje" ADD COLUMN "destinoTipo" TEXT;
ALTER TABLE "Viaje" ADD COLUMN "depositoDestinoId" TEXT;
ALTER TABLE "Viaje" ADD COLUMN "liquidacionCerealId" TEXT;
CREATE INDEX "Viaje_depositoDestinoId_idx" ON "Viaje"("depositoDestinoId");
ALTER TABLE "Viaje" ADD CONSTRAINT "Viaje_depositoDestinoId_fkey"
    FOREIGN KEY ("depositoDestinoId") REFERENCES "Deposito"("id") ON DELETE SET NULL ON UPDATE CASCADE;
