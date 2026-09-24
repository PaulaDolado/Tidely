// Exportar páginas del cuaderno a PDF o Word, sin depender de librerías pesadas
// (jsPDF/html2canvas, "docx"...): el contenido ya es HTML (viene tal cual del
// RichTextEditor), así que basta con volver a montarlo en un documento HTML aparte con sus
// propios estilos.
//
// - PDF: se abre una ventana nueva con el HTML y se dispara window.print() — el usuario elige
//   "Guardar como PDF" en el diálogo de impresión del navegador. Es la vía más fiable para
//   conservar el formato real (encabezados, listas, checklist, imágenes) sin reimplementar un
//   renderizador de PDF a mano.
// - Word: se genera un .doc (HTML con las cabeceras que Word reconoce, no un .docx real) y se
//   descarga como blob. Word lo abre igual que un documento nativo, con el mismo formato.

import DOMPurify from "dompurify";
import { allGoogleFontsLinkTags } from "./googleFonts";

// Versión instalada de katex (dashboard/package.json) — el documento exportado vive fuera de
// esta página, así que en vez de inyectar el CSS de KaTeX aquí (habría que embeber sus
// tipografías) se enlaza el mismo stylesheet desde un CDN, igual que con Google Fonts.
const KATEX_CSS_URL = "https://cdn.jsdelivr.net/npm/katex@0.16.47/dist/katex.min.css";

interface ExportPage {
  title: string;
  content: string;
}

// Mismos estilos que `.rich-editor` en styles.css, pero como CSS plano: el documento exportado
// no carga Tailwind, así que no puede depender de esas clases.
const SHARED_CONTENT_CSS = `
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; line-height: 1.6; }
  h1.page-title { font-size: 1.8rem; margin: 0 0 0.25rem; }
  p.page-subtitle { color: #6b6b6b; font-size: 0.85rem; margin: 0 0 2rem; }
  .page-content h1 { font-size: 1.5rem; font-weight: 600; margin: 1rem 0 0.5rem; }
  .page-content h2 { font-size: 1.25rem; font-weight: 600; margin: 1rem 0 0.5rem; }
  .page-content h3 { font-size: 1.1rem; font-weight: 600; margin: 0.75rem 0 0.4rem; }
  .page-content p { margin: 0 0 0.75rem; }
  .page-content ul, .page-content ol { padding-left: 1.5rem; margin: 0 0 0.75rem; }
  .page-content blockquote { border-left: 3px solid #ccc; padding-left: 0.75rem; margin: 0.5rem 0; color: #555; font-style: italic; }
  .page-content pre { background: #f2f2f2; padding: 0.6rem 0.8rem; border-radius: 6px; font-family: 'Courier New', monospace; font-size: 0.85rem; overflow-x: auto; }
  .page-content a { color: #2563eb; }
  .page-content img { max-width: 100%; border-radius: 6px; margin: 0.5rem 0; }
  .page-content hr { border: none; border-top: 1px solid #ccc; margin: 1.5rem 0; }
  .page-content ul.todo-list { list-style: none; padding-left: 0; }
  .page-content ul.todo-list li { position: relative; padding-left: 1.6rem; margin: 0.25rem 0; }
  .page-content ul.todo-list li::before { content: ""; position: absolute; left: 0; top: 0.2rem; width: 0.9rem; height: 0.9rem; border: 1.5px solid #999; border-radius: 3px; }
  .page-content ul.todo-list li.todo-checked { color: #888; text-decoration: line-through; }
  .page-content ul.todo-list li.todo-checked::before { content: "\\2713"; background: #16a34a; border-color: #16a34a; color: #fff; font-size: 0.65rem; text-align: center; line-height: 0.9rem; }
  .page-content .callout { display: flex; gap: 0.5rem; background: rgba(0,0,0,0.05); border-radius: 10px; padding: 0.75rem 1rem; margin: 0.5rem 0; }
  .page-content table { border-collapse: collapse; width: 100%; margin: 0.5rem 0; }
  .page-content td, .page-content th { border: 1px solid #ccc; padding: 0.4rem 0.6rem; vertical-align: top; }
  .page-content .toc { border: 1px solid #ccc; border-radius: 10px; padding: 0.75rem 1rem; margin: 0.75rem 0; }
  .page-content .toc-title { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: #6b6b6b; margin: 0 0 0.4rem; }
  .page-content .toc ul { list-style: none; padding-left: 0; margin: 0; font-size: 0.9rem; }
  .page-content .toc-indent-1 { padding-left: 1rem; }
  .page-content .toc-indent-2 { padding-left: 2rem; }
  .page-content .col-layout { display: grid; gap: 1rem; margin: 0.5rem 0; }
  .page-content .col-layout.cols-2 { grid-template-columns: repeat(2, 1fr); }
  .page-content .col-layout.cols-3 { grid-template-columns: repeat(3, 1fr); }
  .page-content .col-layout.cols-4 { grid-template-columns: repeat(4, 1fr); }
  .page-content .col-layout.cols-5 { grid-template-columns: repeat(5, 1fr); }
  .page-content .bookmark-card { display: flex; border: 1px solid #ccc; border-radius: 10px; overflow: hidden; text-decoration: none; color: inherit; margin: 0.5rem 0; }
  .page-content .bookmark-text { padding: 0.75rem 1rem; flex: 1; min-width: 0; }
  .page-content .bookmark-title { font-weight: 600; }
  .page-content .bookmark-desc { font-size: 0.8rem; color: #6b6b6b; margin-top: 0.25rem; }
  .page-content .bookmark-url { font-size: 0.75rem; color: #6b6b6b; margin-top: 0.4rem; }
  .page-content .bookmark-thumb { width: 120px; flex-shrink: 0; }
  .page-content .bookmark-thumb img { width: 100%; height: 100%; object-fit: cover; margin: 0; border-radius: 0; }
  .page-content .equation { text-align: center; margin: 0.75rem 0; }
  .page-block { margin-bottom: 2.5rem; }
  .page-block + .page-block { padding-top: 2.5rem; border-top: 1px solid #ddd; }
`;

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "-").trim() || "cuaderno";
}

