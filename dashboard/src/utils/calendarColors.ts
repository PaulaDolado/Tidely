import { CalendarColor } from "../types";

// Los 8 colores que ofrece la leyenda del calendario anual son exactamente los tokens de diseño
// ya definidos en styles.css (--color-primary, --color-habit, --color-positive...) — así
// cualquier categoría que el usuario invente ("Vacances", "Recuperacions"...) sigue encajando
// visualmente con el resto de la app en vez de traer colores sueltos como en la imagen de
// referencia. Las clases van escritas literales (no `bg-${color}`) porque Tailwind solo genera
// CSS para clases que aparecen tal cual en el código fuente.
export const CALENDAR_COLOR_OPTIONS: { key: CalendarColor; label: string; swatch: string }[] = [
  { key: "primary", label: "Verde salvia", swatch: "bg-primary" },
  { key: "habit", label: "Azul", swatch: "bg-habit" },
  { key: "positive", label: "Verde", swatch: "bg-positive" },
  { key: "hobby", label: "Naranja", swatch: "bg-hobby" },
  { key: "warning", label: "Amarillo", swatch: "bg-warning" },
  { key: "negative", label: "Rojo", swatch: "bg-negative" },
  { key: "secondary", label: "Arena", swatch: "bg-secondary" },
  { key: "muted", label: "Gris", swatch: "bg-muted-foreground/50" },
];

export const CALENDAR_COLOR_CLASSES: Record<CalendarColor, { swatch: string; cellBg: string; cellBorder: string }> = {
  primary: { swatch: "bg-primary", cellBg: "bg-primary/25", cellBorder: "border-primary/50" },
  habit: { swatch: "bg-habit", cellBg: "bg-habit/25", cellBorder: "border-habit/50" },
  positive: { swatch: "bg-positive", cellBg: "bg-positive/25", cellBorder: "border-positive/50" },
  hobby: { swatch: "bg-hobby", cellBg: "bg-hobby/25", cellBorder: "border-hobby/50" },
  warning: { swatch: "bg-warning", cellBg: "bg-warning/25", cellBorder: "border-warning/50" },
  negative: { swatch: "bg-negative", cellBg: "bg-negative/20", cellBorder: "border-negative/50" },
  secondary: { swatch: "bg-secondary", cellBg: "bg-secondary/70", cellBorder: "border-secondary" },
  muted: { swatch: "bg-muted-foreground/50", cellBg: "bg-muted", cellBorder: "border-border" },
};

// Mismos 8 tokens, pero pensados como acento de tarjeta (fondo muy suave + texto del mismo tono)
// en vez de "celda pintada" — las usa EventCard (AgendaPage/HoyPage) para colorear un evento
// según su categoría (ver EventCategory en types.ts). "secondary" y "muted" llevan un tratamiento
// algo distinto (fondo sólido/tenue + texto neutro) porque su versión "/15 + texto" quedaba
// demasiado floja para leerse bien en una tarjeta pequeña.
export const EVENT_CATEGORY_COLOR_CLASSES: Record<CalendarColor, string> = {
  primary: "bg-primary/15 text-primary",
  habit: "bg-habit/15 text-habit",
  positive: "bg-positive/15 text-positive",
  hobby: "bg-hobby/15 text-hobby",
  warning: "bg-warning/15 text-warning",
  negative: "bg-negative/15 text-negative",
  secondary: "bg-secondary/70 text-foreground",
  muted: "bg-muted text-muted-foreground",
};
