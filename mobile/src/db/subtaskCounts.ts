import { getDb } from "./index";

export interface SubtaskProgress {
  done: number;
  total: number;
}

/** Subtareas hechas/totales de varias tareas en UNA consulta (para la pantalla "Hoy", que pinta
 * "☑ hechas/total" junto a cada tarea, como HoyPage de la web) en vez de una `listForTask` por
 * tarea. Las subtareas pendientes de borrado local no cuentan, igual que en `listForTask`. Las
 * tareas sin subtareas simplemente no aparecen en el mapa. */
export async function getSubtaskProgress(taskIds: string[]): Promise<Record<string, SubtaskProgress>> {
  if (taskIds.length === 0) return {};
  const db = await getDb();
  const placeholders = taskIds.map(() => "?").join(", ");
  const rows = await db.getAllAsync<{ taskId: string; total: number; done: number | null }>(
    `SELECT taskId, COUNT(*) AS total, SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) AS done
     FROM subtasks
     WHERE taskId IN (${placeholders}) AND (pendingOp IS NULL OR pendingOp != 'delete')
     GROUP BY taskId`,
    taskIds
  );
  const result: Record<string, SubtaskProgress> = {};
  for (const row of rows) result[row.taskId] = { done: row.done ?? 0, total: row.total };
  return result;
}
