import * as Crypto from "expo-crypto";
import { getDb } from "./index";
import { LocalCustomPage, ServerCustomPage } from "../types";

/** `content` llega como JSON (objeto) del servidor pero se guarda como TEXT en SQLite — blob
 * opaco para el sync, igual que project_pages.content pero serializado (aquí sí es JSON
 * estructurado, no HTML). */
export async function upsertCustomPages(pages: ServerCustomPage[]): Promise<void> {
  if (pages.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const p of pages) {
      const id = String(p.id);
      await db.runAsync(
        `INSERT INTO custom_pages (id, title, subtitle, template, content, "order", updatedAt, synced, pendingOp)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, subtitle = excluded.subtitle,
           template = excluded.template, content = excluded.content, "order" = excluded."order",
           updatedAt = excluded.updatedAt, synced = 1
         WHERE custom_pages.pendingOp IS NULL`,
        [id, p.title, p.subtitle, p.template, JSON.stringify(p.content), p.order, p.updatedAt]
      );
    }
  });
}

export async function deleteCustomPage(serverId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM custom_pages WHERE id = ? AND synced = 1", [String(serverId)]);
}

/** Puerto de customPagesService.defaultContent en el backend — el estado "vacío" de cada
 * plantilla al crear una página offline (el propio dispositivo es quien decide el JSON inicial,
 * igual que el servidor haría si hubiera conexión). */
export function defaultContentFor(template: string): unknown {
  switch (template) {
    case "kanban":
      return {
        columns: [
          { id: Crypto.randomUUID(), title: "Por hacer", cards: [] },
          { id: Crypto.randomUUID(), title: "En curso", cards: [] },
          { id: Crypto.randomUUID(), title: "Hecho", cards: [] },
        ],
      };
    case "galeria":
      return { items: [] };
    case "finanzas":
      return { entries: [] };
    case "proyectos":
      return { items: [] };
    case "objetivos":
      return { goals: [] };
    case "agenda":
      return { items: [] };
    case "hoy":
      return { items: [] };
    case "nota":
    default:
      return { html: "" };
  }
}

export async function listCustomPages(): Promise<LocalCustomPage[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Omit<LocalCustomPage, "content"> & { content: string }>(
    'SELECT * FROM custom_pages WHERE (pendingOp IS NULL OR pendingOp != \'delete\') ORDER BY "order" ASC'
  );
  return rows.map((r) => ({ ...r, content: parseContent(r.content) }));
}

export async function getCustomPage(id: string): Promise<LocalCustomPage | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Omit<LocalCustomPage, "content"> & { content: string }>(
    "SELECT * FROM custom_pages WHERE id = ?",
    [id]
  );
  return row ? { ...row, content: parseContent(row.content) } : null;
}

function parseContent(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function createCustomPageLocal(title: string, template: string, defaultContent: unknown): Promise<string> {
  const db = await getDb();
  const last = await db.getFirstAsync<{ maxOrder: number | null }>('SELECT MAX("order") as maxOrder FROM custom_pages');
  const order = (last?.maxOrder ?? -1) + 1;
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO custom_pages (id, title, subtitle, template, content, "order", updatedAt, synced, pendingOp)
     VALUES (?, ?, NULL, ?, ?, ?, ?, 0, NULL)`,
    [id, title.trim(), template, JSON.stringify(defaultContent), order, now]
  );
  return id;
}

/** El PUT sustituye title/subtitle/content/order — cada uno solo si se indica (igual criterio
 * que customPagesService.updateCustomPage en el backend: `content` siempre se manda entero, el
 * caller es responsable de no perder lo que ya hubiera). */
export async function updateCustomPageLocal(
  id: string,
  input: { title?: string; subtitle?: string | null; content?: unknown; order?: number }
): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (input.title !== undefined) {
    sets.push("title = ?");
    params.push(input.title.trim());
  }
  if (input.subtitle !== undefined) {
    sets.push("subtitle = ?");
    params.push(input.subtitle?.trim() || null);
  }
  if (input.content !== undefined) {
    sets.push("content = ?");
    params.push(JSON.stringify(input.content));
  }
  if (input.order !== undefined) {
    sets.push('"order" = ?');
    params.push(input.order);
  }
  if (sets.length === 0) return;
  sets.push("updatedAt = ?", "pendingOp = CASE WHEN synced = 1 THEN 'update' ELSE pendingOp END");
  params.push(now, id);
  await db.runAsync(`UPDATE custom_pages SET ${sets.join(", ")} WHERE id = ?`, params);
}

/** Igual criterio que scheduleRepo.moveScheduleLocal, sustituyendo al endpoint de swap
 * `moveCustomPage` del backend. */
export async function movePageLocal(id: string, direction: "up" | "down"): Promise<void> {
  const db = await getDb();
  const pages = await db.getAllAsync<LocalCustomPage & { content: string }>(
    'SELECT * FROM custom_pages WHERE (pendingOp IS NULL OR pendingOp != \'delete\') ORDER BY "order" ASC'
  );
  const index = pages.findIndex((p) => p.id === id);
  if (index === -1) return;
  const neighborIndex = direction === "up" ? index - 1 : index + 1;
  const neighbor = pages[neighborIndex];
  if (!neighbor) return;

  const beyondIndex = direction === "up" ? neighborIndex - 1 : neighborIndex + 1;
  const beyond = pages[beyondIndex];
  const order = beyond ? (beyond.order + neighbor.order) / 2 : neighbor.order + (direction === "up" ? -1000 : 1000);

  await updateCustomPageLocal(id, { order });
}

export async function deleteCustomPageLocal(id: string): Promise<void> {
  const db = await getDb();
  const page = await db.getFirstAsync<LocalCustomPage>("SELECT * FROM custom_pages WHERE id = ?", [id]);
  if (!page) return;
  if (page.synced === 0) {
    await db.runAsync("DELETE FROM custom_pages WHERE id = ?", [id]);
  } else {
    await db.runAsync("UPDATE custom_pages SET pendingOp = 'delete' WHERE id = ?", [id]);
  }
}

export async function listUnsyncedCustomPages(): Promise<LocalCustomPage[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Omit<LocalCustomPage, "content"> & { content: string }>("SELECT * FROM custom_pages WHERE synced = 0");
  return rows.map((r) => ({ ...r, content: parseContent(r.content) }));
}

export async function listCustomPagesPendingUpdate(): Promise<LocalCustomPage[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Omit<LocalCustomPage, "content"> & { content: string }>(
    "SELECT * FROM custom_pages WHERE synced = 1 AND pendingOp = 'update'"
  );
  return rows.map((r) => ({ ...r, content: parseContent(r.content) }));
}

export async function listCustomPagesPendingDelete(): Promise<LocalCustomPage[]> {
  const db = await getDb();
  return db.getAllAsync<LocalCustomPage>("SELECT * FROM custom_pages WHERE pendingOp = 'delete'");
}

export async function markCustomPageSynced(localId: string, serverId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE custom_pages SET id = ?, synced = 1 WHERE id = ?", [String(serverId), localId]);
}

export async function clearCustomPagePendingOp(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE custom_pages SET pendingOp = NULL WHERE id = ?", [id]);
}

export async function deleteCustomPageRow(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM custom_pages WHERE id = ?", [id]);
}
