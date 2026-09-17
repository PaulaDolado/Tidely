jest.mock("../../../src/config/database", () => ({
  prisma: {
    schedule: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    scheduleRow: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    syncTombstone: { create: jest.fn() },
    $transaction: jest.fn((ops) => Promise.all(ops)),
  },
}));

import { prisma } from "../../../src/config/database";
import * as scheduleService from "../../../src/services/scheduleService";
import { ForbiddenError, NotFoundError } from "../../../src/utils/errorHandler";

const prismaMock = prisma as unknown as {
  schedule: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
  };
  scheduleRow: {
    create: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
};

describe("scheduleService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("addRow", () => {
    it("la primera fila del horario queda con order 0", async () => {
      prismaMock.schedule.findUnique.mockResolvedValue({ id: 1, userId: 1 });
      prismaMock.scheduleRow.findFirst.mockResolvedValue(null);
      prismaMock.scheduleRow.create.mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data }));

      await scheduleService.addRow(1, 1, "08:00 - 10:00");

      expect(prismaMock.scheduleRow.create.mock.calls[0][0].data).toEqual({
        scheduleId: 1,
        timeLabel: "08:00 - 10:00",
        order: 0,
      });
    });

    it("una fila nueva se añade con order = último + 1", async () => {
      prismaMock.schedule.findUnique.mockResolvedValue({ id: 1, userId: 1 });
      prismaMock.scheduleRow.findFirst.mockResolvedValue({ order: 4 });
      prismaMock.scheduleRow.create.mockImplementation(({ data }) => Promise.resolve({ id: 2, ...data }));

      await scheduleService.addRow(1, 1);

      expect(prismaMock.scheduleRow.create.mock.calls[0][0].data.order).toBe(5);
    });

    it("lanza ForbiddenError si el horario es de otro usuario", async () => {
      prismaMock.schedule.findUnique.mockResolvedValue({ id: 1, userId: 2 });
      await expect(scheduleService.addRow(1, 1, "08:00")).rejects.toThrow(ForbiddenError);
      expect(prismaMock.scheduleRow.create).not.toHaveBeenCalled();
    });
  });

  describe("updateRow", () => {
    it("lanza NotFoundError si la fila no existe", async () => {
      prismaMock.schedule.findUnique.mockResolvedValue({ id: 1, userId: 1 });
      prismaMock.scheduleRow.findUnique.mockResolvedValue(null);
      await expect(scheduleService.updateRow(1, 1, 999, { monday: "Cálculo I" })).rejects.toThrow(NotFoundError);
    });

    it("lanza ForbiddenError si el horario es de otro usuario", async () => {
      prismaMock.schedule.findUnique.mockResolvedValue({ id: 1, userId: 2 });
      await expect(scheduleService.updateRow(1, 1, 1, { monday: "Cálculo I" })).rejects.toThrow(ForbiddenError);
    });

    it("solo actualiza las celdas indicadas", async () => {
      prismaMock.schedule.findUnique.mockResolvedValue({ id: 1, userId: 1 });
      prismaMock.scheduleRow.findUnique.mockResolvedValue({ id: 1, scheduleId: 1 });
      prismaMock.scheduleRow.update.mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data }));

      await scheduleService.updateRow(1, 1, 1, { monday: "Cálculo I", friday: "Física II" });

      expect(prismaMock.scheduleRow.update.mock.calls[0][0].data).toEqual({ monday: "Cálculo I", friday: "Física II" });
    });

    it("acepta un order fraccionario (reordenar offline sin pasar por moveRow)", async () => {
      prismaMock.schedule.findUnique.mockResolvedValue({ id: 1, userId: 1 });
      prismaMock.scheduleRow.findUnique.mockResolvedValue({ id: 1, scheduleId: 1 });
      prismaMock.scheduleRow.update.mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data }));

      await scheduleService.updateRow(1, 1, 1, { order: 1.5 });

      expect(prismaMock.scheduleRow.update.mock.calls[0][0].data).toEqual({ order: 1.5 });
    });
  });

  describe("updateSchedule", () => {
    it("lanza ForbiddenError si el horario es de otro usuario", async () => {
      prismaMock.schedule.findUnique.mockResolvedValue({ id: 1, userId: 2 });
      await expect(scheduleService.updateSchedule(1, 1, { name: "Otro" })).rejects.toThrow(ForbiddenError);
      expect(prismaMock.schedule.update).not.toHaveBeenCalled();
    });

    it("recorta el nombre y acepta order fraccionario, cada uno opcional por separado", async () => {
      prismaMock.schedule.findUnique.mockResolvedValue({ id: 1, userId: 1 });
      prismaMock.schedule.update.mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data }));

      await scheduleService.updateSchedule(1, 1, { name: "  2n trimestre  " });
      expect(prismaMock.schedule.update.mock.calls[0][0].data).toEqual({ name: "2n trimestre" });

      await scheduleService.updateSchedule(1, 1, { order: 2.5 });
      expect(prismaMock.schedule.update.mock.calls[1][0].data).toEqual({ order: 2.5 });
    });
  });

  describe("deleteRow", () => {
    it("lanza ForbiddenError si el horario es de otro usuario, sin borrar", async () => {
      prismaMock.schedule.findUnique.mockResolvedValue({ id: 1, userId: 2 });
      await expect(scheduleService.deleteRow(1, 1, 1)).rejects.toThrow(ForbiddenError);
      expect(prismaMock.scheduleRow.delete).not.toHaveBeenCalled();
    });

    it("borra la fila propia", async () => {
      prismaMock.schedule.findUnique.mockResolvedValue({ id: 1, userId: 1 });
      prismaMock.scheduleRow.findUnique.mockResolvedValue({ id: 1, scheduleId: 1 });
      prismaMock.scheduleRow.delete.mockResolvedValue({ id: 1 });

      await scheduleService.deleteRow(1, 1, 1);

      expect(prismaMock.scheduleRow.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    });
  });

  describe("moveRow", () => {
    it("mover 'up' intercambia el order con la fila anterior", async () => {
      prismaMock.schedule.findUnique.mockResolvedValue({ id: 1, userId: 1 });
      prismaMock.scheduleRow.findUnique.mockResolvedValue({ id: 2, scheduleId: 1, order: 1 });
      prismaMock.scheduleRow.findFirst.mockResolvedValue({ id: 1, order: 0 });
      prismaMock.scheduleRow.update.mockResolvedValue({});

      await scheduleService.moveRow(1, 1, 2, "up");

      expect(prismaMock.scheduleRow.update).toHaveBeenNthCalledWith(1, { where: { id: 2 }, data: { order: 0 } });
      expect(prismaMock.scheduleRow.update).toHaveBeenNthCalledWith(2, { where: { id: 1 }, data: { order: 1 } });
    });

    it("mover 'up' la primera fila (sin vecina anterior) no hace nada", async () => {
      prismaMock.schedule.findUnique.mockResolvedValue({ id: 1, userId: 1 });
      prismaMock.scheduleRow.findUnique.mockResolvedValue({ id: 1, scheduleId: 1, order: 0 });
      prismaMock.scheduleRow.findFirst.mockResolvedValue(null);

      await scheduleService.moveRow(1, 1, 1, "up");

      expect(prismaMock.scheduleRow.update).not.toHaveBeenCalled();
    });

    it("lanza ForbiddenError si el horario es de otro usuario", async () => {
      prismaMock.schedule.findUnique.mockResolvedValue({ id: 1, userId: 2 });
      await expect(scheduleService.moveRow(1, 1, 1, "down")).rejects.toThrow(ForbiddenError);
    });
  });
});
