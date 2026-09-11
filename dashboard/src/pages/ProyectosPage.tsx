import { useEffect, useRef, useState } from "react";
import { PageHeader } from "../components/AppShell";
import { api } from "../api/client";
import { useFetch } from "../hooks/useFetch";
import { Loading, ErrorMessage, EmptyState } from "../components/Feedback";
import { RichTextEditor } from "../components/RichTextEditor";
import { exportPagesToPdf, exportPagesToWord } from "../utils/notebookExport";
import { Project, ProjectColor, ProjectPage, ProjectTask } from "../types";

const STATUS_LABELS: Record<Project["status"], string> = {
  idea: "Idea",
  en_curso: "En curso",
  pausado: "Pausado",
  completado: "Completado",
};
const STATUS_ORDER: Project["status"][] = ["idea", "en_curso", "pausado", "completado"];

// Colores de carpeta disponibles al crear un proyecto (ver ProjectColor en ../types) — los tres
// tonos "sólidos" de la paleta cálida del sistema de diseño (ver el comentario de arriba de
// dashboard/src/styles.css): --cover (cuero), --secondary/sand y --primary/sage. Mismo idioma de
// selector que CALENDAR_COLOR_OPTIONS/AddCategoryForm en AnnualCalendarLegend.tsx (swatches
// redondos, anillo al seleccionar), reutilizando aquí las clases de fondo de TONE_CLASSES (más
// abajo) en vez de duplicarlas.
const PROJECT_COLORS: ProjectColor[] = ["cover", "sand", "sage"];
const PROJECT_COLOR_LABELS: Record<ProjectColor, string> = { cover: "Cuero", sand: "Arena", sage: "Verde salvia" };

export function ProyectosPage({
  focusProjectId,
  onFocusHandled,
}: {
  // Llegada desde un resultado de la búsqueda global (ver AppShell.GlobalSearch): abre
  // directamente el cuaderno de este proyecto al montar.
  focusProjectId?: number;
  onFocusHandled?: () => void;
} = {}) {
  const [title, setTitle] = useState("");
  const [quickNote, setQuickNote] = useState("");
  // `null` = "sin personalizar": el backend guarda color: null y la carpeta cae a la rotación
  // por índice de siempre (ver el fallback `project.color ?? PROJECT_COLORS[...]` más abajo) —
  // el mismo aspecto que tenían todos los proyectos antes de que existiera este selector. Solo se
  // fija un color concreto si el usuario toca uno de los swatches.
  const [color, setColor] = useState<ProjectColor | null>(null);
  const [openId, setOpenId] = useState<number | null>(focusProjectId ?? null);
  const { data, loading, error, reload } = useFetch(() => api.get<{ projects: Project[] }>("/projects"), []);

  useEffect(() => {
    if (focusProjectId && onFocusHandled) onFocusHandled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <PageHeader title="Cuaderno de proyectos" subtitle="Apunta, anota y sigue el progreso" />

      {openId === null && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!title.trim()) return;
            const note = quickNote.trim();
            const created = await api.post<Project>("/projects", { title: title.trim(), description: note || null, color });
            if (note) {
              await api.post(`/projects/${created.id}/tasks`, { title: note });
            }
            setTitle("");
            setQuickNote("");
            setColor(null);
            reload();
          }}
          className="mb-10 grid gap-4 card-soft md:grid-cols-[1fr_2fr_auto]"
        >
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nombre del proyecto" className="field-input" />
          <input
            value={quickNote}
            onChange={(e) => setQuickNote(e.target.value)}
            placeholder="Apunte rápido (opcional) — ¿de qué trata?"
            className="field-input"
          />
          <button type="submit" className="btn-dark">
            Abrir página
          </button>

          {/* Color de la carpeta en la galería — mismo idioma de swatches redondos que
              AddCategoryForm en AnnualCalendarLegend.tsx (anillo alrededor del seleccionado).
              "Auto" (primero, guiones) es `color: null`: la carpeta rota por índice como antes de
              que existiera este selector — es el estado inicial, así que quien no lo toque
              conserva exactamente el aspecto de siempre. */}
          <div className="flex items-center gap-2 md:col-span-3">
            <span className="text-xs text-muted-foreground">Color de la carpeta</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                title="Automático (rota los colores de siempre)"
                onClick={() => setColor(null)}
                className={`size-5 shrink-0 cursor-pointer rounded-full border border-dashed border-muted-foreground ${
                  color === null ? "ring-2 ring-foreground ring-offset-1 ring-offset-background" : ""
                }`}
              />
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  title={PROJECT_COLOR_LABELS[c]}
                  onClick={() => setColor(c)}
                  className={`size-5 shrink-0 cursor-pointer rounded-full ${TONE_CLASSES[c].tab} ${
                    color === c ? "ring-2 ring-foreground ring-offset-1 ring-offset-background" : ""
                  }`}
                />
              ))}
            </div>
          </div>
        </form>
      )}

      {error && <ErrorMessage message={error} />}

      {openId !== null ? (
        <ProjectNotebook
          projectId={openId}
          onBack={() => setOpenId(null)}
          onChanged={reload}
        />
      ) : loading ? (
        <Loading label="Cargando proyectos..." />
      ) : (data?.projects.length ?? 0) === 0 ? (
        <EmptyState message="Todavía no tienes proyectos." />
      ) : (
        <div className="grid gap-x-6 gap-y-12 sm:grid-cols-2 xl:grid-cols-3">
          {data?.projects.map((project, i) => (
            <NotebookCover
              key={project.id}
              project={project}
              tone={project.color ?? PROJECT_COLORS[i % PROJECT_COLORS.length]}
              onOpen={() => setOpenId(project.id)}
            />
          ))}
        </div>
      )}
    </>
  );
}

