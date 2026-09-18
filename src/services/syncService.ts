import { prisma } from "../config/database";
import * as agendaService from "./agendaService";
import * as plannerService from "./plannerService";
import * as notesService from "./notesService";
import * as habitsService from "./habitsService";
import * as financeService from "./financeService";
import * as goalsService from "./goalsService";
import * as projectsService from "./projectsService";
import * as scheduleService from "./scheduleService";
import * as calendarLegendService from "./calendarLegendService";
import * as customPagesService from "./customPagesService";
import { logger } from "../utils/logger";

const EPOCH = new Date(0);

/**
 * Sincronización offline (Fase 1 — ver plan): Event/EventException, Task/Subtask, Note,
 * Habit/HabitLog. El resto de módulos (Finanzas, Proyectos, Galería, Objetivos,
 * Notificaciones) no sincroniza con el móvil todavía.
 *
 * Pull y push son deliberadamente EXPLÍCITOS por tipo (no un bucle genérico sobre los 7
 * modelos): cada uno tiene una firma de servicio distinta (`addSubtask(userId, taskId, title)`
 * no es `createEvent(userId, input)`), y ocultar eso detrás de una abstracción genérica
 * costaría más claridad de la que ahorra. Toda la lógica de negocio (validación, ownership) se
 * reutiliza de agendaService/plannerService/notesService/habitsService — esta capa solo
 * orquesta: qué tocó desde cuándo, y cómo aplicar un lote de cambios hechos offline.
 */

/**
 * Todo lo cambiado (creado o editado) para el usuario desde `since`, más los tombstones de lo
 * borrado — `serverTime` es el instante en que se hizo esta consulta, y es lo que el cliente
 * debe guardar como su próximo cursor (no el `updatedAt` máximo de las filas devueltas, que
 * podría quedar por detrás de escrituras concurrentes justo durante la consulta).
 */
export async function pull(userId: number, since?: Date) {
  const cursor = since ?? EPOCH;
  const serverTime = new Date();

  const [
    events,
    eventExceptions,
    tasks,
    subtasks,
    notes,
    habits,
    habitLogs,
    tombstones,
    transactions,
    savingsGoals,
    goals,
    goalProgress,
    projects,
    projectTasks,
    projectPages,
    schedules,
    scheduleRows,
    calendarLegendCategories,
    // Al crear/editar, una marca de día se manda siempre entera (upsert) y se identifica por
    // fecha, no por id — igual que EventException. Al borrarla SÍ genera tombstone por su `id`
    // real (ver calendarLegendService.setDayMark), igual que EventException también lo hace.
    calendarDayMarks,
    customPages,
  ] = await Promise.all([
    // OR de "míos" + "compartidos conmigo y aceptados" (ver agendaService.sharedEventsWhere) —
    // mismo criterio de visibilidad que la Agenda web (findEventsInRange), para que el móvil vea
    // los mismos eventos compartidos, con el mismo distintivo `sharing` (ver el .map() de abajo).
    prisma.event.findMany({
      where: { OR: [{ userId }, agendaService.sharedEventsWhere(userId)], updatedAt: { gt: cursor } },
      include: agendaService.SHARING_INCLUDE,
    }),
    // Mismo motivo: una excepción (mover/cancelar una ocurrencia suelta) de un evento recurrente
    // compartido la puso quien lo creó, pero vale igual para quien lo tiene aceptado — sin
    // incluirla aquí, el móvil del invitado expandiría la serie sin conocer esos ajustes.
    prisma.eventException.findMany({
      where: { event: { OR: [{ userId }, agendaService.sharedEventsWhere(userId)] }, updatedAt: { gt: cursor } },
    }),
    prisma.task.findMany({ where: { userId, updatedAt: { gt: cursor } } }),
    prisma.subtask.findMany({ where: { task: { userId }, updatedAt: { gt: cursor } } }),
    prisma.note.findMany({ where: { userId, updatedAt: { gt: cursor } } }),
    prisma.habit.findMany({ where: { userId, updatedAt: { gt: cursor } } }),
    // HabitLog nunca se edita in-place (solo alta/baja, ver habitsService.toggleHabitDay) —
    // `createdAt` ya es un cursor de "nuevo desde" válido, no hace falta `updatedAt`.
    prisma.habitLog.findMany({ where: { userId, createdAt: { gt: cursor } } }),
    prisma.syncTombstone.findMany({ where: { userId, deletedAt: { gt: cursor } } }),
    prisma.transaction.findMany({ where: { userId, updatedAt: { gt: cursor } } }),
    prisma.savingsGoal.findMany({ where: { userId, updatedAt: { gt: cursor } } }),
    prisma.goal.findMany({ where: { userId, updatedAt: { gt: cursor } } }),
    prisma.goalProgress.findMany({ where: { userId, updatedAt: { gt: cursor } } }),
    prisma.project.findMany({ where: { userId, updatedAt: { gt: cursor } } }),
    prisma.projectTask.findMany({ where: { project: { userId }, updatedAt: { gt: cursor } } }),
    prisma.projectPage.findMany({ where: { project: { userId }, updatedAt: { gt: cursor } } }),
    prisma.schedule.findMany({ where: { userId, updatedAt: { gt: cursor } } }),
    prisma.scheduleRow.findMany({ where: { schedule: { userId }, updatedAt: { gt: cursor } } }),
    prisma.calendarLegendCategory.findMany({ where: { userId, updatedAt: { gt: cursor } } }),
    prisma.calendarDayMark.findMany({ where: { userId, updatedAt: { gt: cursor } } }),
    prisma.customPage.findMany({ where: { userId, updatedAt: { gt: cursor } } }),
  ]);

  return {
    serverTime,
    // `withSharing` también quita `user`/`invitations` (las relaciones crudas que solo se pidieron
    // para calcularlo) — ver el mismo comentario en agendaService.ts.
    events: events.map((e) => agendaService.withSharing(e, userId)),
    eventExceptions,
    tasks,
    subtasks,
    notes,
    habits,
    habitLogs,
    tombstones,
    transactions,
    savingsGoals,
    goals,
    goalProgress,
    projects,
    projectTasks,
    projectPages,
    schedules,
    scheduleRows,
    calendarLegendCategories,
    calendarDayMarks,
    customPages,
  };
}

