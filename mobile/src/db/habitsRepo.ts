import * as Crypto from "expo-crypto";
import { getDb } from "./index";
import { LocalHabit, LocalHabitLog, ServerHabit, ServerHabitLog } from "../types";

// --- Habit: offline-first como el resto (alta/renombrado/borrado se escriben en SQLite con su
// `pendingOp` y suben por /sync, ver sync/push.ts). Un hábito creado offline usa un id NEGATIVO
// provisional (no cabe un uuid en `id INTEGER`, y habit_logs.habitId/HoyScreen/HabitsCard lo usan
// como número) más un `localId` uuid para el sobre de /sync; `markHabitSynced` lo sustituye por el
// id real de servidor, también en sus marcas diarias. ---

/** Un pull nunca pisa un hábito con una operación local pendiente (renombrado/borrado sin subir)
 * — se resolverá en el próximo push, mismo criterio que tasksRepo.upsertTasks. */
export async function upsertHabits(habits: ServerHabit[]): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const h of habits) {
      if (!h.active) {
        await db.runAsync("DELETE FROM habits WHERE id = ? AND pendingOp IS NULL", [h.id]);
        continue;
      }
      await db.runAsync(
        `INSERT INTO habits (id, title, updatedAt, localId, synced, pendingOp) VALUES (?, ?, ?, NULL, 1, NULL)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, updatedAt = excluded.updatedAt, synced = 1
         WHERE habits.pendingOp IS NULL`,
        [h.id, h.title, h.updatedAt]
      );
    }
  });
}

/** Tombstone de un hábito borrado en otro dispositivo (o ya confirmado por nuestro propio push):
 * se lleva también sus marcas diarias, igual que el cascade del servidor. */
export async function deleteHabit(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM habits WHERE id = ?", [id]);
  await db.runAsync("DELETE FROM habit_logs WHERE habitId = ?", [id]);
}

/** Excluye lo marcado para borrar (borrado optimista, igual que `notesRepo.listNotes`). */
export async function listHabits(): Promise<LocalHabit[]> {
  const db = await getDb();
  return db.getAllAsync<LocalHabit>(
    "SELECT * FROM habits WHERE (pendingOp IS NULL OR pendingOp != 'delete') ORDER BY title ASC"
  );
}

export async function createHabitLocal(title: string): Promise<number> {
  const db = await getDb();
  // Siguiente id negativo libre: nunca choca con un id de servidor (siempre positivo).
  const row = await db.getFirstAsync<{ minId: number | null }>("SELECT MIN(id) AS minId FROM habits");
  const id = Math.min(-1, (row?.minId ?? 0) - 1);
  const now = new Date().toISOString();
  await db.runAsync("INSERT INTO habits (id, title, updatedAt, localId, synced, pendingOp) VALUES (?, ?, ?, ?, 0, NULL)", [
    id,
    title,
    now,
    Crypto.randomUUID(),
  ]);
  return id;
}

