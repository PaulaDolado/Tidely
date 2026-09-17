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
    transaction: { findMany: jest.fn(), findUnique: jest.fn() },
    savingsGoal: { findMany: jest.fn(), findUnique: jest.fn() },
    goal: { findMany: jest.fn(), findUnique: jest.fn() },
    goalProgress: { findMany: jest.fn(), findUnique: jest.fn() },
    project: { findMany: jest.fn(), findUnique: jest.fn() },
    projectTask: { findMany: jest.fn(), findUnique: jest.fn() },
    projectPage: { findMany: jest.fn(), findUnique: jest.fn() },
    schedule: { findMany: jest.fn(), findUnique: jest.fn() },
    scheduleRow: { findMany: jest.fn(), findUnique: jest.fn() },
    calendarLegendCategory: { findMany: jest.fn(), findUnique: jest.fn() },
    calendarDayMark: { findMany: jest.fn() },
    customPage: { findMany: jest.fn(), findUnique: jest.fn() },
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

jest.mock("../../../src/services/financeService", () => ({
  createTransaction: jest.fn(),
  updateTransaction: jest.fn(),
  deleteTransaction: jest.fn(),
  createSavingsGoal: jest.fn(),
  updateSavingsGoal: jest.fn(),
  deleteSavingsGoal: jest.fn(),
}));

jest.mock("../../../src/services/goalsService", () => ({
  createGoal: jest.fn(),
  updateGoal: jest.fn(),
  deleteGoal: jest.fn(),
  registerProgress: jest.fn(),
  updateProgress: jest.fn(),
  deleteProgress: jest.fn(),
}));

jest.mock("../../../src/services/projectsService", () => ({
  createProject: jest.fn(),
  updateProject: jest.fn(),
  deleteProject: jest.fn(),
  addTask: jest.fn(),
  updateTask: jest.fn(),
  setTaskCompleted: jest.fn(),
  deleteTask: jest.fn(),
  addPage: jest.fn(),
  updatePage: jest.fn(),
  deletePage: jest.fn(),
}));

jest.mock("../../../src/services/scheduleService", () => ({
  createSchedule: jest.fn(),
  updateSchedule: jest.fn(),
  deleteSchedule: jest.fn(),
  addRow: jest.fn(),
  updateRow: jest.fn(),
  deleteRow: jest.fn(),
}));

jest.mock("../../../src/services/calendarLegendService", () => ({
  createCategory: jest.fn(),
  updateCategory: jest.fn(),
  deleteCategory: jest.fn(),
  setDayMark: jest.fn(),
}));

jest.mock("../../../src/services/customPagesService", () => ({
  createCustomPage: jest.fn(),
  updateCustomPage: jest.fn(),
  deleteCustomPage: jest.fn(),
}));

import { prisma } from "../../../src/config/database";
import * as agendaService from "../../../src/services/agendaService";
import * as plannerService from "../../../src/services/plannerService";
import * as notesService from "../../../src/services/notesService";
import * as habitsService from "../../../src/services/habitsService";
import * as financeService from "../../../src/services/financeService";
import * as goalsService from "../../../src/services/goalsService";
import * as projectsService from "../../../src/services/projectsService";
import * as scheduleService from "../../../src/services/scheduleService";
import * as calendarLegendService from "../../../src/services/calendarLegendService";
import * as customPagesService from "../../../src/services/customPagesService";
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
  transaction: { findMany: jest.Mock; findUnique: jest.Mock };
  savingsGoal: { findMany: jest.Mock; findUnique: jest.Mock };
  goal: { findMany: jest.Mock; findUnique: jest.Mock };
  goalProgress: { findMany: jest.Mock; findUnique: jest.Mock };
  project: { findMany: jest.Mock; findUnique: jest.Mock };
  projectTask: { findMany: jest.Mock; findUnique: jest.Mock };
  projectPage: { findMany: jest.Mock; findUnique: jest.Mock };
  schedule: { findMany: jest.Mock; findUnique: jest.Mock };
  scheduleRow: { findMany: jest.Mock; findUnique: jest.Mock };
  calendarLegendCategory: { findMany: jest.Mock; findUnique: jest.Mock };
  calendarDayMark: { findMany: jest.Mock };
  customPage: { findMany: jest.Mock; findUnique: jest.Mock };
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
    transactions: { create: [], update: [] },
    savingsGoals: { create: [], update: [] },
    goals: { create: [], update: [] },
    goalProgress: { create: [], update: [] },
    projects: { create: [], update: [] },
    projectTasks: { create: [], update: [] },
    projectPages: { create: [], update: [] },
    schedules: { create: [], update: [] },
    scheduleRows: { create: [], update: [] },
    calendarLegendCategories: { create: [], update: [] },
    calendarDayMarks: { upsert: [] },
    customPages: { create: [], update: [] },
    deletes: [],
  };
}

