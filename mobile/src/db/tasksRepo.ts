import * as Crypto from "expo-crypto";
import { getDb } from "./index";
import { reparentSubtasks } from "./subtasksRepo";
import { parseJsonArray, toJsonArray } from "../utils/json";
import { LocalTask, ServerTask, TaskPriority, TaskStatus } from "../types";

/** Igual patrón que `notesRepo`/`eventsRepo` (ver esos ficheros): un pull nunca pisa una fila con
 * una operación local pendiente — se resolverá en el próximo push. */
export async function upsertTasks(tasks: ServerTask[]): Promise<void> {
  if (tasks.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const t of tasks) {
      const id = String(t.id);
      await db.runAsync(
        `INSERT INTO tasks
           (id, plannerId, projectId, title, description, status, priority, "order", dueDate,
            tags, estimatedMinutes, actualMinutes, updatedAt, synced, pendingOp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)
         ON CONFLICT(id) DO UPDATE SET
           plannerId = excluded.plannerId, projectId = excluded.projectId, title = excluded.title,
           description = excluded.description, status = excluded.status, priority = excluded.priority,
           "order" = excluded."order", dueDate = excluded.dueDate, tags = excluded.tags,
           estimatedMinutes = excluded.estimatedMinutes, actualMinutes = excluded.actualMinutes,
           updatedAt = excluded.updatedAt, synced = 1
         WHERE tasks.pendingOp IS NULL`,
        [
          id,
          t.plannerId,
          t.projectId,
          t.title,
          t.description,
          t.status,
          t.priority,
          t.order,
          t.dueDate,
          toJsonArray(t.tags),
          t.estimatedMinutes,
          t.actualMinutes,
          t.updatedAt,
        ]
      );
    }
  });
}

export async function deleteTask(serverId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM tasks WHERE id = ? AND synced = 1", [String(serverId)]);
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Excluye lo marcado para borrar (borrado optimista, igual que `notesRepo.listNotes`). */
export async function listTasksDueToday(): Promise<LocalTask[]> {
  const db = await getDb();
  return db.getAllAsync<LocalTask>(
    `SELECT * FROM tasks WHERE date(dueDate) = ? AND (pendingOp IS NULL OR pendingOp != 'delete') ORDER BY updatedAt DESC`,
    [todayKey()]
  );
}

/** Todas las tareas de UN tablero de Planificador (el usuario puede tener varios — ver
 * mobile/src/api/planner.ts), para `PlanificadorScreen` — se agrupan por `status` en la propia
 * pantalla (3 secciones fijas, ver mobile/README.md). */
export async function listTasksByPlanner(plannerId: number): Promise<LocalTask[]> {
  const db = await getDb();
  return db.getAllAsync<LocalTask>(
    `SELECT * FROM tasks WHERE plannerId = ? AND (pendingOp IS NULL OR pendingOp != 'delete') ORDER BY status ASC, "order" ASC`,
    [plannerId]
  );
}

export function parseTaskTags(task: LocalTask): string[] {
  return parseJsonArray<string>(task.tags);
}

export async function createTaskLocal(input: {
  plannerId: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  tags: string[];
}): Promise<string> {
  const db = await getDb();
  // El orden fraccionario se calcula dentro del propio tablero + columna (dos tableros pueden
  // tener cada uno su propia tarea en "order" 1000 sin pisarse).
  const last = await db.getFirstAsync<{ maxOrder: number | null }>(
    'SELECT MAX("order") as maxOrder FROM tasks WHERE plannerId = ? AND status = ?',
    [input.plannerId, input.status]
  );
  const order = (last?.maxOrder ?? 0) + 1000;
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO tasks
       (id, plannerId, projectId, title, description, status, priority, "order", dueDate, tags,
        estimatedMinutes, actualMinutes, updatedAt, synced, pendingOp)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, 0, NULL)`,
    [id, input.plannerId, input.title, input.description, input.status, input.priority, order, input.dueDate, toJsonArray(input.tags), now]
  );
  return id;
}

/** Edición "de contenido" (título, descripción, prioridad, fecha, tags) — no toca `status`/
 * `order`, eso es cosa de `moveTask` (mismo reparto de responsabilidades que en
 * `dashboard/src/pages/PlanificadorPage.tsx`: `updateTask` para campos, `moveTask` para mover de
 * columna). */
export async function updateTaskLocal(
  id: string,
  input: { title: string; description: string | null; priority: TaskPriority; dueDate: string | null; tags: string[] }
): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE tasks SET title = ?, description = ?, priority = ?, dueDate = ?, tags = ?, updatedAt = ?,
       pendingOp = CASE WHEN synced = 1 THEN 'update' ELSE pendingOp END
     WHERE id = ?`,
    [input.title, input.description, input.priority, input.dueDate, toJsonArray(input.tags), now, id]
  );
}

