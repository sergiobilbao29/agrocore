-- v2.386 — Empleados compartidos (jornaleros que trabajan en varias empresas del grupo).
-- Aditivo, reversible, sin tocar datos existentes.
ALTER TABLE "Empleado" ADD COLUMN "compartido" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "LiquidacionSueldo" ADD COLUMN "esConsolidada" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LiquidacionSueldo" ADD COLUMN "empresaPagadoraId" TEXT;
