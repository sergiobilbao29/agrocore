-- v2.85.0 - Remitos internos: salida de insumo al campo (en transito) +
-- transferencia de mercaderia entre depositos (con recepcion). Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS "RemitoInterno" (
  "id"                TEXT NOT NULL,
  "companyId"         TEXT NOT NULL,
  "numero"            INTEGER,
  "fecha"             TIMESTAMP(3) NOT NULL,
  "tipo"              TEXT NOT NULL,
  "estado"            TEXT NOT NULL DEFAULT 'en_transito',
  "depositoOrigenId"  TEXT,
  "depositoDestinoId" TEXT,
  "campanaId"         TEXT,
  "destinoTexto"      TEXT,
  "transportista"     TEXT,
  "chofer"            TEXT,
  "entregadoPor"      TEXT,
  "recibidoPor"       TEXT,
  "fechaRecepcion"    TIMESTAMP(3),
  "fechaUso"          TIMESTAMP(3),
  "observaciones"     TEXT,
  "userId"            TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RemitoInterno_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RemitoRenglon" (
  "id"               TEXT NOT NULL,
  "remitoId"         TEXT NOT NULL,
  "productoId"       TEXT NOT NULL,
  "nombre"           TEXT NOT NULL,
  "cantidad"         DOUBLE PRECISION NOT NULL,
  "unidad"           TEXT NOT NULL,
  "movimientoOutId"  TEXT,
  "movimientoInId"   TEXT,
  "insumoAplicadoId" TEXT,
  "observaciones"    TEXT,
  CONSTRAINT "RemitoRenglon_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RemitoInterno_companyId_idx" ON "RemitoInterno"("companyId");
CREATE INDEX IF NOT EXISTS "RemitoInterno_estado_idx" ON "RemitoInterno"("estado");
CREATE INDEX IF NOT EXISTS "RemitoInterno_campanaId_idx" ON "RemitoInterno"("campanaId");
CREATE INDEX IF NOT EXISTS "RemitoRenglon_remitoId_idx" ON "RemitoRenglon"("remitoId");
CREATE INDEX IF NOT EXISTS "RemitoRenglon_productoId_idx" ON "RemitoRenglon"("productoId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RemitoInterno_companyId_fkey') THEN
    ALTER TABLE "RemitoInterno" ADD CONSTRAINT "RemitoInterno_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RemitoInterno_depositoOrigenId_fkey') THEN
    ALTER TABLE "RemitoInterno" ADD CONSTRAINT "RemitoInterno_depositoOrigenId_fkey"
      FOREIGN KEY ("depositoOrigenId") REFERENCES "Deposito"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RemitoInterno_depositoDestinoId_fkey') THEN
    ALTER TABLE "RemitoInterno" ADD CONSTRAINT "RemitoInterno_depositoDestinoId_fkey"
      FOREIGN KEY ("depositoDestinoId") REFERENCES "Deposito"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RemitoInterno_campanaId_fkey') THEN
    ALTER TABLE "RemitoInterno" ADD CONSTRAINT "RemitoInterno_campanaId_fkey"
      FOREIGN KEY ("campanaId") REFERENCES "Campana"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RemitoRenglon_remitoId_fkey') THEN
    ALTER TABLE "RemitoRenglon" ADD CONSTRAINT "RemitoRenglon_remitoId_fkey"
      FOREIGN KEY ("remitoId") REFERENCES "RemitoInterno"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RemitoRenglon_productoId_fkey') THEN
    ALTER TABLE "RemitoRenglon" ADD CONSTRAINT "RemitoRenglon_productoId_fkey"
      FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
