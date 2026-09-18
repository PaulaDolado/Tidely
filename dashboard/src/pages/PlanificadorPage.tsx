import { FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PageHeader } from "../components/AppShell";
import { api } from "../api/client";
import { useFetch } from "../hooks/useFetch";
import { Loading, ErrorMessage } from "../components/Feedback";
import { CustomFieldInput, formatCustomFieldValue } from "../components/CustomFieldInput";
import { CustomFieldType, CustomFieldValue, Planner, PlannerField, Task, TaskPriority, TaskStatus, Subtask, Project } from "../types";

const FIELD_TYPE_LABELS: Record<CustomFieldType, string> = { text: "Texto", number: "Número", date: "Fecha", select: "Selección" };

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "todo", label: "Por hacer" },
  { status: "in_progress", label: "En progreso" },
  { status: "done", label: "Hecho" },
];

// Kanban sigue siendo la vista por defecto (ver useState más abajo) — tabla es una alternativa
// sobre las mismas tareas, mismo patrón de toggle que ViewMode en AgendaPage.
type ViewMode = "kanban" | "table";
const VIEW_MODES: { value: ViewMode; label: string }[] = [
  { value: "kanban", label: "Kanban" },
  { value: "table", label: "Tabla" },
];

// Recuadro de cada columna: neutro para "Por hacer", amarillo para "En progreso", verde para "Hecho".
const COLUMN_STYLES: Record<TaskStatus, string> = {
  todo: "border-border bg-card",
  in_progress: "border-warning/30 bg-warning/10",
  done: "border-positive/30 bg-positive/10",
};
const COLUMN_HEADER_STYLES: Record<TaskStatus, string> = {
  todo: "text-foreground",
  in_progress: "text-warning",
  done: "text-positive",
};

const PRIORITY_ORDER: TaskPriority[] = ["low", "medium", "high"];
const PRIORITY_LABELS: Record<TaskPriority, string> = { low: "Baja", medium: "Media", high: "Alta" };
const PRIORITY_STYLES: Record<TaskPriority, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-warning/15 text-warning",
  high: "bg-destructive/15 text-destructive",
};

// Igual límite y mecánica que RichTextEditor.insertImage y el kanban de páginas personalizadas:
// se embebe como data URL, no hay subida a un storage aparte.
const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // 3MB

interface TaskFields {
  title?: string;
  description?: string | null;
  image?: string | null;
  notes?: string | null;
  // Vista "compacta" de la tarjeta en el tablero (ver TaskCard): imagen a la izquierda, título/
  // descripción a la derecha, en vez de la imagen a ancho completo encima del texto. Sin efecto
  // si la tarea no tiene imagen.
  compact?: boolean;
  dueDate?: string | null;
  tags?: string[];
  estimatedMinutes?: number | null;
  projectId?: number | null;
  // PATCH, no reemplazo entero — ver plannerService.updateTask en el backend: solo se combinan
  // las claves presentes aquí con lo que ya hubiera, el resto de columnas personalizadas no se
  // tocan.
  customFields?: Record<string, CustomFieldValue>;
}

function toDateInputValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

function dueBadge(task: Task): { label: string; className: string } | null {
  if (!task.dueDate) return null;
  const due = new Date(task.dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  const label = due.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });

  if (task.status === "done") return { label, className: "bg-muted text-muted-foreground" };
  if (diffDays < 0) return { label: `Venció ${label}`, className: "bg-destructive/15 text-destructive" };
  if (diffDays === 0) return { label: "Hoy", className: "bg-destructive/15 text-destructive" };
  if (diffDays <= 2) return { label, className: "bg-warning/15 text-warning" };
  return { label, className: "bg-muted text-muted-foreground" };
}

const BOARD_VIEW_MODE_KEY = "life-organizer:planner-board-view-mode";
type BoardViewMode = "flechas" | "apilado";

/**
 * El usuario puede tener varios tableros de planificador con nombre propio (uno por área de
 * vida — "Trabajo", "Personal"...) — mismo patrón que Schedule (Horario): flechas para ver uno en
 * uno (por defecto) o todos apilados. Esta página es solo el "shell" que gestiona esa lista de
 * planners (crear/renombrar/reordenar/borrar) y delega el tablero de tareas de cada uno a
 * PlannerBoard.
 */
