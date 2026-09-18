import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";
import { ForbiddenError, NotFoundError } from "../utils/errorHandler";
import { recordTombstone } from "./tombstoneService";

const DEFAULT_STATUS = "todo";
const DEFAULT_PRIORITY = "medium";

// Valor de una columna personalizada (ver PlannerField): string para texto/fecha ISO/opción de
// "select", number para "número", null para "sin valor".
type CustomFieldValue = string | number | null;
type CustomFieldValues = Record<string, CustomFieldValue>;

interface TaskInputFields {
  title?: string;
  description?: string | null;
  image?: string | null;
  notes?: string | null;
  compact?: boolean;
  status?: string;
  priority?: string;
  order?: number;
  dueDate?: string | Date | null;
  tags?: string[];
  estimatedMinutes?: number | null;
  projectId?: number | null;
  customFields?: CustomFieldValues;
}

type CreateTaskInput = TaskInputFields & { title: string; plannerId?: number };
type UpdateTaskInput = TaskInputFields;

interface ListTasksFilters {
  plannerId?: number;
  projectId?: number;
  tag?: string;
}

// Orden estable de las subtareas de una tarjeta: no tienen `order` propio (ver comentario en
// el schema), así que se listan por antigüedad.
const SUBTASKS_INCLUDE = { subtasks: { orderBy: { createdAt: "asc" as const } } };

async function assertOwnedProject(userId: number, projectId: number): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFoundError("Proyecto no encontrado");
  if (project.userId !== userId) throw new ForbiddenError("No autorizado");
}

// ---------------------------------------------------------------------------------------------
// Planners (tableros): el usuario puede tener varios, uno por área/proyecto de vida — mismo
// patrón que Schedule (Horario), ver scheduleService.ts.
// ---------------------------------------------------------------------------------------------

export async function listPlanners(userId: number) {
  const planners = await prisma.planner.findMany({ where: { userId }, orderBy: { order: "asc" } });
  return { planners };
}

export async function createPlanner(userId: number, name: string) {
  const last = await prisma.planner.findFirst({ where: { userId }, orderBy: { order: "desc" } });
  return prisma.planner.create({
    data: { userId, name: name.trim(), order: (last?.order ?? -1) + 1 },
  });
}

async function findOwnedPlanner(userId: number, plannerId: number) {
  const planner = await prisma.planner.findUnique({ where: { id: plannerId } });
  if (!planner) throw new NotFoundError("Planificador no encontrado");
  if (planner.userId !== userId) throw new ForbiddenError("No autorizado");
  return planner;
}

export async function updatePlanner(userId: number, plannerId: number, name: string) {
  await findOwnedPlanner(userId, plannerId);
  return prisma.planner.update({ where: { id: plannerId }, data: { name: name.trim() } });
}

export async function deletePlanner(userId: number, plannerId: number) {
  await findOwnedPlanner(userId, plannerId);
  // Cascada: borra también todas las tareas (y subtareas) de este tablero — ver onDelete: Cascade
  // en Task.planner / Subtask.task. Sin tombstones propios aquí: las tareas individuales sí los
  // registran cuando se borran una a una (ver deleteTask), pero un borrado en cascada por FK no
  // pasa por esa función — igual que Schedule/ScheduleRow, no forma parte del set de sync móvil.
  await prisma.planner.delete({ where: { id: plannerId } });
}

// Intercambia el `order` con el planner inmediatamente anterior/siguiente — mismo patrón que
// moveSchedule.
export async function movePlanner(userId: number, plannerId: number, direction: "up" | "down") {
  const planner = await findOwnedPlanner(userId, plannerId);
  const neighbor = await prisma.planner.findFirst({
    where: { userId, order: direction === "up" ? { lt: planner.order } : { gt: planner.order } },
    orderBy: { order: direction === "up" ? "desc" : "asc" },
  });
  if (!neighbor) return;

  await prisma.$transaction([
    prisma.planner.update({ where: { id: planner.id }, data: { order: neighbor.order } }),
    prisma.planner.update({ where: { id: neighbor.id }, data: { order: planner.order } }),
  ]);
}

// Fallback para consumidores que no conocen el concepto de "planner" (el protocolo de sync del
// móvil es anterior a esta función — ver syncService.ts: llama a createTask sin plannerId). En
// vez de fallar, la tarea cae en el planner con menor `order` del usuario, creando uno si hiciera
// falta — así una tarea creada desde el móvil no se pierde ni rompe el push.
async function getOrCreateDefaultPlanner(userId: number): Promise<number> {
  const first = await prisma.planner.findFirst({ where: { userId }, orderBy: { order: "asc" } });
  if (first) return first.id;
  const created = await prisma.planner.create({ data: { userId, name: "Planificador", order: 0 } });
  return created.id;
}

