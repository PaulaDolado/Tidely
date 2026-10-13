import { getDb } from "./index";
import { LocalEventException, ServerEventException } from "../types";

/** Caché de lectura de las excepciones del servidor — un pull siempre sobrescribe sin comprobar
 * nada local, igual que `eventsRepo` hacía en Fase 1 para los propios eventos. Las excepciones
 * que crea el propio móvil ("Mover/Cancelar solo esta vez", ver AgendaScreen) NO se encolan para
 * el push: se mandan directas a la API (solo con conexión) y aquí se guarda la respuesta del
 * servidor para que la Agenda se repinte al instante. Se identifican por
 * (eventId, originalStartTime), no por su `id` de servidor (igual que en el propio backend, ver
 * `EventException` en prisma/schema.prisma). */
export async function upsertEventExceptions(exceptions: ServerEventException[]): Promise<void> {
  if (exceptions.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const ex of exceptions) {
      await db.runAsync(
        `INSERT OR REPLACE INTO event_exceptions
           (eventId, originalStartTime, serverId, status, newStartTime, newEndTime, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [String(ex.eventId), ex.originalStartTime, ex.id, ex.status, ex.newStartTime, ex.newEndTime, ex.updatedAt]
      );
    }
  });
}

export async function deleteEventExceptionByServerId(serverId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM event_exceptions WHERE serverId = ?", [serverId]);
}

/** Borra la excepción de UNA ocurrencia (revertir "mover/cancelar solo esta vez") tras haberla
 * borrado ya en el servidor. Se compara por instante y no por texto: el `originalStartTime`
 * guardado viene tal cual del servidor y podría diferir en formato (p.ej. milisegundos) del que
 * calcula la expansión local, aunque sea el mismo momento. */
export async function deleteEventExceptionByOccurrence(eventId: string, originalStartTime: string): Promise<void> {
  const db = await getDb();
  const target = new Date(originalStartTime).getTime();
  const rows = await db.getAllAsync<LocalEventException>("SELECT * FROM event_exceptions WHERE eventId = ?", [eventId]);
  for (const row of rows) {
    if (new Date(row.originalStartTime).getTime() === target) {
      await db.runAsync("DELETE FROM event_exceptions WHERE eventId = ? AND originalStartTime = ?", [eventId, row.originalStartTime]);
    }
  }
}

export async function listExceptionsForEvents(eventIds: string[]): Promise<LocalEventException[]> {
  if (eventIds.length === 0) return [];
  const db = await getDb();
  const placeholders = eventIds.map(() => "?").join(",");
  return db.getAllAsync<LocalEventException>(`SELECT * FROM event_exceptions WHERE eventId IN (${placeholders})`, eventIds);
}
