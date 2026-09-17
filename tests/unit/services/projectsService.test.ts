jest.mock("../../../src/config/database", () => ({
  prisma: {
    project: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    projectTask: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    projectPage: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
    syncTombstone: { create: jest.fn() },
    $transaction: jest.fn((ops) => Promise.all(ops)),
  },
}));

import { prisma } from "../../../src/config/database";
import * as projectsService from "../../../src/services/projectsService";
import { ForbiddenError, NotFoundError } from "../../../src/utils/errorHandler";

const prismaMock = prisma as unknown as {
  project: { findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock; count: jest.Mock };
  projectTask: { create: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock; delete: jest.Mock };
  projectPage: { findMany: jest.Mock };
};

describe("projectsService", () => {
  const ownedProject = { id: 1, userId: 1, title: "Life Organizer" };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getProjectDetail / getProjectProgress", () => {
    it("calcula el progreso como 0% cuando no hay tareas", async () => {
      prismaMock.project.findUnique.mockResolvedValue(ownedProject);
      prismaMock.projectTask.findMany.mockResolvedValue([]);

      const detail = await projectsService.getProjectDetail(1, 1);

      expect(detail.progress).toEqual({ total: 0, completed: 0, percent: 0 });
    });

    it("calcula el % de tareas completadas correctamente", async () => {
      prismaMock.project.findUnique.mockResolvedValue(ownedProject);
      prismaMock.projectTask.findMany.mockResolvedValue([
        { id: 1, completed: true },
        { id: 2, completed: true },
        { id: 3, completed: false },
      ]);

      const progress = await projectsService.getProjectProgress(1, 1);

      expect(progress).toEqual({ projectId: 1, total: 3, completed: 2, percent: 67 });
    });

    it("lanza NotFoundError si el proyecto no existe", async () => {
      prismaMock.project.findUnique.mockResolvedValue(null);

      await expect(projectsService.getProjectDetail(1, 999)).rejects.toThrow(NotFoundError);
    });

    it("lanza ForbiddenError si el proyecto es de otro usuario", async () => {
      prismaMock.project.findUnique.mockResolvedValue({ ...ownedProject, userId: 2 });

      await expect(projectsService.getProjectDetail(1, 1)).rejects.toThrow(ForbiddenError);
    });
  });

  describe("setTaskCompleted", () => {
    it("lanza NotFoundError si la tarea no pertenece al proyecto indicado", async () => {
      prismaMock.project.findUnique.mockResolvedValue(ownedProject);
      prismaMock.projectTask.findUnique.mockResolvedValue({ id: 5, projectId: 999 });

      await expect(projectsService.setTaskCompleted(1, 1, 5, true)).rejects.toThrow(NotFoundError);
    });

    it("marca la tarea como completada con completedAt", async () => {
      prismaMock.project.findUnique.mockResolvedValue(ownedProject);
      prismaMock.projectTask.findUnique.mockResolvedValue({ id: 5, projectId: 1, completed: false });
      prismaMock.projectTask.update.mockImplementation(({ data }) =>
        Promise.resolve({ id: 5, projectId: 1, ...data })
      );

      const task = await projectsService.setTaskCompleted(1, 1, 5, true);

      expect(task.completed).toBe(true);
      expect(task.completedAt).toBeInstanceOf(Date);
    });

    it("desmarca la tarea y limpia completedAt", async () => {
      prismaMock.project.findUnique.mockResolvedValue(ownedProject);
      prismaMock.projectTask.findUnique.mockResolvedValue({ id: 5, projectId: 1, completed: true });
      prismaMock.projectTask.update.mockImplementation(({ data }) =>
        Promise.resolve({ id: 5, projectId: 1, ...data })
      );

      const task = await projectsService.setTaskCompleted(1, 1, 5, false);

      expect(task.completed).toBe(false);
      expect(task.completedAt).toBeNull();
    });
  });

  describe("deleteTask", () => {
    it("lanza NotFoundError si la tarea no pertenece al proyecto indicado", async () => {
      prismaMock.project.findUnique.mockResolvedValue(ownedProject);
      prismaMock.projectTask.findUnique.mockResolvedValue({ id: 5, projectId: 999 });

      await expect(projectsService.deleteTask(1, 1, 5)).rejects.toThrow(NotFoundError);
    });

    it("elimina la tarea", async () => {
      prismaMock.project.findUnique.mockResolvedValue(ownedProject);
      prismaMock.projectTask.findUnique.mockResolvedValue({ id: 5, projectId: 1 });
      prismaMock.projectTask.delete.mockResolvedValue({ id: 5 });

      await projectsService.deleteTask(1, 1, 5);

      expect(prismaMock.projectTask.delete).toHaveBeenCalledWith({ where: { id: 5 } });
    });
  });

  describe("listProjects (paginación)", () => {
    it("pagina con skip/take y retorna el total real", async () => {
      prismaMock.project.findMany.mockResolvedValue([{ id: 1 }]);
      prismaMock.project.count.mockResolvedValue(15);

      const result = await projectsService.listProjects(1, { page: 3, limit: 5 });

      expect(prismaMock.project.findMany.mock.calls[0][0]).toMatchObject({ skip: 10, take: 5 });
      expect(result.pagination).toEqual({ page: 3, limit: 5, total: 15, pages: 3 });
    });

    it("usa page=1 y limit=20 por defecto si no se pasan filtros", async () => {
      prismaMock.project.findMany.mockResolvedValue([]);
      prismaMock.project.count.mockResolvedValue(0);

      await projectsService.listProjects(1);

      expect(prismaMock.project.findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 20 });
    });
  });

  describe("listRecentEntries", () => {
    it("solo consulta páginas del propio usuario, tocadas en la última semana", async () => {
      prismaMock.projectPage.findMany.mockResolvedValue([]);

      await projectsService.listRecentEntries(1);

      const whereArg = prismaMock.projectPage.findMany.mock.calls[0][0].where;
      expect(whereArg.project).toEqual({ userId: 1 });
      expect(whereArg.updatedAt.gte).toBeInstanceOf(Date);
    });

    it("quita las etiquetas HTML del contenido para el avance en texto plano", async () => {
      prismaMock.projectPage.findMany.mockResolvedValue([
        {
          id: 1,
          projectId: 1,
          title: "Página 1",
          content: "<p>Hola <strong>mundo</strong></p><ul><li>uno</li></ul>",
          updatedAt: new Date("2026-08-27T10:00:00.000Z"),
          project: { id: 1, title: "Life Organizer" },
        },
      ]);

      const entries = await projectsService.listRecentEntries(1);

      expect(entries[0].preview).toBe("Hola mundo uno");
      expect(entries[0].projectTitle).toBe("Life Organizer");
      expect(entries[0].pageTitle).toBe("Página 1");
    });

    it("recorta el avance a 160 caracteres", async () => {
      prismaMock.projectPage.findMany.mockResolvedValue([
        {
          id: 1,
          projectId: 1,
          title: "Larga",
          content: "x".repeat(500),
          updatedAt: new Date(),
          project: { id: 1, title: "P" },
        },
      ]);

      const entries = await projectsService.listRecentEntries(1);

      expect(entries[0].preview).toHaveLength(160);
    });

    it("devuelve [] si no hay páginas tocadas recientemente", async () => {
      prismaMock.projectPage.findMany.mockResolvedValue([]);

      const entries = await projectsService.listRecentEntries(1);

      expect(entries).toEqual([]);
    });
  });
});
