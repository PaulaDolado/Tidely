import { prisma } from "../config/database";
import { endOfWeek, endOfMonth, endOfYear, differenceInCalendarDays } from "date-fns";
import { buildPagination } from "../utils/pagination";
import { ForbiddenError, NotFoundError } from "../utils/errorHandler";

export type GoalPeriod = "weekly" | "monthly" | "annual";

interface CreateGoalInput {
  title: string;
  description?: string | null;
  period: GoalPeriod;
  targetValue: number;
  bonusPoints?: number;
  periodStart?: string | Date;
  periodEnd?: string | Date;
  autoRenew?: boolean;
}

/** Exportado: lo reutiliza `goalExpiryService` para calcular el periodo siguiente al renovar. */
export function defaultPeriodEnd(period: GoalPeriod, start: Date): Date {
  if (period === "weekly") return endOfWeek(start, { weekStartsOn: 1 });
  if (period === "monthly") return endOfMonth(start);
  return endOfYear(start);
}

export async function createGoal(userId: number, input: CreateGoalInput) {
  const periodStart = input.periodStart ? new Date(input.periodStart) : new Date();
  const periodEnd = input.periodEnd ? new Date(input.periodEnd) : defaultPeriodEnd(input.period, periodStart);

  return prisma.goal.create({
    data: {
      userId,
      title: input.title,
      description: input.description ?? null,
      period: input.period,
      targetValue: input.targetValue,
      bonusPoints: input.bonusPoints ?? 10,
      autoRenew: input.autoRenew ?? true,
      periodStart,
      periodEnd,
    },
  });
}

