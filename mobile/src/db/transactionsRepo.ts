import * as Crypto from "expo-crypto";
import { getDb } from "./index";
import { LocalTransaction, ServerTransaction } from "../types";

/** Igual patrón que tasksRepo/notesRepo: un pull nunca pisa una fila con una operación local
 * pendiente — se resolverá en el próximo push. */
export async function upsertTransactions(transactions: ServerTransaction[]): Promise<void> {
  if (transactions.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const t of transactions) {
      const id = String(t.id);
      await db.runAsync(
        `INSERT INTO transactions (id, type, amount, category, description, date, updatedAt, synced, pendingOp)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL)
         ON CONFLICT(id) DO UPDATE SET type = excluded.type, amount = excluded.amount,
           category = excluded.category, description = excluded.description, date = excluded.date,
           updatedAt = excluded.updatedAt, synced = 1
         WHERE transactions.pendingOp IS NULL`,
        [id, t.type, t.amount, t.category, t.description, t.date, t.updatedAt]
      );
    }
  });
}

export async function deleteTransaction(serverId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM transactions WHERE id = ? AND synced = 1", [String(serverId)]);
}

/** Excluye lo marcado para borrar (borrado optimista, igual que notesRepo.listNotes). */
export async function listTransactions(limit: number): Promise<LocalTransaction[]> {
  const db = await getDb();
  return db.getAllAsync<LocalTransaction>(
    `SELECT * FROM transactions WHERE pendingOp IS NULL OR pendingOp != 'delete' ORDER BY date DESC LIMIT ?`,
    [limit]
  );
}

/** Para calcular currentAmount de una meta de ahorro localmente — mismo criterio que
 * financeService.computeSavingsProgress en el backend (income - expense de esa categoría). */
export async function sumTransactionsByCategory(category: string): Promise<{ income: number; expense: number }> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ income: number | null; expense: number | null }>(
    `SELECT
       SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as income,
       SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as expense
     FROM transactions
     WHERE category = ? AND (pendingOp IS NULL OR pendingOp != 'delete')`,
    [category]
  );
  return { income: row?.income ?? 0, expense: row?.expense ?? 0 };
}

export async function createTransactionLocal(input: {
  type: "income" | "expense";
  amount: number;
  category: string;
  description: string | null;
  date: string;
}): Promise<string> {
  const db = await getDb();
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO transactions (id, type, amount, category, description, date, updatedAt, synced, pendingOp)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL)`,
    [id, input.type, input.amount, input.category, input.description, input.date, now]
  );
  return id;
}

export async function updateTransactionLocal(
  id: string,
  input: { type: "income" | "expense"; amount: number; category: string; description: string | null; date: string }
): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE transactions SET type = ?, amount = ?, category = ?, description = ?, date = ?, updatedAt = ?,
       pendingOp = CASE WHEN synced = 1 THEN 'update' ELSE pendingOp END
     WHERE id = ?`,
    [input.type, input.amount, input.category, input.description, input.date, now, id]
  );
}

/** Igual criterio que notesRepo.deleteNoteLocal. */
export async function deleteTransactionLocal(id: string): Promise<void> {
  const db = await getDb();
  const tx = await db.getFirstAsync<LocalTransaction>("SELECT * FROM transactions WHERE id = ?", [id]);
  if (!tx) return;
  if (tx.synced === 0) {
    await db.runAsync("DELETE FROM transactions WHERE id = ?", [id]);
  } else {
    await db.runAsync("UPDATE transactions SET pendingOp = 'delete' WHERE id = ?", [id]);
  }
}

export async function listUnsyncedTransactions(): Promise<LocalTransaction[]> {
  const db = await getDb();
  return db.getAllAsync<LocalTransaction>("SELECT * FROM transactions WHERE synced = 0");
}

export async function listTransactionsPendingUpdate(): Promise<LocalTransaction[]> {
  const db = await getDb();
  return db.getAllAsync<LocalTransaction>("SELECT * FROM transactions WHERE synced = 1 AND pendingOp = 'update'");
}

