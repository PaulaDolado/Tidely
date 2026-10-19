// Cliente REST directo para "Páginas personalizadas" — mismo criterio que src/api/finance.ts,
// src/api/goals.ts y src/api/schedule.ts: CustomPage no forma parte del contrato de sync offline
// del backend (API.md lo lista explícitamente, "incluida la plantilla galería"), así que esta
// pantalla no pasa por SQLite y necesita conexión, igual que
// `dashboard/src/pages/CustomPagePage.tsx`.
import { api } from "./client";

// Las 8 plantillas de `CUSTOM_PAGE_TEMPLATES` en dashboard/src/utils/customPageTemplates.ts ya
// tienen todas editor propio en el móvil (ver PaginaDetailScreen.tsx) — "hoy" reutiliza el mismo
// componente que "proyectos" (mismo tipo ChecklistContent, igual que en la propia web).
export const CUSTOM_PAGE_TEMPLATES = ["nota", "kanban", "galeria", "finanzas", "proyectos", "objetivos", "agenda", "hoy", "viajes", "estudio", "recetas"] as const;
export type CustomPageTemplate = (typeof CUSTOM_PAGE_TEMPLATES)[number];

export const TEMPLATE_LABELS: Record<CustomPageTemplate, string> = {
  nota: "Nota en blanco",
  kanban: "Kanban",
  galeria: "Galería",
  finanzas: "Finanzas",
  proyectos: "Libreta",
  objetivos: "Objetivos",
  agenda: "Agenda",
  hoy: "Lista",
  viajes: "Viajes o rutas",
  estudio: "Estudio",
  recetas: "Recetas",
};

// Icono por defecto de cada plantilla (se muestra mientras el usuario no elija uno propio, ver
// PaginaDetailScreen.tsx) — mismos emojis que CUSTOM_PAGE_TEMPLATE_META en
// dashboard/src/utils/customPageTemplates.ts.
export const TEMPLATE_ICONS: Record<CustomPageTemplate, string> = {
  nota: "📝",
  kanban: "🗂️",
  galeria: "🖼️",
  finanzas: "💰",
  proyectos: "📁",
  objetivos: "🎯",
  agenda: "📅",
  hoy: "☀️",
  viajes: "✈️",
  estudio: "📚",
  recetas: "🍲",
};

// Paleta rápida del selector de icono de la página (ver "Cambiar icono" en PaginaDetailScreen.tsx)
// — mismos emojis que PAGE_ICON_OPTIONS en dashboard/src/pages/CustomPagePage.tsx.
export const PAGE_ICON_OPTIONS = ["📝", "🗂️", "🖼️", "💰", "📁", "🎯", "📅", "☀️", "⭐", "✅", "📌", "📚", "💡", "🔥", "❤️", "🏆"];

export interface CustomPageSummary {
  id: number;
  title: string;
  subtitle: string | null;
  icon: string | null;
  template: CustomPageTemplate;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface GalleryEntry {
  id: string; // uuid generado en el cliente (expo-crypto), no es una fila de servidor
  title?: string;
  text?: string;
  imageData?: string | null; // data URL base64 embebida, igual que KanbanCard.image en la web
}

export interface GalleryContent {
  items: GalleryEntry[];
}

// Mismo tipo que CustomPageContentMap["nota"] en dashboard/src/types.ts — el móvil edita este
// `html` con el mismo editor enriquecido que la web (ver components/RichTextEditor.tsx).
export interface NotaContent {
  html: string;
}

// Propiedades personalizadas de un tablero kanban (CustomFieldDef/CustomFieldValues en
// dashboard/src/types.ts) — mismo concepto que PlannerField en api/planner.ts, pero aquí `id` es
// un uuid generado en el cliente (expo-crypto), no un id entero de servidor: no tienen tabla ni
// API propia, viven tal cual dentro del JSON de `content` (ver PaginaDetailScreen.tsx, sección
// "Propiedades personalizadas" del kanban, para la UI de crearlas/editarlas). El PUT sustituye el
// `content` entero (ver src/services/customPagesService.ts), así que hay que mandar siempre
// `fieldDefs` y `card.fields` de vuelta junto con `columns` para no perder lo que ya hubiera
// (creado desde la web o desde el propio móvil).
export type CustomFieldType = "text" | "number" | "date" | "select";
export interface CustomFieldDef {
  id: string;
  name: string;
  type: CustomFieldType;
  options?: string[];
}
export type CustomFieldValue = string | number | null;
export type CustomFieldValues = Record<string, CustomFieldValue>;

export interface KanbanCard {
  id: string;
  text: string;
  image?: string | null;
  description?: string;
  notes?: string | null;
  fields?: CustomFieldValues;
  // Con imagen, la pinta como miniatura a la izquierda en vez de a ancho completo encima (ver
  // KanbanCardItem en dashboard/src/pages/CustomPagePage.tsx). Vive dentro del JSON de `content`
  // como el resto de campos de la tarjeta, así que no necesita nada del lado del sync.
  compact?: boolean;
}

export interface KanbanColumn {
  id: string;
  title: string;
  cards: KanbanCard[];
}

export interface KanbanContent {
  columns: KanbanColumn[];
  fieldDefs?: CustomFieldDef[];
}

// Mismo tipo que CustomPageContentMap["finanzas"] en dashboard/src/types.ts — ingresos/gastos
// propios de la página, no tocan el modelo Transaction real de la sección Finanzas de la app.
export interface FinanceEntry {
  id: string;
  type: "income" | "expense";
  amount: number;
  category: string;
  description: string;
}
export interface FinanceContent {
  entries: FinanceEntry[];
}

// Checklist plano (solo texto + hecho, sin fecha límite ni prioridad) — compartido por las
// plantillas "proyectos" y "hoy" en la web (mismo tipo, mismo componente `ChecklistTemplate`).
export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}
export interface ChecklistContent {
  items: ChecklistItem[];
}

