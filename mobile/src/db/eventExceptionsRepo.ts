import { getDb } from "./index";
import { LocalEventException, ServerEventException } from "../types";

// Las excepciones ("Mover/Cancelar solo esta vez" / "Restaurar horario original", ver
// AgendaScreen) se escriben offline: cada una lleva su `synced`/`pendingOp` ('upsert' | 'delete')
// y sube por el bloque `eventExceptions`/`deletes` de /sync (ver sync/push.ts). Se identifican por
// (eventId, originalStartTime), no por su `id` de servidor (igual que en el propio backend, ver
// `EventException` en prisma/schema.prisma) — `serverId` solo sirve para emparejar un tombstone.

const NUMERIC_ID = /^\d+$/;

/** Un pull nunca pisa una excepción con una operación local pendiente (mover/cancelar/restaurar
 * sin subir todavía) — mismo criterio que el resto de `upsertX`. */
export async function upsertEventExceptions(exceptions: ServerEventException[]): Promise<void> {
  if (exceptions.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const ex of exceptions) {
      // Misma ocurrencia puede venir con otro formato de texto (p. ej. sin milisegundos) que la
      // fila local — se normaliza a ISO completo para que el ON CONFLICT empareje por instante.
      const originalStartTime = new Date(ex.originalStartTime).toISOString();
      await db.runAsync(
        `INSERT INTO event_exceptions
           (eventId, originalStartTime, serverId, status, newStartTime, newEndTime, updatedAt, synced, pendingOp)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL)
         ON CONFLICT(eventId, originalStartTime) DO UPDATE SET
           serverId = excluded.serverId, status = excluded.status, newStartTime = excluded.newStartTime,
           newEndTime = excluded.newEndTime, updatedAt = excluded.updatedAt, synced = 1
         WHERE event_exceptions.pendingOp IS NULL`,
        [String(ex.eventId), originalStartTime, ex.id, ex.status, ex.newStartTime, ex.newEndTime, ex.updatedAt]
      );
    }
  });
}

export async function deleteEventExceptionByServerId(serverId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM event_exceptions WHERE serverId = ? AND pendingOp IS NULL", [serverId]);
}

/** Cuando se borra un evento (en local o por tombstone) sus excepciones dejan de tener sentido —
 * y una excepción pendiente contra un evento que ya no existe en el servidor haría fallar todo el
 * lote de /sync. */
export async function deleteExceptionsForEvent(eventId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM event_exceptions WHERE eventId = ?", [eventId]);
}

/** Una excepción creada contra un evento que todavía era solo local (uuid) se queda apuntando a
 * ese uuid cuando `eventsRepo.markEventSynced` lo cambia por el id de servidor — hay que
 * reasignarla a mano, o nunca podría subirse (mismo motivo que subtasksRepo.reparentSubtasks). */
export async function reparentEventExceptions(oldEventId: string, newEventId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE event_exceptions SET eventId = ? WHERE eventId = ?", [newEventId, oldEventId]);
}

/** Fila de UNA ocurrencia. Se compara por instante y no por texto: el `originalStartTime`
 * guardado puede diferir en formato (p. ej. milisegundos) del que calcula la expansión local,
 * aunque sea el mismo momento. */
async function findByOccurrence(eventId: string, originalStartTime: string): Promise<LocalEventException | null> {
  const db = await getDb();
  const target = new Date(originalStartTime).getTime();
  const rows = await db.getAllAsync<LocalEventException>("SELECT * FROM event_exceptions WHERE eventId = ?", [eventId]);
  return rows.find((row) => new Date(row.originalStartTime).getTime() === target) ?? null;
}

/** "Mover solo esta vez" / "Cancelar solo esta vez": crea o sustituye la excepción de esa
 * ocurrencia (el servidor también hace upsert, ver agendaService.setEventException). */
