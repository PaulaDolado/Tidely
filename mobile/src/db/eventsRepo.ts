import * as Crypto from "expo-crypto";
import { getDb } from "./index";
import { listExceptionsForEvents } from "./eventExceptionsRepo";
import { EventOccurrence, expandRecurringEvent, RecurringEventLike } from "../utils/recurrence";
import { parseJsonArray, toJsonArray } from "../utils/json";
import { LocalEvent, RecurringPattern, ServerEvent } from "../types";

/** Vista "parseada" de una fila de `events` — arrays reales en vez de JSON en texto, booleano en
 * vez de 0/1 — para no repetir `JSON.parse`/`=== 1` en cada pantalla que lee eventos. */
export interface ParsedEvent {
  id: string;
  title: string;
  description: string | null;
  type: string;
  categoryId: number | null;
  startTime: string;
  endTime: string;
  location: string | null;
  isRecurring: boolean;
  recurringPattern: RecurringPattern | null;
  reminderMinutesBefore: number[];
  guests: string[];
}

export function parseEvent(row: LocalEvent): ParsedEvent {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    type: row.type,
    categoryId: row.categoryId,
    startTime: row.startTime,
    endTime: row.endTime,
    location: row.location,
    isRecurring: row.isRecurring === 1,
    recurringPattern: row.recurringPattern,
    reminderMinutesBefore: parseJsonArray<number>(row.reminderMinutesBefore),
    guests: parseJsonArray<string>(row.guests),
  };
}

/** Igual patrón que `notesRepo.upsertNotes` (ver ese fichero para el porqué de cada pieza): no
 * se pisa una fila con una operación local pendiente — se resolverá en el próximo push. */
export async function upsertEvents(events: ServerEvent[]): Promise<void> {
  if (events.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const e of events) {
      const id = String(e.id);
      await db.runAsync(
        `INSERT INTO events
           (id, title, description, type, categoryId, startTime, endTime, location, isRecurring,
            recurringPattern, reminderMinutesBefore, guests, source, googleEventId,
            createdAt, updatedAt, synced, pendingOp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title, description = excluded.description, type = excluded.type,
           categoryId = excluded.categoryId,
           startTime = excluded.startTime, endTime = excluded.endTime, location = excluded.location,
           isRecurring = excluded.isRecurring, recurringPattern = excluded.recurringPattern,
           reminderMinutesBefore = excluded.reminderMinutesBefore, guests = excluded.guests,
           source = excluded.source, googleEventId = excluded.googleEventId, updatedAt = excluded.updatedAt,
           synced = 1
         WHERE events.pendingOp IS NULL`,
        [
          id,
          e.title,
          e.description,
          e.type,
          e.categoryId,
          e.startTime,
          e.endTime,
          e.location,
          e.isRecurring ? 1 : 0,
          e.recurringPattern,
          toJsonArray(e.reminderMinutesBefore),
          toJsonArray(e.guests),
          e.source,
          e.googleEventId,
          e.createdAt,
          e.updatedAt,
        ]
      );
    }
  });
}

