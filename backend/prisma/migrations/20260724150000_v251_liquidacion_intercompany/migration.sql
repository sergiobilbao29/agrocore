-- v2.5.1 — Liquidación de sueldo pagable por Intercompany
-- Idempotente: en instalaciones que ya la tengan no cambia nada.
ALTER TABLE "LiquidacionSueldo" ADD COLUMN IF NOT EXISTS "intercompanyRef" TEXT;
