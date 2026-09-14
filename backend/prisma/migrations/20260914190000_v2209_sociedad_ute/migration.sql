-- v2.209.0 — Sociedad / UTE de campaña (multiempresa).
-- Agrupa campos de varias empresas del grupo (y campos externos de socios) para
-- consolidar cosecha (cartas de porte) y costos, sin cambiar la titularidad fiscal.

CREATE TABLE IF NOT EXISTS "Sociedad" (
  "id"             TEXT PRIMARY KEY,
  "ownerCompanyId" TEXT NOT NULL,
  "nombre"         TEXT NOT NULL,
  "descripcion"    TEXT,
  "ciclo"          TEXT,
  "fechaInicio"    TIMESTAMP(3),
  "fechaFin"       TIMESTAMP(3),
  "activa"         BOOLEAN NOT NULL DEFAULT true,
  "socios"         JSONB,
  "observaciones"  TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "Sociedad_ownerCompanyId_idx" ON "Sociedad"("ownerCompanyId");

CREATE TABLE IF NOT EXISTS "SociedadCampo" (
  "id"               TEXT PRIMARY KEY,
  "sociedadId"       TEXT NOT NULL,
  "campoId"          TEXT,
  "companyId"        TEXT,
  "externoNombre"    TEXT,
  "externoTitular"   TEXT,
  "externoCuit"      TEXT,
  "externoLocalidad" TEXT,
  "hectareas"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  "cultivo"          TEXT,
  "aportante"        TEXT,
  "observaciones"    TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SociedadCampo_sociedadId_fkey" FOREIGN KEY ("sociedadId") REFERENCES "Sociedad"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "SociedadCampo_sociedadId_idx" ON "SociedadCampo"("sociedadId");
CREATE INDEX IF NOT EXISTS "SociedadCampo_campoId_idx" ON "SociedadCampo"("campoId");

-- Tag manual de una carta de porte (viaje) a una sociedad (ej. CP que sale de un socio).
ALTER TABLE "Viaje" ADD COLUMN IF NOT EXISTS "sociedadId" TEXT;
