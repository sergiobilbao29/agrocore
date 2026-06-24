-- v1.2.7 — Acoplado como entidad propia (separada del chasis) + acopladoId en Viaje y Chofer.
-- Idempotente (IF NOT EXISTS) para que sea seguro reaplicar. Las claves foráneas
-- las termina de sincronizar `prisma db push` del actualizador (evita fallos por
-- "constraint ya existe" que romperían la migración).

-- ====== Tabla Acoplado ======
CREATE TABLE IF NOT EXISTS "Acoplado" (
  "id"              TEXT NOT NULL,
  "companyId"       TEXT NOT NULL,
  "patente"         TEXT NOT NULL,
  "tipo"            TEXT,
  "marca"           TEXT,
  "modelo"          TEXT,
  "anio"            INTEGER,
  "transportistaId" TEXT,
  "observaciones"   TEXT,
  "activo"          BOOLEAN NOT NULL DEFAULT true,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Acoplado_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Acoplado_companyId_idx"       ON "Acoplado"("companyId");
CREATE INDEX IF NOT EXISTS "Acoplado_transportistaId_idx" ON "Acoplado"("transportistaId");
CREATE INDEX IF NOT EXISTS "Acoplado_patente_idx"         ON "Acoplado"("patente");

-- ====== acopladoId en Viaje y Chofer ======
ALTER TABLE "Viaje"  ADD COLUMN IF NOT EXISTS "acopladoId" TEXT;
ALTER TABLE "Chofer" ADD COLUMN IF NOT EXISTS "acopladoId" TEXT;
CREATE INDEX IF NOT EXISTS "Viaje_acopladoId_idx"  ON "Viaje"("acopladoId");
CREATE INDEX IF NOT EXISTS "Chofer_acopladoId_idx" ON "Chofer"("acopladoId");
