import { prisma } from "../config/database";
import { parseDateParam, dayRange, weekRange, monthRange, yearRange, zonedDateKey, dayWorkWindow } from "../utils/dateHelpers";
import { expandRecurringEvent, EventExceptionLike } from "../utils/recurrence";
import { buildIcs, parseIcs } from "../utils/ics";
import { buildPagination } from "../utils/pagination";
import { safeTimezone } from "../utils/timezone";
import { ForbiddenError, NotFoundError, ValidationError } from "../utils/errorHandler";
import { logger } from "../utils/logger";
import { recordTombstone } from "./tombstoneService";

/**
 * El "día de hoy" o "esta semana" depende de la zona horaria del usuario, no de dónde esté
 * desplegado el servidor — sin esto, un servidor en UTC calcularía los límites del día/semana
 * desalineados con la hora real del usuario (p.ej. Europe/Madrid en verano va 2h por delante).
 * Exportada: la reutilizan todayService (para el "hoy" del usuario) y el import de ICS (para
 * interpretar fechas sin TZID como hora local del usuario).
 */
export async function getUserTimezone(userId: number): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } });
  return safeTimezone(user?.timezone);
}

interface EventFilters {
  type?: string;
  page?: number;
  limit?: number;
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;

/**
 * Eventos dentro de [start, end]: los no recurrentes se consultan directo, y los
 * recurrentes se expanden en memoria a partir de la fila "plantilla" (ver utils/recurrence.ts),
 * aplicando las excepciones (mover/cancelar una ocurrencia suelta) que tenga cada plantilla.
 * No hay límite natural de fila-por-fila en BD para los recurrentes porque no se
 * materializan — por eso la paginación se aplica en memoria, después de mezclar y ordenar
 * ambos conjuntos.
 */
async function findEventsInRange(userId: number, start: Date, end: Date, filters: EventFilters) {
  const typeFilter = filters.type ? { type: filters.type } : {};

  const [nonRecurring, recurringTemplates] = await Promise.all([
    prisma.event.findMany({
      where: { userId, isRecurring: false, startTime: { gte: start }, endTime: { lte: end }, ...typeFilter },
    }),
    prisma.event.findMany({
      where: { userId, isRecurring: true, startTime: { lte: end }, ...typeFilter },
    }),
  ]);

  const exceptionsByEventId = new Map<number, EventExceptionLike[]>();
  if (recurringTemplates.length > 0) {
    const exceptions = await prisma.eventException.findMany({
      where: { eventId: { in: recurringTemplates.map((t) => t.id) } },
    });
    for (const ex of exceptions) {
      const list = exceptionsByEventId.get(ex.eventId) ?? [];
      list.push(ex);
      exceptionsByEventId.set(ex.eventId, list);
    }
  }

  const virtualOccurrences = recurringTemplates.flatMap((template) =>
    expandRecurringEvent(template, start, end, exceptionsByEventId.get(template.id) ?? []).map((occurrence) => ({
      ...template,
      startTime: occurrence.startTime,
      endTime: occurrence.endTime,
      isRecurringInstance: true,
      originalStartTime: occurrence.originalStartTime,
      isException: occurrence.isException ?? false,
    }))
  );

  const allEvents = [
    ...nonRecurring.map((e) => ({ ...e, isRecurringInstance: false as const })),
    ...virtualOccurrences,
  ];
  allEvents.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  const page = filters.page ?? DEFAULT_PAGE;
  const limit = filters.limit ?? DEFAULT_LIMIT;
  const startIndex = (page - 1) * limit;
  const events = allEvents.slice(startIndex, startIndex + limit);

  return { events, pagination: buildPagination(page, limit, allEvents.length) };
}

// `knownTimezone`: para cuando quien llama ya la pidió un momento antes (ver getToday en
// todayService.ts, que necesita la timezone del usuario para calcular qué día es "hoy" ANTES de
// poder llamar a getDay) — evita una segunda consulta idéntica a la base de datos. El resto de
// llamadas (rutas normales de Agenda) no la pasan y se comportan exactamente igual que antes.
export async function getDay(userId: number, dateStr: string, filters: EventFilters = {}, knownTimezone?: string) {
  parseDateParam(dateStr);
  const timezone = knownTimezone ?? (await getUserTimezone(userId));
  const { start, end } = dayRange(dateStr, timezone);
  const { events, pagination } = await findEventsInRange(userId, start, end, filters);
  return { date: dateStr, timezone, events, pagination };
}

export async function getWeek(userId: number, dateStr: string, filters: EventFilters = {}) {
  parseDateParam(dateStr);
  const timezone = await getUserTimezone(userId);
  const { start, end } = weekRange(dateStr, timezone);
  const { events, pagination } = await findEventsInRange(userId, start, end, filters);
  return { week: dateStr, weekStart: start, weekEnd: end, timezone, events, pagination };
}

export async function getMonth(userId: number, dateStr: string, filters: EventFilters = {}) {
  parseDateParam(dateStr);
  const timezone = await getUserTimezone(userId);
  const { start, end } = monthRange(dateStr, timezone);
  // Un mes puede tener bastantes más eventos que una semana — sin límite explícito se hereda
  // el DEFAULT_LIMIT (50), insuficiente para un mes con varios eventos recurrentes activos.
  const { events, pagination } = await findEventsInRange(userId, start, end, { ...filters, limit: filters.limit ?? 200 });
  return { month: dateStr, monthStart: start, monthEnd: end, timezone, events, pagination };
}

/**
 * Vista anual: no hace falta el evento completo por ocurrencia, solo cuántos hay cada día, para
 * pintar el puntito en la cuadrícula de 12 mini-meses (ver YearGrid en el dashboard) — de ahí que
 * no reutilice `findEventsInRange` con paginación normal, sino con un límite alto y una sola
 * pasada de agregación en memoria. Un año con recurrencias diarias/semanales expandidas puede
 * acumular varios cientos de ocurrencias; siguen siendo mucho más ligeras de mover que si
 * devolviéramos el objeto Event completo de cada una solo para contar.
 */
export async function getYear(userId: number, dateStr: string) {
  parseDateParam(dateStr);
  const timezone = await getUserTimezone(userId);
  const { start, end } = yearRange(dateStr, timezone);
  const { events } = await findEventsInRange(userId, start, end, { limit: 5000 });

  const counts: Record<string, number> = {};
  for (const event of events) {
    const key = zonedDateKey(event.startTime, timezone);
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return { year: dateStr.slice(0, 4), timezone, counts };
}

/**
 * Igual que `getYear`, pero con el evento completo de cada ocurrencia en vez de un recuento —
 * la usa `getAgendaExport` (exportar el año a .ics/PDF), que sí necesita título/hora/lugar de
 * cada evento. No la usa la vista anual normal (YearGrid): para pintar solo un puntito por día
 * `getYear` es mucho más ligera.
 */
export async function getYearEvents(userId: number, dateStr: string, filters: EventFilters = {}) {
  parseDateParam(dateStr);
  const timezone = await getUserTimezone(userId);
  const { start, end } = yearRange(dateStr, timezone);
  const { events, pagination } = await findEventsInRange(userId, start, end, { ...filters, limit: filters.limit ?? 5000 });
  return { year: dateStr.slice(0, 4), yearStart: start, yearEnd: end, timezone, events, pagination };
}

interface CreateEventInput {
  title: string;
  description?: string | null;
  type: string;
  startTime: string | Date;
  endTime: string | Date;
  location?: string | null;
  isRecurring?: boolean;
  recurringPattern?: string | null;
  // Solo con recurringPattern = "weekday_range" — ver el comentario de estos campos en
  // prisma/schema.prisma.
  recurringWeekdayStart?: number | null;
  recurringWeekdayEnd?: number | null;
  reminderMinutesBefore?: number[];
  guests?: string[];
}

export async function createEvent(userId: number, input: CreateEventInput) {
  return prisma.event.create({
    data: {
      userId,
      title: input.title,
      description: input.description ?? null,
      type: input.type,
      startTime: new Date(input.startTime),
      endTime: new Date(input.endTime),
      location: input.location ?? null,
      isRecurring: input.isRecurring ?? false,
      recurringPattern: input.recurringPattern ?? null,
      recurringWeekdayStart: input.recurringWeekdayStart ?? null,
      recurringWeekdayEnd: input.recurringWeekdayEnd ?? null,
      reminderMinutesBefore: input.reminderMinutesBefore ?? [30],
      guests: input.guests ?? [],
    },
  });
}

async function assertOwnership(userId: number, eventId: number) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) {
    throw new NotFoundError("Evento no encontrado");
  }
  if (event.userId !== userId) {
    throw new ForbiddenError("No autorizado");
  }
  return event;
}

