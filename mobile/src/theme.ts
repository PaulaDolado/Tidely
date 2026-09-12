// Tokens de diseño — puerto directo de la paleta/tipografía del dashboard web
// (dashboard/src/styles.css: bloque `:root` y los `[data-theme="..."]`) a valores RGB/hex que
// React Native entiende. Ahora hay 5 temas (Ajustes > General > Apariencia, ver
// ThemeContext.tsx): "sistema" son los valores de siempre (sin cambios, sigue el claro/oscuro del
// dispositivo), "basico"/"oscuro" son la paleta neutra estilo Apple (par claro/oscuro) y
// "salvia"/"espresso" son las dos paletas de marca (verde/crema y marrón café). Mismos hex que sus
// equivalentes `[data-theme]` en styles.css — si cambian ahí, cambian aquí también.
//
// `colors` sigue siendo el MISMO objeto de siempre en cuanto a forma de uso (`import { colors }
// from "../theme"; colors.background`) — las ~26 pantallas/componentes que ya lo importan así no
// cambian ni una línea. Lo que cambia es que ahora es MUTABLE: cambiar de tema (ver
// ThemeContext.applyTheme) reasigna sus propiedades in-place (mismo objeto, mismo `import`), y
// ThemeProvider fuerza un remount de toda la pantalla actual (con un `key`) para que cada
// componente vuelva a leer `colors.*` con los valores nuevos — sin eso, mutar el objeto no
// bastaría para que React repintara nada.
//
// Los tonos por tipo de evento/prioridad replican `TYPE_STYLES`/`PRIORITY_STYLES` de
// dashboard/src/pages/AgendaPage.tsx y PlanificadorPage.tsx: fondo al 15% de opacidad del color +
// texto en el color sólido — de ahí los `*Tint` en rgba (RN no tiene el `bg-x/15` de Tailwind).

export type Theme = "sistema" | "basico" | "oscuro" | "salvia" | "espresso";

export const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: "sistema", label: "Sistema" },
  { value: "basico", label: "Básico" },
  { value: "oscuro", label: "Oscuro" },
  { value: "salvia", label: "Salvia" },
  { value: "espresso", label: "Espresso" },
];

export interface ColorPalette {
  background: string;
  card: string;
  foreground: string;
  mutedForeground: string;
  muted: string;
  border: string;
  inputBorder: string;
  primary: string;
  primaryForeground: string;
  primaryTint: string;
  secondary: string;
  secondaryForeground: string;
  destructive: string;
  destructiveForeground: string;
  destructiveTint: string;
  // Distinto de `destructive` a propósito: `destructive` es la señal real de peligro (botones de
  // borrar, errores); `negative` es solo una opción más del selector de color de categorías/
  // leyenda anual ("Rojo" en CALENDAR_COLOR_OPTIONS) — en todos los temas valen lo mismo salvo en
  // "espresso", donde `negative` se vuelve marrón para no desentonar con el resto de opciones.
  negative: string;
  negativeTint: string;
  positive: string;
  positiveTint: string;
  warning: string;
  warningTint: string;
  hobby: string;
  hobbyTint: string;
  habit: string;
  habitTint: string;
  cover: string;
  coverTint: string;
}

export function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Los 7 acentos siempre llevan la misma versión "tinte al 15%" derivada de su color sólido — se
// calcula aquí en vez de escribirla a mano en cada paleta (menos sitio donde equivocarse el rgba).
type PaletteBase = Omit<
  ColorPalette,
  | "primaryTint"
  | "destructiveTint"
  | "negativeTint"
  | "positiveTint"
  | "warningTint"
  | "hobbyTint"
  | "habitTint"
  | "coverTint"
>;

function buildPalette(base: PaletteBase): ColorPalette {
  return {
    ...base,
    primaryTint: withAlpha(base.primary, 0.15),
    destructiveTint: withAlpha(base.destructive, 0.15),
    negativeTint: withAlpha(base.negative, 0.15),
    positiveTint: withAlpha(base.positive, 0.15),
    warningTint: withAlpha(base.warning, 0.15),
    hobbyTint: withAlpha(base.hobby, 0.15),
    habitTint: withAlpha(base.habit, 0.15),
    coverTint: withAlpha(base.cover, 0.15),
  };
}