// ---------------------------------------------------------------------------------------------
// Columnas personalizadas (PlannerField): propias de CADA planner, no globales — igual que las
// propiedades de una base de datos de Notion. El valor real de cada tarea para un field vive en
// Task.customFields (ver más abajo), indexado por el id del field.
// ---------------------------------------------------------------------------------------------

export async function listFields(userId: number, plannerId: number) {
  await findOwnedPlanner(userId, plannerId);
  const fields = await prisma.plannerField.findMany({ where: { plannerId }, orderBy: { order: "asc" } });
  return { fields };
}

export async function createField(userId: number, plannerId: number, input: { name: string; type: string; options?: string[] }) {
  await findOwnedPlanner(userId, plannerId);
  const last = await prisma.plannerField.findFirst({ where: { plannerId }, orderBy: { order: "desc" } });
  return prisma.plannerField.create({
    data: {
      plannerId,
      name: input.name.trim(),
      type: input.type,
      options: input.options ?? [],
      order: (last?.order ?? -1) + 1,
    },
  });
}

async function findOwnedField(userId: number, plannerId: number, fieldId: number) {
  await findOwnedPlanner(userId, plannerId);
  const field = await prisma.plannerField.findUnique({ where: { id: fieldId } });
  if (!field || field.plannerId !== plannerId) throw new NotFoundError("Columna no encontrada");
  return field;
}

// Nota: `type` NO es editable una vez creada la columna — cambiar de "número" a "fecha" a medio
// camino dejaría valores ya guardados sin sentido en ningún formato. Si hace falta otro tipo,
// se borra la columna y se crea de nuevo (los valores antiguos quedan huérfanos en
// Task.customFields, inofensivos: ningún field los referencia ya, así que no se muestran).
export async function updateField(userId: number, plannerId: number, fieldId: number, input: { name?: string; options?: string[] }) {
  await findOwnedField(userId, plannerId, fieldId);
  return prisma.plannerField.update({
    where: { id: fieldId },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.options !== undefined ? { options: input.options } : {}),
    },
  });
}

export async function deleteField(userId: number, plannerId: number, fieldId: number) {
  await findOwnedField(userId, plannerId, fieldId);
  await prisma.plannerField.delete({ where: { id: fieldId } });
}

// Intercambia el `order` con la columna inmediatamente anterior/siguiente, dentro del mismo
// planner — mismo patrón que moveSchedule/movePlanner.
export async function moveField(userId: number, plannerId: number, fieldId: number, direction: "up" | "down") {
  const field = await findOwnedField(userId, plannerId, fieldId);
  const neighbor = await prisma.plannerField.findFirst({
    where: { plannerId, order: direction === "up" ? { lt: field.order } : { gt: field.order } },
    orderBy: { order: direction === "up" ? "desc" : "asc" },
  });
  if (!neighbor) return;

  await prisma.$transaction([
    prisma.plannerField.update({ where: { id: field.id }, data: { order: neighbor.order } }),
    prisma.plannerField.update({ where: { id: neighbor.id }, data: { order: field.order } }),
  ]);
}

// ---------------------------------------------------------------------------------------------
// Tareas dentro de un planner.
// ---------------------------------------------------------------------------------------------

export async function listTasks(userId: number, filters: ListTasksFilters = {}) {
  const tasks = await prisma.task.findMany({
    where: {
      userId,
      ...(filters.plannerId !== undefined ? { plannerId: filters.plannerId } : {}),
      ...(filters.projectId !== undefined ? { projectId: filters.projectId } : {}),
      ...(filters.tag ? { tags: { has: filters.tag } } : {}),
    },
    orderBy: { order: "asc" },
    include: SUBTASKS_INCLUDE,
  });
  return { tasks };
}

