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
import { listPendingHabitLogs, confirmHabitLogCreated, confirmHabitLogDeleted } from "../db/habitsRepo";
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
 * (`localId` uuid) o editadas (`id` de servidor + `clientUpdatedAt` para el last-write-wins). */
export async function pushToServer(): Promise<void> {
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
  if (!hasChanges) return;

  const habitLogCreates = pendingLogs.filter((l) => l.pending === "create").map((l) => ({ habitId: l.habitId, date: l.date }));
  const habitLogDeletes = pendingLogs
    .filter((l) => l.pending === "delete")
    .map((l) => ({ entityType: "habitLog" as const, habitId: l.habitId, date: l.date }));

  // Solo tareas/subtareas ya sincronizadas (id numérico real) pueden borrarse en el servidor —
  // una fila `synced = 0` nunca llegó a existir ahí, así que su borrado ya se resolvió sin más en
  // `deleteEventLocal`/`deleteTaskLocal`/`deleteSubtaskLocal` (nunca llega hasta aquí).
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
        status: t.status,
        priority: t.priority,
        order: t.order,
        dueDate: t.dueDate,
        tags: parseTaskTags(t),
      })),
      update: updatedTasks.map((t) => ({
        id: Number(t.id),
        clientUpdatedAt: t.updatedAt,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        order: t.order,
        dueDate: t.dueDate,
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
    habitLogs: { create: habitLogCreates },
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
        content: p.content,
        order: p.order,
      })),
    },
    deletes: [
      ...deletedEvents.filter((e) => e.synced === 1).map((e) => ({ entityType: "event" as const, id: Number(e.id) })),
      ...deletedTasks.filter((t) => t.synced === 1).map((t) => ({ entityType: "task" as const, id: Number(t.id) })),
      ...deletedSubtasks
        .filter((s) => s.synced === 1)
        .map((s) => ({ entityType: "subtask" as const, id: Number(s.id), taskId: Number(s.taskId) })),
      ...deletedNotes.filter((n) => n.synced === 1).map((n) => ({ entityType: "note" as const, id: Number(n.id) })),
      ...habitLogDeletes,
      ...deletedTransactions.filter((t) => t.synced === 1).map((t) => ({ entityType: "transaction" as const, id: Number(t.id) })),
      ...deletedSavingsGoals.filter((g) => g.synced === 1).map((g) => ({ entityType: "savingsGoal" as const, id: Number(g.id) })),
      ...deletedGoals.filter((g) => g.synced === 1).map((g) => ({ entityType: "goal" as const, id: Number(g.id) })),
      ...deletedProgress
        .filter((p) => p.synced === 1)
        .map((p) => ({ entityType: "goalProgress" as const, id: Number(p.id), goalId: Number(p.goalId) })),
      ...deletedProjects.filter((p) => p.synced === 1).map((p) => ({ entityType: "project" as const, id: Number(p.id) })),
      ...deletedProjectTasks
        .filter((t) => t.synced === 1)
        .map((t) => ({ entityType: "projectTask" as const, id: Number(t.id), projectId: Number(t.projectId) })),
      ...deletedProjectPages
        .filter((p) => p.synced === 1)
        .map((p) => ({ entityType: "projectPage" as const, id: Number(p.id), projectId: Number(p.projectId) })),
      ...deletedSchedules.filter((s) => s.synced === 1).map((s) => ({ entityType: "schedule" as const, id: Number(s.id) })),
      ...deletedRows
        .filter((r) => r.synced === 1)
        .map((r) => ({ entityType: "scheduleRow" as const, id: Number(r.id), scheduleId: Number(r.scheduleId) })),
      ...deletedCategories
        .filter((c) => c.synced === 1)
        .map((c) => ({ entityType: "calendarLegendCategory" as const, id: Number(c.id) })),
      ...pendingMarkDeletes.map((m) => ({ entityType: "calendarDayMark" as const, date: m.date })),
      ...deletedCustomPages.filter((p) => p.synced === 1).map((p) => ({ entityType: "customPage" as const, id: Number(p.id) })),
    ],
  };

  const result = await api.post<PushResult>("/sync/push", body);

  // Nada que hacer con `conflicts` aquí: la fila local ya se descartó en el servidor, y el
  // siguiente pull trae de vuelta la versión autoritativa — no hace falta reconciliar a mano.
  await Promise.all(updatedEvents.map((e) => clearEventPendingOp(e.id)));
  await Promise.all(deletedEvents.filter((e) => e.synced === 1).map((e) => deleteEventRow(e.id)));
  await Promise.all(updatedTasks.map((t) => clearTaskPendingOp(t.id)));
  await Promise.all(deletedTasks.filter((t) => t.synced === 1).map((t) => deleteTaskRow(t.id)));
  await Promise.all(updatedSubtasks.map((s) => clearSubtaskPendingOp(s.id)));
  await Promise.all(deletedSubtasks.filter((s) => s.synced === 1).map((s) => deleteSubtaskRow(s.id)));
  await Promise.all(habitLogCreates.map((l) => confirmHabitLogCreated(l.habitId, l.date)));
  await Promise.all(habitLogDeletes.map((l) => confirmHabitLogDeleted(l.habitId, l.date)));
  await Promise.all(updatedNotes.map((n) => clearNotePendingOp(n.id)));
  await Promise.all(deletedNotes.filter((n) => n.synced === 1).map((n) => deleteNoteRow(n.id)));
  await Promise.all(updatedTransactions.map((t) => clearTransactionPendingOp(t.id)));
  await Promise.all(deletedTransactions.filter((t) => t.synced === 1).map((t) => deleteTransactionRow(t.id)));
  await Promise.all(updatedSavingsGoals.map((g) => clearSavingsGoalPendingOp(g.id)));
  await Promise.all(deletedSavingsGoals.filter((g) => g.synced === 1).map((g) => deleteSavingsGoalRow(g.id)));
  await Promise.all(updatedGoals.map((g) => clearGoalPendingOp(g.id)));
  await Promise.all(deletedGoals.filter((g) => g.synced === 1).map((g) => deleteGoalRow(g.id)));
  await Promise.all(updatedProgress.map((p) => clearProgressPendingOp(p.id)));
  await Promise.all(deletedProgress.filter((p) => p.synced === 1).map((p) => deleteProgressRow(p.id)));
  await Promise.all(updatedProjects.map((p) => clearProjectPendingOp(p.id)));
  await Promise.all(deletedProjects.filter((p) => p.synced === 1).map((p) => deleteProjectRow(p.id)));
  await Promise.all(updatedProjectTasks.map((t) => clearProjectTaskPendingOp(t.id)));
  await Promise.all(deletedProjectTasks.filter((t) => t.synced === 1).map((t) => deleteProjectTaskRow(t.id)));
  await Promise.all(updatedProjectPages.map((p) => clearProjectPagePendingOp(p.id)));
  await Promise.all(deletedProjectPages.filter((p) => p.synced === 1).map((p) => deleteProjectPageRow(p.id)));
  await Promise.all(updatedSchedules.map((s) => clearSchedulePendingOp(s.id)));
  await Promise.all(deletedSchedules.filter((s) => s.synced === 1).map((s) => deleteScheduleDbRow(s.id)));
  await Promise.all(updatedRows.map((r) => clearRowPendingOp(r.id)));
  await Promise.all(deletedRows.filter((r) => r.synced === 1).map((r) => deleteRowDbRow(r.id)));
  await Promise.all(updatedCategories.map((c) => clearCategoryPendingOp(c.id)));
  await Promise.all(deletedCategories.filter((c) => c.synced === 1).map((c) => deleteCategoryRow(c.id)));
  await Promise.all(pendingMarkUpserts.map((m) => confirmMarkUpserted(m.date)));
  await Promise.all(pendingMarkDeletes.map((m) => confirmMarkDeleted(m.date)));
  await Promise.all(updatedCustomPages.map((p) => clearCustomPagePendingOp(p.id)));
  await Promise.all(deletedCustomPages.filter((p) => p.synced === 1).map((p) => deleteCustomPageRow(p.id)));

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
  }
}
