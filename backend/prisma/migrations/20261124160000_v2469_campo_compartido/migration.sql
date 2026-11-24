-- v2.469 — Campo compartido con el grupo economico (como el empleado compartido).
ALTER TABLE "Campo" ADD COLUMN IF NOT EXISTS "compartido" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "Campo_compartido_idx" ON "Campo" ("compartido");
