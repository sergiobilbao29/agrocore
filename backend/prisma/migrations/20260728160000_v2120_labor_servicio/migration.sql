-- v2.12.0 - Labor a terceros (servicio facturable). Aditiva e idempotente.

-- campanaId pasa a ser opcional (null cuando es servicio a un tercero)
ALTER TABLE "LaborAplicada" ALTER COLUMN "campanaId" DROP NOT NULL;

ALTER TABLE "LaborAplicada" ADD COLUMN IF NOT EXISTS "esServicio" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LaborAplicada" ADD COLUMN IF NOT EXISTS "clienteId" TEXT;
ALTER TABLE "LaborAplicada" ADD COLUMN IF NOT EXISTS "facturaId" TEXT;

CREATE INDEX IF NOT EXISTS "LaborAplicada_clienteId_idx" ON "LaborAplicada"("clienteId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LaborAplicada_clienteId_fkey') THEN
    ALTER TABLE "LaborAplicada" ADD CONSTRAINT "LaborAplicada_clienteId_fkey"
      FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
