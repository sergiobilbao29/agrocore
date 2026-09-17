-- v2.221.0 — Suscripciones / Abonos mensuales (administrar AgroCore como negocio)
CREATE TABLE "Suscripcion" (
  "id"        TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "clienteId" TEXT NOT NULL,
  "concepto"  TEXT NOT NULL DEFAULT 'Abono mensual AgroCore',
  "monto"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "moneda"    TEXT NOT NULL DEFAULT 'ARS',
  "diaVenc"   INTEGER NOT NULL DEFAULT 10,
  "activo"    BOOLEAN NOT NULL DEFAULT true,
  "inicio"    TIMESTAMP(3),
  "notas"     TEXT,
  "leadId"    TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Suscripcion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Suscripcion_companyId_idx" ON "Suscripcion"("companyId");
CREATE INDEX "Suscripcion_companyId_clienteId_idx" ON "Suscripcion"("companyId", "clienteId");
CREATE INDEX "Suscripcion_companyId_activo_idx" ON "Suscripcion"("companyId", "activo");
ALTER TABLE "Suscripcion" ADD CONSTRAINT "Suscripcion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
