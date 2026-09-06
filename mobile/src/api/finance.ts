// Cliente REST directo para "Finanzas" y "Metas de ahorro" — mismo criterio que src/api/goals.ts
// y src/api/schedule.ts: Transaction/SavingsGoal no forman parte del contrato de sync offline del
// backend (API.md los lista explícitamente entre lo que "no sincroniza, solo web, por ahora"),
// así que estas pantallas no pasan por SQLite y necesitan conexión, igual que
// `dashboard/src/pages/FinanzasPage.tsx`/`MetasAhorroPage.tsx`.
import { api } from "./client";

export type TransactionType = "income" | "expense";

export interface Transaction {
  id: number;
  type: TransactionType;
  amount: number;
  category: string;
  description: string | null;
  date: string;
}

export interface NewTransactionInput {
  type: TransactionType;
  amount: number;
  category: string;
  description?: string | null;
  date?: string;
}

export interface MonthlyBalance {
  month: number;
  year: number;
  income: number;
  expense: number;
  balance: number;
}

export interface FinanceAnalytics {
  month: number;
  year: number;
  topCategories: { category: string; total: number }[];
  monthlyTrend: MonthlyBalance[];
  projectedAnnual: { basedOnMonths: number; avgMonthlyBalance: number; projectedYearEnd: number };
}

export const getMonthlyBalance = (month: number, year: number) => api.get<MonthlyBalance>(`/finance/balance/${month}/${year}`);

export async function listTransactions(limit = 15): Promise<Transaction[]> {
  const res = await api.get<{ transactions: Transaction[] }>(`/finance/transactions?limit=${limit}`);
  return res.transactions;
}

export const createTransaction = (input: NewTransactionInput) => api.post<Transaction>("/finance/transactions", input);
export const updateTransaction = (id: number, input: NewTransactionInput) => api.put<Transaction>(`/finance/transactions/${id}`, input);
export const deleteTransaction = (id: number) => api.delete<{ message: string }>(`/finance/transactions/${id}`);

export const getAnalytics = () => api.get<FinanceAnalytics>("/finance/analytics");

export type SavingsGoalType = "ahorro" | "inversion";

export interface SavingsGoal {
  id: number;
  name: string;
  type: SavingsGoalType;
  targetAmount: number;
  currentAmount: number; // calculado dinámicamente por el backend, no se guarda tal cual
  progressPercent: number;
  stepAmount: number;
  category: string; // slug auto-generado, ver createSavingsGoalInput en la pantalla
  deadline: string | null;
  createdAt: string;
}

export interface NewSavingsGoalInput {
  name: string;
  type: SavingsGoalType;
  targetAmount: number;
  category: string;
  stepAmount: number;
  deadline?: string | null;
}

export async function listSavingsGoals(type?: SavingsGoalType | "all"): Promise<SavingsGoal[]> {
  const query = type && type !== "all" ? `?type=${type}` : "";
  const res = await api.get<{ savingsGoals: SavingsGoal[] }>(`/finance/savings-goals${query}`);
  return res.savingsGoals;
}

export const createSavingsGoal = (input: NewSavingsGoalInput) => api.post<SavingsGoal>("/finance/savings-goals", input);
export const deleteSavingsGoal = (id: number) => api.delete<{ message: string }>(`/finance/savings-goals/${id}`);
export const contributeSavingsGoal = (id: number, amount: number) => api.post<SavingsGoal>(`/finance/savings-goals/${id}/contribute`, { amount });
