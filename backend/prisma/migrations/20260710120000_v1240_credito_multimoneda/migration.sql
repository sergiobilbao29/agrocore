-- v1.24.0 — Créditos bancarios multimoneda + cuotas manuales + pago con tipo de cambio
-- Idempotente: se puede correr varias veces sin romper.

ALTER TABLE "Credito"      ADD COLUMN IF NOT EXISTS "moneda"           TEXT NOT NULL DEFAULT 'ARS';
ALTER TABLE "Credito"      ADD COLUMN IF NOT EXISTS "cotizacionAlta"   DOUBLE PRECISION;
ALTER TABLE "Credito"      ADD COLUMN IF NOT EXISTS "planManual"       BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "CuotaCredito" ADD COLUMN IF NOT EXISTS "cotizacionPago"   DOUBLE PRECISION;
ALTER TABLE "CuotaCredito" ADD COLUMN IF NOT EXISTS "importePagadoArs" DOUBLE PRECISION;
