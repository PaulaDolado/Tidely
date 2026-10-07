import { startOfMonth, endOfMonth } from "date-fns";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../utils/errorHandler";
import { getMonthlyBalance } from "./financeService";

// Categorías de presupuesto con las que arranca una cuenta nueva (ver authService.register) — el
// usuario puede renombrarlas, cambiarles el color o el %, o borrarlas igual que cualquier otra. Las
// cuentas que ya existían las recibieron en la migración add_budget_categories (mismos valores).
// Suman 65%: el resto de los ingresos queda "sin asignar" (ahorro, imprevistos...). "Otro" hace de
// cajón de sastre: ahí caen los gastos cuya categoría no coincide con ninguna otra (ver
// getBudgetSummary).
export const DEFAULT_BUDGET_CATEGORIES: { name: string; color: string; percent: number }[] = [
  { name: "Casa", color: "habit", percent: 30 },
  { name: "Comida", color: "hobby", percent: 10 },
  { name: "Transporte", color: "warning", percent: 5 },
  { name: "Compras", color: "negative", percent: 10 },
  { name: "Entretenimiento", color: "primary", percent: 5 },
  { name: "Otro", color: "muted", percent: 5 },
];

const CATCH_ALL_NAME = "otro";

function toNumber(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

// La categoría de un movimiento es texto libre ("casa", "Casa ", "CASA"): se compara sin distinguir
// mayúsculas ni espacios de los extremos, para que escribirla a mano también cuente.
function normalize(name: string): string {
  return name.trim().toLowerCase();
}

function serialize(category: { id: number; name: string; color: string; percent: Prisma.Decimal; order: number }) {
  return { id: category.id, name: category.name, color: category.color, percent: toNumber(category.percent), order: category.order };
}

export async function seedDefaultBudgetCategories(userId: number) {
  await prisma.budgetCategory.createMany({
    data: DEFAULT_BUDGET_CATEGORIES.map((c, i) => ({ userId, name: c.name, color: c.color, percent: c.percent, order: i })),
  });
}

export async function listBudgetCategories(userId: number) {
  const categories = await prisma.budgetCategory.findMany({ where: { userId }, orderBy: { order: "asc" } });
  return { categories: categories.map(serialize) };
}

async function findOwnedCategory(userId: number, categoryId: number) {
  const category = await prisma.budgetCategory.findUnique({ where: { id: categoryId } });
  if (!category) throw new NotFoundError("Categoría de presupuesto no encontrada");
  if (category.userId !== userId) throw new ForbiddenError("No autorizado");
  return category;
}

// Dos categorías con el mismo nombre harían ambiguo a cuál pertenece un movimiento (se enlazan por
// nombre), así que se rechaza el duplicado.
async function assertNameAvailable(userId: number, name: string, exceptId?: number) {
  const all = await prisma.budgetCategory.findMany({ where: { userId }, select: { id: true, name: true } });
  const clash = all.find((c) => c.id !== exceptId && normalize(c.name) === normalize(name));
  if (clash) throw new ConflictError(`Ya tienes una categoría llamada "${clash.name}"`);
}

// El % de cada categoría es sobre el 100% de los ingresos del mes — todas juntas no pueden pasarse.
async function assertTotalPercentWithinLimit(userId: number, newPercent: number, exceptId?: number) {
  const others = await prisma.budgetCategory.findMany({
    where: { userId, ...(exceptId !== undefined ? { id: { not: exceptId } } : {}) },
    select: { percent: true },
  });
  const total = others.reduce((sum, c) => sum + toNumber(c.percent), 0) + newPercent;
  // Margen de 0,005 para que sumas con decimales (33,33 + 33,33 + 33,34) no fallen por redondeo.
  if (total > 100.005) {
    const available = Math.max(0, 100 - others.reduce((sum, c) => sum + toNumber(c.percent), 0));
    throw new ValidationError(
      `Los porcentajes no pueden sumar más del 100% de los ingresos. Te quedan ${Number(available.toFixed(2))}% por asignar.`
    );
  }
}

export async function createBudgetCategory(userId: number, input: { name: string; color: string; percent: number }) {
  const name = input.name.trim();
  await assertNameAvailable(userId, name);
  await assertTotalPercentWithinLimit(userId, input.percent);
  const last = await prisma.budgetCategory.findFirst({ where: { userId }, orderBy: { order: "desc" } });
  const created = await prisma.budgetCategory.create({
    data: { userId, name, color: input.color, percent: input.percent, order: (last?.order ?? -1) + 1 },
  });
  return serialize(created);
}

export async function updateBudgetCategory(
  userId: number,
  categoryId: number,
  input: { name?: string; color?: string; percent?: number; order?: number }
) {
  const existing = await findOwnedCategory(userId, categoryId);
  const name = input.name !== undefined ? input.name.trim() : undefined;
  if (name !== undefined) await assertNameAvailable(userId, name, categoryId);
  if (input.percent !== undefined) await assertTotalPercentWithinLimit(userId, input.percent, categoryId);

  const renamed = name !== undefined && name !== existing.name;

  // Renombrar también reetiqueta los movimientos ya registrados con el nombre anterior: el vínculo
  // entre un movimiento y su categoría ES el nombre, así que sin esto un cambio de nombre dejaría
  // todo el historial "huérfano" (cayendo en Otro). Todo en una transacción de BD.
  const [updated] = await prisma.$transaction([
    prisma.budgetCategory.update({
      where: { id: categoryId },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.percent !== undefined ? { percent: input.percent } : {}),
        ...(input.order !== undefined ? { order: input.order } : {}),
      },
    }),
    ...(renamed ? [prisma.transaction.updateMany({ where: { userId, category: existing.name }, data: { category: name } })] : []),
  ]);
  return serialize(updated);
}

