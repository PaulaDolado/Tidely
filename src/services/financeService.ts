import { prisma } from "../config/database";
import { startOfMonth, endOfMonth, startOfYear, endOfYear, subMonths } from "date-fns";
import { ForbiddenError, NotFoundError } from "../utils/errorHandler";

function toNumber(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

async function sumByType(userId: number, start: Date, end: Date) {
  const [incomeAgg, expenseAgg] = await Promise.all([
    prisma.transaction.aggregate({
      where: { userId, type: "income", date: { gte: start, lte: end } },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { userId, type: "expense", date: { gte: start, lte: end } },
      _sum: { amount: true },
    }),
  ]);

  const income = toNumber(incomeAgg._sum.amount);
  const expense = toNumber(expenseAgg._sum.amount);
  return { income, expense, balance: income - expense };
}

export async function getMonthlyBalance(userId: number, month: number, year: number) {
  const reference = new Date(year, month - 1, 1);
  const start = startOfMonth(reference);
  const end = endOfMonth(reference);
  const totals = await sumByType(userId, start, end);
  return { month, year, ...totals };
}

// "Sobrante disponible" del dashboard de ahorro: dinero que ya quedó acumulado en meses ANTERIORES
// al de referencia (ingresos - gastos de todo lo previo, sin límite inferior — no `date` de alta
// de cuenta que acotar) y que todavía no está comprometido en ninguna meta de ahorro. El mes de
// referencia (normalmente el actual) se deja fuera a propósito: sus gastos aún pueden seguir
// llegando, así que no cuenta como "sobrante" hasta que se cierre y pase a ser un mes anterior.
//
// Lo comprometido en metas se resta para no enseñar dos veces el mismo dinero: aportar a una meta
// (ver contributeToSavingsGoal) crea una transacción de `income` más, así que sin esta resta ese
// importe aparecería a la vez como progreso de la meta Y como "sobrante libre" en esta misma
// pantalla. Se calcula con el mismo criterio que listSavingsGoals/computeSavingsProgress (income -
// expense de la categoría de cada meta, todo el histórico, sin acotar por `monthStart` — mismo
// "todo lo aportado hasta hoy" que ya usa el resto del dashboard de ahorro para el progreso).
export async function getAvailableSurplus(userId: number, month: number, year: number) {
  const monthStart = startOfMonth(new Date(year, month - 1, 1));

  const [incomeAgg, expenseAgg, goals] = await Promise.all([
    prisma.transaction.aggregate({
      where: { userId, type: "income", date: { lt: monthStart } },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { userId, type: "expense", date: { lt: monthStart } },
      _sum: { amount: true },
    }),
    prisma.savingsGoal.findMany({ where: { userId }, select: { category: true } }),
  ]);

  const totalBalance = toNumber(incomeAgg._sum.amount) - toNumber(expenseAgg._sum.amount);

  let committedToGoals = 0;
  const goalCategories = [...new Set(goals.map((g) => g.category))];
  if (goalCategories.length > 0) {
    const grouped = await prisma.transaction.groupBy({
      by: ["category", "type"],
      where: { userId, category: { in: goalCategories } },
      _sum: { amount: true },
    });
    const netByCategory = new Map<string, number>();
    for (const g of grouped) {
      const amount = toNumber(g._sum.amount);
      const current = netByCategory.get(g.category) ?? 0;
      netByCategory.set(g.category, current + (g.type === "income" ? amount : -amount));
    }
    for (const net of netByCategory.values()) committedToGoals += Math.max(0, net);
  }

  return {
    month,
    year,
    totalBalance,
    committedToGoals,
    availableSurplus: Math.max(0, totalBalance - committedToGoals),
  };
}

export async function getAnnualBalance(userId: number, year: number) {
  const reference = new Date(year, 0, 1);
  const start = startOfYear(reference);
  const end = endOfYear(reference);

  // Una sola consulta para todo el año; el desglose mensual se calcula en memoria
  // en vez de lanzar 12 consultas (una por mes).
  const transactions = await prisma.transaction.findMany({
    where: { userId, date: { gte: start, lte: end } },
    select: { type: true, amount: true, date: true },
  });

  const monthlyBreakdown = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    year,
    income: 0,
    expense: 0,
    balance: 0,
  }));

  let income = 0;
  let expense = 0;
  for (const t of transactions) {
    const amount = toNumber(t.amount);
    const bucket = monthlyBreakdown[new Date(t.date).getMonth()];
    if (t.type === "income") {
      income += amount;
      bucket.income += amount;
    } else {
      expense += amount;
      bucket.expense += amount;
    }
  }
  monthlyBreakdown.forEach((b) => {
    b.balance = b.income - b.expense;
  });

  return { year, income, expense, balance: income - expense, monthlyBreakdown };
}