// Concatena una o varias páginas en el HTML del cuerpo del documento a exportar. Cada página
// lleva su título como encabezado; con más de una página se añade un salto antes de cada
// bloque (menos el primero) para que tanto la vista de impresión como Word las separen.
function buildBodyHtml(subtitle: string, pages: ExportPage[]): string {
  return pages
    .map((page, i) => {
      const pageBreak = i === 0 ? "" : `<br clear="all" style="mso-special-character:line-break;page-break-before:always" />`;
      return `
        ${pageBreak}
        <div class="page-block">
          <h1 class="page-title">${escapeHtml(page.title)}</h1>
          <p class="page-subtitle">${escapeHtml(subtitle)}</p>
          <div class="page-content">${page.content ? DOMPurify.sanitize(page.content, { ADD_ATTR: ["contenteditable", "data-latex"] }) : "<p><em>(página vacía)</em></p>"}</div>
        </div>`;
    })
    .join("\n");
}

// Usamos un <iframe> oculto en vez de window.open(): al no abrir una ventana/pestaña nueva no
// hay bloqueador de pop-ups que lo pueda impedir, incluso si el navegador o la extensión del
// usuario son estrictos con eso — solo pintamos el documento a exportar dentro de la página
// actual y llamamos a print() sobre ese iframe.
export function exportPagesToPdf(documentTitle: string, subtitle: string, pages: ExportPage[]) {
  const bodyHtml = buildBodyHtml(subtitle, pages);
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);

  const cleanup = () => {
    if (iframe.parentNode) document.body.removeChild(iframe);
  };

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    cleanup();
    window.alert("No se pudo preparar el documento para exportar a PDF.");
    return;
  }
  doc.open();
  doc.write(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(documentTitle)}</title>
<link rel="stylesheet" href="${KATEX_CSS_URL}" />
${allGoogleFontsLinkTags()}
<style>
  @media print { .page-block { page-break-inside: avoid; } }
  ${SHARED_CONTENT_CSS}
</style>
</head>
<body>${bodyHtml}</body>
</html>`);
  doc.close();

  const triggerPrint = () => {
    const win = iframe.contentWindow;
    if (!win) return cleanup();
    win.focus();
    win.print();
    // No hay evento fiable de "impresión terminada/cancelada" entre navegadores — quitamos el
    // iframe tras un margen amplio, cuando el diálogo de impresión ya se ha mostrado.
    setTimeout(cleanup, 1000);
  };
  // Esperamos a que carguen las imágenes embebidas (base64) antes de abrir el diálogo de
  // impresión; con onload basta en la inmensa mayoría de los casos.
  if (doc.readyState === "complete") {
    setTimeout(triggerPrint, 150);
  } else {
    iframe.onload = () => setTimeout(triggerPrint, 150);
  }
}

export function exportPagesToWord(documentTitle: string, subtitle: string, pages: ExportPage[]) {
  const bodyHtml = buildBodyHtml(subtitle, pages);
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(documentTitle)}</title>
<!--[if gte mso 9]>
<xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml>
<![endif]-->
<!-- Word ignora los <link> externos al abrir un .doc (los renderiza sin conexión), así que las
     tipografías de Google Fonts y las fórmulas (KaTeX) caen a su equivalente más cercano; el
     resto del contenido (tablas, destacados, columnas, miniaturas web) sí conserva el formato. -->
<style>${SHARED_CONTENT_CSS}</style>
</head>
<body>${bodyHtml}</body>
</html>`;

  // El BOM (U+FEFF) al principio evita que Word interprete mal la codificación UTF-8.
  const blob = new Blob(["\uFEFF", html], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sanitizeFilename(documentTitle)}.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
