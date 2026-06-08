-- Pedido: la sección de empleados pasa de ser una simple nómina a una
-- planilla de gastos y ganancias por empleado, con liquidación mensual de
-- sueldo. Dos tablas nuevas:
--   * MovimientoEmpleado: cada ingreso/egreso del empleado (horas, adelantos,
--     compras personales, premios, descuentos, etc.) agrupable por mes.
--   * LiquidacionSueldo: la liquidación de un mes, con los totales "foto" y
--     el medio de pago (efectivo / cheque / transferencia). Si se pagó por
--     efectivo o cheque, queda enlazado el registro generado en esos módulos.

-- CreateTable
CREATE TABLE "MovimientoEmpleado" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "empleadoId" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "periodo" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "categoria" TEXT,
    "concepto" TEXT NOT NULL,
    "horas" DOUBLE PRECISION,
    "valorHora" DOUBLE PRECISION,
    "monto" DOUBLE PRECISION NOT NULL,
    "liquidacionId" TEXT,
    "observaciones" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimientoEmpleado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiquidacionSueldo" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "empleadoId" TEXT NOT NULL,
    "periodo" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "sueldoBase" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalGanancias" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalGastos" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "neto" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "medioPago" TEXT NOT NULL,
    "caja" TEXT,
    "banco" TEXT,
    "nroCheque" TEXT,
    "referencia" TEXT,
    "efectivoId" TEXT,
    "chequeId" TEXT,
    "observaciones" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiquidacionSueldo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MovimientoEmpleado_companyId_idx" ON "MovimientoEmpleado"("companyId");

-- CreateIndex
CREATE INDEX "MovimientoEmpleado_empleadoId_idx" ON "MovimientoEmpleado"("empleadoId");

-- CreateIndex
CREATE INDEX "MovimientoEmpleado_empleadoId_periodo_idx" ON "MovimientoEmpleado"("empleadoId", "periodo");

-- CreateIndex
CREATE INDEX "LiquidacionSueldo_companyId_idx" ON "LiquidacionSueldo"("companyId");

-- CreateIndex
CREATE INDEX "LiquidacionSueldo_empleadoId_idx" ON "LiquidacionSueldo"("empleadoId");

-- CreateIndex
CREATE UNIQUE INDEX "LiquidacionSueldo_empleadoId_periodo_key" ON "LiquidacionSueldo"("empleadoId", "periodo");

-- AddForeignKey
ALTER TABLE "MovimientoEmpleado" ADD CONSTRAINT "MovimientoEmpleado_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoEmpleado" ADD CONSTRAINT "MovimientoEmpleado_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "Empleado"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiquidacionSueldo" ADD CONSTRAINT "LiquidacionSueldo_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiquidacionSueldo" ADD CONSTRAINT "LiquidacionSueldo_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "Empleado"("id") ON DELETE CASCADE ON UPDATE CASCADE;