interface ListTransactionsFilters {
  type?: string;
  category?: string;
  from?: string | Date;
  to?: string | Date;
  page: number;
  limit: number;
}

export async function listTransactions(userId: number, filters: ListTransactionsFilters) {
  const where = {
    userId,
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.from || filters.to
      ? {
          date: {
            ...(filters.from ? { gte: new Date(filters.from) } : {}),
            ...(filters.to ? { lte: new Date(filters.to) } : {}),
          },
        }
      : {}),
  };

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { date: "desc" },
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
    }),
    prisma.transaction.count({ where }),
  ]);

  return {
    transactions,
    pagination: { page: filters.page, limit: filters.limit, total, pages: Math.ceil(total / filters.limit) },
  };
}

// Para exportar (ver financeController.exportTransactions): TODAS las transacciones del rango,
// sin el límite/paginación de listTransactions — un CSV de un mes o un año tiene que traerlas
// enteras, no una página de 100. Orden ascendente (no descendente como el listado normal) porque
// un export se lee de arriba abajo como iría pasando el año, no "lo más reciente primero".
export async function exportTransactions(userId: number, from: string | Date, to: string | Date) {
  return prisma.transaction.findMany({
    where: { userId, date: { gte: new Date(from), lte: new Date(to) } },
    orderBy: { date: "asc" },
  });
}

interface TransactionInput {
  type: "income" | "expense";
  amount: number;
  category: string;
  description?: string | null;
  date?: string | Date;
}

export async function createTransaction(userId: number, input: TransactionInput) {
  return prisma.transaction.create({
    data: {
      userId,
      type: input.type,
      amount: input.amount,
      category: input.category,
      description: input.description ?? null,
      ...(input.date ? { date: new Date(input.date) } : {}),
    },
  });
}

async function findOwnedTransaction(userId: number, id: number) {
  const transaction = await prisma.transaction.findUnique({ where: { id } });
  if (!transaction) throw new NotFoundError("Transacción no encontrada");
  if (transaction.userId !== userId) throw new ForbiddenError("No autorizado");
  return transaction;
}

export async function updateTransaction(userId: number, id: number, input: Partial<TransactionInput>) {
  await findOwnedTransaction(userId, id);

  return prisma.transaction.update({
    where: { id },
    data: {
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.date !== undefined ? { date: new Date(input.date) } : {}),
    },
  });
}

export async function deleteTransaction(userId: number, id: number) {
  await findOwnedTransaction(userId, id);
  await prisma.transaction.delete({ where: { id } });
}

interface SavingsGoalInput {
  name: string;
  type?: string; // "ahorro" | "inversion"
  targetAmount: number;
  category: string;
  stepAmount?: number;
  deadline?: string | Date | null;
}

// El dinero asignado a una meta de ahorro se registra como `income` (ver contributeToSavingsGoal
// más abajo) y retirarlo/corregirlo como `expense` — de ahí que el progreso sea income - expense
// de esa categoría.
async function computeSavingsProgress(userId: number, category: string) {
  const [incomeAgg, expenseAgg] = await Promise.all([
    prisma.transaction.aggregate({
      where: { userId, category, type: "income" },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { userId, category, type: "expense" },
      _sum: { amount: true },
    }),
  ]);
  return Math.max(0, toNumber(incomeAgg._sum.amount) - toNumber(expenseAgg._sum.amount));
}

export async function listSavingsGoals(userId: number, filters: { type?: string } = {}) {
  const goals = await prisma.savingsGoal.findMany({
    where: { userId, ...(filters.type ? { type: filters.type } : {}) },
  });
  if (goals.length === 0) return [];

  // Una sola consulta agrupada por categoría (en vez de 2 aggregate por cada meta de ahorro).
  const categories = [...new Set(goals.map((g) => g.category))];
  const grouped = await prisma.transaction.groupBy({
    by: ["category", "type"],
    where: { userId, category: { in: categories } },
    _sum: { amount: true },
  });

  const netByCategory = new Map<string, number>();
  for (const g of grouped) {
    const amount = toNumber(g._sum.amount);
    const current = netByCategory.get(g.category) ?? 0;
    // Mismo criterio que computeSavingsProgress: income = aportado, expense = retirado.
    netByCategory.set(g.category, current + (g.type === "income" ? amount : -amount));
  }

  return goals.map((goal) => {
    const currentAmount = Math.max(0, netByCategory.get(goal.category) ?? 0);
    const targetAmount = toNumber(goal.targetAmount);
    return {
      ...goal,
      currentAmount,
      progressPercent: targetAmount > 0 ? Math.min(100, Math.round((currentAmount / targetAmount) * 100)) : 0,
    };
  });
}

