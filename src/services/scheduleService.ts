import { prisma } from "../config/database";
import { ForbiddenError, NotFoundError } from "../utils/errorHandler";
import { recordTombstone } from "./tombstoneService";

// ---------------------------------------------------------------------------------------------
// Horarios (Schedule): el usuario puede tener varios, uno por trimestre/semestre.
// ---------------------------------------------------------------------------------------------

export async function listSchedules(userId: number) {
  const schedules = await prisma.schedule.findMany({
    where: { userId },
    orderBy: { order: "asc" },
  });
  return { schedules };
}

export async function createSchedule(userId: number, name: string) {
  const last = await prisma.schedule.findFirst({ where: { userId }, orderBy: { order: "desc" } });
  return prisma.schedule.create({
    data: { userId, name: name.trim(), order: (last?.order ?? -1) + 1 },
  });
}

async function findOwnedSchedule(userId: number, scheduleId: number) {
  const schedule = await prisma.schedule.findUnique({ where: { id: scheduleId } });
  if (!schedule) throw new NotFoundError("Horario no encontrado");
  if (schedule.userId !== userId) throw new ForbiddenError("No autorizado");
  return schedule;
}

interface UpdateScheduleInput {
  name?: string;
  // Opcional: permite reordenar escribiendo un `order` fraccionario calculado por el cliente
  // (ver mobile/src/db/tasksRepo.ts::moveTask) en vez de pasar por el endpoint de swap
  // `moveSchedule` — necesario para poder reordenar offline (ver syncService.ts).
  order?: number;
}

export async function updateSchedule(userId: number, scheduleId: number, input: UpdateScheduleInput) {
  await findOwnedSchedule(userId, scheduleId);
  return prisma.schedule.update({
    where: { id: scheduleId },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.order !== undefined ? { order: input.order } : {}),
    },
  });
}

export async function deleteSchedule(userId: number, scheduleId: number) {
  await findOwnedSchedule(userId, scheduleId);
  await prisma.$transaction([
    prisma.schedule.delete({ where: { id: scheduleId } }),
    recordTombstone(prisma, userId, "schedule", scheduleId),
  ]);
}

// Intercambia el `order` con el horario inmediatamente anterior/siguiente — mismo patrón que
// moveRow más abajo, para reordenar sin renumerar todos los horarios de por medio.
export async function moveSchedule(userId: number, scheduleId: number, direction: "up" | "down") {
  const schedule = await findOwnedSchedule(userId, scheduleId);
  const neighbor = await prisma.schedule.findFirst({
    where: { userId, order: direction === "up" ? { lt: schedule.order } : { gt: schedule.order } },
    orderBy: { order: direction === "up" ? "desc" : "asc" },
  });
  if (!neighbor) return;

  await prisma.$transaction([
    prisma.schedule.update({ where: { id: schedule.id }, data: { order: neighbor.order } }),
    prisma.schedule.update({ where: { id: neighbor.id }, data: { order: schedule.order } }),
  ]);
}

// ---------------------------------------------------------------------------------------------
// Filas de un horario concreto.
// ---------------------------------------------------------------------------------------------

export async function listRows(userId: number, scheduleId: number) {
  await findOwnedSchedule(userId, scheduleId);
  const rows = await prisma.scheduleRow.findMany({ where: { scheduleId }, orderBy: { order: "asc" } });
  return { rows };
}

export async function addRow(userId: number, scheduleId: number, timeLabel?: string) {
  await findOwnedSchedule(userId, scheduleId);
  const last = await prisma.scheduleRow.findFirst({ where: { scheduleId }, orderBy: { order: "desc" } });
  return prisma.scheduleRow.create({
    data: {
      scheduleId,
      timeLabel: timeLabel?.trim() ?? "",
      order: (last?.order ?? -1) + 1,
    },
  });
}

async function findOwnedRow(userId: number, scheduleId: number, rowId: number) {
  await findOwnedSchedule(userId, scheduleId);
  const row = await prisma.scheduleRow.findUnique({ where: { id: rowId } });
  if (!row || row.scheduleId !== scheduleId) throw new NotFoundError("Fila del horario no encontrada");
  return row;
}

interface UpdateRowInput {
  timeLabel?: string;
  monday?: string;
  tuesday?: string;
  wednesday?: string;
  thursday?: string;
  friday?: string;
  // Ver comentario en UpdateScheduleInput.order.
  order?: number;
}

export async function updateRow(userId: number, scheduleId: number, rowId: number, input: UpdateRowInput) {
  await findOwnedRow(userId, scheduleId, rowId);
  return prisma.scheduleRow.update({
    where: { id: rowId },
    data: {
      ...(input.timeLabel !== undefined ? { timeLabel: input.timeLabel } : {}),
      ...(input.monday !== undefined ? { monday: input.monday } : {}),
      ...(input.tuesday !== undefined ? { tuesday: input.tuesday } : {}),
      ...(input.wednesday !== undefined ? { wednesday: input.wednesday } : {}),
      ...(input.thursday !== undefined ? { thursday: input.thursday } : {}),
      ...(input.friday !== undefined ? { friday: input.friday } : {}),
      ...(input.order !== undefined ? { order: input.order } : {}),
    },
  });
}

export async function deleteRow(userId: number, scheduleId: number, rowId: number) {
  await findOwnedRow(userId, scheduleId, rowId);
  await prisma.$transaction([
    prisma.scheduleRow.delete({ where: { id: rowId } }),
    recordTombstone(prisma, userId, "scheduleRow", rowId),
  ]);
}

// Intercambia el `order` con la fila inmediatamente anterior/siguiente, dentro del mismo horario.
export async function moveRow(userId: number, scheduleId: number, rowId: number, direction: "up" | "down") {
  const row = await findOwnedRow(userId, scheduleId, rowId);
  const neighbor = await prisma.scheduleRow.findFirst({
    where: {
      scheduleId,
      order: direction === "up" ? { lt: row.order } : { gt: row.order },
    },
    orderBy: { order: direction === "up" ? "desc" : "asc" },
  });
  if (!neighbor) return;

  await prisma.$transaction([
    prisma.scheduleRow.update({ where: { id: row.id }, data: { order: neighbor.order } }),
    prisma.scheduleRow.update({ where: { id: neighbor.id }, data: { order: row.order } }),
  ]);
}
