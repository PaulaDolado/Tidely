// Alta / renombrado / borrado de hábitos por REST directo — mismo criterio que src/api/finance.ts:
// el sync offline del móvil solo sube las marcas diarias (HabitLog), no los hábitos en sí (ver
// habitsRepo.ts), así que estas tres acciones necesitan conexión, igual que en la web
// (dashboard/src/components/HabitsTrackerCard.tsx). Quien llame refleja el resultado en la caché
// local (upsertHabits/deleteHabit de habitsRepo) para que la tarjeta se refresque al instante.
import { api, ApiError } from "./client";
import { ServerHabit } from "../types";

export function createHabit(title: string): Promise<ServerHabit> {
  return api.post<ServerHabit>("/habits", { title });
}

export function renameHabit(id: number, title: string): Promise<ServerHabit> {
  return api.put<ServerHabit>(`/habits/${id}`, { title });
}

export async function removeHabit(id: number): Promise<void> {
  await api.delete(`/habits/${id}`);
}

/** Mensaje corto para el usuario cuando una de las llamadas de arriba falla: sin red (status 0,
 * ver ApiError en client.ts) se explica que hace falta conexión en vez de enseñar el error técnico. */
export function habitErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 0) {
    return "Sin conexión: crear, renombrar o borrar hábitos necesita internet.";
  }
  return error instanceof Error ? error.message : "No se pudo completar la acción.";
}