interface ConflictInfo {
  entityType: string;
  id: number;
}

interface IdMapping {
  entityType: string;
  localId: string;
  id: number;
}

export interface PushResult {
  idMappings: IdMapping[];
  conflicts: ConflictInfo[];
}

/**
 * Aplica una edición offline solo si es más reciente que la del servidor (last-write-wins) —
 * adecuado porque estos datos son de un único usuario entre sus propios dispositivos, no
 * colaborativos entre personas. `fetchCurrent` debe devolver `null` si la fila ya no existe o
 * no es del usuario (tratado igual que "no hay nada que actualizar", no como error — pudo
 * borrarse desde otro dispositivo mientras este estaba offline).
 */
async function applyIfNewer(
  fetchCurrent: () => Promise<{ userId: number; updatedAt: Date } | null>,
  userId: number,
  clientUpdatedAt: Date,
  apply: () => Promise<unknown>
): Promise<"applied" | "conflict" | "gone"> {
  const current = await fetchCurrent();
  if (!current || current.userId !== userId) return "gone";
  if (clientUpdatedAt.getTime() <= current.updatedAt.getTime()) return "conflict";
  await apply();
  return "applied";
}

// Los campos de sobre (localId / id / clientUpdatedAt / taskId) no son campos reales del
// modelo — se separan antes de pasarle el resto a los createX/updateX ya existentes.
function omit<T extends Record<string, unknown>>(obj: T, keys: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!keys.includes(key)) result[key] = value;
  }
  return result;
}

/**
 * Aplica un lote de cambios hechos offline. Sin éxito parcial: si un elemento falla (datos
 * inconsistentes, etc.), toda la petición falla y el cliente puede reintentar — mantiene la
 * semántica simple para un caso de uso de un único usuario, en vez de una respuesta con éxito
 * parcial por elemento.
 */
