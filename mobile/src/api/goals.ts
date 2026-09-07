// Cliente REST directo para "Objetivos" — mismo criterio que src/api/schedule.ts: Goal/
// GoalProgress no forman parte del contrato de sync offline del backend (API.md los lista
// explícitamente entre lo que "no sincroniza (solo web, por ahora)"), así que esta pantalla no
// pasa por SQLite y necesita conexión, igual que `dashboard/src/pages/MetasPage.tsx`. Deja fuera
// deliberadamente "Metas de ahorro" (SavingsGoal): es una entidad distinta ligada a Finanzas
// (dashboard/src/pages/MetasAhorroPage.tsx), no lo que el usuario pidió como "Objetivos".
import { api } from "./client";

export type GoalPeriod = "weekly" | "monthly" | "annual";
export type GoalStatus = "active" | "completed" | "expired" | "all";

export interface Goal {
  id: number;
  title: string;
  description: string | null;
  period: GoalPeriod;
  targetValue: number;
  currentValue: number;
  completed: boolean;
  bonusPoints: number;
  periodStart: string;
  periodEnd: string;
  expired: boolean;
  autoRenew: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NewGoalInput {
  title: string;
  description?: string | null;
  period: GoalPeriod;
  targetValue: number;
  autoRenew: boolean;
}

export interface AddProgressResult {
  goal: Goal;
  justCompleted: boolean;
  bonusPointsAwarded: number;
}

export async function listGoals(status: GoalStatus = "active"): Promise<Goal[]> {
  const res = await api.get<{ goals: Goal[] }>(`/goals?status=${status}`);
  return res.goals;
}

export const createGoal = (input: NewGoalInput) => api.post<Goal>("/goals", input);
export const deleteGoal = (id: number) => api.delete<{ message: string }>(`/goals/${id}`);
export const addProgress = (id: number, value: number) => api.post<AddProgressResult>(`/goals/${id}/progress`, { value });
