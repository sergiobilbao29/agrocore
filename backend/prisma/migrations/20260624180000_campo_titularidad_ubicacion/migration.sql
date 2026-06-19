-- Campo: agregar titularidad y ubicacion (referencia/dirección)
ALTER TABLE "Campo"
  ADD COLUMN "titularidad" TEXT,
  ADD COLUMN "ubicacion"   TEXT;
