-- v2.345.0 - Arroz: perfil por empresa (usaArroz) + Secadero (SecadoPartida). Idempotente.
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "usaArroz" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "SecadoPartida" (
  "id"              TEXT PRIMARY KEY,
  "companyId"       TEXT NOT NULL,
  "fecha"           TIMESTAMP(3) NOT NULL,
  "productoOrigenId"  TEXT,
  "productoDestinoId" TEXT,
  "depositoId"      TEXT,
  "kgHumedo"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  "humedadEntrada"  DOUBLE PRECISION NOT NULL DEFAULT 0,
  "humedadSalida"   DOUBLE PRECISION NOT NULL DEFAULT 14,
  "mermaVolatilPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "kgSeco"          DOUBLE PRECISION NOT NULL DEFAULT 0,
  "costoTotal"      DOUBLE PRECISION,
  "moneda"          TEXT DEFAULT 'ARS',
  "campanaId"       TEXT,
  "observaciones"   TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SecadoPartida_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "SecadoPartida_companyId_idx" ON "SecadoPartida"("companyId");
