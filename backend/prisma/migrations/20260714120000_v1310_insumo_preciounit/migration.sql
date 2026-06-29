-- v1.31 — InsumoAplicado: guardar el precio unitario (u$s/unidad). Idempotente.
ALTER TABLE "InsumoAplicado" ADD COLUMN IF NOT EXISTS "precioUnit" DOUBLE PRECISION;