export async function updateEvent(userId: number, eventId: number, input: Partial<CreateEventInput>) {
  await assertOwnership(userId, eventId);

  return prisma.event.update({
    where: { id: eventId },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.startTime !== undefined ? { startTime: new Date(input.startTime) } : {}),
      ...(input.endTime !== undefined ? { endTime: new Date(input.endTime) } : {}),
      ...(input.location !== undefined ? { location: input.location } : {}),
      ...(input.isRecurring !== undefined ? { isRecurring: input.isRecurring } : {}),
      ...(input.recurringPattern !== undefined ? { recurringPattern: input.recurringPattern } : {}),
      ...(input.recurringWeekdayStart !== undefined ? { recurringWeekdayStart: input.recurringWeekdayStart } : {}),
      ...(input.recurringWeekdayEnd !== undefined ? { recurringWeekdayEnd: input.recurringWeekdayEnd } : {}),
      ...(input.reminderMinutesBefore !== undefined ? { reminderMinutesBefore: input.reminderMinutesBefore } : {}),
      ...(input.guests !== undefined ? { guests: input.guests } : {}),
    },
  });
}

export async function deleteEvent(userId: number, eventId: number) {
  await assertOwnership(userId, eventId);
  // Tombstone en la misma transacción que el delete (ver tombstoneService.ts) — para que el
  // móvil sepa en su próximo /sync/pull que este evento (y sus posibles excepciones, que caen
  // en cascada) desapareció.
  await prisma.$transaction([
    prisma.event.delete({ where: { id: eventId } }),
    recordTombstone(prisma, userId, "event", eventId),
  ]);
}

