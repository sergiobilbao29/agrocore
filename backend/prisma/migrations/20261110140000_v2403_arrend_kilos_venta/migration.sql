-- Arrendamiento modalidad "kilos_venta": total en kilos, venta mensual a pizarra, entregas parciales
ALTER TABLE "Arrendamiento" ADD COLUMN "kilosTotal" DOUBLE PRECISION;
ALTER TABLE "Arrendamiento" ADD COLUMN "kilosPorMes" DOUBLE PRECISION;
ALTER TABLE "Arrendamiento" ADD COLUMN "mesInicio" TEXT;

CREATE TABLE "ArrendamientoVenta" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "arrendamientoId" TEXT NOT NULL,
  "periodo" TEXT NOT NULL,
  "etiqueta" TEXT,
  "fechaVenta" TIMESTAMP(3),
  "kilos" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "precioPizarra" DOUBLE PRECISION,
  "importe" DOUBLE PRECISION,
  "estado" TEXT NOT NULL DEFAULT 'pendiente',
  "observaciones" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ArrendamientoVenta_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ArrendamientoVenta_companyId_idx" ON "ArrendamientoVenta"("companyId");
CREATE INDEX "ArrendamientoVenta_arrendamientoId_idx" ON "ArrendamientoVenta"("arrendamientoId");

CREATE TABLE "ArrendamientoVentaPago" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "ventaId" TEXT NOT NULL,
  "fecha" TIMESTAMP(3) NOT NULL,
  "importe" DOUBLE PRECISION NOT NULL,
  "metodo" TEXT NOT NULL,
  "caja" TEXT,
  "chequeId" TEXT,
  "bancoCuentaId" TEXT,
  "observaciones" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ArrendamientoVentaPago_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ArrendamientoVentaPago_companyId_idx" ON "ArrendamientoVentaPago"("companyId");
CREATE INDEX "ArrendamientoVentaPago_ventaId_idx" ON "ArrendamientoVentaPago"("ventaId");

ALTER TABLE "ArrendamientoVenta" ADD CONSTRAINT "ArrendamientoVenta_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArrendamientoVenta" ADD CONSTRAINT "ArrendamientoVenta_arrendamientoId_fkey" FOREIGN KEY ("arrendamientoId") REFERENCES "Arrendamiento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArrendamientoVentaPago" ADD CONSTRAINT "ArrendamientoVentaPago_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArrendamientoVentaPago" ADD CONSTRAINT "ArrendamientoVentaPago_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "ArrendamientoVenta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ArrendamientoVentaPago" ADD COLUMN "movEfectivoId" TEXT;
ALTER TABLE "ArrendamientoVentaPago" ADD COLUMN "movBancoId" TEXT;

ALTER TABLE "ArrendamientoVentaPago" ADD COLUMN "kilosEntregados" DOUBLE PRECISION;
