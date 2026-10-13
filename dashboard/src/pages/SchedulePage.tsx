import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "../components/AppShell";
import { api, ApiError } from "../api/client";
import { useFetch } from "../hooks/useFetch";
import { Loading, ErrorMessage } from "../components/Feedback";
import { AnnualCalendarLegend } from "../components/AnnualCalendarLegend";
import { Schedule, ScheduleRow } from "../types";

// Celda de texto del horario: un <textarea> en vez de <input> — así Enter inserta un salto de
// línea (asignatura en una línea, aula en la siguiente...) en vez de no hacer nada. Se
// autoajusta la altura al contenido (rows=1 + crecer con scrollHeight) tanto al escribir como al
// cargar un valor ya multilínea; como las celdas están dentro de una <tr>, la fila entera crece
// con ellas sin necesidad de tocar nada más.
function ScheduleCell({
  value,
  placeholder,
  className,
  onChange,
  onBlur,
}: {
  value: string;
  placeholder?: string;
  className: string;
  onChange: (value: string) => void;
  onBlur: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  useEffect(() => {
    if (ref.current) autoGrow(ref.current);
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      rows={1}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => onBlur(e.target.value)}
      className={`w-full resize-none overflow-hidden rounded-none bg-transparent outline-none ${className}`}
    />
  );
}

type DayKey = "monday" | "tuesday" | "wednesday" | "thursday" | "friday";
const DAYS: { key: DayKey; label: string }[] = [
  { key: "monday", label: "Lunes" },
  { key: "tuesday", label: "Martes" },
  { key: "wednesday", label: "Miércoles" },
  { key: "thursday", label: "Jueves" },
  { key: "friday", label: "Viernes" },
];

const VIEW_MODE_KEY = "life-organizer:schedule-view-mode";
type ViewMode = "flechas" | "apilado";

/**
 * Horario semanal fijo de texto libre (típicamente de universidad): el usuario puede tener
 * varios horarios con nombre propio (uno por trimestre/semestre, ver Schedule) y elegir verlos
 * de uno en uno con flechas (por defecto) o todos apilados. Cada uno es una tabla lunes-viernes
 * donde cada celda es una franja horaria en blanco para escribir lo que se quiera (asignatura,
 * aula...) — sin fechas ni estructura forzada, a diferencia de los eventos de Agenda. Debajo de
 * los horarios, un calendario anual con leyenda (ver AnnualCalendarLegend) para marcar
 * vacaciones, evaluaciones, festivos...
 */
export function SchedulePage() {
  const { data, loading, error, reload } = useFetch(() => api.get<{ schedules: Schedule[] }>("/schedule"), []);
  const schedules = useMemo(() => data?.schedules ?? [], [data]);

  const [viewMode, setViewMode] = useState<ViewMode>(() => (localStorage.getItem(VIEW_MODE_KEY) as ViewMode) || "flechas");
  const [activeIndex, setActiveIndex] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  // Id del horario recién creado al que hay que saltar en cuanto `reload()` lo traiga a
  // `schedules` — no se puede hacer `setActiveIndex(schedules.length)` directamente después de
  // llamar a `reload()`: ese `reload()` es asíncrono, así que por un instante `schedules` seguiría
  // reflejando la lista VIEJA (una de menos) con `activeIndex` ya apuntando fuera de rango, y el
  // efecto de abajo lo recortaría de vuelta a 0 antes de que llegaran los datos nuevos.
  const [pendingFocusId, setPendingFocusId] = useState<number | null>(null);

  // Si se borra el horario activo (o cambia el total), el índice de las flechas no debe quedar
  // apuntando fuera de rango.
  useEffect(() => {
    if (activeIndex > schedules.length - 1) setActiveIndex(Math.max(0, schedules.length - 1));
  }, [schedules.length, activeIndex]);

  // En cuanto el horario recién creado aparece en `schedules` (tras el reload), salta a él.
  useEffect(() => {
    if (pendingFocusId === null) return;
    const index = schedules.findIndex((s) => s.id === pendingFocusId);
    if (index !== -1) {
      setActiveIndex(index);
      setPendingFocusId(null);
    }
  }, [schedules, pendingFocusId]);

  const changeViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
  };

  const createSchedule = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    const created = await api.post<Schedule>("/schedule", { name: trimmed });
    setNewName("");
    setShowCreate(false);
    setPendingFocusId(created.id);
    reload();
  };

  const renameSchedule = async (id: number, name: string) => {
    await api.put(`/schedule/${id}`, { name });
    reload();
  };

  const deleteSchedule = async (id: number) => {
    await api.delete(`/schedule/${id}`);
    reload();
  };

  const moveSchedule = async (id: number, direction: "up" | "down") => {
    await api.put(`/schedule/${id}/move`, { direction });
    reload();
  };

  return (
    <>
      <PageHeader
        title="Horario"
        subtitle="Tu horario semanal fijo — universidad, clases, lo que sea"
        action={
          <div className="flex items-center gap-1 rounded-full border border-border p-1 text-xs">
            <button
              onClick={() => changeViewMode("flechas")}
              className={`cursor-pointer rounded-full px-3 py-1.5 transition-colors ${
                viewMode === "flechas" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Flechas
            </button>
            <button
              onClick={() => changeViewMode("apilado")}
              className={`cursor-pointer rounded-full px-3 py-1.5 transition-colors ${
                viewMode === "apilado" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Apilado
            </button>
          </div>
        }
      />

      {error && <ErrorMessage message={error} />}

      {loading ? (
        <Loading label="Cargando horario..." />
      ) : schedules.length === 0 && !showCreate ? (
        <div className="rounded-3xl border border-dashed border-border p-10 text-center">
          <p className="mb-4 text-sm text-muted-foreground">
            Todavía no tienes ningún horario. Crea el primero (p.ej. "1r trimestre" o "Semestre 1").
          </p>
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            + Nuevo horario
          </button>
        </div>
      ) : (
        <div className="space-y-10">
          {/* Una sola fila: las flechas para cambiar de horario a la izquierda (solo en vista
              Flechas) y "+ Nuevo horario" a la derecha — queda justo entre esas flechas y el
              "Eliminar horario" de la cabecera de la tabla, que va inmediatamente debajo. */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            {viewMode === "flechas" ? (
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
                  disabled={activeIndex === 0}
                  className="cursor-pointer rounded-full border border-border px-3 py-1.5 text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                >
                  ‹
                </button>
                <span className="text-xs text-muted-foreground">
                  Horario {activeIndex + 1} de {schedules.length}
                </span>
                <button
                  onClick={() => setActiveIndex((i) => Math.min(schedules.length - 1, i + 1))}
                  disabled={activeIndex === schedules.length - 1}
                  className="cursor-pointer rounded-full border border-border px-3 py-1.5 text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                >
                  ›
                </button>
              </div>
            ) : (
              <div />
            )}

            {showCreate ? (
              <form onSubmit={createSchedule} className="flex gap-2 rounded-2xl border border-dashed border-border p-3">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder='Nombre, p.ej. "2n trimestre"'
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
                + Nuevo horario
              </button>
            )}
          </div>

          {(viewMode === "apilado" ? schedules : schedules.slice(activeIndex, activeIndex + 1)).map((schedule) => {
            const index = schedules.findIndex((s) => s.id === schedule.id);
            return (
              <ScheduleTable
                key={schedule.id}
                schedule={schedule}
                canMoveUp={index > 0}
                canMoveDown={index < schedules.length - 1}
                onRename={(name) => renameSchedule(schedule.id, name)}
                onDelete={() => deleteSchedule(schedule.id)}
                onMoveUp={() => moveSchedule(schedule.id, "up")}
                onMoveDown={() => moveSchedule(schedule.id, "down")}
              />
            );
          })}
        </div>
      )}

      <AnnualCalendarLegend />
    </>
  );
}

function ScheduleTable({
  schedule,
  canMoveUp,
  canMoveDown,
  onRename,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  schedule: Schedule;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onRename: (name: string) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const { data, loading, error, reload } = useFetch(
    () => api.get<{ rows: ScheduleRow[] }>(`/schedule/${schedule.id}/rows`),
    [schedule.id]
  );
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [name, setName] = useState(schedule.name);
  const [confirmingDeleteRowId, setConfirmingDeleteRowId] = useState<number | null>(null);
  const [confirmingDeleteSchedule, setConfirmingDeleteSchedule] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Copia local editable — igual que el patrón ya usado en RichTextEditor/ProyectosPage: se
  // sincroniza desde el fetch, pero mientras el usuario escribe, el estado local manda (no se
  // pisa con cada re-render) y el guardado real ocurre al perder el foco de la celda.
  useEffect(() => {
    if (data) setRows(data.rows);
  }, [data]);

  useEffect(() => {
    setName(schedule.name);
  }, [schedule.name]);

  const updateLocal = (id: number, patch: Partial<ScheduleRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const persist = async (id: number, patch: Record<string, string>) => {
    try {
      await api.put(`/schedule/${schedule.id}/rows/${id}`, patch);
      setSaveError(null);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "No se pudo guardar el cambio.");
    }
  };

  const addRow = async () => {
    await api.post(`/schedule/${schedule.id}/rows`, {});
    reload();
  };

  const removeRow = async (id: number) => {
    await api.delete(`/schedule/${schedule.id}/rows/${id}`);
    setConfirmingDeleteRowId(null);
    reload();
  };

  // Igual que en Proyectos/Apuntes rápidos: primer click pide confirmación, segundo click (en
  // el mismo botón) borra de verdad; alejar el ratón cancela la confirmación pendiente.
  const handleDeleteRowClick = (id: number) => {
    if (confirmingDeleteRowId === id) removeRow(id);
    else setConfirmingDeleteRowId(id);
  };

  const moveRow = async (id: number, direction: "up" | "down") => {
    await api.put(`/schedule/${schedule.id}/rows/${id}/move`, { direction });
    reload();
  };

  const saveName = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === schedule.name) {
      setName(schedule.name);
      return;
    }
    onRename(trimmed);
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          title="Haz clic para renombrar este horario"
          className="min-w-0 flex-1 border-b border-transparent bg-transparent font-serif text-xl outline-none focus:border-primary"
        />
        <div className="flex shrink-0 items-center gap-1">
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
              if (!confirmingDeleteSchedule) {
                setConfirmingDeleteSchedule(true);
                return;
              }
              onDelete();
            }}
            onBlur={() => setConfirmingDeleteSchedule(false)}
            className={`cursor-pointer whitespace-nowrap rounded-full px-3 py-1 text-xs transition-colors ${
              confirmingDeleteSchedule
                ? "bg-destructive text-destructive-foreground"
                : "border border-border text-muted-foreground hover:text-destructive"
            }`}
          >
            {confirmingDeleteSchedule ? "¿Confirmar?" : "Eliminar horario"}
          </button>
        </div>
      </div>

      {saveError && <ErrorMessage message={saveError} />}

      {loading ? (
        <Loading label="Cargando horario..." />
      ) : error ? (
        <ErrorMessage message={error} />
      ) : (
        <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-[var(--shadow-soft)]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  <th className="w-36 px-3 py-3">Hora</th>
                  {DAYS.map((d) => (
                    <th key={d.key} className="px-3 py-3">
                      {d.label}
                    </th>
                  ))}
                  <th className="w-20 px-3 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row, i) => (
                  <tr key={row.id} className="group">
                    <td className="border-r border-border p-0 align-top">
                      <ScheduleCell
                        value={row.timeLabel}
                        onChange={(value) => updateLocal(row.id, { timeLabel: value })}
                        onBlur={(value) => persist(row.id, { timeLabel: value })}
                        placeholder="08:00 - 10:00"
                        className="px-3 py-2.5 text-xs font-medium text-muted-foreground focus:bg-muted/40"
                      />
                    </td>
                    {DAYS.map((d) => (
                      <td key={d.key} className="border-r border-border p-0 align-top last-of-type:border-r-0">
                        <ScheduleCell
                          value={row[d.key]}
                          onChange={(value) => updateLocal(row.id, { [d.key]: value } as Partial<ScheduleRow>)}
                          onBlur={(value) => persist(row.id, { [d.key]: value })}
                          placeholder="—"
                          className="py-2.5 px-3 text-sm placeholder:text-muted-foreground/40 focus:bg-muted/40"
                        />
                      </td>
                    ))}
                    <td className="p-0 text-center align-middle">
                      <div className="flex items-center justify-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => moveRow(row.id, "up")}
                          disabled={i === 0}
                          title="Subir"
                          className="cursor-pointer rounded px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => moveRow(row.id, "down")}
                          disabled={i === rows.length - 1}
                          title="Bajar"
                          className="cursor-pointer rounded px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteRowClick(row.id)}
                          onMouseLeave={() => setConfirmingDeleteRowId((id) => (id === row.id ? null : id))}
                          title={confirmingDeleteRowId === row.id ? "Confirmar eliminar" : "Eliminar franja"}
                          className={`cursor-pointer rounded px-1.5 py-1 text-xs ${
                            confirmingDeleteRowId === row.id
                              ? "font-bold text-destructive opacity-100"
                              : "text-muted-foreground hover:text-destructive"
                          }`}
                        >
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-sm text-muted-foreground">
                      Todavía no tienes ninguna franja horaria. Añade la primera abajo.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <button
            onClick={addRow}
            className="w-full cursor-pointer border-t border-border px-3 py-3 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          >
            + Añadir franja horaria
          </button>
        </div>
      )}
    </div>
  );
}
