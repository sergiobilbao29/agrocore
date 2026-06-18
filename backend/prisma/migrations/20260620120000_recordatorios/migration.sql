-- Agenda / Recordatorios: fechas con alerta opcional
CREATE TABLE "Recordatorio" (
  "id"               TEXT NOT NULL,
  "companyId"        TEXT NOT NULL,
  "titulo"           TEXT NOT NULL,
  "descripcion"      TEXT,
  "fecha"            TIMESTAMP(3) NOT NULL,
  "categoria"        TEXT NOT NULL DEFAULT 'otro',
  "prioridad"        TEXT NOT NULL DEFAULT 'media',
  "avisarDiasAntes"  INTEGER NOT NULL DEFAULT 15,
  "completado"       BOOLEAN NOT NULL DEFAULT false,
  "completadoEn"     TIMESTAMP(3),
  "relacionTipo"     TEXT,
  "relacionId"       TEXT,
  "repetir"          TEXT NOT NULL DEFAULT 'ninguno',
  "userIdCreador"    TEXT,

  CONSTRAINT "Recordatorio_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Recordatorio_companyId_fecha_idx" ON "Recordatorio"("companyId", "fecha");
CREATE INDEX "Recordatorio_companyId_completado_fecha_idx" ON "Recordatorio"("companyId", "completado", "fecha");

ALTER TABLE "Recordatorio"
  ADD CONSTRAINT "Recordatorio_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
