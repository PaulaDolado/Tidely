import { Recipe, RecipeDifficulty, RecipesContent, RecipeTab } from "../types";

// Lógica pura de la plantilla "recetas" (ver RecipeBoxTemplate). La misma lógica vive en mobile/src/utils/recipes.ts:
// si cambias una, cambia la otra.

// Pestañas con las que arranca un archivador nuevo. Los ids son fijos y coinciden con los que pone el servidor al
// crear la página (customPagesService.defaultContent): así un contenido sin pestañas se normaliza igual en todas partes.
export const DEFAULT_RECIPE_TABS: RecipeTab[] = [
  { id: "entrantes", name: "Entrantes" },
  { id: "verduras", name: "Verduras" },
  { id: "carnes", name: "Carnes" },
  { id: "reposteria", name: "Repostería" },
];

export const DIFFICULTIES: RecipeDifficulty[] = ["facil", "media", "dificil"];
export const DIFFICULTY_LABELS: Record<RecipeDifficulty, string> = { facil: "Fácil", media: "Media", dificil: "Difícil" };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const asText = (value: unknown): string => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");
const asLines = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(asText).map((s) => s.trim()).filter(Boolean) : typeof value === "string" ? linesToList(value) : [];

/** Texto de un área de texto (una entrada por línea) a lista, sin líneas vacías ni espacios sobrantes. */
export function linesToList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Deja el contenido guardado con la forma de RecipesContent, sea cual sea lo que llegue (página recién creada,
 * JSON a medio editar desde otro cliente...). Sin `tabs` se usan las de partida; una lista vacía se respeta (el
 * usuario puede haberlas borrado todas). Una receta cuya pestaña ya no existe pasa a la primera.
 */
export function normalizeRecipesContent(content: unknown): RecipesContent {
  const raw = isRecord(content) ? content : {};

  const seen = new Set<string>();
  const tabs: RecipeTab[] = Array.isArray(raw.tabs)
    ? raw.tabs.flatMap((t) => {
        if (!isRecord(t) || typeof t.id !== "string" || !t.id || seen.has(t.id)) return [];
        seen.add(t.id);
        return [{ id: t.id, name: asText(t.name).trim() || "Sin nombre" }];
      })
    : DEFAULT_RECIPE_TABS.map((t) => ({ ...t }));

  const tabIds = new Set(tabs.map((t) => t.id));
  const recipes: Recipe[] = Array.isArray(raw.recipes)
    ? raw.recipes.flatMap((r) => {
        if (!isRecord(r) || typeof r.id !== "string" || !r.id) return [];
        const tabId = typeof r.tabId === "string" && tabIds.has(r.tabId) ? r.tabId : (tabs[0]?.id ?? asText(r.tabId));
        const difficulty = DIFFICULTIES.includes(r.difficulty as RecipeDifficulty) ? (r.difficulty as RecipeDifficulty) : null;
        return [
          {
            id: r.id,
            tabId,
            name: asText(r.name).trim(),
            servings: asText(r.servings).trim(),
            time: asText(r.time).trim(),
            difficulty,
            ingredients: asLines(r.ingredients),
            steps: asLines(r.steps),
            tips: asText(r.tips).trim(),
          },
        ];
      })
    : [];

  return { tabs, recipes };
}

export function emptyRecipe(id: string, tabId: string): Recipe {
  return { id, tabId, name: "", servings: "", time: "", difficulty: null, ingredients: [], steps: [], tips: "" };
}

/** Recetas de una pestaña, por orden alfabético del nombre (como en un fichero de cocina). */
export function recipesInTab(recipes: Recipe[], tabId: string): Recipe[] {
  return recipes
    .filter((r) => r.tabId === tabId)
    .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }) || a.id.localeCompare(b.id));
}

/** Quita una pestaña y todas sus recetas. */
export function removeTab(content: RecipesContent, tabId: string): RecipesContent {
  return { tabs: content.tabs.filter((t) => t.id !== tabId), recipes: content.recipes.filter((r) => r.tabId !== tabId) };
}

