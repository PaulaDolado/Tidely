import { useEffect, useRef } from "react";
import * as Notifications from "expo-notifications";
import { createNavigationContainerRef } from "@react-navigation/native";
import { useAuth } from "../auth/AuthContext";
import { markNotificationRead } from "../api/notifications";
import { registerBackgroundTask, unregisterBackgroundTask } from "./backgroundTask";
import {
  clearSystemNotifications,
  presentNewServerNotifications,
  requestNotificationPermission,
  rescheduleEventReminders,
} from "./systemNotifications";

// Ref del NavigationContainer de App.tsx, para abrir la pantalla de un aviso al tocarlo. Root se vuelve
// a montar al cambiar de tema, así que el destino se guarda si el navegador aún no está listo y se aplica
// en su onReady (ver flushNotificationTarget).
export const navigationRef = createNavigationContainerRef();

interface Target {
  route: string;
  params?: object;
}

let pendingTarget: Target | null = null;

function navigateTo(target: Target): void {
  if (!navigationRef.isReady()) {
    pendingTarget = target;
    return;
  }
  // Un apartado desactivado no existe como pestaña: entonces solo se abre la app.
  if (!navigationRef.getRootState()?.routeNames.includes(target.route)) return;
  (navigationRef.navigate as (route: string, params?: object) => void)(target.route, target.params);
}

export function flushNotificationTarget(): void {
  if (!pendingTarget) return;
  const target = pendingTarget;
  pendingTarget = null;
  navigateTo(target);
}

const SERVER_TYPE_ROUTE: Record<string, string> = {
  event_reminder: "Agenda",
  event_invitation: "Agenda",
  task_due: "Planificador",
  goal_at_risk: "Objetivos",
  budget_exceeded: "Finanzas",
};

function targetFor(data: Record<string, unknown>): Target | null {
  if (data.kind === "event") {
    return { route: "Agenda", params: typeof data.focusDate === "string" ? { focusDate: data.focusDate } : undefined };
  }
  if (data.kind === "server" && typeof data.type === "string") {
    const route = SERVER_TYPE_ROUTE[data.type];
    return route ? { route } : null;
  }
  return null;
}

/** Sin interfaz: conecta las notificaciones del teléfono con la sesión. Va fuera de Root (que se vuelve
 * a montar con cada cambio de tema) para no repetir todo esto cada vez. */
export function NotificationsManager() {
  const { user, ready } = useAuth();
  const userId = user?.id;
  const onboarded = user ? user.onboardingCompleted !== false : false;
  const hadSession = useRef(false);

  useEffect(() => {
    if (!ready) return;
    if (userId === undefined) {
      // Se acaba de cerrar sesión: fuera la tarea y los avisos de esa cuenta.
      if (hadSession.current) {
        hadSession.current = false;
        void unregisterBackgroundTask();
        void clearSystemNotifications();
      }
      return;
    }
    hadSession.current = true;
    // El permiso se pide al terminar el asistente de bienvenida, no en mitad de él.
    if (!onboarded) return;
    void (async () => {
      await requestNotificationPermission().catch(() => false);
      await registerBackgroundTask();
      await rescheduleEventReminders();
      await presentNewServerNotifications(userId);
    })();
  }, [ready, userId, onboarded]);

  // Tocar un aviso: abre la pantalla que le corresponde. Vale tanto con la app abierta como si el toque
  // la arranca (useLastNotificationResponse devuelve también ese caso).
  const response = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!response || userId === undefined) return;
    if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const key = `${response.notification.request.identifier}-${response.notification.date}`;
    if (handled.current === key) return;
    handled.current = key;
    const data = (response.notification.request.content.data ?? {}) as Record<string, unknown>;
    if (data.kind === "server" && typeof data.notificationId === "number") {
      markNotificationRead(data.notificationId).catch(() => {});
    }
    const target = targetFor(data);
    if (target) navigateTo(target);
    void Notifications.clearLastNotificationResponseAsync();
  }, [response, userId]);

  return null;
}
