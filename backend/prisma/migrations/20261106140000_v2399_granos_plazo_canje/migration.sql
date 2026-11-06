-- Granos cta: plazo/vencimiento de la entrega + liquidacion por canje
ALTER TABLE "GranoCtaMov" ADD COLUMN "plazoDias" INTEGER;
ALTER TABLE "GranoCtaMov" ADD COLUMN "vencimiento" TIMESTAMP(3);
ALTER TABLE "GranoCtaMov" ADD COLUMN "modoLiquidacion" TEXT;
ALTER TABLE "GranoCtaMov" ADD COLUMN "productoEntregaId" TEXT;
ALTER TABLE "GranoCtaMov" ADD COLUMN "kilosEntregaProd" DOUBLE PRECISION;
