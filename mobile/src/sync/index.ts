import { pushToServer } from "./push";
import { pullFromServer } from "./pull";

export interface SyncResult {
  success: boolean;
  error?: string;
  at: string;
  // Cambios locales que el servidor ha rechazado en este sync: siguen pendientes y se reintentan.
  rejected?: number;
}

// Cada pantalla (Hoy/Agenda/Planificador) dispara su propio `sync()` al montar/enfocar, y
// `HoyScreen` además reintenta en cuanto `useNetInfo` resuelve la conectividad — sin este guard,
// dos `runSync()` casi simultáneos abren transacciones SQLite entrelazadas sobre la misma
// conexión (una sola, ver db/index.ts) y expo-sqlite responde con "cannot rollback - no
// transaction is active". Un `runSync()` que llega mientras otro ya está en curso reutiliza la
// misma promesa en vez de arrancar un segundo push+pull en paralelo. Encontrado al probar por
// primera vez en un emulador Android real.
let inFlight: Promise<SyncResult> | null = null;

/** Sube antes de bajar: así, cuando el pull llega, el cursor guardado sigue siendo el de ANTES
 * de este push (se actualiza al final del propio pull) — por eso el pull de este mismo ciclo
 * incluye también los cambios que el push acaba de confirmar (p.ej. el `serverId` real de un
 * HabitLog creado offline, ver habitsRepo.upsertHabitLogs). Si el push falla (sin conexión, p.
 * ej.), no se intenta el pull — mejor no traer nada que traer un estado a medias. */
export function runSync(): Promise<SyncResult> {
  if (inFlight) return inFlight;
  inFlight = runSyncNow().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runSyncNow(): Promise<SyncResult> {
  try {
    const rejected = await pushToServer();
    await pullFromServer();
    return { success: true, at: new Date().toISOString(), rejected };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Error de sincronización", at: new Date().toISOString() };
  }
}
