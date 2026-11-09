import * as TaskManager from "expo-task-manager";
import * as BackgroundTask from "expo-background-task";
import { hasTokens, setAuthCallbacks, setTokens } from "../api/client";
import { loadStoredAuth, persistTokens } from "../auth/storage";
import { runSync } from "../sync";
import { presentNewServerNotifications, rescheduleEventReminders } from "./systemNotifications";

// Revisión periódica con la app cerrada o en segundo plano: Android (WorkManager) la lanza como
// pronto cada 15 min, y solo con red y batería suficiente — el momento exacto lo decide el sistema.
// Sincroniza (para que un evento creado desde la web también tenga su recordatorio en el móvil),
// reprograma los recordatorios y muestra los avisos nuevos del servidor.
export const BACKGROUND_TASK_NAME = "tidely-notifications";
const MINIMUM_INTERVAL_MINUTES = 15;

// Tiene que definirse en el ámbito global del bundle (index.ts lo importa antes de montar la app):
// cuando Android arranca la tarea sin la app abierta, no hay componentes montados.
TaskManager.defineTask(BACKGROUND_TASK_NAME, async () => {
  try {
    const stored = await loadStoredAuth();
    if (!stored) return BackgroundTask.BackgroundTaskResult.Success;
    // Arrancada sin la app: este runtime no tiene sesión cargada. Si el cliente renueva el token aquí,
    // el nuevo TIENE que guardarse — el servidor rota los refresh tokens y, si la app volviera a usar
    // el viejo, lo tomaría por reutilización y cerraría todas las sesiones. Si caduca, no se borra
    // nada: ya se encargará la app al abrirse. Con la app viva en segundo plano, su sesión y sus
    // callbacks ya están puestos y no se tocan.
    if (!hasTokens()) {
      setTokens(stored.token, stored.refreshToken);
      setAuthCallbacks({
        onRefreshed: (token, refreshToken) => void persistTokens(token, refreshToken),
        onAuthExpired: () => {},
      });
    }
    await runSync();
    await rescheduleEventReminders();
    await presentNewServerNotifications(stored.user.id);
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackgroundTask(): Promise<void> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
    await BackgroundTask.registerTaskAsync(BACKGROUND_TASK_NAME, { minimumInterval: MINIMUM_INTERVAL_MINUTES });
  } catch {
    // Sin soporte en este dispositivo: quedan los recordatorios programados y la consulta con la app abierta.
  }
}

export async function unregisterBackgroundTask(): Promise<void> {
  try {
    if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK_NAME)) {
      await BackgroundTask.unregisterTaskAsync(BACKGROUND_TASK_NAME);
    }
  } catch {
    // best effort
  }
}