export async function push(userId: number, body: SyncPushBody): Promise<PushResult> {
  const idMappings: IdMapping[] = [];
  const conflicts: ConflictInfo[] = [];

  // --- Events ---
  for (const input of body.events.create) {
    const created = await agendaService.createEvent(userId, omit(input, ["localId"]) as never);
    idMappings.push({ entityType: "event", localId: input.localId, id: created.id });
  }
  for (const input of body.events.update) {
    const result = await applyIfNewer(
      () => prisma.event.findUnique({ where: { id: input.id } }),
      userId,
      new Date(input.clientUpdatedAt),
      () => agendaService.updateEvent(userId, input.id, omit(input, ["id", "clientUpdatedAt"]) as never)
    );
    if (result === "conflict") conflicts.push({ entityType: "event", id: input.id });
  }

  // --- Event exceptions (siempre upsert — se identifican por eventId+originalStartTime, no
  // por un id propio conocido de antemano por el cliente) ---
  for (const input of body.eventExceptions.upsert) {
    await agendaService.setEventException(userId, input.eventId, omit(input, ["eventId"]) as never);
  }

  // --- Tasks ---
  for (const input of body.tasks.create) {
    const created = await plannerService.createTask(userId, omit(input, ["localId"]) as never);
    idMappings.push({ entityType: "task", localId: input.localId, id: created.id });
  }
  for (const input of body.tasks.update) {
    const result = await applyIfNewer(
      () => prisma.task.findUnique({ where: { id: input.id } }),
      userId,
      new Date(input.clientUpdatedAt),
      () => plannerService.updateTask(userId, input.id, omit(input, ["id", "clientUpdatedAt"]) as never)
    );
    if (result === "conflict") conflicts.push({ entityType: "task", id: input.id });
  }

  // --- Subtasks --- (addSubtask solo admite título; si llega con `completed: true` de origen,
  // se completa en un segundo paso — es lo mismo que hacer dos peticiones desde la web)
  for (const input of body.subtasks.create) {
    const created = await plannerService.addSubtask(userId, input.taskId, input.title);
    if (input.completed) {
      await plannerService.updateSubtask(userId, input.taskId, created.id, { completed: true });
    }
    idMappings.push({ entityType: "subtask", localId: input.localId, id: created.id });
  }
  for (const input of body.subtasks.update) {
    const result = await applyIfNewer(
      async () => {
        const subtask = await prisma.subtask.findUnique({ where: { id: input.id }, include: { task: { select: { userId: true } } } });
        return subtask ? { userId: subtask.task.userId, updatedAt: subtask.updatedAt } : null;
      },
      userId,
      new Date(input.clientUpdatedAt),
      () => plannerService.updateSubtask(userId, input.taskId, input.id, omit(input, ["id", "taskId", "clientUpdatedAt"]) as never)
    );
    if (result === "conflict") conflicts.push({ entityType: "subtask", id: input.id });
  }

  // --- Notes ---
  for (const input of body.notes.create) {
    const created = await notesService.createNote(userId, input.content);
    if (input.checked) {
      await notesService.updateNote(userId, created.id, { checked: true });
    }
    idMappings.push({ entityType: "note", localId: input.localId, id: created.id });
  }
  for (const input of body.notes.update) {
    const result = await applyIfNewer(
      () => prisma.note.findUnique({ where: { id: input.id } }),
      userId,
      new Date(input.clientUpdatedAt),
      () => notesService.updateNote(userId, input.id, omit(input, ["id", "clientUpdatedAt"]) as never)
    );
    if (result === "conflict") conflicts.push({ entityType: "note", id: input.id });
  }

  // --- Habits ---
  for (const input of body.habits.create) {
    const created = await habitsService.createHabit(userId, input.title);
    idMappings.push({ entityType: "habit", localId: input.localId, id: created.id });
  }
  for (const input of body.habits.update) {
    const result = await applyIfNewer(
      () => prisma.habit.findUnique({ where: { id: input.id } }),
      userId,
      new Date(input.clientUpdatedAt),
      () => habitsService.updateHabit(userId, input.id, input.title)
    );
    if (result === "conflict") conflicts.push({ entityType: "habit", id: input.id });
  }

  // --- HabitLogs --- (alta idempotente: si el día ya estaba marcado, no hace nada — evita
  // usar toggleHabitDay directamente, que DESMARCARÍA un día ya marcado por error de carrera)
  for (const input of body.habitLogs.create) {
    const date = new Date(input.date);
    const existing = await prisma.habitLog.findUnique({ where: { habitId_date: { habitId: input.habitId, date } } });
    if (existing) continue;
    const habit = await prisma.habit.findUnique({ where: { id: input.habitId } });
    if (!habit || habit.userId !== userId) continue; // no es tuyo o ya no existe — se ignora, no es un error de sync
    await prisma.habitLog.create({ data: { habitId: input.habitId, userId, date } });
  }

  // --- Transactions ---
  for (const input of body.transactions.create) {
    const created = await financeService.createTransaction(userId, omit(input, ["localId"]) as never);
    idMappings.push({ entityType: "transaction", localId: input.localId, id: created.id });
  }
  for (const input of body.transactions.update) {
    const result = await applyIfNewer(
      () => prisma.transaction.findUnique({ where: { id: input.id } }),
      userId,
      new Date(input.clientUpdatedAt),
      () => financeService.updateTransaction(userId, input.id, omit(input, ["id", "clientUpdatedAt"]) as never)
    );
    if (result === "conflict") conflicts.push({ entityType: "transaction", id: input.id });
  }

  // --- SavingsGoals ---
  for (const input of body.savingsGoals.create) {
    const created = await financeService.createSavingsGoal(userId, omit(input, ["localId"]) as never);
    idMappings.push({ entityType: "savingsGoal", localId: input.localId, id: created.id });
  }
  for (const input of body.savingsGoals.update) {
    const result = await applyIfNewer(
      () => prisma.savingsGoal.findUnique({ where: { id: input.id } }),
      userId,
      new Date(input.clientUpdatedAt),
      () => financeService.updateSavingsGoal(userId, input.id, omit(input, ["id", "clientUpdatedAt"]) as never)
    );
    if (result === "conflict") conflicts.push({ entityType: "savingsGoal", id: input.id });
  }

  // --- Goals ---
  for (const input of body.goals.create) {
    const created = await goalsService.createGoal(userId, omit(input, ["localId"]) as never);
    idMappings.push({ entityType: "goal", localId: input.localId, id: created.id });
  }
  for (const input of body.goals.update) {
    const result = await applyIfNewer(
      () => prisma.goal.findUnique({ where: { id: input.id } }),
      userId,
      new Date(input.clientUpdatedAt),
      () => goalsService.updateGoal(userId, input.id, omit(input, ["id", "clientUpdatedAt"]) as never)
    );
    if (result === "conflict") conflicts.push({ entityType: "goal", id: input.id });
  }

  // --- GoalProgress --- (a diferencia de HabitLog, SÍ se edita/borra offline — ver
  // goalsService.updateProgress/deleteProgress, que revierten currentValue de la meta)
  for (const input of body.goalProgress.create) {
    const created = await goalsService.registerProgress(userId, input.goalId, omit(input, ["localId", "goalId"]) as never);
    idMappings.push({ entityType: "goalProgress", localId: input.localId, id: created.progress.id });
  }
  for (const input of body.goalProgress.update) {
    const result = await applyIfNewer(
      () => prisma.goalProgress.findUnique({ where: { id: input.id } }),
      userId,
      new Date(input.clientUpdatedAt),
      () => goalsService.updateProgress(userId, input.goalId, input.id, omit(input, ["id", "clientUpdatedAt", "goalId"]) as never)
    );
    if (result === "conflict") conflicts.push({ entityType: "goalProgress", id: input.id });
  }

  // --- Projects ---
  for (const input of body.projects.create) {
    const created = await projectsService.createProject(userId, omit(input, ["localId"]) as never);
    idMappings.push({ entityType: "project", localId: input.localId, id: created.id });
  }
  for (const input of body.projects.update) {
    const result = await applyIfNewer(
      () => prisma.project.findUnique({ where: { id: input.id } }),
      userId,
      new Date(input.clientUpdatedAt),
      () => projectsService.updateProject(userId, input.id, omit(input, ["id", "clientUpdatedAt"]) as never)
    );
    if (result === "conflict") conflicts.push({ entityType: "project", id: input.id });
  }

  // --- ProjectTasks --- (addTask/updateTask solo admiten título; completed se aplica en un
  // segundo paso, igual patrón que subtasks/notes)
  for (const input of body.projectTasks.create) {
    const created = await projectsService.addTask(userId, input.projectId, input.title);
    if (input.completed) {
      await projectsService.setTaskCompleted(userId, input.projectId, created.id, true);
    }
    idMappings.push({ entityType: "projectTask", localId: input.localId, id: created.id });
  }
  for (const input of body.projectTasks.update) {
    const result = await applyIfNewer(
      async () => {
        const task = await prisma.projectTask.findUnique({ where: { id: input.id }, include: { project: { select: { userId: true } } } });
        return task ? { userId: task.project.userId, updatedAt: task.updatedAt } : null;
      },
      userId,
      new Date(input.clientUpdatedAt),
      async () => {
        await projectsService.updateTask(userId, input.projectId, input.id, input.title);
        if (input.completed !== undefined) {
          await projectsService.setTaskCompleted(userId, input.projectId, input.id, input.completed);
        }
      }
    );
    if (result === "conflict") conflicts.push({ entityType: "projectTask", id: input.id });
  }

  // --- ProjectPages --- (content es un blob HTML opaco, LWW por clientUpdatedAt igual que Note)
  for (const input of body.projectPages.create) {
    const created = await projectsService.addPage(userId, input.projectId, omit(input, ["localId", "projectId"]) as never);
    idMappings.push({ entityType: "projectPage", localId: input.localId, id: created.id });
  }
  for (const input of body.projectPages.update) {
    const result = await applyIfNewer(
      async () => {
        const page = await prisma.projectPage.findUnique({ where: { id: input.id }, include: { project: { select: { userId: true } } } });
        return page ? { userId: page.project.userId, updatedAt: page.updatedAt } : null;
      },
      userId,
      new Date(input.clientUpdatedAt),
      () => projectsService.updatePage(userId, input.projectId, input.id, omit(input, ["id", "clientUpdatedAt", "projectId"]) as never)
    );
    if (result === "conflict") conflicts.push({ entityType: "projectPage", id: input.id });
  }

  // --- Schedules ---
  for (const input of body.schedules.create) {
    const created = await scheduleService.createSchedule(userId, input.name);
    idMappings.push({ entityType: "schedule", localId: input.localId, id: created.id });
  }
  for (const input of body.schedules.update) {
    const result = await applyIfNewer(
      () => prisma.schedule.findUnique({ where: { id: input.id } }),
      userId,
      new Date(input.clientUpdatedAt),
      () => scheduleService.updateSchedule(userId, input.id, omit(input, ["id", "clientUpdatedAt"]) as never)
    );
    if (result === "conflict") conflicts.push({ entityType: "schedule", id: input.id });
  }

  // --- ScheduleRows --- (addRow solo admite timeLabel; si la fila offline ya traía celdas/order
  // rellenos, se aplican en un segundo paso con updateRow — mismo patrón que ProjectTasks)
  for (const input of body.scheduleRows.create) {
    const created = await scheduleService.addRow(userId, input.scheduleId, input.timeLabel);
    const rest = omit(input, ["localId", "scheduleId", "timeLabel"]);
    if (Object.keys(rest).length > 0) {
      await scheduleService.updateRow(userId, input.scheduleId, created.id, rest as never);
    }
    idMappings.push({ entityType: "scheduleRow", localId: input.localId, id: created.id });
  }
  for (const input of body.scheduleRows.update) {
    const result = await applyIfNewer(
      async () => {
        const row = await prisma.scheduleRow.findUnique({ where: { id: input.id }, include: { schedule: { select: { userId: true } } } });
        return row ? { userId: row.schedule.userId, updatedAt: row.updatedAt } : null;
      },
      userId,
      new Date(input.clientUpdatedAt),
      () => scheduleService.updateRow(userId, input.scheduleId, input.id, omit(input, ["id", "clientUpdatedAt", "scheduleId"]) as never)
    );
    if (result === "conflict") conflicts.push({ entityType: "scheduleRow", id: input.id });
  }

  // --- CalendarLegendCategories ---
  for (const input of body.calendarLegendCategories.create) {
    const created = await calendarLegendService.createCategory(userId, input.label, input.color);
    idMappings.push({ entityType: "calendarLegendCategory", localId: input.localId, id: created.id });
  }
  for (const input of body.calendarLegendCategories.update) {
    const result = await applyIfNewer(
      () => prisma.calendarLegendCategory.findUnique({ where: { id: input.id } }),
      userId,
      new Date(input.clientUpdatedAt),
      () => calendarLegendService.updateCategory(userId, input.id, omit(input, ["id", "clientUpdatedAt"]) as never)
    );
    if (result === "conflict") conflicts.push({ entityType: "calendarLegendCategory", id: input.id });
  }

  // --- CalendarDayMarks --- (upsert por fecha, siempre gana el último — igual criterio que
  // agendaService.setEventException; "borrar" un día va por `deletes` y sí genera tombstone,
  // ver calendarLegendService.setDayMark)
  for (const input of body.calendarDayMarks.upsert) {
    await calendarLegendService.setDayMark(userId, input.date, input.categoryId);
  }

  // --- CustomPages --- (content es un blob JSON por plantilla, opaco para el sync — LWW por
  // clientUpdatedAt igual que Note/ProjectPage; las plantillas "finanzas"/"objetivos"/"agenda"
  // de una página personalizada son snapshots independientes, no se cruzan con
  // Transaction/Goal/Event reales)
  for (const input of body.customPages.create) {
    const created = await customPagesService.createCustomPage(userId, input.title, input.template);
    idMappings.push({ entityType: "customPage", localId: input.localId, id: created.id });
  }
  for (const input of body.customPages.update) {
    const result = await applyIfNewer(
      () => prisma.customPage.findUnique({ where: { id: input.id } }),
      userId,
      new Date(input.clientUpdatedAt),
      () => customPagesService.updateCustomPage(userId, input.id, omit(input, ["id", "clientUpdatedAt"]) as never)
    );
    if (result === "conflict") conflicts.push({ entityType: "customPage", id: input.id });
  }

  // --- Deletes ---
  for (const del of body.deletes) {
    try {
      if (del.entityType === "event") await agendaService.deleteEvent(userId, del.id);
      else if (del.entityType === "task") await plannerService.deleteTask(userId, del.id);
      else if (del.entityType === "note") await notesService.deleteNote(userId, del.id);
      else if (del.entityType === "habit") await habitsService.deleteHabit(userId, del.id);
      else if (del.entityType === "subtask") await plannerService.deleteSubtask(userId, del.taskId, del.id);
      else if (del.entityType === "eventException") {
        await agendaService.deleteEventException(userId, del.eventId, del.originalStartTime);
      } else if (del.entityType === "habitLog") {
        const date = new Date(del.date);
        const existing = await prisma.habitLog.findUnique({ where: { habitId_date: { habitId: del.habitId, date } } });
        if (existing) await habitsService.toggleHabitDay(userId, del.habitId, del.date);
      } else if (del.entityType === "transaction") await financeService.deleteTransaction(userId, del.id);
      else if (del.entityType === "savingsGoal") await financeService.deleteSavingsGoal(userId, del.id);
      else if (del.entityType === "goal") await goalsService.deleteGoal(userId, del.id);
      else if (del.entityType === "goalProgress") await goalsService.deleteProgress(userId, del.goalId, del.id);
      else if (del.entityType === "project") await projectsService.deleteProject(userId, del.id);
      else if (del.entityType === "projectTask") await projectsService.deleteTask(userId, del.projectId, del.id);
      else if (del.entityType === "projectPage") await projectsService.deletePage(userId, del.projectId, del.id);
      else if (del.entityType === "schedule") await scheduleService.deleteSchedule(userId, del.id);
      else if (del.entityType === "scheduleRow") await scheduleService.deleteRow(userId, del.scheduleId, del.id);
      else if (del.entityType === "calendarLegendCategory") await calendarLegendService.deleteCategory(userId, del.id);
      else if (del.entityType === "calendarDayMark") await calendarLegendService.setDayMark(userId, del.date, null);
      else if (del.entityType === "customPage") await customPagesService.deleteCustomPage(userId, del.id);
    } catch (error) {
      // Ya borrado desde otro dispositivo (NotFoundError) — idempotente, no es un fallo del
      // push. Cualquier otro error (p.ej. ForbiddenError) sí se propaga.
      if ((error as { statusCode?: number }).statusCode !== 404) throw error;
    }
  }

  logger.info(`sync push: ${idMappings.length} creado(s), ${conflicts.length} conflicto(s)`, { userId });
  return { idMappings, conflicts };
}

