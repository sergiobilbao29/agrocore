-- Pago de entregas de arrendamiento (kilos) con Intercompany: otra firma del grupo pone los fondos
ALTER TABLE "ArrendamientoVentaPago" ADD COLUMN "empresaOrigenId" TEXT;
ALTER TABLE "ArrendamientoVentaPago" ADD COLUMN "intercompanyRef" TEXT;
