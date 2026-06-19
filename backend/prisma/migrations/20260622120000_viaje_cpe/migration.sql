-- CPE (Carta de Porte Electrónica) integrada con ARCA/AFIP
-- Agregamos campos al Viaje para registrar la emisión y seguimiento.
-- Estados típicos: pendiente_emision → emitida → confirmada (arribó) → anulada
ALTER TABLE "Viaje"
  ADD COLUMN "cpeTipo"           TEXT,                -- "automotor" | "ferroviaria"
  ADD COLUMN "cpeNroCtg"         TEXT,                -- nro de CTG asignado por ARCA
  ADD COLUMN "cpeNroComprobante" TEXT,                -- nro de comprobante CPE
  ADD COLUMN "cpeEstado"         TEXT,                -- pendiente_emision | emitida | confirmada | anulada
  ADD COLUMN "cpeFechaEmision"   TIMESTAMP(3),
  ADD COLUMN "cpeFechaArribo"    TIMESTAMP(3),
  ADD COLUMN "cpeFechaAnulacion" TIMESTAMP(3),
  ADD COLUMN "cpeMotivoAnulacion" TEXT,
  ADD COLUMN "cpePdfUrl"         TEXT,                -- link a PDF si se descarga
  ADD COLUMN "cpeObservaciones"  TEXT,
  ADD COLUMN "cpeRespuestaArca"  JSONB,               -- payload crudo de ARCA para debug
  ADD COLUMN "cpeOrigenCuit"     TEXT,                -- CUIT productor / titular del origen
  ADD COLUMN "cpeOrigenRenspa"   TEXT,                -- RENSPA del campo de origen
  ADD COLUMN "cpeDestinoCuit"    TEXT,                -- CUIT destinatario (cerealera, exportador)
  ADD COLUMN "cpeDestinatarioCuit" TEXT,              -- CUIT del recibidor del cereal
  ADD COLUMN "cpeCorredorCuit"   TEXT,                -- CUIT corredor (si hay)
  ADD COLUMN "cpeIntermediarioCuit" TEXT;             -- CUIT intermediario (si hay)

CREATE INDEX "Viaje_cpeNroCtg_idx" ON "Viaje"("cpeNroCtg");
CREATE INDEX "Viaje_cpeEstado_idx" ON "Viaje"("cpeEstado");
