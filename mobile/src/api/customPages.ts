// Cliente REST directo para "Páginas personalizadas" — mismo criterio que src/api/finance.ts,
// src/api/goals.ts y src/api/schedule.ts: CustomPage no forma parte del contrato de sync offline
// del backend (API.md lo lista explícitamente, "incluida la plantilla galería"), así que esta
// pantalla no pasa por SQLite y necesita conexión, igual que
// `dashboard/src/pages/CustomPagePage.tsx`.
import { api } from "./client";

// Las 8 plantillas de `CUSTOM_PAGE_TEMPLATES` en dashboard/src/utils/customPageTemplates.ts ya
// tienen todas editor propio en el móvil (ver PaginaDetailScreen.tsx) — "hoy" reutiliza el mismo
// componente que "proyectos" (mismo tipo ChecklistContent, igual que en la propia web).
export const CUSTOM_PAGE_TEMPLATES = ["nota", "kanban", "galeria", "finanzas", "proyectos", "objetivos", "agenda", "hoy"] as const;
export type CustomPageTemplate = (typeof CUSTOM_PAGE_TEMPLATES)[number];

export const TEMPLATE_LABELS: Record<CustomPageTemplate, string> = {
  nota: "Nota en blanco",
  kanban: "Kanban",
  galeria: "Galería",
  finanzas: "Finanzas",
  proyectos: "Proyectos",
  objetivos: "Objetivos",
  agenda: "Agenda",
  hoy: "Hoy",
};

export interface CustomPageSummary {
  id: number;
  title: string;
  subtitle: string | null;
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
// `html` como texto plano (ver utils/htmlText.ts), no con un editor enriquecido.
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

export type CustomPageContent =
  | GalleryContent
  | NotaContent
  | KanbanContent
  | FinanceContent
  | ChecklistContent
  | GoalsContent
  | AgendaContent
  | Record<string, unknown>;

export interface CustomPage extends CustomPageSummary {
  content: CustomPageContent;
}

export async function listCustomPages(): Promise<CustomPageSummary[]> {
  const res = await api.get<{ pages: CustomPageSummary[] }>("/custom-pages");
  return res.pages;
}

export const getCustomPage = (id: number) => api.get<CustomPage>(`/custom-pages/${id}`);
export const createCustomPage = (title: string, template: CustomPageTemplate) => api.post<CustomPage>("/custom-pages", { title, template });
export const deleteCustomPage = (id: number) => api.delete<{ message: string }>(`/custom-pages/${id}`);
export const moveCustomPage = (id: number, direction: "up" | "down") => api.put<CustomPageSummary>(`/custom-pages/${id}/move`, { direction });

export const updateCustomPage = (id: number, patch: { title?: string; subtitle?: string | null; content?: CustomPageContent }) =>
  api.put<CustomPage>(`/custom-pages/${id}`, patch);
