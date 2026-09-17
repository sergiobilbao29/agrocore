-- v2.218.0 — Ficha de animales: segunda foto de perfil + adjuntos (radiografías, videos, fotos, archivos)
-- Segunda foto de perfil (frente / costado)
ALTER TABLE "Animal" ADD COLUMN "foto2" TEXT;

-- Adjuntos vinculables a una ficha de animal o a un evento del historial
ALTER TABLE "Adjunto" ADD COLUMN "animalId" TEXT;
ALTER TABLE "Adjunto" ADD COLUMN "animalEventoId" TEXT;

CREATE INDEX "Adjunto_animalId_idx" ON "Adjunto"("animalId");
CREATE INDEX "Adjunto_animalEventoId_idx" ON "Adjunto"("animalEventoId");

ALTER TABLE "Adjunto" ADD CONSTRAINT "Adjunto_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Adjunto" ADD CONSTRAINT "Adjunto_animalEventoId_fkey" FOREIGN KEY ("animalEventoId") REFERENCES "AnimalEvento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
