import { prisma } from "../config/database";
import { ForbiddenError, NotFoundError } from "../utils/errorHandler";
import { recordTombstone } from "./tombstoneService";

// Cuántos días de historial devolvemos: la tira semanal y el gráfico de progreso del dashboard
// (mes en curso y mes anterior completos — el peor caso, a final de mes, son ~61 días atrás) y el
// tope de la racha.
const HISTORY_DAYS = 62;

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function utcMidnight(daysAgo = 0): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d;
}

export async function listHabits(userId: number) {
  const habits = await prisma.habit.findMany({
    where: { userId, active: true },
    orderBy: { createdAt: "asc" },
  });
  if (habits.length === 0) return { habits: [] };

  const since = utcMidnight(HISTORY_DAYS - 1);
  const logs = await prisma.habitLog.findMany({
    where: { userId, habitId: { in: habits.map((h) => h.id) }, date: { gte: since } },
    select: { habitId: true, date: true },
  });

  // Agrupado en memoria (una sola consulta) en vez de una consulta de racha por hábito.
  const datesByHabit = new Map<number, Set<string>>();
  for (const log of logs) {
    const set = datesByHabit.get(log.habitId) ?? new Set<string>();
    set.add(dateKey(log.date));
    datesByHabit.set(log.habitId, set);
  }

  return {
    habits: habits.map((habit) => {
      const dates = datesByHabit.get(habit.id) ?? new Set<string>();

      // Racha: días consecutivos (empezando hoy hacia atrás) marcados — mismo criterio que
      // streakDays en goalsService.getGoalAnalytics.
      let streak = 0;
      const cursor = utcMidnight();
      for (;;) {
        if (!dates.has(dateKey(cursor))) break;
        streak += 1;
        cursor.setUTCDate(cursor.getUTCDate() - 1);
      }

      return {
        id: habit.id,
        title: habit.title,
        streak,
        completedDates: Array.from(dates).sort(),
      };
    }),
  };
}

export async function createHabit(userId: number, title: string) {
  return prisma.habit.create({ data: { userId, title } });
}

async function findOwnedHabit(userId: number, habitId: number) {
  const habit = await prisma.habit.findUnique({ where: { id: habitId } });
  if (!habit) throw new NotFoundError("Hábito no encontrado");
  if (habit.userId !== userId) throw new ForbiddenError("No autorizado");
  return habit;
}

export async function updateHabit(userId: number, habitId: number, title: string) {
  await findOwnedHabit(userId, habitId);
  return prisma.habit.update({ where: { id: habitId }, data: { title } });
}

export async function deleteHabit(userId: number, habitId: number) {
  await findOwnedHabit(userId, habitId);
  // Solo se deja tombstone del hábito, no de cada HabitLog que cae en cascada — el sync del
  // móvil trata "hábito borrado" como "borra también sus registros locales", igual que hace la
  // propia BD con el cascade (ver syncService.ts).
  await prisma.$transaction([
    prisma.habit.delete({ where: { id: habitId } }),
    recordTombstone(prisma, userId, "habit", habitId),
  ]);
}

/**
 * Marca/desmarca un día concreto (hoy por defecto) para un hábito: si ya había registro para
 * ese día se borra (desmarcar), si no lo había se crea (marcar). Sin booleano por día — el
 * registro en sí es la marca, así el historial completo queda disponible sin filas vacías.
 */
export async function toggleHabitDay(userId: number, habitId: number, dateStr?: string) {
  await findOwnedHabit(userId, habitId);
  const date = dateStr ? new Date(dateStr) : utcMidnight();

  const existing = await prisma.habitLog.findUnique({
    where: { habitId_date: { habitId, date } },
  });

  if (existing) {
    await prisma.$transaction([
      prisma.habitLog.delete({ where: { id: existing.id } }),
      recordTombstone(prisma, userId, "habitLog", existing.id),
    ]);
    return { completed: false, date: dateKey(date) };
  }

  await prisma.habitLog.create({ data: { habitId, userId, date } });
  return { completed: true, date: dateKey(date) };
}
