jest.mock("../../../src/config/database", () => ({
  prisma: {
    event: { findMany: jest.fn() },
    eventException: { findMany: jest.fn() },
    goal: { findMany: jest.fn() },
    task: { findMany: jest.fn() },
    transaction: { findMany: jest.fn() },
    budgetCategory: { findMany: jest.fn() },
    notification: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

// El cálculo del presupuesto ya tiene sus propios tests (budgetService.test.ts): aquí solo importa qué hace
// createBudgetAlerts con su resultado.
jest.mock("../../../src/services/budgetService", () => ({ getBudgetSummary: jest.fn() }));

import { prisma } from "../../../src/config/database";
import * as notificationService from "../../../src/services/notificationService";
import { getBudgetSummary } from "../../../src/services/budgetService";
import { ForbiddenError, NotFoundError } from "../../../src/utils/errorHandler";

const prismaMock = prisma as unknown as {
  event: { findMany: jest.Mock };
  eventException: { findMany: jest.Mock };
  goal: { findMany: jest.Mock };
  task: { findMany: jest.Mock };
  transaction: { findMany: jest.Mock };
  budgetCategory: { findMany: jest.Mock };
  notification: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    count: jest.Mock;
    createMany: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    delete: jest.Mock;
  };
};

describe("notificationService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.eventException.findMany.mockResolvedValue([]); // sin excepciones salvo que un test diga lo contrario
  });

  describe("createEventReminders", () => {
    const now = new Date("2026-08-24T10:00:00.000Z");

    it("crea un recordatorio para un evento no-recurrente cuya antelación configurada (30 min) cae ahora", async () => {
      prismaMock.event.findMany
        .mockResolvedValueOnce([
          { id: 1, userId: 7, title: "Dentista", startTime: new Date("2026-08-24T10:30:00.000Z"), reminderMinutesBefore: [30] },
        ])
        .mockResolvedValueOnce([]); // sin plantillas recurrentes
      prismaMock.notification.findMany.mockResolvedValue([]); // sin duplicados previos

      const created = await notificationService.createEventReminders(now);

      expect(created).toBe(1);
      expect(prismaMock.notification.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            userId: 7,
            type: "event_reminder",
            relatedId: 1,
            occurrenceAt: new Date("2026-08-24T10:30:00.000Z"),
            offsetMinutesBefore: 30,
            title: "Evento en 30 minutos",
          }),
        ],
      });
    });

    it("un evento con varias antelaciones configuradas genera un aviso independiente por cada una que caiga en su ventana", async () => {
      prismaMock.event.findMany
        .mockResolvedValueOnce([
          {
            id: 1,
            userId: 7,
            title: "Revisión anual",
            // 15 min antes cae ahora mismo (10:00); 1 día antes ya pasó (era ayer a las 10:15) — solo el de 15 min debería dispararse.
            startTime: new Date("2026-08-24T10:15:00.000Z"),
            reminderMinutesBefore: [15, 1440],
          },
        ])
        .mockResolvedValueOnce([]);
      prismaMock.notification.findMany.mockResolvedValue([]);

      const created = await notificationService.createEventReminders(now);

      expect(created).toBe(1);
      expect(prismaMock.notification.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ offsetMinutesBefore: 15, title: "Evento en 15 minutos" })],
      });
    });

    it("no duplica un recordatorio ya creado para la misma ocurrencia y la misma antelación", async () => {
      prismaMock.event.findMany
        .mockResolvedValueOnce([
          { id: 1, userId: 7, title: "Dentista", startTime: new Date("2026-08-24T10:30:00.000Z"), reminderMinutesBefore: [30] },
        ])
        .mockResolvedValueOnce([]);
      prismaMock.notification.findMany.mockResolvedValue([
        { relatedId: 1, occurrenceAt: new Date("2026-08-24T10:30:00.000Z"), offsetMinutesBefore: 30 },
      ]);

      const created = await notificationService.createEventReminders(now);

      expect(created).toBe(0);
      expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
    });

    it("SÍ crea el aviso de una antelación distinta aunque ya exista uno para la misma ocurrencia", async () => {
      prismaMock.event.findMany
        .mockResolvedValueOnce([
          { id: 1, userId: 7, title: "Dentista", startTime: new Date("2026-08-24T10:30:00.000Z"), reminderMinutesBefore: [30] },
        ])
        .mockResolvedValueOnce([]);
      // Ya existe un aviso de 15 min para esta ocurrencia, pero el que toca ahora es el de 30 min.
      prismaMock.notification.findMany.mockResolvedValue([
        { relatedId: 1, occurrenceAt: new Date("2026-08-24T10:30:00.000Z"), offsetMinutesBefore: 15 },
      ]);

      const created = await notificationService.createEventReminders(now);

      expect(created).toBe(1);
    });

    it("crea un recordatorio para la ocurrencia virtual de un evento recurrente", async () => {
      prismaMock.event.findMany
        .mockResolvedValueOnce([]) // sin eventos no-recurrentes en la ventana
        .mockResolvedValueOnce([
          {
            id: 9,
            userId: 3,
            title: "Gimnasio semanal",
            isRecurring: true,
            recurringPattern: "weekly",
            startTime: new Date("2026-08-17T10:30:00.000Z"), // semana anterior
            endTime: new Date("2026-08-17T11:30:00.000Z"),
            reminderMinutesBefore: [30],
          },
        ]);
      prismaMock.notification.findMany.mockResolvedValue([]);

      const created = await notificationService.createEventReminders(now);

      expect(created).toBe(1);
      const dataArg = prismaMock.notification.createMany.mock.calls[0][0].data[0];
      expect(dataArg.relatedId).toBe(9);
      expect(dataArg.occurrenceAt.toISOString()).toBe("2026-08-24T10:30:00.000Z"); // +1 semana
    });

    it("una ocurrencia recurrente cancelada (excepción) no genera recordatorio", async () => {
      prismaMock.event.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          id: 9,
          userId: 3,
          title: "Gimnasio semanal",
          isRecurring: true,
          recurringPattern: "weekly",
          startTime: new Date("2026-08-17T10:30:00.000Z"),
          endTime: new Date("2026-08-17T11:30:00.000Z"),
          reminderMinutesBefore: [30],
        },
      ]);
      prismaMock.eventException.findMany.mockResolvedValue([
        { eventId: 9, originalStartTime: new Date("2026-08-24T10:30:00.000Z"), status: "cancelled" },
      ]);
      prismaMock.notification.findMany.mockResolvedValue([]);

      const created = await notificationService.createEventReminders(now);

      expect(created).toBe(0);
      expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
    });

    it("no crea nada si no hay eventos ni plantillas en la ventana", async () => {
      prismaMock.event.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const created = await notificationService.createEventReminders(now);

      expect(created).toBe(0);
      expect(prismaMock.notification.findMany).not.toHaveBeenCalled(); // corta antes de consultar duplicados
    });
  });

  describe("createGoalRiskAlerts", () => {
    const now = new Date(2026, 0, 16); // mitad de un periodo de enero

    it("crea una alerta para una meta incompleta y en riesgo", async () => {
      prismaMock.goal.findMany.mockResolvedValue([
        {
          id: 1,
          userId: 5,
          title: "Leer 30 días",
          targetValue: 30,
          currentValue: 1, // muy por detrás
          completed: false,
          periodStart: new Date(2026, 0, 1),
          periodEnd: new Date(2026, 0, 31),
        },
      ]);
      prismaMock.notification.findMany.mockResolvedValue([]);

      const created = await notificationService.createGoalRiskAlerts(now);

      expect(created).toBe(1);
      expect(prismaMock.notification.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ userId: 5, type: "goal_at_risk", relatedId: 1 })],
      });
    });

    it("no crea una alerta duplicada si ya se avisó HOY, aunque esa alerta ya esté leída", async () => {
      // A propósito: antes solo desduplicaba por "sin leer", así que en cuanto el usuario la
      // leía volvía a avisar en el siguiente tick del cron (cada 5 min) — de ahí el spam que
      // reportó el usuario. Ahora desduplica por día, se lea o no la de hoy.
      const atRiskGoal = {
        id: 1,
        userId: 5,
        title: "Leer 30 días",
        targetValue: 30,
        currentValue: 1,
        completed: false,
        periodStart: new Date(2026, 0, 1),
        periodEnd: new Date(2026, 0, 31),
      };
      prismaMock.goal.findMany.mockResolvedValue([atRiskGoal]);
      prismaMock.notification.findMany.mockResolvedValue([{ relatedId: 1 }]);

      const created = await notificationService.createGoalRiskAlerts(now);

      expect(created).toBe(0);
      expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
    });

    it("sí crea una alerta nueva si la última fue un día distinto", async () => {
      const atRiskGoal = {
        id: 1,
        userId: 5,
        title: "Leer 30 días",
        targetValue: 30,
        currentValue: 1,
        completed: false,
        periodStart: new Date(2026, 0, 1),
        periodEnd: new Date(2026, 0, 31),
      };
      prismaMock.goal.findMany.mockResolvedValue([atRiskGoal]);
      // Ninguna alerta con occurrenceAt = hoy (el mock de findMany simula que la query filtrada
      // por el día de hoy no devuelve la de ayer) — como si ya hubiera una de ayer, pero no de hoy.
      prismaMock.notification.findMany.mockResolvedValue([]);

      const created = await notificationService.createGoalRiskAlerts(now);

      // Se calcula igual que la propia implementación (startOfUtcDay) en vez de un literal
      // aparte, para que el test no dependa de en qué zona horaria corra la máquina de CI.
      const expectedDayBucket = new Date(now);
      expectedDayBucket.setUTCHours(0, 0, 0, 0);

      expect(created).toBe(1);
      expect(prismaMock.notification.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ relatedId: 1, occurrenceAt: expectedDayBucket })],
      });
    });

    it("no crea alertas para metas que van al ritmo esperado", async () => {
      prismaMock.goal.findMany.mockResolvedValue([
        {
          id: 2,
          userId: 5,
          title: "Al día",
          targetValue: 30,
          currentValue: 15, // exactamente al ritmo esperado a mitad de mes
          completed: false,
          periodStart: new Date(2026, 0, 1),
          periodEnd: new Date(2026, 0, 31),
        },
      ]);

      const created = await notificationService.createGoalRiskAlerts(now);

      expect(created).toBe(0);
      expect(prismaMock.notification.findMany).not.toHaveBeenCalled(); // corta antes de buscar duplicados
    });
  });

  describe("createTaskDueReminders", () => {
    const now = new Date("2026-08-27T10:00:00.000Z");

    it("crea un aviso para una tarea no completada que vence dentro de 24h", async () => {
      prismaMock.task.findMany.mockResolvedValue([
        { id: 1, userId: 7, title: "Entregar informe", status: "todo", dueDate: new Date("2026-08-27T18:00:00.000Z") },
      ]);
      prismaMock.notification.findMany.mockResolvedValue([]);

      const created = await notificationService.createTaskDueReminders(now);

      expect(created).toBe(1);
      expect(prismaMock.notification.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ userId: 7, type: "task_due", relatedId: 1, title: "Tarea próxima a vencer" })],
      });
    });

    it("marca como 'vencida' una tarea cuya fecha límite ya pasó", async () => {
      prismaMock.task.findMany.mockResolvedValue([
        { id: 2, userId: 7, title: "Pagar factura", status: "todo", dueDate: new Date("2026-08-26T10:00:00.000Z") },
      ]);
      prismaMock.notification.findMany.mockResolvedValue([]);

      await notificationService.createTaskDueReminders(now);

      expect(prismaMock.notification.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ title: "Tarea vencida" })],
      });
    });

    it("no crea un aviso duplicado si ya se avisó HOY, aunque ese aviso ya esté leído", async () => {
      // A propósito: antes solo desduplicaba por "sin leer", así que en cuanto el usuario lo
      // leía volvía a avisar en el siguiente tick del cron (cada 5 min) — de ahí el spam que
      // reportó el usuario. Ahora desduplica por día, se lea o no el de hoy.
      prismaMock.task.findMany.mockResolvedValue([
        { id: 1, userId: 7, title: "Entregar informe", status: "todo", dueDate: new Date("2026-08-27T18:00:00.000Z") },
      ]);
      prismaMock.notification.findMany.mockResolvedValue([{ relatedId: 1 }]);

      const created = await notificationService.createTaskDueReminders(now);

      expect(created).toBe(0);
      expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
    });

    it("sí crea un aviso nuevo si el último fue un día distinto", async () => {
      prismaMock.task.findMany.mockResolvedValue([
        { id: 1, userId: 7, title: "Entregar informe", status: "todo", dueDate: new Date("2026-08-27T18:00:00.000Z") },
      ]);
      // Ninguna notificación con occurrenceAt = hoy (el mock de findMany simula que la query
      // filtrada por el día de hoy no devuelve la de ayer) — como si ya hubiera una de ayer,
      // pero no de hoy.
      prismaMock.notification.findMany.mockResolvedValue([]);

      const created = await notificationService.createTaskDueReminders(now);

      // Se calcula igual que la propia implementación (startOfUtcDay) en vez de un literal
      // aparte, para que el test no dependa de en qué zona horaria corra la máquina de CI.
      const expectedDayBucket = new Date(now);
      expectedDayBucket.setUTCHours(0, 0, 0, 0);

      expect(created).toBe(1);
      expect(prismaMock.notification.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ relatedId: 1, occurrenceAt: expectedDayBucket })],
      });
    });

    it("no crea nada si no hay tareas con fecha límite próxima", async () => {
      prismaMock.task.findMany.mockResolvedValue([]);

      const created = await notificationService.createTaskDueReminders(now);

      expect(created).toBe(0);
      expect(prismaMock.notification.findMany).not.toHaveBeenCalled();
    });
  });

  describe("listNotifications / getUnreadCount", () => {
    it("filtra por read:false cuando unreadOnly=true", async () => {
      prismaMock.notification.findMany.mockResolvedValue([]);
      prismaMock.notification.count.mockResolvedValue(0);

      await notificationService.listNotifications(1, { unreadOnly: true, page: 1, limit: 20 });

      expect(prismaMock.notification.findMany.mock.calls[0][0].where).toEqual({ userId: 1, read: false });
    });

    it("getUnreadCount cuenta solo las no leídas del usuario", async () => {
      prismaMock.notification.count.mockResolvedValue(4);

      const result = await notificationService.getUnreadCount(1);

      expect(result).toEqual({ unreadCount: 4 });
      expect(prismaMock.notification.count).toHaveBeenCalledWith({ where: { userId: 1, read: false } });
    });
  });

  describe("markAsRead / deleteNotification (ownership)", () => {
    it("lanza NotFoundError si la notificación no existe", async () => {
      prismaMock.notification.findUnique.mockResolvedValue(null);
      await expect(notificationService.markAsRead(1, 999)).rejects.toThrow(NotFoundError);
    });

    it("lanza ForbiddenError si la notificación es de otro usuario", async () => {
      prismaMock.notification.findUnique.mockResolvedValue({ id: 1, userId: 2 });
      await expect(notificationService.deleteNotification(1, 1)).rejects.toThrow(ForbiddenError);
    });

    it("marca como leída una notificación propia", async () => {
      prismaMock.notification.findUnique.mockResolvedValue({ id: 1, userId: 1, read: false });
      prismaMock.notification.update.mockResolvedValue({ id: 1, userId: 1, read: true });

      const result = await notificationService.markAsRead(1, 1);

      expect(result.read).toBe(true);
    });
  });
  describe("createBudgetAlerts", () => {
    const now = new Date(2026, 9, 15, 12, 0, 0); // 15 de octubre de 2026, hora local
    const monthStart = new Date(2026, 9, 1);
    const summaryMock = getBudgetSummary as jest.Mock;

    function category(id: number, name: string, budget: number, spent: number) {
      return { id, name, color: "primary", percent: 10, order: id, budget, spent };
    }

    it("no calcula nada si nadie ha tocado sus finanzas en los últimos minutos", async () => {
      prismaMock.transaction.findMany.mockResolvedValue([]);
      prismaMock.budgetCategory.findMany.mockResolvedValue([]);

      expect(await notificationService.createBudgetAlerts(now)).toBe(0);
      expect(summaryMock).not.toHaveBeenCalled();
      expect(prismaMock.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { updatedAt: { gte: new Date(now.getTime() - 15 * 60000) } }, distinct: ["userId"] })
      );
    });

    it("avisa de cada categoría que se pasa de su máximo en el mes en curso, una vez por usuario aunque haya tocado movimientos y categorías", async () => {
      prismaMock.transaction.findMany.mockResolvedValue([{ userId: 3 }]);
      prismaMock.budgetCategory.findMany.mockResolvedValue([{ userId: 3 }]);
      summaryMock.mockResolvedValue({
        categories: [category(1, "Comida", 200, 230), category(2, "Casa", 600, 600), category(3, "Otro", 0, 40)],
      });
      prismaMock.notification.findMany.mockResolvedValue([]);

      const created = await notificationService.createBudgetAlerts(now);

      expect(created).toBe(1);
      expect(summaryMock).toHaveBeenCalledTimes(1);
      expect(summaryMock).toHaveBeenCalledWith(3, 10, 2026);
      const data = prismaMock.notification.createMany.mock.calls[0][0].data;
      expect(data).toEqual([
        expect.objectContaining({ userId: 3, type: "budget_exceeded", title: "Presupuesto superado", relatedId: 1, occurrenceAt: monthStart }),
      ]);
      // Gastar justo el máximo (Casa) no es pasarse; una categoría con máximo 0 (Otro) no avisa.
      expect(data[0].message).toContain('"Comida"');
      expect(data[0].message).toContain("(115 %)");
    });

    it("no repite el aviso de una categoría que ya avisó este mes, se haya leído o no", async () => {
      prismaMock.transaction.findMany.mockResolvedValue([{ userId: 3 }]);
      prismaMock.budgetCategory.findMany.mockResolvedValue([]);
      summaryMock.mockResolvedValue({ categories: [category(1, "Comida", 200, 250)] });
      prismaMock.notification.findMany.mockResolvedValue([{ relatedId: 1 }]);

      expect(await notificationService.createBudgetAlerts(now)).toBe(0);
      expect(prismaMock.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { type: "budget_exceeded", relatedId: { in: [1] }, occurrenceAt: monthStart } })
      );
      expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
    });
  });
});
