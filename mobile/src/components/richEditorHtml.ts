// HTML/CSS/JS autocontenido cargado dentro de un <WebView> (ver RichTextEditor.tsx) — es, en
// esencia, un puerto táctil de dashboard/src/components/RichTextEditor.tsx: mismo contentEditable
// + document.execCommand (funciona igual dentro de un WebView, que es un motor de navegador de
// verdad — Chromium en Android, WebKit en iOS), mismas clases CSS que el editor de escritorio
// (para que el HTML guardado se vea igual en los dos sitios), pero con el HTML/CSS/JS del editor
// viviendo aquí en vez de en React Native (RN no tiene contentEditable/execCommand: no hay forma
// nativa de "editar texto enriquecido" sin reimplementar un motor de edición entero).
//
// Lo que necesita un input de teclado (URL de enlace, LaTeX de una ecuación) se pide a React
// Native vía postMessage en vez de con window.prompt(): react-native-webview no soporta
// window.prompt() de forma fiable, así que RN abre su propio diálogo nativo y devuelve la
// respuesta llamando a una función ya expuesta en esta página (ver el protocolo más abajo).
// Tipografías y nº de columnas, en cambio, SÍ usan un <select> normal aquí dentro — no son texto
// libre, son una lista cerrada de opciones, y un <select> es un control de formulario normal
// (a diferencia de window.prompt/alert) que los WebView renderizan con su propio selector nativo
// sin el problema de fiabilidad de esos otros dos.
//
// Protocolo con React Native (ver RichTextEditor.tsx):
//   WebView → RN (postMessage, JSON): {type:"ready"} | {type:"change", html} |
//     {type:"request-link"} | {type:"request-equation", current} | {type:"request-image"} |
//     {type:"request-bookmark"} | {type:"request-table"} | {type:"alert", message}
//   RN → WebView (injectJavaScript llamando a estas funciones globales):
//     setEditorHtml(html) | applyLink(url) | applyEquation(latex) | applyImage(dataUri) |
//     applyBookmark(previewJson) | applyTable(rows, cols)
export const RICH_EDITOR_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.47/dist/katex.min.css" />
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.47/dist/katex.min.js"></script>
<style>
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body { margin: 0; padding: 0; background: #fdfcfb; font-family: -apple-system, Roboto, sans-serif; }
  #toolbar-wrap { position: sticky; top: 0; z-index: 10; background: #f6f3ee; border-bottom: 1px solid #e5e0d8; }
  #toolbar {
    display: flex; flex-wrap: nowrap; overflow-x: auto; gap: 2px; padding: 6px 6px;
    -webkit-overflow-scrolling: touch;
  }
  #color-panel { display: none; flex-wrap: wrap; align-items: center; gap: 8px; padding: 6px 10px 10px; border-top: 1px solid #e5e0d8; }
  #color-panel.open { display: flex; }
  #color-panel .swatch { width: 28px; height: 28px; border-radius: 50%; border: 1px solid rgba(0,0,0,0.18); padding: 0; flex: none; }
  #color-panel .swatch:active { transform: scale(0.9); }
  #color-panel .clear-hilite { border: 1px solid #e5e0d8; background: #fff; border-radius: 14px; padding: 5px 10px; font-size: 12px; color: #6b6258; }
  #toolbar button {
    flex: none; border: none; background: transparent; border-radius: 8px; padding: 7px 9px;
    font-size: 13px; color: #6b6258; white-space: nowrap;
  }
  #toolbar button:active { background: rgba(0,0,0,0.08); }
  #toolbar select {
    flex: none; border: none; background: transparent; border-radius: 8px; padding: 7px 4px;
    font-size: 13px; color: #6b6258; max-width: 92px;
  }
  #toolbar .sep { flex: none; width: 1px; background: #e5e0d8; margin: 4px 3px; }
  #editor {
    min-height: 60vh; padding: 14px 16px 40px; font-size: 15px; line-height: 1.6; color: #211d1a;
    outline: none;
  }
  #editor:empty::before { content: attr(data-placeholder); color: #9c948a; }
  #editor img { max-width: 100%; border-radius: 10px; margin: 6px 0; }
  #editor ul { padding-left: 22px; }
  #editor ol { padding-left: 22px; }
  #editor h1 { font-size: 1.5em; font-weight: 700; margin: 0.6em 0 0.3em; }
  #editor h2 { font-size: 1.25em; font-weight: 700; margin: 0.6em 0 0.3em; }
  #editor h3 { font-size: 1.1em; font-weight: 700; margin: 0.5em 0 0.25em; }
  #editor blockquote { margin: 0.5em 0; padding-left: 12px; border-left: 3px solid #ccc; color: #6b6258; font-style: italic; }
  #editor pre { margin: 0.5em 0; overflow-x: auto; border-radius: 10px; background: rgba(0,0,0,0.06); padding: 8px 10px; font-family: monospace; font-size: 0.85em; }
  #editor a { color: #8a6a4b; text-decoration: underline; }
  #editor hr { margin: 1em 0; border: none; border-top: 1px solid #e5e0d8; }
  #editor .todo-list { list-style: none; padding-left: 0; }
  #editor .todo-list li { position: relative; padding: 2px 0 2px 30px; }
  #editor .todo-list li::before { content: ""; position: absolute; left: 0; top: 3px; width: 18px; height: 18px; border-radius: 5px; border: 1.5px solid #9c948a; }
  #editor .todo-list li.todo-checked { color: #9c948a; text-decoration: line-through; }
  #editor .todo-list li.todo-checked::before { content: "\\2713"; display: flex; align-items: center; justify-content: center; border-color: #8a6a4b; background: #8a6a4b; color: #fff; font-size: 11px; text-decoration: none; }
  #editor .callout { display: flex; align-items: flex-start; gap: 8px; margin: 0.5em 0; border-radius: 12px; background: rgba(0,0,0,0.05); padding: 10px 14px; }
  #editor .callout-icon { flex-shrink: 0; }
  #editor .callout-text { flex: 1; min-width: 0; }
  #editor table { margin: 0.5em 0; width: 100%; border-collapse: collapse; }
  #editor td, #editor th { border: 1px solid #e5e0d8; padding: 6px 8px; vertical-align: top; }
  #editor .toc { margin: 0.75em 0; border-radius: 12px; border: 1px solid #e5e0d8; padding: 10px 14px; }
  #editor .toc-title { margin: 0 0 4px; font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.1em; color: #6b6258; }
  #editor .toc ul { list-style: none; padding-left: 0; margin: 0; font-size: 14px; }
  #editor .toc li { margin: 4px 0; }
  #editor .toc-indent-1 { padding-left: 16px; }
  #editor .toc-indent-2 { padding-left: 32px; }
  #editor .col-layout { display: grid; gap: 12px; margin: 0.5em 0; }
  #editor .col-layout.cols-2 { grid-template-columns: repeat(2, 1fr); }
  #editor .col-layout.cols-3 { grid-template-columns: repeat(3, 1fr); }
  #editor .col-layout.cols-4 { grid-template-columns: repeat(4, 1fr); }
  #editor .col-layout.cols-5 { grid-template-columns: repeat(5, 1fr); }
  #editor .bookmark-card { display: flex; margin: 0.5em 0; border: 1px solid #e5e0d8; border-radius: 12px; overflow: hidden; text-decoration: none; color: inherit; }
  #editor .bookmark-text { flex: 1; min-width: 0; padding: 10px 14px; }
  #editor .bookmark-title { font-weight: 600; }
  #editor .bookmark-desc { font-size: 12px; color: #6b6258; margin-top: 2px; }
  #editor .bookmark-url { font-size: 11px; color: #6b6258; margin-top: 6px; }
  #editor .bookmark-thumb { width: 90px; flex-shrink: 0; }
  #editor .bookmark-thumb img { width: 100%; height: 100%; object-fit: cover; margin: 0; border-radius: 0; }
  #editor .equation { margin: 0.75em 0; text-align: center; overflow-x: auto; }
