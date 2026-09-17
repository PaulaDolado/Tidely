import * as Crypto from "expo-crypto";
import { getDb } from "./index";
import { LocalProjectTask, ServerProjectTask } from "../types";

export async function upsertProjectTasks(tasks: ServerProjectTask[]): Promise<void> {
  if (tasks.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const t of tasks) {
      const id = String(t.id);
      await db.runAsync(
        `INSERT INTO project_tasks (id, projectId, title, completed, updatedAt, synced, pendingOp)
         VALUES (?, ?, ?, ?, ?, 1, NULL)
         ON CONFLICT(id) DO UPDATE SET projectId = excluded.projectId, title = excluded.title,
           completed = excluded.completed, updatedAt = excluded.updatedAt, synced = 1
         WHERE project_tasks.pendingOp IS NULL`,
        [id, String(t.projectId), t.title, t.completed ? 1 : 0, t.updatedAt]
      );
    }
  });
}

export async function deleteProjectTask(serverId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM project_tasks WHERE id = ? AND synced = 1", [String(serverId)]);
}

/** Igual motivo que subtasksRepo.reparentSubtasks. */
export async function reparentProjectTasks(oldProjectId: string, newProjectId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE project_tasks SET projectId = ? WHERE projectId = ?", [newProjectId, oldProjectId]);
}

export async function listForProject(projectId: string): Promise<LocalProjectTask[]> {
  const db = await getDb();
  return db.getAllAsync<LocalProjectTask>(
    "SELECT * FROM project_tasks WHERE projectId = ? AND (pendingOp IS NULL OR pendingOp != 'delete') ORDER BY updatedAt ASC",
    [projectId]
  );
}

export async function createProjectTaskLocal(projectId: string, title: string): Promise<string> {
  const db = await getDb();
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  await db.runAsync(
    "INSERT INTO project_tasks (id, projectId, title, completed, updatedAt, synced, pendingOp) VALUES (?, ?, ?, 0, ?, 0, NULL)",
    [id, projectId, title, now]
  );
  return id;
}

export async function updateProjectTaskTitleLocal(id: string, title: string): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE project_tasks SET title = ?, updatedAt = ?,
       pendingOp = CASE WHEN synced = 1 THEN 'update' ELSE pendingOp END
     WHERE id = ?`,
    [title, now, id]
  );
}

export async function setProjectTaskCompletedLocal(id: string, completed: boolean): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE project_tasks SET completed = ?, updatedAt = ?,
       pendingOp = CASE WHEN synced = 1 THEN 'update' ELSE pendingOp END
     WHERE id = ?`,
    [completed ? 1 : 0, now, id]
  );
}

export async function deleteProjectTaskLocal(id: string): Promise<void> {
  const db = await getDb();
  const task = await db.getFirstAsync<LocalProjectTask>("SELECT * FROM project_tasks WHERE id = ?", [id]);
  if (!task) return;
  if (task.synced === 0) {
    await db.runAsync("DELETE FROM project_tasks WHERE id = ?", [id]);
  } else {
    await db.runAsync("UPDATE project_tasks SET pendingOp = 'delete' WHERE id = ?", [id]);
  }
}

const NUMERIC_ID = /^\d+$/;

/** Igual motivo que subtasksRepo.listUnsyncedSubtasksReadyToPush: solo se sube cuando el
 * proyecto padre ya tiene id de servidor. */
export async function listUnsyncedProjectTasksReadyToPush(): Promise<LocalProjectTask[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<LocalProjectTask>("SELECT * FROM project_tasks WHERE synced = 0");
  return rows.filter((r) => NUMERIC_ID.test(r.projectId));
}

export async function listProjectTasksPendingUpdate(): Promise<LocalProjectTask[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<LocalProjectTask>("SELECT * FROM project_tasks WHERE synced = 1 AND pendingOp = 'update'");
  return rows.filter((r) => NUMERIC_ID.test(r.projectId));
}

export async function listProjectTasksPendingDelete(): Promise<LocalProjectTask[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<LocalProjectTask>("SELECT * FROM project_tasks WHERE pendingOp = 'delete'");
  return rows.filter((r) => NUMERIC_ID.test(r.projectId));
}

export async function markProjectTaskSynced(localId: string, serverId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE project_tasks SET id = ?, synced = 1 WHERE id = ?", [String(serverId), localId]);
}

export async function clearProjectTaskPendingOp(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE project_tasks SET pendingOp = NULL WHERE id = ?", [id]);
}

export async function deleteProjectTaskRow(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM project_tasks WHERE id = ?", [id]);
}
