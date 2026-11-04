-- v2.375: insumo de entrada en la fórmula de molienda (aditivo que se consume)
ALTER TABLE "FormulaMoliendaItem" ADD COLUMN "esEntrada" BOOLEAN NOT NULL DEFAULT false;
