import { CustomPageTemplate } from "../types";

// Metadatos de cada "modelo" ofrecido en "+ Nueva página" (ver CreatePageModal en AppShell) y
// reutilizados en la cabecera de la página abierta (ver CustomPagePage) — un único sitio para el
// icono/etiqueta/descripción de cada plantilla, para no repetirlos en los dos lugares.
export interface CustomPageTemplateMeta {
  key: CustomPageTemplate;
  label: string;
  description: string;
  icon: string;
}

export const CUSTOM_PAGE_TEMPLATES: CustomPageTemplateMeta[] = [
  { key: "nota", label: "Nota en blanco", description: "Como una libreta: solo texto para escribir libremente.", icon: "📝" },
  { key: "kanban", label: "Kanban", description: "Tablero con columnas y tarjetas.", icon: "🗂️" },
  { key: "galeria", label: "Galería", description: "Fotos y notas en collage, como una pared de marcos.", icon: "🖼️" },
  { key: "finanzas", label: "Finanzas", description: "Ingresos y gastos propios, con balance.", icon: "💰" },
  { key: "proyectos", label: "Libreta", description: "Checklist de tareas para seguir algo.", icon: "📁" },
  { key: "objetivos", label: "Objetivos", description: "Metas con barra de progreso.", icon: "🎯" },
  { key: "agenda", label: "Agenda", description: "Notas sueltas con fecha.", icon: "📅" },
  { key: "hoy", label: "Lista", description: "Checklist rápido para el día.", icon: "☀️" },
  { key: "viajes", label: "Viajes o rutas", description: "Itinerario, presupuesto, lugares guardados, etc.", icon: "✈️" },
  { key: "estudio", label: "Estudio", description: "Asignaturas con tiempo de estudio, cronómetro y exámenes.", icon: "📚" },
  { key: "recetas", label: "Recetas", description: "Recetario en archivador: pestañas y una tarjeta por receta.", icon: "🍲" },
];

export const CUSTOM_PAGE_TEMPLATE_META: Record<CustomPageTemplate, CustomPageTemplateMeta> = Object.fromEntries(
  CUSTOM_PAGE_TEMPLATES.map((t) => [t.key, t])
) as Record<CustomPageTemplate, CustomPageTemplateMeta>;

// Apartados del menú principal que por debajo son una página personalizada (ver AppShell y
// DashboardPage.openSectionPage): la clave es la plantilla Y el apartado de User.enabledSections
// a la vez (coinciden a propósito), y el valor la etiqueta del menú / título de la página que se
// crea la primera vez. El orden es el de aparición por defecto en el menú.
export const SECTION_PAGE_TEMPLATES = ["galeria", "viajes", "estudio"] as const;
export type SectionPageTemplate = (typeof SECTION_PAGE_TEMPLATES)[number];
export const SECTION_PAGE_LABELS: Record<SectionPageTemplate, string> = {
  galeria: "Galería",
  viajes: "Viajes",
  estudio: "Estudio",
};

// La página que abre el apartado de esa plantilla: la primera por `order` (y por id si empatan).
// Es la misma regla en AppShell (qué página ocultar de "Tus páginas") y en DashboardPage (a cuál
// navegar), para que nunca se desincronicen — si no, el menú podría esconder una página y abrir otra.
export function primarySectionPage<T extends { id: number; order: number; template: CustomPageTemplate }>(
  pages: T[],
  template: SectionPageTemplate
): T | null {
  return pages.filter((p) => p.template === template).sort((a, b) => a.order - b.order || a.id - b.id)[0] ?? null;
}
