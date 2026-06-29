-- v1.26 — Costo último de compra, IVA de intereses en créditos y arrendamientos por quintales/cuotas
-- Idempotente.
ALTER TABLE "Producto"      ADD COLUMN IF NOT EXISTS "ultimoCostoCompra"  DOUBLE PRECISION;
ALTER TABLE "Producto"      ADD COLUMN IF NOT EXISTS "ultimoCostoMoneda"  TEXT;

ALTER TABLE "Credito"       ADD COLUMN IF NOT EXISTS "ivaInteresPct"      DOUBLE PRECISION;

ALTER TABLE "Arrendamiento" ADD COLUMN IF NOT EXISTS "modalidad"          TEXT;
ALTER TABLE "Arrendamiento" ADD COLUMN IF NOT EXISTS "grano"              TEXT;
ALTER TABLE "Arrendamiento" ADD COLUMN IF NOT EXISTS "quintalesHaBlanco"  DOUBLE PRECISION;
ALTER TABLE "Arrendamiento" ADD COLUMN IF NOT EXISTS "quintalesHaNegro"   DOUBLE PRECISION;
ALTER TABLE "Arrendamiento" ADD COLUMN IF NOT EXISTS "moneda"             TEXT;
ALTER TABLE "Arrendamiento" ADD COLUMN IF NOT EXISTS "cuotas"             JSONB;
