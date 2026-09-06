// Cliente REST directo para los TABLEROS de Planificador (el modelo `Planner` del backend, no las
// tareas): a diferencia de las tareas (que sí pasan por SQLite/src/sync, ver db/tasksRepo.ts),
// la metadata del propio tablero (crear/renombrar/borrar/reordenar) no forma parte del contrato de
// sync offline — mismo criterio ya aplicado a "Horario" (ver src/api/schedule.ts, que es el mismo
// patrón "lista de X con nombre propio, CRUD + mover arriba/abajo" contra `/schedule`, aquí contra
// `/planner/boards`). Necesita conexión para crear/renombrar/borrar/reordenar tableros; las tareas
// de cada tablero siguen funcionando offline como hasta ahora.
import { api } from "./client";

export interface Planner {
  id: number;
  name: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export async function listPlanners(): Promise<Planner[]> {
  const res = await api.get<{ planners: Planner[] }>("/planner/boards");
  return res.planners;
}

export const createPlanner = (name: string) => api.post<Planner>("/planner/boards", { name });
export const renamePlanner = (id: number, name: string) => api.put<Planner>(`/planner/boards/${id}`, { name });
export const deletePlanner = (id: number) => api.delete<{ message: string }>(`/planner/boards/${id}`);
export const movePlanner = (id: number, direction: "up" | "down") =>
  api.put<Planner>(`/planner/boards/${id}/move`, { direction });
