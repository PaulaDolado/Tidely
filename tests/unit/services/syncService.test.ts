jest.mock("../../../src/config/database", () => ({
  prisma: {
    event: { findMany: jest.fn(), findUnique: jest.fn() },
    eventException: { findMany: jest.fn() },
    task: { findMany: jest.fn(), findUnique: jest.fn() },
    subtask: { findMany: jest.fn(), findUnique: jest.fn() },
    note: { findMany: jest.fn(), findUnique: jest.fn() },
    habit: { findMany: jest.fn(), findUnique: jest.fn() },
    habitLog: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
    syncTombstone: { findMany: jest.fn() },
  },
}));

jest.mock("../../../src/services/agendaService", () => ({
  createEvent: jest.fn(),
  updateEvent: jest.fn(),
  deleteEvent: jest.fn(),
  setEventException: jest.fn(),
  deleteEventException: jest.fn(),
}));

jest.mock("../../../src/services/plannerService", () => ({
  createTask: jest.fn(),
  updateTask: jest.fn(),
  deleteTask: jest.fn(),
  addSubtask: jest.fn(),
  updateSubtask: jest.fn(),
  deleteSubtask: jest.fn(),
}));

jest.mock("../../../src/services/notesService", () => ({
  createNote: jest.fn(),
  updateNote: jest.fn(),
  deleteNote: jest.fn(),
}));

jest.mock("../../../src/services/habitsService", () => ({
  createHabit: jest.fn(),
  updateHabit: jest.fn(),
  deleteHabit: jest.fn(),
  toggleHabitDay: jest.fn(),
}));

import { prisma } from "../../../src/config/database";
import * as agendaService from "../../../src/services/agendaService";
import * as plannerService from "../../../src/services/plannerService";
import * as notesService from "../../../src/services/notesService";
import * as habitsService from "../../../src/services/habitsService";
import * as syncService from "../../../src/services/syncService";
import { NotFoundError, ForbiddenError } from "../../../src/utils/errorHandler";

const prismaMock = prisma as unknown as {
  event: { findMany: jest.Mock; findUnique: jest.Mock };
  eventException: { findMany: jest.Mock };
  task: { findMany: jest.Mock; findUnique: jest.Mock };
  subtask: { findMany: jest.Mock; findUnique: jest.Mock };
  note: { findMany: jest.Mock; findUnique: jest.Mock };
  habit: { findMany: jest.Mock; findUnique: jest.Mock };
  habitLog: { findMany: jest.Mock; findUnique: jest.Mock; create: jest.Mock };
  syncTombstone: { findMany: jest.Mock };
};

function emptyBody() {
  return {
    events: { create: [], update: [] },
    eventExceptions: { upsert: [] },
    tasks: { create: [], update: [] },
    subtasks: { create: [], update: [] },
    notes: { create: [], update: [] },
    habits: { create: [], update: [] },
    habitLogs: { create: [] },
    deletes: [],
  };
}

