-- v2.69.0 - BancoCuenta: nombre para mostrar en la vista general (opcional).
-- El flag "en desuso" reutiliza la columna existente "activo" (activo=false = en desuso).
-- Aditiva e idempotente.
ALTER TABLE "BancoCuenta" ADD COLUMN IF NOT EXISTS "nombre" TEXT;
