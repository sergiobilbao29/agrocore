-- Mejora pedida por administración: control de efectivo multi-caja.
-- "cajaDestino" permite registrar transferencias entre cajas (origen -> destino)
-- en un solo movimiento. "clasificacion" divide ingresos y gastos en
-- "empresa" o "propio" (sobre todo para distinguir lo de los chicos).
-- Ambos campos son opcionales para no romper los movimientos ya cargados.

-- AlterTable
ALTER TABLE "Efectivo" ADD COLUMN "cajaDestino" TEXT;
ALTER TABLE "Efectivo" ADD COLUMN "clasificacion" TEXT;
