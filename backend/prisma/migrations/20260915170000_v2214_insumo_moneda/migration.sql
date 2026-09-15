-- v2.214.0 — Moneda por movimiento en insumos aplicados (para la Sociedad/UTE y campañas).
ALTER TABLE "InsumoAplicado" ADD COLUMN IF NOT EXISTS "moneda" TEXT;
