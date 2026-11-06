-- Canje: entrega parcial (lo realmente entregado) + pendiente
ALTER TABLE "Canje" ADD COLUMN "entregadoCant" DOUBLE PRECISION NOT NULL DEFAULT 0;
-- Los canjes existentes ya habian entregado el total: reflejarlo para que no queden "pendientes".
UPDATE "Canje" SET "entregadoCant" = "entregaCant";