export async function createSavingsGoal(userId: number, input: SavingsGoalInput) {
  const goal = await prisma.savingsGoal.create({
    data: {
      userId,
      name: input.name,
      type: input.type ?? "ahorro",
      targetAmount: input.targetAmount,
      category: input.category,
      stepAmount: input.stepAmount ?? 100,
      deadline: input.deadline ? new Date(input.deadline) : null,
    },
  });
  const currentAmount = await computeSavingsProgress(userId, goal.category);
  return { ...goal, currentAmount };
}

async function findOwnedSavingsGoal(userId: number, savingsGoalId: number) {
  const goal = await prisma.savingsGoal.findUnique({ where: { id: savingsGoalId } });
  if (!goal) throw new NotFoundError("Meta de ahorro no encontrada");
  if (goal.userId !== userId) throw new ForbiddenError("No autorizado");
  return goal;
}

export async function deleteSavingsGoal(userId: number, savingsGoalId: number) {
  await findOwnedSavingsGoal(userId, savingsGoalId);
  await prisma.savingsGoal.delete({ where: { id: savingsGoalId } });
}

/**
 * "Casilla" clicada en el dashboard: cada clic representa asignar (o retirar) un múltiplo de
 * `stepAmount` a la meta. No se guarda un contador aparte — se traduce en una transacción real
 * (income si `amount` es positivo: aportas a la meta; expense si es negativo: al deshacer una
 * casilla, retiras/corriges el aporte) etiquetada con la categoría de la meta, así el balance
 * mensual/anual y el progreso de la meta se mantienen consistentes con la misma fuente de
 * verdad (`Transaction`), sin un segundo lugar donde el dinero "vive".
 */
export async function contributeToSavingsGoal(userId: number, savingsGoalId: number, amount: number) {
  const goal = await findOwnedSavingsGoal(userId, savingsGoalId);

  await prisma.transaction.create({
    data: {
      userId,
      type: amount > 0 ? "income" : "expense",
      amount: Math.abs(amount),
      category: goal.category,
      description: `Aporte a meta de ahorro: ${goal.name}`,
    },
  });

  const currentAmount = await computeSavingsProgress(userId, goal.category);
  const targetAmount = toNumber(goal.targetAmount);
  return {
    ...goal,
    currentAmount,
    progressPercent: targetAmount > 0 ? Math.min(100, Math.round((currentAmount / targetAmount) * 100)) : 0,
  };
}

export async function getAnalytics(userId: number, month?: number, year?: number) {
  const now = new Date();
  const refMonth = month ?? now.getMonth() + 1;
  const refYear = year ?? now.getFullYear();
  const reference = new Date(refYear, refMonth - 1, 1);
  const currentMonthStart = startOfMonth(reference);
  const currentMonthEnd = endOfMonth(reference);
  const rangeStart = startOfMonth(subMonths(reference, 5));

  // Una sola consulta cubre tanto el top de categorías del mes como la tendencia de 6 meses
  // (en vez de 1 groupBy + 6 llamadas a getMonthlyBalance, cada una con 2 aggregate).
  const transactions = await prisma.transaction.findMany({
    where: { userId, date: { gte: rangeStart, lte: currentMonthEnd } },
    select: { type: true, category: true, amount: true, date: true },
  });

  const categoryTotals = new Map<string, number>();
  const monthBuckets = new Map<string, { month: number; year: number; income: number; expense: number }>();
  for (let i = 5; i >= 0; i -= 1) {
    const monthDate = subMonths(reference, i);
    monthBuckets.set(`${monthDate.getFullYear()}-${monthDate.getMonth()}`, {
      month: monthDate.getMonth() + 1,
      year: monthDate.getFullYear(),
      income: 0,
      expense: 0,
    });
  }

  for (const t of transactions) {
    const amount = toNumber(t.amount);
    const date = new Date(t.date);
    const bucket = monthBuckets.get(`${date.getFullYear()}-${date.getMonth()}`);
    if (bucket) {
      if (t.type === "income") bucket.income += amount;
      else bucket.expense += amount;
    }

    if (t.type === "expense" && date >= currentMonthStart && date <= currentMonthEnd) {
      categoryTotals.set(t.category, (categoryTotals.get(t.category) ?? 0) + amount);
    }
  }

  const topCategories = [...categoryTotals.entries()]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  const monthlyTrend = [...monthBuckets.values()].map((b) => ({ ...b, balance: b.income - b.expense }));

  const avgMonthlyBalance =
    monthlyTrend.reduce((sum, m) => sum + m.balance, 0) / (monthlyTrend.length || 1);

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
