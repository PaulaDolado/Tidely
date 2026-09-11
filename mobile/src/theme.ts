// Tokens de diseño — puerto directo de la paleta/tipografía del dashboard web
// (dashboard/src/styles.css, bloque `:root` en OKLCH) a valores RGB que React Native entiende.
// Un solo tema claro: la web tampoco tiene modo oscuro (ver ese mismo fichero), así que no hace
// falta prever una segunda paleta aquí.
//
// Los tonos por tipo de evento/prioridad replican `TYPE_STYLES`/`PRIORITY_STYLES` de
// dashboard/src/pages/AgendaPage.tsx y PlanificadorPage.tsx: fondo al 15% de opacidad del color +
// texto en el color sólido — de ahí los `*Tint` en rgba (RN no tiene el `bg-x/15` de Tailwind).

export const colors = {
  background: "#F7F4F1", // --paper
  card: "#FFFFFF", // --surface
  foreground: "#2D2926", // --charcoal (texto principal)
  mutedForeground: "#6D6864", // --muted-foreground (texto secundario/labels)
  muted: "#F0ECE9", // --muted (chip/badge neutro)
  border: "rgba(45,41,38,0.1)", // --border (charcoal @10%)
  inputBorder: "rgba(45,41,38,0.12)", // --input (charcoal @12%)

  primary: "#5F7161", // --sage (marca/acento)
  primaryForeground: "#FBFAF7",
  primaryTint: "rgba(95,113,97,0.15)",

  secondary: "#DED0B6", // --sand
  secondaryForeground: "#2D2926",

  destructive: "#BD4334", // --negative
  destructiveForeground: "#FBFAF7",
  destructiveTint: "rgba(189,67,52,0.15)",

  positive: "#5F7161", // mismo tono que --sage en la web
  positiveTint: "rgba(95,113,97,0.15)",

  warning: "#C87B00",
  warningTint: "rgba(200,123,0,0.15)",

  hobby: "#FB923C",
  hobbyTint: "rgba(251,146,60,0.15)",

  habit: "#3383AD",
  habitTint: "rgba(51,131,173,0.15)",

  cover: "#4D3F35",
  coverTint: "rgba(77,63,53,0.15)",
} as const;

export const radius = {
  input: 12, // rounded-xl
  card: 24, // rounded-3xl (.card-soft)
  full: 999, // rounded-full — pills, chips, botones
} as const;

// Aproximación RN (shadowColor/Offset/Opacity/Radius + elevation en Android) de
// `--shadow-soft` en styles.css: dos sombras muy sutiles teñidas de charcoal, no negro puro.
export const shadow = {
  shadowColor: "#2D2926",
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.1,
  shadowRadius: 16,
  elevation: 3,
} as const;

// "Outfit" (texto/UI) e "Instrument Serif" (títulos) — mismas familias que la web, cargadas vía
// @expo-google-fonts en App.tsx. Los nombres son los que expone expo-font tras `useFonts`.
export const fonts = {
  sans: "Outfit_400Regular",
  sansMedium: "Outfit_500Medium",
  sansSemiBold: "Outfit_600SemiBold",
  sansBold: "Outfit_700Bold",
  serif: "InstrumentSerif_400Regular",
} as const;

/** Mismo mapeo que `PRIORITY_STYLES` en dashboard/src/pages/PlanificadorPage.tsx. */
export function priorityStyle(priority: "low" | "medium" | "high"): { bg: string; text: string } {
  switch (priority) {
    case "medium":
      return { bg: colors.warningTint, text: colors.warning };
    case "high":
      return { bg: colors.destructiveTint, text: colors.destructive };
    default:
      return { bg: colors.muted, text: colors.mutedForeground };
  }
}

/** Mismo criterio que `dueBadge()` en dashboard/src/pages/PlanificadorPage.tsx: vencido/hoy en
 * destructive, ≤2 días en warning, resto/hecha en muted. */
export function dueDateStyle(daysDiff: number, done: boolean): { bg: string; text: string } {
  if (done || daysDiff > 2) return { bg: colors.muted, text: colors.mutedForeground };
  if (daysDiff <= 0) return { bg: colors.destructiveTint, text: colors.destructive };
  return { bg: colors.warningTint, text: colors.warning };
}
