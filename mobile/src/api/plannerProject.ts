// Vínculo tarea ↔ proyecto del Planificador. El backend ya acepta `projectId` en
// PUT /planner/tasks/:id, pero el contrato de /sync NO lo transporta al subir cambios, así que
// aquí se guarda por REST directo (necesita conexión y una tarea ya sincronizada, con id de
// servidor numérico) — mismo criterio que `updateTaskCustomFields` en api/planner.ts. La lectura
// sí es local: `projectId` ya baja en el pull y vive en la columna `tasks.projectId`.
import { api } from "./client";

export const setTaskProject = (taskId: number, projectId: number | null) =>
  api.put<{ id: number; projectId: number | null }>(`/planner/tasks/${taskId}`, { projectId });
