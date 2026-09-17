import * as Crypto from "expo-crypto";
import { getDb } from "./index";
import { reparentProjectTasks } from "./projectTasksRepo";
import { reparentProjectPages } from "./projectPagesRepo";
import { LocalProject, ServerProject } from "../types";

export async function upsertProjects(projects: ServerProject[]): Promise<void> {
  if (projects.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const p of projects) {
      const id = String(p.id);
      await db.runAsync(
        `INSERT INTO projects (id, title, description, status, priority, deadline, color, updatedAt, synced, pendingOp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, description = excluded.description,
           status = excluded.status, priority = excluded.priority, deadline = excluded.deadline,
           color = excluded.color, updatedAt = excluded.updatedAt, synced = 1
         WHERE projects.pendingOp IS NULL`,
        [id, p.title, p.description, p.status, p.priority, p.deadline, p.color, p.updatedAt]
      );
    }
  });
}

export async function deleteProject(serverId: number): Promise<void> {
  const db = await getDb();
  const id = String(serverId);
  await db.runAsync("DELETE FROM projects WHERE id = ? AND synced = 1", [id]);
  // Cascade local, igual criterio que habitsRepo.deleteHabit con sus habit_logs.
  await db.runAsync("DELETE FROM project_tasks WHERE projectId = ?", [id]);
  await db.runAsync("DELETE FROM project_pages WHERE projectId = ?", [id]);
}

export async function listProjects(filters: { status?: string; priority?: string } = {}): Promise<LocalProject[]> {
  const db = await getDb();
  const conditions = ["(pendingOp IS NULL OR pendingOp != 'delete')"];
  const params: string[] = [];
  if (filters.status) {
    conditions.push("status = ?");
    params.push(filters.status);
  }
  if (filters.priority) {
    conditions.push("priority = ?");
    params.push(filters.priority);
  }
  return db.getAllAsync<LocalProject>(
    `SELECT * FROM projects WHERE ${conditions.join(" AND ")} ORDER BY updatedAt DESC`,
    params
  );
}

export async function getProject(id: string): Promise<LocalProject | null> {
  const db = await getDb();
  return db.getFirstAsync<LocalProject>("SELECT * FROM projects WHERE id = ?", [id]);
}

export async function createProjectLocal(input: {
  title: string;
  description: string | null;
  status: string;
  priority: string;
  deadline: string | null;
  color: string | null;
}): Promise<string> {
  const db = await getDb();
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO projects (id, title, description, status, priority, deadline, color, updatedAt, synced, pendingOp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)`,
    [id, input.title, input.description, input.status, input.priority, input.deadline, input.color, now]
  );
  return id;
}

export async function updateProjectLocal(
  id: string,
  input: { title: string; description: string | null; status: string; priority: string; deadline: string | null; color: string | null }
): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE projects SET title = ?, description = ?, status = ?, priority = ?, deadline = ?, color = ?, updatedAt = ?,
       pendingOp = CASE WHEN synced = 1 THEN 'update' ELSE pendingOp END
     WHERE id = ?`,
    [input.title, input.description, input.status, input.priority, input.deadline, input.color, now, id]
  );
}

export async function deleteProjectLocal(id: string): Promise<void> {
  const db = await getDb();
  const project = await db.getFirstAsync<LocalProject>("SELECT * FROM projects WHERE id = ?", [id]);
  if (!project) return;
  if (project.synced === 0) {
    await db.runAsync("DELETE FROM projects WHERE id = ?", [id]);
  } else {
    await db.runAsync("UPDATE projects SET pendingOp = 'delete' WHERE id = ?", [id]);
  }
}

export async function listUnsyncedProjects(): Promise<LocalProject[]> {
  const db = await getDb();
  return db.getAllAsync<LocalProject>("SELECT * FROM projects WHERE synced = 0");
}

export async function listProjectsPendingUpdate(): Promise<LocalProject[]> {
  const db = await getDb();
  return db.getAllAsync<LocalProject>("SELECT * FROM projects WHERE synced = 1 AND pendingOp = 'update'");
}

export async function listProjectsPendingDelete(): Promise<LocalProject[]> {
  const db = await getDb();
  return db.getAllAsync<LocalProject>("SELECT * FROM projects WHERE pendingOp = 'delete'");
}

/** Además de sustituir el id local por el de servidor, reasigna tareas y páginas que ya
 * colgaran de este proyecto mientras era solo local — mismo motivo que
 * tasksRepo.markTaskSynced/reparentSubtasks. */
export async function markProjectSynced(localId: string, serverId: number): Promise<void> {
  const db = await getDb();
  const newId = String(serverId);
  await db.runAsync("UPDATE projects SET id = ?, synced = 1 WHERE id = ?", [newId, localId]);
  await reparentProjectTasks(localId, newId);
  await reparentProjectPages(localId, newId);
}

export async function clearProjectPendingOp(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE projects SET pendingOp = NULL WHERE id = ?", [id]);
}

export async function deleteProjectRow(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM projects WHERE id = ?", [id]);
}
