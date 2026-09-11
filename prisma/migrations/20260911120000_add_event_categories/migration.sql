-- CreateTable
CREATE TABLE "EventCategory" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventCategory_userId_order_idx" ON "EventCategory"("userId", "order");

-- AddForeignKey
ALTER TABLE "EventCategory" ADD CONSTRAINT "EventCategory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DataMigration: cada cuenta ya existente recibe las 9 categorías por defecto que antes eran una
-- lista fija de "tipo" de evento (ver TYPE_LABELS en dashboard/src/pages/AgendaPage.tsx) — ahora
-- gestionables (renombrar/recolor/borrar) como cualquier categoría creada a mano. Las cuentas
-- nuevas las reciben al registrarse (ver authService.register), no aquí.
INSERT INTO "EventCategory" ("userId", "label", "color", "order", "updatedAt")
SELECT u."id", v."label", v."color", v."order", CURRENT_TIMESTAMP
FROM "User" u
CROSS JOIN (
    VALUES
        ('Trabajo', 'primary', 0),
        ('Estudio', 'secondary', 1),
        ('Gimnasio', 'hobby', 2),
        ('Reunión', 'warning', 3),
        ('Evento', 'positive', 4),
        ('Cita', 'habit', 5),
        ('Cumpleaños', 'negative', 6),
        ('Libre', 'muted', 7),
        ('Otro', 'muted', 8)
) AS v("label", "color", "order");

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "categoryId" INTEGER;

-- DataMigration: engancha cada evento existente a la categoría por defecto que corresponde a su
-- antiguo `type` (mismo mapeo que las 9 filas insertadas arriba, por usuario). Los eventos con un
-- `type` que no encaje en ese mapeo (no debería haberlos, pero por si acaso) se quedan sin
-- categoría en vez de fallar la migración.
UPDATE "Event" e
SET "categoryId" = ec."id"
FROM "EventCategory" ec
WHERE ec."userId" = e."userId"
  AND ec."label" = CASE e."type"
        WHEN 'work' THEN 'Trabajo'
        WHEN 'study' THEN 'Estudio'
        WHEN 'gym' THEN 'Gimnasio'
        WHEN 'meeting' THEN 'Reunión'
        WHEN 'evento' THEN 'Evento'
        WHEN 'cita' THEN 'Cita'
        WHEN 'cumpleanos' THEN 'Cumpleaños'
        WHEN 'free' THEN 'Libre'
        WHEN 'otro' THEN 'Otro'
        ELSE NULL
      END;

-- CreateIndex
CREATE INDEX "Event_userId_categoryId_idx" ON "Event"("userId", "categoryId");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "EventCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
