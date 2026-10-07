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
  { key: "proyectos", label: "Proyectos", description: "Checklist de tareas para seguir algo.", icon: "📁" },
  { key: "objetivos", label: "Objetivos", description: "Metas con barra de progreso.", icon: "🎯" },
  { key: "agenda", label: "Agenda", description: "Notas sueltas con fecha.", icon: "📅" },
  { key: "hoy", label: "Lista", description: "Checklist rápido para el día.", icon: "☀️" },
  { key: "viajes", label: "Planificador de viajes o rutas", description: "Viajes con itinerario y presupuesto, y lugares guardados.", icon: "✈️" },
];

export const CUSTOM_PAGE_TEMPLATE_META: Record<CustomPageTemplate, CustomPageTemplateMeta> = Object.fromEntries(
  CUSTOM_PAGE_TEMPLATES.map((t) => [t.key, t])
) as Record<CustomPageTemplate, CustomPageTemplateMeta>;