const ALL_MODELS = [
  "event",
  "eventException",
  "task",
  "subtask",
  "note",
  "habit",
  "habitLog",
  "syncTombstone",
  "transaction",
  "savingsGoal",
  "goal",
  "goalProgress",
  "project",
  "projectTask",
  "projectPage",
  "schedule",
  "scheduleRow",
  "calendarLegendCategory",
  "calendarDayMark",
  "customPage",
] as const;

describe("syncService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const model of ALL_MODELS) {
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
      expect(prismaMock.transaction.findMany.mock.calls[0][0].where.updatedAt.gt).toEqual(since);
      expect(prismaMock.goalProgress.findMany.mock.calls[0][0].where.updatedAt.gt).toEqual(since);
      // Hijos filtrados vía la relación con el padre, igual que subtask/eventException.
      expect(prismaMock.projectTask.findMany.mock.calls[0][0].where.project).toEqual({ userId: 1 });
      expect(prismaMock.scheduleRow.findMany.mock.calls[0][0].where.schedule).toEqual({ userId: 1 });
    });

    it("agrupa lo devuelto por cada tipo en la respuesta, incluidos los módulos de Fase 2", async () => {
      prismaMock.event.findMany.mockResolvedValue([{ id: 1 }]);
      prismaMock.syncTombstone.findMany.mockResolvedValue([{ id: 5, entityType: "task", entityId: 9 }]);
      prismaMock.transaction.findMany.mockResolvedValue([{ id: 7 }]);
      prismaMock.calendarDayMark.findMany.mockResolvedValue([{ date: "2026-08-10", categoryId: 2 }]);

      const result = await syncService.pull(1);

      expect(result.events).toEqual([{ id: 1 }]);
      expect(result.tombstones).toEqual([{ id: 5, entityType: "task", entityId: 9 }]);
      expect(result.transactions).toEqual([{ id: 7 }]);
      expect(result.calendarDayMarks).toEqual([{ date: "2026-08-10", categoryId: 2 }]);
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

  describe("push — Fase 2: Finanzas/Objetivos/Proyectos/Horario/Páginas", () => {
    it("crea una transacción y devuelve el mapeo localId→id", async () => {
      (financeService.createTransaction as jest.Mock).mockResolvedValue({ id: 100 });

      const result = await syncService.push(1, {
        ...emptyBody(),
        transactions: { create: [{ localId: "tx-1", type: "expense", amount: 10, category: "comida" }], update: [] },
      });

      expect(financeService.createTransaction).toHaveBeenCalledWith(1, { type: "expense", amount: 10, category: "comida" });
      expect(result.idMappings).toEqual([{ entityType: "transaction", localId: "tx-1", id: 100 }]);
    });

    it("aplica last-write-wins también a savingsGoals, igual que el resto de módulos", async () => {
      prismaMock.savingsGoal.findUnique.mockResolvedValue({ userId: 1, updatedAt: new Date("2026-08-01T00:00:00.000Z") });

      const result = await syncService.push(1, {
        ...emptyBody(),
        savingsGoals: { create: [], update: [{ id: 5, clientUpdatedAt: "2026-08-02T00:00:00.000Z", name: "Kyoto" }] },
      });

      expect(financeService.updateSavingsGoal).toHaveBeenCalledWith(1, 5, { name: "Kyoto" });
      expect(result.conflicts).toEqual([]);
    });

    it("crea un registro de progreso pasando el goalId por separado del resto del envelope", async () => {
      (goalsService.registerProgress as jest.Mock).mockResolvedValue({ progress: { id: 55 } });

      const result = await syncService.push(1, {
        ...emptyBody(),
        goalProgress: { create: [{ localId: "gp-1", goalId: 9, value: 2, note: "offline" }], update: [] },
      });

      expect(goalsService.registerProgress).toHaveBeenCalledWith(1, 9, { value: 2, note: "offline" });
      expect(result.idMappings).toEqual([{ entityType: "goalProgress", localId: "gp-1", id: 55 }]);
    });

    it("editar un goalProgress hace el chequeo LWW contra goalProgress.updatedAt y llama a updateProgress con el goalId", async () => {
      prismaMock.goalProgress.findUnique.mockResolvedValue({ userId: 1, updatedAt: new Date("2026-08-01T00:00:00.000Z") });

      await syncService.push(1, {
        ...emptyBody(),
        goalProgress: { create: [], update: [{ id: 55, goalId: 9, clientUpdatedAt: "2026-08-02T00:00:00.000Z", value: 3 }] },
      });

      expect(goalsService.updateProgress).toHaveBeenCalledWith(1, 9, 55, { value: 3 });
    });

    it("borrar un goalProgress pasa por deleteProgress con goalId + id, que revierte currentValue en el service", async () => {
      await syncService.push(1, { ...emptyBody(), deletes: [{ entityType: "goalProgress", id: 55, goalId: 9 }] });

      expect(goalsService.deleteProgress).toHaveBeenCalledWith(1, 9, 55);
    });

    it("crea una tarea de proyecto (título solo) y la completa en un segundo paso si venía marcada", async () => {
      (projectsService.addTask as jest.Mock).mockResolvedValue({ id: 21 });

      await syncService.push(1, {
        ...emptyBody(),
        projectTasks: { create: [{ localId: "pt-1", projectId: 4, title: "Diseño", completed: true }], update: [] },
      });

      expect(projectsService.addTask).toHaveBeenCalledWith(1, 4, "Diseño");
      expect(projectsService.setTaskCompleted).toHaveBeenCalledWith(1, 4, 21, true);
    });

    it("editar una tarea de proyecto resuelve la propiedad vía la relación con el proyecto (project.userId), no un userId propio", async () => {
      prismaMock.projectTask.findUnique.mockResolvedValue({
        updatedAt: new Date("2026-08-05T00:00:00.000Z"),
        project: { userId: 2 },
      });

      const result = await syncService.push(1, {
        ...emptyBody(),
        projectTasks: { create: [], update: [{ id: 21, projectId: 4, clientUpdatedAt: "2026-08-02T00:00:00.000Z", title: "X" }] },
      });

      // "gone" (fila de otro usuario): se ignora sin más, no se reporta como conflicto.
      expect(projectsService.updateTask).not.toHaveBeenCalled();
      expect(result.conflicts).toEqual([]);
    });

    it("una página de proyecto (content HTML opaco) sigue el mismo LWW que una nota", async () => {
      prismaMock.projectPage.findUnique.mockResolvedValue({
        updatedAt: new Date("2026-08-01T00:00:00.000Z"),
        project: { userId: 1 },
      });

      await syncService.push(1, {
        ...emptyBody(),
        projectPages: {
          create: [],
          update: [{ id: 8, projectId: 4, clientUpdatedAt: "2026-08-02T00:00:00.000Z", content: "<p>hola</p>" }],
        },
      });

      expect(projectsService.updatePage).toHaveBeenCalledWith(1, 4, 8, { content: "<p>hola</p>" });
    });

    it("crea un horario (nombre) y una fila con timeLabel + celdas en dos pasos", async () => {
      (scheduleService.createSchedule as jest.Mock).mockResolvedValue({ id: 3 });
      (scheduleService.addRow as jest.Mock).mockResolvedValue({ id: 12 });

      await syncService.push(1, {
        ...emptyBody(),
        schedules: { create: [{ localId: "sch-1", name: "1r trimestre" }], update: [] },
        scheduleRows: {
          create: [{ localId: "row-1", scheduleId: 3, timeLabel: "08:00", monday: "Cálculo" }],
          update: [],
        },
      });

      expect(scheduleService.createSchedule).toHaveBeenCalledWith(1, "1r trimestre");
      expect(scheduleService.addRow).toHaveBeenCalledWith(1, 3, "08:00");
      expect(scheduleService.updateRow).toHaveBeenCalledWith(1, 3, 12, { monday: "Cálculo" });
    });

    it("no llama a updateRow en el create si la fila offline no traía más que timeLabel", async () => {
      (scheduleService.addRow as jest.Mock).mockResolvedValue({ id: 13 });

      await syncService.push(1, {
        ...emptyBody(),
        scheduleRows: { create: [{ localId: "row-2", scheduleId: 3, timeLabel: "09:00" }], update: [] },
      });

      expect(scheduleService.updateRow).not.toHaveBeenCalled();
    });

    it("reordenar un horario offline es un update normal con `order` fraccionario, sin pasar por moveSchedule", async () => {
      prismaMock.schedule.findUnique.mockResolvedValue({ userId: 1, updatedAt: new Date("2026-08-01T00:00:00.000Z") });

      await syncService.push(1, {
        ...emptyBody(),
        schedules: { create: [], update: [{ id: 3, clientUpdatedAt: "2026-08-02T00:00:00.000Z", order: 1.5 }] },
      });

      expect(scheduleService.updateSchedule).toHaveBeenCalledWith(1, 3, { order: 1.5 });
    });

    it("borra una fila de horario con su scheduleId", async () => {
      await syncService.push(1, { ...emptyBody(), deletes: [{ entityType: "scheduleRow", id: 12, scheduleId: 3 }] });

      expect(scheduleService.deleteRow).toHaveBeenCalledWith(1, 3, 12);
    });

    it("crea una categoría de la leyenda del calendario (label + color)", async () => {
      (calendarLegendService.createCategory as jest.Mock).mockResolvedValue({ id: 6 });

      const result = await syncService.push(1, {
        ...emptyBody(),
        calendarLegendCategories: { create: [{ localId: "cat-1", label: "Exámenes", color: "warning" }], update: [] },
      });

      expect(calendarLegendService.createCategory).toHaveBeenCalledWith(1, "Exámenes", "warning");
      expect(result.idMappings).toEqual([{ entityType: "calendarLegendCategory", localId: "cat-1", id: 6 }]);
    });

    it("una marca de día se sube como upsert por fecha, no como create/update", async () => {
      await syncService.push(1, {
        ...emptyBody(),
        calendarDayMarks: { upsert: [{ date: "2026-08-10", categoryId: 6 }] },
      });

      expect(calendarLegendService.setDayMark).toHaveBeenCalledWith(1, "2026-08-10", 6);
    });

    it("borrar una marca de día llama a setDayMark con categoryId null (el tombstone lo genera el propio service)", async () => {
      await syncService.push(1, { ...emptyBody(), deletes: [{ entityType: "calendarDayMark", date: "2026-08-10" }] });

      expect(calendarLegendService.setDayMark).toHaveBeenCalledWith(1, "2026-08-10", null);
    });

    it("crea una página personalizada (title + template) y su content se trata como blob opaco al editar", async () => {
      (customPagesService.createCustomPage as jest.Mock).mockResolvedValue({ id: 30 });
      prismaMock.customPage.findUnique.mockResolvedValue({ userId: 1, updatedAt: new Date("2026-08-01T00:00:00.000Z") });

      await syncService.push(1, {
        ...emptyBody(),
        customPages: {
          create: [{ localId: "cp-1", title: "Mi kanban", template: "kanban" }],
          update: [{ id: 30, clientUpdatedAt: "2026-08-02T00:00:00.000Z", content: { columns: [] } }],
        },
      });

      expect(customPagesService.createCustomPage).toHaveBeenCalledWith(1, "Mi kanban", "kanban");
      expect(customPagesService.updateCustomPage).toHaveBeenCalledWith(1, 30, { content: { columns: [] } });
    });
  });
});