/** Mueve una pestaña una posición a la izquierda (-1) o a la derecha (+1); en los extremos no hace nada. */
export function moveTab(tabs: RecipeTab[], tabId: string, delta: -1 | 1): RecipeTab[] {
  const from = tabs.findIndex((t) => t.id === tabId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= tabs.length) return tabs;
  const next = [...tabs];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

// ---------------------------------------------------------------------------------------------------------------
// Dibujo: el patrón de los separadores y la ilustración de la tarjeta. Son geometría, no componentes, para que la
// web (SVG en el DOM / data URI) y el móvil (react-native-svg) pinten exactamente lo mismo.
// ---------------------------------------------------------------------------------------------------------------

/** Estrella de anís: `petals` puntas alternando radio exterior e interior. */
function starPath(cx: number, cy: number, outer: number, inner: number, petals: number, rotation = 0): string {
  const points = Array.from({ length: petals * 2 }, (_, i) => {
    const r = i % 2 === 0 ? outer : inner;
    const a = rotation + (Math.PI * i) / petals;
    return `${(cx + r * Math.sin(a)).toFixed(1)} ${(cy - r * Math.cos(a)).toFixed(1)}`;
  });
  return `M${points.join(" L")} Z`;
}

/**
 * Baldosa del patrón de los separadores del archivador: utensilios y especias pequeños, en un solo color, girados a
 * mano. Ningún dibujo toca los bordes de la baldosa, así que al repetirla no se ven costuras.
 */
export function recipePatternTile(color: string, size = 180): string {
  const c = color;
  const shapes = [
    // varillas
    `<g transform="translate(36 42) rotate(-38)" fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round">` +
      `<path d="M0 -15 C-7 -6 -7 6 0 10 C7 6 7 -6 0 -15 Z"/><path d="M0 -15 C-3 -6 -3 6 0 10 M0 -15 C3 -6 3 6 0 10"/>` +
      `<path d="M0 10 V24" stroke-width="2.6"/></g>`,
    // cuchara de madera
    `<g transform="translate(124 36) rotate(30)" fill="${c}"><ellipse cx="0" cy="-9" rx="4.6" ry="6.8"/>` +
      `<rect x="-1.2" y="-3" width="2.4" height="21" rx="1.2"/></g>`,
    // ramas de canela atadas
    `<g transform="translate(84 96) rotate(-22)" fill="${c}"><rect x="-15" y="-4.6" width="30" height="3.8" rx="1.9"/>` +
      `<rect x="-14" y="0.8" width="28" height="3.8" rx="1.9"/>` +
      `<path d="M-2 -7 V8 M2.2 -7 V8" stroke="${c}" stroke-width="0.9" fill="none"/></g>`,
    // anís estrellado
    `<path d="${starPath(150, 108, 9.5, 3.6, 8)}" fill="${c}"/><circle cx="150" cy="108" r="1.4" fill="#fff" opacity="0.55"/>`,
    `<path d="${starPath(100, 158, 6.5, 2.4, 8, 0.3)}" fill="${c}"/>`,
    // granos de pimienta
    `<g fill="${c}"><circle cx="30" cy="142" r="2.6"/><circle cx="37" cy="147" r="2.3"/><circle cx="27" cy="150" r="2.1"/></g>`,
    // rodaja de cítrico
    `<g transform="translate(40 98)" fill="none" stroke="${c}" stroke-width="1.3"><circle r="7.5"/>` +
      `<path d="M0 -7.5 V7.5 M-6.5 -3.7 L6.5 3.7 M-6.5 3.7 L6.5 -3.7" stroke-width="0.8"/></g>`,
    // rodillo
    `<g transform="translate(150 158) rotate(36)" fill="${c}"><rect x="-10" y="-3.2" width="20" height="6.4" rx="3.2"/>` +
      `<rect x="-16.5" y="-1.2" width="6" height="2.4" rx="1.2"/><rect x="10.5" y="-1.2" width="6" height="2.4" rx="1.2"/></g>`,
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 180 180">${shapes.join("")}</svg>`;
}

/** Trazos a línea de la ilustración de la tarjeta (cazuela, bote, bol con varillas y una tableta), en un viewBox 0 0 160 92. */
export const RECIPE_ILLUSTRATION: { d: string; width?: number; opacity?: number }[] = [
  // cazuela
  { d: "M14 44 H74 V66 Q74 77 63 77 H25 Q14 77 14 66 Z" },
  { d: "M11 44 H77" , width: 1.6 },
  { d: "M14 49 H74", opacity: 0.6 },
  { d: "M14 44 Q44 25 74 44" },
  { d: "M39 33 Q44 26 49 33 M37 33.5 H51" },
  { d: "M14 53 Q5 53 5 57.5 Q5 62 14 62 M74 53 Q83 53 83 57.5 Q83 62 74 62" },
  { d: "M60 55 V73 M64 54 V72 M68 54 V70 M71 54 V67", width: 0.7, opacity: 0.7 },
  { d: "M22 81 H66", width: 0.7, opacity: 0.5 },
  // bote con tapa
  { d: "M92 41 H110 V70 Q110 75 105 75 H97 Q92 75 92 70 Z" },
  { d: "M90 34 H112 V41 H90 Z" },
  { d: "M94 34 V41 M98 34 V41 M102 34 V41 M106 34 V41 M110 34 V41", width: 0.6, opacity: 0.7 },
  { d: "M95 52 H107 V63 H95 Z", width: 0.8 },
  // bol con varillas
  { d: "M116 61 H156 Q152 79 136 79 Q120 79 116 61 Z" },
  { d: "M128 79 Q136 83 144 79", width: 0.8 },
  { d: "M146 54 L158 22", width: 1.6 },
  { d: "M146 54 Q134 52 135 62 M146 54 Q141 57 141 63 M146 54 Q149 58 147 63", width: 0.9 },
  { d: "M147 66 V75 M151 64 V72", width: 0.7, opacity: 0.7 },
  // tableta
  { d: "M58 85 L84 80 L90 85 L64 90 Z", width: 0.9 },
  { d: "M67 84 L72 89 M75 82 L80 87", width: 0.6, opacity: 0.8 },
];
