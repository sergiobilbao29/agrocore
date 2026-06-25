-- v1.5.0 (Fase 3) — Ventas de hacienda por kilo: precio/total/cliente, modo
-- (directo / a rendimiento) e integración con el ingreso (cta cte / efectivo / banco).
-- Idempotente.
ALTER TABLE "HaciendaMovimiento" ADD COLUMN IF NOT EXISTS "precioKg"   DOUBLE PRECISION;
ALTER TABLE "HaciendaMovimiento" ADD COLUMN IF NOT EXISTS "total"      DOUBLE PRECISION;
ALTER TABLE "HaciendaMovimiento" ADD COLUMN IF NOT EXISTS "clienteId"  TEXT;
ALTER TABLE "HaciendaMovimiento" ADD COLUMN IF NOT EXISTS "modoVenta"  TEXT;
ALTER TABLE "HaciendaMovimiento" ADD COLUMN IF NOT EXISTS "estadoRend" TEXT;
ALTER TABLE "HaciendaMovimiento" ADD COLUMN IF NOT EXISTS "cobroTipo"  TEXT;
ALTER TABLE "HaciendaMovimiento" ADD COLUMN IF NOT EXISTS "efectivoId" TEXT;
ALTER TABLE "HaciendaMovimiento" ADD COLUMN IF NOT EXISTS "bancoMovId" TEXT;
