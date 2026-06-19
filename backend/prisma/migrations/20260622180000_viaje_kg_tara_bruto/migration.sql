-- Pesaje del camión en origen y destino para la Carta de Porte
ALTER TABLE "Viaje"
  ADD COLUMN "kgTara"      DOUBLE PRECISION,    -- camión vacío (al pesar antes de cargar)
  ADD COLUMN "kgBruto"     DOUBLE PRECISION,    -- camión cargado (peso total)
  ADD COLUMN "kgNeto"      DOUBLE PRECISION,    -- carga neta = bruto - tara
  ADD COLUMN "kgTaraDest"  DOUBLE PRECISION,    -- camión vacío en destino (después de descargar)
  ADD COLUMN "kgBrutoDest" DOUBLE PRECISION,    -- camión cargado en destino (al llegar)
  ADD COLUMN "kgNetoDest"  DOUBLE PRECISION;    -- descarga neta en destino