describe("syncService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const model of ["event", "eventException", "task", "subtask", "note", "habit", "habitLog", "syncTombstone"] as const) {
      (prismaMock as never as Record<string, { findMany: jest.Mock }>)[model].findMany?.mockResolvedValue([]);
    }
  });

  describe("pull", () => {
    it("sin `since`, consulta desde el epoch (bootstrap) y captura serverTime al empezar", async () => {
      const before = Date.now();
      const result = await syncService.pull(1);
      const after = Date.now();

      expect(result.serverTime.getTime()).toBeGreaterThanOrEqual(before);
      expect(result.serverTime.getTime()).toBeLessThanOrEqual(after);
      const whereArg = prismaMock.event.findMany.mock.calls[0][0].where;
      expect(whereArg.updatedAt.gt.getTime()).toBe(0);
    });

    it("con `since`, filtra por updatedAt (o createdAt para HabitLog) mayor que el cursor dado", async () => {
      const since = new Date("2026-08-01T00:00:00.000Z");

      await syncService.pull(1, since);

      expect(prismaMock.task.findMany.mock.calls[0][0].where.updatedAt.gt).toEqual(since);
      expect(prismaMock.habitLog.findMany.mock.calls[0][0].where.createdAt.gt).toEqual(since);
      expect(prismaMock.syncTombstone.findMany.mock.calls[0][0].where.deletedAt.gt).toEqual(since);
    });

    it("agrupa lo devuelto por cada tipo en la respuesta", async () => {
      prismaMock.event.findMany.mockResolvedValue([{ id: 1 }]);
      prismaMock.syncTombstone.findMany.mockResolvedValue([{ id: 5, entityType: "task", entityId: 9 }]);

      const result = await syncService.pull(1);

      expect(result.events).toEqual([{ id: 1 }]);
      expect(result.tombstones).toEqual([{ id: 5, entityType: "task", entityId: 9 }]);
    });
  });

  describe("push — creación (localId → id)", () => {
    it("crea un evento y devuelve el mapeo localId→id, sin reenviar localId al servicio", async () => {
      (agendaService.createEvent as jest.Mock).mockResolvedValue({ id: 42 });

      const result = await syncService.push(1, {
        ...emptyBody(),
        events: { create: [{ localId: "local-1", title: "X", categoryId: 5 }], update: [] },
      });

      expect(agendaService.createEvent).toHaveBeenCalledWith(1, { title: "X", categoryId: 5 });
      expect(result.idMappings).toEqual([{ entityType: "event", localId: "local-1", id: 42 }]);
    });

    it("crea una subtarea y, si venía marcada como completada, la completa en un segundo paso", async () => {
      (plannerService.addSubtask as jest.Mock).mockResolvedValue({ id: 7 });

      await syncService.push(1, {
        ...emptyBody(),
        subtasks: { create: [{ localId: "local-2", taskId: 3, title: "Sub", completed: true }], update: [] },
      });

      expect(plannerService.addSubtask).toHaveBeenCalledWith(1, 3, "Sub");
      expect(plannerService.updateSubtask).toHaveBeenCalledWith(1, 3, 7, { completed: true });
    });

    it("no llama a updateSubtask si la subtarea creada no venía completada", async () => {
      (plannerService.addSubtask as jest.Mock).mockResolvedValue({ id: 8 });

      await syncService.push(1, {
        ...emptyBody(),
        subtasks: { create: [{ localId: "local-3", taskId: 3, title: "Sub 2" }], update: [] },
      });

      expect(plannerService.updateSubtask).not.toHaveBeenCalled();
    });

    it("crea una nota y, si venía marcada como hecha, la marca en un segundo paso", async () => {
      (notesService.createNote as jest.Mock).mockResolvedValue({ id: 9 });

      await syncService.push(1, {
        ...emptyBody(),
        notes: { create: [{ localId: "local-4", content: "Hecha offline", checked: true }], update: [] },
      });

      expect(notesService.createNote).toHaveBeenCalledWith(1, "Hecha offline");
      expect(notesService.updateNote).toHaveBeenCalledWith(1, 9, { checked: true });
    });
  });

  describe("push — edición (last-write-wins)", () => {
    it("aplica la edición si clientUpdatedAt es más reciente que el updatedAt actual del servidor", async () => {
      prismaMock.task.findUnique.mockResolvedValue({ userId: 1, updatedAt: new Date("2026-08-01T00:00:00.000Z") });

      const result = await syncService.push(1, {
        ...emptyBody(),
        tasks: { create: [], update: [{ id: 10, clientUpdatedAt: "2026-08-02T00:00:00.000Z", title: "Nuevo" }] },
      });

      expect(plannerService.updateTask).toHaveBeenCalledWith(1, 10, { title: "Nuevo" });
      expect(result.conflicts).toEqual([]);
    });

    it("descarta la edición y reporta conflicto si el servidor es más reciente", async () => {
      prismaMock.task.findUnique.mockResolvedValue({ userId: 1, updatedAt: new Date("2026-08-05T00:00:00.000Z") });

      const result = await syncService.push(1, {
        ...emptyBody(),
        tasks: { create: [], update: [{ id: 10, clientUpdatedAt: "2026-08-02T00:00:00.000Z", title: "Viejo" }] },
      });

      expect(plannerService.updateTask).not.toHaveBeenCalled();
      expect(result.conflicts).toEqual([{ entityType: "task", id: 10 }]);
    });

    it("si la fila ya no existe (borrada desde otro dispositivo), no falla ni es conflicto — se ignora", async () => {
      prismaMock.task.findUnique.mockResolvedValue(null);

      const result = await syncService.push(1, {
        ...emptyBody(),
        tasks: { create: [], update: [{ id: 999, clientUpdatedAt: "2026-08-02T00:00:00.000Z", title: "X" }] },
      });

      expect(plannerService.updateTask).not.toHaveBeenCalled();
      expect(result.conflicts).toEqual([]);
    });
  });

  describe("push — HabitLogs", () => {
    it("crea el registro solo si no existe ya para ese día (alta idempotente)", async () => {
      prismaMock.habitLog.findUnique.mockResolvedValue(null);
      prismaMock.habit.findUnique.mockResolvedValue({ id: 5, userId: 1 });

      await syncService.push(1, { ...emptyBody(), habitLogs: { create: [{ habitId: 5, date: "2026-08-10" }] } });

      expect(prismaMock.habitLog.create).toHaveBeenCalled();
    });

    it("no duplica si ya existía registro para ese hábito y día", async () => {
      prismaMock.habitLog.findUnique.mockResolvedValue({ id: 1 });

      await syncService.push(1, { ...emptyBody(), habitLogs: { create: [{ habitId: 5, date: "2026-08-10" }] } });

      expect(prismaMock.habitLog.create).not.toHaveBeenCalled();
    });

    it("ignora silenciosamente si el hábito no es del usuario", async () => {
      prismaMock.habitLog.findUnique.mockResolvedValue(null);
      prismaMock.habit.findUnique.mockResolvedValue({ id: 5, userId: 999 });

      await syncService.push(1, { ...emptyBody(), habitLogs: { create: [{ habitId: 5, date: "2026-08-10" }] } });

      expect(prismaMock.habitLog.create).not.toHaveBeenCalled();
    });
  });

  describe("push — deletes", () => {
    it("borra una excepción de evento con eventId + originalStartTime", async () => {
      await syncService.push(1, {
        ...emptyBody(),
        deletes: [{ entityType: "eventException", eventId: 3, originalStartTime: "2026-08-01T00:00:00.000Z" }],
      });

      expect(agendaService.deleteEventException).toHaveBeenCalledWith(1, 3, "2026-08-01T00:00:00.000Z");
    });

    it("borra una subtarea con su taskId", async () => {
      await syncService.push(1, { ...emptyBody(), deletes: [{ entityType: "subtask", id: 4, taskId: 3 }] });

      expect(plannerService.deleteSubtask).toHaveBeenCalledWith(1, 3, 4);
    });

    it("trata un NotFoundError al borrar como éxito idempotente (ya borrado desde otro dispositivo)", async () => {
      (plannerService.deleteTask as jest.Mock).mockRejectedValue(new NotFoundError("Tarea no encontrada"));

      const result = await syncService.push(1, { ...emptyBody(), deletes: [{ entityType: "task", id: 1 }] });

      expect(result).toBeDefined(); // no lanzó
    });

    it("propaga cualquier otro error al borrar (p.ej. ForbiddenError)", async () => {
      (plannerService.deleteTask as jest.Mock).mockRejectedValue(new ForbiddenError("No autorizado"));

      await expect(syncService.push(1, { ...emptyBody(), deletes: [{ entityType: "task", id: 1 }] })).rejects.toThrow(ForbiddenError);
    });

    it("desmarca un habitLog al borrarlo solo si existía", async () => {
      prismaMock.habitLog.findUnique.mockResolvedValue({ id: 1 });

      await syncService.push(1, { ...emptyBody(), deletes: [{ entityType: "habitLog", habitId: 5, date: "2026-08-10" }] });

      expect(habitsService.toggleHabitDay).toHaveBeenCalledWith(1, 5, "2026-08-10");
    });

    it("no llama a toggleHabitDay si el habitLog ya no existía", async () => {
      prismaMock.habitLog.findUnique.mockResolvedValue(null);

      await syncService.push(1, { ...emptyBody(), deletes: [{ entityType: "habitLog", habitId: 5, date: "2026-08-10" }] });

      expect(habitsService.toggleHabitDay).not.toHaveBeenCalled();
    });
  });
});
