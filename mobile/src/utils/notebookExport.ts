// Puerto de dashboard/src/utils/notebookExport.ts — mismo HTML/CSS "de exportación" (no el de
// edición, ver richEditorHtml.ts), pero generado con expo-print (PDF) y compartido/guardado como
// .doc vía saveAndShareText en vez de window.print()/un <a download> (ver fileExport.ts).

interface ExportPage {
  title: string;
  content: string;
}

const KATEX_CSS_URL = "https://cdn.jsdelivr.net/npm/katex@0.16.47/dist/katex.min.css";

// Mismos estilos que SHARED_CONTENT_CSS en dashboard/src/utils/notebookExport.ts.
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
  .page-content .col-layout { display: grid; gap: 1rem; margin: 0.5rem 0; }
  .page-content .col-layout.cols-2 { grid-template-columns: repeat(2, 1fr); }
  .page-content .col-layout.cols-3 { grid-template-columns: repeat(3, 1fr); }
  .page-content .col-layout.cols-4 { grid-template-columns: repeat(4, 1fr); }
  .page-content .col-layout.cols-5 { grid-template-columns: repeat(5, 1fr); }
  .page-content .bookmark-card { display: flex; border: 1px solid #ccc; border-radius: 10px; overflow: hidden; text-decoration: none; color: inherit; margin: 0.5rem 0; }
  .page-content .bookmark-text { padding: 0.75rem 1rem; flex: 1; min-width: 0; }
  .page-content .bookmark-title { font-weight: 600; }
  .page-content .bookmark-thumb { width: 120px; flex-shrink: 0; }
  .page-content .bookmark-thumb img { width: 100%; height: 100%; object-fit: cover; margin: 0; border-radius: 0; }
  .page-content .equation { text-align: center; margin: 0.75rem 0; }
  .page-block { margin-bottom: 2.5rem; }
  .page-block + .page-block { padding-top: 2.5rem; border-top: 1px solid #ddd; }
`;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildBodyHtml(subtitle: string, pages: ExportPage[]): string {
  return pages
    .map(
      (page) => `
        <div class="page-block">
          <h1 class="page-title">${escapeHtml(page.title)}</h1>
          <p class="page-subtitle">${escapeHtml(subtitle)}</p>
          <div class="page-content">${page.content || "<p><em>(página vacía)</em></p>"}</div>
        </div>`
    )
    .join("\n");
}

export function buildNotebookPdfHtml(documentTitle: string, subtitle: string, pages: ExportPage[]): string {
  const bodyHtml = buildBodyHtml(subtitle, pages);
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(documentTitle)}</title>
<link rel="stylesheet" href="${KATEX_CSS_URL}" />
<style>
  @media print { .page-block { page-break-inside: avoid; } }
  ${SHARED_CONTENT_CSS}
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

// Word (.doc, no .docx real) con las cabeceras que Word reconoce — igual truco que
// exportPagesToWord en dashboard/src/utils/notebookExport.ts.
export function buildNotebookWordHtml(documentTitle: string, subtitle: string, pages: ExportPage[]): string {
  const bodyHtml = buildBodyHtml(subtitle, pages);
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(documentTitle)}</title>
<!--[if gte mso 9]>
<xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml>
<![endif]-->
<style>${SHARED_CONTENT_CSS}</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}
