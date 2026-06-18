-- Recordatorio oculto: cuando el usuario "elimina" un recordatorio auto-generado
-- (proveniente de un Crédito, Cheque, CtaCte) lo guardamos acá para no
-- volver a mostrarlo. No se borra el registro original — solo se esconde
-- de la Agenda.
CREATE TABLE "RecordatorioOculto" (
  "id"          TEXT NOT NULL,
  "companyId"   TEXT NOT NULL,
  "refTipo"     TEXT NOT NULL,
  "refId"       TEXT NOT NULL,
  "ocultadoEn"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RecordatorioOculto_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecordatorioOculto_companyId_refTipo_refId_key"
  ON "RecordatorioOculto"("companyId", "refTipo", "refId");
CREATE INDEX "RecordatorioOculto_companyId_idx"
  ON "RecordatorioOculto"("companyId");

ALTER TABLE "RecordatorioOculto"
  ADD CONSTRAINT "RecordatorioOculto_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
