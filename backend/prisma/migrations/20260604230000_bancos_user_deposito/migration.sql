-- ============================================================
-- Migración: Usuario en Movimiento + Depósitos compartidos + Bancos
-- ============================================================

-- 1) Usuario que registra cada movimiento de stock
ALTER TABLE "Movimiento" ADD COLUMN "userId" TEXT;
CREATE INDEX "Movimiento_userId_idx" ON "Movimiento"("userId");
ALTER TABLE "Movimiento" ADD CONSTRAINT "Movimiento_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2) Depósitos compartidos entre empresas:
-- companyId pasa a NULL-able; cuando es NULL el depósito es visible para todas
-- las empresas. Flag "compartido" para representar la intención del usuario.
ALTER TABLE "Deposito" DROP CONSTRAINT IF EXISTS "Deposito_companyId_fkey";
ALTER TABLE "Deposito" ALTER COLUMN "companyId" DROP NOT NULL;
ALTER TABLE "Deposito" ADD COLUMN "compartido" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Deposito" ADD CONSTRAINT "Deposito_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Deposito_compartido_idx" ON "Deposito"("compartido");

-- 3) Bancos: cuentas y movimientos
CREATE TABLE "BancoCuenta" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "banco" TEXT NOT NULL,
    "sucursal" TEXT,
    "tipo" TEXT NOT NULL DEFAULT 'cta_cte',
    "moneda" TEXT NOT NULL DEFAULT 'ARS',
    "numero" TEXT,
    "cbu" TEXT,
    "alias" TEXT,
    "titular" TEXT,
    "saldoInicial" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fechaInicial" TIMESTAMP(3),
    "observaciones" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BancoCuenta_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BancoCuenta_companyId_idx" ON "BancoCuenta"("companyId");
CREATE INDEX "BancoCuenta_banco_idx" ON "BancoCuenta"("banco");
ALTER TABLE "BancoCuenta" ADD CONSTRAINT "BancoCuenta_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BancoMovimiento" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "cuentaId" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "tipo" TEXT NOT NULL,
    "concepto" TEXT NOT NULL,
    "monto" DOUBLE PRECISION NOT NULL,
    "contraparte" TEXT,
    "referencia" TEXT,
    "cuentaContraId" TEXT,
    "chequeId" TEXT,
    "cuotaCreditoId" TEXT,
    "efectivoId" TEXT,
    "conciliado" BOOLEAN NOT NULL DEFAULT false,
    "observaciones" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BancoMovimiento_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BancoMovimiento_companyId_idx" ON "BancoMovimiento"("companyId");
CREATE INDEX "BancoMovimiento_cuentaId_idx" ON "BancoMovimiento"("cuentaId");
CREATE INDEX "BancoMovimiento_fecha_idx" ON "BancoMovimiento"("fecha");
CREATE INDEX "BancoMovimiento_tipo_idx" ON "BancoMovimiento"("tipo");
CREATE INDEX "BancoMovimiento_chequeId_idx" ON "BancoMovimiento"("chequeId");
CREATE INDEX "BancoMovimiento_cuotaCreditoId_idx" ON "BancoMovimiento"("cuotaCreditoId");
ALTER TABLE "BancoMovimiento" ADD CONSTRAINT "BancoMovimiento_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BancoMovimiento" ADD CONSTRAINT "BancoMovimiento_cuentaId_fkey"
    FOREIGN KEY ("cuentaId") REFERENCES "BancoCuenta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BancoMovimiento" ADD CONSTRAINT "BancoMovimiento_cuentaContraId_fkey"
    FOREIGN KEY ("cuentaContraId") REFERENCES "BancoCuenta"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BancoMovimiento" ADD CONSTRAINT "BancoMovimiento_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
