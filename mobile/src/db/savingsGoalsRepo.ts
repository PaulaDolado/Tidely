import * as Crypto from "expo-crypto";
import { getDb } from "./index";
import { sumTransactionsByCategory } from "./transactionsRepo";
import { LocalSavingsGoal, ServerSavingsGoal } from "../types";

export async function upsertSavingsGoals(goals: ServerSavingsGoal[]): Promise<void> {
  if (goals.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const g of goals) {
      const id = String(g.id);
      await db.runAsync(
        `INSERT INTO savings_goals (id, name, type, targetAmount, category, stepAmount, deadline, createdAt, updatedAt, synced, pendingOp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type,
           targetAmount = excluded.targetAmount, category = excluded.category, stepAmount = excluded.stepAmount,
           deadline = excluded.deadline, updatedAt = excluded.updatedAt, synced = 1
         WHERE savings_goals.pendingOp IS NULL`,
        [id, g.name, g.type, g.targetAmount, g.category, g.stepAmount, g.deadline, g.createdAt, g.updatedAt]
      );
    }
  });
}

export async function deleteSavingsGoal(serverId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM savings_goals WHERE id = ? AND synced = 1", [String(serverId)]);
}

export interface LocalSavingsGoalWithProgress extends LocalSavingsGoal {
  currentAmount: number;
  progressPercent: number;
}

/** currentAmount/progressPercent no se guardan (ver ServerSavingsGoal) — se calculan aquí sumando
 * las transacciones locales de la misma categoría, igual criterio que
 * financeService.listSavingsGoals en el backend. */
export async function listSavingsGoals(type?: "ahorro" | "inversion"): Promise<LocalSavingsGoalWithProgress[]> {
  const db = await getDb();
  const goals = await db.getAllAsync<LocalSavingsGoal>(
    type
      ? "SELECT * FROM savings_goals WHERE type = ? AND (pendingOp IS NULL OR pendingOp != 'delete')"
      : "SELECT * FROM savings_goals WHERE pendingOp IS NULL OR pendingOp != 'delete'",
    type ? [type] : []
  );
  return Promise.all(
    goals.map(async (g) => {
      const { income, expense } = await sumTransactionsByCategory(g.category);
      const currentAmount = Math.max(0, income - expense);
      return {
        ...g,
        currentAmount,
        progressPercent: g.targetAmount > 0 ? Math.min(100, Math.round((currentAmount / g.targetAmount) * 100)) : 0,
      };
    })
  );
}

export async function createSavingsGoalLocal(input: {
  name: string;
  type: "ahorro" | "inversion";
  targetAmount: number;
  category: string;
  stepAmount: number;
  deadline: string | null;
}): Promise<string> {
  const db = await getDb();
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO savings_goals (id, name, type, targetAmount, category, stepAmount, deadline, createdAt, updatedAt, synced, pendingOp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)`,
    [id, input.name, input.type, input.targetAmount, input.category, input.stepAmount, input.deadline, now, now]
  );
  return id;
}

export async function updateSavingsGoalLocal(
  id: string,
  input: { name: string; type: "ahorro" | "inversion"; targetAmount: number; category: string; stepAmount: number; deadline: string | null }
): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE savings_goals SET name = ?, type = ?, targetAmount = ?, category = ?, stepAmount = ?, deadline = ?, updatedAt = ?,
       pendingOp = CASE WHEN synced = 1 THEN 'update' ELSE pendingOp END
     WHERE id = ?`,
    [input.name, input.type, input.targetAmount, input.category, input.stepAmount, input.deadline, now, id]
  );
}

export async function deleteSavingsGoalLocal(id: string): Promise<void> {
  const db = await getDb();
  const goal = await db.getFirstAsync<LocalSavingsGoal>("SELECT * FROM savings_goals WHERE id = ?", [id]);
  if (!goal) return;
  if (goal.synced === 0) {
    await db.runAsync("DELETE FROM savings_goals WHERE id = ?", [id]);
  } else {
    await db.runAsync("UPDATE savings_goals SET pendingOp = 'delete' WHERE id = ?", [id]);
  }
}

export async function listUnsyncedSavingsGoals(): Promise<LocalSavingsGoal[]> {
  const db = await getDb();
  return db.getAllAsync<LocalSavingsGoal>("SELECT * FROM savings_goals WHERE synced = 0");
}

export async function listSavingsGoalsPendingUpdate(): Promise<LocalSavingsGoal[]> {
  const db = await getDb();
  return db.getAllAsync<LocalSavingsGoal>("SELECT * FROM savings_goals WHERE synced = 1 AND pendingOp = 'update'");
}

export async function listSavingsGoalsPendingDelete(): Promise<LocalSavingsGoal[]> {
  const db = await getDb();
  return db.getAllAsync<LocalSavingsGoal>("SELECT * FROM savings_goals WHERE pendingOp = 'delete'");
}

export async function markSavingsGoalSynced(localId: string, serverId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE savings_goals SET id = ?, synced = 1 WHERE id = ?", [String(serverId), localId]);
}

export async function clearSavingsGoalPendingOp(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE savings_goals SET pendingOp = NULL WHERE id = ?", [id]);
}

export async function deleteSavingsGoalRow(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM savings_goals WHERE id = ?", [id]);
}

// "Aportar/retirar" (ver dashboard contributeToSavingsGoal) no tiene función propia aquí: es
// literalmente crear una Transaction con la categoría de la meta — la pantalla llama
// transactionsRepo.createTransactionLocal directamente, mismo criterio que el backend (no hay
// un "wallet" aparte, ver financeService.contributeToSavingsGoal).
