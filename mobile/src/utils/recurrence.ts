// Puerto directo de la lógica de recurrencia del backend (src/utils/recurrence.ts) — misma
// función, mismo límite de seguridad, para poder expandir un evento recurrente cacheado en
// SQLite dentro del rango visible de `AgendaScreen` sin depender de un roundtrip al servidor
// (el pull solo trae la fila "plantilla", nunca ocurrencias ya expandidas — ver
// `src/services/syncService.ts` en el backend, que hace exactamente lo mismo por la misma razón).
//
// Simplificación deliberada frente al backend: no se usa `date-fns-tz`/timezone del usuario para
// las fronteras de rango (eso lo decide quien llama, igual que ya hace `todayKey()` en
// `eventsRepo.ts` con `toISOString().slice(0,10)` en UTC) — evita añadir una dependencia nueva
// solo para esto.

export interface RecurringEventLike {
  id: string;
  isRecurring: boolean;
  recurringPattern: string | null;
  startTime: Date;
  endTime: Date;
  // Solo con recurringPattern = "weekday_range" — ver el mismo comentario en el backend
  // (src/utils/recurrence.ts) y en types.ts.
  recurringWeekdayStart?: number | null;
  recurringWeekdayEnd?: number | null;
}

export interface EventExceptionLike {
  originalStartTime: Date;
  status: string; // "moved" | "cancelled"
  newStartTime?: Date | null;
  newEndTime?: Date | null;
}

export interface EventOccurrence<T> {
  event: T;
  startTime: Date;
  endTime: Date;
  isRecurringInstance: boolean;
  seriesId: string;
  originalStartTime?: Date;
  isException?: boolean;
  exceptionStatus?: "moved";
}

// Calibrado para la cadencia más fina ("daily"): ~10 años a razón de una ocurrencia por día —
// ver el comentario equivalente en el backend para el porqué de este número.
const MAX_OCCURRENCES = 3660;

/** Suma `n` meses en UTC preservando el día del mes salvo que no exista en el mes destino, en
 * cuyo caso se recorta al último día de ese mes (igual que `date-fns.addMonths`, a diferencia de
 * `Date.setUTCMonth`, que en vez de recortar se "desborda" al mes siguiente — p.ej. 31 enero +
 * 1 mes con `setUTCMonth` da 3 marzo, no 28 febrero). */
function addMonthsUTC(date: Date, n: number): Date {
  const day = date.getUTCDate();
  const firstOfTargetMonth = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + n, 1, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds())
  );
  const daysInTargetMonth = new Date(Date.UTC(firstOfTargetMonth.getUTCFullYear(), firstOfTargetMonth.getUTCMonth() + 1, 0)).getUTCDate();
  firstOfTargetMonth.setUTCDate(Math.min(day, daysInTargetMonth));
  return firstOfTargetMonth;
}

/**
 * Calcula la ocurrencia número `n` (0 = la original) SIEMPRE a partir de `originalStart`, nunca
 * encadenando desde la ocurrencia anterior — evita que un evento anclado el día 31 quede
 * "clampado" a 28 en febrero y ya nunca vuelva a 31 en marzo. Ver backend `occurrenceAt`.
 */
function occurrenceAt(originalStart: Date, pattern: string, n: number): Date {
  switch (pattern) {
    case "daily":
    case "weekday_range":
      return new Date(originalStart.getTime() + n * 86_400_000);
    case "weekly":
      return new Date(originalStart.getTime() + n * 7 * 86_400_000);
    case "biweekly":
      return new Date(originalStart.getTime() + n * 14 * 86_400_000);
    case "monthly":
      return addMonthsUTC(originalStart, n);
    default:
      return new Date(originalStart.getTime() + n * 7 * 86_400_000);
  }
}

/** 1=lunes .. 7=domingo (ISO) — `Date.getUTCDay()` da 0=domingo..6=sábado, hay que rotarlo. */
function isoWeekday(date: Date): number {
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

/** ¿Cae `date` dentro de [start, end] (ambos inclusive, convención ISO)? Si `start > end` el rango
 * da la vuelta a la semana (p.ej. 5 a 1 = viernes, sábado, domingo, lunes). Puerto directo del
 * backend, ver ese fichero para el porqué. */
function matchesWeekdayRange(date: Date, start: number, end: number): boolean {
  const weekday = isoWeekday(date);
  if (start <= end) return weekday >= start && weekday <= end;
  return weekday >= start || weekday <= end;
}

/** Si el patrón es "weekday_range", ¿es `naturalStart` uno de los días que le tocan? Para el resto
 * de patrones siempre es true — cada `naturalStart` que calcula `occurrenceAt` ya es, por
 * definición, un día válido de esa cadencia. */
function matchesRecurrencePattern<T extends RecurringEventLike>(event: T, naturalStart: Date): boolean {
  if (event.recurringPattern !== "weekday_range") return true;
  return matchesWeekdayRange(naturalStart, event.recurringWeekdayStart ?? 1, event.recurringWeekdayEnd ?? 5);
}

function findException(exceptions: EventExceptionLike[], naturalStart: Date): EventExceptionLike | undefined {
  return exceptions.find((ex) => ex.originalStartTime.getTime() === naturalStart.getTime());
}

/**
 * Expande un evento recurrente (la fila "plantilla" cacheada) en sus ocurrencias virtuales
 * dentro de [rangeStart, rangeEnd]. Si el evento no es recurrente, retorna [] — el llamador debe
 * incluir el evento tal cual por separado. Misma semántica que el backend, ver ese fichero para
 * el porqué de cada detalle (excepciones "moved"/"cancelled", recorte por rango, etc.).
 */
export function expandRecurringEvent<T extends RecurringEventLike>(
  event: T,
  rangeStart: Date,
  rangeEnd: Date,
  exceptions: EventExceptionLike[] = []
): EventOccurrence<T>[] {
  if (!event.isRecurring || !event.recurringPattern) return [];

  const durationMs = event.endTime.getTime() - event.startTime.getTime();
  const occurrences: EventOccurrence<T>[] = [];

  let n = 0;
  let cursorStart = event.startTime;

  while (cursorStart.getTime() <= rangeEnd.getTime() && n < MAX_OCCURRENCES) {
    const naturalStart = cursorStart;

    if (matchesRecurrencePattern(event, naturalStart)) {
      const exception = findException(exceptions, naturalStart);

      if (!exception || exception.status !== "cancelled") {
        const moved = exception?.status === "moved";
        const effectiveStart = moved && exception?.newStartTime ? exception.newStartTime : naturalStart;
        const effectiveEnd = moved && exception?.newEndTime ? exception.newEndTime : new Date(naturalStart.getTime() + durationMs);

        if (effectiveStart.getTime() >= rangeStart.getTime() && effectiveEnd.getTime() <= rangeEnd.getTime()) {
          occurrences.push({
            event,
            startTime: effectiveStart,
            endTime: effectiveEnd,
            isRecurringInstance: true,
            seriesId: event.id,
            originalStartTime: naturalStart,
            ...(exception ? { isException: true, exceptionStatus: "moved" as const } : {}),
          });
        }
      }
    }

    n += 1;
    cursorStart = occurrenceAt(event.startTime, event.recurringPattern, n);
  }

  return occurrences;
}
