import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "../api/client";
import type { AppNotification } from "../api/notifications";
import { listExpandedEvents } from "../db/eventsRepo";
import { loadStoredAuth } from "../auth/storage";

// Notificaciones en la bandeja del propio teléfono, no solo en la campana de la app. Dos fuentes:
// - Recordatorios de eventos: se programan en el móvil a partir de la agenda local (SQLite), así que
//   saltan a su hora aunque la app esté cerrada y sin conexión.
// - El resto de avisos del servidor (tareas que vencen, metas en riesgo, presupuesto, invitaciones):
//   se consultan al servidor y se muestran al momento — con la app abierta cada minuto (ver
//   useUnreadNotifications) y cerrada desde la tarea en segundo plano (ver backgroundTask.ts).
// Los "event_reminder" que también crea el servidor no se muestran aquí: ya los cubre el móvil.

export const CHANNEL_REMINDERS = "recordatorios";
export const CHANNEL_ALERTS = "avisos";

const EVENT_PREFIX = "event-";
// Android limita las alarmas por app (unas 500 en algunos fabricantes), y la agenda se reprograma tras
// cada sincronización: con una semana por delante y un tope basta, la tarea en segundo plano y cada
// apertura de la app van corriendo la ventana.
const REMINDER_WINDOW_DAYS = 7;
const MAX_SCHEDULED_REMINDERS = 64;

// Sin handler, Android no muestra las notificaciones con la app en primer plano (ver la doc de SDK 57).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function ensureChannels(): Promise<void> {
  await Notifications.setNotificationChannelAsync(CHANNEL_REMINDERS, {
    name: "Recordatorios de eventos",
    importance: Notifications.AndroidImportance.HIGH,
  });
  await Notifications.setNotificationChannelAsync(CHANNEL_ALERTS, {
    name: "Avisos",
    description: "Tareas que vencen, metas en riesgo, presupuesto e invitaciones",
    importance: Notifications.AndroidImportance.HIGH,
  });
}

/** Pide el permiso de notificaciones (Android 13+). El canal tiene que existir antes: sin canal,
 * Android no llega a mostrar el diálogo. */
