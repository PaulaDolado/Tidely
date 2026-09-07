// Cliente directo (sin pasar por SQLite/sync, mismo criterio que api/calendarLegend.ts y
// api/customPages.ts) para la "racha combinada" de HoyScreen.tsx: días CONSECUTIVOS en los que
// se cumplieron TODOS los hábitos activos Y todas las tareas con vencimiento ese día (ver
// streakService.computeCombinedStreak en el backend) — un cálculo histórico real que no se puede
// reconstruir solo con lo que hay hoy en la copia local (habits/tasksRepo solo saben "hoy", no el
// historial de días completados). Se pide siempre entero dentro de `GET /today` (no hay un
// endpoint más ligero solo para esto), y HoyScreen descarta el resto de la respuesta: esa parte ya
// la tiene servida (y editable offline) por su propia copia local.
import { api } from "./client";

export async function getCombinedStreak(): Promise<number> {
  const res = await api.get<{ combinedStreak: number }>("/today");
  return res.combinedStreak;
}
