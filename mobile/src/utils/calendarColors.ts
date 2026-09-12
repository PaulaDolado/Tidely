// Puerto de dashboard/src/utils/calendarColors.ts — mismos 8 colores de la leyenda del calendario
// anual, traducidos a los tokens RGB de theme.ts (RN no tiene el `bg-x/25` de Tailwind, así que
// las mezclas alfa se calculan aquí con `withAlpha` sobre el color sólido en vez de escribirlas a
// mano — así el día pintado en el calendario anual sigue siempre al tema activo, en vez de quedar
// fijo en los tonos de la paleta "sistema" con la que se escribió originalmente esta rampa).
import { colors, withAlpha } from "../theme";
import { CalendarColor } from "../types";

export const CALENDAR_COLOR_OPTIONS: { key: CalendarColor; label: string; swatch: string }[] = [
  { key: "primary", label: "Verde salvia", swatch: colors.primary },
  { key: "habit", label: "Azul", swatch: colors.habit },
  { key: "positive", label: "Verde", swatch: colors.positive },
  { key: "hobby", label: "Naranja", swatch: colors.hobby },
  { key: "warning", label: "Amarillo", swatch: colors.warning },
  { key: "negative", label: "Rojo", swatch: colors.negative },
  { key: "secondary", label: "Arena", swatch: colors.secondary },
  { key: "muted", label: "Gris", swatch: withAlpha(colors.mutedForeground, 0.5) },
];

export const CALENDAR_COLOR_CLASSES: Record<CalendarColor, { swatch: string; cellBg: string; cellBorder: string }> = {
  primary: { swatch: colors.primary, cellBg: withAlpha(colors.primary, 0.25), cellBorder: withAlpha(colors.primary, 0.5) },
  habit: { swatch: colors.habit, cellBg: withAlpha(colors.habit, 0.25), cellBorder: withAlpha(colors.habit, 0.5) },
  positive: { swatch: colors.positive, cellBg: withAlpha(colors.positive, 0.25), cellBorder: withAlpha(colors.positive, 0.5) },
  hobby: { swatch: colors.hobby, cellBg: withAlpha(colors.hobby, 0.25), cellBorder: withAlpha(colors.hobby, 0.5) },
  warning: { swatch: colors.warning, cellBg: withAlpha(colors.warning, 0.25), cellBorder: withAlpha(colors.warning, 0.5) },
  negative: { swatch: colors.negative, cellBg: withAlpha(colors.negative, 0.2), cellBorder: withAlpha(colors.negative, 0.5) },
  secondary: { swatch: colors.secondary, cellBg: withAlpha(colors.secondary, 0.7), cellBorder: colors.secondary },
  muted: { swatch: withAlpha(colors.mutedForeground, 0.5), cellBg: colors.muted, cellBorder: colors.border },
};

// Mismos 8 tokens, pero como acento de tarjeta (fondo tenue + texto sólido) en vez de "celda
// pintada" — puerto de EVENT_CATEGORY_COLOR_CLASSES en dashboard/src/utils/calendarColors.ts,
// reutilizando los mismos `*Tint` que ya existían para esto en theme.ts (antes solo para
// `eventTypeStyle`, ahora también para colorear por EventCategory — ver utils/eventCategories.ts).
export const EVENT_CATEGORY_COLOR_STYLES: Record<CalendarColor, { bg: string; text: string }> = {
  primary: { bg: colors.primaryTint, text: colors.primary },
  habit: { bg: colors.habitTint, text: colors.habit },
  positive: { bg: colors.positiveTint, text: colors.positive },
  hobby: { bg: colors.hobbyTint, text: colors.hobby },
  warning: { bg: colors.warningTint, text: colors.warning },
  negative: { bg: colors.negativeTint, text: colors.negative },
  secondary: { bg: colors.secondary, text: colors.secondaryForeground },
  muted: { bg: colors.muted, text: colors.mutedForeground },
};
