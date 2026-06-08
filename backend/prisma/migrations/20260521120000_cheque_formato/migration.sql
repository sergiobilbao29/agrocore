-- Mejora pedida por administración: distinguir cheques físicos de electrónicos (echeq).
-- Campo opcional para no romper los cheques ya cargados.

-- AlterTable
ALTER TABLE "Cheque" ADD COLUMN "formato" TEXT;
