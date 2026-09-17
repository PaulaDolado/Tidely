import * as Crypto from "expo-crypto";
import { getDb } from "./index";
import { reparentScheduleRows } from "./scheduleRowsRepo";
import { LocalSchedule, ServerSchedule } from "../types";

export async function upsertSchedules(schedules: ServerSchedule[]): Promise<void> {
  if (schedules.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const s of schedules) {
      const id = String(s.id);
      await db.runAsync(
        `INSERT INTO schedules (id, name, "order", updatedAt, synced, pendingOp)
         VALUES (?, ?, ?, ?, 1, NULL)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, "order" = excluded."order",
           updatedAt = excluded.updatedAt, synced = 1
         WHERE schedules.pendingOp IS NULL`,
        [id, s.name, s.order, s.updatedAt]
      );
    }
  });
}

export async function deleteSchedule(serverId: number): Promise<void> {
  const db = await getDb();
  const id = String(serverId);
  await db.runAsync("DELETE FROM schedules WHERE id = ? AND synced = 1", [id]);
  // Cascade local, igual criterio que habitsRepo.deleteHabit con sus habit_logs.
  await db.runAsync("DELETE FROM schedule_rows WHERE scheduleId = ?", [id]);
}

export async function listSchedules(): Promise<LocalSchedule[]> {
  const db = await getDb();
  return db.getAllAsync<LocalSchedule>(
    'SELECT * FROM schedules WHERE (pendingOp IS NULL OR pendingOp != \'delete\') ORDER BY "order" ASC'
  );
}

export async function createScheduleLocal(name: string): Promise<string> {
  const db = await getDb();
  const last = await db.getFirstAsync<{ maxOrder: number | null }>('SELECT MAX("order") as maxOrder FROM schedules');
  const order = (last?.maxOrder ?? -1) + 1;
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO schedules (id, name, "order", updatedAt, synced, pendingOp) VALUES (?, ?, ?, ?, 0, NULL)`,
    [id, name.trim(), order, now]
  );
  return id;
}

export async function renameScheduleLocal(id: string, name: string): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE schedules SET name = ?, updatedAt = ?,
       pendingOp = CASE WHEN synced = 1 THEN 'update' ELSE pendingOp END
     WHERE id = ?`,
    [name.trim(), now, id]
  );
}

/** Reordena calculando un punto medio fraccionario con el vecino inmediato — mismo criterio que
 * tasksRepo.moveTask, adaptado a una lista plana (sin columnas) con flechas ‹ › en vez de
 * arrastrar. Sustituye al endpoint de swap `moveSchedule` del backend: aquí basta con un
 * `update` normal de `order` (ver syncService.ts, Fase 2). */
export async function moveScheduleLocal(id: string, direction: "up" | "down"): Promise<void> {
  const db = await getDb();
  const schedules = await db.getAllAsync<LocalSchedule>(
    'SELECT * FROM schedules WHERE (pendingOp IS NULL OR pendingOp != \'delete\') ORDER BY "order" ASC'
  );
  const index = schedules.findIndex((s) => s.id === id);
  if (index === -1) return;
  const neighborIndex = direction === "up" ? index - 1 : index + 1;
  const neighbor = schedules[neighborIndex];
  if (!neighbor) return;

  const beforeNeighborIndex = direction === "up" ? neighborIndex - 1 : neighborIndex + 1;
  const beyond = schedules[beforeNeighborIndex];
  const order =
    direction === "up"
      ? beyond
        ? (beyond.order + neighbor.order) / 2
        : neighbor.order - 1000
      : beyond
        ? (beyond.order + neighbor.order) / 2
        : neighbor.order + 1000;

  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE schedules SET "order" = ?, updatedAt = ?,
       pendingOp = CASE WHEN synced = 1 THEN 'update' ELSE pendingOp END
     WHERE id = ?`,
    [order, now, id]
  );
}

export async function deleteScheduleLocal(id: string): Promise<void> {
  const db = await getDb();
  const schedule = await db.getFirstAsync<LocalSchedule>("SELECT * FROM schedules WHERE id = ?", [id]);
  if (!schedule) return;
  if (schedule.synced === 0) {
    await db.runAsync("DELETE FROM schedules WHERE id = ?", [id]);
  } else {
    await db.runAsync("UPDATE schedules SET pendingOp = 'delete' WHERE id = ?", [id]);
  }
}

export async function listUnsyncedSchedules(): Promise<LocalSchedule[]> {
  const db = await getDb();
  return db.getAllAsync<LocalSchedule>("SELECT * FROM schedules WHERE synced = 0");
}

export async function listSchedulesPendingUpdate(): Promise<LocalSchedule[]> {
  const db = await getDb();
  return db.getAllAsync<LocalSchedule>("SELECT * FROM schedules WHERE synced = 1 AND pendingOp = 'update'");
}

export async function listSchedulesPendingDelete(): Promise<LocalSchedule[]> {
  const db = await getDb();
  return db.getAllAsync<LocalSchedule>("SELECT * FROM schedules WHERE pendingOp = 'delete'");
}

/** Además de sustituir el id local por el de servidor, reasigna filas que ya colgaran de este
 * horario mientras era solo local — mismo motivo que tasksRepo.markTaskSynced/reparentSubtasks. */
export async function markScheduleSynced(localId: string, serverId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE schedules SET id = ?, synced = 1 WHERE id = ?", [String(serverId), localId]);
  await reparentScheduleRows(localId, String(serverId));
}

export async function clearSchedulePendingOp(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE schedules SET pendingOp = NULL WHERE id = ?", [id]);
}

/** Quita la fila local tras confirmar el borrado con el servidor (nombre "Row" = fila de SQLite,
 * no confundir con la entidad ScheduleRow — misma convención que tasksRepo.deleteTaskRow). */
export async function deleteScheduleDbRow(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM schedules WHERE id = ?", [id]);
}
