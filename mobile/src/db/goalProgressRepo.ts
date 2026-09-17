import * as Crypto from "expo-crypto";
import { getDb } from "./index";
import { LocalGoal, LocalGoalProgress, ServerGoalProgress } from "../types";

export async function upsertGoalProgress(entries: ServerGoalProgress[]): Promise<void> {
  if (entries.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const p of entries) {
      const id = String(p.id);
      await db.runAsync(
        `INSERT INTO goal_progress (id, goalId, value, note, date, updatedAt, synced, pendingOp)
         VALUES (?, ?, ?, ?, ?, ?, 1, NULL)
         ON CONFLICT(id) DO UPDATE SET goalId = excluded.goalId, value = excluded.value, note = excluded.note,
           date = excluded.date, updatedAt = excluded.updatedAt, synced = 1
         WHERE goal_progress.pendingOp IS NULL`,
        [id, String(p.goalId), p.value, p.note, p.date, p.updatedAt]
      );
    }
  });
}

export async function deleteGoalProgress(serverId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM goal_progress WHERE id = ? AND synced = 1", [String(serverId)]);
}

/** Igual motivo que subtasksRepo.reparentSubtasks: una meta creada offline tiene un uuid como id
 * hasta que sincroniza — los registros de progreso ya creados bajo esa meta hay que
 * reasignarlos, o quedarían huérfanos y nunca podrían subirse. */
export async function reparentGoalProgress(oldGoalId: string, newGoalId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE goal_progress SET goalId = ? WHERE goalId = ?", [newGoalId, oldGoalId]);
}

export async function listForGoal(goalId: string): Promise<LocalGoalProgress[]> {
  const db = await getDb();
  return db.getAllAsync<LocalGoalProgress>(
    "SELECT * FROM goal_progress WHERE goalId = ? AND (pendingOp IS NULL OR pendingOp != 'delete') ORDER BY date DESC",
    [goalId]
  );
}

/** Refleja en la fila local de la meta el efecto de crear/editar/borrar un registro — mismo
 * cálculo que goalsService.registerProgress/updateProgress/deleteProgress en el backend, para que
 * la UI no espere al próximo pull para ver currentValue/completed actualizados. */
async function applyDeltaToGoal(goalId: string, delta: number): Promise<void> {
  const db = await getDb();
  const goal = await db.getFirstAsync<LocalGoal>("SELECT * FROM goals WHERE id = ?", [goalId]);
  if (!goal) return;
  const currentValue = goal.currentValue + delta;
  const completed = currentValue >= goal.targetValue ? 1 : 0;
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE goals SET currentValue = ?, completed = ?, updatedAt = ?,
       pendingOp = CASE WHEN synced = 1 THEN 'update' ELSE pendingOp END
     WHERE id = ?`,
    [currentValue, completed, now, goalId]
  );
}

export async function createProgressLocal(goalId: string, input: { value: number; note: string | null; date: string }): Promise<string> {
  const db = await getDb();
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO goal_progress (id, goalId, value, note, date, updatedAt, synced, pendingOp)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL)`,
    [id, goalId, input.value, input.note, input.date, now]
  );
  await applyDeltaToGoal(goalId, input.value);
  return id;
}

export async function updateProgressLocal(id: string, input: { value: number; note: string | null; date: string }): Promise<void> {
  const db = await getDb();
  const existing = await db.getFirstAsync<LocalGoalProgress>("SELECT * FROM goal_progress WHERE id = ?", [id]);
  if (!existing) return;
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE goal_progress SET value = ?, note = ?, date = ?, updatedAt = ?,
       pendingOp = CASE WHEN synced = 1 THEN 'update' ELSE pendingOp END
     WHERE id = ?`,
    [input.value, input.note, input.date, now, id]
  );
  await applyDeltaToGoal(existing.goalId, input.value - existing.value);
}

/** Igual criterio que notesRepo.deleteNoteLocal para el registro en sí, más la reversión de
 * currentValue/completed de la meta (delta negativo del value que tenía). */
export async function deleteProgressLocal(id: string): Promise<void> {
  const db = await getDb();
  const existing = await db.getFirstAsync<LocalGoalProgress>("SELECT * FROM goal_progress WHERE id = ?", [id]);
  if (!existing) return;
  if (existing.synced === 0) {
    await db.runAsync("DELETE FROM goal_progress WHERE id = ?", [id]);
  } else {
    await db.runAsync("UPDATE goal_progress SET pendingOp = 'delete' WHERE id = ?", [id]);
  }
  await applyDeltaToGoal(existing.goalId, -existing.value);
}

const NUMERIC_ID = /^\d+$/;

/** Un registro solo puede subirse cuando su meta ya tiene id de servidor — mismo criterio que
 * subtasksRepo.listUnsyncedSubtasksReadyToPush con taskId. */
export async function listUnsyncedProgressReadyToPush(): Promise<LocalGoalProgress[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<LocalGoalProgress>("SELECT * FROM goal_progress WHERE synced = 0");
  return rows.filter((r) => NUMERIC_ID.test(r.goalId));
}

export async function listProgressPendingUpdate(): Promise<LocalGoalProgress[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<LocalGoalProgress>("SELECT * FROM goal_progress WHERE synced = 1 AND pendingOp = 'update'");
  return rows.filter((r) => NUMERIC_ID.test(r.goalId));
}

export async function listProgressPendingDelete(): Promise<LocalGoalProgress[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<LocalGoalProgress>("SELECT * FROM goal_progress WHERE pendingOp = 'delete'");
  return rows.filter((r) => NUMERIC_ID.test(r.goalId));
}

export async function markProgressSynced(localId: string, serverId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE goal_progress SET id = ?, synced = 1 WHERE id = ?", [String(serverId), localId]);
}

export async function clearProgressPendingOp(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE goal_progress SET pendingOp = NULL WHERE id = ?", [id]);
}

export async function deleteProgressRow(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM goal_progress WHERE id = ?", [id]);
}
