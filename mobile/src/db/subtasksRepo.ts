import * as Crypto from "expo-crypto";
import { getDb } from "./index";
import { LocalSubtask, ServerSubtask } from "../types";

/** Igual patrón que el resto de tablas "creables" (ver notesRepo/eventsRepo/tasksRepo): un pull
 * nunca pisa una fila con una operación local pendiente. */
export async function upsertSubtasks(subtasks: ServerSubtask[]): Promise<void> {
  if (subtasks.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const s of subtasks) {
      const id = String(s.id);
      await db.runAsync(
        `INSERT INTO subtasks (id, taskId, title, completed, updatedAt, synced, pendingOp)
         VALUES (?, ?, ?, ?, ?, 1, NULL)
         ON CONFLICT(id) DO UPDATE SET taskId = excluded.taskId, title = excluded.title,
           completed = excluded.completed, updatedAt = excluded.updatedAt, synced = 1
         WHERE subtasks.pendingOp IS NULL`,
        [id, String(s.taskId), s.title, s.completed ? 1 : 0, s.updatedAt]
      );
    }
  });
}

export async function deleteSubtask(serverId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM subtasks WHERE id = ? AND synced = 1", [String(serverId)]);
}

/** Una tarea creada offline todavía tiene un uuid como id local — en cuanto se sincroniza,
 * `tasksRepo.markTaskSynced` cambia `tasks.id` al id de servidor, pero las subtareas ya creadas
 * bajo esa tarea siguen apuntando al uuid antiguo (`subtasks.taskId` no es una FK de verdad para
 * SQLite, es solo texto) — hay que reasignarlas a mano, o quedarían huérfanas para siempre y
 * nunca podrían subirse (el backend exige un `taskId` numérico real, ver plannerValidators.ts). */
export async function reparentSubtasks(oldTaskId: string, newTaskId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE subtasks SET taskId = ? WHERE taskId = ?", [newTaskId, oldTaskId]);
}

export async function listForTask(taskId: string): Promise<LocalSubtask[]> {
  const db = await getDb();
  return db.getAllAsync<LocalSubtask>(
    "SELECT * FROM subtasks WHERE taskId = ? AND (pendingOp IS NULL OR pendingOp != 'delete') ORDER BY updatedAt ASC",
    [taskId]
  );
}

export interface SubtaskCount {
  done: number;
  total: number;
}

/** Progreso de subtareas de TODAS las tareas en una sola consulta (agrupada por `taskId`), para
 * pintar "☑ hechas/total" en cada tarjeta del tablero sin lanzar una consulta por tarjeta. Las
 * tareas sin subtareas simplemente no aparecen en el mapa. */
export async function getSubtaskCounts(): Promise<Record<string, SubtaskCount>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ taskId: string; total: number; done: number | null }>(
    `SELECT taskId, COUNT(*) AS total, SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) AS done
     FROM subtasks WHERE (pendingOp IS NULL OR pendingOp != 'delete') GROUP BY taskId`
  );
  const result: Record<string, SubtaskCount> = {};
  for (const r of rows) result[r.taskId] = { done: r.done ?? 0, total: r.total };
  return result;
}

export async function createSubtaskLocal(taskId: string, title: string): Promise<string> {
  const db = await getDb();
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  await db.runAsync("INSERT INTO subtasks (id, taskId, title, completed, updatedAt, synced, pendingOp) VALUES (?, ?, ?, 0, ?, 0, NULL)", [
    id,
    taskId,
    title,
    now,
  ]);
  return id;
}

export async function toggleSubtask(id: string): Promise<void> {
  const db = await getDb();
  const subtask = await db.getFirstAsync<LocalSubtask>("SELECT * FROM subtasks WHERE id = ?", [id]);
  if (!subtask) return;
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE subtasks SET completed = ?, updatedAt = ?, pendingOp = CASE WHEN synced = 1 THEN 'update' ELSE pendingOp END
     WHERE id = ?`,
    [subtask.completed ? 0 : 1, now, id]
  );
}

/** Igual criterio que `notesRepo.deleteNoteLocal`. */
export async function deleteSubtaskLocal(id: string): Promise<void> {
  const db = await getDb();
  const subtask = await db.getFirstAsync<LocalSubtask>("SELECT * FROM subtasks WHERE id = ?", [id]);
  if (!subtask) return;
  if (subtask.synced === 0) {
    await db.runAsync("DELETE FROM subtasks WHERE id = ?", [id]);
  } else {
    await db.runAsync("UPDATE subtasks SET pendingOp = 'delete' WHERE id = ?", [id]);
  }
}

const NUMERIC_ID = /^\d+$/;

/** Una subtarea solo puede subirse cuando su tarea ya tiene id de servidor (el backend exige un
 * `taskId` entero, ver plannerValidators.ts/syncValidators.ts) — una tarea recién creada offline
 * todavía tiene un uuid. Las que no cumplen se quedan pendientes para la siguiente ronda de sync,
 * ya reasignadas por `reparentSubtasks` en cuanto la tarea padre sincronice. */
export async function listUnsyncedSubtasksReadyToPush(): Promise<LocalSubtask[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<LocalSubtask>("SELECT * FROM subtasks WHERE synced = 0");
  return rows.filter((r) => NUMERIC_ID.test(r.taskId));
}

export async function listSubtasksPendingUpdate(): Promise<LocalSubtask[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<LocalSubtask>("SELECT * FROM subtasks WHERE synced = 1 AND pendingOp = 'update'");
  return rows.filter((r) => NUMERIC_ID.test(r.taskId));
}

export async function listSubtasksPendingDelete(): Promise<LocalSubtask[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<LocalSubtask>("SELECT * FROM subtasks WHERE pendingOp = 'delete'");
  return rows.filter((r) => NUMERIC_ID.test(r.taskId));
}

export async function markSubtaskSynced(localId: string, serverId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE subtasks SET id = ?, synced = 1 WHERE id = ?", [String(serverId), localId]);
}

export async function clearSubtaskPendingOp(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE subtasks SET pendingOp = NULL WHERE id = ?", [id]);
}

export async function deleteSubtaskRow(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM subtasks WHERE id = ?", [id]);
}