export async function renameHabitLocal(id: number, title: string): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE habits SET title = ?, updatedAt = ?,
       pendingOp = CASE WHEN synced = 1 THEN 'update' ELSE pendingOp END
     WHERE id = ?`,
    [title, now, id]
  );
}

/** Igual criterio que `notesRepo.deleteNoteLocal`: un hábito que nunca llegó al servidor se borra
 * sin más (con sus marcas) — no hay nada que decirle al servidor. */
export async function deleteHabitLocal(id: number): Promise<void> {
  const db = await getDb();
  const habit = await db.getFirstAsync<LocalHabit>("SELECT * FROM habits WHERE id = ?", [id]);
  if (!habit) return;
  if (habit.synced === 0) {
    await db.runAsync("DELETE FROM habits WHERE id = ?", [id]);
    await db.runAsync("DELETE FROM habit_logs WHERE habitId = ?", [id]);
  } else {
    await db.runAsync("UPDATE habits SET pendingOp = 'delete' WHERE id = ?", [id]);
  }
}

export async function listUnsyncedHabits(): Promise<LocalHabit[]> {
  const db = await getDb();
  return db.getAllAsync<LocalHabit>("SELECT * FROM habits WHERE synced = 0 AND localId IS NOT NULL");
}

export async function listHabitsPendingUpdate(): Promise<LocalHabit[]> {
  const db = await getDb();
  return db.getAllAsync<LocalHabit>("SELECT * FROM habits WHERE synced = 1 AND pendingOp = 'update'");
}

export async function listHabitsPendingDelete(): Promise<LocalHabit[]> {
  const db = await getDb();
  return db.getAllAsync<LocalHabit>("SELECT * FROM habits WHERE synced = 1 AND pendingOp = 'delete'");
}

/** Sustituye el id negativo provisional por el de servidor y reasigna las marcas diarias ya
 * hechas mientras el hábito era solo local — mismo motivo que tasksRepo.markTaskSynced con sus
 * subtareas (si no, quedarían huérfanas y nunca podrían subirse). */
export async function markHabitSynced(localId: string, serverId: number): Promise<void> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ id: number }>("SELECT id FROM habits WHERE localId = ?", [localId]);
  if (!row) return;
  await db.withTransactionAsync(async () => {
    await db.runAsync("UPDATE habit_logs SET habitId = ? WHERE habitId = ?", [serverId, row.id]);
    await db.runAsync("UPDATE habits SET id = ?, localId = NULL, synced = 1 WHERE id = ?", [serverId, row.id]);
  });
}

export async function clearHabitPendingOp(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE habits SET pendingOp = NULL WHERE id = ?", [id]);
}

/** Tras confirmar el borrado en el servidor (que se lleva en cascada sus marcas). */
export async function deleteHabitRow(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM habits WHERE id = ?", [id]);
  await db.runAsync("DELETE FROM habit_logs WHERE habitId = ?", [id]);
}

// --- HabitLog: clave compuesta (habitId, date), igual que en el servidor — ver types.ts ---

/** Un log confirmado por el servidor (llegado por pull) nunca se pisa si hay un `pending` local
 * — mismo motivo que en tasksRepo.upsertTasks. */
export async function upsertHabitLogs(logs: ServerHabitLog[]): Promise<void> {
  if (logs.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const log of logs) {
      await db.runAsync(
        `INSERT INTO habit_logs (habitId, date, serverId, pending) VALUES (?, ?, ?, NULL)
         ON CONFLICT(habitId, date) DO UPDATE SET serverId = excluded.serverId, pending = NULL
         WHERE habit_logs.pending IS NULL OR habit_logs.pending = 'create'`,
        [log.habitId, log.date, log.id]
      );
    }
  });
}

/** Tombstone de un habitLog: el servidor solo da su `entityId` (el id de fila que ya no
 * existe), así que hace falta haber guardado `serverId` en el pull anterior para saber qué fila
 * local le corresponde (ver types.ts, comentario de LocalHabitLog.serverId). */
export async function deleteHabitLogByServerId(serverId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM habit_logs WHERE serverId = ?", [serverId]);
}

export async function listHabitLogsForHabit(habitId: number): Promise<LocalHabitLog[]> {
  const db = await getDb();
  return db.getAllAsync<LocalHabitLog>(
    "SELECT * FROM habit_logs WHERE habitId = ? AND (pending IS NULL OR pending != 'delete')",
    [habitId]
  );
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function isHabitDoneToday(habitId: number): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync(
    "SELECT 1 FROM habit_logs WHERE habitId = ? AND date = ? AND (pending IS NULL OR pending != 'delete')",
    [habitId, todayKey()]
  );
  return row != null;
}

/** Marca/desmarca un día concreto ("YYYY-MM-DD", misma clave UTC que `todayKey()` y que la que sube
 * sync/push.ts) para un hábito — como en la web, se puede marcar cualquier día de la semana en
 * curso, no solo hoy. Si el registro nunca llegó a sincronizarse (`pending = 'create'`) al
 * desmarcarlo se borra sin más — nunca existió en el servidor, no hay nada que subir como
 * borrado. */
export async function toggleHabitOnDate(habitId: number, date: string): Promise<void> {
  const db = await getDb();
  const existing = await db.getFirstAsync<LocalHabitLog>(
    "SELECT * FROM habit_logs WHERE habitId = ? AND date = ?",
    [habitId, date]
  );

  if (existing && existing.pending !== "delete") {
    if (existing.pending === "create") {
      await db.runAsync("DELETE FROM habit_logs WHERE habitId = ? AND date = ?", [habitId, date]);
    } else {
      await db.runAsync("UPDATE habit_logs SET pending = 'delete' WHERE habitId = ? AND date = ?", [habitId, date]);
    }
    return;
  }

  await db.runAsync(
    `INSERT INTO habit_logs (habitId, date, serverId, pending) VALUES (?, ?, NULL, 'create')
     ON CONFLICT(habitId, date) DO UPDATE SET pending = 'create'`,
    [habitId, date]
  );
}

/** Marca/desmarca hoy para un hábito (atajo de `toggleHabitOnDate`, lo usa la pantalla "Hoy"). */
export async function toggleHabitToday(habitId: number): Promise<void> {
  await toggleHabitOnDate(habitId, todayKey());
}

/** Solo marcas de hábitos que ya tienen id de servidor (positivo): una marca de un hábito creado
 * offline (habitId negativo provisional) espera a que `markHabitSynced` la reasigne — mismo
 * criterio que subtasksRepo.listUnsyncedSubtasksReadyToPush con taskId. */
export async function listPendingHabitLogs(): Promise<LocalHabitLog[]> {
  const db = await getDb();
  return db.getAllAsync<LocalHabitLog>("SELECT * FROM habit_logs WHERE pending IS NOT NULL AND habitId > 0");
}

export async function confirmHabitLogCreated(habitId: number, date: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE habit_logs SET pending = NULL WHERE habitId = ? AND date = ?", [habitId, date]);
}

export async function confirmHabitLogDeleted(habitId: number, date: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM habit_logs WHERE habitId = ? AND date = ?", [habitId, date]);
}
