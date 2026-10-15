import { api } from "../api/client";
import {
  listUnsyncedEvents,
  listEventsPendingUpdate,
  listEventsPendingDelete,
  markEventSynced,
  clearEventPendingOp,
  deleteEventRow,
  parseEvent,
} from "../db/eventsRepo";
import {
  listUnsyncedTasks,
  listTasksPendingUpdate,
  listTasksPendingDelete,
  markTaskSynced,
  clearTaskPendingOp,
  deleteTaskRow,
  parseTaskTags,
} from "../db/tasksRepo";
import {
  listUnsyncedSubtasksReadyToPush,
  listSubtasksPendingUpdate,
  listSubtasksPendingDelete,
  markSubtaskSynced,
  clearSubtaskPendingOp,
  deleteSubtaskRow,
} from "../db/subtasksRepo";
import {
  listPendingHabitLogs,
  confirmHabitLogCreated,
  confirmHabitLogDeleted,
  listUnsyncedHabits,
  listHabitsPendingUpdate,
  listHabitsPendingDelete,
  markHabitSynced,
  clearHabitPendingOp,
  deleteHabitRow,
} from "../db/habitsRepo";
import {
  listExceptionsPendingUpsert,
  listExceptionsPendingDelete,
  confirmExceptionUpserted,
  confirmExceptionDeleted,
} from "../db/eventExceptionsRepo";
import {
  listUnsyncedNotes,
  listNotesPendingUpdate,
  listNotesPendingDelete,
  markNoteSynced,
  clearNotePendingOp,
  deleteNoteRow,
} from "../db/notesRepo";
import {
  listUnsyncedTransactions,
  listTransactionsPendingUpdate,
  listTransactionsPendingDelete,
  markTransactionSynced,
  clearTransactionPendingOp,
  deleteTransactionRow,
} from "../db/transactionsRepo";
import {
  listUnsyncedSavingsGoals,
  listSavingsGoalsPendingUpdate,
  listSavingsGoalsPendingDelete,
  markSavingsGoalSynced,
  clearSavingsGoalPendingOp,
  deleteSavingsGoalRow,
} from "../db/savingsGoalsRepo";
import { listUnsyncedGoals, listGoalsPendingUpdate, listGoalsPendingDelete, markGoalSynced, clearGoalPendingOp, deleteGoalRow } from "../db/goalsRepo";
import {
  listUnsyncedProgressReadyToPush,
  listProgressPendingUpdate,
  listProgressPendingDelete,
  markProgressSynced,
  clearProgressPendingOp,
  deleteProgressRow,
} from "../db/goalProgressRepo";
import {
  listUnsyncedProjects,
  listProjectsPendingUpdate,
  listProjectsPendingDelete,
  markProjectSynced,
  clearProjectPendingOp,
  deleteProjectRow,
} from "../db/projectsRepo";
import {
  listUnsyncedProjectTasksReadyToPush,
  listProjectTasksPendingUpdate,
  listProjectTasksPendingDelete,
  markProjectTaskSynced,
  clearProjectTaskPendingOp,
  deleteProjectTaskRow,
} from "../db/projectTasksRepo";
import {
  listUnsyncedProjectPagesReadyToPush,
  listProjectPagesPendingUpdate,
  listProjectPagesPendingDelete,
  markProjectPageSynced,
  clearProjectPagePendingOp,
  deleteProjectPageRow,
} from "../db/projectPagesRepo";
import {
  listUnsyncedSchedules,
  listSchedulesPendingUpdate,
  listSchedulesPendingDelete,
  markScheduleSynced,
  clearSchedulePendingOp,
  deleteScheduleDbRow,
} from "../db/scheduleRepo";
import {
  listUnsyncedRowsReadyToPush,
  listRowsPendingUpdate,
  listRowsPendingDelete,
  markRowSynced,
  clearRowPendingOp,
  deleteRowDbRow,
} from "../db/scheduleRowsRepo";
import {
  listUnsyncedCategories,
  listCategoriesPendingUpdate,
  listCategoriesPendingDelete,
  markCategorySynced,
  clearCategoryPendingOp,
  deleteCategoryRow,
  listMarksPendingUpsert,
  listMarksPendingDelete,
  confirmMarkUpserted,
  confirmMarkDeleted,
} from "../db/calendarLegendRepo";
import {
  listUnsyncedCustomPages,
  listCustomPagesPendingUpdate,
  listCustomPagesPendingDelete,
  markCustomPageSynced,
  clearCustomPagePendingOp,
  deleteCustomPageRow,
} from "../db/customPagesRepo";
import { PushResult } from "../types";

