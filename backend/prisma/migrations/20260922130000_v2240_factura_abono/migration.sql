-- v2.240.0 — Vincular factura con la cuota del abono (evita doble deuda en cuenta corriente)
ALTER TABLE "Factura" ADD COLUMN IF NOT EXISTS "suscripcionId" TEXT;
ALTER TABLE "Factura" ADD COLUMN IF NOT EXISTS "abonoPeriodo" TEXT;
CREATE INDEX IF NOT EXISTS "Factura_suscripcionId_abonoPeriodo_idx" ON "Factura" ("suscripcionId", "abonoPeriodo");
