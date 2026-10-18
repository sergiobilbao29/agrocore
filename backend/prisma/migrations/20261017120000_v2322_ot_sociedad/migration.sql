-- v2.322.0 - Orden de trabajo: imputar el renglón a un campo de una Sociedad/UTE.
-- Agrega sociedadId y sociedadLinkId al renglón de la OT. Idempotente.

ALTER TABLE "OrdenTrabajoRenglon" ADD COLUMN IF NOT EXISTS "sociedadId"     TEXT;
ALTER TABLE "OrdenTrabajoRenglon" ADD COLUMN IF NOT EXISTS "sociedadLinkId" TEXT;
