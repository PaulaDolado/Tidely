import { getDb } from "./index";
import { LocalHabit, LocalHabitLog, ServerHabit, ServerHabitLog } from "../types";

// --- Habit (caché local del servidor — alta/renombrado/borrado van por REST, ver api/habits.ts, y
// tras cada llamada correcta se refleja aquí con upsertHabits/deleteHabit; el sync offline solo
// sube las marcas diarias, los HabitLog) ---

export async function upsertHabits(habits: ServerHabit[]): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const h of habits) {
      if (!h.active) {
        await db.runAsync("DELETE FROM habits WHERE id = ?", [h.id]);
        continue;
      }
      await db.runAsync("INSERT OR REPLACE INTO habits (id, title, updatedAt) VALUES (?, ?, ?)", [
        h.id,
        h.title,
        h.updatedAt,
      ]);
    }
  });
}

export async function deleteHabit(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM habits WHERE id = ?", [id]);
  await db.runAsync("DELETE FROM habit_logs WHERE habitId = ?", [id]);
}

export async function listHabits(): Promise<LocalHabit[]> {
  const db = await getDb();
  return db.getAllAsync<LocalHabit>("SELECT * FROM habits ORDER BY title ASC");
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

export async function listPendingHabitLogs(): Promise<LocalHabitLog[]> {
  const db = await getDb();
  return db.getAllAsync<LocalHabitLog>("SELECT * FROM habit_logs WHERE pending IS NOT NULL");
}

export async function confirmHabitLogCreated(habitId: number, date: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE habit_logs SET pending = NULL WHERE habitId = ? AND date = ?", [habitId, date]);
}

export async function confirmHabitLogDeleted(habitId: number, date: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM habit_logs WHERE habitId = ? AND date = ?", [habitId, date]);
}
