import { prisma } from "../config/database";
import { todayInTimezone } from "../utils/dateHelpers";
import { getUserTimezone, getDay } from "./agendaService";
import { listHabits } from "./habitsService";
import { listNotes } from "./notesService";
import { listRecentEntries } from "./projectsService";
import { computeCombinedStreak } from "./streakService";

/**
 * Vista "Hoy": todo lo que toca hoy en un único viaje al backend, en vez de entrar a cada
 * sección por separado — eventos de hoy (Agenda), tareas con `dueDate` hoy (Planificador),
 * hábitos (Agenda), notas rápidas (Agenda) y últimas entradas de libreta tocadas (Proyectos),
 * más la racha combinada (ver streakService).
 */
export async function getToday(userId: number) {
  const timezone = await getUserTimezone(userId);
  const dateStr = todayInTimezone(timezone);

  // Las fechas de vencimiento de tareas se guardan como fecha de calendario pura (medianoche
  // UTC del día elegido en el selector, ver plannerService/PlanificadorPage) — comparar contra
  // el rango UTC de `dateStr` es exactamente lo mismo que hace el propio selector al mostrarlas.
  const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
  const dayEnd = new Date(`${dateStr}T23:59:59.999Z`);

  const [agendaDay, tasksDueToday, habitsResult, notesResult, recentProjectEntries, combinedStreak] = await Promise.all([
    // `timezone` ya se pidió dos líneas arriba (hacía falta para calcular `dateStr`) — se le pasa
    // aquí para que getDay no vuelva a consultarla (antes eran 2 SELECT idénticos por cada carga
    // de "Hoy").
    getDay(userId, dateStr, {}, timezone),
    prisma.task.findMany({
      where: { userId, dueDate: { gte: dayStart, lte: dayEnd } },
      include: { subtasks: { orderBy: { createdAt: "asc" } } },
      orderBy: { order: "asc" },
    }),
    listHabits(userId),
    listNotes(userId),
    listRecentEntries(userId),
    computeCombinedStreak(userId),
  ]);

  return {
    date: dateStr,
    timezone,
    events: agendaDay.events,
    tasksDueToday,
    habits: habitsResult.habits,
    notes: notesResult.notes,
    recentProjectEntries,
    combinedStreak: combinedStreak.streak,
  };
}
