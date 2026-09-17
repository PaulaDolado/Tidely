import * as Crypto from "expo-crypto";
import { getDb } from "./index";
import { LocalScheduleRow, ServerScheduleRow } from "../types";

export async function upsertScheduleRows(rows: ServerScheduleRow[]): Promise<void> {
  if (rows.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const r of rows) {
      const id = String(r.id);
      await db.runAsync(
        `INSERT INTO schedule_rows
           (id, scheduleId, "order", timeLabel, monday, tuesday, wednesday, thursday, friday, updatedAt, synced, pendingOp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)
         ON CONFLICT(id) DO UPDATE SET scheduleId = excluded.scheduleId, "order" = excluded."order",
           timeLabel = excluded.timeLabel, monday = excluded.monday, tuesday = excluded.tuesday,
           wednesday = excluded.wednesday, thursday = excluded.thursday, friday = excluded.friday,
           updatedAt = excluded.updatedAt, synced = 1
         WHERE schedule_rows.pendingOp IS NULL`,
        [id, String(r.scheduleId), r.order, r.timeLabel, r.monday, r.tuesday, r.wednesday, r.thursday, r.friday, r.updatedAt]
      );
    }
  });
}

export async function deleteScheduleRow(serverId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM schedule_rows WHERE id = ? AND synced = 1", [String(serverId)]);
}

/** Igual motivo que subtasksRepo.reparentSubtasks. */
export async function reparentScheduleRows(oldScheduleId: string, newScheduleId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE schedule_rows SET scheduleId = ? WHERE scheduleId = ?", [newScheduleId, oldScheduleId]);
}

export async function listForSchedule(scheduleId: string): Promise<LocalScheduleRow[]> {
  const db = await getDb();
  return db.getAllAsync<LocalScheduleRow>(
    'SELECT * FROM schedule_rows WHERE scheduleId = ? AND (pendingOp IS NULL OR pendingOp != \'delete\') ORDER BY "order" ASC',
    [scheduleId]
  );
}

export async function createRowLocal(scheduleId: string, timeLabel: string): Promise<string> {
  const db = await getDb();
  const last = await db.getFirstAsync<{ maxOrder: number | null }>(
    'SELECT MAX("order") as maxOrder FROM schedule_rows WHERE scheduleId = ?',
    [scheduleId]
  );
  const order = (last?.maxOrder ?? -1) + 1;
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO schedule_rows (id, scheduleId, "order", timeLabel, monday, tuesday, wednesday, thursday, friday, updatedAt, synced, pendingOp)
     VALUES (?, ?, ?, ?, '', '', '', '', '', ?, 0, NULL)`,
    [id, scheduleId, order, timeLabel.trim(), now]
  );
  return id;
}

type Cell = "timeLabel" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday";

export async function updateRowCellLocal(id: string, cell: Cell, value: string): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE schedule_rows SET ${cell} = ?, updatedAt = ?,
       pendingOp = CASE WHEN synced = 1 THEN 'update' ELSE pendingOp END
     WHERE id = ?`,
    [value, now, id]
  );
}

/** Igual criterio que scheduleRepo.moveScheduleLocal, pero dentro de un mismo scheduleId. */
export async function moveRowLocal(id: string, direction: "up" | "down"): Promise<void> {
  const db = await getDb();
  const row = await db.getFirstAsync<LocalScheduleRow>("SELECT * FROM schedule_rows WHERE id = ?", [id]);
  if (!row) return;
  const rows = await db.getAllAsync<LocalScheduleRow>(
    'SELECT * FROM schedule_rows WHERE scheduleId = ? AND (pendingOp IS NULL OR pendingOp != \'delete\') ORDER BY "order" ASC',
    [row.scheduleId]
  );
  const index = rows.findIndex((r) => r.id === id);
  if (index === -1) return;
  const neighborIndex = direction === "up" ? index - 1 : index + 1;
  const neighbor = rows[neighborIndex];
  if (!neighbor) return;

  const beyondIndex = direction === "up" ? neighborIndex - 1 : neighborIndex + 1;
  const beyond = rows[beyondIndex];
  const order = beyond ? (beyond.order + neighbor.order) / 2 : neighbor.order + (direction === "up" ? -1000 : 1000);

  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE schedule_rows SET "order" = ?, updatedAt = ?,
       pendingOp = CASE WHEN synced = 1 THEN 'update' ELSE pendingOp END
     WHERE id = ?`,
    [order, now, id]
  );
}

export async function deleteRowLocal(id: string): Promise<void> {
  const db = await getDb();
  const row = await db.getFirstAsync<LocalScheduleRow>("SELECT * FROM schedule_rows WHERE id = ?", [id]);
  if (!row) return;
  if (row.synced === 0) {
    await db.runAsync("DELETE FROM schedule_rows WHERE id = ?", [id]);
  } else {
    await db.runAsync("UPDATE schedule_rows SET pendingOp = 'delete' WHERE id = ?", [id]);
  }
}

const NUMERIC_ID = /^\d+$/;

export async function listUnsyncedRowsReadyToPush(): Promise<LocalScheduleRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<LocalScheduleRow>("SELECT * FROM schedule_rows WHERE synced = 0");
  return rows.filter((r) => NUMERIC_ID.test(r.scheduleId));
}

export async function listRowsPendingUpdate(): Promise<LocalScheduleRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<LocalScheduleRow>("SELECT * FROM schedule_rows WHERE synced = 1 AND pendingOp = 'update'");
  return rows.filter((r) => NUMERIC_ID.test(r.scheduleId));
}

export async function listRowsPendingDelete(): Promise<LocalScheduleRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<LocalScheduleRow>("SELECT * FROM schedule_rows WHERE pendingOp = 'delete'");
  return rows.filter((r) => NUMERIC_ID.test(r.scheduleId));
}

export async function markRowSynced(localId: string, serverId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE schedule_rows SET id = ?, synced = 1 WHERE id = ?", [String(serverId), localId]);
}

export async function clearRowPendingOp(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE schedule_rows SET pendingOp = NULL WHERE id = ?", [id]);
}

export async function deleteRowDbRow(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM schedule_rows WHERE id = ?", [id]);
}
