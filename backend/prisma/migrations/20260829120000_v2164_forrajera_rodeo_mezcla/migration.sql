-- v2.164: imputar forrajera a rodeo + producto mezcla/racion

ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "esMezcla" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RodeoEvento" ADD COLUMN IF NOT EXISTS "campanaForrajeraId" TEXT;

CREATE TABLE IF NOT EXISTS "MezclaComponente" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "mezclaId" TEXT NOT NULL,
  "componenteId" TEXT NOT NULL,
  "porcentaje" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MezclaComponente_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "MezclaComponente_companyId_idx" ON "MezclaComponente"("companyId");
CREATE INDEX IF NOT EXISTS "MezclaComponente_mezclaId_idx" ON "MezclaComponente"("mezclaId");
