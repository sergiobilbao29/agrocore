-- v2.129.0 — Visibilidad de módulos por EMPRESA (según actividad).
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "modulosOcultos" TEXT;
