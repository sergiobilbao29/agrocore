-- v2.129.0 — Visibilidad de módulos por EMPRESA (según actividad).
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "modulosOcultos" TEXT;

-- Fase 3 Fichas de animales: cargo a cobrar al propietario tercero (hotelería/servicios).
ALTER TABLE "AnimalEvento" ADD COLUMN IF NOT EXISTS "aCobrar" BOOLEAN NOT NULL DEFAULT false;
