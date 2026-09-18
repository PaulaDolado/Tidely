import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useFetch } from "../hooks/useFetch";
import { Loading, ErrorMessage, EmptyState } from "../components/Feedback";
import { RichTextEditor } from "../components/RichTextEditor";
import { CustomFieldInput, formatCustomFieldValue } from "../components/CustomFieldInput";
import { newId } from "../utils/id";
import { CUSTOM_PAGE_TEMPLATE_META } from "../utils/customPageTemplates";
import { placeholderColorFor, frameHeightFor } from "../utils/galleryPalette";
import {
  AgendaNote,
  ChecklistItem,
  CustomFieldDef,
  CustomFieldType,
  CustomFieldValue,
  CustomPage,
  CustomPageContentMap,
  CustomPageTemplate,
  FinanceEntry,
  GalleryEntry,
  KanbanCard,
  KanbanColumn,
  SimpleGoal,
} from "../types";

const FIELD_TYPE_LABELS: Record<CustomFieldType, string> = { text: "Texto", number: "Número", date: "Fecha", select: "Selección" };

// Paleta rápida del selector de icono de la página (ver "Cambiar icono" en la cabecera) — los 8
// de las plantillas más unos genéricos habituales; el campo "o escribe el tuyo" de más abajo
// cubre cualquier otro emoji que no esté aquí.
const PAGE_ICON_OPTIONS = ["📝", "🗂️", "🖼️", "💰", "📁", "🎯", "📅", "☀️", "⭐", "✅", "📌", "📚", "💡", "🔥", "❤️", "🏆"];

const SAVE_DEBOUNCE_MS = 600;

/**
 * Página personalizada creada desde "+ Nueva página" (ver AppShell/CreatePageModal). Se comporta
 * como un "shell" delgado: carga la fila completa (con `content`) y delega el cuerpo a la
 * plantilla que corresponda a `template` — cada una es "controlada" (recibe su parte de
 * `content` y devuelve el objeto completo actualizado vía `onChange`), y este componente es el
 * único que sabe guardar (debounced, igual que ProjectPages con el contenido de una libreta).
 */
