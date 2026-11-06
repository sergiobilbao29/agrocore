-- Proveedor de granos + cuenta corriente en kilos (soja)
ALTER TABLE "Proveedor" ADD COLUMN "esGranos" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "GranoCtaMov" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "fecha" TIMESTAMP(3) NOT NULL,
  "proveedorId" TEXT NOT NULL,
  "proveedorNombre" TEXT,
  "tipo" TEXT NOT NULL,
  "productoId" TEXT,
  "kilos" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "signo" INTEGER NOT NULL DEFAULT 1,
  "kilosNeto" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "precio" DOUBLE PRECISION,
  "importe" DOUBLE PRECISION,
  "numeroComprobante" TEXT,
  "depositoId" TEXT,
  "generaStock" BOOLEAN NOT NULL DEFAULT false,
  "ctaCteRef" TEXT,
  "referencia" TEXT,
  "observaciones" TEXT,
  "userId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GranoCtaMov_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GranoCtaMov_companyId_idx" ON "GranoCtaMov"("companyId");
CREATE INDEX "GranoCtaMov_proveedorId_idx" ON "GranoCtaMov"("proveedorId");
CREATE INDEX "GranoCtaMov_fecha_idx" ON "GranoCtaMov"("fecha");
ALTER TABLE "GranoCtaMov" ADD CONSTRAINT "GranoCtaMov_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
