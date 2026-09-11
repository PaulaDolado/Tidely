// Cliente REST directo para las categorías de evento (Agenda > + Nuevo evento) — mismo criterio
// que api/calendarLegend.ts: no pasa por SQLite ni por src/sync/ (solo `categoryId` en el propio
// Event viaja offline, ver eventsRepo.ts). Replica uno a uno los métodos que
// dashboard/src/pages/AgendaPage.tsx ya usa contra la misma API (/event-categories).
import { api } from "./client";
import { CalendarColor, EventCategory } from "../types";

export async function listEventCategories(): Promise<EventCategory[]> {
  const res = await api.get<{ categories: EventCategory[] }>("/event-categories");
  return res.categories;
}

export const createEventCategory = (label: string, color: CalendarColor) =>
  api.post<EventCategory>("/event-categories", { label, color });

export const renameEventCategory = (id: number, label: string) => api.put<EventCategory>(`/event-categories/${id}`, { label });

export const changeEventCategoryColor = (id: number, color: CalendarColor) =>
  api.put<EventCategory>(`/event-categories/${id}`, { color });

export const deleteEventCategory = (id: number) => api.delete<{ message: string }>(`/event-categories/${id}`);
