-- v2.93.0 - Notificación push por recordatorio del calendario. Aditiva e idempotente.

ALTER TABLE "Recordatorio" ADD COLUMN IF NOT EXISTS "notificar"     BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Recordatorio" ADD COLUMN IF NOT EXISTS "notificarHora" TEXT;
ALTER TABLE "Recordatorio" ADD COLUMN IF NOT EXISTS "notificadoEn"  TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Recordatorio_notificar_notificadoEn_idx" ON "Recordatorio"("notificar", "notificadoEn");
