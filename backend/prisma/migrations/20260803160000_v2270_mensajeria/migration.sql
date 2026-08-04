-- v2.27.0 - Mensajeria interna + asistente. Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS "Mensaje" (
  "id"          TEXT NOT NULL,
  "companyId"   TEXT NOT NULL,
  "canal"       TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "rol"         TEXT NOT NULL DEFAULT 'user',
  "autorNombre" TEXT,
  "texto"       TEXT NOT NULL,
  "fotoUrl"     TEXT,
  "meta"        JSONB,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Mensaje_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Mensaje_companyId_canal_idx" ON "Mensaje"("companyId","canal");
CREATE INDEX IF NOT EXISTS "Mensaje_companyId_canal_userId_idx" ON "Mensaje"("companyId","canal","userId");
CREATE INDEX IF NOT EXISTS "Mensaje_createdAt_idx" ON "Mensaje"("createdAt");

CREATE TABLE IF NOT EXISTS "ChatEstado" (
  "id"              TEXT NOT NULL,
  "companyId"       TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "lastReadGeneral" TIMESTAMP(3),
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatEstado_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ChatEstado_companyId_userId_key" ON "ChatEstado"("companyId","userId");
CREATE INDEX IF NOT EXISTS "ChatEstado_companyId_idx" ON "ChatEstado"("companyId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Mensaje_companyId_fkey') THEN
    ALTER TABLE "Mensaje" ADD CONSTRAINT "Mensaje_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatEstado_companyId_fkey') THEN
    ALTER TABLE "ChatEstado" ADD CONSTRAINT "ChatEstado_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
