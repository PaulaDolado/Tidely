// Puerto de dashboard/src/utils/eventCategories.ts — resuelve la categoría de un evento
// (ver EventCategory en types.ts) contra la lista de categorías de la cuenta. Lo usan
// AgendaScreen y HoyScreen, que solo tienen `event.categoryId` + la lista fetcheada, no el
// objeto de categoría ya resuelto.
import { colors } from "../theme";
import { EventCategory } from "../types";
import { EVENT_CATEGORY_COLOR_STYLES } from "./calendarColors";

export const NO_CATEGORY_LABEL = "Sin categoría";

export function findEventCategory(categories: EventCategory[], categoryId: number | null | undefined): EventCategory | undefined {
  return categoryId == null ? undefined : categories.find((c) => c.id === categoryId);
}

// `fallback`: para eventos antiguos sin categoryId (antes de que existiera esta tabla) se pasa
// `event.type` — el nombre que tenían guardado ahí sigue siendo más útil que "Sin categoría" a secas.
export function eventCategoryLabel(categories: EventCategory[], event: { categoryId: number | null; type: string }): string {
  return findEventCategory(categories, event.categoryId)?.label ?? event.type ?? NO_CATEGORY_LABEL;
}

export function eventCategoryStyle(categories: EventCategory[], categoryId: number | null | undefined): { bg: string; text: string } {
  const category = findEventCategory(categories, categoryId);
  return category ? EVENT_CATEGORY_COLOR_STYLES[category.color] : { bg: colors.muted, text: colors.mutedForeground };
}