export function CustomPagePage({
  pageId,
  onRenamed,
  onDeleted,
}: {
  pageId: number;
  // Avisa al menú lateral (ver AppShell) de que el título ha cambiado, para refrescar la lista.
  onRenamed: () => void;
  // Avisa de que la página se ha borrado, para quitarla del menú y volver a "Hoy".
  onDeleted: () => void;
}) {
  const { data: page, loading, error } = useFetch(() => api.get<CustomPage>(`/custom-pages/${pageId}`), [pageId]);

  const [title, setTitle] = useState("");
  // Cadena vacía = "no ha escrito ninguno todavía", no "borrar el de la plantilla" — el
  // placeholder del input (ver más abajo) es quien muestra icono+nombre por defecto en ese caso.
  const [subtitle, setSubtitle] = useState("");
  // null = no ha elegido ninguno todavía, se muestra el de la plantilla (ver meta.icon más abajo)
  // — mismo criterio que `subtitle`.
  const [icon, setIcon] = useState<string | null>(null);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [customIconDraft, setCustomIconDraft] = useState("");
  const iconPickerRef = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState<CustomPageContentMap[CustomPageTemplate] | null>(null);
  const [savingState, setSavingState] = useState<"idle" | "saving" | "saved">("idle");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Solo se usa cuando template === "kanban" — kanban sigue siendo la vista por defecto (igual
  // que en PlanificadorPage), tabla es una alternativa que lee/escribe el mismo `columns`.
  const [kanbanView, setKanbanView] = useState<"kanban" | "table">("kanban");
  const [managingFields, setManagingFields] = useState(false);
  // Solo se usa cuando template === "galeria" — qué entrada tiene abierto su diálogo de detalle
  // ahora mismo (null = ninguna). Vive aquí (no dentro de GalleryTemplate) porque "+ Nueva
  // entrada" está en la cabecera de la página, igual que "+ Propiedad"/"+ Columna" de kanban.
  const [openGalleryId, setOpenGalleryId] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Último subtítulo que se sabe guardado en el servidor — ver saveSubtitle: comparar contra
  // esto (no contra `page.subtitle`, que no se vuelve a pedir tras cada guardado) es lo que evita
  // que un segundo cambio se quede sin detectar por comparar contra un valor ya desactualizado.
  const lastSavedSubtitleRef = useRef("");

  // Sincroniza el estado local editable en cuanto llega (o cambia) la página del servidor.
  useEffect(() => {
    if (page) {
      setTitle(page.title);
      setSubtitle(page.subtitle ?? "");
      lastSavedSubtitleRef.current = page.subtitle ?? "";
      setIcon(page.icon);
      setContent(page.content);
    }
  }, [page]);

  // Cierra la paleta de iconos al tocar fuera — mismo patrón que AnnualCalendarLegend.
  useEffect(() => {
    if (!iconPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (iconPickerRef.current && !iconPickerRef.current.contains(e.target as Node)) setIconPickerOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [iconPickerOpen]);

  const scheduleSave = (nextContent: CustomPageContentMap[CustomPageTemplate]) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSavingState("saving");
    saveTimer.current = setTimeout(async () => {
      await api.put(`/custom-pages/${pageId}`, { content: nextContent });
      setSavingState("saved");
    }, SAVE_DEBOUNCE_MS);
  };

  const updateContent = (next: CustomPageContentMap[CustomPageTemplate]) => {
    setContent(next);
    scheduleSave(next);
  };

  // Crear una propiedad personalizada nueva — llamado tanto desde el diálogo "+ Propiedad" de la
  // cabecera (KanbanFieldsDialog) como desde el propio "+ Añadir propiedad" dentro de cada
  // tarjeta (ver KanbanCardDialog): mismo destino, `content.kanban.fieldDefs`.
  const addFieldDef = (name: string, type: CustomFieldType, options?: string[]) => {
    const current = content as CustomPageContentMap["kanban"];
    updateContent({ ...current, fieldDefs: [...(current.fieldDefs ?? []), { id: newId(), name, type, options }] });
  };

  // Crea una entrada vacía (sin foto ni texto) y abre su diálogo al instante, para que el
  // usuario añada la foto/texto ahí mismo — igual flujo que "+ Nueva tarea" en el Planificador.
  const addGalleryItem = () => {
    const current = content as CustomPageContentMap["galeria"];
    const entry: GalleryEntry = { id: newId() };
    updateContent({ items: [entry, ...current.items] });
    setOpenGalleryId(entry.id);
  };

  // El título se guarda al perder el foco (no en cada tecla), igual que el de una página de
  // proyecto — ver ProjectPages.saveTitle.
  const saveTitle = async () => {
    const trimmed = title.trim();
    if (!page) return;
    if (!trimmed) {
      setTitle(page.title);
      return;
    }
    if (trimmed === page.title) return;
    await api.put(`/custom-pages/${pageId}`, { title: trimmed });
    onRenamed();
  };

  // Mismo patrón que saveTitle: se guarda al perder el foco, no en cada tecla. A diferencia del
  // título, aquí SÍ se admite vaciarlo — un subtítulo vacío es válido (vuelve a mostrar
  // icono+nombre de la plantilla vía el placeholder del input) y se guarda como null. Ver
  // `lastSavedSubtitleRef` más arriba para por qué la comparación NO es contra `page.subtitle`.
  const saveSubtitle = async () => {
    const trimmed = subtitle.trim();
    if (!page) return;
    if (trimmed === lastSavedSubtitleRef.current) return;
    await api.put(`/custom-pages/${pageId}`, { subtitle: trimmed });
    lastSavedSubtitleRef.current = trimmed;
  };

  // Elegir de la paleta o escribir uno propio guarda al momento (no hace falta perder el foco,
  // a diferencia de subtitle/title); `null` quita el icono propio y vuelve a mostrar el de la
  // plantilla — mismo criterio que vaciar el subtítulo.
  const saveIcon = async (next: string | null) => {
    if (!page) return;
    setIcon(next);
    setIconPickerOpen(false);
    setCustomIconDraft("");
    await api.put(`/custom-pages/${pageId}`, { icon: next });
  };

  const removePage = async () => {
    await api.delete(`/custom-pages/${pageId}`);
    onDeleted();
  };

  if (loading) return <Loading label="Abriendo página..." />;
  if (error) return <ErrorMessage message={error} />;
  if (!page || content === null) return null;

  const meta = CUSTOM_PAGE_TEMPLATE_META[page.template];

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="w-full min-w-0 border-b border-transparent bg-transparent font-serif text-4xl outline-none focus:border-primary"
          />
          <div className="relative mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            <button
              type="button"
              title="Cambiar icono"
              onClick={() => setIconPickerOpen((v) => !v)}
              className="shrink-0 cursor-pointer rounded hover:bg-muted"
            >
              {icon ?? meta.icon}
            </button>
            {iconPickerOpen && (
              <div
                ref={iconPickerRef}
                className="absolute left-0 top-full z-10 mt-1 w-64 rounded-2xl border border-border bg-card p-3 shadow-[var(--shadow-soft)]"
              >
                <div className="flex flex-wrap gap-1">
                  {PAGE_ICON_OPTIONS.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => saveIcon(opt)}
                      className={`flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-base hover:bg-muted ${
                        icon === opt ? "bg-primary/10 ring-1 ring-primary" : ""
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex items-center gap-2 border-t border-border pt-2">
                  <input
                    value={customIconDraft}
                    onChange={(e) => setCustomIconDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && customIconDraft.trim()) saveIcon(customIconDraft.trim());
                    }}
                    placeholder="O escribe el tuyo…"
                    maxLength={8}
                    className="field-input min-w-0 flex-1 text-sm"
                  />
                  {icon !== null && (
                    <button
                      type="button"
                      onClick={() => saveIcon(null)}
                      className="shrink-0 cursor-pointer text-xs text-muted-foreground hover:text-destructive"
                    >
                      Quitar
                    </button>
                  )}
                </div>
              </div>
            )}
            {/* Vacío por defecto — el placeholder es quien muestra "Kanban"/"Nota"/etc., para no
                confundir "el usuario escribió esto" con "es solo el nombre de la plantilla". */}
            <input
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              onBlur={saveSubtitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              placeholder={meta.label}
              className="min-w-0 flex-1 border-b border-transparent bg-transparent text-sm text-muted-foreground outline-none focus:border-primary"
            />
            {savingState === "saving" && <span className="shrink-0">· Guardando...</span>}
            {savingState === "saved" && <span className="shrink-0">· Guardado</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-3">
          <button
            onClick={() => {
              if (!confirmingDelete) {
                setConfirmingDelete(true);
                return;
              }
              removePage();
            }}
            onBlur={() => setConfirmingDelete(false)}
            className={`cursor-pointer whitespace-nowrap rounded-full px-4 py-2 text-xs transition-colors ${
              confirmingDelete
                ? "bg-destructive text-destructive-foreground"
                : "border border-border text-muted-foreground hover:text-destructive"
            }`}
          >
            {confirmingDelete ? "¿Confirmar eliminar?" : "Eliminar página"}
          </button>

          {/* Igual criterio que "+ Columna" en kanban: crear va en la cabecera de la página, no
              dentro del propio collage. */}
          {page.template === "galeria" && (
            <button type="button" onClick={addGalleryItem} className="btn-dark whitespace-nowrap">
              + Nueva entrada
            </button>
          )}
        </div>
      </div>

      {/* Fila propia (no metida en la columna de "Eliminar página") para que el toggle
          Kanban/Tabla y las acciones de "+ Propiedad" / "+ Columna" queden a la misma
          altura, cada uno en un extremo. */}
      {page.template === "kanban" && (
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center overflow-hidden rounded-full border border-border">
            {(["kanban", "table"] as const).map((mode, index) => (
              <button
                key={mode}
                type="button"
                onClick={() => setKanbanView(mode)}
                className={`cursor-pointer px-3 py-2 text-xs font-medium transition-colors ${index > 0 ? "border-l border-border" : ""} ${
                  kanbanView === mode ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {mode === "kanban" ? "Kanban" : "Tabla"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setManagingFields(true)}
              title="Propiedades personalizadas"
              className="cursor-pointer whitespace-nowrap rounded-full border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
            >
              + Propiedad
            </button>
            <KanbanAddColumnForm
              onAdd={(columnTitle) => {
                const current = content as CustomPageContentMap["kanban"];
                updateContent({ columns: [...current.columns, { id: newId(), title: columnTitle, cards: [] }] });
              }}
            />
          </div>
        </div>
      )}

      {page.template === "kanban" && managingFields && (
        <KanbanFieldsDialog
          fieldDefs={(content as CustomPageContentMap["kanban"]).fieldDefs ?? []}
          onChange={(fieldDefs) => updateContent({ ...(content as CustomPageContentMap["kanban"]), fieldDefs })}
          onClose={() => setManagingFields(false)}
        />
      )}

      {page.template === "nota" && (
        <RichTextEditor
          value={(content as CustomPageContentMap["nota"]).html}
          onChange={(html) => updateContent({ html })}
          placeholder="Escribe aquí…"
        />
      )}
      {page.template === "kanban" &&
        (kanbanView === "kanban" ? (
          <KanbanTemplate
            columns={(content as CustomPageContentMap["kanban"]).columns}
            fieldDefs={(content as CustomPageContentMap["kanban"]).fieldDefs ?? []}
            onChange={(columns) => updateContent({ ...(content as CustomPageContentMap["kanban"]), columns })}
            onAddField={addFieldDef}
          />
        ) : (
          <KanbanTableView
            columns={(content as CustomPageContentMap["kanban"]).columns}
            fieldDefs={(content as CustomPageContentMap["kanban"]).fieldDefs ?? []}
            onChange={(columns) => updateContent({ ...(content as CustomPageContentMap["kanban"]), columns })}
            onAddField={addFieldDef}
          />
        ))}
      {page.template === "galeria" && (
        <GalleryTemplate
          items={(content as CustomPageContentMap["galeria"]).items}
          onChange={(items) => updateContent({ items })}
          openId={openGalleryId}
          onOpenChange={setOpenGalleryId}
        />
      )}
      {page.template === "finanzas" && (
        <FinanceTemplate
          entries={(content as CustomPageContentMap["finanzas"]).entries}
          onChange={(entries) => updateContent({ entries })}
        />
      )}
      {page.template === "objetivos" && (
        <GoalsTemplate goals={(content as CustomPageContentMap["objetivos"]).goals} onChange={(goals) => updateContent({ goals })} />
      )}
      {page.template === "agenda" && (
        <AgendaNotesTemplate
          items={(content as CustomPageContentMap["agenda"]).items}
          onChange={(items) => updateContent({ items })}
        />
      )}
      {page.template === "proyectos" && (
        <ChecklistTemplate
          emptyLabel="Añade tareas para seguir el progreso."
          items={(content as CustomPageContentMap["proyectos"]).items}
          onChange={(items) => updateContent({ items })}
        />
      )}
      {page.template === "hoy" && (
        <ChecklistTemplate
          emptyLabel="Añade lo que tengas que hacer hoy."
          items={(content as CustomPageContentMap["hoy"]).items}
          onChange={(items) => updateContent({ items })}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Checklist genérico — usado por las plantillas "proyectos" y "hoy" (misma forma de datos, solo
// cambia el mensaje de la lista vacía).
// ---------------------------------------------------------------------------------------------
function ChecklistTemplate({
  items,
  onChange,
  emptyLabel,
}: {
  items: ChecklistItem[];
  onChange: (items: ChecklistItem[]) => void;
  emptyLabel: string;
}) {
  const [text, setText] = useState("");

  const addItem = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    onChange([...items, { id: newId(), text: trimmed, done: false }]);
    setText("");
  };

  const toggle = (id: string) => onChange(items.map((it) => (it.id === id ? { ...it, done: !it.done } : it)));
  const remove = (id: string) => onChange(items.filter((it) => it.id !== id));

  return (
    <div className="card-soft">
      <form onSubmit={addItem} className="mb-4 flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Añadir..." className="field-input flex-1" />
        <button type="submit" className="btn-dark shrink-0">
          + Añadir
        </button>
      </form>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <li key={it.id} className="group flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2.5 text-sm">
              <button
                type="button"
                onClick={() => toggle(it.id)}
                title={it.done ? "Desmarcar" : "Marcar como hecho"}
                className={`flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full border text-[10px] transition-colors ${
                  it.done ? "border-primary bg-primary/20 text-primary" : "border-foreground/30 hover:border-primary/60"
                }`}
              >
                {it.done ? "✓" : ""}
              </button>
              <span className={`min-w-0 flex-1 truncate ${it.done ? "text-muted-foreground line-through" : ""}`}>{it.text}</span>
              <button
                type="button"
                onClick={() => remove(it.id)}
                title="Eliminar"
                className="shrink-0 cursor-pointer text-xs opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Objetivos — metas propias de la página, con barra de progreso (no tocan el modelo Goal real).
// ---------------------------------------------------------------------------------------------
function GoalsTemplate({ goals, onChange }: { goals: SimpleGoal[]; onChange: (goals: SimpleGoal[]) => void }) {
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");

  const addGoal = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    const n = Number(target);
    if (!trimmed || !Number.isFinite(n) || n <= 0) return;
    onChange([...goals, { id: newId(), title: trimmed, target: n, current: 0 }]);
    setTitle("");
    setTarget("");
  };

  const bump = (id: string) =>
    onChange(goals.map((g) => (g.id === id ? { ...g, current: Math.min(g.target, g.current + 1) } : g)));
  const remove = (id: string) => onChange(goals.filter((g) => g.id !== id));

  return (
    <div className="space-y-4">
      <form onSubmit={addGoal} className="grid gap-3 card-soft sm:grid-cols-[1fr_140px_auto]">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nombre del objetivo" className="field-input" />
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          type="number"
          min={1}
          placeholder="Meta"
          className="field-input"
        />
        <button type="submit" className="btn-dark">
          + Añadir
        </button>
      </form>

      {goals.length === 0 ? (
        <EmptyState message="Todavía no tienes objetivos en esta página." />
      ) : (
        <div className="space-y-3">
          {goals.map((g) => {
            const pct = g.target > 0 ? Math.min(100, Math.round((g.current / g.target) * 100)) : 0;
            return (
              <div key={g.id} className="card-soft">
                <div className="mb-2 flex items-center justify-between gap-4">
                  <p className="min-w-0 truncate font-medium">{g.title}</p>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {g.current} / {g.target}
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => bump(g.id)}
                    disabled={g.current >= g.target}
                    className="cursor-pointer rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    +1
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(g.id)}
                    className="cursor-pointer text-xs text-muted-foreground hover:text-destructive"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Finanzas — ingresos/gastos propios de la página, con balance (no tocan Transaction real).
// ---------------------------------------------------------------------------------------------
function FinanceTemplate({ entries, onChange }: { entries: FinanceEntry[]; onChange: (entries: FinanceEntry[]) => void }) {
  const [type, setType] = useState<"income" | "expense">("expense");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");

  const add = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(amount);
    const trimmedCategory = category.trim();
    if (!Number.isFinite(n) || n <= 0 || !trimmedCategory) return;
    onChange([{ id: newId(), type, amount: n, category: trimmedCategory, description: description.trim() }, ...entries]);
    setAmount("");
    setCategory("");
    setDescription("");
  };

  const remove = (id: string) => onChange(entries.filter((entry) => entry.id !== id));

  const balance = entries.reduce((sum, entry) => sum + (entry.type === "income" ? entry.amount : -entry.amount), 0);
  const formatMoney = (n: number) => n.toLocaleString("es-ES", { style: "currency", currency: "EUR" });

  return (
    <div className="space-y-6">
      <div className="card-soft flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Balance</span>
        <span className={`font-serif text-2xl ${balance >= 0 ? "text-primary" : "text-destructive"}`}>{formatMoney(balance)}</span>
      </div>

      <form onSubmit={add} className="grid gap-3 card-soft sm:grid-cols-[120px_120px_1fr_1fr_auto]">
        <select value={type} onChange={(e) => setType(e.target.value as "income" | "expense")} className="field-input">
          <option value="income">Ingreso</option>
          <option value="expense">Gasto</option>
        </select>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          type="number"
          min={0}
          step="0.01"
          placeholder="Importe"
          className="field-input"
        />
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Categoría"
          className="field-input"
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Descripción (opcional)"
          className="field-input"
        />
        <button type="submit" className="btn-dark">
          + Añadir
        </button>
      </form>

      {entries.length === 0 ? (
        <EmptyState message="Todavía no has apuntado ningún movimiento." />
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="group flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{entry.category}</p>
                {entry.description && <p className="truncate text-xs text-muted-foreground">{entry.description}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className={`font-medium ${entry.type === "income" ? "text-primary" : "text-destructive"}`}>
                  {entry.type === "income" ? "+" : "-"}
                  {formatMoney(entry.amount)}
                </span>
                <button
                  type="button"
                  onClick={() => remove(entry.id)}
                  title="Eliminar"
                  className="cursor-pointer text-xs opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Agenda — notas sueltas con fecha, propias de la página (no tocan Event/Note reales).
// ---------------------------------------------------------------------------------------------
function AgendaNotesTemplate({ items, onChange }: { items: AgendaNote[]; onChange: (items: AgendaNote[]) => void }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [text, setText] = useState("");

  const add = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    onChange([...items, { id: newId(), date, text: trimmed }]);
    setText("");
  };

  const remove = (id: string) => onChange(items.filter((it) => it.id !== id));

  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="grid gap-3 card-soft sm:grid-cols-[160px_1fr_auto]">
        <input value={date} onChange={(e) => setDate(e.target.value)} type="date" className="field-input" />
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="¿Qué apuntas?" className="field-input" />
        <button type="submit" className="btn-dark">
          + Añadir
        </button>
      </form>

      {sorted.length === 0 ? (
        <EmptyState message="Todavía no hay notas en esta agenda." />
      ) : (
        <ul className="space-y-2">
          {sorted.map((it) => (
            <li key={it.id} className="group flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-3 text-sm">
              <span className="shrink-0 rounded-full bg-secondary px-3 py-1 text-xs">
                {new Date(`${it.date}T00:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}
              </span>
              <span className="min-w-0 flex-1 truncate">{it.text}</span>
              <button
                type="button"
                onClick={() => remove(it.id)}
                title="Eliminar"
                className="shrink-0 cursor-pointer text-xs opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Mismos colores que el tablero del Planificador (ver COLUMN_STYLES/COLUMN_HEADER_STYLES en
// PlanificadorPage: neutro/amarillo/verde) — aquí se ciclan por posición en vez de por un
// `status` fijo, porque una página de kanban puede tener cualquier número de columnas con el
// nombre que el usuario quiera.
const KANBAN_COLUMN_STYLES = [
  { box: "border-border bg-card", header: "text-foreground" },
  { box: "border-warning/30 bg-warning/10", header: "text-warning" },
  { box: "border-positive/30 bg-positive/10", header: "text-positive" },
];

// Cuántas columnas caben repartidas a partes iguales antes de que el tablero empiece a
// desplazarse en horizontal — ver el cálculo de `columnWidth` en KanbanTemplate.
const MAX_VISIBLE_COLUMNS = 6;

// Igual límite y mecánica que RichTextEditor.insertImage: se embebe como data URL dentro del
// propio JSON de la tarjeta (CustomPage.content), no hay subida a un storage aparte.
const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // 3MB

function readImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Gestión de las "propiedades" personalizadas de ESTE tablero kanban (ver CustomFieldDef en
 * types.ts): texto, número, fecha o selección — mismo concepto que las columnas personalizadas
 * del Planificador (ver PlannerFieldsDialog), pero aquí todo vive en `content.kanban.fieldDefs`
 * (JSON de cliente, sin API propia) en vez de en su propia tabla — por eso `onChange` sustituye
 * la lista entera en vez de hacer llamadas de red por cada cambio.
 */
function KanbanFieldsDialog({
  fieldDefs,
  onChange,
  onClose,
}: {
  fieldDefs: CustomFieldDef[];
  onChange: (fieldDefs: CustomFieldDef[]) => void;
  onClose: () => void;
}) {
  const addField = (name: string, type: CustomFieldType, options?: string[]) => {
    onChange([...fieldDefs, { id: newId(), name, type, options }]);
  };

  const renameField = (fieldId: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    onChange(fieldDefs.map((f) => (f.id === fieldId ? { ...f, name: trimmed } : f)));
  };

  const removeField = (fieldId: string) => onChange(fieldDefs.filter((f) => f.id !== fieldId));

  const moveField = (fieldId: string, direction: "up" | "down") => {
    const index = fieldDefs.findIndex((f) => f.id === fieldId);
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= fieldDefs.length) return;
    const next = [...fieldDefs];
    [next[index], next[swapWith]] = [next[swapWith], next[index]];
    onChange(next);
  };

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-3xl bg-card p-6 shadow-[var(--shadow-soft)]">
        <div className="mb-1 flex items-center justify-between gap-4">
          <h3 className="font-serif text-xl">Propiedades personalizadas</h3>
          <button type="button" onClick={onClose} className="shrink-0 cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            ✕ Cerrar
          </button>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">Añade tus propias propiedades a las tarjetas de este tablero.</p>

        {fieldDefs.length > 0 && (
          <ul className="mb-4 max-h-60 space-y-1 overflow-y-auto">
            {fieldDefs.map((field, index) => (
              <li key={field.id} className="flex items-center gap-1.5 rounded-xl px-2 py-1.5 hover:bg-muted">
                <input
                  defaultValue={field.name}
                  onBlur={(e) => renameField(field.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  className="min-w-0 flex-1 border-b border-transparent bg-transparent text-sm outline-none focus:border-primary"
                />
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{FIELD_TYPE_LABELS[field.type]}</span>
                <button
                  onClick={() => moveField(field.id, "up")}
                  disabled={index === 0}
                  title="Subir"
                  className="shrink-0 cursor-pointer rounded px-1 text-xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  onClick={() => moveField(field.id, "down")}
                  disabled={index === fieldDefs.length - 1}
                  title="Bajar"
                  className="shrink-0 cursor-pointer rounded px-1 text-xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                >
                  ↓
                </button>
                <button onClick={() => removeField(field.id)} title="Eliminar propiedad" className="shrink-0 cursor-pointer rounded px-1 text-xs text-muted-foreground hover:text-destructive">
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        <AddFieldForm onAdd={addField} className="space-y-2 border-t border-border pt-4" />
      </div>
    </div>
  );
}

// Formulario compacto para crear una propiedad personalizada nueva — se usa tanto aquí (la vista
// de gestión completa) como dentro de cada tarjeta (ver InlineAddField/KanbanCardDialog), para no
// obligar a cerrar la tarjeta y volver a la cabecera solo para añadir la propiedad que hace falta
// justo ahora.
function AddFieldForm({
  onAdd,
  className,
}: {
  onAdd: (name: string, type: CustomFieldType, options?: string[]) => void;
  className?: string;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<CustomFieldType>("text");
  const [optionsText, setOptionsText] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const options = type === "select" ? optionsText.split(",").map((o) => o.trim()).filter(Boolean) : undefined;
    onAdd(trimmed, type, options);
    setName("");
    setOptionsText("");
    setType("text");
  };

  return (
    <form onSubmit={submit} className={className ?? "space-y-2"}>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nombre de la propiedad"
        className="field-input w-full text-sm"
      />
      <select value={type} onChange={(e) => setType(e.target.value as CustomFieldType)} className="field-input w-full text-xs">
        {(Object.keys(FIELD_TYPE_LABELS) as CustomFieldType[]).map((t) => (
          <option key={t} value={t}>
            {FIELD_TYPE_LABELS[t]}
          </option>
        ))}
      </select>
      {type === "select" && (
        <input
          value={optionsText}
          onChange={(e) => setOptionsText(e.target.value)}
          placeholder="Opciones separadas por coma"
          className="field-input w-full text-xs"
        />
      )}
      <button type="submit" className="btn-dark w-full text-xs">
        + Añadir propiedad
      </button>
    </form>
  );
}

// Disparador plegado de AddFieldForm — un simple "+ Añadir propiedad" que, al clicarlo, revela el
// formulario. Vive dentro de cada tarjeta (ver KanbanCardDialog) para poder crear una propiedad
// nueva sin salir de ahí.
function InlineAddField({ onAdd }: { onAdd: (name: string, type: CustomFieldType, options?: string[]) => void }) {
  const [adding, setAdding] = useState(false);

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="cursor-pointer text-xs text-muted-foreground hover:text-foreground"
      >
        + Añadir propiedad
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-dashed border-border p-2">
      <AddFieldForm
        onAdd={(name, type, options) => {
          onAdd(name, type, options);
          setAdding(false);
        }}
      />
      <button
        type="button"
        onClick={() => setAdding(false)}
        className="w-full cursor-pointer rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted"
      >
        Cancelar
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Kanban — tablero propio de columnas/tarjetas (no reutiliza Task/Planificador, ver comentario
// en el schema de Prisma) con drag & drop entre columnas y el mismo aspecto (colores, anchura de
// columna) que el tablero del Planificador.
// ---------------------------------------------------------------------------------------------
function KanbanTemplate({
  columns,
  fieldDefs,
  onChange,
  onAddField,
}: {
  columns: KanbanColumn[];
  fieldDefs: CustomFieldDef[];
  onChange: (columns: KanbanColumn[]) => void;
  onAddField: (name: string, type: CustomFieldType, options?: string[]) => void;
}) {
  const [draggedCard, setDraggedCard] = useState<{ columnId: string; cardId: string } | null>(null);
  const [confirmingColumnId, setConfirmingColumnId] = useState<string | null>(null);

  const renameColumn = (columnId: string, title: string) => onChange(columns.map((c) => (c.id === columnId ? { ...c, title } : c)));

  const removeColumn = (columnId: string) => {
    onChange(columns.filter((c) => c.id !== columnId));
    setConfirmingColumnId(null);
  };

  // Igual patrón que el borrado de páginas en ProjectPages: columna vacía se borra directamente,
  // con tarjetas dentro pide confirmar con un segundo clic.
  const handleDeleteColumnClick = (e: React.MouseEvent, column: KanbanColumn) => {
    e.stopPropagation();
    if (column.cards.length === 0 || confirmingColumnId === column.id) {
      removeColumn(column.id);
    } else {
      setConfirmingColumnId(column.id);
    }
  };

  const addCard = (columnId: string, text: string, description: string) => {
    onChange(
      columns.map((c) =>
        c.id === columnId
          ? { ...c, cards: [...c.cards, { id: newId(), text, image: null, description: description || undefined }] }
          : c
      )
    );
  };

  const removeCard = (columnId: string, cardId: string) => {
    onChange(columns.map((c) => (c.id === columnId ? { ...c, cards: c.cards.filter((card) => card.id !== cardId) } : c)));
  };

  // Cualquier cambio sobre una tarjeta existente (texto, imagen, descripción o notas) pasa por
  // aquí — el diálogo de detalles (KanbanCardDialog) llama a esto con solo los campos que ha tocado.
  const updateCard = (columnId: string, cardId: string, fields: Partial<Pick<KanbanCard, "text" | "image" | "description" | "notes" | "compact">>) => {
    onChange(
      columns.map((c) =>
        c.id === columnId
          ? { ...c, cards: c.cards.map((card) => (card.id === cardId ? { ...card, ...fields } : card)) }
          : c
      )
    );
  };

  // Valor de UNA propiedad personalizada — a diferencia de updateCard (que sobrescribe los campos
  // que le pasen), aquí hace falta fusionar a mano con `card.fields` ya existente: si se
  // sobrescribiera entero, cambiar el valor de una propiedad borraría las demás.
  const updateCardField = (columnId: string, cardId: string, fieldId: string, value: CustomFieldValue) => {
    onChange(
      columns.map((c) =>
        c.id === columnId
          ? {
              ...c,
              cards: c.cards.map((card) => (card.id === cardId ? { ...card, fields: { ...card.fields, [fieldId]: value } } : card)),
            }
          : c
      )
    );
  };

  const dropOnColumn = (toColumnId: string) => {
    if (!draggedCard) return;
    const { columnId: fromColumnId, cardId } = draggedCard;
    setDraggedCard(null);
    if (fromColumnId === toColumnId) return;
    const fromColumn = columns.find((c) => c.id === fromColumnId);
    const card = fromColumn?.cards.find((c) => c.id === cardId);
    if (!card) return;
    onChange(
      columns.map((c) => {
        if (c.id === fromColumnId) return { ...c, cards: c.cards.filter((cc) => cc.id !== cardId) };
        if (c.id === toColumnId) return { ...c, cards: [...c.cards, card] };
        return c;
      })
    );
  };

  // Fila horizontal (no grid que envuelve): una columna nueva SIEMPRE se añade al final del
  // array (ver KanbanAddColumnForm → CustomPagePage.updateContent), y aquí eso se traduce
  // directamente en "aparece a la derecha de las demás", sin saltar a una fila de abajo. El ancho
  // de cada columna se calcula para que quepan hasta `MAX_VISIBLE_COLUMNS` a la vez en pantalla
  // (repartiendo el ancho disponible a partes iguales); a partir de la 7ª, en vez de encogerse
  // más, el tablero entero empieza a desplazarse en horizontal (overflow-x-auto) manteniendo el
  // mismo ancho por columna — así nunca quedan ilegiblemente estrechas.
  const visibleColumns = Math.max(1, Math.min(columns.length, MAX_VISIBLE_COLUMNS));
  const columnWidth = `max(240px, calc((100% - ${(visibleColumns - 1) * 1.5}rem) / ${visibleColumns}))`;

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex gap-6">
        {columns.map((column, index) => (
          <div key={column.id} className="shrink-0" style={{ width: columnWidth }}>
            <KanbanColumnView
              column={column}
              fieldDefs={fieldDefs}
              style={KANBAN_COLUMN_STYLES[index % KANBAN_COLUMN_STYLES.length]}
              confirmingDelete={confirmingColumnId === column.id}
              draggedCardId={draggedCard?.cardId ?? null}
              onDragStartCard={(cardId) => setDraggedCard({ columnId: column.id, cardId })}
              onDropCard={() => dropOnColumn(column.id)}
              onRename={(title) => renameColumn(column.id, title)}
              onDeleteClick={(e) => handleDeleteColumnClick(e, column)}
              onDeleteBlur={() => setConfirmingColumnId((id) => (id === column.id ? null : id))}
              onAddCard={(text, description) => addCard(column.id, text, description)}
              onRemoveCard={(cardId) => removeCard(column.id, cardId)}
              onCardUpdate={(cardId, fields) => updateCard(column.id, cardId, fields)}
              onCardFieldUpdate={(cardId, fieldId, value) => updateCardField(column.id, cardId, fieldId, value)}
              onAddField={onAddField}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// Alternativa en tabla al mismo `columns` — mismo patrón vista-previa/diálogo que KanbanCardItem
// (clicar el nombre abre KanbanCardDialog), pero todas las tarjetas de todas las columnas en una
// sola lista, con la columna como una celda más (select) en vez de una agrupación visual. No
// tiene drag & drop propio: mover una tarjeta de columna es el `<select>` de la fila.
function KanbanTableView({
  columns,
  fieldDefs,
  onChange,
  onAddField,
}: {
  columns: KanbanColumn[];
  fieldDefs: CustomFieldDef[];
  onChange: (columns: KanbanColumn[]) => void;
  onAddField: (name: string, type: CustomFieldType, options?: string[]) => void;
}) {
  const [openCard, setOpenCard] = useState<{ columnId: string; cardId: string } | null>(null);
  const [addingColumnId, setAddingColumnId] = useState<string | null>(null);
  const [newCardText, setNewCardText] = useState("");

  const rows = columns.flatMap((column) => column.cards.map((card) => ({ column, card })));

  const updateCardField = (columnId: string, cardId: string, fieldId: string, value: CustomFieldValue) => {
    onChange(
      columns.map((c) =>
        c.id === columnId
          ? { ...c, cards: c.cards.map((card) => (card.id === cardId ? { ...card, fields: { ...card.fields, [fieldId]: value } } : card)) }
          : c
      )
    );
  };

  const moveCard = (fromColumnId: string, cardId: string, toColumnId: string) => {
    if (fromColumnId === toColumnId) return;
    const fromColumn = columns.find((c) => c.id === fromColumnId);
    const card = fromColumn?.cards.find((c) => c.id === cardId);
    if (!card) return;
    onChange(
      columns.map((c) => {
        if (c.id === fromColumnId) return { ...c, cards: c.cards.filter((cc) => cc.id !== cardId) };
        if (c.id === toColumnId) return { ...c, cards: [...c.cards, card] };
        return c;
      })
    );
  };

  const removeCard = (columnId: string, cardId: string) => {
    onChange(columns.map((c) => (c.id === columnId ? { ...c, cards: c.cards.filter((card) => card.id !== cardId) } : c)));
  };

  const updateCard = (columnId: string, cardId: string, fields: Partial<Pick<KanbanCard, "text" | "image" | "description" | "notes" | "compact">>) => {
    onChange(columns.map((c) => (c.id === columnId ? { ...c, cards: c.cards.map((card) => (card.id === cardId ? { ...card, ...fields } : card)) } : c)));
  };

  const addCard = (columnId: string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onChange(columns.map((c) => (c.id === columnId ? { ...c, cards: [...c.cards, { id: newId(), text: trimmed, image: null }] } : c)));
    setNewCardText("");
    setAddingColumnId(null);
  };

  const openCardData = openCard ? columns.find((c) => c.id === openCard.columnId)?.cards.find((c) => c.id === openCard.cardId) : null;

  if (columns.length === 0) {
    return <p className="rounded-3xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">Añade una columna para empezar.</p>;
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-[var(--shadow-soft)]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs font-medium uppercase tracking-widest text-muted-foreground">
              <th className="px-4 py-3">Nombre</th>
              <th className="w-48 px-4 py-3">Columna</th>
              <th className="px-4 py-3">Descripción</th>
              {fieldDefs.map((field) => (
                <th key={field.id} className="w-32 px-4 py-3">
                  {field.name}
                </th>
              ))}
              <th className="w-16 px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4 + fieldDefs.length} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  Sin tarjetas
                </td>
              </tr>
            ) : (
              rows.map(({ column, card }) => (
                <tr key={card.id} className="group">
                  <td className="max-w-0 px-4 py-2.5">
                    <button
                      onClick={() => setOpenCard({ columnId: column.id, cardId: card.id })}
                      className="flex w-full min-w-0 cursor-pointer items-center gap-1.5 truncate text-left text-sm hover:underline"
                    >
                      {card.image && <span aria-hidden="true">🖼</span>}
                      <span className="min-w-0 truncate">{card.text}</span>
                      {card.notes && <span className="shrink-0 text-xs text-muted-foreground">📝</span>}
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
                    <select
                      value={column.id}
                      onChange={(e) => moveCard(column.id, card.id, e.target.value)}
                      className="field-input w-full text-xs"
                    >
                      {columns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="max-w-0 px-4 py-2.5 text-sm text-muted-foreground">
                    <span className="block truncate">{card.description}</span>
                  </td>
                  {fieldDefs.map((field) => (
                    <td key={field.id} className="px-4 py-2.5">
                      <CustomFieldInput
                        type={field.type}
                        options={field.options}
                        value={card.fields?.[field.id] ?? null}
                        onChange={(value) => updateCardField(column.id, card.id, field.id, value)}
                      />
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => removeCard(column.id, card.id)}
                      className="cursor-pointer text-xs text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                      aria-label="Eliminar tarjeta"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Añadir tarjeta: elige columna igual que el select de cada fila, en vez de un formulario
          por columna como en la vista kanban. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          addCard(addingColumnId ?? columns[0].id, newCardText);
        }}
        className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3"
      >
        <input
          value={newCardText}
          onChange={(e) => setNewCardText(e.target.value)}
          placeholder="+ Tarjeta"
          className="field-input min-w-0 flex-1 text-sm"
        />
        <select
          value={addingColumnId ?? columns[0].id}
          onChange={(e) => setAddingColumnId(e.target.value)}
          className="field-input text-xs"
        >
          {columns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <button type="submit" className="btn-dark shrink-0 px-3 py-2 text-xs">
          Añadir
        </button>
      </form>

      {openCard && openCardData && (
        <KanbanCardDialog
          card={openCardData}
          fieldDefs={fieldDefs}
          onClose={() => setOpenCard(null)}
          onUpdate={(fields) => updateCard(openCard.columnId, openCard.cardId, fields)}
          onFieldUpdate={(fieldId, value) => updateCardField(openCard.columnId, openCard.cardId, fieldId, value)}
          onAddField={onAddField}
          onRemove={() => {
            removeCard(openCard.columnId, openCard.cardId);
            setOpenCard(null);
          }}
        />
      )}
    </div>
  );
}

// Formulario de "+ Columna" — vive en la cabecera de la página (junto a "Eliminar página"), así
// que es puramente presentacional: no conoce `columns`, solo pide un título y avisa al padre.
function KanbanAddColumnForm({ onAdd }: { onAdd: (title: string) => void }) {
  const [title, setTitle] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setTitle("");
  };

  return (
    <form onSubmit={submit} className="flex gap-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Nueva columna"
        className="field-input w-40 text-sm"
      />
      <button type="submit" className="btn-dark shrink-0 px-3 py-2 text-xs">
        + Columna
      </button>
    </form>
  );
}

function KanbanColumnView({
  column,
  fieldDefs,
  style,
  confirmingDelete,
  draggedCardId,
  onDragStartCard,
  onDropCard,
  onRename,
  onDeleteClick,
  onDeleteBlur,
  onAddCard,
  onRemoveCard,
  onCardUpdate,
  onCardFieldUpdate,
  onAddField,
}: {
  column: KanbanColumn;
  fieldDefs: CustomFieldDef[];
  style: { box: string; header: string };
  confirmingDelete: boolean;
  draggedCardId: string | null;
  onDragStartCard: (cardId: string) => void;
  onDropCard: () => void;
  onRename: (title: string) => void;
  onDeleteClick: (e: React.MouseEvent) => void;
  onDeleteBlur: () => void;
  onAddCard: (text: string, description: string) => void;
  onRemoveCard: (cardId: string) => void;
  onCardUpdate: (cardId: string, fields: Partial<Pick<KanbanCard, "text" | "image" | "description" | "notes" | "compact">>) => void;
  onCardFieldUpdate: (cardId: string, fieldId: string, value: CustomFieldValue) => void;
  onAddField: (name: string, type: CustomFieldType, options?: string[]) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [adding, setAdding] = useState(false);
  const [cardText, setCardText] = useState("");
  const [cardDescription, setCardDescription] = useState("");

  const submitCard = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = cardText.trim();
    if (!trimmed) return;
    onAddCard(trimmed, cardDescription.trim());
    setCardText("");
    setCardDescription("");
    setAdding(false);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        onDropCard();
      }}
      className={`flex flex-col gap-3 rounded-3xl border p-4 transition-colors ${dragOver ? "border-primary/50 bg-primary/5" : style.box}`}
    >
      <div className="flex items-center justify-between gap-2 px-1">
        <input
          value={column.title}
          onChange={(e) => onRename(e.target.value)}
          className={`min-w-0 flex-1 truncate bg-transparent text-sm font-medium outline-none focus:underline ${style.header}`}
        />
        <span className="shrink-0 text-xs text-muted-foreground">{column.cards.length}</span>
        <span
          role="button"
          title={confirmingDelete ? "Confirmar eliminar" : "Eliminar columna"}
          onClick={onDeleteClick}
          onMouseLeave={onDeleteBlur}
          className={`shrink-0 cursor-pointer text-xs ${
            confirmingDelete ? "font-bold text-destructive" : "text-muted-foreground opacity-60 hover:opacity-100"
          }`}
        >
          ✕
        </span>
      </div>

      <div className="flex min-h-16 flex-col gap-2">
        {column.cards.length === 0 && !dragOver && (
          <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            Sin tarjetas
          </p>
        )}
        {column.cards.map((card: KanbanCard) => (
          <KanbanCardItem
            key={card.id}
            card={card}
            fieldDefs={fieldDefs}
            isDragged={draggedCardId === card.id}
            onDragStart={() => onDragStartCard(card.id)}
            onRemove={() => onRemoveCard(card.id)}
            onUpdate={(fields) => onCardUpdate(card.id, fields)}
            onFieldUpdate={(fieldId, value) => onCardFieldUpdate(card.id, fieldId, value)}
            onAddField={onAddField}
          />
        ))}
      </div>

      {!adding ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="w-full cursor-pointer rounded-xl border border-dashed border-border px-3 py-2 text-center text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
        >
          + Tarjeta
        </button>
      ) : (
        <form onSubmit={submitCard} className="space-y-2">
          <input
            autoFocus
            value={cardText}
            onChange={(e) => setCardText(e.target.value)}
            placeholder="Título de la tarjeta"
            className="field-input w-full text-sm"
          />
          <textarea
            value={cardDescription}
            onChange={(e) => setCardDescription(e.target.value)}
            placeholder="Descripción (opcional)"
            rows={2}
            className="field-input w-full resize-y text-sm"
          />
          <div className="flex gap-2">
            <button type="submit" className="btn-dark flex-1 text-xs">
              Añadir
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setCardText("");
                setCardDescription("");
              }}
              className="cursor-pointer rounded-full border border-border px-3 text-xs text-muted-foreground transition-colors hover:bg-muted"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// La tarjeta es solo una vista previa (texto + imagen) — clicarla abre KanbanCardDialog, donde
// vive la edición de verdad (texto, imagen, notas). Mismo reparto vista-previa/diálogo que
// TaskCard/TaskDetailDialog en el Planificador.
function KanbanCardItem({
  card,
  fieldDefs,
  isDragged,
  onDragStart,
  onRemove,
  onUpdate,
  onFieldUpdate,
  onAddField,
}: {
  card: KanbanCard;
  fieldDefs: CustomFieldDef[];
  isDragged: boolean;
  onDragStart: () => void;
  onRemove: () => void;
  onUpdate: (fields: Partial<Pick<KanbanCard, "text" | "image" | "description" | "notes" | "compact">>) => void;
  onFieldUpdate: (fieldId: string, value: CustomFieldValue) => void;
  onAddField: (name: string, type: CustomFieldType, options?: string[]) => void;
}) {
  const [detailOpen, setDetailOpen] = useState(false);

  return (
    <>
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", card.id);
          onDragStart();
        }}
        onClick={() => setDetailOpen(true)}
        title="Haz clic para ver los detalles"
        className={`group cursor-grab rounded-xl border border-border bg-background p-3 text-sm transition-all active:cursor-grabbing ${isDragged ? "opacity-40" : ""}`}
      >
        {/* "Compactar" (ver KanbanCardDialog) pone la imagen a la izquierda como miniatura en vez
            de a ancho completo encima del texto — sin efecto si la tarjeta no tiene imagen. */}
        {card.compact && card.image ? (
          <div className="flex items-start gap-2.5">
            <img src={card.image} alt="" className="size-14 shrink-0 rounded-lg object-cover" />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{card.text}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove();
                  }}
                  title="Eliminar tarjeta"
                  className="shrink-0 cursor-pointer text-xs opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
                >
                  ✕
                </button>
              </div>
              {card.description && <p className="mt-1.5 truncate text-xs text-muted-foreground">{card.description}</p>}
            </div>
          </div>
        ) : (
          <>
            {card.image && <img src={card.image} alt="" className="mb-2 max-h-40 w-full rounded-lg object-cover" />}

            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{card.text}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
                title="Eliminar tarjeta"
                className="shrink-0 cursor-pointer text-xs opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
              >
                ✕
              </button>
            </div>

            {card.description && <p className="mt-1.5 truncate text-xs text-muted-foreground">{card.description}</p>}
          </>
        )}

        {(card.notes || fieldDefs.length > 0) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {card.notes && <span className="text-xs text-muted-foreground">📝</span>}
            {fieldDefs.map((field) => {
              const value = card.fields?.[field.id] ?? null;
              if (value === null || value === "") return null;
              return (
                <span key={field.id} className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                  {field.name}: {formatCustomFieldValue(field.type, value)}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {detailOpen && (
        <KanbanCardDialog
          card={card}
          fieldDefs={fieldDefs}
          onClose={() => setDetailOpen(false)}
          onUpdate={onUpdate}
          onFieldUpdate={onFieldUpdate}
          onAddField={onAddField}
          onRemove={onRemove}
        />
      )}
    </>
  );
}

/**
 * Diálogo de detalles de una tarjeta de kanban personalizado — mismo reparto de campos que
 * TaskDetailDialog en el Planificador, pero solo con lo que se decidió compartir entre ambos:
 * texto de la tarjeta, imagen y el recuadro grande SIN nombre para notas libres. Fecha
 * límite/prioridad/subtareas/tiempo siguen siendo exclusivos del Planificador.
 */
function KanbanCardDialog({
  card,
  fieldDefs,
  onClose,
  onUpdate,
  onFieldUpdate,
  onAddField,
  onRemove,
}: {
  card: KanbanCard;
  fieldDefs: CustomFieldDef[];
  onClose: () => void;
  onUpdate: (fields: Partial<Pick<KanbanCard, "text" | "image" | "description" | "notes" | "compact">>) => void;
  onFieldUpdate: (fieldId: string, value: CustomFieldValue) => void;
  onAddField: (name: string, type: CustomFieldType, options?: string[]) => void;
  onRemove: () => void;
}) {
  const [text, setText] = useState(card.text);
  const [description, setDescription] = useState(card.description ?? "");
  const [notes, setNotes] = useState(card.notes ?? "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // El textarea de notas es redimensionable en ambas direcciones (ver className más abajo), para
  // agrandarlo o para encogerlo. Igual que en TaskDetailDialog del Planificador: el propio
  // diálogo sigue ese ancho en vez de dejar que el texto se salga por fuera (al agrandar) o que
  // quede un hueco de sobra alrededor (al encoger) — aquí no hay una segunda columna con la que
  // chocar, así que basta con ajustar el ancho del diálogo entero.
  const modalRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const naturalSizeRef = useRef<{ modalWidth: number; notesWidth: number } | null>(null);
  const [customModalWidth, setCustomModalWidth] = useState<number | null>(null);

  useEffect(() => {
    const notesEl = notesRef.current;
    if (!notesEl) return;
    const observer = new ResizeObserver(() => {
      if (!modalRef.current) return;
      // La primera medida (antes de que el usuario toque el tirador) es la referencia "de
      // fábrica" con la que comparar cuánto se ha movido, en cualquiera de los dos sentidos.
      if (!naturalSizeRef.current) {
        naturalSizeRef.current = { modalWidth: modalRef.current.getBoundingClientRect().width, notesWidth: notesEl.getBoundingClientRect().width };
        return;
      }
      const { modalWidth, notesWidth } = naturalSizeRef.current;
      const delta = notesEl.getBoundingClientRect().width - notesWidth;
      if (Math.abs(delta) <= 2) {
        setCustomModalWidth(null);
        return;
      }
      // Al agrandar, tope en el 95% del ancho de la ventana; al encoger, el propio `min-w-*`
      // del textarea ya pone el límite.
      const maxModalWidth = window.innerWidth * 0.95;
      const clampedDelta = delta > 0 ? Math.min(delta, Math.max(maxModalWidth - modalWidth, 0)) : delta;
      setCustomModalWidth(modalWidth + clampedDelta);
    });
    observer.observe(notesEl);
    return () => observer.disconnect();
  }, []);

  const saveText = () => {
    const trimmed = text.trim();
    if (!trimmed) {
      setText(card.text);
      return;
    }
    if (trimmed === card.text) return;
    onUpdate({ text: trimmed });
  };

  const saveDescription = () => {
    const trimmed = description.trim();
    if (trimmed === (card.description ?? "")) return;
    onUpdate({ description: trimmed || undefined });
  };

  const saveNotes = () => {
    if (notes === (card.notes ?? "")) return;
    onUpdate({ notes: notes || null });
  };

  const handleImageFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    if (file.size > MAX_IMAGE_BYTES) {
      window.alert("La imagen es demasiado grande (máx. 3 MB).");
      return;
    }
    onUpdate({ image: await readImageFile(file) });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-foreground/50 p-4"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        style={customModalWidth ? { width: `${customModalWidth}px`, maxWidth: "95vw" } : undefined}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-card p-6 shadow-[var(--shadow-soft)] sm:p-8"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={saveText}
            rows={1}
            className="min-w-0 flex-1 resize-none border-b border-transparent bg-transparent font-serif text-2xl outline-none focus:border-primary"
          />
          <button type="button" onClick={onClose} className="shrink-0 cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            ✕ Cerrar
          </button>
        </div>

        {card.image && <img src={card.image} alt="" className="mb-3 max-h-56 w-full rounded-xl object-cover" />}
        <div className="mb-5 flex items-center gap-3 text-xs">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="cursor-pointer text-muted-foreground hover:text-foreground"
          >
            {card.image ? "🖼 Cambiar imagen" : "🖼 Añadir imagen"}
          </button>
          {card.image && (
            <button
              type="button"
              onClick={() => onUpdate({ image: null })}
              className="cursor-pointer text-muted-foreground hover:text-destructive"
            >
              Quitar imagen
            </button>
          )}
          {/* Solo tiene sentido con imagen puesta — ver KanbanCardItem para el layout resultante
              (imagen a la izquierda como miniatura, texto a la derecha, en vez de a ancho
              completo encima). */}
          {card.image && (
            <button
              type="button"
              onClick={() => onUpdate({ compact: !card.compact })}
              className="cursor-pointer text-muted-foreground hover:text-foreground"
            >
              {card.compact ? "Expandir" : "Compactar"}
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              void handleImageFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>

        <label className="mb-4 flex flex-col gap-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Descripción
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={saveDescription}
            rows={2}
            placeholder="Resumen corto (opcional)"
            className="field-input w-full resize-y text-sm normal-case tracking-normal"
          />
        </label>

        {/* Recuadro grande SIN nombre — todo lo demás que el usuario quiera escribir.
            `w-full` es solo el ancho DE PARTIDA; `resize` (no solo `resize-y`) deja tirar tanto
            del ancho como del alto — al arrastrar, el navegador fija un ancho en línea que manda
            por encima de `w-full`, así que puede bajar hasta el suelo de `min-w-[12rem]` o subir
            lo que haga falta. El `ResizeObserver` de arriba sigue ese ancho en ambos sentidos y
            ajusta el diálogo entero. */}
        <textarea
          ref={notesRef}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={saveNotes}
          rows={8}
          placeholder="Escribe aquí…"
          className="field-input mb-5 w-full min-w-[12rem] resize text-sm"
        />

        {/* Propiedades personalizadas — una por cada CustomFieldDef de este tablero, más
            "+ Añadir propiedad" para crear una nueva sin salir de la tarjeta (igual que
            "+ Propiedad" en la cabecera de la página, ver KanbanFieldsDialog). */}
        <div className="mb-5 space-y-2 border-t border-border pt-4">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Propiedades personalizadas</p>
          {fieldDefs.map((field) => (
            <label key={field.id} className="block text-xs text-muted-foreground">
              {field.name}
              <CustomFieldInput
                type={field.type}
                options={field.options}
                value={card.fields?.[field.id] ?? null}
                onChange={(value) => onFieldUpdate(field.id, value)}
              />
            </label>
          ))}
          <InlineAddField onAdd={onAddField} />
        </div>

        <div className="flex justify-end border-t border-border pt-4">
          <button
            onClick={() => {
              if (!confirmingDelete) {
                setConfirmingDelete(true);
                return;
              }
              onRemove();
              onClose();
            }}
            onBlur={() => setConfirmingDelete(false)}
            className={`cursor-pointer whitespace-nowrap rounded-full px-4 py-1.5 text-xs transition-colors ${
              confirmingDelete
                ? "bg-destructive text-destructive-foreground"
                : "border border-border text-muted-foreground hover:text-destructive"
            }`}
          >
            {confirmingDelete ? "¿Confirmar eliminar?" : "Eliminar tarjeta"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Galería — collage de fotos y notas en columnas (estilo "pared de marcos"), como el kanban de
// arriba todo vive en `content.galeria.items` (JSON de cliente, sin API propia): "id" es un uuid
// generado en el cliente (ver newId), y crear/editar/borrar es sustituir el array entero vía
// `onChange`, que CustomPagePage debounza igual que el resto de plantillas.
// ---------------------------------------------------------------------------------------------
function GalleryTemplate({
  items,
  onChange,
  openId,
  onOpenChange,
}: {
  items: GalleryEntry[];
  onChange: (items: GalleryEntry[]) => void;
  openId: string | null;
  onOpenChange: (id: string | null) => void;
}) {
  const openItem = items.find((i) => i.id === openId) ?? null;

  const updateItem = (id: string, patch: Partial<GalleryEntry>) => {
    onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  };

  const removeItem = (id: string) => {
    onChange(items.filter((i) => i.id !== id));
    onOpenChange(null);
  };

  if (items.length === 0) {
    return <EmptyState message="Todavía no hay nada en esta galería. Añade tu primera entrada." />;
  }

  return (
    <>
      {/* `columns-*` (no grid) a propósito: cada tarjeta cae en la columna más corta y con su
          propia altura (ver frameHeightFor), así que las fotos quedan a "distintas posiciones"
          como una pared de marcos, sin JS de más. */}
      <div className="columns-2 gap-4 sm:columns-3 lg:columns-4">
        {items.map((item) => (
          <GalleryTile key={item.id} item={item} onClick={() => onOpenChange(item.id)} />
        ))}
      </div>

      {openItem && (
        <GalleryItemDialog
          item={openItem}
          onClose={() => onOpenChange(null)}
          onChange={(patch) => updateItem(openItem.id, patch)}
          onRemove={() => removeItem(openItem.id)}
        />
      )}
    </>
  );
}

function GalleryTile({ item, onClick }: { item: GalleryEntry; onClick: () => void }) {
  const heightClass = frameHeightFor(item.id);
  const hasText = Boolean(item.title || item.text);

  return (
    <button
      onClick={onClick}
      title={item.title || "Abrir entrada"}
      className={`group relative mb-4 block w-full cursor-pointer overflow-hidden rounded-2xl text-left shadow-[var(--shadow-soft)] transition-transform hover:-translate-y-0.5 ${heightClass}`}
    >
      {item.imageData ? (
        <>
          <img src={item.imageData} alt={item.title ?? ""} className="size-full object-cover" />
          {item.title && (
            <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-foreground/70 to-transparent px-3 pb-2 pt-6 text-sm font-medium text-background opacity-0 transition-opacity group-hover:opacity-100">
              {item.title}
            </span>
          )}
        </>
      ) : (
        <div className={`flex size-full flex-col justify-end gap-1 p-4 ${placeholderColorFor(item.id)}`}>
          {hasText ? (
            <>
              {item.title && <p className="truncate font-serif text-lg">{item.title}</p>}
              {item.text && <p className="line-clamp-4 text-xs text-muted-foreground">{item.text}</p>}
            </>
          ) : (
            <span className="self-center text-3xl opacity-30" aria-hidden="true">
              🖼️
            </span>
          )}
        </div>
      )}
    </button>
  );
}

function GalleryItemDialog({
  item,
  onClose,
  onChange,
  onRemove,
}: {
  item: GalleryEntry;
  onClose: () => void;
  onChange: (patch: Partial<GalleryEntry>) => void;
  onRemove: () => void;
}) {
  const [title, setTitle] = useState(item.title ?? "");
  const [text, setText] = useState(item.text ?? "");
  const [fullscreen, setFullscreen] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Confirmación "clic otra vez" (no window.confirm) — mismo patrón que "Eliminar tarjeta" de
  // KanbanCardDialog / "Eliminar página" de arriba.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    if (file.size > MAX_IMAGE_BYTES) {
      window.alert("La imagen es demasiado grande (máx. 3 MB).");
      return;
    }
    setUploading(true);
    try {
      onChange({ imageData: await readImageFile(file) });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-foreground/50 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={
          fullscreen
            ? "flex h-full w-full flex-col overflow-y-auto rounded-none bg-card p-6 sm:p-10"
            : "flex max-h-[90vh] w-full max-w-3xl flex-col overflow-y-auto rounded-3xl bg-card p-6 shadow-[var(--shadow-soft)] sm:p-8"
        }
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              onChange({ title: e.target.value || undefined });
            }}
            placeholder="Título (opcional)"
            className="min-w-0 flex-1 border-b border-transparent bg-transparent font-serif text-2xl outline-none focus:border-primary"
          />
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setFullscreen((v) => !v)}
              title={fullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
              className="cursor-pointer rounded-lg p-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {fullscreen ? "⤡" : "⛶"}
            </button>
            <button
              type="button"
              onClick={onClose}
              title="Cerrar"
              className="cursor-pointer rounded-lg p-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              ✕
            </button>
          </div>
        </div>

        <div className={fullscreen ? "grid flex-1 gap-6 lg:grid-cols-[1fr_1.2fr]" : "space-y-4"}>
          <div className={fullscreen ? "flex flex-col gap-2" : ""}>
            {item.imageData ? (
              <div className="relative overflow-hidden rounded-2xl">
                <img
                  src={item.imageData}
                  alt={title}
                  className={fullscreen ? "max-h-[60vh] w-full object-contain" : "max-h-80 w-full object-cover"}
                />
                <div className="absolute right-2 top-2 flex gap-1">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="cursor-pointer rounded-lg bg-background/80 px-2 py-1 text-xs font-medium text-foreground shadow-sm hover:bg-background"
                  >
                    Cambiar
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange({ imageData: null })}
                    className="cursor-pointer rounded-lg bg-background/80 px-2 py-1 text-xs font-medium text-destructive shadow-sm hover:bg-background"
                  >
                    Quitar
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className={`flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary/30 text-sm text-muted-foreground hover:bg-primary/5 ${fullscreen ? "h-64" : "h-40"}`}
              >
                <span className="text-2xl" aria-hidden="true">
                  🖼️
                </span>
                {uploading ? "Subiendo..." : "Añadir foto"}
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                handleImageFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>

          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              onChange({ text: e.target.value || undefined });
            }}
            placeholder="Escribe lo que quieras sobre esta entrada..."
            className={`field-input w-full resize-y text-sm normal-case tracking-normal ${fullscreen ? "h-full min-h-[50vh] flex-1" : "min-h-[10rem]"}`}
          />
        </div>

        <button
          type="button"
          onClick={() => {
            if (!confirmingDelete) {
              setConfirmingDelete(true);
              return;
            }
            onRemove();
          }}
          onBlur={() => setConfirmingDelete(false)}
          className={`mt-4 cursor-pointer self-start whitespace-nowrap rounded-full px-3 py-1.5 text-xs transition-colors ${
            confirmingDelete
              ? "bg-destructive text-destructive-foreground"
              : "text-muted-foreground hover:text-destructive"
          }`}
        >
          {confirmingDelete ? "¿Confirmar eliminar?" : "Eliminar entrada"}
        </button>
      </div>
    </div>
  );
}
