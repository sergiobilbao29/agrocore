-- v2.124.0: Guías de hacienda / DT-e (comprobante operativo previo al fiscal)
-- Mueve stock al instante + cuenta corriente provisoria + pagos a cuenta,
-- y luego se vincula con la Liquidación / Factura para el cierre fiscal.

CREATE TABLE IF NOT EXISTS "GuiaHacienda" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "campoId" TEXT,
  "fecha" TIMESTAMP(3) NOT NULL,
  "sentido" TEXT NOT NULL,
  "motivo" TEXT NOT NULL,
  "numeroDte" TEXT,
  "renspaOrigen" TEXT,
  "renspaDestino" TEXT,
  "titularOrigen" TEXT,
  "titularDestino" TEXT,
  "especie" TEXT,
  "contactoTipo" TEXT,
  "contactoId" TEXT,
  "frigorifico" TEXT,
  "frigorificoCuit" TEXT,
  "alicuotaIva" DOUBLE PRECISION NOT NULL DEFAULT 10.5,
  "totalEstimado" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "ivaEstimado" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "estado" TEXT NOT NULL DEFAULT 'pendiente',
  "liquidacionId" TEXT,
  "facturaCompraId" TEXT,
  "faenaId" TEXT,
  "ctacteRef" TEXT,
  "archivoNombre" TEXT,
  "observaciones" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GuiaHacienda_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GuiaHaciendaRenglon" (
  "id" TEXT NOT NULL,
  "guiaId" TEXT NOT NULL,
  "especie" TEXT,
  "categoria" TEXT NOT NULL,
  "categoriaTexto" TEXT,
  "cabezas" INTEGER NOT NULL DEFAULT 0,
  "kilos" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "precioKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "bruto" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "alicuotaIva" DOUBLE PRECISION NOT NULL DEFAULT 10.5,
  "iva" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "haciendaMovId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GuiaHaciendaRenglon_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GuiaHaciendaPago" (
  "id" TEXT NOT NULL,
  "guiaId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "fecha" TIMESTAMP(3) NOT NULL,
  "monto" DOUBLE PRECISION NOT NULL,
  "metodo" TEXT NOT NULL,
  "referencia" TEXT,
  "bancoMovId" TEXT,
  "efectivoId" TEXT,
  "observaciones" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GuiaHaciendaPago_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "GuiaHacienda_companyId_idx" ON "GuiaHacienda"("companyId");
CREATE INDEX IF NOT EXISTS "GuiaHacienda_companyId_estado_idx" ON "GuiaHacienda"("companyId", "estado");
CREATE INDEX IF NOT EXISTS "GuiaHacienda_fecha_idx" ON "GuiaHacienda"("fecha");
CREATE INDEX IF NOT EXISTS "GuiaHaciendaRenglon_guiaId_idx" ON "GuiaHaciendaRenglon"("guiaId");
CREATE INDEX IF NOT EXISTS "GuiaHaciendaPago_guiaId_idx" ON "GuiaHaciendaPago"("guiaId");
CREATE INDEX IF NOT EXISTS "GuiaHaciendaPago_companyId_idx" ON "GuiaHaciendaPago"("companyId");

DO $$ BEGIN
  ALTER TABLE "GuiaHacienda" ADD CONSTRAINT "GuiaHacienda_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "GuiaHaciendaRenglon" ADD CONSTRAINT "GuiaHaciendaRenglon_guiaId_fkey" FOREIGN KEY ("guiaId") REFERENCES "GuiaHacienda"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "GuiaHaciendaPago" ADD CONSTRAINT "GuiaHaciendaPago_guiaId_fkey" FOREIGN KEY ("guiaId") REFERENCES "GuiaHacienda"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