/** Sube todo lo pendiente en un único lote (mismo contrato que `syncService.push` en el backend
 * — ver API.md). Eventos/tareas/subtareas siguen el mismo patrón que las notas: creadas offline
 * (`localId` uuid) o editadas (`id` de servidor + `clientUpdatedAt` para el last-write-wins).
 * Devuelve cuántos cambios ha rechazado el servidor: siguen pendientes en local. */
export async function pushToServer(allowFollowUp = true): Promise<number> {
  const [
    newEvents,
    updatedEvents,
    deletedEvents,
    newTasks,
    updatedTasks,
    deletedTasks,
    newSubtasks,
    updatedSubtasks,
    deletedSubtasks,
    pendingLogs,
    newHabits,
    updatedHabits,
    deletedHabits,
    pendingExceptionUpserts,
    pendingExceptionDeletes,
    newNotes,
    updatedNotes,
    deletedNotes,
    newTransactions,
    updatedTransactions,
    deletedTransactions,
    newSavingsGoals,
    updatedSavingsGoals,
    deletedSavingsGoals,
    newGoals,
    updatedGoals,
    deletedGoals,
    newProgress,
    updatedProgress,
    deletedProgress,
    newProjects,
    updatedProjects,
    deletedProjects,
    newProjectTasks,
    updatedProjectTasks,
    deletedProjectTasks,
    newProjectPages,
    updatedProjectPages,
    deletedProjectPages,
    newSchedules,
    updatedSchedules,
    deletedSchedules,
    newRows,
    updatedRows,
    deletedRows,
    newCategories,
    updatedCategories,
    deletedCategories,
    pendingMarkUpserts,
    pendingMarkDeletes,
    newCustomPages,
    updatedCustomPages,
    deletedCustomPages,
  ] = await Promise.all([
    listUnsyncedEvents(),
    listEventsPendingUpdate(),
    listEventsPendingDelete(),
    listUnsyncedTasks(),
    listTasksPendingUpdate(),
    listTasksPendingDelete(),
    listUnsyncedSubtasksReadyToPush(),
    listSubtasksPendingUpdate(),
    listSubtasksPendingDelete(),
    listPendingHabitLogs(),
    listUnsyncedHabits(),
    listHabitsPendingUpdate(),
    listHabitsPendingDelete(),
    listExceptionsPendingUpsert(),
    listExceptionsPendingDelete(),
    listUnsyncedNotes(),
    listNotesPendingUpdate(),
    listNotesPendingDelete(),
    listUnsyncedTransactions(),
    listTransactionsPendingUpdate(),
    listTransactionsPendingDelete(),
    listUnsyncedSavingsGoals(),
    listSavingsGoalsPendingUpdate(),
    listSavingsGoalsPendingDelete(),
    listUnsyncedGoals(),
    listGoalsPendingUpdate(),
    listGoalsPendingDelete(),
    listUnsyncedProgressReadyToPush(),
    listProgressPendingUpdate(),
    listProgressPendingDelete(),
    listUnsyncedProjects(),
    listProjectsPendingUpdate(),
    listProjectsPendingDelete(),
    listUnsyncedProjectTasksReadyToPush(),
    listProjectTasksPendingUpdate(),
    listProjectTasksPendingDelete(),
    listUnsyncedProjectPagesReadyToPush(),
    listProjectPagesPendingUpdate(),
    listProjectPagesPendingDelete(),
    listUnsyncedSchedules(),
    listSchedulesPendingUpdate(),
    listSchedulesPendingDelete(),
    listUnsyncedRowsReadyToPush(),
    listRowsPendingUpdate(),
    listRowsPendingDelete(),
    listUnsyncedCategories(),
    listCategoriesPendingUpdate(),
    listCategoriesPendingDelete(),
    listMarksPendingUpsert(),
    listMarksPendingDelete(),
    listUnsyncedCustomPages(),
    listCustomPagesPendingUpdate(),
    listCustomPagesPendingDelete(),
  ]);

  const hasChanges =
    newEvents.length ||
    updatedEvents.length ||
    deletedEvents.length ||
    newTasks.length ||
    updatedTasks.length ||
    deletedTasks.length ||
    newSubtasks.length ||
    updatedSubtasks.length ||
    deletedSubtasks.length ||
    pendingLogs.length ||
    newHabits.length ||
    updatedHabits.length ||
    deletedHabits.length ||
    pendingExceptionUpserts.length ||
    pendingExceptionDeletes.length ||
    newNotes.length ||
    updatedNotes.length ||
    deletedNotes.length ||
    newTransactions.length ||
    updatedTransactions.length ||
    deletedTransactions.length ||
    newSavingsGoals.length ||
    updatedSavingsGoals.length ||
    deletedSavingsGoals.length ||
    newGoals.length ||
    updatedGoals.length ||
    deletedGoals.length ||
    newProgress.length ||
    updatedProgress.length ||
    deletedProgress.length ||
    newProjects.length ||
    updatedProjects.length ||
    deletedProjects.length ||
    newProjectTasks.length ||
    updatedProjectTasks.length ||
    deletedProjectTasks.length ||
    newProjectPages.length ||
    updatedProjectPages.length ||
    deletedProjectPages.length ||
    newSchedules.length ||
    updatedSchedules.length ||
    deletedSchedules.length ||
    newRows.length ||
    updatedRows.length ||
    deletedRows.length ||
    newCategories.length ||
    updatedCategories.length ||
    deletedCategories.length ||
    pendingMarkUpserts.length ||
    pendingMarkDeletes.length ||
    newCustomPages.length ||
    updatedCustomPages.length ||
    deletedCustomPages.length;
  if (!hasChanges) return 0;

  const habitLogCreates = pendingLogs.filter((l) => l.pending === "create").map((l) => ({ habitId: l.habitId, date: l.date }));
  const habitLogDeletes = pendingLogs
    .filter((l) => l.pending === "delete")
    .map((l) => ({ entityType: "habitLog" as const, habitId: l.habitId, date: l.date }));

  // Solo tareas/subtareas ya sincronizadas (id numérico real) pueden borrarse en el servidor —
  // una fila `synced = 0` nunca llegó a existir ahí, así que su borrado ya se resolvió sin más en
  // `deleteEventLocal`/`deleteTaskLocal`/`deleteSubtaskLocal` (nunca llega hasta aquí).
  // Cada borrado va junto a lo que hay que hacer en local cuando el servidor lo confirma: su
  // posición en `body.deletes` es la que usa el servidor para decir cuáles han fallado.
  const deleteOps: { payload: Record<string, unknown>; confirm: () => Promise<unknown> }[] = [
    ...deletedEvents
      .filter((e) => e.synced === 1)
      .map((e) => ({ payload: { entityType: "event", id: Number(e.id) }, confirm: () => deleteEventRow(e.id) })),
    ...deletedTasks
      .filter((t) => t.synced === 1)
      .map((t) => ({ payload: { entityType: "task", id: Number(t.id) }, confirm: () => deleteTaskRow(t.id) })),
    ...deletedSubtasks.filter((s) => s.synced === 1).map((s) => ({
      payload: { entityType: "subtask", id: Number(s.id), taskId: Number(s.taskId) },
      confirm: () => deleteSubtaskRow(s.id),
    })),
    ...deletedNotes
      .filter((n) => n.synced === 1)
      .map((n) => ({ payload: { entityType: "note", id: Number(n.id) }, confirm: () => deleteNoteRow(n.id) })),
    ...habitLogDeletes.map((l) => ({ payload: l, confirm: () => confirmHabitLogDeleted(l.habitId, l.date) })),
    ...deletedHabits.map((h) => ({ payload: { entityType: "habit", id: h.id }, confirm: () => deleteHabitRow(h.id) })),
    // "Restaurar horario original" — se identifica por (eventId, originalStartTime).
    ...pendingExceptionDeletes.map((x) => ({
      payload: { entityType: "eventException", eventId: Number(x.eventId), originalStartTime: x.originalStartTime },
      confirm: () => confirmExceptionDeleted(x.eventId, x.originalStartTime),
    })),
    ...deletedTransactions
      .filter((t) => t.synced === 1)
      .map((t) => ({ payload: { entityType: "transaction", id: Number(t.id) }, confirm: () => deleteTransactionRow(t.id) })),
    ...deletedSavingsGoals
      .filter((g) => g.synced === 1)
      .map((g) => ({ payload: { entityType: "savingsGoal", id: Number(g.id) }, confirm: () => deleteSavingsGoalRow(g.id) })),
    ...deletedGoals
      .filter((g) => g.synced === 1)
      .map((g) => ({ payload: { entityType: "goal", id: Number(g.id) }, confirm: () => deleteGoalRow(g.id) })),
    ...deletedProgress.filter((p) => p.synced === 1).map((p) => ({
      payload: { entityType: "goalProgress", id: Number(p.id), goalId: Number(p.goalId) },
      confirm: () => deleteProgressRow(p.id),
    })),
    ...deletedProjects
      .filter((p) => p.synced === 1)
      .map((p) => ({ payload: { entityType: "project", id: Number(p.id) }, confirm: () => deleteProjectRow(p.id) })),
    ...deletedProjectTasks.filter((t) => t.synced === 1).map((t) => ({
      payload: { entityType: "projectTask", id: Number(t.id), projectId: Number(t.projectId) },
      confirm: () => deleteProjectTaskRow(t.id),
    })),
    ...deletedProjectPages.filter((p) => p.synced === 1).map((p) => ({
      payload: { entityType: "projectPage", id: Number(p.id), projectId: Number(p.projectId) },
      confirm: () => deleteProjectPageRow(p.id),
    })),
    ...deletedSchedules
      .filter((s) => s.synced === 1)
      .map((s) => ({ payload: { entityType: "schedule", id: Number(s.id) }, confirm: () => deleteScheduleDbRow(s.id) })),
    ...deletedRows.filter((r) => r.synced === 1).map((r) => ({
      payload: { entityType: "scheduleRow", id: Number(r.id), scheduleId: Number(r.scheduleId) },
      confirm: () => deleteRowDbRow(r.id),
    })),
    ...deletedCategories
      .filter((c) => c.synced === 1)
      .map((c) => ({ payload: { entityType: "calendarLegendCategory", id: Number(c.id) }, confirm: () => deleteCategoryRow(c.id) })),
    ...pendingMarkDeletes.map((m) => ({ payload: { entityType: "calendarDayMark", date: m.date }, confirm: () => confirmMarkDeleted(m.date) })),
    ...deletedCustomPages
      .filter((p) => p.synced === 1)
      .map((p) => ({ payload: { entityType: "customPage", id: Number(p.id) }, confirm: () => deleteCustomPageRow(p.id) })),
  ];

  const body = {
    events: {
      create: newEvents.map((e) => {
        const p = parseEvent(e);
        return {
          localId: e.id,
          title: p.title,
          description: p.description,
          categoryId: p.categoryId,
          startTime: p.startTime,
          endTime: p.endTime,
          location: p.location,
          isRecurring: p.isRecurring,
          recurringPattern: p.recurringPattern,
          recurringWeekdayStart: p.recurringWeekdayStart,
          recurringWeekdayEnd: p.recurringWeekdayEnd,
          reminderMinutesBefore: p.reminderMinutesBefore,
          guests: p.guests,
        };
      }),
      update: updatedEvents.map((e) => {
        const p = parseEvent(e);
        return {
          id: Number(e.id),
          clientUpdatedAt: e.updatedAt,
          title: p.title,
          description: p.description,
          categoryId: p.categoryId,
          startTime: p.startTime,
          endTime: p.endTime,
          location: p.location,
          isRecurring: p.isRecurring,
          recurringPattern: p.recurringPattern,
          recurringWeekdayStart: p.recurringWeekdayStart,
          recurringWeekdayEnd: p.recurringWeekdayEnd,
          reminderMinutesBefore: p.reminderMinutesBefore,
          guests: p.guests,
        };
      }),
    },
    tasks: {
      // plannerId solo en `create`: createTaskSchema ya lo acepta opcional en el backend (si
      // falta, cae en getOrCreateDefaultPlanner — ver plannerService.ts) y updateTaskSchema no
      // tiene ese campo en absoluto (mover una tarea de tablero no existe todavía, ni en el móvil
      // ni en la web), así que `update` no lo lleva.
      create: newTasks.map((t) => ({
        localId: t.id,
        ...(t.plannerId != null ? { plannerId: t.plannerId } : {}),
        title: t.title,
        description: t.description,
        image: t.image,
        notes: t.notes,
        compact: t.compact === 1,
        // projectId solo si hay uno (createTaskSchema lo acepta opcional y nullable) — el proyecto
        // siempre tiene id numérico de servidor aquí: la UI solo ofrece proyectos ya sincronizados.
        ...(t.projectId != null ? { projectId: t.projectId } : {}),
        status: t.status,
        priority: t.priority,
        order: t.order,
        dueDate: t.dueDate,
        estimatedMinutes: t.estimatedMinutes,
        tags: parseTaskTags(t),
      })),
      update: updatedTasks.map((t) => ({
        id: Number(t.id),
        clientUpdatedAt: t.updatedAt,
        title: t.title,
        description: t.description,
        image: t.image,
        notes: t.notes,
        compact: t.compact === 1,
        // null explícito = "Sin proyecto" (updateTaskSchema lo admite y plannerService.updateTask lo guarda).
        projectId: t.projectId,
        status: t.status,
        priority: t.priority,
        order: t.order,
        dueDate: t.dueDate,
        estimatedMinutes: t.estimatedMinutes,
        tags: parseTaskTags(t),
      })),
    },
    subtasks: {
      create: newSubtasks.map((s) => ({ localId: s.id, taskId: Number(s.taskId), title: s.title, completed: s.completed === 1 })),
      update: updatedSubtasks.map((s) => ({
        id: Number(s.id),
        taskId: Number(s.taskId),
        clientUpdatedAt: s.updatedAt,
        title: s.title,
        completed: s.completed === 1,
      })),
    },
    notes: {
      create: newNotes.map((n) => ({ localId: n.id, content: n.content, checked: n.checked === 1 })),
      update: updatedNotes.map((n) => ({ id: Number(n.id), clientUpdatedAt: n.updatedAt, content: n.content, checked: n.checked === 1 })),
    },
    // Hábitos creados/renombrados offline (el borrado va por `deletes`). Las marcas diarias de un
    // hábito que aún no tiene id de servidor esperan a la siguiente ronda (ver listPendingHabitLogs).
    habits: {
      create: newHabits.map((h) => ({ localId: h.localId as string, title: h.title })),
      update: updatedHabits.map((h) => ({ id: h.id, clientUpdatedAt: h.updatedAt, title: h.title })),
    },
    habitLogs: { create: habitLogCreates },
    // "Mover/Cancelar solo esta vez": siempre upsert por (eventId, originalStartTime). Solo las de
    // eventos ya sincronizados (ver listExceptionsPendingUpsert); `newStartTime/newEndTime` solo con
    // "moved" — setExceptionSchema los prohíbe en "cancelled".
    eventExceptions: {
      upsert: pendingExceptionUpserts.map((x) => ({
        eventId: Number(x.eventId),
        originalStartTime: x.originalStartTime,
        action: x.status,
        ...(x.status === "moved" ? { newStartTime: x.newStartTime, newEndTime: x.newEndTime } : {}),
      })),
    },
    transactions: {
      create: newTransactions.map((t) => ({
        localId: t.id,
        type: t.type,
        amount: t.amount,
        category: t.category,
        description: t.description,
        date: t.date,
      })),
      update: updatedTransactions.map((t) => ({
        id: Number(t.id),
        clientUpdatedAt: t.updatedAt,
        type: t.type,
        amount: t.amount,
        category: t.category,
        description: t.description,
        date: t.date,
      })),
    },
    savingsGoals: {
      create: newSavingsGoals.map((g) => ({
        localId: g.id,
        name: g.name,
        type: g.type,
        targetAmount: g.targetAmount,
        category: g.category,
        stepAmount: g.stepAmount,
        deadline: g.deadline,
      })),
      update: updatedSavingsGoals.map((g) => ({
        id: Number(g.id),
        clientUpdatedAt: g.updatedAt,
        name: g.name,
        type: g.type,
        targetAmount: g.targetAmount,
        category: g.category,
        stepAmount: g.stepAmount,
        deadline: g.deadline,
      })),
    },
    goals: {
      create: newGoals.map((g) => ({
        localId: g.id,
        title: g.title,
        description: g.description,
        period: g.period,
        targetValue: g.targetValue,
        bonusPoints: g.bonusPoints,
        periodStart: g.periodStart,
        periodEnd: g.periodEnd,
        autoRenew: g.autoRenew === 1,
      })),
      update: updatedGoals.map((g) => ({
        id: Number(g.id),
        clientUpdatedAt: g.updatedAt,
        title: g.title,
        description: g.description,
        targetValue: g.targetValue,
        bonusPoints: g.bonusPoints,
        periodStart: g.periodStart,
        periodEnd: g.periodEnd,
        autoRenew: g.autoRenew === 1,
      })),
    },
    // A diferencia de HabitLog, GoalProgress SÍ se edita/borra offline (ver
    // goalsService.updateProgress/deleteProgress en el backend).
    goalProgress: {
      create: newProgress.map((p) => ({ localId: p.id, goalId: Number(p.goalId), value: p.value, note: p.note, date: p.date })),
      update: updatedProgress.map((p) => ({
        id: Number(p.id),
        goalId: Number(p.goalId),
        clientUpdatedAt: p.updatedAt,
        value: p.value,
        note: p.note,
        date: p.date,
      })),
    },
    projects: {
      create: newProjects.map((p) => ({
        localId: p.id,
        title: p.title,
        description: p.description,
        status: p.status,
        priority: p.priority,
        deadline: p.deadline,
        color: p.color,
      })),
      update: updatedProjects.map((p) => ({
        id: Number(p.id),
        clientUpdatedAt: p.updatedAt,
        title: p.title,
        description: p.description,
        status: p.status,
        priority: p.priority,
        deadline: p.deadline,
        color: p.color,
      })),
    },
    // addTask/updateTask solo admiten título en el backend; completed se aplica en un segundo
    // paso (ver syncService.ts), igual patrón que subtasks.
    projectTasks: {
      create: newProjectTasks.map((t) => ({ localId: t.id, projectId: Number(t.projectId), title: t.title, completed: t.completed === 1 })),
      update: updatedProjectTasks.map((t) => ({
        id: Number(t.id),
        projectId: Number(t.projectId),
        clientUpdatedAt: t.updatedAt,
        title: t.title,
        completed: t.completed === 1,
      })),
    },
    // content es un blob HTML opaco — se manda entero, igual criterio que Note.content.
    projectPages: {
      create: newProjectPages.map((p) => ({ localId: p.id, projectId: Number(p.projectId), title: p.title, content: p.content })),
      update: updatedProjectPages.map((p) => ({
        id: Number(p.id),
        projectId: Number(p.projectId),
        clientUpdatedAt: p.updatedAt,
        title: p.title,
        content: p.content,
        order: p.order,
      })),
    },
    schedules: {
      create: newSchedules.map((s) => ({ localId: s.id, name: s.name })),
      update: updatedSchedules.map((s) => ({ id: Number(s.id), clientUpdatedAt: s.updatedAt, name: s.name, order: s.order })),
    },
    scheduleRows: {
      create: newRows.map((r) => ({
        localId: r.id,
        scheduleId: Number(r.scheduleId),
        timeLabel: r.timeLabel,
        monday: r.monday,
        tuesday: r.tuesday,
        wednesday: r.wednesday,
        thursday: r.thursday,
        friday: r.friday,
        order: r.order,
      })),
      update: updatedRows.map((r) => ({
        id: Number(r.id),
        scheduleId: Number(r.scheduleId),
        clientUpdatedAt: r.updatedAt,
        timeLabel: r.timeLabel,
        monday: r.monday,
        tuesday: r.tuesday,
        wednesday: r.wednesday,
        thursday: r.thursday,
        friday: r.friday,
        order: r.order,
      })),
    },
    calendarLegendCategories: {
      create: newCategories.map((c) => ({ localId: c.id, label: c.label, color: c.color })),
      update: updatedCategories.map((c) => ({ id: Number(c.id), clientUpdatedAt: c.updatedAt, label: c.label, color: c.color, order: c.order })),
    },
    // Se identifica por fecha, no por id — igual criterio que eventExceptions. Solo se sube
    // cuando la categoría ya tiene id numérico de servidor (ver listMarksPendingUpsert).
    calendarDayMarks: {
      upsert: pendingMarkUpserts.map((m) => ({ date: m.date, categoryId: Number(m.categoryId) })),
    },
    // content es un blob JSON por plantilla — se manda entero, igual criterio que ProjectPage.content.
    customPages: {
      create: newCustomPages.map((p) => ({ localId: p.id, title: p.title, template: p.template })),
      update: updatedCustomPages.map((p) => ({
        id: Number(p.id),
        clientUpdatedAt: p.updatedAt,
        title: p.title,
        subtitle: p.subtitle,
        icon: p.icon,
        content: p.content,
        order: p.order,
      })),
    },
    deletes: deleteOps.map((d) => d.payload),
  };

  const result = await api.post<PushResult>("/sync/push", body);

  // Lo que el servidor no ha aplicado (no válido, rechazado o un error pasajero) se queda pendiente
  // en SQLite y se reintenta en el siguiente sync: solo se confirma el resto. Cada fallo dice su
  // sección, operación e índice en el cuerpo enviado. Un servidor anterior a este cambio no manda
  // `failures` (con él, cualquier fallo hacía fallar la petición entera y no llegaba hasta aquí).
  const failed = new Set((result.failures ?? []).map((f) => `${f.section}.${f.op}.${f.index}`));
  const applied =
    (section: string, op: string) =>
    (_item: unknown, index: number): boolean =>
      !failed.has(`${section}.${op}.${index}`);

  // Nada que hacer con `conflicts` aquí: la fila local ya se descartó en el servidor, y el
  // siguiente pull trae de vuelta la versión autoritativa — no hace falta reconciliar a mano.
  // Las altas no se confirman aquí sino con `idMappings` (más abajo): una que falló no tiene
  // mapeo y sigue con `synced = 0`, así que vuelve a subir sola.
  await Promise.all(updatedEvents.filter(applied("events", "update")).map((e) => clearEventPendingOp(e.id)));
  await Promise.all(updatedTasks.filter(applied("tasks", "update")).map((t) => clearTaskPendingOp(t.id)));
  await Promise.all(updatedSubtasks.filter(applied("subtasks", "update")).map((s) => clearSubtaskPendingOp(s.id)));
  await Promise.all(habitLogCreates.filter(applied("habitLogs", "create")).map((l) => confirmHabitLogCreated(l.habitId, l.date)));
  await Promise.all(updatedHabits.filter(applied("habits", "update")).map((h) => clearHabitPendingOp(h.id)));
  await Promise.all(
    pendingExceptionUpserts.filter(applied("eventExceptions", "upsert")).map((x) => confirmExceptionUpserted(x.eventId, x.originalStartTime))
  );
  await Promise.all(updatedNotes.filter(applied("notes", "update")).map((n) => clearNotePendingOp(n.id)));
  await Promise.all(updatedTransactions.filter(applied("transactions", "update")).map((t) => clearTransactionPendingOp(t.id)));
  await Promise.all(updatedSavingsGoals.filter(applied("savingsGoals", "update")).map((g) => clearSavingsGoalPendingOp(g.id)));
  await Promise.all(updatedGoals.filter(applied("goals", "update")).map((g) => clearGoalPendingOp(g.id)));
  await Promise.all(updatedProgress.filter(applied("goalProgress", "update")).map((p) => clearProgressPendingOp(p.id)));
  await Promise.all(updatedProjects.filter(applied("projects", "update")).map((p) => clearProjectPendingOp(p.id)));
  await Promise.all(updatedProjectTasks.filter(applied("projectTasks", "update")).map((t) => clearProjectTaskPendingOp(t.id)));
  await Promise.all(updatedProjectPages.filter(applied("projectPages", "update")).map((p) => clearProjectPagePendingOp(p.id)));
  await Promise.all(updatedSchedules.filter(applied("schedules", "update")).map((s) => clearSchedulePendingOp(s.id)));
  await Promise.all(updatedRows.filter(applied("scheduleRows", "update")).map((r) => clearRowPendingOp(r.id)));
  await Promise.all(updatedCategories.filter(applied("calendarLegendCategories", "update")).map((c) => clearCategoryPendingOp(c.id)));
  await Promise.all(pendingMarkUpserts.filter(applied("calendarDayMarks", "upsert")).map((m) => confirmMarkUpserted(m.date)));
  await Promise.all(updatedCustomPages.filter(applied("customPages", "update")).map((p) => clearCustomPagePendingOp(p.id)));
  await Promise.all(deleteOps.filter(applied("deletes", "delete")).map((d) => d.confirm()));

  for (const mapping of result.idMappings) {
    if (mapping.entityType === "note") await markNoteSynced(mapping.localId, mapping.id);
    else if (mapping.entityType === "event") await markEventSynced(mapping.localId, mapping.id);
    else if (mapping.entityType === "task") await markTaskSynced(mapping.localId, mapping.id);
    else if (mapping.entityType === "subtask") await markSubtaskSynced(mapping.localId, mapping.id);
    else if (mapping.entityType === "transaction") await markTransactionSynced(mapping.localId, mapping.id);
    else if (mapping.entityType === "savingsGoal") await markSavingsGoalSynced(mapping.localId, mapping.id);
    else if (mapping.entityType === "goal") await markGoalSynced(mapping.localId, mapping.id);
    else if (mapping.entityType === "goalProgress") await markProgressSynced(mapping.localId, mapping.id);
    else if (mapping.entityType === "project") await markProjectSynced(mapping.localId, mapping.id);
    else if (mapping.entityType === "projectTask") await markProjectTaskSynced(mapping.localId, mapping.id);
    else if (mapping.entityType === "projectPage") await markProjectPageSynced(mapping.localId, mapping.id);
    else if (mapping.entityType === "schedule") await markScheduleSynced(mapping.localId, mapping.id);
    else if (mapping.entityType === "scheduleRow") await markRowSynced(mapping.localId, mapping.id);
    else if (mapping.entityType === "calendarLegendCategory") await markCategorySynced(mapping.localId, mapping.id);
    else if (mapping.entityType === "customPage") await markCustomPageSynced(mapping.localId, mapping.id);
    else if (mapping.entityType === "habit") await markHabitSynced(mapping.localId, mapping.id);
  }

  // Lo que cuelga de algo recién creado (subtareas de una tarea, marcas de un hábito, excepciones
  // de un evento…) esperaba a conocer el id de servidor de su padre: ahora que `markXSynced` lo ha
  // reasignado, se sube en una segunda pasada del mismo ciclo en vez de esperar al siguiente sync.
  // Solo una vez (`allowFollowUp`): si esa segunda pasada ya no crea nada, no vuelve a repetirse.
  // Lo que falló en la primera vuelve a intentarse en ella, así que su recuento es el que vale.
  if (allowFollowUp && result.idMappings.length > 0) return pushToServer(false);
  return failed.size;
}
