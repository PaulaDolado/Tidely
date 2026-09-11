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
    deletedNotes.length;
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
    deletes: [
      ...deletedEvents.filter((e) => e.synced === 1).map((e) => ({ entityType: "event" as const, id: Number(e.id) })),
      ...deletedTasks.filter((t) => t.synced === 1).map((t) => ({ entityType: "task" as const, id: Number(t.id) })),
      ...deletedSubtasks
        .filter((s) => s.synced === 1)
        .map((s) => ({ entityType: "subtask" as const, id: Number(s.id), taskId: Number(s.taskId) })),
      ...deletedNotes.filter((n) => n.synced === 1).map((n) => ({ entityType: "note" as const, id: Number(n.id) })),
      ...habitLogDeletes,
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

  for (const mapping of result.idMappings) {
    if (mapping.entityType === "note") await markNoteSynced(mapping.localId, mapping.id);
    else if (mapping.entityType === "event") await markEventSynced(mapping.localId, mapping.id);
    else if (mapping.entityType === "task") await markTaskSynced(mapping.localId, mapping.id);
    else if (mapping.entityType === "subtask") await markSubtaskSynced(mapping.localId, mapping.id);
  }
}
