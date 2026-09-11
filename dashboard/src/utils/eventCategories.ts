// Helpers para resolver la categoría de un evento (ver EventCategory en types.ts) contra la
// lista de categorías de la cuenta — la usan EventCard/EventDialog/NewEventForm en AgendaPage.tsx,
// HoyPage.tsx y agendaExport.ts (PDF), que solo tienen `event.categoryId` + la lista fetcheada,
// no el objeto de categoría ya resuelto.

import { Event, EventCategory } from "../types";
import { EVENT_CATEGORY_COLOR_CLASSES } from "./calendarColors";

export const NO_CATEGORY_LABEL = "Sin categoría";
const DEFAULT_EVENT_CATEGORY_STYLE = "bg-muted text-muted-foreground";

export function findEventCategory(categories: EventCategory[], categoryId: number | null | undefined): EventCategory | undefined {
  return categoryId == null ? undefined : categories.find((c) => c.id === categoryId);
}

// `fallback`: para eventos antiguos sin categoryId (antes de que existiera esta tabla, ver
// prisma/schema.prisma) se pasa `event.type` — el nombre que tenían guardado ahí sigue siendo más
// útil que "Sin categoría" a secas.
export function eventCategoryLabel(categories: EventCategory[], event: Pick<Event, "categoryId" | "type">): string {
  return findEventCategory(categories, event.categoryId)?.label ?? event.type ?? NO_CATEGORY_LABEL;
}

export function eventCategoryStyle(categories: EventCategory[], categoryId: number | null | undefined): string {
  const category = findEventCategory(categories, categoryId);
  return category ? EVENT_CATEGORY_COLOR_CLASSES[category.color] : DEFAULT_EVENT_CATEGORY_STYLE;
}
