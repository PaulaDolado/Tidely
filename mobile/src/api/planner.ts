// Cliente REST directo para los TABLEROS de Planificador (el modelo `Planner` del backend, no las
// tareas): a diferencia de las tareas (que sí pasan por SQLite/src/sync, ver db/tasksRepo.ts),
// la metadata del propio tablero (crear/renombrar/borrar/reordenar) no forma parte del contrato de
// sync offline — mismo criterio ya aplicado a "Horario" (ver src/api/schedule.ts, que es el mismo
// patrón "lista de X con nombre propio, CRUD + mover arriba/abajo" contra `/schedule`, aquí contra
// `/planner/boards`). Necesita conexión para crear/renombrar/borrar/reordenar tableros; las tareas
// de cada tablero siguen funcionando offline como hasta ahora.
//
// Las funciones de aquí abajo (PlannerField y los valores `customFields` de una tarea) son el
// mismo caso de bypass, pero por un motivo distinto: NO es que el propio concepto esté fuera del
// contrato de sync (como los tableros), es que `mobile/src/types.ts` excluye a propósito
// `customFields` de `ServerTask`/`LocalTask` (ver el comentario ahí) — esta app solo cachea/edita
// offline el subconjunto de una tarea que tiene sentido en SQLite, y las columnas personalizadas
// (creadas libremente por el usuario, con tipos arbitrarios) se quedaron fuera de ese subconjunto.
// Por eso estas funciones golpean `/planner/boards/:id/fields` y `/planner/tasks` directamente
// (igual estilo que api/calendarLegend.ts y api/customPages.ts) en vez de pasar por
// db/tasksRepo.ts o src/sync/: necesitan conexión, y sus datos no se cachean ni se muestran sin
// ella (ver PlanificadorScreen.tsx, sección "Propiedades personalizadas" del modal de tarea).
import { api } from "./client";
import { CustomFieldType, CustomFieldValue } from "./customPages";

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

// Columna personalizada de UN tablero (texto/número/fecha/selección) — mismo concepto que
// CustomFieldDef en api/customPages.ts, pero con id entero real de servidor (no un uuid de
// cliente): ver PlannerField en dashboard/src/types.ts. El tipo no se puede cambiar tras crearla
// (ver el comentario en plannerService.updateField del backend) — hay que borrarla y crear otra.
export interface PlannerField {
  id: number;
  plannerId: number;
  name: string;
  type: CustomFieldType;
  options: string[];
  order: number;
}

export async function listPlannerFields(plannerId: number): Promise<PlannerField[]> {
  const res = await api.get<{ fields: PlannerField[] }>(`/planner/boards/${plannerId}/fields`);
  return res.fields;
}

export const createPlannerField = (plannerId: number, name: string, type: CustomFieldType, options?: string[]) =>
  api.post<PlannerField>(`/planner/boards/${plannerId}/fields`, { name, type, options });

export const renamePlannerField = (plannerId: number, fieldId: number, name: string) =>
  api.put<PlannerField>(`/planner/boards/${plannerId}/fields/${fieldId}`, { name });

export const deletePlannerField = (plannerId: number, fieldId: number) =>
  api.delete<{ message: string }>(`/planner/boards/${plannerId}/fields/${fieldId}`);

export const movePlannerField = (plannerId: number, fieldId: number, direction: "up" | "down") =>
  api.put<PlannerField>(`/planner/boards/${plannerId}/fields/${fieldId}/move`, { direction });

// Solo lo que hace falta de una tarea "en vivo" contra el servidor: su `customFields` (lo único
// que la copia local en SQLite no tiene). La respuesta real de /planner/tasks trae la tarea
// completa; aquí solo se tipan los dos campos que se usan, el resto simplemente se ignora.
export interface PlannerLiveTask {
  id: number;
  customFields: Record<string, CustomFieldValue>;
}

export async function listPlannerTasksLive(plannerId: number): Promise<PlannerLiveTask[]> {
  const res = await api.get<{ tasks: PlannerLiveTask[] }>(`/planner/tasks?plannerId=${plannerId}`);
  return res.tasks;
}

// PATCH, no reemplazo entero — ver plannerService.updateTask en el backend: se combina con lo que
// ya hubiera en `customFields`, un `null` explícito borra solo esa clave.
export const updateTaskCustomFields = (taskId: number, customFields: Record<string, CustomFieldValue>) =>
  api.put<{ customFields: Record<string, CustomFieldValue> }>(`/planner/tasks/${taskId}`, { customFields });
