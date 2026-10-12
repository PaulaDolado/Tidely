jest.mock("../../../src/config/database", () => ({
  prisma: {
    budgetCategory: { findMany: jest.fn() },
    savingsGoal: { findMany: jest.fn() },
    transaction: { groupBy: jest.fn(), findFirst: jest.fn() },
  },
}));
jest.mock("../../../src/services/financeService", () => ({ getMonthlyBalance: jest.fn() }));

import { endOfMonth } from "date-fns";
import { prisma } from "../../../src/config/database";
import { getMonthlyBalance } from "../../../src/services/financeService";
import { getBudgetSummary, isPayrollCategory } from "../../../src/services/budgetService";

const prismaMock = prisma as unknown as {
  budgetCategory: { findMany: jest.Mock };
  savingsGoal: { findMany: jest.Mock };
  transaction: { groupBy: jest.Mock; findFirst: jest.Mock };
};
const balanceMock = getMonthlyBalance as jest.Mock;

const CATEGORIES = [
  { id: 1, name: "Casa", color: "habit", percent: 30, order: 0 },
  { id: 2, name: "Comida", color: "hobby", percent: 10, order: 1 },
  { id: 3, name: "Otro", color: "muted", percent: 5, order: 2 },
];

// groupBy se usa dos veces: categorías de ingreso (para buscar la nómina) y gastos por categoría
function simulate({
  incomeCategories,
  expenses = [],
  payroll,
  monthIncome,
}: {
  incomeCategories: string[];
  expenses?: { category: string; amount: number }[];
  payroll: { amount: number; date: Date } | null;
  monthIncome: number;
}) {
  prismaMock.budgetCategory.findMany.mockResolvedValue(CATEGORIES);
  prismaMock.savingsGoal.findMany.mockResolvedValue([]);
  balanceMock.mockResolvedValue({ income: monthIncome, expense: expenses.reduce((s, e) => s + e.amount, 0), balance: 0 });
  prismaMock.transaction.groupBy.mockImplementation(async (args: { where: { type: string } }) =>
    args.where.type === "income"
      ? incomeCategories.map((category) => ({ category }))
      : expenses.map((e) => ({ category: e.category, _sum: { amount: e.amount } }))
  );
  prismaMock.transaction.findFirst.mockResolvedValue(payroll);
}

describe("budgetService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("isPayrollCategory", () => {
    it("reconoce la nómina sin importar mayúsculas, acentos ni espacios", () => {
      for (const name of ["Nómina", "nomina", " NÓMINA ", "Salario", "sueldo", "Salary"]) {
        expect(isPayrollCategory(name)).toBe(true);
      }
    });

    it("no confunde otros ingresos con la nómina", () => {
      for (const name of ["Bizum", "Extra", "Nóminas atrasadas", "venta"]) {
        expect(isPayrollCategory(name)).toBe(false);
      }
    });
  });

  describe("getBudgetSummary", () => {
    it("el máximo de cada categoría es su % de la última nómina, no de todos los ingresos del mes", async () => {
      simulate({
        incomeCategories: ["Nómina", "Bizum"],
        expenses: [{ category: "Casa", amount: 450 }],
        payroll: { amount: 2000, date: new Date(2026, 9, 1) },
        monthIncome: 2500, // nómina + 500 de un Bizum
      });

      const summary = await getBudgetSummary(1, 10, 2026);

      expect(summary.budgetBase).toEqual({ source: "nomina", amount: 2000, date: new Date(2026, 9, 1).toISOString() });
      expect(summary.categories.find((c) => c.name === "Casa")).toMatchObject({ budget: 600, spent: 450 });
      expect(summary.categories.find((c) => c.name === "Comida")).toMatchObject({ budget: 200, spent: 0 });
      expect(summary.totalBudget).toBe(900); // 45% de 2000
      expect(summary.income).toBe(2500); // los ingresos del mes siguen siendo todos
    });

    it("busca la nómina solo entre las categorías de nómina y hasta el final del mes consultado", async () => {
      simulate({ incomeCategories: ["Nómina", "Bizum", "salario"], payroll: { amount: 1800, date: new Date(2026, 7, 28) }, monthIncome: 0 });

      await getBudgetSummary(1, 9, 2026);

      const args = prismaMock.transaction.findFirst.mock.calls[0][0];
      expect(args.where.category).toEqual({ in: ["Nómina", "salario"] });
      expect(args.where.date).toEqual({ lte: endOfMonth(new Date(2026, 8, 1)) });
      expect(args.orderBy).toEqual([{ date: "desc" }, { createdAt: "desc" }]);
    });

    it("una nómina de un mes anterior sigue valiendo como base", async () => {
      simulate({ incomeCategories: ["Nómina"], payroll: { amount: 1800, date: new Date(2026, 7, 28) }, monthIncome: 0 });

      const summary = await getBudgetSummary(1, 9, 2026);

      expect(summary.budgetBase.source).toBe("nomina");
      expect(summary.categories.find((c) => c.name === "Casa")?.budget).toBe(540);
    });

    it("sin ninguna nómina, el máximo sale de los ingresos del mes", async () => {
      simulate({ incomeCategories: ["Bizum"], payroll: null, monthIncome: 1000 });

      const summary = await getBudgetSummary(1, 10, 2026);

      expect(prismaMock.transaction.findFirst).not.toHaveBeenCalled();
      expect(summary.budgetBase).toEqual({ source: "ingresos", amount: 1000, date: null });
      expect(summary.categories.find((c) => c.name === "Casa")?.budget).toBe(300);
      expect(summary.totalBudget).toBe(450);
    });
  });
});