export async function requestNotificationPermission(): Promise<boolean> {
  await ensureChannels();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

function reminderLabel(minutes: number): string {
  if (minutes <= 0) return "Empieza ahora";
  if (minutes < 60) return `Empieza en ${minutes} min`;
  if (minutes % 1440 === 0) return minutes === 1440 ? "Empieza en 1 día" : `Empieza en ${minutes / 1440} días`;
  if (minutes % 60 === 0) return `Empieza en ${minutes / 60} h`;
  return `Empieza en ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function formatStart(date: Date): string {
  return date.toLocaleString("es-ES", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// El título entra en el identificador para que renombrar un evento sustituya el aviso ya programado
// en vez de dejar el texto viejo.
function titleHash(title: string): string {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

interface PlannedReminder {
  identifier: string;
  fireAt: Date;
  title: string;
  body: string;
  eventId: string;
  // Mismo formato (clave UTC YYYY-MM-DD) que el `focusDate` de la Agenda.
  focusDate: string;
}

async function planReminders(now: Date): Promise<PlannedReminder[]> {
  const maxOffsetMs = 7 * 24 * 60 * 60 * 1000;
  const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  // Ocurrencias hasta una semana MÁS allá de la ventana: un aviso "1 semana antes" de un evento de la
  // semana que viene cae dentro de la ventana aunque el evento no.
  const occurrences = await listExpandedEvents(now, new Date(windowEnd.getTime() + maxOffsetMs));
  const planned: PlannedReminder[] = [];
  for (const occ of occurrences) {
    // Igual que el servidor (createEventReminders): los recordatorios son de quien creó el evento, no
    // de los invitados.
    if (occ.event.sharing?.role === "invitee") continue;
    for (const offset of occ.event.reminderMinutesBefore) {
      const fireAt = new Date(occ.startTime.getTime() - offset * 60_000);
      if (fireAt <= now || fireAt > windowEnd) continue;
      planned.push({
        identifier: `${EVENT_PREFIX}${occ.event.id}-${occ.startTime.getTime()}-${offset}-${titleHash(occ.event.title)}`,
        fireAt,
        title: occ.event.title,
        body: `${reminderLabel(offset)} · ${formatStart(occ.startTime)}`,
        eventId: occ.event.id,
        focusDate: occ.startTime.toISOString().slice(0, 10),
      });
    }
  }
  planned.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
  return planned.slice(0, MAX_SCHEDULED_REMINDERS);
}

async function syncScheduledReminders(): Promise<void> {
  // Sin sesión (p.ej. una sincronización que acaba justo después de cerrar sesión) no se programa nada
  // de la cuenta anterior: la lista vacía cancela lo que quedara.
  const planned = (await loadStoredAuth()) ? await planReminders(new Date()) : [];
  const wanted = new Set(planned.map((p) => p.identifier));
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const existing = new Set<string>();
  for (const request of scheduled) {
    if (!request.identifier.startsWith(EVENT_PREFIX)) continue;
    if (wanted.has(request.identifier)) existing.add(request.identifier);
    else await Notifications.cancelScheduledNotificationAsync(request.identifier);
  }
  for (const p of planned) {
    if (existing.has(p.identifier)) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: p.identifier,
      content: { title: p.title, body: p.body, data: { kind: "event", eventId: p.eventId, focusDate: p.focusDate } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: p.fireAt, channelId: CHANNEL_REMINDERS },
    });
  }
}

// Se llama tras cada sincronización, al abrir la app y desde la tarea en segundo plano: dos llamadas a
// la vez podrían programar el mismo aviso dos veces, así que van en fila (y una que llega con otra en
// curso se apunta para repetirse al acabar, con los datos ya actualizados).
let reminderRun: Promise<void> | null = null;
let reminderRerun = false;

export function rescheduleEventReminders(): Promise<void> {
  if (reminderRun) {
    reminderRerun = true;
    return reminderRun;
  }
  reminderRun = (async () => {
    do {
      reminderRerun = false;
      try {
        await syncScheduledReminders();
      } catch {
        // Sin permiso o sin base de datos todavía: se reintenta en la siguiente sincronización.
      }
    } while (reminderRerun);
  })().finally(() => {
    reminderRun = null;
  });
  return reminderRun;
}

const lastPresentedKey = (userId: number) => `tidely.notifications.lastPresentedId.${userId}`;
let presenting: Promise<void> | null = null;

/** Muestra en el teléfono los avisos del servidor que aún no se habían mostrado. Los ids son
 * crecientes, así que basta con recordar el último. La primera vez solo toma nota (lo que ya estaba
 * sin leer sigue en la campana de la app, no se lanza de golpe). */
export function presentNewServerNotifications(userId: number): Promise<void> {
  if (presenting) return presenting;
  presenting = (async () => {
    const key = lastPresentedKey(userId);
    const stored = await AsyncStorage.getItem(key);
    const { notifications } = await api.get<{ notifications: AppNotification[] }>("/notifications?unreadOnly=true&limit=20");
    const maxId = notifications.reduce((max, n) => Math.max(max, n.id), 0);
    if (stored === null) {
      await AsyncStorage.setItem(key, String(maxId));
      return;
    }
    const last = Number(stored) || 0;
    const fresh = notifications.filter((n) => n.id > last && n.type !== "event_reminder").sort((a, b) => a.id - b.id);
    for (const n of fresh) {
      await Notifications.scheduleNotificationAsync({
        identifier: `server-${n.id}`,
        content: { title: n.title, body: n.message, data: { kind: "server", notificationId: n.id, type: n.type } },
        trigger: { channelId: CHANNEL_ALERTS },
      });
    }
    if (maxId > last) await AsyncStorage.setItem(key, String(maxId));
  })()
    .catch(() => {
      // Sin red o sin permiso: se vuelve a intentar en la siguiente consulta.
    })
    .finally(() => {
      presenting = null;
    });
  return presenting;
}

/** Al cerrar sesión: nada de avisos de la cuenta anterior en este teléfono. */
export async function clearSystemNotifications(): Promise<void> {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    await Notifications.dismissAllNotificationsAsync();
  } catch {
    // best effort
  }
}
