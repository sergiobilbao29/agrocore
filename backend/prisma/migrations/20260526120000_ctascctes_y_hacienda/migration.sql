-- Pedido de administración:
-- 1) Los movimientos "manuales / libres" de Cuentas Corrientes deben ir en una
--    sección aparte con su propia categoría, fecha de vencimiento y marca de
--    pagado, para que NO se mezclen en los totales de clientes / proveedores.
-- 2) Sección de Hacienda nueva: stock por campo y por categoría, con
--    "declarado" (SENASA / ARCA) y "real" (lo que cuentan en el campo).
--    Los movimientos (nacimientos, muertes, compras, ventas, traslados,
--    ajustes) alimentan el stock real. La diferencia con el declarado les
--    recuerda registrar en ARCA.

-- ----- 1) CtaCte: nuevos campos --------------------------------------------
ALTER TABLE "CtaCte" ADD COLUMN "vencimiento" TIMESTAMP(3);
ALTER TABLE "CtaCte" ADD COLUMN "categoria" TEXT;
ALTER TABLE "CtaCte" ADD COLUMN "pagado" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "CtaCte_vencimiento_idx" ON "CtaCte"("vencimiento");

-- ----- 2) Hacienda ---------------------------------------------------------
CREATE TABLE "HaciendaStock" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "campoId" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "declarado" INTEGER NOT NULL DEFAULT 0,
    "observaciones" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HaciendaStock_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HaciendaMovimiento" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "campoId" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "tipo" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "campoOrigen" TEXT,
    "campoDestino" TEXT,
    "observaciones" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HaciendaMovimiento_pkey" PRIMARY KEY ("id")
);

-- Índices
CREATE UNIQUE INDEX "HaciendaStock_companyId_campoId_categoria_key" ON "HaciendaStock"("companyId", "campoId", "categoria");
CREATE INDEX "HaciendaStock_companyId_idx" ON "HaciendaStock"("companyId");
CREATE INDEX "HaciendaStock_campoId_idx" ON "HaciendaStock"("campoId");

CREATE INDEX "HaciendaMovimiento_companyId_idx" ON "HaciendaMovimiento"("companyId");
CREATE INDEX "HaciendaMovimiento_campoId_categoria_idx" ON "HaciendaMovimiento"("campoId", "categoria");
CREATE INDEX "HaciendaMovimiento_fecha_idx" ON "HaciendaMovimiento"("fecha");

-- Foreign keys
ALTER TABLE "HaciendaStock" ADD CONSTRAINT "HaciendaStock_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HaciendaStock" ADD CONSTRAINT "HaciendaStock_campoId_fkey" FOREIGN KEY ("campoId") REFERENCES "Campo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HaciendaMovimiento" ADD CONSTRAINT "HaciendaMovimiento_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HaciendaMovimiento" ADD CONSTRAINT "HaciendaMovimiento_campoId_fkey" FOREIGN KEY ("campoId") REFERENCES "Campo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
