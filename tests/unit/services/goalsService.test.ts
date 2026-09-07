jest.mock("../../../src/config/database", () => ({
  prisma: {
    goal: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    goalProgress: { create: jest.fn(), findMany: jest.fn() },
  },
}));

import { prisma } from "../../../src/config/database";
import * as goalsService from "../../../src/services/goalsService";
import { computeGoalRisk } from "../../../src/services/goalsService";
import { ForbiddenError, NotFoundError } from "../../../src/utils/errorHandler";

const prismaMock = prisma as unknown as {
  goal: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock; findMany: jest.Mock; count: jest.Mock };
  goalProgress: { create: jest.Mock; findMany: jest.Mock };
};

describe("goalsService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createGoal", () => {
    it("calcula periodEnd como fin de semana cuando period=weekly y no se indica", async () => {
      prismaMock.goal.create.mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data }));

      await goalsService.createGoal(1, { title: "Ejercicio", period: "weekly", targetValue: 5 });

      const dataArg = prismaMock.goal.create.mock.calls[0][0].data;
      expect(dataArg.periodStart).toBeInstanceOf(Date);
      expect(dataArg.periodEnd).toBeInstanceOf(Date);
      expect(dataArg.periodEnd.getTime()).toBeGreaterThan(dataArg.periodStart.getTime());
    });

    it("calcula periodEnd como fin de año cuando period=annual y no se indica", async () => {
      prismaMock.goal.create.mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data }));

      await goalsService.createGoal(1, { title: "Leer 12 libros", period: "annual", targetValue: 12 });

      const dataArg = prismaMock.goal.create.mock.calls[0][0].data;
      expect(dataArg.periodEnd.getUTCMonth()).toBe(11); // diciembre
      expect(dataArg.periodEnd.getUTCFullYear()).toBe(dataArg.periodStart.getUTCFullYear());
      expect(dataArg.periodEnd.getTime()).toBeGreaterThan(dataArg.periodStart.getTime());
    });

    it("respeta periodEnd explícito si se indica", async () => {
      prismaMock.goal.create.mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data }));
      const explicitEnd = "2026-12-31T00:00:00.000Z";

      await goalsService.createGoal(1, {
        title: "Meta anual",
        period: "monthly",
        targetValue: 12,
        periodEnd: explicitEnd,
      });

      const dataArg = prismaMock.goal.create.mock.calls[0][0].data;
      expect(dataArg.periodEnd.toISOString()).toBe(explicitEnd);
    });
  });

  describe("registerProgress", () => {
    const existingGoal = {
      id: 1,
      userId: 1,
      targetValue: 3,
      currentValue: 2,
      completed: false,
      bonusPoints: 25,
    };

    it("marca la meta como completada al alcanzar targetValue y devuelve bonusPointsAwarded", async () => {
      prismaMock.goal.findUnique.mockResolvedValue(existingGoal);
      prismaMock.goalProgress.create.mockResolvedValue({ id: 10, value: 1 });
      prismaMock.goal.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...existingGoal, ...data })
      );

      const result = await goalsService.registerProgress(1, 1, { value: 1 });

      expect(result.goal.currentValue).toBe(3);
      expect(result.goal.completed).toBe(true);
      expect(result.justCompleted).toBe(true);
      expect(result.bonusPointsAwarded).toBe(25);
    });

    it("no vuelve a otorgar bonusPoints si la meta ya estaba completada", async () => {
      const alreadyCompleted = { ...existingGoal, currentValue: 3, completed: true };
      prismaMock.goal.findUnique.mockResolvedValue(alreadyCompleted);
      prismaMock.goalProgress.create.mockResolvedValue({ id: 11, value: 1 });
      prismaMock.goal.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...alreadyCompleted, ...data })
      );

      const result = await goalsService.registerProgress(1, 1, { value: 1 });

      expect(result.justCompleted).toBe(false);
      expect(result.bonusPointsAwarded).toBe(0);
    });

    it("lanza NotFoundError si la meta no existe", async () => {
      prismaMock.goal.findUnique.mockResolvedValue(null);

      await expect(goalsService.registerProgress(1, 999, { value: 1 })).rejects.toThrow(NotFoundError);
    });

    it("lanza ForbiddenError si la meta pertenece a otro usuario", async () => {
      prismaMock.goal.findUnique.mockResolvedValue({ ...existingGoal, userId: 2 });

      await expect(goalsService.registerProgress(1, 1, { value: 1 })).rejects.toThrow(ForbiddenError);
    });
  });

  describe("getGoalAnalytics", () => {
    it("calcula percentComplete y streakDays a partir del progreso reciente", async () => {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      const goal = {
        id: 1,
        userId: 1,
        targetValue: 10,
        currentValue: 4,
        completed: false,
        periodStart: new Date(today.getFullYear(), 0, 1),
        periodEnd: new Date(today.getFullYear(), 11, 31),
      };

      prismaMock.goal.findUnique.mockResolvedValue(goal);
      prismaMock.goalProgress.findMany.mockResolvedValue([
        { date: today, value: 2 },
        { date: yesterday, value: 2 },
      ]);

      const analytics = await goalsService.getGoalAnalytics(1, 1);

      expect(analytics.percentComplete).toBe(40);
      expect(analytics.streakDays).toBe(2);
      expect(analytics.completed).toBe(false);
    });

    it("percentComplete nunca supera 100 aunque currentValue exceda targetValue", async () => {
      const goal = {
        id: 1,
        userId: 1,
        targetValue: 5,
        currentValue: 8,
        completed: true,
        periodStart: new Date(2026, 0, 1),
        periodEnd: new Date(2026, 11, 31),
      };
      prismaMock.goal.findUnique.mockResolvedValue(goal);
      prismaMock.goalProgress.findMany.mockResolvedValue([]);

      const analytics = await goalsService.getGoalAnalytics(1, 1);

      expect(analytics.percentComplete).toBe(100);
    });
  });

  describe("listGoals (paginación)", () => {
    it("pagina con skip/take y retorna el total real, no el tamaño de la página", async () => {
      prismaMock.goal.findMany.mockResolvedValue([{ id: 3 }, { id: 4 }]);
      prismaMock.goal.count.mockResolvedValue(7);

      const result = await goalsService.listGoals(1, "active", 2, 2);

      expect(prismaMock.goal.findMany.mock.calls[0][0]).toMatchObject({ skip: 2, take: 2 });
      expect(result.goals).toHaveLength(2);
      expect(result.pagination).toEqual({ page: 2, limit: 2, total: 7, pages: 4 });
    });

    it("filtra por completed según el status pedido", async () => {
      prismaMock.goal.findMany.mockResolvedValue([]);
      prismaMock.goal.count.mockResolvedValue(0);

      await goalsService.listGoals(1, "completed", 1, 20);
      expect(prismaMock.goal.findMany.mock.calls[0][0].where.completed).toBe(true);

      await goalsService.listGoals(1, "all", 1, 20);
      expect(prismaMock.goal.findMany.mock.calls[1][0].where.completed).toBeUndefined();
    });

    it("'active' excluye tanto completadas como expiradas", async () => {
      prismaMock.goal.findMany.mockResolvedValue([]);
      prismaMock.goal.count.mockResolvedValue(0);

      await goalsService.listGoals(1, "active", 1, 20);

      expect(prismaMock.goal.findMany.mock.calls[0][0].where).toMatchObject({
        completed: false,
        expired: false,
      });
    });

    it("'expired' filtra solo por expired:true, sin tocar completed", async () => {
      prismaMock.goal.findMany.mockResolvedValue([]);
      prismaMock.goal.count.mockResolvedValue(0);

      await goalsService.listGoals(1, "expired", 1, 20);

      const where = prismaMock.goal.findMany.mock.calls[0][0].where;
      expect(where.expired).toBe(true);
      expect(where.completed).toBeUndefined();
    });
  });

  describe("createGoal — autoRenew", () => {
    it("por defecto crea la meta con autoRenew=true", async () => {
      prismaMock.goal.create.mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data }));

      await goalsService.createGoal(1, { title: "Leer", period: "weekly", targetValue: 3 });

      expect(prismaMock.goal.create.mock.calls[0][0].data.autoRenew).toBe(true);
    });

    it("respeta autoRenew:false si se indica explícitamente", async () => {
      prismaMock.goal.create.mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data }));

      await goalsService.createGoal(1, {
        title: "Meta puntual",
        period: "monthly",
        targetValue: 1,
        autoRenew: false,
      });

      expect(prismaMock.goal.create.mock.calls[0][0].data.autoRenew).toBe(false);
    });
  });

  describe("computeGoalRisk", () => {
    const period = { periodStart: new Date(2026, 0, 1), periodEnd: new Date(2026, 0, 31) }; // enero, 30 días

    it("no está en riesgo si el ritmo actual alcanza para completar a tiempo", () => {
      const now = new Date(2026, 0, 16); // día 15 de 30, mitad del periodo
      const goal = { targetValue: 30, currentValue: 15, completed: false, ...period };

      const risk = computeGoalRisk(goal, now);

      expect(risk.atRisk).toBe(false);
    });

    it("está en riesgo si el ritmo actual es muy inferior al necesario", () => {
      const now = new Date(2026, 0, 16); // mitad del periodo
      const goal = { targetValue: 30, currentValue: 2, completed: false, ...period }; // muy por detrás

      const risk = computeGoalRisk(goal, now);

      expect(risk.atRisk).toBe(true);
    });

    it("una meta completada nunca está en riesgo, sin importar el ritmo", () => {
      const now = new Date(2026, 0, 16);
      const goal = { targetValue: 30, currentValue: 0, completed: true, ...period };

      const risk = computeGoalRisk(goal, now);

      expect(risk.atRisk).toBe(false);
    });

    it("una meta ya vencida (daysRemaining=0) no se marca atRisk (ya no hay nada que hacer)", () => {
      const now = new Date(2026, 1, 5); // después de periodEnd
      const goal = { targetValue: 30, currentValue: 2, completed: false, ...period };

      const risk = computeGoalRisk(goal, now);

      expect(risk.daysRemaining).toBe(0);
      expect(risk.atRisk).toBe(false);
    });
  });
});
