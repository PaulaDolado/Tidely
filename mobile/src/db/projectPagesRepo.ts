import * as Crypto from "expo-crypto";
import { getDb } from "./index";
import { LocalProjectPage, ServerProjectPage } from "../types";

export async function upsertProjectPages(pages: ServerProjectPage[]): Promise<void> {
  if (pages.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const p of pages) {
      const id = String(p.id);
      await db.runAsync(
        `INSERT INTO project_pages (id, projectId, title, content, "order", updatedAt, synced, pendingOp)
         VALUES (?, ?, ?, ?, ?, ?, 1, NULL)
         ON CONFLICT(id) DO UPDATE SET projectId = excluded.projectId, title = excluded.title,
           content = excluded.content, "order" = excluded."order", updatedAt = excluded.updatedAt, synced = 1
         WHERE project_pages.pendingOp IS NULL`,
        [id, String(p.projectId), p.title, p.content, p.order, p.updatedAt]
      );
    }
  });
}

export async function deleteProjectPage(serverId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM project_pages WHERE id = ? AND synced = 1", [String(serverId)]);
}

/** Igual motivo que subtasksRepo.reparentSubtasks. */
export async function reparentProjectPages(oldProjectId: string, newProjectId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE project_pages SET projectId = ? WHERE projectId = ?", [newProjectId, oldProjectId]);
}

export async function listForProject(projectId: string): Promise<LocalProjectPage[]> {
  const db = await getDb();
  return db.getAllAsync<LocalProjectPage>(
    'SELECT * FROM project_pages WHERE projectId = ? AND (pendingOp IS NULL OR pendingOp != \'delete\') ORDER BY "order" ASC',
    [projectId]
  );
}

export async function createProjectPageLocal(projectId: string, title: string | null): Promise<string> {
  const db = await getDb();
  const last = await db.getFirstAsync<{ maxOrder: number | null }>(
    'SELECT MAX("order") as maxOrder FROM project_pages WHERE projectId = ?',
    [projectId]
  );
  const order = (last?.maxOrder ?? -1) + 1;
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO project_pages (id, projectId, title, content, "order", updatedAt, synced, pendingOp)
     VALUES (?, ?, ?, '', ?, ?, 0, NULL)`,
    [id, projectId, title?.trim() || "Página sin título", order, now]
  );
  return id;
}

/** content es un blob HTML opaco — se sobreescribe entero, nunca se fusiona campo a campo (ver
 * ProjectPage.content en el backend). */
export async function updateProjectPageLocal(id: string, input: { title?: string; content?: string }): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  const sets: string[] = [];
  const params: (string | number)[] = [];
  if (input.title !== undefined) {
    sets.push("title = ?");
    params.push(input.title.trim() || "Página sin título");
  }
  if (input.content !== undefined) {
    sets.push("content = ?");
    params.push(input.content);
  }
  if (sets.length === 0) return;
  sets.push("updatedAt = ?", "pendingOp = CASE WHEN synced = 1 THEN 'update' ELSE pendingOp END");
  params.push(now, id);
  await db.runAsync(`UPDATE project_pages SET ${sets.join(", ")} WHERE id = ?`, params);
}

export async function deleteProjectPageLocal(id: string): Promise<void> {
  const db = await getDb();
  const page = await db.getFirstAsync<LocalProjectPage>("SELECT * FROM project_pages WHERE id = ?", [id]);
  if (!page) return;
  if (page.synced === 0) {
    await db.runAsync("DELETE FROM project_pages WHERE id = ?", [id]);
  } else {
    await db.runAsync("UPDATE project_pages SET pendingOp = 'delete' WHERE id = ?", [id]);
  }
}

const NUMERIC_ID = /^\d+$/;

export async function listUnsyncedProjectPagesReadyToPush(): Promise<LocalProjectPage[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<LocalProjectPage>("SELECT * FROM project_pages WHERE synced = 0");
  return rows.filter((r) => NUMERIC_ID.test(r.projectId));
}

export async function listProjectPagesPendingUpdate(): Promise<LocalProjectPage[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<LocalProjectPage>("SELECT * FROM project_pages WHERE synced = 1 AND pendingOp = 'update'");
  return rows.filter((r) => NUMERIC_ID.test(r.projectId));
}

export async function listProjectPagesPendingDelete(): Promise<LocalProjectPage[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<LocalProjectPage>("SELECT * FROM project_pages WHERE pendingOp = 'delete'");
  return rows.filter((r) => NUMERIC_ID.test(r.projectId));
}

export async function markProjectPageSynced(localId: string, serverId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE project_pages SET id = ?, synced = 1 WHERE id = ?", [String(serverId), localId]);
}

export async function clearProjectPagePendingOp(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE project_pages SET pendingOp = NULL WHERE id = ?", [id]);
}

export async function deleteProjectPageRow(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM project_pages WHERE id = ?", [id]);
}
