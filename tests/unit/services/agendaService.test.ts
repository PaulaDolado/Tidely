jest.mock("../../../src/config/database", () => ({
  prisma: {
    event: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), delete: jest.fn() },
    eventException: { findMany: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
    // findOwnedCategory (eventCategoryService, la usa createEvent/updateEvent para comprobar el
    // categoryId antes de asignarlo) también pasa por este mismo `prisma` mockeado.
    eventCategory: { findUnique: jest.fn() },
    task: { findMany: jest.fn() },
    user: { findUnique: jest.fn() },
  },
}));

import { prisma } from "../../../src/config/database";
import * as agendaService from "../../../src/services/agendaService";
import { ForbiddenError, NotFoundError, ValidationError } from "../../../src/utils/errorHandler";

const prismaMock = prisma as unknown as {
  event: { findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock; delete: jest.Mock };
  eventException: { findMany: jest.Mock; upsert: jest.Mock; deleteMany: jest.Mock };
  eventCategory: { findUnique: jest.Mock };
  task: { findMany: jest.Mock };
  user: { findUnique: jest.Mock };
};

describe("agendaService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue({ timezone: "UTC" });
    prismaMock.eventException.findMany.mockResolvedValue([]); // sin excepciones salvo que un test diga lo contrario
  });

  describe("getDay", () => {
    it("filtra eventos entre el inicio y fin del día indicado (en UTC, la timezone del usuario mockeado)", async () => {
      prismaMock.event.findMany.mockResolvedValue([{ id: 1 }]);

      const result = await agendaService.getDay(1, "2026-08-24");

      const whereArg = prismaMock.event.findMany.mock.calls[0][0].where;
      expect(whereArg.startTime.gte.toISOString()).toBe("2026-08-24T00:00:00.000Z");
      expect(whereArg.endTime.lte.toISOString()).toBe("2026-08-24T23:59:59.999Z");
      expect(result.events).toHaveLength(1);
    });

    it("usa la timezone guardada del usuario, no la del servidor", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ timezone: "Europe/Madrid" });
      prismaMock.event.findMany.mockResolvedValue([]);

      const result = await agendaService.getDay(1, "2026-08-24");

      const whereArg = prismaMock.event.findMany.mock.calls[0][0].where;
      // Medianoche en Madrid en agosto (verano, UTC+2) = 22:00 UTC del día anterior.
      expect(whereArg.startTime.gte.toISOString()).toBe("2026-08-23T22:00:00.000Z");
      expect(result.timezone).toBe("Europe/Madrid");
    });

    it("cae de vuelta al timezone por defecto si el guardado en BD es inválido", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ timezone: "no-es-una-timezone-real" });
      prismaMock.event.findMany.mockResolvedValue([]);

      const result = await agendaService.getDay(1, "2026-08-24");

      expect(result.timezone).toBe("Europe/Madrid"); // DEFAULT_TIMEZONE
    });

    it("aplica el filtro por categoryId cuando se indica", async () => {
      prismaMock.event.findMany.mockResolvedValue([]);

      await agendaService.getDay(1, "2026-08-24", { categoryId: 3 });

      const whereArg = prismaMock.event.findMany.mock.calls[0][0].where;
      expect(whereArg.categoryId).toBe(3);
    });

    it("no incluye categoryId en el where cuando no se indica filtro", async () => {
      prismaMock.event.findMany.mockResolvedValue([]);

      await agendaService.getDay(1, "2026-08-24");

      const whereArg = prismaMock.event.findMany.mock.calls[0][0].where;
      expect(whereArg.categoryId).toBeUndefined();
    });
  });

  describe("getWeek con eventos recurrentes", () => {
    it("expande una plantilla recurrente cuya ocurrencia cae dentro de la semana pedida, aunque su startTime original sea de semanas atrás", async () => {
      const recurringTemplate = {
        id: 5,
        userId: 1,
        title: "Gym recurrente",
        type: "gym",
        isRecurring: true,
        recurringPattern: "weekly",
        startTime: new Date("2026-08-03T18:00:00.000Z"), // 3 semanas antes de la semana consultada
        endTime: new Date("2026-08-03T19:00:00.000Z"),
      };

      prismaMock.event.findMany.mockImplementation(({ where }) => {
        if (where.isRecurring === true) return Promise.resolve([recurringTemplate]);
        return Promise.resolve([]); // no hay eventos no-recurrentes esta semana
      });

      const result = await agendaService.getWeek(1, "2026-08-24");

      expect(result.events).toHaveLength(1);
      expect(result.events[0].isRecurringInstance).toBe(true);
      expect(result.events[0].startTime.toISOString()).toBe("2026-08-24T18:00:00.000Z");
      // la plantilla original no se modifica ni se duplica
      expect(recurringTemplate.startTime.toISOString()).toBe("2026-08-03T18:00:00.000Z");
    });

    it("no expande una plantilla cuyo recurringPattern no produce ninguna ocurrencia esa semana", async () => {
      const recurringTemplate = {
        id: 5,
        userId: 1,
        isRecurring: true,
        recurringPattern: "monthly",
        startTime: new Date("2026-08-03T18:00:00.000Z"),
        endTime: new Date("2026-08-03T19:00:00.000Z"),
      };

      prismaMock.event.findMany.mockImplementation(({ where }) => {
        if (where.isRecurring === true) return Promise.resolve([recurringTemplate]);
        return Promise.resolve([]);
      });

      // Semana siguiente a la original (Aug10-Aug16): la próxima ocurrencia "monthly" es Sep3, no cae aquí.
      const result = await agendaService.getWeek(1, "2026-08-10");

      expect(result.events).toHaveLength(0);
    });
  });

  describe("paginación", () => {
    it("aplica page/limit sobre el conjunto combinado de eventos y reporta el total real", async () => {
      const events = [1, 2, 3].map((n) => ({
        id: n,
        userId: 1,
        isRecurring: false,
        startTime: new Date(`2026-08-24T0${n}:00:00.000Z`),
        endTime: new Date(`2026-08-24T0${n}:30:00.000Z`),
      }));

      prismaMock.event.findMany.mockImplementation(({ where }) => {
        if (where.isRecurring === false) return Promise.resolve(events);
        return Promise.resolve([]);
      });

      const result = await agendaService.getDay(1, "2026-08-24", { page: 2, limit: 2 });

      expect(result.events).toHaveLength(1); // 3 eventos, página 2 de tamaño 2 → solo el 3º
      expect(result.events[0].id).toBe(3);
      expect(result.pagination).toEqual({ page: 2, limit: 2, total: 3, pages: 2 });
    });
  });

  describe("updateEvent / deleteEvent (ownership)", () => {
    it("lanza NotFoundError si el evento no existe", async () => {
      prismaMock.event.findUnique.mockResolvedValue(null);

      await expect(agendaService.updateEvent(1, 999, { title: "x" })).rejects.toThrow(NotFoundError);
    });

    it("lanza ForbiddenError si el evento pertenece a otro usuario", async () => {
      prismaMock.event.findUnique.mockResolvedValue({ id: 1, userId: 2 });

      await expect(agendaService.deleteEvent(1, 1)).rejects.toThrow(ForbiddenError);
    });

    it("permite actualizar un evento propio", async () => {
      prismaMock.event.findUnique.mockResolvedValue({ id: 1, userId: 1 });
      prismaMock.event.update.mockResolvedValue({ id: 1, userId: 1, title: "Nuevo" });

      const updated = await agendaService.updateEvent(1, 1, { title: "Nuevo" });

      expect(updated.title).toBe("Nuevo");
    });
  });

  describe("getMonth", () => {
    it("consulta eventos en el rango del mes completo", async () => {
      prismaMock.event.findMany.mockResolvedValue([]);

      const result = await agendaService.getMonth(1, "2026-08-15");

      const whereArg = prismaMock.event.findMany.mock.calls[0][0].where;
      expect(whereArg.startTime.gte.toISOString()).toBe("2026-08-01T00:00:00.000Z");
      expect(result.events).toEqual([]);
    });
  });

  describe("findEventsInRange con excepciones recurrentes", () => {
    it("aplica una excepción 'cancelled' a la ocurrencia de la semana consultada", async () => {
      const recurringTemplate = {
        id: 5,
        userId: 1,
        title: "Gym recurrente",
        type: "gym",
        isRecurring: true,
        recurringPattern: "weekly",
        startTime: new Date("2026-08-03T18:00:00.000Z"),
        endTime: new Date("2026-08-03T19:00:00.000Z"),
      };

      prismaMock.event.findMany.mockImplementation(({ where }: { where: { isRecurring: boolean } }) => {
        if (where.isRecurring === true) return Promise.resolve([recurringTemplate]);
        return Promise.resolve([]);
      });
      prismaMock.eventException.findMany.mockResolvedValue([
        { eventId: 5, originalStartTime: new Date("2026-08-24T18:00:00.000Z"), status: "cancelled" },
      ]);

      const result = await agendaService.getWeek(1, "2026-08-24");

      expect(result.events).toHaveLength(0);
    });

    it("aplica una excepción 'moved' con el horario nuevo", async () => {
      const recurringTemplate = {
        id: 5,
        userId: 1,
        title: "Gym recurrente",
        type: "gym",
        isRecurring: true,
        recurringPattern: "weekly",
        startTime: new Date("2026-08-03T18:00:00.000Z"),
        endTime: new Date("2026-08-03T19:00:00.000Z"),
      };

      prismaMock.event.findMany.mockImplementation(({ where }: { where: { isRecurring: boolean } }) => {
        if (where.isRecurring === true) return Promise.resolve([recurringTemplate]);
        return Promise.resolve([]);
      });
      prismaMock.eventException.findMany.mockResolvedValue([
        {
          eventId: 5,
          originalStartTime: new Date("2026-08-24T18:00:00.000Z"),
          status: "moved",
          newStartTime: new Date("2026-08-26T09:00:00.000Z"),
          newEndTime: new Date("2026-08-26T10:00:00.000Z"),
        },
      ]);

      const result = await agendaService.getWeek(1, "2026-08-24");

      expect(result.events).toHaveLength(1);
      expect(result.events[0].startTime.toISOString()).toBe("2026-08-26T09:00:00.000Z");
      expect((result.events[0] as { isException?: boolean }).isException).toBe(true);
    });
  });

  describe("setEventException / deleteEventException", () => {
    it("rechaza crear una excepción sobre un evento no recurrente", async () => {
      prismaMock.event.findUnique.mockResolvedValue({ id: 1, userId: 1, isRecurring: false });

      await expect(
        agendaService.setEventException(1, 1, { originalStartTime: new Date(), action: "cancelled" })
      ).rejects.toThrow(ValidationError);
    });

    it("lanza ForbiddenError si el evento recurrente es de otro usuario", async () => {
      prismaMock.event.findUnique.mockResolvedValue({ id: 1, userId: 2, isRecurring: true });

      await expect(
        agendaService.setEventException(1, 1, { originalStartTime: new Date(), action: "cancelled" })
      ).rejects.toThrow(ForbiddenError);
    });

    it("crea una excepción 'moved' para un evento recurrente propio", async () => {
      prismaMock.event.findUnique.mockResolvedValue({ id: 1, userId: 1, isRecurring: true });
      prismaMock.eventException.upsert.mockResolvedValue({ id: 10, status: "moved" });

      const result = await agendaService.setEventException(1, 1, {
        originalStartTime: new Date("2026-08-24T18:00:00.000Z"),
        action: "moved",
        newStartTime: new Date("2026-08-25T18:00:00.000Z"),
        newEndTime: new Date("2026-08-25T19:00:00.000Z"),
      });

      expect(result.status).toBe("moved");
      expect(prismaMock.eventException.upsert).toHaveBeenCalled();
    });

    it("deleteEventException comprueba propiedad antes de borrar", async () => {
      prismaMock.event.findUnique.mockResolvedValue({ id: 1, userId: 2, isRecurring: true });

      await expect(agendaService.deleteEventException(1, 1, "2026-08-24T18:00:00.000Z")).rejects.toThrow(ForbiddenError);
      expect(prismaMock.eventException.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe("getFreeTime", () => {
    it("calcula los huecos libres del día y sugiere la tarea pendiente de mayor prioridad que encaje", async () => {
      prismaMock.event.findMany.mockResolvedValue([
        {
          id: 1,
          userId: 1,
          isRecurring: false,
          startTime: new Date("2026-08-24T10:00:00.000Z"),
          endTime: new Date("2026-08-24T11:00:00.000Z"),
        },
      ]);
      prismaMock.task.findMany.mockResolvedValue([
        { id: 1, title: "Tarea corta", status: "todo", priority: "low", estimatedMinutes: 30 },
        { id: 2, title: "Tarea importante", status: "todo", priority: "high", estimatedMinutes: 45 },
      ]);

      const result = await agendaService.getFreeTime(1, "2026-08-24");

      // Ventana 08:00-22:00 con un evento 10:00-11:00 → dos huecos: 08:00-10:00 y 11:00-22:00.
      expect(result.freeBlocks).toHaveLength(2);
      expect(result.freeBlocks[0].start.toISOString()).toBe("2026-08-24T08:00:00.000Z");
      expect(result.freeBlocks[0].end.toISOString()).toBe("2026-08-24T10:00:00.000Z");

      // La tarea de prioridad alta se sugiere primero (en el primer hueco), no la de menor prioridad.
      expect(result.suggestions[0].task.id).toBe(2);
    });

    it("no sugiere la misma tarea dos veces en huecos distintos", async () => {
      prismaMock.event.findMany.mockResolvedValue([]); // día libre: un único hueco 08:00-22:00
      prismaMock.task.findMany.mockResolvedValue([{ id: 1, title: "Única", status: "todo", priority: "medium", estimatedMinutes: 30 }]);

      const result = await agendaService.getFreeTime(1, "2026-08-24");

      expect(result.freeBlocks).toHaveLength(1);
      expect(result.suggestions).toHaveLength(1);
    });
  });
});
