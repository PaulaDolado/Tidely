import * as Crypto from "expo-crypto";
import { getDb } from "./index";
import { reparentGoalProgress } from "./goalProgressRepo";
import { LocalGoal, ServerGoal } from "../types";

export async function upsertGoals(goals: ServerGoal[]): Promise<void> {
  if (goals.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const g of goals) {
      const id = String(g.id);
      await db.runAsync(
        `INSERT INTO goals
           (id, title, description, period, targetValue, currentValue, completed, bonusPoints,
            periodStart, periodEnd, expired, autoRenew, updatedAt, synced, pendingOp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, description = excluded.description,
           period = excluded.period, targetValue = excluded.targetValue, currentValue = excluded.currentValue,
           completed = excluded.completed, bonusPoints = excluded.bonusPoints, periodStart = excluded.periodStart,
           periodEnd = excluded.periodEnd, expired = excluded.expired, autoRenew = excluded.autoRenew,
           updatedAt = excluded.updatedAt, synced = 1
         WHERE goals.pendingOp IS NULL`,
        [
          id,
          g.title,
          g.description,
          g.period,
          g.targetValue,
          g.currentValue,
          g.completed ? 1 : 0,
          g.bonusPoints,
          g.periodStart,
          g.periodEnd,
          g.expired ? 1 : 0,
          g.autoRenew ? 1 : 0,
          g.updatedAt,
        ]
      );
    }
  });
}

export async function deleteGoal(serverId: number): Promise<void> {
  const db = await getDb();
  const id = String(serverId);
  await db.runAsync("DELETE FROM goals WHERE id = ? AND synced = 1", [id]);
  // Cascade local, igual criterio que habitsRepo.deleteHabit con sus habit_logs.
  await db.runAsync("DELETE FROM goal_progress WHERE goalId = ?", [id]);
}

export async function listGoals(status: "active" | "completed" | "expired" | "all" = "active"): Promise<LocalGoal[]> {
  const db = await getDb();
  const base = "SELECT * FROM goals WHERE (pendingOp IS NULL OR pendingOp != 'delete')";
  if (status === "active") return db.getAllAsync<LocalGoal>(`${base} AND completed = 0 AND expired = 0 ORDER BY periodEnd ASC`);
  if (status === "completed") return db.getAllAsync<LocalGoal>(`${base} AND completed = 1 ORDER BY periodEnd ASC`);
  if (status === "expired") return db.getAllAsync<LocalGoal>(`${base} AND expired = 1 ORDER BY periodEnd ASC`);
  return db.getAllAsync<LocalGoal>(`${base} ORDER BY periodEnd ASC`);
}

export async function getGoal(id: string): Promise<LocalGoal | null> {
  const db = await getDb();
  return db.getFirstAsync<LocalGoal>("SELECT * FROM goals WHERE id = ?", [id]);
}

export async function createGoalLocal(input: {
  title: string;
  description: string | null;
  period: "weekly" | "monthly" | "annual";
  targetValue: number;
  bonusPoints: number;
  periodStart: string;
  periodEnd: string;
  autoRenew: boolean;
}): Promise<string> {
  const db = await getDb();
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO goals
       (id, title, description, period, targetValue, currentValue, completed, bonusPoints,
        periodStart, periodEnd, expired, autoRenew, updatedAt, synced, pendingOp)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?, 0, ?, ?, 0, NULL)`,
    [
      id,
      input.title,
      input.description,
      input.period,
      input.targetValue,
      input.bonusPoints,
      input.periodStart,
      input.periodEnd,
      input.autoRenew ? 1 : 0,
      now,
    ]
  );
  return id;
}

export async function deleteGoalLocal(id: string): Promise<void> {
  const db = await getDb();
  const goal = await db.getFirstAsync<LocalGoal>("SELECT * FROM goals WHERE id = ?", [id]);
  if (!goal) return;
  if (goal.synced === 0) {
    await db.runAsync("DELETE FROM goals WHERE id = ?", [id]);
  } else {
    await db.runAsync("UPDATE goals SET pendingOp = 'delete' WHERE id = ?", [id]);
  }
}

export async function listUnsyncedGoals(): Promise<LocalGoal[]> {
  const db = await getDb();
  return db.getAllAsync<LocalGoal>("SELECT * FROM goals WHERE synced = 0");
}

export async function listGoalsPendingUpdate(): Promise<LocalGoal[]> {
  const db = await getDb();
  return db.getAllAsync<LocalGoal>("SELECT * FROM goals WHERE synced = 1 AND pendingOp = 'update'");
}

export async function listGoalsPendingDelete(): Promise<LocalGoal[]> {
  const db = await getDb();
  return db.getAllAsync<LocalGoal>("SELECT * FROM goals WHERE pendingOp = 'delete'");
}

/** Además de sustituir el id local por el de servidor, reasigna cualquier registro de progreso
 * que ya colgara de esta meta mientras era solo local — mismo motivo que
 * tasksRepo.markTaskSynced/reparentSubtasks. */
export async function markGoalSynced(localId: string, serverId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE goals SET id = ?, synced = 1 WHERE id = ?", [String(serverId), localId]);
  await reparentGoalProgress(localId, String(serverId));
}

export async function clearGoalPendingOp(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE goals SET pendingOp = NULL WHERE id = ?", [id]);
}

export async function deleteGoalRow(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM goals WHERE id = ?", [id]);
}
