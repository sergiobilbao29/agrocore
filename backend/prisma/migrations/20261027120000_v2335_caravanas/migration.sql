-- v2.335.0 - Caravanas / Recuento: padron liviano de identificacion individual + recuento por manga. Idempotente.

CREATE TABLE IF NOT EXISTS "Caravana" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "campoId" TEXT,
  "loteId" TEXT,
  "rfid" TEXT,
  "visual" TEXT,
  "sexo" TEXT,
  "categoria" TEXT,
  "estado" TEXT NOT NULL DEFAULT 'activa',
  "madreId" TEXT,
  "madreVisual" TEXT,
  "tipoAlta" TEXT NOT NULL DEFAULT 'nacimiento',
  "fechaAlta" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fechaBaja" TIMESTAMP(3),
  "motivoBaja" TEXT,
  "haciendaMovAltaId" TEXT,
  "haciendaMovBajaId" TEXT,
  "observaciones" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Caravana_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RecuentoCaravana" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "campoId" TEXT,
  "loteId" TEXT,
  "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "totalPadron" INTEGER NOT NULL DEFAULT 0,
  "leidas" INTEGER NOT NULL DEFAULT 0,
  "presentes" INTEGER NOT NULL DEFAULT 0,
  "faltantesCant" INTEGER NOT NULL DEFAULT 0,
  "desconocidasCant" INTEGER NOT NULL DEFAULT 0,
  "faltantes" JSONB,
  "desconocidas" JSONB,
  "observaciones" TEXT,
  "userId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecuentoCaravana_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "Caravana" ADD CONSTRAINT "Caravana_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Caravana" ADD CONSTRAINT "Caravana_madreId_fkey" FOREIGN KEY ("madreId") REFERENCES "Caravana"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "RecuentoCaravana" ADD CONSTRAINT "RecuentoCaravana_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "Caravana_companyId_idx" ON "Caravana"("companyId");
CREATE INDEX IF NOT EXISTS "Caravana_companyId_estado_idx" ON "Caravana"("companyId", "estado");
CREATE INDEX IF NOT EXISTS "Caravana_companyId_loteId_idx" ON "Caravana"("companyId", "loteId");
CREATE INDEX IF NOT EXISTS "Caravana_rfid_idx" ON "Caravana"("rfid");
CREATE INDEX IF NOT EXISTS "RecuentoCaravana_companyId_idx" ON "RecuentoCaravana"("companyId");
CREATE INDEX IF NOT EXISTS "RecuentoCaravana_companyId_fecha_idx" ON "RecuentoCaravana"("companyId", "fecha");