// Borrar una categoría NO borra los movimientos que la usaban — se quedan con ese nombre de texto
// y, al no coincidir con ninguna categoría, pasan a contarse en "Otro" (ver getBudgetSummary).
export async function deleteBudgetCategory(userId: number, categoryId: number) {
  await findOwnedCategory(userId, categoryId);
  await prisma.budgetCategory.delete({ where: { id: categoryId } });
}

/**
 * Resumen del presupuesto de un mes: para cada categoría, cuánto se ha gastado y cuánto le tocaba
 * (su % de los INGRESOS del mes). Los ingresos y los gastos totales salen de getMonthlyBalance, el
 * mismo cálculo que "Resumen del mes" — así ambas tarjetas siempre cuadran (lo aportado a metas de
 * ahorro no cuenta como gasto ni como ingreso, ver sumByType en financeService).
 *
 * Los gastos cuya categoría no coincide con ninguna se suman a "Otro" (si el usuario conserva esa
 * categoría) o, si no, se devuelven aparte en `uncategorizedSpent`.
 */
export async function getBudgetSummary(userId: number, month: number, year: number) {
  const reference = new Date(year, month - 1, 1);
  const start = startOfMonth(reference);
  const end = endOfMonth(reference);

  const [categories, balance, goals, grouped] = await Promise.all([
    prisma.budgetCategory.findMany({ where: { userId }, orderBy: { order: "asc" } }),
    getMonthlyBalance(userId, month, year),
    prisma.savingsGoal.findMany({ where: { userId }, select: { category: true } }),
    prisma.transaction.groupBy({
      by: ["category"],
      where: { userId, type: "expense", date: { gte: start, lte: end } },
      _sum: { amount: true },
    }),
  ]);

  // Lo aportado a metas de ahorro se registra como gasto pero no es un gasto "real" (ver
  // getGoalCategories en financeService): se deja fuera para que cuadre con balance.expense.
  const goalCategories = new Set(goals.map((g) => normalize(g.category)));
  const spentByName = new Map<string, number>();
  for (const row of grouped) {
    const key = normalize(row.category);
    if (goalCategories.has(key)) continue;
    spentByName.set(key, (spentByName.get(key) ?? 0) + toNumber(row._sum.amount));
  }

  const catchAll = categories.find((c) => normalize(c.name) === CATCH_ALL_NAME);
  const knownNames = new Set(categories.map((c) => normalize(c.name)));
  let unmatchedSpent = 0;
  for (const [name, amount] of spentByName) {
    if (!knownNames.has(name)) unmatchedSpent += amount;
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  const items = categories.map((c) => {
    const percent = toNumber(c.percent);
    const own = spentByName.get(normalize(c.name)) ?? 0;
    const spent = c.id === catchAll?.id ? own + unmatchedSpent : own;
    return { ...serialize(c), budget: round((balance.income * percent) / 100), spent: round(spent) };
  });

  const assignedPercent = categories.reduce((sum, c) => sum + toNumber(c.percent), 0);
  return {
    month,
    year,
    income: round(balance.income),
    totalSpent: round(balance.expense),
    assignedPercent: round(assignedPercent),
    unassignedPercent: round(Math.max(0, 100 - assignedPercent)),
    categories: items,
    // Solo distinto de 0 si el usuario ya no tiene una categoría "Otro" que absorba lo suelto.
    uncategorizedSpent: catchAll ? 0 : round(unmatchedSpent),
  };
}