export async function setEventExceptionLocal(
  eventId: string,
  originalStartTime: string,
  input: { status: "moved"; newStartTime: string; newEndTime: string } | { status: "cancelled" }
): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  const newStartTime = input.status === "moved" ? input.newStartTime : null;
  const newEndTime = input.status === "moved" ? input.newEndTime : null;
  const existing = await findByOccurrence(eventId, originalStartTime);
  if (existing) {
    await db.runAsync(
      `UPDATE event_exceptions SET status = ?, newStartTime = ?, newEndTime = ?, updatedAt = ?, pendingOp = 'upsert'
       WHERE eventId = ? AND originalStartTime = ?`,
      [input.status, newStartTime, newEndTime, now, existing.eventId, existing.originalStartTime]
    );
    return;
  }
  await db.runAsync(
    `INSERT INTO event_exceptions
       (eventId, originalStartTime, serverId, status, newStartTime, newEndTime, updatedAt, synced, pendingOp)
     VALUES (?, ?, NULL, ?, ?, ?, ?, 0, 'upsert')`,
    [eventId, new Date(originalStartTime).toISOString(), input.status, newStartTime, newEndTime, now]
  );
}

/** "Restaurar horario original": igual criterio que `notesRepo.deleteNoteLocal` — si la excepción
 * nunca llegó al servidor se borra sin más, si no queda marcada para borrar y sube en el push. */
export async function deleteEventExceptionByOccurrence(eventId: string, originalStartTime: string): Promise<void> {
  const db = await getDb();
  const existing = await findByOccurrence(eventId, originalStartTime);
  if (!existing) return;
  if (existing.synced === 0) {
    await db.runAsync("DELETE FROM event_exceptions WHERE eventId = ? AND originalStartTime = ?", [existing.eventId, existing.originalStartTime]);
  } else {
    await db.runAsync("UPDATE event_exceptions SET pendingOp = 'delete' WHERE eventId = ? AND originalStartTime = ?", [
      existing.eventId,
      existing.originalStartTime,
    ]);
  }
}

/** Excluye lo marcado para borrar (borrado optimista) — así "Restaurar" repinta al instante. */
export async function listExceptionsForEvents(eventIds: string[]): Promise<LocalEventException[]> {
  if (eventIds.length === 0) return [];
  const db = await getDb();
  const placeholders = eventIds.map(() => "?").join(",");
  return db.getAllAsync<LocalEventException>(
    `SELECT * FROM event_exceptions WHERE eventId IN (${placeholders}) AND (pendingOp IS NULL OR pendingOp != 'delete')`,
    eventIds
  );
}

/** Solo se suben cuando su evento ya tiene id de servidor (numérico) — una excepción contra un
 * evento recién creado offline espera a que `markEventSynced` la reasigne, igual que las
 * subtareas de una tarea sin sincronizar (ver subtasksRepo.listUnsyncedSubtasksReadyToPush). */
export async function listExceptionsPendingUpsert(): Promise<LocalEventException[]> {
  const db = await getDb();
  // El servidor solo admite excepciones sobre eventos RECURRENTES (agendaService.setEventException
  // lanza un 400 si no) y un 400 tumba el lote entero de /sync. Si el usuario dejó de repetir la
  // serie offline después de mover/cancelar una ocurrencia, esa excepción ya no significa nada:
  // se descarta aquí en vez de bloquear la sincronización para siempre.
  await db.runAsync(
    `DELETE FROM event_exceptions WHERE pendingOp IS NOT NULL
       AND eventId NOT IN (SELECT id FROM events WHERE isRecurring = 1)`
  );
  const rows = await db.getAllAsync<LocalEventException>("SELECT * FROM event_exceptions WHERE pendingOp = 'upsert'");
  return rows.filter((r) => NUMERIC_ID.test(r.eventId));
}

export async function listExceptionsPendingDelete(): Promise<LocalEventException[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<LocalEventException>("SELECT * FROM event_exceptions WHERE pendingOp = 'delete'");
  return rows.filter((r) => NUMERIC_ID.test(r.eventId));
}

/** El push de `eventExceptions` no devuelve `idMappings` (igual que HabitLog): el `serverId` real
 * lo rellena el pull del mismo ciclo, emparejando por (eventId, originalStartTime). */
export async function confirmExceptionUpserted(eventId: string, originalStartTime: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE event_exceptions SET pendingOp = NULL, synced = 1 WHERE eventId = ? AND originalStartTime = ?", [
    eventId,
    originalStartTime,
  ]);
}

export async function confirmExceptionDeleted(eventId: string, originalStartTime: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM event_exceptions WHERE eventId = ? AND originalStartTime = ?", [eventId, originalStartTime]);
}