</style>
</head>
<body>
<div id="toolbar-wrap">
<div id="toolbar">
  <button data-cmd="formatBlock" data-arg="<h1>">H1</button>
  <button data-cmd="formatBlock" data-arg="<h2>">H2</button>
  <button data-cmd="formatBlock" data-arg="<h3>">H3</button>
  <button data-cmd="formatBlock" data-arg="<p>">¶</button>
  <span class="sep"></span>
  <button data-cmd="bold" style="font-weight:700">B</button>
  <button data-cmd="italic" style="font-style:italic">I</button>
  <button data-cmd="underline" style="text-decoration:underline">S</button>
  <button data-cmd="strikeThrough" style="text-decoration:line-through">T</button>
  <button id="btn-forecolor" title="Color de texto"><span style="font-weight:700;border-bottom:3px solid #c0392b">A</span></button>
  <button id="btn-hilite" title="Resaltar"><span style="background:#fff2ac;padding:0 4px;font-weight:700">A</span></button>
  <span class="sep"></span>
  <select id="sel-font" title="Tipografía">
    <option value="" disabled selected>Tipografía</option>
  </select>
  <span class="sep"></span>
  <button data-cmd="insertUnorderedList">• Lista</button>
  <button data-cmd="insertOrderedList">1. Lista</button>
  <button id="btn-checklist">☑ Tareas</button>
  <span class="sep"></span>
  <button data-cmd="formatBlock" data-arg="<blockquote>">❝ Cita</button>
  <button id="btn-callout">💡 Destacado</button>
  <button data-cmd="formatBlock" data-arg="<pre>" title="Bloque de código">&lt;/&gt;</button>
  <button data-cmd="insertHorizontalRule" title="Línea divisoria">─ Línea</button>
  <button id="btn-table">▦ Tabla</button>
  <button id="btn-equation">∑ Ecuación</button>
  <button id="btn-toc">☰ Índice</button>
  <select id="sel-columns" title="Distribuir en columnas">
    <option value="" disabled selected>⬛ Columnas</option>
    <option value="2">2 columnas</option>
    <option value="3">3 columnas</option>
    <option value="4">4 columnas</option>
    <option value="5">5 columnas</option>
  </select>
  <span class="sep"></span>
  <button id="btn-link">🔗 Enlace</button>
  <button id="btn-bookmark">🌐 Web</button>
  <button id="btn-image">🖼 Imagen</button>
  <span class="sep"></span>
  <button data-cmd="justifyLeft" title="Alinear a la izquierda">⯇</button>
  <button data-cmd="justifyCenter" title="Centrar">≡</button>
  <button data-cmd="justifyRight" title="Alinear a la derecha">⯈</button>
  <span class="sep"></span>
  <button data-cmd="undo">↺</button>
  <button data-cmd="redo">↻</button>
