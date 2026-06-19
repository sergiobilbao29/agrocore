-- Logistica relacional: Transportista, Chofer, Camion como entidades propias
CREATE TABLE "Transportista" (
  "id"            TEXT NOT NULL,
  "companyId"     TEXT NOT NULL,
  "nombre"        TEXT NOT NULL,
  "cuit"          TEXT,
  "telefono"      TEXT,
  "email"         TEXT,
  "direccion"     TEXT,
  "observaciones" TEXT,
  "activo"        BOOLEAN NOT NULL DEFAULT true,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Transportista_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Transportista_companyId_idx" ON "Transportista"("companyId");
CREATE INDEX "Transportista_nombre_idx" ON "Transportista"("nombre");
ALTER TABLE "Transportista"
  ADD CONSTRAINT "Transportista_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Camion" (
  "id"              TEXT NOT NULL,
  "companyId"       TEXT NOT NULL,
  "patente"         TEXT NOT NULL,
  "patenteAcoplado" TEXT,
  "tipo"            TEXT,
  "marca"           TEXT,
  "modelo"          TEXT,
  "anio"            INTEGER,
  "transportistaId" TEXT,
  "observaciones"   TEXT,
  "activo"          BOOLEAN NOT NULL DEFAULT true,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Camion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Camion_companyId_idx" ON "Camion"("companyId");
CREATE INDEX "Camion_transportistaId_idx" ON "Camion"("transportistaId");
CREATE INDEX "Camion_patente_idx" ON "Camion"("patente");
ALTER TABLE "Camion"
  ADD CONSTRAINT "Camion_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Camion"
  ADD CONSTRAINT "Camion_transportistaId_fkey"
  FOREIGN KEY ("transportistaId") REFERENCES "Transportista"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Chofer" (
  "id"              TEXT NOT NULL,
  "companyId"       TEXT NOT NULL,
  "nombre"          TEXT NOT NULL,
  "cuit"            TEXT,
  "licencia"        TEXT,
  "telefono"        TEXT,
  "transportistaId" TEXT,
  "camionId"        TEXT,
  "observaciones"   TEXT,
  "activo"          BOOLEAN NOT NULL DEFAULT true,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Chofer_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Chofer_companyId_idx" ON "Chofer"("companyId");
CREATE INDEX "Chofer_transportistaId_idx" ON "Chofer"("transportistaId");
CREATE INDEX "Chofer_camionId_idx" ON "Chofer"("camionId");
ALTER TABLE "Chofer"
  ADD CONSTRAINT "Chofer_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Chofer"
  ADD CONSTRAINT "Chofer_transportistaId_fkey"
  FOREIGN KEY ("transportistaId") REFERENCES "Transportista"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Chofer"
  ADD CONSTRAINT "Chofer_camionId_fkey"
  FOREIGN KEY ("camionId") REFERENCES "Camion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- IDs en Viaje para vincular (opcional, mantiene compat con texto libre)
ALTER TABLE "Viaje"
  ADD COLUMN "transportistaId" TEXT,
  ADD COLUMN "choferId"        TEXT,
  ADD COLUMN "camionId"        TEXT;
ALTER TABLE "Viaje"
  ADD CONSTRAINT "Viaje_transportistaId_fkey"
  FOREIGN KEY ("transportistaId") REFERENCES "Transportista"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Viaje"
  ADD CONSTRAINT "Viaje_choferId_fkey"
  FOREIGN KEY ("choferId") REFERENCES "Chofer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Viaje"
  ADD CONSTRAINT "Viaje_camionId_fkey"
  FOREIGN KEY ("camionId") REFERENCES "Camion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Viaje_transportistaId_idx" ON "Viaje"("transportistaId");
CREATE INDEX "Viaje_choferId_idx" ON "Viaje"("choferId");
CREATE INDEX "Viaje_camionId_idx" ON "Viaje"("camionId");