export async function listGoals(
  userId: number,
  status: "active" | "completed" | "expired" | "all" = "active",
  page = 1,
  limit = 20
) {
  const where: { userId: number; completed?: boolean; expired?: boolean } = { userId };
  // "active": ni completada ni expirada (una meta expirada no cumplida deja de contar como "activa").
  if (status === "active") {
    where.completed = false;
    where.expired = false;
  }
  if (status === "completed") where.completed = true;
  if (status === "expired") where.expired = true;

  const [goals, total] = await Promise.all([
    prisma.goal.findMany({
      where,
      orderBy: { periodEnd: "asc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.goal.count({ where }),
  ]);

  return { goals, pagination: buildPagination(page, limit, total) };
}

async function findOwnedGoal(userId: number, goalId: number) {
  const goal = await prisma.goal.findUnique({ where: { id: goalId } });
  if (!goal) throw new NotFoundError("Meta no encontrada");
  if (goal.userId !== userId) throw new ForbiddenError("No autorizado");
  return goal;
}

export async function getGoalDetail(userId: number, goalId: number) {
  const goal = await findOwnedGoal(userId, goalId);
  const progress = await prisma.goalProgress.findMany({
    where: { goalId },
    orderBy: { date: "desc" },
  });
  return { ...goal, progress };
}

export async function updateGoal(
  userId: number,
  goalId: number,
  input: Partial<Omit<CreateGoalInput, "period">>
) {
  await findOwnedGoal(userId, goalId);

  return prisma.goal.update({
    where: { id: goalId },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.targetValue !== undefined ? { targetValue: input.targetValue } : {}),
      ...(input.bonusPoints !== undefined ? { bonusPoints: input.bonusPoints } : {}),
      ...(input.periodStart !== undefined ? { periodStart: new Date(input.periodStart) } : {}),
      ...(input.periodEnd !== undefined ? { periodEnd: new Date(input.periodEnd) } : {}),
      ...(input.autoRenew !== undefined ? { autoRenew: input.autoRenew } : {}),
    },
  });
}

export async function deleteGoal(userId: number, goalId: number) {
  await findOwnedGoal(userId, goalId);
  await prisma.goal.delete({ where: { id: goalId } });
}

interface RegisterProgressInput {
  value: number;
  note?: string | null;
  date?: string | Date;
}

export async function registerProgress(userId: number, goalId: number, input: RegisterProgressInput) {
  const goal = await findOwnedGoal(userId, goalId);

  const progress = await prisma.goalProgress.create({
    data: {
      goalId,
      userId,
      value: input.value,
      note: input.note ?? null,
      ...(input.date ? { date: new Date(input.date) } : {}),
    },
  });

  const newCurrentValue = goal.currentValue + input.value;
  const completed = goal.completed || newCurrentValue >= goal.targetValue;

  const updatedGoal = await prisma.goal.update({
    where: { id: goalId },
    data: { currentValue: newCurrentValue, completed },
  });

  return {
    progress,
    goal: updatedGoal,
    justCompleted: completed && !goal.completed,
    bonusPointsAwarded: completed && !goal.completed ? updatedGoal.bonusPoints : 0,
  };
}

export interface GoalRiskInput {
  targetValue: number;
  currentValue: number;
  completed: boolean;
  periodStart: Date;
  periodEnd: Date;
}

export interface GoalRiskInfo {
  daysTotal: number;
  daysElapsed: number;
  daysRemaining: number;
  requiredPacePerDay: number;
  currentPacePerDay: number;
  atRisk: boolean;
}

/**
 * Lógica pura de "¿esta meta está en riesgo de no cumplirse?", extraída para poder
 * reutilizarla tanto en `GET /goals/:id/analytics` (bajo demanda) como en el scheduler
 * de notificaciones (`notificationService.createGoalRiskAlerts`, corre periódicamente
 * sin que nadie tenga que pedirlo). Sin dependencias de Prisma: solo necesita los campos
 * del Goal, nada de progressEntries.
 */
export function computeGoalRisk(goal: GoalRiskInput, now: Date = new Date()): GoalRiskInfo {
  const daysTotal = Math.max(1, differenceInCalendarDays(goal.periodEnd, goal.periodStart));
  const daysElapsed = Math.min(daysTotal, Math.max(0, differenceInCalendarDays(now, goal.periodStart)));
  const daysRemaining = Math.max(0, differenceInCalendarDays(goal.periodEnd, now));

  const remainingValue = Math.max(0, goal.targetValue - goal.currentValue);
  const requiredPacePerDay = daysRemaining > 0 ? remainingValue / daysRemaining : remainingValue;

  // En riesgo: aún no completada, y al ritmo actual (currentValue / díasTranscurridos) no llegaría a la meta.
  const currentPacePerDay = daysElapsed > 0 ? goal.currentValue / daysElapsed : 0;
  const atRisk = !goal.completed && daysRemaining > 0 && currentPacePerDay < requiredPacePerDay * 0.8;

  return { daysTotal, daysElapsed, daysRemaining, requiredPacePerDay, currentPacePerDay, atRisk };
}

export async function getGoalAnalytics(userId: number, goalId: number) {
  const goal = await findOwnedGoal(userId, goalId);
  const progressEntries = await prisma.goalProgress.findMany({
    where: { goalId },
    orderBy: { date: "desc" },
  });

  const percentComplete = goal.targetValue > 0 ? Math.min(100, Math.round((goal.currentValue / goal.targetValue) * 100)) : 0;

  // Racha: días consecutivos (empezando hoy hacia atrás) con al menos un registro de progreso.
  const daysWithProgress = new Set(
    progressEntries.map((p) => new Date(p.date).toISOString().slice(0, 10))
  );
  let streakDays = 0;
  const cursor = new Date();
  for (;;) {
    const key = cursor.toISOString().slice(0, 10);
    if (!daysWithProgress.has(key)) break;
    streakDays += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  const risk = computeGoalRisk(goal);

  return {
    goalId: goal.id,
    targetValue: goal.targetValue,
    currentValue: goal.currentValue,
    percentComplete,
    completed: goal.completed,
    streakDays,
    periodStart: goal.periodStart,
    periodEnd: goal.periodEnd,
    daysTotal: risk.daysTotal,
    daysElapsed: risk.daysElapsed,
    daysRemaining: risk.daysRemaining,
    requiredPacePerDay: Math.round(risk.requiredPacePerDay * 100) / 100,
    atRisk: risk.atRisk,
  };
}