interface EventExceptionInput {
  originalStartTime: string | Date;
  action: "moved" | "cancelled";
  newStartTime?: string | Date;
  newEndTime?: string | Date;
}

/**
 * Crea o actualiza la excepción de UNA ocurrencia de una serie recurrente — moverla (nuevo
 * horario) o cancelarla, sin tocar la plantilla ni el resto de la serie. `input.originalStartTime`
 * debe ser el horario "natural" de esa ocurrencia (el que devuelve `expandRecurringEvent`/
 * `nextOccurrenceStartingIn` en `originalStartTime`), no el ya movido si ya tuviera excepción.
 */
export async function setEventException(userId: number, eventId: number, input: EventExceptionInput) {
  const event = await assertOwnership(userId, eventId);
  if (!event.isRecurring) {
    throw new ValidationError("Solo los eventos recurrentes admiten excepciones por ocurrencia");
  }
  if (input.action === "moved" && (!input.newStartTime || !input.newEndTime)) {
    throw new ValidationError("newStartTime y newEndTime son obligatorios para mover una ocurrencia");
  }

  const originalStartTime = new Date(input.originalStartTime);
  const moved = input.action === "moved";

  return prisma.eventException.upsert({
    where: { eventId_originalStartTime: { eventId, originalStartTime } },
    update: {
      status: input.action,
      newStartTime: moved ? new Date(input.newStartTime as string | Date) : null,
      newEndTime: moved ? new Date(input.newEndTime as string | Date) : null,
    },
    create: {
      eventId,
      originalStartTime,
      status: input.action,
      newStartTime: moved ? new Date(input.newStartTime as string | Date) : null,
      newEndTime: moved ? new Date(input.newEndTime as string | Date) : null,
    },
  });
}

