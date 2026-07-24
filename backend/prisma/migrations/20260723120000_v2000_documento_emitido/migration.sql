-- v2.0.0 — Comprobantes emitidos (reimpresión / PDF / reenvío)
-- Idempotente: en instalaciones que ya la tengan no cambia nada.
CREATE TABLE IF NOT EXISTS "DocumentoEmitido" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "numero" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contactoTipo" TEXT,
    "contactoId" TEXT,
    "contactoNombre" TEXT,
    "contactoEmail" TEXT,
    "total" DOUBLE PRECISION,
    "moneda" TEXT DEFAULT 'ARS',
    "datos" JSONB NOT NULL,
    "emailEnviadoA" TEXT,
    "emailEnviadoEn" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentoEmitido_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DocumentoEmitido_companyId_tipo_fecha_idx" ON "DocumentoEmitido"("companyId", "tipo", "fecha");

DO $$ BEGIN
  ALTER TABLE "DocumentoEmitido" ADD CONSTRAINT "DocumentoEmitido_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