export function PlanificadorPage({
  focusTaskId,
  focusPlannerId,
  onFocusHandled,
}: {
  // Llegada desde un resultado de la búsqueda global (ver AppShell.GlobalSearch): la tarjeta
  // de esta tarea abre directamente el diálogo de detalles y se desplaza a la vista al montar.
  // `focusPlannerId` es a qué tablero saltar primero (en vista Flechas) para poder encontrarla.
  focusTaskId?: number;
  focusPlannerId?: number;
  onFocusHandled?: () => void;
} = {}) {
  const { data, loading, error, reload } = useFetch(() => api.get<{ planners: Planner[] }>("/planner/boards"), []);
  const { data: projectsData } = useFetch(() => api.get<{ projects: Project[] }>("/projects?limit=100"), []);
  const planners = data?.planners ?? [];
  const projects = projectsData?.projects ?? [];

  const [contentView, setContentView] = useState<ViewMode>("kanban");
  const [boardView, setBoardView] = useState<BoardViewMode>(() => (localStorage.getItem(BOARD_VIEW_MODE_KEY) as BoardViewMode) || "flechas");
  const [activeIndex, setActiveIndex] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  // Igual patrón que SchedulePage: el planner recién creado (o el que hay que buscar por
  // `focusPlannerId`) puede no estar aún en `planners` en el momento de pedir el salto — este id
  // "pendiente" se consume en cuanto aparece, en el efecto de abajo.
  const [pendingFocusId, setPendingFocusId] = useState<number | null>(null);

  useEffect(() => {
    if (activeIndex > planners.length - 1) setActiveIndex(Math.max(0, planners.length - 1));
  }, [planners.length, activeIndex]);

  useEffect(() => {
    if (focusPlannerId !== undefined) setPendingFocusId(focusPlannerId);
  }, [focusPlannerId]);

  useEffect(() => {
    if (pendingFocusId === null) return;
    const index = planners.findIndex((p) => p.id === pendingFocusId);
    if (index !== -1) {
      setActiveIndex(index);
      setPendingFocusId(null);
    }
  }, [planners, pendingFocusId]);

  const changeBoardView = (mode: BoardViewMode) => {
    setBoardView(mode);
    localStorage.setItem(BOARD_VIEW_MODE_KEY, mode);
  };

  const createPlanner = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    const created = await api.post<Planner>("/planner/boards", { name: trimmed });
    setNewName("");
    setShowCreate(false);
    setPendingFocusId(created.id);
    reload();
  };

  const renamePlanner = async (id: number, name: string) => {
    await api.put(`/planner/boards/${id}`, { name });
    reload();
  };

  const deletePlanner = async (id: number) => {
    await api.delete(`/planner/boards/${id}`);
    reload();
  };

  const movePlanner = async (id: number, direction: "up" | "down") => {
    await api.put(`/planner/boards/${id}/move`, { direction });
    reload();
  };

  return (
    <>
      <PageHeader
        title="Planificador"
        subtitle="Administrador de tareas"
        action={
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 rounded-full border border-border p-1 text-xs">
              <button
                onClick={() => changeBoardView("flechas")}
                className={`cursor-pointer rounded-full px-3 py-1.5 transition-colors ${
                  boardView === "flechas" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Flechas
              </button>
              <button
                onClick={() => changeBoardView("apilado")}
                className={`cursor-pointer rounded-full px-3 py-1.5 transition-colors ${
                  boardView === "apilado" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Apilado
              </button>
            </div>
            <div className="flex items-center overflow-hidden rounded-full border border-border">
              {VIEW_MODES.map(({ value, label }, index) => (
                <button
                  key={value}
                  onClick={() => setContentView(value)}
                  className={`cursor-pointer px-3 py-2 text-xs font-medium transition-colors ${index > 0 ? "border-l border-border" : ""} ${
                    contentView === value ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        }
      />

      {error && <ErrorMessage message={error} />}

      {loading ? (
        <Loading label="Cargando planificador..." />
      ) : planners.length === 0 && !showCreate ? (
        <div className="rounded-3xl border border-dashed border-border p-10 text-center">
          <p className="mb-4 text-sm text-muted-foreground">
            Todavía no tienes ningún planificador. Crea el primero (p.ej. "Trabajo" o "Personal").
          </p>
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            + Nuevo planificador
          </button>
        </div>
      ) : (
        <div className="space-y-10">
          {/* Misma fila que SchedulePage: flechas a la izquierda (solo en vista Flechas) y
              "+ Nuevo planificador" a la derecha. */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            {boardView === "flechas" ? (
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
                  disabled={activeIndex === 0}
                  className="cursor-pointer rounded-full border border-border px-3 py-1.5 text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                >
                  ‹
                </button>
                <span className="text-xs text-muted-foreground">
                  Planificador {activeIndex + 1} de {planners.length}
                </span>
                <button
                  onClick={() => setActiveIndex((i) => Math.min(planners.length - 1, i + 1))}
                  disabled={activeIndex === planners.length - 1}
                  className="cursor-pointer rounded-full border border-border px-3 py-1.5 text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                >
                  ›
                </button>
              </div>
            ) : (
              <div />
            )}

            {showCreate ? (
              <form onSubmit={createPlanner} className="flex gap-2 rounded-2xl border border-dashed border-border p-3">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder='Nombre, p.ej. "Trabajo"'
                  className="field-input flex-1 text-sm"
                />
                <button type="submit" className="btn-dark shrink-0 px-3 py-2 text-xs">
                  Crear
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="shrink-0 cursor-pointer px-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  Cancelar
                </button>
              </form>
            ) : (
              <button
                onClick={() => setShowCreate(true)}
                className="cursor-pointer whitespace-nowrap rounded-full border border-dashed border-primary/30 bg-primary/5 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
              >
                + Nuevo planificador
              </button>
            )}
          </div>

          {(boardView === "apilado" ? planners : planners.slice(activeIndex, activeIndex + 1)).map((planner) => {
            const index = planners.findIndex((p) => p.id === planner.id);
            return (
              <PlannerBoard
                key={planner.id}
                planner={planner}
                projects={projects}
                contentView={contentView}
                canMoveUp={index > 0}
                canMoveDown={index < planners.length - 1}
                focusTaskId={focusTaskId}
                onFocusHandled={onFocusHandled}
                onRename={(name) => renamePlanner(planner.id, name)}
                onDelete={() => deletePlanner(planner.id)}
                onMoveUp={() => movePlanner(planner.id, "up")}
                onMoveDown={() => movePlanner(planner.id, "down")}
              />
            );
          })}
        </div>
      )}
    </>
  );
}

// Un tablero de tareas concreto — cabecera con nombre/reordenar/borrar (mismo patrón que
// ScheduleTable en SchedulePage) más el kanban o la tabla, según `contentView` (compartido entre
// todos los tableros: es una preferencia de "cómo quiero ver las tareas", no de cuál tablero).
function PlannerBoard({
  planner,
  projects,
  contentView,
  canMoveUp,
  canMoveDown,
  focusTaskId,
  onFocusHandled,
  onRename,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  planner: Planner;
  projects: Project[];
  contentView: ViewMode;
  canMoveUp: boolean;
  canMoveDown: boolean;
  focusTaskId?: number;
  onFocusHandled?: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const { data, loading, error, reload } = useFetch(
    () => api.get<{ tasks: Task[] }>(`/planner/tasks?plannerId=${planner.id}`),
    [planner.id]
  );
  const { data: fieldsData, reload: reloadFields } = useFetch(
    () => api.get<{ fields: PlannerField[] }>(`/planner/boards/${planner.id}/fields`),
    [planner.id]
  );
  const tasks = data?.tasks ?? [];
  const fields = fieldsData?.fields ?? [];
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [name, setName] = useState(planner.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [managingFields, setManagingFields] = useState(false);

  useEffect(() => {
    setName(planner.name);
  }, [planner.name]);

  // Solo se dispara si la tarea buscada pertenece a ESTE tablero (si no, `tasks` nunca la
  // contendrá y el efecto no hace nada) — mismo patrón que antes, ahora repetido por tablero.
  useEffect(() => {
    if (focusTaskId && onFocusHandled && tasks.some((t) => t.id === focusTaskId)) {
      onFocusHandled();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTaskId, tasks]);

  const columnTasks = (status: TaskStatus) => tasks.filter((t) => t.status === status).sort((a, b) => a.order - b.order);

  const moveTask = async (taskId: number, targetStatus: TaskStatus, beforeTaskId: number | null) => {
    if (taskId === beforeTaskId) return;
    const inColumn = columnTasks(targetStatus).filter((t) => t.id !== taskId);
    let order: number;
    if (beforeTaskId === null) {
      const last = inColumn[inColumn.length - 1];
      order = last ? last.order + 1000 : 1000;
    } else {
      const index = inColumn.findIndex((t) => t.id === beforeTaskId);
      const before = inColumn[index];
      const prev = inColumn[index - 1];
      order = prev ? (prev.order + before.order) / 2 : before.order - 1000;
    }
    await api.put(`/planner/tasks/${taskId}`, { status: targetStatus, order });
    reload();
  };

  const cyclePriority = async (task: Task) => {
    const next = PRIORITY_ORDER[(PRIORITY_ORDER.indexOf(task.priority) + 1) % PRIORITY_ORDER.length];
    await api.put(`/planner/tasks/${task.id}`, { priority: next });
    reload();
  };

  const removeTask = async (id: number) => {
    await api.delete(`/planner/tasks/${id}`);
    reload();
  };

  const addTask = async (status: TaskStatus, title: string, description?: string) => {
    if (!title.trim()) return;
    await api.post("/planner/tasks", {
      plannerId: planner.id,
      title: title.trim(),
      description: description?.trim() || undefined,
      status,
    });
    reload();
  };

  // Editar cualquier campo de la tarea (título/descripción/imagen/notas al clicar, o los del
  // diálogo de detalles).
  const updateTask = async (id: number, taskFields: TaskFields) => {
    await api.put(`/planner/tasks/${id}`, taskFields);
    reload();
  };

  // Un solo valor de columna personalizada — se manda como PATCH de un único `{ [fieldId]: valor }`
  // (ver TaskFields.customFields y plannerService.updateTask: se combina con lo que ya hubiera).
  const updateCustomField = (taskId: number, fieldId: number, value: CustomFieldValue) =>
    updateTask(taskId, { customFields: { [String(fieldId)]: value } });

  // Crear una propiedad personalizada nueva — llamado tanto desde "+ Propiedad" en la cabecera
  // del tablero (PlannerFieldsDialog) como desde el propio "+ Añadir propiedad" dentro de cada
  // tarea (ver TaskDetailDialog): mismo destino, /planner/boards/:id/fields.
  const addField = async (name: string, type: CustomFieldType, options?: string[]) => {
    await api.post(`/planner/boards/${planner.id}/fields`, { name, type, options });
    reloadFields();
  };

  const logTime = async (id: number, minutes: number) => {
    if (!minutes || minutes <= 0) return;
    await api.post(`/planner/tasks/${id}/time`, { minutes });
    reload();
  };

  const addSubtask = async (taskId: number, title: string) => {
    if (!title.trim()) return;
    await api.post(`/planner/tasks/${taskId}/subtasks`, { title: title.trim() });
    reload();
  };

  const toggleSubtask = async (taskId: number, subtask: Subtask) => {
    await api.put(`/planner/tasks/${taskId}/subtasks/${subtask.id}`, { completed: !subtask.completed });
    reload();
  };

  const removeSubtask = async (taskId: number, subtaskId: number) => {
    await api.delete(`/planner/tasks/${taskId}/subtasks/${subtaskId}`);
    reload();
  };

  const saveName = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === planner.name) {
      setName(planner.name);
      return;
    }
    onRename(trimmed);
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          title="Haz clic para renombrar este planificador"
          className="min-w-0 flex-1 border-b border-transparent bg-transparent font-serif text-xl outline-none focus:border-primary"
        />
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => setManagingFields(true)}
            title="Propiedades personalizadas"
            className="cursor-pointer whitespace-nowrap rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
          >
            + Propiedad
          </button>
          <button
            onClick={onMoveUp}
            disabled={!canMoveUp}
            title="Subir"
            className="cursor-pointer rounded px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
          >
            ↑
          </button>
          <button
            onClick={onMoveDown}
            disabled={!canMoveDown}
            title="Bajar"
            className="cursor-pointer rounded px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
          >
            ↓
          </button>
          <button
            onClick={() => {
              if (!confirmingDelete) {
                setConfirmingDelete(true);
                return;
              }
              onDelete();
            }}
            onBlur={() => setConfirmingDelete(false)}
            className={`cursor-pointer whitespace-nowrap rounded-full px-3 py-1 text-xs transition-colors ${
              confirmingDelete
                ? "bg-destructive text-destructive-foreground"
                : "border border-border text-muted-foreground hover:text-destructive"
            }`}
          >
            {confirmingDelete ? "¿Confirmar?" : "Eliminar planificador"}
          </button>
        </div>
      </div>

      {managingFields && (
        <PlannerFieldsDialog
          plannerId={planner.id}
          fields={fields}
          onAddField={addField}
          onClose={() => setManagingFields(false)}
          onChanged={reloadFields}
        />
      )}

      {error && <ErrorMessage message={error} />}

      {/* `loading && !data`, no solo `loading`: cada acción (subtarea, fecha límite, tiempo...)
          recarga el tablero, y si se sustituyera todo por el spinner en cada recarga, las
          tarjetas se desmontarían y el diálogo de detalles abierto se cerraría solo después de
          cada cambio. Solo se muestra en la carga inicial. */}
      {loading && !data ? (
        <Loading label="Cargando tablero..." />
      ) : contentView === "kanban" ? (
        <div className="grid gap-6 md:grid-cols-3">
          {COLUMNS.map(({ status, label }) => (
            <KanbanColumn
              key={status}
              status={status}
              label={label}
              tasks={columnTasks(status)}
              projects={projects}
              fields={fields}
              focusTaskId={focusTaskId}
              draggedId={draggedId}
              onDragStart={setDraggedId}
              onDragEnd={() => setDraggedId(null)}
              onDrop={moveTask}
              onCyclePriority={cyclePriority}
              onDelete={removeTask}
              onUpdate={updateTask}
              onAddField={addField}
              onLogTime={logTime}
              onAddSubtask={addSubtask}
              onToggleSubtask={toggleSubtask}
              onRemoveSubtask={removeSubtask}
              onAdd={(title, description) => addTask(status, title, description)}
            />
          ))}
        </div>
      ) : (
        <TaskTable
          tasks={tasks}
          projects={projects}
          fields={fields}
          focusTaskId={focusTaskId}
          onMoveStatus={(task, status) => moveTask(task.id, status, null)}
          onCyclePriority={cyclePriority}
          onDelete={removeTask}
          onUpdate={updateTask}
          onUpdateCustomField={updateCustomField}
          onAddField={addField}
          onLogTime={logTime}
          onAddSubtask={addSubtask}
          onToggleSubtask={toggleSubtask}
          onRemoveSubtask={removeSubtask}
          onAdd={(status, title) => addTask(status, title)}
        />
      )}
    </div>
  );
}

/**
 * Gestión de las propiedades personalizadas de UN planner (ver PlannerField en el backend): crear
 * (nombre + tipo, y opciones si es "selección"), reordenar y borrar. El nombre editable de cada
 * fila guarda al perder el foco, mismo patrón que el resto de renombrados de la app — cambiar el
 * TIPO de una propiedad ya creada no está soportado (ver comentario en plannerService.updateField):
 * hay que borrarla y crear una nueva si hace falta otro tipo.
 */
function PlannerFieldsDialog({
  plannerId,
  fields,
  onAddField,
  onClose,
  onChanged,
}: {
  plannerId: number;
  fields: PlannerField[];
  onAddField: (name: string, type: CustomFieldType, options?: string[]) => Promise<void>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const renameField = async (fieldId: number, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    await api.put(`/planner/boards/${plannerId}/fields/${fieldId}`, { name: trimmed });
    onChanged();
  };

  const removeField = async (fieldId: number) => {
    await api.delete(`/planner/boards/${plannerId}/fields/${fieldId}`);
    onChanged();
  };

  const moveField = async (fieldId: number, direction: "up" | "down") => {
    await api.put(`/planner/boards/${plannerId}/fields/${fieldId}/move`, { direction });
    onChanged();
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
        <p className="mb-4 text-xs text-muted-foreground">Añade tus propias propiedades a este planificador: texto, número, fecha o selección.</p>

        {fields.length > 0 && (
          <ul className="mb-4 max-h-60 space-y-1 overflow-y-auto">
            {fields.map((field, index) => (
              <FieldRow
                key={field.id}
                field={field}
                canMoveUp={index > 0}
                canMoveDown={index < fields.length - 1}
                onRename={(newName) => renameField(field.id, newName)}
                onRemove={() => removeField(field.id)}
                onMoveUp={() => moveField(field.id, "up")}
                onMoveDown={() => moveField(field.id, "down")}
              />
            ))}
          </ul>
        )}

        <AddFieldForm
          onAdd={async (name, type, options) => {
            await onAddField(name, type, options);
            onChanged();
          }}
          className="space-y-2 border-t border-border pt-4"
        />
      </div>
    </div>
  );
}

// Formulario compacto para crear una propiedad personalizada nueva — se usa tanto en
// PlannerFieldsDialog (la vista de gestión completa) como dentro de cada tarea (ver
// InlineAddField/TaskDetailDialog), para no obligar a cerrar la tarea y volver a la cabecera solo
// para añadir la propiedad que hace falta justo ahora.
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
// formulario. Vive dentro de cada tarea (ver TaskDetailDialog) para poder crear una propiedad
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

function FieldRow({
  field,
  canMoveUp,
  canMoveDown,
  onRename,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  field: PlannerField;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onRename: (name: string) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [name, setName] = useState(field.name);

  return (
    <li className="flex items-center gap-1.5 rounded-xl px-2 py-1.5 hover:bg-muted">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() !== field.name && onRename(name)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="min-w-0 flex-1 border-b border-transparent bg-transparent text-sm outline-none focus:border-primary"
      />
      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{FIELD_TYPE_LABELS[field.type]}</span>
      <button onClick={onMoveUp} disabled={!canMoveUp} title="Subir" className="shrink-0 cursor-pointer rounded px-1 text-xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30">
        ↑
      </button>
      <button onClick={onMoveDown} disabled={!canMoveDown} title="Bajar" className="shrink-0 cursor-pointer rounded px-1 text-xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30">
        ↓
      </button>
      <button onClick={onRemove} title="Eliminar propiedad" className="shrink-0 cursor-pointer rounded px-1 text-xs text-muted-foreground hover:text-destructive">
        ✕
      </button>
    </li>
  );
}

function KanbanColumn({
  status,
  label,
  tasks,
  projects,
  fields,
  focusTaskId,
  draggedId,
  onDragStart,
  onDragEnd,
  onDrop,
  onCyclePriority,
  onDelete,
  onUpdate,
  onAddField,
  onLogTime,
  onAddSubtask,
  onToggleSubtask,
  onRemoveSubtask,
  onAdd,
}: {
  status: TaskStatus;
  label: string;
  tasks: Task[];
  projects: Project[];
  fields: PlannerField[];
  focusTaskId?: number;
  draggedId: number | null;
  onDragStart: (id: number) => void;
  onDragEnd: () => void;
  onDrop: (taskId: number, status: TaskStatus, beforeTaskId: number | null) => void;
  onCyclePriority: (task: Task) => void;
  onDelete: (id: number) => void;
  onUpdate: (id: number, fields: TaskFields) => void;
  onAddField: (name: string, type: CustomFieldType, options?: string[]) => void;
  onLogTime: (id: number, minutes: number) => void;
  onAddSubtask: (taskId: number, title: string) => void;
  onToggleSubtask: (taskId: number, subtask: Subtask) => void;
  onRemoveSubtask: (taskId: number, subtaskId: number) => void;
  onAdd: (title: string, description: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = (e: React.DragEvent, beforeTaskId: number | null) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const id = Number(e.dataTransfer.getData("text/plain"));
    if (!Number.isNaN(id)) onDrop(id, status, beforeTaskId);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => handleDrop(e, null)}
      className={`flex flex-col rounded-3xl border p-4 transition-colors ${
        dragOver ? "border-primary/50 bg-primary/5" : COLUMN_STYLES[status]
      }`}
    >
      <div className="mb-3 flex items-center justify-between px-1">
        <h2 className={`text-sm font-medium ${COLUMN_HEADER_STYLES[status]}`}>{label}</h2>
        <span className="text-xs text-muted-foreground">{tasks.length}</span>
      </div>

      <div className="flex min-h-16 flex-col gap-2">
        {tasks.length === 0 && !dragOver && (
          <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            Sin tareas
          </p>
        )}
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            projects={projects}
            fields={fields}
            autoFocus={task.id === focusTaskId}
            isDragged={draggedId === task.id}
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", String(task.id));
              onDragStart(task.id);
            }}
            onDragEnd={onDragEnd}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={(e) => handleDrop(e, task.id)}
            onCyclePriority={() => onCyclePriority(task)}
            onDelete={() => onDelete(task.id)}
            onUpdate={(fields) => onUpdate(task.id, fields)}
            onAddField={onAddField}
            onLogTime={(minutes) => onLogTime(task.id, minutes)}
            onAddSubtask={(subtaskTitle) => onAddSubtask(task.id, subtaskTitle)}
            onToggleSubtask={(subtask) => onToggleSubtask(task.id, subtask)}
            onRemoveSubtask={(subtaskId) => onRemoveSubtask(task.id, subtaskId)}
          />
        ))}
      </div>

      {!adding ? (
        <button
          onClick={() => setAdding(true)}
          className="mt-3 w-full cursor-pointer rounded-xl border border-dashed border-border px-3 py-2 text-center text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
        >
          + Añadir tarea
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            // Igual guarda que CustomPagePage.tsx (submitCard): sin esto, enviar el formulario
            // vacío colapsaba el diálogo sin haber añadido nada (addTask ya ignora el título
            // vacío, pero antes de este `if` seguíamos cerrando el formulario igual).
            if (!title.trim()) return;
            onAdd(title, description);
            setTitle("");
            setDescription("");
            setAdding(false);
          }}
          className="mt-3 space-y-2"
        >
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Título de la tarea"
            className="field-input w-full text-sm"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
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
                setTitle("");
                setDescription("");
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

// Envoltorio genérico para las 5 celdas "clicar para editar" (Vencimiento, Proyecto, Etiquetas,
// Tiempo, Subtareas): el disparador (badge/texto) vive siempre visible, y al clicarlo se abre un
// panel flotante justo debajo con el editor de verdad.
//
// El panel se renderiza en un PORTAL a document.body con `position: fixed` (no `absolute` dentro
// de la celda) — antes vivía dentro del propio <td>, y aunque estuviera fuera del flujo normal,
// el layout automático de la tabla (auto-table-layout) contaba igualmente su ancho mínimo al
// calcular el ancho de la columna, deformando la fila entera cada vez que se abría. Al vivir fuera
// del DOM de la tabla, ya no afecta en nada a su layout — se posiciona a mano a partir del
// `getBoundingClientRect()` del propio disparador.
function EditableCell({
  isOpen,
  onOpenChange,
  trigger,
  children,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactNode;
  children: React.ReactNode;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!isOpen || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    // Ancho estimado del panel (192px = min-w-48) para no dejarlo salir por la derecha del
    // viewport — no se mide el panel real porque en el primer render, antes de posicionarlo,
    // todavía no existe.
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - 208));
    setPos({ top: rect.bottom + 4, left });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onOpenChange(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [isOpen, onOpenChange]);

  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => onOpenChange(!isOpen)} className="block w-full cursor-pointer text-left">
        {trigger}
      </button>
      {isOpen &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: "fixed", top: pos.top, left: pos.left }}
            className="z-50 min-w-48 rounded-xl border border-border bg-card p-3 shadow-[var(--shadow-soft)]"
          >
            {children}
          </div>,
          document.body
        )}
    </>
  );
}

type EditableField = "due" | "project" | "tags" | "time" | "subtasks";

// Todas las tareas del planner en una sola lista, ordenadas por columna (mismo orden que COLUMNS)
// y luego por `order` dentro de cada una — así el orden visual coincide con el del kanban aunque
// aquí no haya agrupación. "Estado" sustituye al arrastrar-y-soltar (un <select> mueve la tarea de
// columna), y la casilla es un atajo directo a "Hecho"/"Por hacer", igual que el toggle rápido de
// HoyPage. Un formulario al pie permite añadir tareas sin cambiar a la vista Kanban.
function TaskTable({
  tasks,
  projects,
  fields,
  focusTaskId,
  onMoveStatus,
  onCyclePriority,
  onDelete,
  onUpdate,
  onUpdateCustomField,
  onAddField,
  onLogTime,
  onAddSubtask,
  onToggleSubtask,
  onRemoveSubtask,
  onAdd,
}: {
  tasks: Task[];
  projects: Project[];
  fields: PlannerField[];
  focusTaskId?: number;
  onMoveStatus: (task: Task, status: TaskStatus) => void;
  onCyclePriority: (task: Task) => void;
  onDelete: (id: number) => void;
  onUpdate: (id: number, fields: TaskFields) => void;
  onUpdateCustomField: (taskId: number, fieldId: number, value: CustomFieldValue) => void;
  onAddField: (name: string, type: CustomFieldType, options?: string[]) => void;
  onLogTime: (id: number, minutes: number) => void;
  onAddSubtask: (taskId: number, title: string) => void;
  onToggleSubtask: (taskId: number, subtask: Subtask) => void;
  onRemoveSubtask: (taskId: number, subtaskId: number) => void;
  onAdd: (status: TaskStatus, title: string) => void;
}) {
  const [openTaskId, setOpenTaskId] = useState<number | null>(focusTaskId ?? null);
  const [newTitle, setNewTitle] = useState("");
  const [newStatus, setNewStatus] = useState<TaskStatus>("todo");

  useEffect(() => {
    if (focusTaskId) setOpenTaskId(focusTaskId);
  }, [focusTaskId]);

  const statusOrder = COLUMNS.map((c) => c.status);
  const sorted = tasks
    .slice()
    .sort((a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status) || a.order - b.order);
  const openTask = openTaskId ? tasks.find((t) => t.id === openTaskId) ?? null : null;

  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-[var(--shadow-soft)]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs font-medium uppercase tracking-widest text-muted-foreground">
              <th className="w-10 px-4 py-3" />
              <th className="px-4 py-3">Nombre</th>
              <th className="w-36 px-4 py-3">Estado</th>
              <th className="w-28 px-4 py-3">Vencimiento</th>
              <th className="w-40 px-4 py-3">Proyecto</th>
              <th className="px-4 py-3">Etiquetas</th>
              <th className="w-28 px-4 py-3">Tiempo</th>
              <th className="w-24 px-4 py-3">Subtareas</th>
              <th className="w-24 px-4 py-3">Prioridad</th>
              {fields.map((field) => (
                <th key={field.id} className="w-32 px-4 py-3">
                  {field.name}
                </th>
              ))}
              <th className="w-10 px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={10 + fields.length} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  Sin tareas
                </td>
              </tr>
            ) : (
              sorted.map((task) => (
                <TaskTableRow
                  key={task.id}
                  task={task}
                  project={projects.find((p) => p.id === task.projectId) ?? null}
                  projects={projects}
                  fields={fields}
                  onMoveStatus={onMoveStatus}
                  onCyclePriority={onCyclePriority}
                  onDelete={onDelete}
                  onUpdate={onUpdate}
                  onUpdateCustomField={onUpdateCustomField}
                  onLogTime={onLogTime}
                  onAddSubtask={onAddSubtask}
                  onToggleSubtask={onToggleSubtask}
                  onRemoveSubtask={onRemoveSubtask}
                  onOpenDetail={() => setOpenTaskId(task.id)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Añadir tarea sin cambiar a la vista Kanban: título + columna de destino, misma
          mecánica que "+ Añadir tarea" al pie de cada columna del kanban. */}
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          const trimmed = newTitle.trim();
          if (!trimmed) return;
          onAdd(newStatus, trimmed);
          setNewTitle("");
        }}
        className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3"
      >
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="+ Añadir tarea"
          className="field-input min-w-0 flex-1 text-sm"
        />
        <select value={newStatus} onChange={(e) => setNewStatus(e.target.value as TaskStatus)} className="field-input text-xs">
          {COLUMNS.map((c) => (
            <option key={c.status} value={c.status}>
              {c.label}
            </option>
          ))}
        </select>
        <button type="submit" className="btn-dark shrink-0 px-3 py-2 text-xs">
          Añadir
        </button>
      </form>

      {openTask && (
        <TaskDetailDialog
          task={openTask}
          projects={projects}
          fields={fields}
          onClose={() => setOpenTaskId(null)}
          onUpdate={(taskFields) => onUpdate(openTask.id, taskFields)}
          onAddField={onAddField}
          onDelete={() => {
            onDelete(openTask.id);
            setOpenTaskId(null);
          }}
          onLogTime={(minutes) => onLogTime(openTask.id, minutes)}
          onAddSubtask={(title) => onAddSubtask(openTask.id, title)}
          onToggleSubtask={(subtask) => onToggleSubtask(openTask.id, subtask)}
          onRemoveSubtask={(subtaskId) => onRemoveSubtask(openTask.id, subtaskId)}
        />
      )}
    </div>
  );
}

// Una fila de la tabla — extraída aparte (en vez de un `.map` inline en TaskTable) porque cada
// fila necesita su propio estado: qué celda tiene el panel abierto (`openField`) y los campos de
// los formularios de "+ etiqueta"/"+min"/"+ Paso" mientras se escriben.
// `openField`: además de los 5 campos fijos, una fila puede tener abierto el editor de UNA
// columna personalizada — se identifica por su id numérico (PlannerField.id), nunca colisiona con
// los strings fijos de EditableField.
type OpenCell = EditableField | number;

function TaskTableRow({
  task,
  project,
  projects,
  fields,
  onMoveStatus,
  onCyclePriority,
  onDelete,
  onUpdate,
  onUpdateCustomField,
  onLogTime,
  onAddSubtask,
  onToggleSubtask,
  onRemoveSubtask,
  onOpenDetail,
}: {
  task: Task;
  project: Project | null;
  projects: Project[];
  fields: PlannerField[];
  onMoveStatus: (task: Task, status: TaskStatus) => void;
  onCyclePriority: (task: Task) => void;
  onDelete: (id: number) => void;
  onUpdate: (id: number, fields: TaskFields) => void;
  onUpdateCustomField: (taskId: number, fieldId: number, value: CustomFieldValue) => void;
  onLogTime: (id: number, minutes: number) => void;
  onAddSubtask: (taskId: number, title: string) => void;
  onToggleSubtask: (taskId: number, subtask: Subtask) => void;
  onRemoveSubtask: (taskId: number, subtaskId: number) => void;
  onOpenDetail: () => void;
}) {
  const [openField, setOpenField] = useState<OpenCell | null>(null);
  const [newTag, setNewTag] = useState("");
  const [newSubtask, setNewSubtask] = useState("");
  const [minutesToLog, setMinutesToLog] = useState("");

  const badge = dueBadge(task);
  const subtasks = task.subtasks ?? [];
  const doneSubtasks = subtasks.filter((s) => s.completed).length;
  const fieldOpen = (field: OpenCell) => (open: boolean) => setOpenField(open ? field : null);

  return (
    <tr className="group">
      <td className="px-4 py-2.5">
        <button
          onClick={() => onMoveStatus(task, task.status === "done" ? "todo" : "done")}
          aria-label={task.status === "done" ? "Marcar como pendiente" : "Marcar como hecha"}
          className={`flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full border text-[10px] transition-colors ${
            task.status === "done" ? "border-positive bg-positive/20 text-positive" : "border-foreground/30 hover:border-primary/50"
          }`}
        >
          {task.status === "done" ? "✓" : ""}
        </button>
      </td>
      <td className="max-w-0 px-4 py-2.5">
        <button
          onClick={onOpenDetail}
          className={`flex w-full min-w-0 cursor-pointer items-center gap-1.5 truncate text-left text-sm hover:underline ${
            task.status === "done" ? "text-muted-foreground line-through" : ""
          }`}
        >
          {task.image && <span aria-hidden="true">🖼</span>}
          <span className="min-w-0 truncate">{task.title}</span>
        </button>
      </td>
      <td className="px-4 py-2.5">
        <select
          value={task.status}
          onChange={(e) => onMoveStatus(task, e.target.value as TaskStatus)}
          className="field-input w-full text-xs"
        >
          {COLUMNS.map((c) => (
            <option key={c.status} value={c.status}>
              {c.label}
            </option>
          ))}
        </select>
      </td>

      {/* Vencimiento */}
      <td className="px-4 py-2.5">
        <EditableCell
          isOpen={openField === "due"}
          onOpenChange={fieldOpen("due")}
          trigger={
            badge ? (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.className}`}>{badge.label}</span>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )
          }
        >
          <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Fecha límite
            <input
              type="date"
              autoFocus
              value={toDateInputValue(task.dueDate)}
              onChange={(e) => onUpdate(task.id, { dueDate: e.target.value ? new Date(e.target.value).toISOString() : null })}
              className="field-input text-xs"
            />
          </label>
          {task.dueDate && (
            <button
              onClick={() => onUpdate(task.id, { dueDate: null })}
              className="mt-2 cursor-pointer text-xs text-muted-foreground hover:text-destructive"
            >
              Quitar
            </button>
          )}
        </EditableCell>
      </td>

      {/* Proyecto */}
      <td className="px-4 py-2.5">
        <EditableCell
          isOpen={openField === "project"}
          onOpenChange={fieldOpen("project")}
          trigger={
            project ? (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">📁 {project.title}</span>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )
          }
        >
          <select
            autoFocus
            value={task.projectId ?? ""}
            onChange={(e) => {
              onUpdate(task.id, { projectId: e.target.value ? Number(e.target.value) : null });
              setOpenField(null);
            }}
            className="field-input w-40 text-xs"
          >
            <option value="">Sin proyecto</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </EditableCell>
      </td>

      {/* Etiquetas */}
      <td className="px-4 py-2.5">
        <EditableCell
          isOpen={openField === "tags"}
          onOpenChange={fieldOpen("tags")}
          trigger={
            task.tags.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {task.tags.map((tag) => (
                  <span key={tag} className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                    #{tag}
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )
          }
        >
          <div className="w-44">
            {task.tags.length > 0 && (
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                {task.tags.map((tag) => (
                  <span key={tag} className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                    #{tag}
                    <button
                      onClick={() => onUpdate(task.id, { tags: task.tags.filter((t) => t !== tag) })}
                      className="cursor-pointer hover:text-destructive"
                      aria-label={`Quitar etiqueta ${tag}`}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const trimmed = newTag.trim().toLowerCase();
                if (!trimmed || task.tags.includes(trimmed)) return;
                onUpdate(task.id, { tags: [...task.tags, trimmed] });
                setNewTag("");
              }}
              className="flex gap-1"
            >
              <input
                autoFocus
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                placeholder="+ etiqueta"
                className="field-input w-full text-xs"
              />
              <button type="submit" className="shrink-0 cursor-pointer rounded-full border border-border px-2 text-xs text-muted-foreground hover:bg-muted">
                OK
              </button>
            </form>
          </div>
        </EditableCell>
      </td>

      {/* Tiempo */}
      <td className="px-4 py-2.5">
        <EditableCell
          isOpen={openField === "time"}
          onOpenChange={fieldOpen("time")}
          trigger={
            task.estimatedMinutes || task.actualMinutes > 0 ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                ⏱ {task.actualMinutes}
                {task.estimatedMinutes ? `/${task.estimatedMinutes}` : ""} min
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )
          }
        >
          <div className="w-40 space-y-2">
            <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              Estimado
              <input
                type="number"
                min={1}
                autoFocus
                defaultValue={task.estimatedMinutes ?? ""}
                onBlur={(e) => {
                  const value = e.target.value ? Number(e.target.value) : null;
                  if (value !== task.estimatedMinutes) onUpdate(task.id, { estimatedMinutes: value });
                }}
                className="field-input w-16 text-xs"
              />
            </label>
            <p className="text-xs text-muted-foreground">Real: {task.actualMinutes} min</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const minutes = Number(minutesToLog);
                if (minutes > 0) onLogTime(task.id, minutes);
                setMinutesToLog("");
              }}
              className="flex items-center gap-1.5"
            >
              <input
                type="number"
                min={1}
                value={minutesToLog}
                onChange={(e) => setMinutesToLog(e.target.value)}
                placeholder="+min"
                className="field-input w-16 text-xs"
              />
              <button type="submit" className="cursor-pointer rounded-full border border-border px-2 text-xs text-muted-foreground hover:bg-muted">
                Registrar
              </button>
            </form>
          </div>
        </EditableCell>
      </td>

      {/* Subtareas */}
      <td className="px-4 py-2.5">
        <EditableCell
          isOpen={openField === "subtasks"}
          onOpenChange={fieldOpen("subtasks")}
          trigger={
            subtasks.length > 0 ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                ☑ {doneSubtasks}/{subtasks.length}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )
          }
        >
          <div className="w-52">
            {subtasks.length > 0 && (
              <ul className="mb-1.5 max-h-40 space-y-1 overflow-y-auto">
                {subtasks.map((s) => (
                  <li key={s.id} className="group/sub flex items-center gap-2">
                    <button
                      onClick={() => onToggleSubtask(task.id, s)}
                      className={`flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm border text-[9px] ${
                        s.completed ? "border-primary bg-primary/20 text-primary" : "border-foreground/30"
                      }`}
                    >
                      {s.completed ? "✓" : ""}
                    </button>
                    <span className={`flex-1 truncate text-xs ${s.completed ? "text-muted-foreground line-through" : ""}`}>{s.title}</span>
                    <button
                      onClick={() => onRemoveSubtask(task.id, s.id)}
                      className="cursor-pointer text-[10px] text-muted-foreground opacity-0 hover:text-destructive group-hover/sub:opacity-100"
                      aria-label="Eliminar subtarea"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onAddSubtask(task.id, newSubtask);
                setNewSubtask("");
              }}
              className="flex gap-1.5"
            >
              <input
                autoFocus
                value={newSubtask}
                onChange={(e) => setNewSubtask(e.target.value)}
                placeholder="+ Paso"
                className="field-input w-full text-xs"
              />
              <button type="submit" className="shrink-0 cursor-pointer rounded-full border border-border px-2 text-xs text-muted-foreground hover:bg-muted">
                OK
              </button>
            </form>
          </div>
        </EditableCell>
      </td>

      <td className="px-4 py-2.5">
        <button
          onClick={() => onCyclePriority(task)}
          className={`cursor-pointer rounded-full px-2 py-0.5 text-[10px] font-medium transition-opacity hover:opacity-80 ${PRIORITY_STYLES[task.priority]}`}
        >
          {PRIORITY_LABELS[task.priority]}
        </button>
      </td>

      {/* Columnas personalizadas — mismo patrón EditableCell que Vencimiento/Proyecto/etc.: un
          disparador con el valor formateado, y al clicar un CustomFieldInput según el tipo. */}
      {fields.map((field) => {
        const value = (task.customFields?.[String(field.id)] as CustomFieldValue) ?? null;
        return (
          <td key={field.id} className="px-4 py-2.5">
            <EditableCell
              isOpen={openField === field.id}
              onOpenChange={fieldOpen(field.id)}
              trigger={
                value !== null && value !== "" ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                    {formatCustomFieldValue(field.type, value)}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )
              }
            >
              <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {field.name}
                <CustomFieldInput
                  type={field.type}
                  options={field.options}
                  value={value}
                  onChange={(next) => onUpdateCustomField(task.id, field.id, next)}
                  autoFocus
                />
              </label>
            </EditableCell>
          </td>
        );
      })}

      <td className="px-4 py-2.5 text-right">
        <button
          onClick={() => onDelete(task.id)}
          className="cursor-pointer text-xs text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
          aria-label="Eliminar tarea"
        >
          ✕
        </button>
      </td>
    </tr>
  );
}

// La tarjeta del tablero es ahora solo una VISTA PREVIA (título, descripción corta, imagen,
// insignias) — clicar en cualquier parte que no sea una acción concreta (prioridad, eliminar)
// abre TaskDetailDialog, donde vive toda la edición de verdad (antes era un panel "Detalles" que
// se desplegaba dentro de la propia tarjeta).
function TaskCard({
  task,
  projects,
  fields,
  autoFocus,
  isDragged,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onCyclePriority,
  onDelete,
  onUpdate,
  onAddField,
  onLogTime,
  onAddSubtask,
  onToggleSubtask,
  onRemoveSubtask,
}: {
  task: Task;
  projects: Project[];
  fields: PlannerField[];
  autoFocus?: boolean;
  isDragged: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onCyclePriority: () => void;
  onDelete: () => void;
  onUpdate: (fields: TaskFields) => void;
  onAddField: (name: string, type: CustomFieldType, options?: string[]) => void;
  onLogTime: (minutes: number) => void;
  onAddSubtask: (title: string) => void;
  onToggleSubtask: (subtask: Subtask) => void;
  onRemoveSubtask: (subtaskId: number) => void;
}) {
  const [detailOpen, setDetailOpen] = useState(autoFocus ?? false);
  const [justFocused, setJustFocused] = useState(autoFocus ?? false);
  const cardRef = useRef<HTMLDivElement>(null);

  // Solo al montar: si viene de la búsqueda global, la desplaza a la vista y le quita el
  // resalte tras un momento — no depende de `autoFocus` en el array de deps a propósito
  // (es un prop que solo tiene sentido en el primer render de esta tarjeta en concreto).
  useEffect(() => {
    if (!autoFocus) return;
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = setTimeout(() => setJustFocused(false), 2000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const project = projects.find((p) => p.id === task.projectId) ?? null;
  const subtasks = task.subtasks ?? [];
  const doneSubtasks = subtasks.filter((s) => s.completed).length;
  const badge = dueBadge(task);

  return (
    <>
      <div
        ref={cardRef}
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onClick={() => setDetailOpen(true)}
        title="Haz clic para ver los detalles"
        className={`group cursor-grab rounded-xl border border-border bg-background p-3 text-left transition-all active:cursor-grabbing ${
          isDragged ? "opacity-40" : ""
        } ${justFocused ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}
      >
        {/* "Compactar" (ver TaskDetailDialog) pone la imagen a la izquierda como miniatura en vez
            de a ancho completo encima del texto — sin efecto si la tarea no tiene imagen. */}
        {task.compact && task.image ? (
          <div className="flex items-start gap-2.5">
            <img src={task.image} alt="" className="size-14 shrink-0 rounded-lg object-cover" />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <span className={`min-w-0 flex-1 text-sm ${task.status === "done" ? "text-muted-foreground line-through" : ""}`}>
                  {task.title}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                  className="shrink-0 cursor-pointer text-xs text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  aria-label="Eliminar tarea"
                >
                  ✕
                </button>
              </div>
              {task.description && <p className="mt-1.5 truncate text-xs text-muted-foreground">{task.description}</p>}
            </div>
          </div>
        ) : (
          <>
            {task.image && <img src={task.image} alt="" className="mb-2 max-h-32 w-full rounded-lg object-cover" />}

            <div className="flex items-start justify-between gap-2">
              <span className={`min-w-0 flex-1 text-sm ${task.status === "done" ? "text-muted-foreground line-through" : ""}`}>
                {task.title}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="shrink-0 cursor-pointer text-xs text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                aria-label="Eliminar tarea"
              >
                ✕
              </button>
            </div>

            {task.description && <p className="mt-1.5 truncate text-xs text-muted-foreground">{task.description}</p>}
          </>
        )}

        {/* Insignias compactas */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCyclePriority();
            }}
            className={`cursor-pointer rounded-full px-2 py-0.5 text-[10px] font-medium transition-opacity hover:opacity-80 ${PRIORITY_STYLES[task.priority]}`}
          >
            {PRIORITY_LABELS[task.priority]}
          </button>
          {badge && <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.className}`}>📅 {badge.label}</span>}
          {project && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">📁 {project.title}</span>}
          {subtasks.length > 0 && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
              ☑ {doneSubtasks}/{subtasks.length}
            </span>
          )}
          {(task.estimatedMinutes || task.actualMinutes > 0) && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
              ⏱ {task.actualMinutes}
              {task.estimatedMinutes ? `/${task.estimatedMinutes}` : ""} min
            </span>
          )}
          {task.notes && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">📝</span>}
          {task.tags.map((tag) => (
            <span key={tag} className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
              #{tag}
            </span>
          ))}
          {fields.map((field) => {
            const value = task.customFields?.[String(field.id)] ?? null;
            if (value === null || value === "") return null;
            return (
              <span key={field.id} className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                {field.name}: {formatCustomFieldValue(field.type, value)}
              </span>
            );
          })}
        </div>
      </div>

      {detailOpen && (
        <TaskDetailDialog
          task={task}
          projects={projects}
          fields={fields}
          onClose={() => setDetailOpen(false)}
          onUpdate={onUpdate}
          onAddField={onAddField}
          onDelete={() => {
            onDelete();
            setDetailOpen(false);
          }}
          onLogTime={onLogTime}
          onAddSubtask={onAddSubtask}
          onToggleSubtask={onToggleSubtask}
          onRemoveSubtask={onRemoveSubtask}
        />
      )}
    </>
  );
}

/**
 * Diálogo de detalles de una tarea — se abre al clicar la tarjeta. Reúne todo lo que antes vivía
 * en el panel "Detalles" desplegable de la tarjeta (subtareas, fecha límite, proyecto, etiquetas,
 * tiempo), más lo nuevo: imagen y un recuadro grande DE TEXTO LIBRE SIN NOMBRE ni etiqueta —a
 * propósito, para que sea justo "todo lo que el usuario quiera apuntar" aparte de la descripción
 * corta, sin que un título lo condicione a un tipo de contenido concreto.
 */
function TaskDetailDialog({
  task,
  projects,
  fields,
  onClose,
  onUpdate,
  onAddField,
  onDelete,
  onLogTime,
  onAddSubtask,
  onToggleSubtask,
  onRemoveSubtask,
}: {
  task: Task;
  projects: Project[];
  fields: PlannerField[];
  onClose: () => void;
  onUpdate: (fields: TaskFields) => void;
  onAddField: (name: string, type: CustomFieldType, options?: string[]) => void;
  onDelete: () => void;
  onLogTime: (minutes: number) => void;
  onAddSubtask: (title: string) => void;
  onToggleSubtask: (subtask: Subtask) => void;
  onRemoveSubtask: (subtaskId: number) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [notes, setNotes] = useState(task.notes ?? "");
  const [newSubtask, setNewSubtask] = useState("");
  const [newTag, setNewTag] = useState("");
  const [minutesToLog, setMinutesToLog] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // El textarea de notas es redimensionable en ambas direcciones (ver className más abajo), tanto
  // para agrandarlo como para encogerlo. En vez de dejar que crezca solapándose con la columna
  // derecha (fecha, proyecto, etiquetas...) o que el diálogo se quede con un hueco de sobra al
  // encogerlo, el propio diálogo sigue al textarea en ambos sentidos — la columna derecha
  // mantiene siempre su ancho de siempre, solo cambia la izquierda (y el diálogo entero con ella).
  const modalRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const naturalSizeRef = useRef<{ modalWidth: number; leftWidth: number } | null>(null);
  const [customSize, setCustomSize] = useState<{ modalWidth: number; leftWidth: number } | null>(null);

  useEffect(() => {
    const notesEl = notesRef.current;
    if (!notesEl) return;
    const observer = new ResizeObserver(() => {
      // Solo tiene sentido en dos columnas (desde `md`) — en móvil todo va apilado a lo ancho
      // de la pantalla y no hay nada con lo que "chocar".
      if (!window.matchMedia("(min-width: 768px)").matches || !modalRef.current) return;
      // La primera medida (antes de que el usuario toque el tirador) es la referencia "de
      // fábrica" con la que comparar cuánto se ha movido, en cualquiera de los dos sentidos.
      if (!naturalSizeRef.current) {
        naturalSizeRef.current = { modalWidth: modalRef.current.getBoundingClientRect().width, leftWidth: notesEl.getBoundingClientRect().width };
        return;
      }
      const { modalWidth, leftWidth } = naturalSizeRef.current;
      const delta = notesEl.getBoundingClientRect().width - leftWidth;
      if (Math.abs(delta) <= 2) {
        setCustomSize(null);
        return;
      }
      // Al agrandar, tope en el 95% del ancho de la ventana; al encoger, el propio `min-w-*`
      // del textarea ya pone el límite (el navegador no deja arrastrar más allá), así que no
      // hace falta otro tope aquí.
      const maxModalWidth = window.innerWidth * 0.95;
      const clampedDelta = delta > 0 ? Math.min(delta, Math.max(maxModalWidth - modalWidth, 0)) : delta;
      setCustomSize({ modalWidth: modalWidth + clampedDelta, leftWidth: leftWidth + clampedDelta });
    });
    observer.observe(notesEl);
    return () => observer.disconnect();
  }, []);

  const subtasks = task.subtasks ?? [];

  const saveTitle = () => {
    const trimmed = title.trim();
    if (!trimmed || trimmed === task.title) {
      setTitle(task.title);
      return;
    }
    onUpdate({ title: trimmed });
  };

  const saveDescription = () => {
    const trimmed = description.trim();
    if (trimmed === (task.description ?? "")) return;
    onUpdate({ description: trimmed || null });
  };

  const saveNotes = () => {
    if (notes === (task.notes ?? "")) return;
    onUpdate({ notes: notes || null });
  };

  const handleImageFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    if (file.size > MAX_IMAGE_BYTES) {
      window.alert("La imagen es demasiado grande (máx. 3 MB).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onUpdate({ image: reader.result as string });
    reader.readAsDataURL(file);
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
        style={customSize ? { width: `${customSize.modalWidth}px`, maxWidth: "95vw" } : undefined}
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-card p-6 shadow-[var(--shadow-soft)] sm:p-8"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="min-w-0 flex-1 border-b border-transparent bg-transparent font-serif text-2xl outline-none focus:border-primary"
          />
          <button type="button" onClick={onClose} className="shrink-0 cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            ✕ Cerrar
          </button>
        </div>

        {/* Dos columnas desde md: a la izquierda lo "de escribir" (imagen, descripción, notas
            libres); a la derecha lo "de organizar" (subtareas, fecha, proyecto, etiquetas,
            tiempo). En pantallas estrechas se apilan en una sola columna. */}
        <div
          className="grid grid-cols-1 gap-6 md:grid-cols-2"
          style={customSize ? { gridTemplateColumns: `${customSize.leftWidth}px minmax(0, 1fr)` } : undefined}
        >
          <div>
            {task.image && <img src={task.image} alt="" className="mb-3 max-h-56 w-full rounded-xl object-cover" />}
            <div className="mb-4 flex items-center gap-3 text-xs">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="cursor-pointer text-muted-foreground hover:text-foreground"
              >
                {task.image ? "🖼 Cambiar imagen" : "🖼 Añadir imagen"}
              </button>
              {task.image && (
                <button
                  type="button"
                  onClick={() => onUpdate({ image: null })}
                  className="cursor-pointer text-muted-foreground hover:text-destructive"
                >
                  Quitar imagen
                </button>
              )}
              {/* Solo tiene sentido con imagen puesta — ver TaskCard para el layout resultante
                  (imagen a la izquierda como miniatura, título/descripción a la derecha, en vez
                  de a ancho completo encima). */}
              {task.image && (
                <button
                  type="button"
                  onClick={() => onUpdate({ compact: !task.compact })}
                  className="cursor-pointer text-muted-foreground hover:text-foreground"
                >
                  {task.compact ? "Expandir" : "Compactar"}
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  handleImageFile(e.target.files?.[0]);
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
                `w-full` es solo el ancho DE PARTIDA (ocupa toda la columna antes de tocar nada);
                `resize` (no solo `resize-y`) deja tirar tanto del ancho como del alto, para
                agrandarlo o para encogerlo — al arrastrar, el navegador fija un ancho en línea
                que manda por encima de `w-full`, así que puede bajar de eso hasta el suelo de
                `min-w-[12rem]` (para que no quede inservible) o subir todo lo que haga falta. El
                `ResizeObserver` de arriba sigue ese ancho en ambos sentidos y ajusta el diálogo
                entero para que nunca se solape con la columna de la derecha ni se quede con un
                hueco de sobra. */}
            <textarea
              ref={notesRef}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={saveNotes}
              rows={10}
              placeholder="Escribe aquí…"
              className="field-input w-full min-w-[12rem] resize text-sm"
            />
          </div>

          <div className="space-y-4 border-t border-border pt-4 md:border-l md:border-t-0 md:pl-6 md:pt-0">
            {/* Subtareas */}
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Subtareas</p>
              <ul className="space-y-1">
                {subtasks.map((s) => (
                  <li key={s.id} className="group/sub flex items-center gap-2">
                    <button
                      onClick={() => onToggleSubtask(s)}
                      className={`flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm border text-[9px] ${
                        s.completed ? "border-primary bg-primary/20 text-primary" : "border-foreground/30"
                      }`}
                    >
                      {s.completed ? "✓" : ""}
                    </button>
                    <span className={`flex-1 text-xs ${s.completed ? "text-muted-foreground line-through" : ""}`}>{s.title}</span>
                    <button
                      onClick={() => onRemoveSubtask(s.id)}
                      className="cursor-pointer text-[10px] text-muted-foreground opacity-0 hover:text-destructive group-hover/sub:opacity-100"
                      aria-label="Eliminar subtarea"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  onAddSubtask(newSubtask);
                  setNewSubtask("");
                }}
                className="mt-1.5 flex gap-1.5"
              >
                <input
                  value={newSubtask}
                  onChange={(e) => setNewSubtask(e.target.value)}
                  placeholder="+ Paso"
                  className="field-input w-full text-xs"
                />
                <button
                  type="submit"
                  className="shrink-0 cursor-pointer rounded-full border border-border px-2 text-xs text-muted-foreground hover:bg-muted"
                >
                  OK
                </button>
              </form>
            </div>

            {/* Fecha límite */}
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Fecha límite</p>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={toDateInputValue(task.dueDate)}
                  onChange={(e) => onUpdate({ dueDate: e.target.value ? new Date(e.target.value).toISOString() : null })}
                  className="field-input text-xs"
                />
                {task.dueDate && (
                  <button onClick={() => onUpdate({ dueDate: null })} className="cursor-pointer text-xs text-muted-foreground hover:text-destructive">
                    Quitar
                  </button>
                )}
              </div>
            </div>

            {/* Proyecto */}
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Proyecto</p>
              <select
                value={task.projectId ?? ""}
                onChange={(e) => onUpdate({ projectId: e.target.value ? Number(e.target.value) : null })}
                className="field-input w-full text-xs"
              >
                <option value="">Sin proyecto</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </div>

            {/* Etiquetas */}
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Etiquetas</p>
              <div className="flex flex-wrap items-center gap-1.5">
                {task.tags.map((tag) => (
                  <span key={tag} className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                    #{tag}
                    <button
                      onClick={() => onUpdate({ tags: task.tags.filter((t) => t !== tag) })}
                      className="cursor-pointer hover:text-destructive"
                      aria-label={`Quitar etiqueta ${tag}`}
                    >
                      ✕
                    </button>
                  </span>
                ))}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const trimmed = newTag.trim().toLowerCase();
                    if (!trimmed || task.tags.includes(trimmed)) return;
                    onUpdate({ tags: [...task.tags, trimmed] });
                    setNewTag("");
                  }}
                  className="flex gap-1"
                >
                  <input
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    placeholder="+ etiqueta"
                    className="field-input w-24 text-xs"
                  />
                  <button type="submit" className="cursor-pointer rounded-full border border-border px-2 text-xs text-muted-foreground hover:bg-muted">
                    OK
                  </button>
                </form>
              </div>
            </div>

            {/* Propiedades personalizadas — una por cada PlannerField de este planner, más
                "+ Añadir propiedad" para crear una nueva sin salir de la tarea (igual que
                "+ Propiedad" en la cabecera del tablero, ver PlannerFieldsDialog). */}
            <div className="space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Propiedades personalizadas</p>
              {fields.map((field) => (
                <label key={field.id} className="block text-xs text-muted-foreground">
                  {field.name}
                  <CustomFieldInput
                    type={field.type}
                    options={field.options}
                    value={(task.customFields?.[String(field.id)] as CustomFieldValue) ?? null}
                    onChange={(value) => onUpdate({ customFields: { [String(field.id)]: value } })}
                  />
                </label>
              ))}
              <InlineAddField onAdd={onAddField} />
            </div>

            {/* Tiempo estimado vs. real */}
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Tiempo (minutos)</p>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  Estimado
                  <input
                    type="number"
                    min={1}
                    defaultValue={task.estimatedMinutes ?? ""}
                    onBlur={(e) => {
                      const value = e.target.value ? Number(e.target.value) : null;
                      if (value !== task.estimatedMinutes) onUpdate({ estimatedMinutes: value });
                    }}
                    className="field-input w-16 text-xs"
                  />
                </label>
                <span className="text-xs text-muted-foreground">Real: {task.actualMinutes}</span>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    onLogTime(Number(minutesToLog));
                    setMinutesToLog("");
                  }}
                  className="flex items-center gap-1.5"
                >
                  <input
                    type="number"
                    min={1}
                    value={minutesToLog}
                    onChange={(e) => setMinutesToLog(e.target.value)}
                    placeholder="+min"
                    className="field-input w-16 text-xs"
                  />
                  <button type="submit" className="cursor-pointer rounded-full border border-border px-2 text-xs text-muted-foreground hover:bg-muted">
                    Registrar
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end border-t border-border pt-4">
          <button
            onClick={() => {
              if (!confirmingDelete) {
                setConfirmingDelete(true);
                return;
              }
              onDelete();
            }}
            onBlur={() => setConfirmingDelete(false)}
            className={`cursor-pointer whitespace-nowrap rounded-full px-4 py-1.5 text-xs transition-colors ${
              confirmingDelete
                ? "bg-destructive text-destructive-foreground"
                : "border border-border text-muted-foreground hover:text-destructive"
            }`}
          >
            {confirmingDelete ? "¿Confirmar eliminar?" : "Eliminar tarea"}
          </button>
        </div>
      </div>
    </div>
  );
}
