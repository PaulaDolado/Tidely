import * as Crypto from "expo-crypto";
import { getDb } from "./index";
import { CalendarColor, LocalCalendarDayMark, LocalCalendarLegendCategory, ServerCalendarDayMark, ServerCalendarLegendCategory } from "../types";

// --- Categorías (mismo patrón id/synced/pendingOp que el resto de entidades creables) ---

export async function upsertCategories(categories: ServerCalendarLegendCategory[]): Promise<void> {
  if (categories.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const c of categories) {
      const id = String(c.id);
      await db.runAsync(
        `INSERT INTO calendar_legend_categories (id, label, color, "order", updatedAt, synced, pendingOp)
         VALUES (?, ?, ?, ?, ?, 1, NULL)
         ON CONFLICT(id) DO UPDATE SET label = excluded.label, color = excluded.color,
           "order" = excluded."order", updatedAt = excluded.updatedAt, synced = 1
         WHERE calendar_legend_categories.pendingOp IS NULL`,
        [id, c.label, c.color, c.order, c.updatedAt]
      );
    }
  });
}

export async function deleteCategory(serverId: number): Promise<void> {
  const db = await getDb();
  const id = String(serverId);
  await db.runAsync("DELETE FROM calendar_legend_categories WHERE id = ? AND synced = 1", [id]);
  // Cascade local (los días pintados con esta categoría quedan sin pintar) — mismo criterio que
  // habitsRepo.deleteHabit con sus habit_logs: sin tombstone individual por cada día, ver
  // calendarLegendService.deleteCategory en el backend.
  await db.runAsync("DELETE FROM calendar_day_marks WHERE categoryId = ?", [id]);
}

export async function listCategories(): Promise<LocalCalendarLegendCategory[]> {
  const db = await getDb();
  return db.getAllAsync<LocalCalendarLegendCategory>(
    'SELECT * FROM calendar_legend_categories WHERE (pendingOp IS NULL OR pendingOp != \'delete\') ORDER BY "order" ASC'
  );
}

export async function createCategoryLocal(label: string, color: CalendarColor): Promise<string> {
  const db = await getDb();
  const last = await db.getFirstAsync<{ maxOrder: number | null }>('SELECT MAX("order") as maxOrder FROM calendar_legend_categories');
  const order = (last?.maxOrder ?? -1) + 1;
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO calendar_legend_categories (id, label, color, "order", updatedAt, synced, pendingOp) VALUES (?, ?, ?, ?, ?, 0, NULL)`,
    [id, label.trim(), color, order, now]
  );
  return id;
}

export async function updateCategoryLocal(id: string, input: { label?: string; color?: CalendarColor }): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  const sets: string[] = [];
  const params: string[] = [];
  if (input.label !== undefined) {
    sets.push("label = ?");
    params.push(input.label.trim());
  }
  if (input.color !== undefined) {
    sets.push("color = ?");
    params.push(input.color);
  }
  if (sets.length === 0) return;
  sets.push("updatedAt = ?", "pendingOp = CASE WHEN synced = 1 THEN 'update' ELSE pendingOp END");
  params.push(now, id);
  await db.runAsync(`UPDATE calendar_legend_categories SET ${sets.join(", ")} WHERE id = ?`, params);
}

/** Igual criterio que notesRepo.deleteNoteLocal para la categoría en sí, más el cascade local de
 * sus días pintados (mismo motivo que `deleteCategory` de arriba). */
export async function deleteCategoryLocal(id: string): Promise<void> {
  const db = await getDb();
  const category = await db.getFirstAsync<LocalCalendarLegendCategory>("SELECT * FROM calendar_legend_categories WHERE id = ?", [id]);
  if (!category) return;
  if (category.synced === 0) {
    await db.runAsync("DELETE FROM calendar_legend_categories WHERE id = ?", [id]);
  } else {
    await db.runAsync("UPDATE calendar_legend_categories SET pendingOp = 'delete' WHERE id = ?", [id]);
  }
  await db.runAsync("DELETE FROM calendar_day_marks WHERE categoryId = ?", [id]);
}

export async function listUnsyncedCategories(): Promise<LocalCalendarLegendCategory[]> {
  const db = await getDb();
  return db.getAllAsync<LocalCalendarLegendCategory>("SELECT * FROM calendar_legend_categories WHERE synced = 0");
}

export async function listCategoriesPendingUpdate(): Promise<LocalCalendarLegendCategory[]> {
  const db = await getDb();
  return db.getAllAsync<LocalCalendarLegendCategory>("SELECT * FROM calendar_legend_categories WHERE synced = 1 AND pendingOp = 'update'");
}

export async function listCategoriesPendingDelete(): Promise<LocalCalendarLegendCategory[]> {
  const db = await getDb();
  return db.getAllAsync<LocalCalendarLegendCategory>("SELECT * FROM calendar_legend_categories WHERE pendingOp = 'delete'");
}

/** Además de sustituir el id local por el de servidor, reasigna los días ya pintados con esta
 * categoría mientras era solo local — mismo motivo que tasksRepo.markTaskSynced/reparentSubtasks. */
export async function markCategorySynced(localId: string, serverId: number): Promise<void> {
  const db = await getDb();
  const newId = String(serverId);
  await db.runAsync("UPDATE calendar_legend_categories SET id = ?, synced = 1 WHERE id = ?", [newId, localId]);
  await db.runAsync("UPDATE calendar_day_marks SET categoryId = ? WHERE categoryId = ?", [newId, localId]);
}

export async function clearCategoryPendingOp(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE calendar_legend_categories SET pendingOp = NULL WHERE id = ?", [id]);
}

export async function deleteCategoryRow(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM calendar_legend_categories WHERE id = ?", [id]);
}

// --- Días pintados: clave natural (date), no un id local — ver LocalCalendarDayMark en types.ts ---

/** Un pull nunca pisa un día con una pintura local pendiente — igual motivo que el resto de
 * `upsertX`. */
export async function upsertDayMarks(marks: ServerCalendarDayMark[]): Promise<void> {
  if (marks.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const m of marks) {
      await db.runAsync(
        `INSERT INTO calendar_day_marks (date, categoryId, serverId, updatedAt, synced, pendingOp)
         VALUES (?, ?, ?, ?, 1, NULL)
         ON CONFLICT(date) DO UPDATE SET categoryId = excluded.categoryId, serverId = excluded.serverId,
           updatedAt = excluded.updatedAt, synced = 1
         WHERE calendar_day_marks.pendingOp IS NULL`,
        [m.date, String(m.categoryId), m.id, m.updatedAt]
      );
    }
  });
}

/** Tombstone de una marca de día: el servidor da su `id` real (ver
 * calendarLegendService.setDayMark) — hace falta el `serverId` guardado en un pull/push anterior
 * para saber qué fila local le corresponde, igual motivo que habitsRepo con `serverId`. */
export async function deleteDayMarkByServerId(serverId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM calendar_day_marks WHERE serverId = ?", [serverId]);
}

export async function listMarksInRange(from: string, to: string): Promise<LocalCalendarDayMark[]> {
  const db = await getDb();
  return db.getAllAsync<LocalCalendarDayMark>(
    "SELECT * FROM calendar_day_marks WHERE date >= ? AND date <= ? AND (pendingOp IS NULL OR pendingOp != 'delete')",
    [from, to]
  );
}

/** Pintar (o repintar) un día — sustituye el color si ya estaba pintado, igual criterio que
 * calendarLegendService.setDayMark en el backend. */
export async function setDayMarkLocal(date: string, categoryId: string): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO calendar_day_marks (date, categoryId, serverId, updatedAt, synced, pendingOp)
     VALUES (?, ?, NULL, ?, 0, 'upsert')
     ON CONFLICT(date) DO UPDATE SET categoryId = excluded.categoryId, updatedAt = excluded.updatedAt,
       pendingOp = 'upsert'`,
    [date, categoryId, now]
  );
}