/** Borra la excepción de una ocurrencia: vuelve a mostrarse en su horario natural, como el resto de la serie. */
export async function deleteEventException(userId: number, eventId: number, originalStartTimeStr: string) {
  await assertOwnership(userId, eventId);
  const exception = await prisma.eventException.findUnique({
    where: { eventId_originalStartTime: { eventId, originalStartTime: new Date(originalStartTimeStr) } },
  });
  if (!exception) return; // ya no existía (idempotente) — nada que borrar ni que dejar constancia
  await prisma.$transaction([
    prisma.eventException.delete({ where: { id: exception.id } }),
    recordTombstone(prisma, userId, "eventException", exception.id),
  ]);
}

interface FreeBlock {
  start: Date;
  end: Date;
  durationMinutes: number;
}

// Un hueco de 5 minutos entre reuniones no sirve para nada — se descarta antes de considerarlo
// "tiempo libre" sugerible.
const MIN_FREE_BLOCK_MINUTES = 15;

function pushIfLongEnough(blocks: FreeBlock[], start: Date, end: Date): void {
  const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
  if (durationMinutes >= MIN_FREE_BLOCK_MINUTES) blocks.push({ start, end, durationMinutes });
}

/** Huecos libres en [windowStart, windowEnd] una vez descontados los intervalos ocupados
 * (recortados al propio window y fusionados si se solapan entre sí). */
