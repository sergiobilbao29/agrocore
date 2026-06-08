-- ============================================================
-- Migración: Estado de Situación + Labor expandida
-- - Depósitos (cereal en cerealera)
-- - Liquidación de cereal + conceptos
-- - Créditos bancarios + cuotas
-- - Empleado externo + % por labor
-- - Labor expandida + insumos consumidos del stock
-- ============================================================

-- ---------- Empleado: tipo, cobraPorcentaje, porcentajeDefault ----------
ALTER TABLE "Empleado" ADD COLUMN "tipo" TEXT NOT NULL DEFAULT 'propio';
ALTER TABLE "Empleado" ADD COLUMN "cobraPorcentaje" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Empleado" ADD COLUMN "porcentajeDefault" DOUBLE PRECISION;

-- ---------- LaborAplicada: empleado, precio referencia, %, ganancia ----------
ALTER TABLE "LaborAplicada" ADD COLUMN "empleadoId" TEXT;
ALTER TABLE "LaborAplicada" ADD COLUMN "precioReferencia" DOUBLE PRECISION;
ALTER TABLE "LaborAplicada" ADD COLUMN "tipoPrecio" TEXT;
ALTER TABLE "LaborAplicada" ADD COLUMN "porcentajeEmpleado" DOUBLE PRECISION;
ALTER TABLE "LaborAplicada" ADD COLUMN "gananciaEmpleado" DOUBLE PRECISION;
ALTER TABLE "LaborAplicada" ADD COLUMN "movimientoEmpleadoId" TEXT;
ALTER TABLE "LaborAplicada" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "LaborAplicada" ADD CONSTRAINT "LaborAplicada_empleadoId_fkey"
    FOREIGN KEY ("empleadoId") REFERENCES "Empleado"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "LaborAplicada_empleadoId_idx" ON "LaborAplicada"("empleadoId");

-- ---------- LaborInsumo (items de insumos consumidos en la labor) ----------
CREATE TABLE "LaborInsumo" (
    "id" TEXT NOT NULL,
    "laborId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "cantidad" DOUBLE PRECISION NOT NULL,
    "unidad" TEXT,
    "precioUnit" DOUBLE PRECISION,
    "total" DOUBLE PRECISION,
    "movimientoId" TEXT,
    "observaciones" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LaborInsumo_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LaborInsumo_laborId_idx" ON "LaborInsumo"("laborId");
CREATE INDEX "LaborInsumo_productoId_idx" ON "LaborInsumo"("productoId");
ALTER TABLE "LaborInsumo" ADD CONSTRAINT "LaborInsumo_laborId_fkey"
    FOREIGN KEY ("laborId") REFERENCES "LaborAplicada"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- Deposito ----------
CREATE TABLE "Deposito" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "cuit" TEXT,
    "contacto" TEXT,
    "telefono" TEXT,
    "email" TEXT,
    "direccion" TEXT,
    "localidad" TEXT,
    "provincia" TEXT,
    "costoEstadiaMes" DOUBLE PRECISION,
    "costoSecadaTn" DOUBLE PRECISION,
    "observaciones" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Deposito_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Deposito_companyId_idx" ON "Deposito"("companyId");
CREATE INDEX "Deposito_tipo_idx" ON "Deposito"("tipo");
ALTER TABLE "Deposito" ADD CONSTRAINT "Deposito_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- Movimiento: depositoId ----------
ALTER TABLE "Movimiento" ADD COLUMN "depositoId" TEXT;
CREATE INDEX "Movimiento_depositoId_idx" ON "Movimiento"("depositoId");
ALTER TABLE "Movimiento" ADD CONSTRAINT "Movimiento_depositoId_fkey"
    FOREIGN KEY ("depositoId") REFERENCES "Deposito"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------- LiquidacionCereal + conceptos ----------
CREATE TABLE "LiquidacionCereal" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "depositoId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "clienteId" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL,
    "numero" TEXT,
    "kilosBrutos" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "porcMerma" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "kilosNetos" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "precioPorTn" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bruto" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalDescuentos" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalImpuestos" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "neto" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fechaCobroEst" TIMESTAMP(3),
    "cobrado" BOOLEAN NOT NULL DEFAULT false,
    "observaciones" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LiquidacionCereal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LiquidacionCereal_companyId_idx" ON "LiquidacionCereal"("companyId");
CREATE INDEX "LiquidacionCereal_depositoId_idx" ON "LiquidacionCereal"("depositoId");
CREATE INDEX "LiquidacionCereal_fecha_idx" ON "LiquidacionCereal"("fecha");
ALTER TABLE "LiquidacionCereal" ADD CONSTRAINT "LiquidacionCereal_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiquidacionCereal" ADD CONSTRAINT "LiquidacionCereal_depositoId_fkey"
    FOREIGN KEY ("depositoId") REFERENCES "Deposito"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "LiquidacionCerealConcepto" (
    "id" TEXT NOT NULL,
    "liquidacionId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "concepto" TEXT NOT NULL,
    "importe" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "porcentaje" DOUBLE PRECISION,
    CONSTRAINT "LiquidacionCerealConcepto_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LiquidacionCerealConcepto_liquidacionId_idx" ON "LiquidacionCerealConcepto"("liquidacionId");
ALTER TABLE "LiquidacionCerealConcepto" ADD CONSTRAINT "LiquidacionCerealConcepto_liquidacionId_fkey"
    FOREIGN KEY ("liquidacionId") REFERENCES "LiquidacionCereal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- Credito + CuotaCredito ----------
CREATE TABLE "Credito" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "banco" TEXT NOT NULL,
    "nroOperacion" TEXT,
    "montoOriginal" DOUBLE PRECISION NOT NULL,
    "tasaAnual" DOUBLE PRECISION,
    "cantCuotas" INTEGER NOT NULL,
    "periodicidad" TEXT NOT NULL DEFAULT 'mensual',
    "fechaPrimera" TIMESTAMP(3) NOT NULL,
    "destino" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'activo',
    "observaciones" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Credito_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Credito_companyId_idx" ON "Credito"("companyId");
ALTER TABLE "Credito" ADD CONSTRAINT "Credito_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CuotaCredito" (
    "id" TEXT NOT NULL,
    "creditoId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "vencimiento" TIMESTAMP(3) NOT NULL,
    "importeCapital" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "importeInteres" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "importeOtros" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "importeTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pagada" BOOLEAN NOT NULL DEFAULT false,
    "fechaPago" TIMESTAMP(3),
    "medioPago" TEXT,
    "referencia" TEXT,
    "observaciones" TEXT,
    CONSTRAINT "CuotaCredito_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CuotaCredito_creditoId_idx" ON "CuotaCredito"("creditoId");
CREATE INDEX "CuotaCredito_vencimiento_idx" ON "CuotaCredito"("vencimiento");
ALTER TABLE "CuotaCredito" ADD CONSTRAINT "CuotaCredito_creditoId_fkey"
    FOREIGN KEY ("creditoId") REFERENCES "Credito"("id") ON DELETE CASCADE ON UPDATE CASCADE;