/** Despintar un día. Si la marca nunca llegó a sincronizarse, se borra sin más (igual criterio
 * que notesRepo.deleteNoteLocal con `synced=0`) — no hay nada que decirle al servidor. */
export async function unsetDayMarkLocal(date: string): Promise<void> {
  const db = await getDb();
  const existing = await db.getFirstAsync<LocalCalendarDayMark>("SELECT * FROM calendar_day_marks WHERE date = ?", [date]);
  if (!existing) return;
  if (existing.synced === 0 && existing.serverId === null) {
    await db.runAsync("DELETE FROM calendar_day_marks WHERE date = ?", [date]);
  } else {
    await db.runAsync("UPDATE calendar_day_marks SET pendingOp = 'delete' WHERE date = ?", [date]);
  }
}

const NUMERIC_ID = /^\d+$/;

/** Solo se sube cuando la categoría ya tiene id de servidor — mismo criterio que
 * subtasksRepo.listUnsyncedSubtasksReadyToPush con taskId. */
export async function listMarksPendingUpsert(): Promise<LocalCalendarDayMark[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<LocalCalendarDayMark>("SELECT * FROM calendar_day_marks WHERE pendingOp = 'upsert'");
  return rows.filter((r) => NUMERIC_ID.test(r.categoryId));
}

export async function listMarksPendingDelete(): Promise<LocalCalendarDayMark[]> {
  const db = await getDb();
  return db.getAllAsync<LocalCalendarDayMark>("SELECT * FROM calendar_day_marks WHERE pendingOp = 'delete'");
}

/** No recibe el `serverId` real aquí (el push de `calendarDayMarks` no genera `idMappings`,
 * igual que HabitLog) — lo rellena el pull que sigue en el mismo ciclo de `runSync()`, vía
 * `upsertDayMarks` emparejando por `date` (mismo motivo que habitsRepo.confirmHabitLogCreated). */
export async function confirmMarkUpserted(date: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE calendar_day_marks SET pendingOp = NULL WHERE date = ?", [date]);
}

export async function confirmMarkDeleted(date: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM calendar_day_marks WHERE date = ?", [date]);
}