export async function listTransactionsPendingDelete(): Promise<LocalTransaction[]> {
  const db = await getDb();
  return db.getAllAsync<LocalTransaction>("SELECT * FROM transactions WHERE pendingOp = 'delete'");
}

export async function markTransactionSynced(localId: string, serverId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE transactions SET id = ?, synced = 1 WHERE id = ?", [String(serverId), localId]);
}

export async function clearTransactionPendingOp(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE transactions SET pendingOp = NULL WHERE id = ?", [id]);
}

export async function deleteTransactionRow(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM transactions WHERE id = ?", [id]);
}

// --- Agregados locales (balance mensual, analytics) — puerto de financeService.ts en el
// backend, sobre las transacciones ya sincronizadas en SQLite en vez de una consulta a la API,
// para que Finanzas funcione sin conexión igual que el resto de pantallas offline-first. ---

async function listAllTransactions(): Promise<LocalTransaction[]> {
  const db = await getDb();
  return db.getAllAsync<LocalTransaction>("SELECT * FROM transactions WHERE pendingOp IS NULL OR pendingOp != 'delete'");
}

function sumByType(rows: LocalTransaction[]): { income: number; expense: number; balance: number } {
  let income = 0;
  let expense = 0;
  for (const t of rows) {
    if (t.type === "income") income += t.amount;
    else expense += t.amount;
  }
  return { income, expense, balance: income - expense };
}

export interface MonthlyBalance {
  month: number;
  year: number;
  income: number;
  expense: number;
  balance: number;
}

export async function getMonthlyBalanceLocal(month: number, year: number): Promise<MonthlyBalance> {
  const all = await listAllTransactions();
  const inMonth = all.filter((t) => {
    const d = new Date(t.date);
    return d.getFullYear() === year && d.getMonth() === month - 1;
  });
  return { month, year, ...sumByType(inMonth) };
}

export interface FinanceAnalytics {
  month: number;
  year: number;
  topCategories: { category: string; total: number }[];
  monthlyTrend: { month: number; year: number; income: number; expense: number; balance: number }[];
  projectedAnnual: { basedOnMonths: number; avgMonthlyBalance: number; projectedYearEnd: number };
}

/** Mismo cálculo que financeService.getAnalytics en el backend: top 5 categorías de gasto del
 * mes de referencia + tendencia de los últimos 6 meses (incluido el de referencia). */
export async function getAnalyticsLocal(month?: number, year?: number): Promise<FinanceAnalytics> {
  const now = new Date();
  const refMonth = month ?? now.getMonth() + 1;
  const refYear = year ?? now.getFullYear();
  const all = await listAllTransactions();

  const monthKey = (y: number, m: number) => `${y}-${m}`;
  const buckets = new Map<string, { month: number; year: number; income: number; expense: number }>();
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(refYear, refMonth - 1 - i, 1);
    buckets.set(monthKey(d.getFullYear(), d.getMonth()), { month: d.getMonth() + 1, year: d.getFullYear(), income: 0, expense: 0 });
  }

  const categoryTotals = new Map<string, number>();
  for (const t of all) {
    const d = new Date(t.date);
    const bucket = buckets.get(monthKey(d.getFullYear(), d.getMonth()));
    if (bucket) {
      if (t.type === "income") bucket.income += t.amount;
      else bucket.expense += t.amount;
    }
    if (t.type === "expense" && d.getFullYear() === refYear && d.getMonth() === refMonth - 1) {
      categoryTotals.set(t.category, (categoryTotals.get(t.category) ?? 0) + t.amount);
    }
  }

  const topCategories = [...categoryTotals.entries()]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  const monthlyTrend = [...buckets.values()].map((b) => ({ ...b, balance: b.income - b.expense }));
  const avgMonthlyBalance = monthlyTrend.reduce((sum, m) => sum + m.balance, 0) / (monthlyTrend.length || 1);

  return {
    month: refMonth,
    year: refYear,
    topCategories,
    monthlyTrend,
    projectedAnnual: {
      basedOnMonths: monthlyTrend.length,
      avgMonthlyBalance: Math.round(avgMonthlyBalance * 100) / 100,
      projectedYearEnd: Math.round(avgMonthlyBalance * 12 * 100) / 100,
    },
  };
}