// Formas de entrada aceptadas por `push` — ya validadas por syncValidators.syncPushSchema antes
// de llegar aquí (stripUnknown + reglas por campo); estos tipos son deliberadamente laxos
// (`Record<string, unknown>` en los envoltorios) porque el resto de campos varía por sub-tipo y
// ya se reenvían tal cual a los servicios existentes, que son quienes de verdad los validan de
// forma estructural en tiempo de ejecución.
interface CreateEnvelope {
  localId: string;
  [key: string]: unknown;
}
interface UpdateEnvelope {
  id: number;
  clientUpdatedAt: string;
  [key: string]: unknown;
}
interface SyncPushBody {
  events: { create: CreateEnvelope[]; update: UpdateEnvelope[] };
  eventExceptions: { upsert: { eventId: number; [key: string]: unknown }[] };
  tasks: { create: CreateEnvelope[]; update: UpdateEnvelope[] };
  subtasks: {
    create: (CreateEnvelope & { taskId: number; title: string; completed?: boolean })[];
    update: (UpdateEnvelope & { taskId: number })[];
  };
  notes: { create: (CreateEnvelope & { content: string; checked?: boolean })[]; update: UpdateEnvelope[] };
  habits: { create: (CreateEnvelope & { title: string })[]; update: (UpdateEnvelope & { title: string })[] };
  habitLogs: { create: { habitId: number; date: string }[] };
  // --- Fase 2 de sync ---
  transactions: { create: CreateEnvelope[]; update: UpdateEnvelope[] };
  savingsGoals: { create: CreateEnvelope[]; update: UpdateEnvelope[] };
  goals: { create: CreateEnvelope[]; update: UpdateEnvelope[] };
  goalProgress: {
    create: (CreateEnvelope & { goalId: number })[];
    update: (UpdateEnvelope & { goalId: number })[];
  };
  projects: { create: CreateEnvelope[]; update: UpdateEnvelope[] };
  projectTasks: {
    create: (CreateEnvelope & { projectId: number; title: string; completed?: boolean })[];
    update: (UpdateEnvelope & { projectId: number; title: string; completed?: boolean })[];
  };
  projectPages: {
    create: (CreateEnvelope & { projectId: number })[];
    update: (UpdateEnvelope & { projectId: number })[];
  };
  schedules: { create: (CreateEnvelope & { name: string })[]; update: UpdateEnvelope[] };
  scheduleRows: {
    create: (CreateEnvelope & { scheduleId: number; timeLabel?: string })[];
    update: (UpdateEnvelope & { scheduleId: number })[];
  };
  calendarLegendCategories: {
    create: (CreateEnvelope & { label: string; color: string })[];
    update: UpdateEnvelope[];
  };
  calendarDayMarks: { upsert: { date: string; categoryId: number }[] };
  customPages: { create: (CreateEnvelope & { title: string; template: string })[]; update: UpdateEnvelope[] };
  deletes: (
    | {
        entityType:
          | "event"
          | "task"
          | "note"
          | "habit"
          | "transaction"
          | "savingsGoal"
          | "goal"
          | "project"
          | "schedule"
          | "calendarLegendCategory"
          | "customPage";
        id: number;
      }
    | { entityType: "subtask"; id: number; taskId: number }
    | { entityType: "eventException"; eventId: number; originalStartTime: string }
    | { entityType: "habitLog"; habitId: number; date: string }
    | { entityType: "goalProgress"; id: number; goalId: number }
    | { entityType: "projectTask" | "projectPage"; id: number; projectId: number }
    | { entityType: "scheduleRow"; id: number; scheduleId: number }
    | { entityType: "calendarDayMark"; date: string }
  )[];
}
