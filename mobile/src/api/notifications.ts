import { api } from "./client";

// Mismo shape que Notification en dashboard/src/types.ts (backend: src/services/
// notificationService.ts) — notificaciones solo dentro de la app (no hay push del sistema).
export interface AppNotification {
  id: number;
  type: "event_reminder" | "goal_at_risk" | "task_due" | "event_invitation";
  title: string;
  message: string;
  relatedId: number | null;
  read: boolean;
  createdAt: string;
}

// Mismo límite que NotificationsWidget en dashboard/src/components/AppShell.tsx: un panel de
// "lo último sin leer", no un historial paginado.
const PANEL_LIMIT = 5;

export async function listUnreadNotifications(): Promise<AppNotification[]> {
  const res = await api.get<{ notifications: AppNotification[] }>(`/notifications?unreadOnly=true&limit=${PANEL_LIMIT}`);
  return res.notifications;
}

export async function getUnreadCount(): Promise<number> {
  const res = await api.get<{ unreadCount: number }>("/notifications/unread-count");
  return res.unreadCount;
}

export function markAllNotificationsRead(): Promise<unknown> {
  return api.put("/notifications/read-all");
}

export function markNotificationRead(id: number): Promise<unknown> {
  return api.put(`/notifications/${id}/read`);
}

export function deleteNotification(id: number): Promise<unknown> {
  return api.delete(`/notifications/${id}`);
}
