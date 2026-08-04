-- v2.30.0 - Grupos de mensajeria + lectura por conversacion. Aditiva e idempotente.
ALTER TABLE "ChatEstado" ADD COLUMN IF NOT EXISTS "lastRead" JSONB;

CREATE TABLE IF NOT EXISTS "MensajeGrupo" (
  "id"        TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "nombre"    TEXT NOT NULL,
  "miembros"  JSONB NOT NULL,
  "creadoPor" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MensajeGrupo_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "MensajeGrupo_companyId_idx" ON "MensajeGrupo"("companyId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MensajeGrupo_companyId_fkey') THEN
    ALTER TABLE "MensajeGrupo" ADD CONSTRAINT "MensajeGrupo_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
