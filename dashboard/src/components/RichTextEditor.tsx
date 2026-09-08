import { ReactNode, useEffect, useRef, useState } from "react";
import katex from "katex";
// Antes en src/styles.css (global, cargado por CUALQUIER pestaña). Movido aquí para que Vite lo
// separe en el mismo chunk que este componente — RichTextEditor solo lo usan las páginas `lazy`
// de DashboardPage.tsx, así que abrir "Hoy" ya no descarga el CSS de KaTeX de más.
import "katex/dist/katex.min.css";
import { api, ApiError } from "../api/client";
import { GOOGLE_FONTS, loadGoogleFont } from "../utils/googleFonts";

// Editor de texto enriquecido simple (encabezados, negrita/cursiva, listas, checklist, citas,
// destacados, tablas, columnas, índice, ecuaciones, miniaturas web...) basado en
// contentEditable + document.execCommand. execCommand está deprecado en el estándar, pero
// sigue funcionando en los navegadores basados en Chromium/Firefox — para un editor interno
// como este evita meter una librería completa (TipTap, Slate...) solo para tener un set de
// opciones al estilo Notion.
const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // 3MB por imagen — el body de /projects admite hasta 10MB en total

interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

export function RichTextEditor({ value, onChange, placeholder }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const [insertingBookmark, setInsertingBookmark] = useState(false);

  // Sincroniza el HTML externo (p.ej. al cambiar de página) sin pelear con el cursor mientras
  // el usuario escribe: solo se reescribe si el contenido realmente cambió por fuera. De paso,
  // precarga cualquier tipografía de Google Fonts que ya esté en uso en ese HTML (si la página
  // se guardó con texto en "Playfair Display", hay que volver a pedir ese stylesheet: nada
  // garantiza que ya esté cargado en esta sesión).
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
      for (const font of GOOGLE_FONTS) {
        if (value.includes(font)) loadGoogleFont(font);
      }
    }
  }, [value]);

  const emitChange = () => onChange(editorRef.current?.innerHTML ?? "");

  const exec = (command: string, arg?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, arg);
    emitChange();
  };

  // input[type=color] y <select> nativos siempre roban el foco al abrirse (a diferencia de un
  // <button>, no hay forma de evitarlo con onMouseDown/preventDefault) y con él se pierde la
  // selección de texto del contentEditable. Guardamos el Range justo antes de que eso pase
  // (mousedown) y lo restauramos justo antes de aplicar el comando (change), para que el color
  // o la tipografía se apliquen sobre el texto que el usuario había seleccionado de verdad.
  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  };
  const execWithSavedSelection = (command: string, arg?: string) => {
    const sel = window.getSelection();
    if (sel && savedRangeRef.current) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    }
    exec(command, arg);
  };

  const insertImage = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    if (file.size > MAX_IMAGE_BYTES) {
      window.alert("La imagen es demasiado grande (máx. 3 MB).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => exec("insertImage", reader.result as string);
    reader.readAsDataURL(file);
  };

  const insertChecklist = () => {
    exec("insertHTML", '<ul class="todo-list"><li>Tarea</li></ul><p><br></p>');
  };

  const insertLink = () => {
    const selected = window.getSelection()?.toString();
    if (!selected) {
      window.alert("Selecciona primero el texto al que quieras añadir el enlace.");
      return;
    }
    const url = window.prompt("URL del enlace:", "https://");
    if (url) exec("createLink", url);
  };

  const insertCallout = () => {
    exec(
      "insertHTML",
      '<div class="callout"><span class="callout-icon">💡</span><span class="callout-text">Texto destacado</span></div><p><br></p>'
    );
  };

  const insertTable = () => {
    const rowsInput = window.prompt("¿Cuántas filas?", "3");
    if (rowsInput === null) return;
    const colsInput = window.prompt("¿Cuántas columnas?", "3");
    if (colsInput === null) return;
    const rows = Math.min(Math.max(parseInt(rowsInput, 10) || 3, 1), 20);
    const cols = Math.min(Math.max(parseInt(colsInput, 10) || 3, 1), 10);
    const row = `<tr>${"<td><br></td>".repeat(cols)}</tr>`;
    exec("insertHTML", `<table><tbody>${row.repeat(rows)}</tbody></table><p><br></p>`);
  };

  const insertColumns = (n: number) => {
    const cols = `<div class="col"><p><br></p></div>`.repeat(n);
    exec("insertHTML", `<div class="col-layout cols-${n}">${cols}</div><p><br></p>`);
  };

  // El índice es una foto fija de los títulos que hay en el momento de insertarlo (no se
  // recalcula solo si luego añades más títulos) — a cambio, no depende de re-renderizar nada:
  // son enlaces (#id) normales que el propio navegador desplaza al hacer click.
  const insertToc = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const headings = Array.from(editor.querySelectorAll("h1, h2, h3")) as HTMLElement[];
    if (headings.length === 0) {
      window.alert("Añade algún título (H1, H2 o H3) antes de insertar el índice.");
      return;
    }
    const items = headings
      .map((h, i) => {
        if (!h.id) h.id = `heading-${Date.now()}-${i}`;
        const indentClass = h.tagName === "H2" ? " toc-indent-1" : h.tagName === "H3" ? " toc-indent-2" : "";
        return `<li class="${indentClass}"><a href="#${h.id}">${escapeHtml(h.textContent || "")}</a></li>`;
      })
      .join("");
    exec(
      "insertHTML",
      `<div class="toc" contenteditable="false"><p class="toc-title">Índice</p><ul>${items}</ul></div><p><br></p>`
    );
  };

  const renderEquationHtml = (latex: string): string | null => {
    try {
      return katex.renderToString(latex, { throwOnError: false, displayMode: true });
    } catch {
      return null;
    }
  };

  const insertEquation = () => {
    const latex = window.prompt("Escribe la fórmula en LaTeX (p. ej. E = mc^2):", "");
    if (!latex || !latex.trim()) return;
    const rendered = renderEquationHtml(latex);
    if (!rendered) {
      window.alert("No se pudo interpretar esa fórmula.");
      return;
    }
    exec(
      "insertHTML",
      `<div class="equation" contenteditable="false" data-latex="${escapeAttr(latex)}">${rendered}</div><p><br></p>`
    );
  };

  // Click sobre una ecuación ya insertada: reabre el prompt con el LaTeX original para editarla
  // en el sitio, en vez de tener que borrarla y volver a insertar una nueva.
  const handleEditorClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const eq = target.closest(".equation") as HTMLElement | null;
    if (!eq || !editorRef.current?.contains(eq)) return;
    const currentLatex = eq.getAttribute("data-latex") || "";
    const newLatex = window.prompt("Editar fórmula LaTeX:", currentLatex);
    if (newLatex === null) return;
    if (!newLatex.trim()) {
      eq.remove();
      emitChange();
      return;
    }
    const rendered = renderEquationHtml(newLatex);
    if (!rendered) {
      window.alert("No se pudo interpretar esa fórmula.");
      return;
    }
    eq.innerHTML = rendered;
    eq.setAttribute("data-latex", newLatex);
    emitChange();
  };

  const insertWebBookmark = async () => {
    const raw = window.prompt("Pega la URL de la web:", "https://");
    if (!raw || !raw.trim()) return;
    const normalized = /^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
    setInsertingBookmark(true);
    try {
      const preview = await api.get<LinkPreview>(`/link-preview?url=${encodeURIComponent(normalized)}`);
      const title = escapeHtml(preview.title || preview.url);
      const desc = preview.description ? `<div class="bookmark-desc">${escapeHtml(preview.description)}</div>` : "";
      const thumb = preview.image
        ? `<div class="bookmark-thumb"><img src="${escapeAttr(preview.image)}" alt="" /></div>`
        : "";
      const card = `<a class="bookmark-card" href="${escapeAttr(preview.url)}" target="_blank" rel="noopener noreferrer" contenteditable="false"><div class="bookmark-text"><div class="bookmark-title">${title}</div>${desc}<div class="bookmark-url">🌐 ${escapeHtml(preview.siteName)}</div></div>${thumb}</a><p><br></p>`;
      exec("insertHTML", card);
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : "No se pudo cargar la vista previa de esa web.");
    } finally {
      setInsertingBookmark(false);
    }
  };

  // El checkbox de una tarea es un pseudo-elemento (::before) dibujado por CSS, no un <input>
  // real: así el contentEditable no compite por el foco/cursor con un control de formulario.
  // Al hacer click cerca del borde izquierdo del <li> (donde se dibuja el cuadrado) se alterna
  // la clase "todo-checked" en vez de dejar que el navegador coloque el cursor ahí.
  const handleEditorMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const li = target.closest("li");
    if (!li || li.parentElement?.className !== "todo-list") return;
    const rect = li.getBoundingClientRect();
    if (e.clientX - rect.left > 28) return;
    e.preventDefault();
    li.classList.toggle("todo-checked");
    emitChange();
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-input bg-card">
      <div className="flex flex-wrap items-center gap-1 border-b border-border bg-muted/50 px-2 py-1.5">
        <ToolbarButton title="Título 1" onClick={() => exec("formatBlock", "<h1>")}>
          H1
        </ToolbarButton>
        <ToolbarButton title="Título 2" onClick={() => exec("formatBlock", "<h2>")}>
          H2
        </ToolbarButton>
        <ToolbarButton title="Título 3" onClick={() => exec("formatBlock", "<h3>")}>
          H3
        </ToolbarButton>
        <ToolbarButton title="Texto normal" onClick={() => exec("formatBlock", "<p>")}>
          ¶
        </ToolbarButton>
        <div className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton title="Negrita" className="font-bold" onClick={() => exec("bold")}>
          B
        </ToolbarButton>
        <ToolbarButton title="Cursiva" className="italic" onClick={() => exec("italic")}>
          I
        </ToolbarButton>
        <ToolbarButton title="Subrayado" className="underline" onClick={() => exec("underline")}>
          S
        </ToolbarButton>
        <ToolbarButton title="Tachado" className="line-through" onClick={() => exec("strikeThrough")}>
          T
        </ToolbarButton>
        <div className="mx-1 h-5 w-px bg-border" />

        {/* Tipografía y color: selects/inputs nativos, no <button> — necesitan el guardado de
            selección de saveSelection/execWithSavedSelection (ver arriba). */}
        <select
          defaultValue=""
          title="Tipografía"
          onMouseDown={saveSelection}
          onChange={(e) => {
            const family = e.target.value;
            e.target.value = "";
            if (!family) return;
            loadGoogleFont(family);
            execWithSavedSelection("fontName", family);
          }}
          className="cursor-pointer rounded-md border border-input bg-background px-2 py-1.5 text-xs text-muted-foreground outline-none hover:text-foreground"
        >
          <option value="" disabled>
            Tipografía
          </option>
          {GOOGLE_FONTS.map((font) => (
            <option key={font} value={font} style={{ fontFamily: font }}>
              {font}
            </option>
          ))}
        </select>
        <input
          type="color"
          title="Color de texto"
          defaultValue="#1a1a1a"
          onMouseDown={saveSelection}
          onChange={(e) => execWithSavedSelection("foreColor", e.target.value)}
          className="h-7 w-7 cursor-pointer rounded border border-input bg-transparent p-0.5"
        />
        <input
          type="color"
          title="Color de fondo (resaltado)"
          defaultValue="#fff2ac"
          onMouseDown={saveSelection}
          onChange={(e) => execWithSavedSelection("hiliteColor", e.target.value)}
          className="h-7 w-7 cursor-pointer rounded border border-input bg-transparent p-0.5"
        />
        <ToolbarButton title="Quitar resaltado" onClick={() => exec("hiliteColor", "transparent")}>
          ✕
        </ToolbarButton>
        <div className="mx-1 h-5 w-px bg-border" />

        <ToolbarButton title="Lista con viñetas" onClick={() => exec("insertUnorderedList")}>
          • Lista
        </ToolbarButton>
        <ToolbarButton title="Lista numerada" onClick={() => exec("insertOrderedList")}>
          1. Lista
        </ToolbarButton>
        <ToolbarButton title="Lista de tareas" onClick={insertChecklist}>
          ☑ Tareas
        </ToolbarButton>
        <div className="mx-1 h-5 w-px bg-border" />

        <ToolbarButton title="Cita" onClick={() => exec("formatBlock", "<blockquote>")}>
          ❝ Cita
        </ToolbarButton>
        <ToolbarButton title="Texto destacado" onClick={insertCallout}>
          💡 Destacado
        </ToolbarButton>
        <ToolbarButton title="Bloque de código" onClick={() => exec("formatBlock", "<pre>")}>
          {"</>"}
        </ToolbarButton>
        <ToolbarButton title="Línea divisoria" onClick={() => exec("insertHorizontalRule")}>
          ─ Línea
        </ToolbarButton>
        <ToolbarButton title="Tabla" onClick={insertTable}>
          ▦ Tabla
        </ToolbarButton>
        <ToolbarButton title="Índice (a partir de los títulos)" onClick={insertToc}>
          ☰ Índice
        </ToolbarButton>
        <ToolbarButton title="Ecuación (LaTeX) — click sobre una ya insertada para editarla" onClick={insertEquation}>
          ∑ Ecuación
        </ToolbarButton>
        <select
          defaultValue=""
          title="Distribuir en columnas"
          onMouseDown={saveSelection}
          onChange={(e) => {
            const n = Number(e.target.value);
            e.target.value = "";
            if (n) {
              const sel = window.getSelection();
              if (sel && savedRangeRef.current) {
                sel.removeAllRanges();
                sel.addRange(savedRangeRef.current);
              }
              insertColumns(n);
            }
          }}
          className="cursor-pointer rounded-md border border-input bg-background px-2 py-1.5 text-xs text-muted-foreground outline-none hover:text-foreground"
        >
          <option value="" disabled>
            ⬛ Columnas
          </option>
          <option value="2">2 columnas</option>
          <option value="3">3 columnas</option>
          <option value="4">4 columnas</option>
          <option value="5">5 columnas</option>
        </select>
        <div className="mx-1 h-5 w-px bg-border" />

        <ToolbarButton title="Enlace" onClick={insertLink}>
          🔗 Enlace
        </ToolbarButton>
        <ToolbarButton title="Miniatura web (vista previa de un enlace)" onClick={insertWebBookmark} disabled={insertingBookmark}>
          {insertingBookmark ? "Cargando…" : "🌐 Web"}
        </ToolbarButton>
        <div className="mx-1 h-5 w-px bg-border" />

        <ToolbarButton title="Alinear izquierda" onClick={() => exec("justifyLeft")}>
          ⯇
        </ToolbarButton>
        <ToolbarButton title="Centrar" onClick={() => exec("justifyCenter")}>
          ≡
        </ToolbarButton>
        <ToolbarButton title="Alinear derecha" onClick={() => exec("justifyRight")}>
          ⯈
        </ToolbarButton>
        <div className="mx-1 h-5 w-px bg-border" />

        <ToolbarButton title="Insertar imagen" onClick={() => fileInputRef.current?.click()}>
          🖼 Imagen
        </ToolbarButton>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) insertImage(file);
            e.target.value = "";
          }}
        />
        <div className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton title="Deshacer" onClick={() => exec("undo")}>
          ↺
        </ToolbarButton>
        <ToolbarButton title="Rehacer" onClick={() => exec("redo")}>
          ↻
        </ToolbarButton>
      </div>

      <div
        ref={editorRef}
        contentEditable
        onInput={emitChange}
        onBlur={emitChange}
        onMouseDown={handleEditorMouseDown}
        onClick={handleEditorClick}
        onPaste={(e) => {
          const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
          if (!item) return;
          e.preventDefault();
          const file = item.getAsFile();
          if (file) insertImage(file);
        }}
        data-placeholder={placeholder}
        className="rich-editor"
      />
    </div>
  );
}

function ToolbarButton({
  title,
  className = "",
  onClick,
  disabled,
  children,
}: {
  title: string;
  className?: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      // Evita que el botón robe el foco/la selección del contentEditable antes de ejecutar el
      // comando (execCommand necesita que la selección de texto siga activa en el editor).
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`cursor-pointer whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}