export async function deleteEvent(serverId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM events WHERE id = ? AND synced = 1", [String(serverId)]);
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Filas candidatas para un rango: no recurrentes que se solapan con el rango, más las
 * plantillas recurrentes cuyo inicio original ya pasó (pueden generar ocurrencias dentro del
 * rango aunque su `startTime` original quede muy por detrás) — la expansión real de las
 * recurrentes la hace `listExpandedEvents`, más abajo. Excluye lo marcado para borrar (borrado
 * optimista, igual que `notesRepo.listNotes`). */
async function listCandidateEvents(rangeStartIso: string, rangeEndIso: string): Promise<LocalEvent[]> {
  const db = await getDb();
  return db.getAllAsync<LocalEvent>(
    `SELECT * FROM events
     WHERE (pendingOp IS NULL OR pendingOp != 'delete')
       AND (
         (isRecurring = 0 AND startTime < ? AND endTime > ?)
         OR (isRecurring = 1 AND startTime <= ?)
       )
     ORDER BY startTime ASC`,
    [rangeEndIso, rangeStartIso, rangeEndIso]
  );
}

/** Eventos (recurrentes ya expandidos en sus ocurrencias, no-recurrentes tal cual) que caen
 * dentro de [rangeStart, rangeEnd], en orden cronológico — usado por `AgendaScreen` y por
 * `listTodayEvents`. Ver `utils/recurrence.ts` para la lógica de expansión (puerto del backend). */
export async function listExpandedEvents(rangeStart: Date, rangeEnd: Date): Promise<EventOccurrence<ParsedEvent>[]> {
  const rows = await listCandidateEvents(rangeStart.toISOString(), rangeEnd.toISOString());
  const recurringIds = rows.filter((r) => r.isRecurring === 1).map((r) => r.id);
  const exceptionsByEvent = await listExceptionsForEvents(recurringIds);

  const occurrences: EventOccurrence<ParsedEvent>[] = [];
  for (const row of rows) {
    const parsed = parseEvent(row);
    if (!parsed.isRecurring) {
      occurrences.push({
        event: parsed,
        startTime: new Date(parsed.startTime),
        endTime: new Date(parsed.endTime),
        isRecurringInstance: false,
        seriesId: parsed.id,
      });
      continue;
    }

    const template: RecurringEventLike = {
      id: parsed.id,
      isRecurring: true,
      recurringPattern: parsed.recurringPattern,
      startTime: new Date(parsed.startTime),
      endTime: new Date(parsed.endTime),
    };
    const exceptions = exceptionsByEvent
      .filter((ex) => ex.eventId === row.id)
      .map((ex) => ({
        originalStartTime: new Date(ex.originalStartTime),
        status: ex.status,
        newStartTime: ex.newStartTime ? new Date(ex.newStartTime) : null,
        newEndTime: ex.newEndTime ? new Date(ex.newEndTime) : null,
      }));
    const expanded = expandRecurringEvent(template, rangeStart, rangeEnd, exceptions);
    occurrences.push(...expanded.map((occ) => ({ ...occ, event: parsed })));
  }

  occurrences.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  return occurrences;
}

export async function listTodayEvents(): Promise<EventOccurrence<ParsedEvent>[]> {
  const today = todayKey();
  const start = new Date(`${today}T00:00:00.000Z`);
  const end = new Date(`${today}T23:59:59.999Z`);
  return listExpandedEvents(start, end);
}

// --- Escritura local (crear / editar / borrar offline) — mismo patrón que notesRepo ---

export async function createEventLocal(input: {
  title: string;
  description: string | null;
  type: string;
  categoryId: number | null;
  startTime: string;
  endTime: string;
  location: string | null;
  isRecurring: boolean;
  recurringPattern: RecurringPattern | null;
  reminderMinutesBefore: number[];
  guests: string[];
}): Promise<string> {
  const db = await getDb();
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO events
       (id, title, description, type, categoryId, startTime, endTime, location, isRecurring, recurringPattern,
        reminderMinutesBefore, guests, source, googleEventId, createdAt, updatedAt, synced, pendingOp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'tidely', NULL, ?, ?, 0, NULL)`,
    [
      id,
      input.title,
      input.description,
      input.type,
      input.categoryId,
      input.startTime,
      input.endTime,
      input.location,
      input.isRecurring ? 1 : 0,
      input.recurringPattern,
      toJsonArray(input.reminderMinutesBefore),
      toJsonArray(input.guests),
      now,
      now,
    ]
  );
  return id;
}

export async function updateEventLocal(
  id: string,
  input: {
    title: string;
    description: string | null;
    type: string;
    categoryId: number | null;
    startTime: string;
    endTime: string;
    location: string | null;
    isRecurring: boolean;
    recurringPattern: RecurringPattern | null;
    reminderMinutesBefore: number[];
    guests: string[];
  }
): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE events SET
       title = ?, description = ?, type = ?, categoryId = ?, startTime = ?, endTime = ?, location = ?,
       isRecurring = ?, recurringPattern = ?, reminderMinutesBefore = ?, guests = ?, updatedAt = ?,
       pendingOp = CASE WHEN synced = 1 THEN 'update' ELSE pendingOp END
     WHERE id = ?`,
    [
      input.title,
      input.description,
      input.type,
      input.categoryId,
      input.startTime,
      input.endTime,
      input.location,
      input.isRecurring ? 1 : 0,
      input.recurringPattern,
      toJsonArray(input.reminderMinutesBefore),
      toJsonArray(input.guests),
      now,
      id,
    ]
  );
}

/** Igual criterio que `notesRepo.deleteNoteLocal`: una fila nunca sincronizada se borra sin más;
 * una ya sincronizada se marca para borrar y desaparece de las listas al instante (ver el filtro
 * `pendingOp != 'delete'` en `listCandidateEvents`), pero sigue en la BD hasta que el push
 * confirme el borrado. */
export async function deleteEventLocal(id: string): Promise<void> {
  const db = await getDb();
  const event = await db.getFirstAsync<LocalEvent>("SELECT * FROM events WHERE id = ?", [id]);
  if (!event) return;
  if (event.synced === 0) {
    await db.runAsync("DELETE FROM events WHERE id = ?", [id]);
  } else {
    await db.runAsync("UPDATE events SET pendingOp = 'delete' WHERE id = ?", [id]);
  }
}

export async function listUnsyncedEvents(): Promise<LocalEvent[]> {
  const db = await getDb();
  return db.getAllAsync<LocalEvent>("SELECT * FROM events WHERE synced = 0");
}

export async function listEventsPendingUpdate(): Promise<LocalEvent[]> {
  const db = await getDb();
  return db.getAllAsync<LocalEvent>("SELECT * FROM events WHERE synced = 1 AND pendingOp = 'update'");
}

export async function listEventsPendingDelete(): Promise<LocalEvent[]> {
  const db = await getDb();
  return db.getAllAsync<LocalEvent>("SELECT * FROM events WHERE pendingOp = 'delete'");
}

export async function markEventSynced(localId: string, serverId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE events SET id = ?, synced = 1 WHERE id = ?", [String(serverId), localId]);
}

export async function clearEventPendingOp(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE events SET pendingOp = NULL WHERE id = ?", [id]);
}

export async function deleteEventRow(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM events WHERE id = ?", [id]);
}
