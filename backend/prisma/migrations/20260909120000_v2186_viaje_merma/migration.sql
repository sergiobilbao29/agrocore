-- v2.186: merma y neto a liquidar en el viaje / carta de porte.
-- La merma (kg) se resta del peso neto para obtener el neto a liquidar (lo que
-- acopia/liquida el comprador). El flete se sigue cobrando por el peso neto
-- transportado, sin descontar la merma.
ALTER TABLE "Viaje" ADD COLUMN IF NOT EXISTS "mermaKg" DOUBLE PRECISION;
ALTER TABLE "Viaje" ADD COLUMN IF NOT EXISTS "netoLiquidar" DOUBLE PRECISION;
