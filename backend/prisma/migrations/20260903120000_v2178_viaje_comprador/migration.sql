-- v2.178: comprador del cereal en el viaje/carta de porte (puede ser distinto del acopio destino).
ALTER TABLE "Viaje" ADD COLUMN IF NOT EXISTS "compradorClienteId" TEXT;
