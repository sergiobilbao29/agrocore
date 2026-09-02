-- v2.175: cuenta corriente de empleados — monto realmente pagado por liquidación
-- (la diferencia con el neto devengado arrastra como saldo a favor / en contra).
ALTER TABLE "LiquidacionSueldo" ADD COLUMN IF NOT EXISTS "pagado" DOUBLE PRECISION;