// Objetivo propio de la página (sin unidad/periodo/bonificación, a diferencia del modelo Goal
// real de la sección Objetivos) — el progreso solo avanza de uno en uno (ver GoalsTemplateEditor).
export interface SimpleGoal {
  id: string;
  title: string;
  target: number;
  current: number;
}
export interface GoalsContent {
  goals: SimpleGoal[];
}

// Nota suelta con fecha, propia de la página (no toca Event/Note reales) — mismo tipo que
// CustomPageContentMap["agenda"] en dashboard/src/types.ts.
export interface AgendaNote {
  id: string;
  date: string; // YYYY-MM-DD
  text: string;
}
export interface AgendaContent {
  items: AgendaNote[];
}

// Plantilla "viajes" — mismos tipos que Trip/SavedPlace/TravelItineraryItem en
// dashboard/src/types.ts (todo vive dentro del JSON de `content`, ids = uuid del cliente).
export interface TravelItineraryItem {
  id: string;
  date: string; // YYYY-MM-DD
  // Nombre de la actividad o, si `kind` es "place", el del lugar al añadirlo (por si se borra después).
  title: string;
  notes?: string; // LEGADO: antes la única nota libre de una actividad
  // "activity" (por defecto, también las antiguas) o "place" = visita a un lugar guardado del viaje
  // (Trip.places, por `placeId`). Mismos campos que TravelItineraryItem en dashboard/src/types.ts.
  kind?: "activity" | "place";
  url?: string;
  pricePerPerson?: number | null; // EUR
  description?: string;
  placeId?: string;
}
export interface Trip {
  id: string;
  destination: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD, nunca anterior a startDate
  imageData?: string | null;
  notes?: string;
  budget?: number | null; // EUR
  itinerary: TravelItineraryItem[];
  places?: SavedPlace[]; // lugares guardados DE este viaje
  // Opcionales para que las páginas antiguas sigan funcionando: leer siempre con `?? []`.
  packing?: PackingItem[]; // "Qué llevar"
  transport?: TransportDetail[]; // "Detalles del transporte"
  contacts?: TripContact[]; // "Contactos importantes"
}
export interface PackingItem {
  id: string;
  text: string;
  packed?: boolean;
}
export type TransportType = "flight" | "train" | "bus" | "boat" | "car" | "other";
export interface TripAttachment {
  id: string;
  name: string;
  mime: string;
  size: number; // bytes del archivo original
  dataUrl: string; // "data:<mime>;base64,<...>"
}
export interface TransportDetail {
  id: string;
  type: TransportType;
  title?: string; // p. ej. "Madrid → Lisboa"
  date: string; // fecha de SALIDA, YYYY-MM-DD
  departureTime?: string; // "HH:MM"
  arrivalDate?: string; // YYYY-MM-DD, solo si llega otro día distinto de `date`
  arrivalTime?: string; // "HH:MM"
  details?: string; // operador, nº de vuelo/tren, asiento, reserva, terminal…
  attachments?: TripAttachment[];
  needsTransfer?: boolean; // este tramo necesita un transbordo después
  transferPlace?: string; // dónde es el transbordo (estación, aeropuerto…)
  nextId?: string; // id del TransportDetail (del mismo viaje) que continúa a este
}
export interface TripContact {
  id: string;
  name: string;
  location?: string;
  phone?: string;
  email?: string;
}
export interface SavedPlace {
  id: string;
  name: string;
  url?: string;
  description?: string;
  thumbnailUrl?: string | null; // imagen de la página (og:image), vía /link-preview
  faviconUrl?: string | null;
  imageData?: string | null; // foto subida a mano (lugares antiguos)
  favorite?: boolean;
}
export interface TravelContent {
  trips: Trip[];
  // LEGADO: antes los lugares eran comunes a todos los viajes de la página; ahora van dentro de cada
  // viaje (ver normalizeTravelContent en utils/travel.ts).
  places?: SavedPlace[];
}