// Clases por tono — "sand" es el único de los tres que necesita borde (su fondo, --secondary,
// tiene una luminosidad parecida a --background y sin borde se difumina contra la página; --cover
// y --primary/sage ya son lo bastante oscuros/saturados para destacar solos). "solid" agrupa
// cover+sage porque ambos necesitan texto claro y las mismas superposiciones semitransparentes
// (bg-background/opacity-N), frente a sand que usa los tokens normales de texto sobre fondo claro.
const TONE_CLASSES: Record<ProjectColor, { card: string; tab: string; solid: boolean }> = {
  cover: { card: "bg-cover text-background", tab: "bg-cover", solid: true },
  sand: { card: "border border-secondary bg-secondary", tab: "bg-secondary", solid: false },
  sage: { card: "bg-primary text-primary-foreground", tab: "bg-primary", solid: true },
};

function NotebookCover({ project, tone, onOpen }: { project: Project; tone: ProjectColor; onOpen: () => void }) {
  const { card, tab, solid } = TONE_CLASSES[tone];
  return (
    <button
      onClick={onOpen}
      className={`relative flex cursor-pointer flex-col rounded-3xl rounded-tl-none pt-9 p-6 text-left shadow-[var(--shadow-soft)] transition-transform hover:-translate-y-1 ${card}`}
    >
      {/* Pestaña de carpeta colgante: rectángulo recto (sin corte en diagonal — antes tenía un
          clip-path trapezoidal, pero se pidió que cayera recta) con las dos esquinas superiores
          redondeadas. Mismo color que la tapa (parte de la misma silueta recortada, no una pieza
          aparte). Sin sombra propia (dibujaba una raya justo en el solape, delatando que son dos
          piezas) y con el solape (-top) más largo que el padding superior de la tapa, para que
          ningún borde de la pestaña quede nunca a la vista dentro de la tarjeta. La esquina
          arriba-izda del propio `button` (`rounded-tl-none`) se deja recta para que la lengüeta
          parezca salir de ahí, no flotar sobre una esquina ya curva. */}
      <div aria-hidden className={`absolute left-3 -top-5 h-8 w-[42%] max-w-40 rounded-t-lg ${tab}`} />

      {/* Brillo diagonal + línea de pliegue bajo la lengüeta: puramente decorativos
          (pointer-events-none, sin contenido) para dar la sensación de plástico/papel de una
          carpeta real en vez de una tarjeta plana. El contenido de verdad va en el div `relative
          z-10` de abajo para quedar siempre por encima de estos dos degradados. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-br from-white/20 via-transparent to-transparent"
      />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-3 rounded-t-[inherit] bg-black/[0.06]" />

      <div className="relative z-10 flex flex-1 flex-col">
        <div className="flex items-start justify-between gap-4">
          <h2 className="font-serif text-2xl">{project.title}</h2>
          <span className={`whitespace-nowrap rounded-full px-3 py-1 text-xs ${solid ? "bg-background/20" : "bg-foreground/10"}`}>
            {STATUS_LABELS[project.status]}
          </span>
        </div>

        {project.description && <p className={`mt-2 text-sm ${solid ? "opacity-70" : "text-muted-foreground"}`}>{project.description}</p>}

        <span className={`mt-6 text-xs ${solid ? "opacity-50" : "text-muted-foreground"}`}>Haz clic para abrir tus apuntes →</span>
      </div>
    </button>
  );
}

// Preferencia global (no por proyecto): si el usuario oculta la nota de "Apuntes rápidos" en
// una libreta, se queda oculta en todas — es una nota de apoyo, no algo que se eche en falta
// al cambiar de proyecto. Se guarda en localStorage para que sobreviva a recargar la página.
const HIDE_QUICK_NOTES_KEY = "life-organizer:hide-quick-notes";

function ProjectNotebook({ projectId, onBack, onChanged }: { projectId: number; onBack: () => void; onChanged: () => void }) {
  const { data: project, loading, error, reload } = useFetch(() => api.get<Project>(`/projects/${projectId}`), [projectId]);
  const [note, setNote] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [showQuickNotes, setShowQuickNotes] = useState(() => localStorage.getItem(HIDE_QUICK_NOTES_KEY) !== "1");
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [confirmingTaskId, setConfirmingTaskId] = useState<number | null>(null);

  const toggleTaskCompleted = async (task: ProjectTask) => {
    await api.put(`/projects/${projectId}/tasks/${task.id}/complete`, { completed: !task.completed });
    reload();
  };

  const saveTaskTitle = async (taskId: number, title: string) => {
    const trimmed = title.trim();
    setEditingTaskId(null);
    if (!trimmed) return; // vacío: se descarta el cambio, no se borra el apunte por accidente
    await api.put(`/projects/${projectId}/tasks/${taskId}`, { title: trimmed });
    reload();
  };

  const removeTask = async (taskId: number) => {
    await api.delete(`/projects/${projectId}/tasks/${taskId}`);
    setConfirmingTaskId(null);
    reload();
  };

  // Igual que el borrado de páginas: primer click pide confirmación, segundo click (en el mismo
  // aspa) borra de verdad; alejar el ratón cancela la confirmación pendiente.
  const handleDeleteTaskClick = (e: React.MouseEvent, task: ProjectTask) => {
    e.stopPropagation();
    if (confirmingTaskId === task.id) {
      removeTask(task.id);
    } else {
      setConfirmingTaskId(task.id);
    }
  };

  const hideQuickNotes = () => {
    localStorage.setItem(HIDE_QUICK_NOTES_KEY, "1");
    setShowQuickNotes(false);
  };
  const restoreQuickNotes = () => {
    localStorage.removeItem(HIDE_QUICK_NOTES_KEY);
    setShowQuickNotes(true);
  };

  const cycleStatus = async () => {
    if (!project) return;
    const next = STATUS_ORDER[(STATUS_ORDER.indexOf(project.status) + 1) % STATUS_ORDER.length];
    await api.put(`/projects/${projectId}`, { status: next });
    reload();
    onChanged();
  };

  const removeProject = async () => {
    await api.delete(`/projects/${projectId}`);
    onChanged();
    onBack();
  };

  return (
    <div>
      <button onClick={onBack} className="mb-6 cursor-pointer text-sm text-muted-foreground hover:text-foreground">
        ← Volver a la galería
      </button>

      {loading ? (
        <Loading label="Abriendo cuaderno..." />
      ) : error ? (
        <ErrorMessage message={error} />
      ) : !project ? null : (
        <div className="rounded-3xl border border-secondary bg-card p-8">
          <div className="flex items-start justify-between gap-4">
            <h1 className="font-serif text-3xl">{project.title}</h1>
            <button
              onClick={cycleStatus}
              className="cursor-pointer whitespace-nowrap rounded-full bg-secondary px-3 py-1 text-xs transition-colors hover:bg-secondary/70"
            >
              {STATUS_LABELS[project.status]}
            </button>
          </div>

          {!showQuickNotes && (
            <button
              onClick={restoreQuickNotes}
              className="mt-4 cursor-pointer text-xs text-muted-foreground hover:text-foreground"
            >
              + Mostrar apuntes rápidos
            </button>
          )}

          {/* Páginas ocupa el ancho principal, como una libreta de verdad — ya no va metida en
              un recuadro aparte. Apuntes rápidos pasa a ser una nota lateral, opcional: el
              usuario puede ocultarla (botón ✕ de aquí abajo) y queda oculta en localStorage. */}
          <div className={`mt-8 grid gap-8 ${showQuickNotes ? "lg:grid-cols-[1fr_280px]" : "grid-cols-1"}`}>
            <section className={showQuickNotes ? "lg:order-1" : ""}>
              <h2 className="mb-4 text-xs font-medium uppercase tracking-widest text-muted-foreground">Páginas</h2>
              <ProjectPages projectId={projectId} projectTitle={project.title} />
            </section>

            {showQuickNotes && (
              <aside className="lg:order-2 lg:border-l lg:border-border lg:pl-8">
                <div className="mb-4 flex items-center justify-between gap-2">
                  <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Apuntes rápidos</h2>
                  <button
                    onClick={hideQuickNotes}
                    title="Ocultar apuntes rápidos"
                    className="cursor-pointer text-xs text-muted-foreground opacity-60 hover:opacity-100"
                  >
                    ✕
                  </button>
                </div>

                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!note.trim()) return;
                    await api.post(`/projects/${projectId}/tasks`, { title: note.trim() });
                    setNote("");
                    reload();
                  }}
                  className="mb-4"
                >
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Escribe un apunte rápido…"
                    className="field-input w-full"
                  />
                </form>

                {(project.tasks?.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground">Aún no tienes apuntes en esta libreta.</p>
                ) : (
                  <ul className="space-y-2">
                    {project.tasks?.map((t) => (
                      <li
                        key={t.id}
                        className="group flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm"
                      >
                        <button
                          type="button"
                          onClick={() => toggleTaskCompleted(t)}
                          title={t.completed ? "Desmarcar" : "Marcar como hecho"}
                          className={`flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm border text-[9px] transition-colors ${
                            t.completed ? "border-primary bg-primary/20 text-primary" : "border-foreground/30 hover:border-primary/60"
                          }`}
                        >
                          {t.completed ? "✓" : ""}
                        </button>

                        {editingTaskId === t.id ? (
                          <input
                            autoFocus
                            defaultValue={t.title}
                            onBlur={(e) => saveTaskTitle(t.id, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                              if (e.key === "Escape") setEditingTaskId(null);
                            }}
                            className="min-w-0 flex-1 border-b border-primary bg-transparent py-0.5 text-sm outline-none"
                          />
                        ) : (
                          <button
                            type="button"
                            title={t.completed ? undefined : "Click para editar"}
                            onClick={() => {
                              if (!t.completed) setEditingTaskId(t.id);
                            }}
                            className={`min-w-0 flex-1 truncate text-left ${
                              t.completed ? "cursor-default text-muted-foreground line-through" : "cursor-text hover:text-primary"
                            }`}
                          >
                            {t.title}
                          </button>
                        )}

                        <span
                          role="button"
                          title={confirmingTaskId === t.id ? "Confirmar eliminar" : "Eliminar apunte"}
                          onClick={(e) => handleDeleteTaskClick(e, t)}
                          onMouseLeave={() => setConfirmingTaskId((id) => (id === t.id ? null : id))}
                          className={`shrink-0 cursor-pointer text-xs transition-opacity ${
                            confirmingTaskId === t.id
                              ? "font-bold text-destructive opacity-100"
                              : "opacity-0 group-hover:opacity-60 hover:!opacity-100"
                          }`}
                        >
                          ✕
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </aside>
            )}
          </div>

          <div className="mt-8 flex items-center justify-between border-t border-border pt-6 text-xs text-muted-foreground">
            <span>
              {project.progress?.completed ?? 0}/{project.progress?.total ?? 0} apuntes resueltos · prioridad {project.priority}
            </span>
            <button
              onClick={() => {
                if (!confirmingDelete) {
                  setConfirmingDelete(true);
                  return;
                }
                removeProject();
              }}
              onBlur={() => setConfirmingDelete(false)}
              className={`cursor-pointer whitespace-nowrap rounded-full px-3 py-1 transition-colors ${
                confirmingDelete ? "bg-destructive text-destructive-foreground" : "hover:text-destructive"
              }`}
            >
              {confirmingDelete ? "¿Confirmar eliminar?" : "Eliminar proyecto"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectPages({ projectId, projectTitle }: { projectId: number; projectTitle: string }) {
  const { data, loading, error, reload } = useFetch(
    () => api.get<{ pages: ProjectPage[] }>(`/projects/${projectId}/pages`),
    [projectId]
  );
  const pages = data?.pages ?? [];

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [content, setContent] = useState("");
  const [pageTitle, setPageTitle] = useState("");
  const [savingState, setSavingState] = useState<"idle" | "saving" | "saved">("idle");
  const [confirmingPageId, setConfirmingPageId] = useState<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Selecciona la primera página en cuanto cargan, y carga su contenido al cambiar de página.
  useEffect(() => {
    if (selectedId === null && pages.length > 0) {
      setSelectedId(pages[0].id);
      setContent(pages[0].content);
      setPageTitle(pages[0].title);
    }
  }, [pages, selectedId]);

  const selectPage = (page: ProjectPage) => {
    setSelectedId(page.id);
    setContent(page.content);
    setPageTitle(page.title);
  };

  const savePage = (pageId: number, html: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSavingState("saving");
    saveTimer.current = setTimeout(async () => {
      await api.put(`/projects/${projectId}/pages/${pageId}`, { content: html });
      setSavingState("saved");
    }, 600);
  };

  // El título se guarda al perder el foco (no en cada tecla como el contenido): así no
  // dispara una llamada por letra, y la pestaña de la página se actualiza en cuanto se confirma.
  const saveTitle = async () => {
    if (selectedId === null) return;
    const trimmed = pageTitle.trim();
    if (!trimmed) return;
    await api.put(`/projects/${projectId}/pages/${selectedId}`, { title: trimmed });
    reload();
  };

  const addPage = async () => {
    const created = await api.post<ProjectPage>(`/projects/${projectId}/pages`, { title: `Página ${pages.length + 1}` });
    reload();
    setSelectedId(created.id);
    setContent(created.content);
    setPageTitle(created.title);
  };

  const removePage = async (pageId: number) => {
    await api.delete(`/projects/${projectId}/pages/${pageId}`);
    if (selectedId === pageId) setSelectedId(null);
    setConfirmingPageId(null);
    reload();
  };

  // Página vacía (nunca se ha escrito nada en ella) se borra directamente, sin preguntar —
  // no hay nada que perder. Si tiene contenido, primer clic pide confirmación (segundo clic
  // en el mismo aspa borra de verdad); alejar el ratón cancela la confirmación pendiente.
  const handleDeleteClick = (e: React.MouseEvent, page: ProjectPage) => {
    e.stopPropagation();
    if (!page.content || page.content.trim() === "") {
      removePage(page.id);
      return;
    }
    if (confirmingPageId === page.id) {
      removePage(page.id);
    } else {
      setConfirmingPageId(page.id);
    }
  };

  // La página abierta puede tener cambios sin confirmar aún en `pages` (el guardado del
  // contenido está debounced 600ms, y el título se guarda al perder el foco), así que al
  // exportar se sustituye por el estado local — es lo que el usuario ve en pantalla ahora mismo.
  const currentPageForExport = (): { title: string; content: string } | null => {
    if (selectedId === null) return null;
    return { title: pageTitle.trim() || "Página sin título", content };
  };

  const allPagesForExport = (): { title: string; content: string }[] =>
    pages.map((page) => (page.id === selectedId ? currentPageForExport()! : { title: page.title, content: page.content }));

  const handleExport = (format: "pdf" | "word", scope: "current" | "all") => {
    const exportPages = scope === "current" ? [currentPageForExport()].filter((p): p is { title: string; content: string } => p !== null) : allPagesForExport();
    if (exportPages.length === 0) return;
    const documentTitle = scope === "current" ? exportPages[0].title : projectTitle;
    const subtitle = scope === "current" ? projectTitle : `Cuaderno de ${projectTitle}`;
    if (format === "pdf") exportPagesToPdf(documentTitle, subtitle, exportPages);
    else exportPagesToWord(documentTitle, subtitle, exportPages);
  };

  if (loading) return <Loading label="Cargando páginas..." />;
  if (error) return <ErrorMessage message={error} />;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {pages.map((page) => (
            <button
              key={page.id}
              onClick={() => selectPage(page)}
              className={`group relative cursor-pointer whitespace-nowrap rounded-full px-4 py-1.5 text-xs transition-colors ${
                confirmingPageId === page.id
                  ? "border border-destructive bg-destructive/10 text-destructive"
                  : page.id === selectedId
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground hover:border-primary/30"
              }`}
            >
              {page.title}
              <span
                role="button"
                title={confirmingPageId === page.id ? "Confirmar eliminar" : "Eliminar página"}
                onClick={(e) => handleDeleteClick(e, page)}
                onMouseLeave={() => setConfirmingPageId((id) => (id === page.id ? null : id))}
                className={`ml-2 cursor-pointer ${
                  confirmingPageId === page.id ? "font-bold opacity-100" : "opacity-60 hover:opacity-100"
                }`}
              >
                ✕
              </span>
            </button>
          ))}
          <button onClick={addPage} className="cursor-pointer rounded-full border border-dashed border-border px-4 py-1.5 text-xs text-muted-foreground hover:border-primary/30 hover:text-foreground">
            + Página
          </button>
        </div>

        {pages.length > 0 && <ExportMenu onExport={handleExport} />}
      </div>

      {pages.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aún no tienes páginas. Crea una para escribir con formato, listas e imágenes.</p>
      ) : selectedId === null ? null : (
        <>
          <input
            value={pageTitle}
            onChange={(e) => setPageTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            placeholder="Título de la página"
            className="mb-3 w-full border-b border-border bg-transparent pb-2 font-serif text-xl outline-none focus:border-primary"
          />
          <RichTextEditor
            key={selectedId}
            value={content}
            onChange={(html) => {
              setContent(html);
              savePage(selectedId, html);
            }}
            placeholder="Escribe aquí…"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {savingState === "saving" ? "Guardando..." : savingState === "saved" ? "Guardado" : ""}
          </p>
        </>
      )}
    </div>
  );
}

// Menú desplegable de exportación: PDF (vía diálogo de impresión del navegador) o Word (.doc),
// cada uno para la página abierta o para el cuaderno completo. <details>/<summary> nativos en
// vez de un menú hecho a mano con estado — se cierran solos al hacer clic fuera, sin JS extra.
function ExportMenu({ onExport }: { onExport: (format: "pdf" | "word", scope: "current" | "all") => void }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  const choose = (format: "pdf" | "word", scope: "current" | "all") => {
    onExport(format, scope);
    if (detailsRef.current) detailsRef.current.open = false;
  };

  return (
    <details ref={detailsRef} className="relative">
      <summary
        className="flex cursor-pointer list-none items-center gap-1 whitespace-nowrap rounded-full border border-border px-4 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground [&::-webkit-details-marker]:hidden"
      >
        Exportar
      </summary>
      <div className="absolute right-0 z-10 mt-2 w-56 overflow-hidden rounded-2xl border border-border bg-card py-1.5 shadow-lg">
        <p className="px-4 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Esta página</p>
        <ExportMenuItem label="Exportar a PDF" onClick={() => choose("pdf", "current")} />
        <ExportMenuItem label="Exportar a Word" onClick={() => choose("word", "current")} />
        <p className="mt-1 border-t border-border px-4 pb-1 pt-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          Todo el cuaderno
        </p>
        <ExportMenuItem label="Exportar a PDF" onClick={() => choose("pdf", "all")} />
        <ExportMenuItem label="Exportar a Word" onClick={() => choose("word", "all")} />
      </div>
    </details>
  );
}

function ExportMenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full cursor-pointer px-4 py-2 text-left text-sm text-foreground hover:bg-foreground/5"
    >
      {label}
    </button>
  );
}