</div>
<div id="color-panel"></div>
</div>
<div id="editor" contenteditable="true" data-placeholder=""></div>
<script>
  var editor = document.getElementById("editor");
  var savedRange = null;

  function post(msg) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  }
  function emitChange() { post({ type: "change", html: editor.innerHTML }); }
  function saveSelection() {
    var sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
  }
  function restoreSelection() {
    if (!savedRange) return;
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }
  function exec(cmd, arg) {
    editor.focus();
    restoreSelection();
    document.execCommand(cmd, false, arg);
    emitChange();
  }

  document.querySelectorAll("#toolbar button[data-cmd]").forEach(function (btn) {
    btn.addEventListener("mousedown", function (e) { e.preventDefault(); saveSelection(); });
    btn.addEventListener("click", function () { exec(btn.getAttribute("data-cmd"), btn.getAttribute("data-arg") || undefined); });
  });

  // Igual que los botones data-cmd de arriba: sin el mousedown+preventDefault, tocar el botón le
  // quita el foco/selección al contentEditable ANTES de que llegue el click, y exec() (que
  // siempre restaura savedRange) insertaría en una posición vieja o nula en vez del cursor
  // actual — mismo motivo que el mousedown de cada ToolbarButton en el editor de escritorio.
  [
    ["btn-checklist", '<ul class="todo-list"><li>Tarea</li></ul><p><br></p>'],
    // Mismas clases callout-icon/callout-text que insertCallout en el editor de escritorio, para
    // que un destacado creado aquí se vea igual (mismo CSS) al abrirlo en la web.
    ["btn-callout", '<div class="callout"><span class="callout-icon">\\ud83d\\udca1</span><span class="callout-text">Texto destacado</span></div><p><br></p>'],
  ].forEach(function (pair) {
    var btn = document.getElementById(pair[0]);
    var html = pair[1];
    btn.addEventListener("mousedown", function (e) { e.preventDefault(); saveSelection(); });
    btn.addEventListener("click", function () { exec("insertHTML", html); });
  });

  // Tabla: RN pide filas y columnas (mismo motivo que enlace/ecuación: nada de window.prompt) y
  // devuelve las dos cifras a applyTable, con los mismos límites que insertTable en la web
  // (1-20 filas, 1-10 columnas, 3 si no es un número válido).
  document.getElementById("btn-table").addEventListener("mousedown", function (e) { e.preventDefault(); saveSelection(); });
  document.getElementById("btn-table").addEventListener("click", function () { post({ type: "request-table" }); });
  window.applyTable = function (rowsInput, colsInput) {
    var rows = Math.min(Math.max(parseInt(rowsInput, 10) || 3, 1), 20);
    var cols = Math.min(Math.max(parseInt(colsInput, 10) || 3, 1), 10);
    var row = "<tr>" + "<td><br></td>".repeat(cols) + "</tr>";
    exec("insertHTML", "<table><tbody>" + row.repeat(rows) + "</tbody></table><p><br></p>");
  };

  // Color de texto / resaltado: la web usa <input type="color">, que en un WebView táctil no es
  // fiable, así que aquí es un panel con una paleta fija de muestras. Los botones de la barra y
  // las muestras hacen preventDefault en mousedown para no robarle la selección al editor.
  var TEXT_COLORS = ["#1a1a1a", "#6b6b6b", "#c0392b", "#d97706", "#ca8a04", "#16a34a", "#0d9488", "#2563eb", "#7c3aed", "#db2777"];
  var HILITE_COLORS = ["#fff2ac", "#ffe0b2", "#ffd6d6", "#ffd9ec", "#e6d9ff", "#cfe8ff", "#d4f5d4", "#e0e0e0"];
  var colorPanel = document.getElementById("color-panel");
  var panelMode = null;
  function closePanel() { colorPanel.className = ""; colorPanel.innerHTML = ""; panelMode = null; }
  function openPanel(mode) {
    if (panelMode === mode) { closePanel(); return; }
    panelMode = mode;
    colorPanel.innerHTML = "";
    var cmd = mode === "text" ? "foreColor" : "hiliteColor";
    (mode === "text" ? TEXT_COLORS : HILITE_COLORS).forEach(function (hex) {
      var sw = document.createElement("button");
      sw.className = "swatch";
      sw.style.background = hex;
      sw.addEventListener("mousedown", function (e) { e.preventDefault(); });
      sw.addEventListener("click", function () { exec(cmd, hex); closePanel(); });
      colorPanel.appendChild(sw);
    });
    if (mode === "hilite") {
      var clear = document.createElement("button");
      clear.className = "clear-hilite";
      clear.textContent = "✕ Quitar resaltado";
      clear.addEventListener("mousedown", function (e) { e.preventDefault(); });
      clear.addEventListener("click", function () { exec("hiliteColor", "transparent"); closePanel(); });
      colorPanel.appendChild(clear);
    }
    colorPanel.className = "open";
  }
  [["btn-forecolor", "text"], ["btn-hilite", "hilite"]].forEach(function (pair) {
    var btn = document.getElementById(pair[0]);
    btn.addEventListener("mousedown", function (e) { e.preventDefault(); saveSelection(); });
    btn.addEventListener("click", function () { openPanel(pair[1]); });
  });

  document.getElementById("btn-link").addEventListener("mousedown", function (e) { e.preventDefault(); saveSelection(); });
  document.getElementById("btn-link").addEventListener("click", function () {
    var selected = window.getSelection().toString();
    if (!selected) { post({ type: "alert", message: "Selecciona primero el texto al que quieras añadir el enlace." }); return; }
    post({ type: "request-link" });
  });
  window.applyLink = function (url) {
    if (!url) return;
    exec("createLink", url);
  };

  document.getElementById("btn-equation").addEventListener("mousedown", function (e) { e.preventDefault(); saveSelection(); });
  document.getElementById("btn-equation").addEventListener("click", function () {
    // Sin esto, si el usuario tocó antes una ecuación YA insertada (activando el modo "editar",
    // ver window._editingEquation más abajo) y canceló el diálogo sin aplicar nada, este botón de
    // "nueva ecuación" seguiría en modo edición y sobreescribiría esa ecuación antigua en vez de
    // insertar una nueva en el cursor.
    window._editingEquation = null;
    post({ type: "request-equation", current: "" });
  });
  window.applyEquation = function (latex) {
    if (!latex) return;
    try {
      var rendered = katex.renderToString(latex, { throwOnError: false, displayMode: true });
      exec("insertHTML", '<div class="equation" contenteditable="false" data-latex="' + latex.replace(/"/g, "&quot;") + '">' + rendered + "</div><p><br></p>");
    } catch (e) {
      post({ type: "alert", message: "No se pudo interpretar esa fórmula." });
    }
  };

  document.getElementById("btn-image").addEventListener("mousedown", function (e) { e.preventDefault(); saveSelection(); });
  document.getElementById("btn-image").addEventListener("click", function () { post({ type: "request-image" }); });
  window.applyImage = function (dataUri) {
    if (!dataUri) return;
    exec("insertImage", dataUri);
  };

  // Igual criterio que handleEditorMouseDown en el RichTextEditor de escritorio: el cuadrado del
  // checklist es un ::before dibujado por CSS, tocar cerca del borde izquierdo alterna la clase
  // en vez de dejar que el navegador coloque el cursor ahí.
  editor.addEventListener("click", function (e) {
    var li = e.target.closest ? e.target.closest("li") : null;
    if (li && li.parentElement && li.parentElement.className === "todo-list") {
      var rect = li.getBoundingClientRect();
      if (e.clientX - rect.left <= 30) {
        li.classList.toggle("todo-checked");
        emitChange();
        return;
      }
    }
    var eq = e.target.closest ? e.target.closest(".equation") : null;
    if (eq && editor.contains(eq)) {
      window._editingEquation = eq;
      post({ type: "request-equation", current: eq.getAttribute("data-latex") || "" });
    }
  });
  var originalApplyEquation = window.applyEquation;
  window.applyEquation = function (latex) {
    var target = window._editingEquation;
    window._editingEquation = null;
    if (target) {
      if (!latex) { target.remove(); emitChange(); return; }
      try {
        var rendered = katex.renderToString(latex, { throwOnError: false, displayMode: true });
        target.innerHTML = rendered;
        target.setAttribute("data-latex", latex);
        emitChange();
      } catch (e) {
        post({ type: "alert", message: "No se pudo interpretar esa fórmula." });
      }
      return;
    }
    originalApplyEquation(latex);
  };

  // Tipografías: mismo criterio que loadGoogleFont en dashboard/src/utils/googleFonts.ts — el
  // <link> de una familia solo se inyecta la primera vez que se usa de verdad, no las 8 de golpe.
  var GOOGLE_FONTS = ["Inter", "Roboto", "Playfair Display", "Merriweather", "Lora", "Poppins", "Space Mono", "Caveat"];
  var loadedFonts = {};
  function loadGoogleFont(family) {
    if (loadedFonts[family]) return;
    loadedFonts[family] = true;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=" + encodeURIComponent(family) + ":wght@400;600;700&display=swap";
    document.head.appendChild(link);
  }
  var fontSelect = document.getElementById("sel-font");
  GOOGLE_FONTS.forEach(function (font) {
    var opt = document.createElement("option");
    opt.value = font;
    opt.textContent = font;
    fontSelect.appendChild(opt);
  });
  fontSelect.addEventListener("mousedown", saveSelection);
  fontSelect.addEventListener("change", function () {
    var family = fontSelect.value;
    fontSelect.value = "";
    if (!family) return;
    loadGoogleFont(family);
    exec("fontName", family);
  });

  // Columnas: mismo HTML que insertColumns en el editor de escritorio.
  var columnsSelect = document.getElementById("sel-columns");
  columnsSelect.addEventListener("mousedown", saveSelection);
  columnsSelect.addEventListener("change", function () {
    var n = Number(columnsSelect.value);
    columnsSelect.value = "";
    if (!n) return;
    var cols = '<div class="col"><p><br></p></div>'.repeat(n);
    exec("insertHTML", '<div class="col-layout cols-' + n + '">' + cols + "</div><p><br></p>");
  });

  // Índice: puerto directo de insertToc en el editor de escritorio — foto fija de los títulos
  // (H1/H2/H3) que haya AHORA MISMO en el editor, no se recalcula solo si se añaden más después.
  document.getElementById("btn-toc").addEventListener("mousedown", function (e) { e.preventDefault(); saveSelection(); });
  document.getElementById("btn-toc").addEventListener("click", function () {
    var headings = Array.prototype.slice.call(editor.querySelectorAll("h1, h2, h3"));
    if (headings.length === 0) {
      post({ type: "alert", message: "Añade algún título (H1, H2 o H3) antes de insertar el índice." });
      return;
    }
    var items = headings
      .map(function (h, i) {
        if (!h.id) h.id = "heading-" + Date.now() + "-" + i;
        var indentClass = h.tagName === "H2" ? " toc-indent-1" : h.tagName === "H3" ? " toc-indent-2" : "";
        var text = (h.textContent || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        return '<li class="' + indentClass + '"><a href="#' + h.id + '">' + text + "</a></li>";
      })
      .join("");
    exec("insertHTML", '<div class="toc" contenteditable="false"><p class="toc-title">Índice</p><ul>' + items + "</ul></div><p><br></p>");
  });

  // Miniatura web: pide la URL a RN (mismo motivo que enlace/ecuación) — RN llama a GET
  // /link-preview y devuelve los datos ya listos con applyBookmark, esta página solo construye el
  // HTML de la tarjeta (misma estructura que insertWebBookmark en el editor de escritorio).
  document.getElementById("btn-bookmark").addEventListener("mousedown", function (e) { e.preventDefault(); saveSelection(); });
  document.getElementById("btn-bookmark").addEventListener("click", function () { post({ type: "request-bookmark" }); });
  window.applyBookmark = function (previewJson) {
    if (!previewJson) return;
    var preview;
    try {
      preview = JSON.parse(previewJson);
    } catch (e) {
      return;
    }
    var esc = function (s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); };
    var escAttr = function (s) { return (s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;"); };
    var title = esc(preview.title || preview.url);
    var desc = preview.description ? '<div class="bookmark-desc">' + esc(preview.description) + "</div>" : "";
    var thumb = preview.image ? '<div class="bookmark-thumb"><img src="' + escAttr(preview.image) + '" alt="" /></div>' : "";
    var card =
      '<a class="bookmark-card" href="' + escAttr(preview.url) + '" target="_blank" rel="noopener noreferrer" contenteditable="false">' +
      '<div class="bookmark-text"><div class="bookmark-title">' + title + "</div>" + desc +
      '<div class="bookmark-url">\\ud83c\\udf10 ' + esc(preview.siteName) + "</div></div>" + thumb + "</a><p><br></p>";
    exec("insertHTML", card);
  };

  editor.addEventListener("input", emitChange);
  editor.addEventListener("blur", emitChange);

  // Además de escribir el HTML, vuelve a pedir las tipografías de Google Fonts que ya use ese
  // contenido (igual que el useEffect del editor de escritorio): una página guardada con
  // "Playfair Display" no la tiene cargada en esta sesión hasta que alguien la elija de nuevo.
  window.setEditorHtml = function (html) {
    if (editor.innerHTML !== html) editor.innerHTML = html;
    GOOGLE_FONTS.forEach(function (font) {
      if ((html || "").indexOf(font) !== -1) loadGoogleFont(font);
    });
  };
  window.setEditorPlaceholder = function (text) {
    editor.setAttribute("data-placeholder", text || "");
  };

  post({ type: "ready" });
</script>
</body>
</html>`;