function computeFreeBlocks(windowStart: Date, windowEnd: Date, busy: { start: Date; end: Date }[]): FreeBlock[] {
  const clipped = busy
    .map((b) => ({
      start: new Date(Math.max(b.start.getTime(), windowStart.getTime())),
      end: new Date(Math.min(b.end.getTime(), windowEnd.getTime())),
    }))
    .filter((b) => b.start.getTime() < b.end.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const merged: { start: Date; end: Date }[] = [];
  for (const b of clipped) {
    const last = merged[merged.length - 1];
    if (last && b.start.getTime() <= last.end.getTime()) {
      if (b.end.getTime() > last.end.getTime()) last.end = b.end;
    } else {
      merged.push({ ...b });
    }
  }

  const blocks: FreeBlock[] = [];
  let cursor = windowStart;
  for (const b of merged) {
    if (b.start.getTime() > cursor.getTime()) pushIfLongEnough(blocks, cursor, b.start);
    if (b.end.getTime() > cursor.getTime()) cursor = b.end;
  }
  if (cursor.getTime() < windowEnd.getTime()) pushIfLongEnough(blocks, cursor, windowEnd);

  return blocks;
}

const PRIORITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

/**
 * Calcula los huecos libres de `dateStr` (dentro de la franja 08:00–22:00 local, ver
 * `dayWorkWindow`) y, para cada uno en orden cronológico, sugiere la tarea pendiente del
 * Planificador (con `estimatedMinutes` fijado) de mayor prioridad que quepa y no se haya
 * sugerido ya en otro hueco — conecta Agenda y Planificador sin materializar nada: es solo
 * una sugerencia, el usuario decide si crear un evento para esa tarea.
 */
export async function getFreeTime(userId: number, dateStr: string) {
  parseDateParam(dateStr);
  const timezone = await getUserTimezone(userId);
  const workWindow = dayWorkWindow(dateStr, timezone);
  const { start: dayStart, end: dayEnd } = dayRange(dateStr, timezone);

  const { events } = await findEventsInRange(userId, dayStart, dayEnd, { limit: 500 });
  const busy = events.map((e) => ({ start: new Date(e.startTime), end: new Date(e.endTime) }));
  const freeBlocks = computeFreeBlocks(workWindow.start, workWindow.end, busy);

  const pendingTasks = await prisma.task.findMany({
    where: { userId, status: { not: "done" }, estimatedMinutes: { not: null } },
  });
  pendingTasks.sort((a, b) => (PRIORITY_RANK[b.priority] ?? 0) - (PRIORITY_RANK[a.priority] ?? 0));

  const usedTaskIds = new Set<number>();
  const suggestions: { block: { start: Date; end: Date }; task: { id: number; title: string; estimatedMinutes: number } }[] = [];
  for (const block of freeBlocks) {
    const fit = pendingTasks.find((t) => !usedTaskIds.has(t.id) && (t.estimatedMinutes ?? 0) <= block.durationMinutes);
    if (fit) {
      usedTaskIds.add(fit.id);
      suggestions.push({
        block: { start: block.start, end: block.end },
        task: { id: fit.id, title: fit.title, estimatedMinutes: fit.estimatedMinutes as number },
      });
    }
  }

  return { date: dateStr, timezone, freeBlocks, suggestions };
}

/**
 * Exporta TODOS los eventos del usuario (plantillas recurrentes tal cual, con sus excepciones —
 * no expandidas en ocurrencias) como un único .ics, para importar en Google Calendar/Outlook.
 */
export async function exportIcs(userId: number): Promise<string> {
  const events = await prisma.event.findMany({ where: { userId }, orderBy: { startTime: "asc" } });

  const exceptionsByEventId = new Map<number, EventExceptionLike[]>();
  const recurringIds = events.filter((e) => e.isRecurring).map((e) => e.id);
  if (recurringIds.length > 0) {
    const exceptions = await prisma.eventException.findMany({ where: { eventId: { in: recurringIds } } });
    for (const ex of exceptions) {
      const list = exceptionsByEventId.get(ex.eventId) ?? [];
      list.push(ex);
      exceptionsByEventId.set(ex.eventId, list);
    }
  }

  return buildIcs(
    events.map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      location: e.location,
      startTime: e.startTime,
      endTime: e.endTime,
      isRecurring: e.isRecurring,
      recurringPattern: e.recurringPattern,
      recurringWeekdayStart: e.recurringWeekdayStart,
      recurringWeekdayEnd: e.recurringWeekdayEnd,
      exceptions: exceptionsByEventId.get(e.id) ?? [],
    }))
  );
}

export interface ImportIcsResult {
  created: number;
  skippedUnparsable: number;
  importedAsSingleOccurrence: number; // tenían una recurrencia no soportada (ver utils/ics.ts)
}

/** Importa un .ics: crea un Event por cada VEVENT interpretable. Las fechas sin zona horaria
 * explícita se interpretan en la timezone configurada del usuario. */
export async function importIcs(userId: number, icsText: string): Promise<ImportIcsResult> {
  const timezone = await getUserTimezone(userId);
  const { events, skipped } = parseIcs(icsText, timezone);

  let importedAsSingleOccurrence = 0;
  if (events.length > 0) {
    await prisma.event.createMany({
      data: events.map((e) => {
        if (e.unsupportedRecurrence) importedAsSingleOccurrence += 1;
        return {
          userId,
          title: e.title,
          description: e.description,
          type: "free", // el .ics no trae nuestra categoría; "free" es el valor más neutro
          startTime: e.startTime,
          endTime: e.endTime,
          location: e.location,
          isRecurring: e.isRecurring,
          recurringPattern: e.recurringPattern,
        };
      }),
    });
  }

  logger.info(`importIcs: ${events.length} evento(s) importado(s), ${skipped} bloque(s) ignorado(s)`, { userId });
  return { created: events.length, skippedUnparsable: skipped, importedAsSingleOccurrence };
}