export async function createTask(userId: number, input: CreateTaskInput) {
  const status = input.status ?? DEFAULT_STATUS;

  let plannerId: number;
  if (input.plannerId !== undefined) {
    await findOwnedPlanner(userId, input.plannerId);
    plannerId = input.plannerId;
  } else {
    plannerId = await getOrCreateDefaultPlanner(userId);
  }

  if (input.projectId !== undefined && input.projectId !== null) {
    await assertOwnedProject(userId, input.projectId);
  }

  // Sin `order` explícito, la tarea nueva va al final de su columna — dentro del MISMO planner
  // (dos tableros distintos no comparten numeración de columna).
  let order = input.order;
  if (order === undefined) {
    const last = await prisma.task.findFirst({
      where: { plannerId, status },
      orderBy: { order: "desc" },
    });
    order = (last?.order ?? 0) + 1000;
  }

  return prisma.task.create({
    data: {
      userId,
      plannerId,
      title: input.title,
      description: input.description ?? null,
      image: input.image ?? null,
      notes: input.notes ?? null,
      compact: input.compact ?? false,
      status,
      priority: input.priority ?? DEFAULT_PRIORITY,
      order,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      tags: input.tags ?? [],
      estimatedMinutes: input.estimatedMinutes ?? null,
      projectId: input.projectId ?? null,
      customFields: input.customFields ?? {},
    },
    include: SUBTASKS_INCLUDE,
  });
}

async function findOwnedTask(userId: number, taskId: number) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new NotFoundError("Tarea no encontrada");
  if (task.userId !== userId) throw new ForbiddenError("No autorizado");
  return task;
}

export async function updateTask(userId: number, taskId: number, input: UpdateTaskInput) {
  const task = await findOwnedTask(userId, taskId);

  if (input.projectId !== undefined && input.projectId !== null) {
    await assertOwnedProject(userId, input.projectId);
  }

  // `customFields` es un PATCH (se combina con lo que ya hubiera), no un reemplazo entero — así
  // editar el valor de una columna personalizada no borra las demás. Un valor `null` explícito sí
  // borra esa columna en concreto (ver TaskTableRow/TaskDetailDialog: "Quitar").
  const mergedCustomFields: Prisma.InputJsonValue | undefined =
    input.customFields !== undefined
      ? ({ ...(task.customFields as Record<string, unknown>), ...input.customFields } as Prisma.InputJsonValue)
      : undefined;

  return prisma.task.update({
    where: { id: taskId },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.image !== undefined ? { image: input.image || null } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.compact !== undefined ? { compact: input.compact } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.order !== undefined ? { order: input.order } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate ? new Date(input.dueDate) : null } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.estimatedMinutes !== undefined ? { estimatedMinutes: input.estimatedMinutes } : {}),
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      ...(mergedCustomFields !== undefined ? { customFields: mergedCustomFields } : {}),
    },
    include: SUBTASKS_INCLUDE,
  });
}

export async function deleteTask(userId: number, taskId: number) {
  await findOwnedTask(userId, taskId);
  // Tombstone en la misma transacción (ver tombstoneService.ts) — el móvil necesita saber que
  // esta tarea (y sus subtareas, que caen en cascada) desapareció en su próximo /sync/pull.
  await prisma.$transaction([
    prisma.task.delete({ where: { id: taskId } }),
    recordTombstone(prisma, userId, "task", taskId),
  ]);
}

// Tiempo real: en vez de guardar un booleano/valor absoluto, cada llamada SUMA minutos al
// acumulado (como una sesión de trabajo registrada) — así el usuario puede ir apuntando el
// tiempo dedicado en varias tandas sin tener que recalcular el total él mismo.
export async function logTime(userId: number, taskId: number, minutes: number) {
  await findOwnedTask(userId, taskId);
  return prisma.task.update({
    where: { id: taskId },
    data: { actualMinutes: { increment: minutes } },
    include: SUBTASKS_INCLUDE,
  });
}

export async function addSubtask(userId: number, taskId: number, title: string) {
  await findOwnedTask(userId, taskId);
  return prisma.subtask.create({ data: { taskId, title } });
}

async function findOwnedSubtask(userId: number, taskId: number, subtaskId: number) {
  await findOwnedTask(userId, taskId);
  const subtask = await prisma.subtask.findUnique({ where: { id: subtaskId } });
  if (!subtask || subtask.taskId !== taskId) {
    throw new NotFoundError("Subtarea no encontrada");
  }
  return subtask;
}

interface UpdateSubtaskInput {
  title?: string;
  completed?: boolean;
}

export async function updateSubtask(userId: number, taskId: number, subtaskId: number, input: UpdateSubtaskInput) {
  await findOwnedSubtask(userId, taskId, subtaskId);
  return prisma.subtask.update({
    where: { id: subtaskId },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.completed !== undefined ? { completed: input.completed } : {}),
    },
  });
}

export async function deleteSubtask(userId: number, taskId: number, subtaskId: number) {
  await findOwnedSubtask(userId, taskId, subtaskId);
  await prisma.$transaction([
    prisma.subtask.delete({ where: { id: subtaskId } }),
    recordTombstone(prisma, userId, "subtask", subtaskId),
  ]);
}
