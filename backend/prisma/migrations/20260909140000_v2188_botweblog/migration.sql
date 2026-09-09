-- v2.188: registro de consultas al asistente público de la web (agrocore.ar).
CREATE TABLE IF NOT EXISTS "BotWebLog" (
  "id"        TEXT NOT NULL,
  "pregunta"  TEXT NOT NULL,
  "respuesta" TEXT,
  "fuente"    TEXT,
  "ip"        TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BotWebLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "BotWebLog_createdAt_idx" ON "BotWebLog"("createdAt");
