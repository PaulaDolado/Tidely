-- CreateTable
CREATE TABLE "BudgetCategory" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "percent" DECIMAL(5,2) NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BudgetCategory_userId_order_idx" ON "BudgetCategory"("userId", "order");

-- AddForeignKey
ALTER TABLE "BudgetCategory" ADD CONSTRAINT "BudgetCategory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Categorías de presupuesto por defecto para las cuentas que YA existían (las nuevas las reciben al
-- registrarse, ver budgetService.seedDefaultBudgetCategories). Mismos valores que
-- DEFAULT_BUDGET_CATEGORIES: 65% de los ingresos repartido, el resto sin asignar.
INSERT INTO "BudgetCategory" ("userId", "name", "color", "percent", "order", "updatedAt")
SELECT u."id", d."name", d."color", d."percent", d."ord", CURRENT_TIMESTAMP
FROM "User" u
CROSS JOIN (
  VALUES
    ('Casa', 'habit', 30.00, 0),
    ('Comida', 'hobby', 10.00, 1),
    ('Transporte', 'warning', 5.00, 2),
    ('Compras', 'negative', 10.00, 3),
    ('Entretenimiento', 'primary', 5.00, 4),
    ('Otro', 'muted', 5.00, 5)
) AS d("name", "color", "percent", "ord");