// Plantilla "estudio" — mismos tipos que en dashboard/src/types.ts (todo vive dentro del JSON de
// `content`, ids = uuid del cliente). El tiempo real se guarda en SEGUNDOS (spentSeconds) aunque la
// tabla lo muestre como H:MM; el asignado va en minutos (0 = sin tiempo asignado).
export interface StudyTopic {
  id: string;
  name: string;
  done?: boolean;
}
export interface StudySubject {
  id: string;
  name: string;
  topics: StudyTopic[];
}
export type StudyKind = "study" | "exercises";
export interface StudyPlanRow {
  id: string;
  subjectId: string;
  topicId?: string;
  topicName: string; // texto del tema (si hay topicId, el nombre vivo del tema manda)
  kind: StudyKind;
  plannedMinutes: number;
  spentSeconds: number;
}
export interface StudyExam {
  id: string;
  title: string;
  subjectId?: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:MM
  done?: boolean;
}
export interface StudyContent {
  subjects: StudySubject[];
  plan: StudyPlanRow[];
  exams: StudyExam[];
}

// Plantilla "recetas" — mismos tipos que en dashboard/src/types.ts: un archivador con pestañas editables y, en
// cada una, sus tarjetas de receta (ids = uuid del cliente; las cuatro pestañas de partida tienen ids fijos, ver
// utils/recipes.ts). Raciones y tiempo son texto libre ("4", "45 min").
export type RecipeDifficulty = "facil" | "media" | "dificil";
export interface RecipeTab {
  id: string;
  name: string;
}
export interface Recipe {
  id: string;
  tabId: string;
  name: string;
  servings: string;
  time: string;
  difficulty: RecipeDifficulty | null;
  ingredients: string[];
  steps: string[];
  tips: string;
}
export interface RecipesContent {
  tabs: RecipeTab[];
  recipes: Recipe[];
}

export type CustomPageContent =
  | RecipesContent
  | StudyContent
  | GalleryContent
  | NotaContent
  | KanbanContent
  | FinanceContent
  | ChecklistContent
  | GoalsContent
  | AgendaContent
  | TravelContent
  | Record<string, unknown>;

export interface CustomPage extends CustomPageSummary {
  content: CustomPageContent;
}

// Plantillas que tienen su propio apartado opcional en el menú principal (la clave de
// user.enabledSections es la misma que la de la plantilla): por debajo siguen siendo páginas
// personalizadas, pero el menú abre siempre "la principal" en vez de listarlas como "Tus páginas".
export const SECTION_PAGE_TEMPLATES = ["galeria", "viajes", "estudio", "recetas"] as const;
export type SectionPageTemplate = (typeof SECTION_PAGE_TEMPLATES)[number];

// Orden estable para decidir cuál es "la principal": por `order` y, a igualdad, por id. Los ids son
// numéricos (servidor) o uuid (páginas creadas offline, aún sin sincronizar), de ahí la comparación mixta.
function comparePrimary(a: { order: number; id: number | string }, b: { order: number; id: number | string }): number {
  if (a.order !== b.order) return a.order - b.order;
  const na = Number(a.id);
  const nb = Number(b.id);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return String(a.id).localeCompare(String(b.id));
}

/** La página que abre el apartado de esa plantilla: la primera por `order` y, si empatan, por id. */
export function primaryPageOf<P extends { template: string; order: number; id: number | string }>(
  pages: P[],
  template: string
): P | null {
  const candidates = pages.filter((p) => p.template === template);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, p) => (comparePrimary(p, best) < 0 ? p : best));
}

/** Páginas que NO deben salir en "Tus páginas"/la lista porque ya tienen su apartado en el menú: todas
 * las de galería (siempre, como hasta ahora) y solo la principal de viajes/estudio, y solo mientras
 * su apartado esté activo — si el usuario lo desactiva, esa página reaparece en la lista para seguir
 * siendo alcanzable. Las demás páginas de viajes/estudio se quedan listadas. */
export function hiddenSectionPageIds<P extends { template: string; order: number; id: number | string }>(
  pages: P[],
  enabledSections: { has(section: string): boolean }
): Set<P["id"]> {
  const hidden = new Set<P["id"]>();
  for (const p of pages) if (p.template === "galeria") hidden.add(p.id);
  for (const template of ["viajes", "estudio", "recetas"] as const) {
    if (!enabledSections.has(template)) continue;
    const primary = primaryPageOf(pages, template);
    if (primary) hidden.add(primary.id);
  }
  return hidden;
}

export async function listCustomPages(): Promise<CustomPageSummary[]> {
  const res = await api.get<{ pages: CustomPageSummary[] }>("/custom-pages");
  return res.pages;
}

export const getCustomPage = (id: number) => api.get<CustomPage>(`/custom-pages/${id}`);
export const createCustomPage = (title: string, template: CustomPageTemplate) => api.post<CustomPage>("/custom-pages", { title, template });
export const deleteCustomPage = (id: number) => api.delete<{ message: string }>(`/custom-pages/${id}`);
export const moveCustomPage = (id: number, direction: "up" | "down") => api.put<CustomPageSummary>(`/custom-pages/${id}/move`, { direction });

export const updateCustomPage = (
  id: number,
  patch: { title?: string; subtitle?: string | null; icon?: string | null; content?: CustomPageContent }
) => api.put<CustomPage>(`/custom-pages/${id}`, patch);