export const PALETTES: Record<Theme, ColorPalette> = {
  // El tema de siempre — mismos valores exactos que llevaba `colors` antes de que existieran los
  // temas, ver el comentario original más abajo (--paper/--sage/--charcoal... de styles.css).
  sistema: buildPalette({
    background: "#F7F4F1",
    card: "#FFFFFF",
    foreground: "#2D2926",
    mutedForeground: "#6D6864",
    muted: "#F0ECE9",
    border: "rgba(45,41,38,0.1)",
    inputBorder: "rgba(45,41,38,0.12)",
    primary: "#5F7161",
    primaryForeground: "#FBFAF7",
    secondary: "#DED0B6",
    secondaryForeground: "#2D2926",
    destructive: "#BD4334",
    destructiveForeground: "#FBFAF7",
    negative: "#BD4334",
    positive: "#5F7161",
    warning: "#C87B00",
    hobby: "#FB923C",
    habit: "#3383AD",
    cover: "#4D3F35",
  }),

  // Neutra estilo Apple (System Colors de iOS/macOS: azul de acento, grises neutros).
  basico: buildPalette({
    background: "#F2F2F7",
    card: "#FFFFFF",
    foreground: "#1C1C1E",
    mutedForeground: "#6E6E73",
    muted: "#E5E5EA",
    border: "rgba(0,0,0,0.1)",
    inputBorder: "rgba(0,0,0,0.12)",
    primary: "#007AFF",
    primaryForeground: "#FFFFFF",
    secondary: "#E5E5EA",
    secondaryForeground: "#1C1C1E",
    destructive: "#FF3B30",
    destructiveForeground: "#FFFFFF",
    negative: "#FF3B30",
    positive: "#34C759",
    warning: "#FFCC00",
    hobby: "#FF9500",
    habit: "#5856D6",
    cover: "#A2845E",
  }),

  // Contrapartida oscura de "Básico" — mismo acento azul, System Colors en su variante dark.
  oscuro: buildPalette({
    background: "#000000",
    card: "#1C1C1E",
    foreground: "#F2F2F7",
    mutedForeground: "#98989D",
    muted: "#2C2C2E",
    border: "rgba(255,255,255,0.12)",
    inputBorder: "rgba(255,255,255,0.16)",
    primary: "#0A84FF",
    primaryForeground: "#FFFFFF",
    secondary: "#2C2C2E",
    secondaryForeground: "#F2F2F7",
    destructive: "#FF453A",
    destructiveForeground: "#FFFFFF",
    negative: "#FF453A",
    positive: "#30D158",
    warning: "#FFD60A",
    hobby: "#FF9F0A",
    habit: "#5E5CE6",
    cover: "#AC8E68",
  }),

  // Tonos verdes/oliva y crema.
  salvia: buildPalette({
    background: "#F9EAD2",
    card: "#FFFBF3",
    foreground: "#322D1C",
    mutedForeground: "#837534",
    muted: "#F3E9D6",
    border: "rgba(50,45,28,0.12)",
    inputBorder: "rgba(50,45,28,0.15)",
    primary: "#4F5127",
    primaryForeground: "#FBF6EA",
    secondary: "#F8EEC2",
    secondaryForeground: "#322D1C",
    destructive: "#C06B69",
    destructiveForeground: "#FFFBF3",
    negative: "#C06B69",
    positive: "#6B6E35",
    warning: "#C9A227",
    hobby: "#DB918F",
    // Único tono frío de la paleta (igual criterio que --habit en styles.css) — se mantiene
    // aunque el resto de esta paleta sea cálida, para que Hábitos se siga distinguiendo.
    habit: "#6E8FA3",
    cover: "#837534",
  }),

  // Tonos marrón café — fondo casi negro con acentos cálidos, no el gris frío de "Oscuro".
  espresso: buildPalette({
    background: "#160C06",
    card: "#332116",
    foreground: "#F3E4D3",
    mutedForeground: "#C9AF9C",
    muted: "#5C402F",
    border: "rgba(243,228,211,0.14)",
    inputBorder: "rgba(243,228,211,0.18)",
    primary: "#C89674",
    primaryForeground: "#2A1B10",
    secondary: "#91664A",
    secondaryForeground: "#F3E4D3",
    // destructive se queda en su rojo-teja de siempre (peligro real: borrar, error) — ver el
    // comentario de `negative` en la interfaz ColorPalette más arriba.
    destructive: "#C1503B",
    destructiveForeground: "#F3E4D3",
    // Los 7 colores seleccionables (categorías, leyenda del calendario anual, placeholders de
    // Galería, tapa de libretas/proyectos) pasan a una única rampa de marrones — como la paleta
    // de referencia (caramelo → moca → corteza) — en vez del naranja/verde/azul/dorado de siempre.
    negative: "#6E4E3B",
    positive: "#805D46",
    warning: "#A4795D",
    hobby: "#B68868",
    habit: "#926B52",
    cover: "#91664A",
  }),
};

// Mutable a propósito (sin `as const`, sin `Object.freeze`): ver el comentario de cabecera de
// este fichero — `applyPalette` reasigna sus propiedades in-place para que las pantallas, que ya
// importan este mismo objeto por nombre, vean el tema nuevo sin cambiar su forma de leerlo.
export const colors: ColorPalette = { ...PALETTES.sistema };

export function applyPalette(palette: ColorPalette): void {
  Object.assign(colors, palette);
}

export const radius = {
  input: 12, // rounded-xl
  card: 24, // rounded-3xl (.card-soft)
  full: 999, // rounded-full — pills, chips, botones
} as const;

// Aproximación RN (shadowColor/Offset/Opacity/Radius + elevation en Android) de
// `--shadow-soft` en styles.css: dos sombras muy sutiles teñidas de charcoal, no negro puro. No
// varía por tema (a diferencia de `colors`) — es un efecto sutil y una sola sombra fija se sigue
// leyendo bien sobre cualquiera de los 5 fondos.
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
