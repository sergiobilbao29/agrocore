-- v2.246.0 — Sociedades/UTE: registrar qué socio aportó cada insumo / labor
ALTER TABLE "InsumoAplicado" ADD COLUMN IF NOT EXISTS "aporteSocioId" TEXT;
ALTER TABLE "InsumoAplicado" ADD COLUMN IF NOT EXISTS "aporteSocioNombre" TEXT;
ALTER TABLE "LaborAplicada" ADD COLUMN IF NOT EXISTS "aporteSocioId" TEXT;
ALTER TABLE "LaborAplicada" ADD COLUMN IF NOT EXISTS "aporteSocioNombre" TEXT;
