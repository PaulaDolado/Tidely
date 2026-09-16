jest.mock("../../../src/config/database", () => ({
  prisma: {
    transaction: {
      aggregate: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findUnique: jest.fn(),
    },
    savingsGoal: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
  },
}));

import { prisma } from "../../../src/config/database";
import * as financeService from "../../../src/services/financeService";
import { ForbiddenError, NotFoundError } from "../../../src/utils/errorHandler";

const prismaMock = prisma as unknown as {
  transaction: {
    aggregate: jest.Mock;
    findMany: jest.Mock;
    groupBy: jest.Mock;
    create: jest.Mock;
  };
  savingsGoal: { findMany: jest.Mock; findUnique: jest.Mock; delete: jest.Mock };
};

describe("financeService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getMonthlyBalance", () => {
    it("calcula income, expense y balance a partir de los aggregate", async () => {
      prismaMock.savingsGoal.findMany.mockResolvedValue([]);
      prismaMock.transaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 1000 } }) // income
        .mockResolvedValueOnce({ _sum: { amount: 300 } }); // expense

      const result = await financeService.getMonthlyBalance(1, 8, 2026);

      expect(result).toEqual({ month: 8, year: 2026, income: 1000, expense: 300, balance: 700 });
    });

    it("trata _sum null (sin transacciones) como 0", async () => {
      prismaMock.savingsGoal.findMany.mockResolvedValue([]);
      prismaMock.transaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: null } })
        .mockResolvedValueOnce({ _sum: { amount: null } });

      const result = await financeService.getMonthlyBalance(1, 8, 2026);

      expect(result.income).toBe(0);
      expect(result.expense).toBe(0);
      expect(result.balance).toBe(0);
    });

    it("resta de Ingresos (y por tanto de Balance) lo aportado a metas de ahorro ese mes", async () => {
      prismaMock.savingsGoal.findMany.mockResolvedValue([{ category: "savings-kyoto" }]);
      prismaMock.transaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 1000 } }) // income real (nómina), sin la categoría de la meta
        .mockResolvedValueOnce({ _sum: { amount: 300 } }); // expense real
      prismaMock.transaction.groupBy.mockResolvedValue([{ type: "income", _sum: { amount: 150 } }]); // aportado a la meta

      const result = await financeService.getMonthlyBalance(1, 8, 2026);

      expect(result.income).toBe(850); // 1000 - 150
      expect(result.expense).toBe(300);
      expect(result.balance).toBe(550);
      // Ni el aggregate de income ni el de expense deben ver la categoría de la meta.
      expect(prismaMock.transaction.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ category: { notIn: ["savings-kyoto"] } }) })
      );
    });

    it("un retiro de una meta ese mes suma de vuelta a Ingresos/Balance", async () => {
      prismaMock.savingsGoal.findMany.mockResolvedValue([{ category: "savings-kyoto" }]);
      prismaMock.transaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 1000 } })
        .mockResolvedValueOnce({ _sum: { amount: 0 } });
      prismaMock.transaction.groupBy.mockResolvedValue([{ type: "expense", _sum: { amount: 150 } }]); // retirado de la meta

      const result = await financeService.getMonthlyBalance(1, 8, 2026);

      expect(result.income).toBe(1150); // 1000 - (-150)
      expect(result.balance).toBe(1150);
    });
  });

  describe("getAnnualBalance", () => {
    it("agrupa las transacciones por mes en una sola consulta", async () => {
      prismaMock.savingsGoal.findMany.mockResolvedValue([]);
      prismaMock.transaction.findMany.mockResolvedValue([
        { type: "income", amount: 1000, category: "salary", date: new Date(2026, 0, 15) },
        { type: "expense", amount: 200, category: "food", date: new Date(2026, 0, 20) },
        { type: "income", amount: 1000, category: "salary", date: new Date(2026, 1, 15) },
        { type: "expense", amount: 500, category: "food", date: new Date(2026, 5, 1) },
      ]);

      const result = await financeService.getAnnualBalance(1, 2026);

      expect(prismaMock.transaction.findMany).toHaveBeenCalledTimes(1);
      expect(result.income).toBe(2000);
      expect(result.expense).toBe(700);
      expect(result.balance).toBe(1300);
      expect(result.monthlyBreakdown).toHaveLength(12);
      expect(result.monthlyBreakdown[0]).toEqual({ month: 1, year: 2026, income: 1000, expense: 200, balance: 800 });
      expect(result.monthlyBreakdown[1].income).toBe(1000);
      expect(result.monthlyBreakdown[5].expense).toBe(500);
      expect(result.monthlyBreakdown[11].income).toBe(0);
    });

    it("resta de Ingresos lo aportado a metas de ahorro, mes a mes", async () => {
      prismaMock.savingsGoal.findMany.mockResolvedValue([{ category: "savings-kyoto" }]);
      prismaMock.transaction.findMany.mockResolvedValue([
        { type: "income", amount: 1000, category: "salary", date: new Date(2026, 0, 15) },
        { type: "income", amount: 150, category: "savings-kyoto", date: new Date(2026, 0, 20) }, // aporte a la meta
      ]);

      const result = await financeService.getAnnualBalance(1, 2026);

      expect(result.income).toBe(850);
      expect(result.balance).toBe(850);
      expect(result.monthlyBreakdown[0].income).toBe(850);
    });
  });

  describe("listSavingsGoals", () => {
    it("retorna [] sin consultar transacciones si el usuario no tiene metas de ahorro", async () => {
      prismaMock.savingsGoal.findMany.mockResolvedValue([]);

      const result = await financeService.listSavingsGoals(1);

      expect(result).toEqual([]);
      expect(prismaMock.transaction.groupBy).not.toHaveBeenCalled();
    });

    it("calcula currentAmount y progressPercent a partir de ingresos menos gastos de esa categoría", async () => {
      prismaMock.savingsGoal.findMany.mockResolvedValue([
        { id: 1, userId: 1, name: "Vacaciones", targetAmount: 200, category: "savings-vacation" },
      ]);
      prismaMock.transaction.groupBy.mockResolvedValue([
        { category: "savings-vacation", type: "income", _sum: { amount: 150 } },
        { category: "savings-vacation", type: "expense", _sum: { amount: 50 } },
      ]);

      const result = await financeService.listSavingsGoals(1);

      expect(result[0].currentAmount).toBe(100);
      expect(result[0].progressPercent).toBe(50);
    });

    it("progressPercent no supera 100 aunque currentAmount exceda targetAmount", async () => {
      prismaMock.savingsGoal.findMany.mockResolvedValue([
        { id: 1, userId: 1, name: "Meta", targetAmount: 100, category: "cat" },
      ]);
      prismaMock.transaction.groupBy.mockResolvedValue([
        { category: "cat", type: "income", _sum: { amount: 500 } },
      ]);

      const result = await financeService.listSavingsGoals(1);

      expect(result[0].currentAmount).toBe(500);
      expect(result[0].progressPercent).toBe(100);
    });

    it("currentAmount nunca es negativo aunque los gastos superen los ingresos", async () => {
      prismaMock.savingsGoal.findMany.mockResolvedValue([
        { id: 1, userId: 1, name: "Meta", targetAmount: 100, category: "cat" },
      ]);
      prismaMock.transaction.groupBy.mockResolvedValue([
        { category: "cat", type: "expense", _sum: { amount: 50 } },
      ]);

      const result = await financeService.listSavingsGoals(1);

      expect(result[0].currentAmount).toBe(0);
    });
  });

  describe("getAnalytics", () => {
    beforeEach(() => {
      prismaMock.savingsGoal.findMany.mockResolvedValue([]);
    });

    it("calcula topCategories del mes actual y monthlyTrend de 6 meses con una sola consulta", async () => {
      const reference = new Date(2026, 7, 1); // agosto 2026
      prismaMock.transaction.findMany.mockResolvedValue([
        { type: "expense", category: "food", amount: 300, date: new Date(2026, 7, 5) },
        { type: "expense", category: "transport", amount: 100, date: new Date(2026, 7, 10) },
        { type: "income", category: "salary", amount: 2000, date: new Date(2026, 7, 1) },
        // mes anterior, no debería contar para topCategories pero sí para monthlyTrend
        { type: "expense", category: "food", amount: 999, date: new Date(2026, 6, 5) },
      ]);

      const result = await financeService.getAnalytics(1, reference.getMonth() + 1, reference.getFullYear());

      expect(prismaMock.transaction.findMany).toHaveBeenCalledTimes(1);
      expect(result.topCategories).toEqual([
        { category: "food", total: 300 },
        { category: "transport", total: 100 },
      ]);
      expect(result.monthlyTrend).toHaveLength(6);

      const augustBucket = result.monthlyTrend.find((m) => m.month === 8 && m.year === 2026);
      expect(augustBucket?.income).toBe(2000);
      expect(augustBucket?.expense).toBe(400);

      const julyBucket = result.monthlyTrend.find((m) => m.month === 7 && m.year === 2026);
      expect(julyBucket?.expense).toBe(999);
    });

    it("limita topCategories a las 5 categorías con mayor gasto", async () => {
      const reference = new Date(2026, 7, 1);
      prismaMock.transaction.findMany.mockResolvedValue(
        ["a", "b", "c", "d", "e", "f"].map((cat, i) => ({
          type: "expense",
          category: cat,
          amount: (i + 1) * 10,
          date: new Date(2026, 7, 2),
        }))
      );

      const result = await financeService.getAnalytics(1, 8, 2026);

      expect(result.topCategories).toHaveLength(5);
      expect(result.topCategories[0]).toEqual({ category: "f", total: 60 });
    });

    it("resta de la tendencia de Ingresos lo aportado a metas de ahorro, y lo excluye del top de categorías", async () => {
      prismaMock.savingsGoal.findMany.mockResolvedValue([{ category: "savings-kyoto" }]);
      const reference = new Date(2026, 7, 1);
      prismaMock.transaction.findMany.mockResolvedValue([
        { type: "income", category: "salary", amount: 2000, date: new Date(2026, 7, 1) },
        { type: "income", category: "savings-kyoto", amount: 150, date: new Date(2026, 7, 5) },
        { type: "expense", category: "savings-kyoto", amount: 999, date: new Date(2026, 7, 6) }, // no debe colarse en topCategories
      ]);

      const result = await financeService.getAnalytics(1, reference.getMonth() + 1, reference.getFullYear());

      const augustBucket = result.monthlyTrend.find((m) => m.month === 8 && m.year === 2026);
      expect(augustBucket?.income).toBe(2849); // 2000 - (150 - 999)
      expect(result.topCategories).toEqual([]);
    });
  });

  describe("contributeToSavingsGoal", () => {
    const goal = { id: 1, userId: 1, name: "Kyoto", targetAmount: 500, category: "savings-kyoto" };

    it("crea un income cuando amount es positivo (aportar)", async () => {
      prismaMock.savingsGoal.findUnique.mockResolvedValue(goal);
      prismaMock.transaction.create.mockResolvedValue({});
      prismaMock.transaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 100 } }) // income tras el aporte
        .mockResolvedValueOnce({ _sum: { amount: 0 } }); // expense

      const result = await financeService.contributeToSavingsGoal(1, 1, 100);

      expect(prismaMock.transaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ type: "income", amount: 100, category: "savings-kyoto" }),
      });
      expect(result.currentAmount).toBe(100);
      expect(result.progressPercent).toBe(20);
    });

    it("crea un expense cuando amount es negativo (retirar/corregir)", async () => {
      prismaMock.savingsGoal.findUnique.mockResolvedValue(goal);
      prismaMock.transaction.create.mockResolvedValue({});
      prismaMock.transaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 200 } })
        .mockResolvedValueOnce({ _sum: { amount: 100 } });

      await financeService.contributeToSavingsGoal(1, 1, -100);

      expect(prismaMock.transaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ type: "expense", amount: 100, category: "savings-kyoto" }),
      });
    });

    it("lanza NotFoundError si la meta no existe", async () => {
      prismaMock.savingsGoal.findUnique.mockResolvedValue(null);
      await expect(financeService.contributeToSavingsGoal(1, 999, 100)).rejects.toThrow(NotFoundError);
      expect(prismaMock.transaction.create).not.toHaveBeenCalled();
    });

    it("lanza ForbiddenError si la meta es de otro usuario", async () => {
      prismaMock.savingsGoal.findUnique.mockResolvedValue({ ...goal, userId: 2 });
      await expect(financeService.contributeToSavingsGoal(1, 1, 100)).rejects.toThrow(ForbiddenError);
      expect(prismaMock.transaction.create).not.toHaveBeenCalled();
    });
  });

  describe("deleteSavingsGoal", () => {
    it("lanza ForbiddenError si la meta es de otro usuario", async () => {
      prismaMock.savingsGoal.findUnique.mockResolvedValue({ id: 1, userId: 2 });
      await expect(financeService.deleteSavingsGoal(1, 1)).rejects.toThrow(ForbiddenError);
      expect(prismaMock.savingsGoal.delete).not.toHaveBeenCalled();
    });

    it("elimina la meta propia", async () => {
      prismaMock.savingsGoal.findUnique.mockResolvedValue({ id: 1, userId: 1 });
      await financeService.deleteSavingsGoal(1, 1);
      expect(prismaMock.savingsGoal.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    });
  });
});
