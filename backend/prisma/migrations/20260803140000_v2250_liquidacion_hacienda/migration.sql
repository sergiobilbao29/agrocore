-- v2.25.0 - Liquidacion de hacienda (venta que descuenta stock real + SENASA). Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS "LiquidacionHacienda" (
  "id"             TEXT NOT NULL,
  "companyId"      TEXT NOT NULL,
  "campoId"        TEXT NOT NULL,
  "clienteId"      TEXT,
  "fecha"          TIMESTAMP(3) NOT NULL,
  "numero"         TEXT,
  "cae"            TEXT,
  "caeVto"         TIMESTAMP(3),
  "emisorNombre"   TEXT,
  "emisorCuit"     TEXT,
  "receptorNombre" TEXT,
  "receptorCuit"   TEXT,
  "brutoTotal"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "ivaBruto"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "gastosTotal"    DOUBLE PRECISION NOT NULL DEFAULT 0,
  "ivaGastos"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "neto"           DOUBLE PRECISION NOT NULL DEFAULT 0,
  "gastos"         JSONB,
  "cobrado"        BOOLEAN NOT NULL DEFAULT false,
  "fechaCobroEst"  TIMESTAMP(3),
  "observaciones"  TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LiquidacionHacienda_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LiquidacionHaciendaRenglon" (
  "id"             TEXT NOT NULL,
  "liquidacionId"  TEXT NOT NULL,
  "especie"        TEXT,
  "categoria"      TEXT NOT NULL,
  "categoriaTexto" TEXT,
  "raza"           TEXT,
  "tropa"          TEXT,
  "cabezas"        INTEGER NOT NULL DEFAULT 0,
  "kilos"          DOUBLE PRECISION NOT NULL DEFAULT 0,
  "precioKg"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "bruto"          DOUBLE PRECISION NOT NULL DEFAULT 0,
  "alicuotaIva"    DOUBLE PRECISION NOT NULL DEFAULT 10.5,
  "iva"            DOUBLE PRECISION NOT NULL DEFAULT 0,
  "haciendaMovId"  TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LiquidacionHaciendaRenglon_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LiquidacionHacienda_companyId_idx" ON "LiquidacionHacienda"("companyId");
CREATE INDEX IF NOT EXISTS "LiquidacionHacienda_campoId_idx" ON "LiquidacionHacienda"("campoId");
CREATE INDEX IF NOT EXISTS "LiquidacionHaciendaRenglon_liquidacionId_idx" ON "LiquidacionHaciendaRenglon"("liquidacionId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LiquidacionHacienda_companyId_fkey') THEN
    ALTER TABLE "LiquidacionHacienda" ADD CONSTRAINT "LiquidacionHacienda_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LiquidacionHacienda_campoId_fkey') THEN
    ALTER TABLE "LiquidacionHacienda" ADD CONSTRAINT "LiquidacionHacienda_campoId_fkey"
      FOREIGN KEY ("campoId") REFERENCES "Campo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LiquidacionHaciendaRenglon_liquidacionId_fkey') THEN
    ALTER TABLE "LiquidacionHaciendaRenglon" ADD CONSTRAINT "LiquidacionHaciendaRenglon_liquidacionId_fkey"
      FOREIGN KEY ("liquidacionId") REFERENCES "LiquidacionHacienda"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