/** Cambia de columna (status) calculando un `order` fraccionario para no tener que renumerar el
 * resto de la columna destino — puerto directo de `moveTask` en
 * `dashboard/src/pages/PlanificadorPage.tsx:366-381`: punto medio entre los dos vecinos si se
 * suelta entre dos tareas, o +1000 sobre la última si se suelta al final. `beforeTaskId = null`
 * significa "al final de la columna" (mismo significado que en el propio `moveTask` web).
 * Sin mover de tablero (eso no existe todavía, ni aquí ni en la web — ver plannerId inmutable en
 * updateTaskSchema del backend): el candidato a "vecino" siempre se busca dentro del MISMO
 * plannerId de `id`, para no calcular el punto medio contra tareas de otro tablero que compartan
 * status. */
export async function moveTask(id: string, targetStatus: TaskStatus, beforeTaskId: string | null): Promise<void> {
  const db = await getDb();
  const task = await db.getFirstAsync<LocalTask>("SELECT * FROM tasks WHERE id = ?", [id]);
  if (!task) return;
  const columnTasks = await db.getAllAsync<LocalTask>(
    `SELECT * FROM tasks WHERE plannerId = ? AND status = ? AND id != ? AND (pendingOp IS NULL OR pendingOp != 'delete') ORDER BY "order" ASC`,
    [task.plannerId, targetStatus, id]
  );

  let order: number;
  if (!beforeTaskId) {
    const last = columnTasks[columnTasks.length - 1];
    order = last ? last.order + 1000 : 1000;
  } else {
    const beforeIndex = columnTasks.findIndex((t) => t.id === beforeTaskId);
    const before = columnTasks[beforeIndex];
    if (!before) {
      const last = columnTasks[columnTasks.length - 1];
      order = last ? last.order + 1000 : 1000;
    } else {
      const prev = columnTasks[beforeIndex - 1];
      order = prev ? (prev.order + before.order) / 2 : before.order - 1000;
    }
  }

  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE tasks SET status = ?, "order" = ?, updatedAt = ?,
       pendingOp = CASE WHEN synced = 1 THEN 'update' ELSE pendingOp END
     WHERE id = ?`,
    [targetStatus, order, now, id]
  );
}

/** Alterna entre "done" y "todo" — usado por `HoyScreen` para el toggle de un solo toque (no
 * expone el estado intermedio "in_progress" ahí; `PlanificadorScreen` sí, vía `moveTask`). */
export async function toggleTaskDone(id: string): Promise<void> {
  const task = await (await getDb()).getFirstAsync<LocalTask>("SELECT * FROM tasks WHERE id = ?", [id]);
  if (!task) return;
  const nextStatus: TaskStatus = task.status === "done" ? "todo" : "done";
  await moveTask(id, nextStatus, null);
}

/** Igual criterio que `notesRepo.deleteNoteLocal`. */
export async function deleteTaskLocal(id: string): Promise<void> {
  const db = await getDb();
  const task = await db.getFirstAsync<LocalTask>("SELECT * FROM tasks WHERE id = ?", [id]);
  if (!task) return;
  if (task.synced === 0) {
    await db.runAsync("DELETE FROM tasks WHERE id = ?", [id]);
  } else {
    await db.runAsync("UPDATE tasks SET pendingOp = 'delete' WHERE id = ?", [id]);
  }
}

export async function listUnsyncedTasks(): Promise<LocalTask[]> {
  const db = await getDb();
  return db.getAllAsync<LocalTask>("SELECT * FROM tasks WHERE synced = 0");
}

export async function listTasksPendingUpdate(): Promise<LocalTask[]> {
  const db = await getDb();
  return db.getAllAsync<LocalTask>("SELECT * FROM tasks WHERE synced = 1 AND pendingOp = 'update'");
}

export async function listTasksPendingDelete(): Promise<LocalTask[]> {
  const db = await getDb();
  return db.getAllAsync<LocalTask>("SELECT * FROM tasks WHERE pendingOp = 'delete'");
}

/** Además de sustituir el id local por el de servidor (igual que `notesRepo.markNoteSynced`),
 * reasigna cualquier subtarea que ya colgara de esta tarea mientras era solo local — ver el
 * comentario de `subtasksRepo.reparentSubtasks` para el porqué. */
export async function markTaskSynced(localId: string, serverId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE tasks SET id = ?, synced = 1 WHERE id = ?", [String(serverId), localId]);
  await reparentSubtasks(localId, String(serverId));
}

export async function clearTaskPendingOp(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE tasks SET pendingOp = NULL WHERE id = ?", [id]);
}

export async function deleteTaskRow(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM tasks WHERE id = ?", [id]);
}
