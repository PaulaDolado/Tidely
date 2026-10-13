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

// "Resumen del presupuesto" — mismos tipos que BudgetSummary en dashboard/src/types.ts. Las
// categorías de presupuesto no forman parte del sync offline (como el resto de este fichero): se
// piden y se editan por REST, así que esa tarjeta necesita conexión.
export type BudgetColor = "primary" | "secondary" | "habit" | "hobby" | "positive" | "negative" | "warning" | "muted";
export const BUDGET_COLORS: BudgetColor[] = ["primary", "habit", "positive", "hobby", "warning", "negative", "secondary", "muted"];

export interface BudgetSummaryCategory {
  id: number;
  name: string;
  color: BudgetColor;
  percent: number;
  order: number;
  budget: number; // lo máximo que se puede gastar: percent % de la última nómina (ver budgetBase)
  spent: number; // lo gastado este mes en movimientos de esta categoría
}

export interface BudgetSummary {
  month: number;
  year: number;
  income: number;
  totalSpent: number;
  // Sobre qué se calculan los máximos: la última nómina o, si aún no hay, los ingresos del mes
  budgetBase: { source: "nomina" | "ingresos"; amount: number; date: string | null };
  totalBudget: number; // suma de los máximos de todas las categorías
  assignedPercent: number;
  unassignedPercent: number;
  categories: BudgetSummaryCategory[];
  uncategorizedSpent: number;
}

export interface BudgetCategoryInput {
  name: string;
  color: BudgetColor;
  percent: number;
}

export const getBudgetSummary = (month: number, year: number) => api.get<BudgetSummary>(`/finance/budget/${month}/${year}`);
export const createBudgetCategory = (input: BudgetCategoryInput) => api.post("/finance/budget-categories", input);
export const updateBudgetCategory = (id: number, input: BudgetCategoryInput) => api.put(`/finance/budget-categories/${id}`, input);
export const deleteBudgetCategory = (id: number) => api.delete(`/finance/budget-categories/${id}`);

// "Sobrante disponible" de Metas de ahorro (GET /finance/surplus/:mes/:año): ingresos de meses
// anteriores que quedaron libres y aún no están en ninguna meta. El mes en curso queda fuera del
// cálculo (ver financeService.getAvailableSurplus). REST como el resto: necesita conexión.
export interface AvailableSurplus {
  month: number;
  year: number;
  availableSurplus: number;
  totalBalance: number;
  committedToGoals: number;
}

export const getAvailableSurplus = (month: number, year: number) => api.get<AvailableSurplus>(`/finance/surplus/${month}/${year}`);

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
