import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader, SearchFocus, Tab } from "../components/AppShell";
import { api } from "../api/client";
import { useFetch } from "../hooks/useFetch";
import { Loading, ErrorMessage } from "../components/Feedback";
import { GoalsDonutChart, GOALS_DONUT_PALETTE } from "../components/GoalsDonutChart";
import { HabitsTrackerCard } from "../components/HabitsTrackerCard";
import { QuickNotesCard } from "../components/QuickNotesCard";
import { RecentEntriesCard } from "../components/RecentEntriesCard";
import {
  ExportScope,
  buildIcsFromEvents,
  dateKeyToIsoWeekString,
  downloadTextFile,
  exportEventsToPdf,
  isoWeekStringToMondayKey,
  scopeLabel,
} from "../utils/agendaExport";
import { eventCategoryLabel, eventCategoryStyle } from "../utils/eventCategories";
import { CALENDAR_COLOR_OPTIONS } from "../utils/calendarColors";
import {
  AgendaResponse,
  AgendaYearResponse,
  CalendarColor,
  Event,
  EventCategory,
  FreeTimeResponse,
  Goal,
  GoogleCalendarStatus,
  GoogleCalendarSyncResult,
  Habit,
  IcsImportResult,
  Note,
  RecentProjectEntry,
  RecurringPattern,
} from "../types";

const DAY_LABELS = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];
const RECURRENCES: { value: RecurringPattern; label: string }[] = [
  { value: "daily", label: "Cada día" },
  { value: "weekly", label: "Cada semana" },
  { value: "biweekly", label: "Cada 2 semanas" },
  { value: "monthly", label: "Cada mes" },
  { value: "weekday_range", label: "Rango de días de la semana" },
];
// 1=lunes .. 7=domingo (ISO) — mismo orden que recurringWeekdayStart/End en el backend.
const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: "Lunes" },
  { value: 2, label: "Martes" },
  { value: 3, label: "Miércoles" },
  { value: 4, label: "Jueves" },
  { value: 5, label: "Viernes" },
  { value: 6, label: "Sábado" },
  { value: 7, label: "Domingo" },
];
// Antelaciones de aviso ofrecidas en el formulario — el backend admite cualquier valor entre
// 1 min y 1 semana, pero un puñado de presets cubre el caso de uso real sin abrumar la UI.
const REMINDER_PRESETS: { minutes: number; label: string }[] = [
  { minutes: 15, label: "15 min antes" },
  { minutes: 30, label: "30 min antes" },
  { minutes: 60, label: "1 hora antes" },
  { minutes: 1440, label: "1 día antes" },
];

type ViewMode = "day" | "week" | "month" | "year" | "agenda";
const VIEW_MODES: { value: ViewMode; label: string }[] = [
  { value: "day", label: "Día" },
  { value: "week", label: "Semana" },
  { value: "month", label: "Mes" },
  { value: "year", label: "Año" },
  { value: "agenda", label: "Agenda" },
];

function toKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayKeyOf(event: Event): string {
  return event.startTime.slice(0, 10);
}

// Aritmética de calendario PURA en UTC — nunca mezclar con métodos locales (getDate/setDate)
// aquí: si se parseara `${key}T00:00:00` sin "Z", `new Date` lo interpreta como medianoche
// LOCAL del navegador, y para una timezone por delante de UTC (p.ej. GMT+2) esa medianoche
// local cae en el día UTC ANTERIOR — `toKey` (que sí usa toISOString/UTC) devolvería `key`
// desplazado un día incluso con delta=0. Parsear y desplazar siempre en UTC evita el desfase.
function addDays(key: string, delta: number): string {
  const d = new Date(`${key}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return toKey(d);
}

// Igual razonamiento que addDays: aritmética de calendario pura en UTC — desplazar el AÑO, no
// sumar 365 días (que se desalinearía en años bisiestos).
function addYears(key: string, delta: number): string {
  const d = new Date(`${key}T00:00:00.000Z`);
  d.setUTCFullYear(d.getUTCFullYear() + delta);
  return toKey(d);
}

// Fecha/hora locales (no UTC) de un ISO string, para precargar los inputs del formulario
// con los mismos valores "de pared" que el usuario introdujo al crear el evento.
function localDateOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function localTimeOf(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Traslada un evento a otro día de calendario conservando la hora y duración originales —
// usado por el drag-and-drop de reprogramar (semana y mes).
//
// setUTCFullYear, no setFullYear: dayKeyOf/addDays/la cuadrícula de arriba trocean el día en
// UTC puro (ver el comentario de addDays), así que el día "de destino" que ve este componente
// es un día UTC. Si aquí se mutara en hora LOCAL del navegador, un evento cuya hora local caiga
// cerca de medianoche (p.ej. 00:30 con timezone +2h → 22:30 UTC del día anterior) se movería al
// día local correcto pero a un instante cuyo día UTC es el ANTERIOR al de destino — al recargar,
// dayKeyOf lo volvería a colocar en la columna de al lado, un día desplazado del que se soltó.
function shiftEventToDay(event: Event, targetDayKey: string): { startTime: string; endTime: string } {
  const origStart = new Date(event.startTime);
  const origEnd = new Date(event.endTime);
  const durationMs = origEnd.getTime() - origStart.getTime();

  const [y, m, d] = targetDayKey.split("-").map(Number);
  const newStart = new Date(origStart);
  newStart.setUTCFullYear(y, m - 1, d);
  return { startTime: newStart.toISOString(), endTime: new Date(newStart.getTime() + durationMs).toISOString() };
}

export function AgendaPage({
  focusEventId,
  focusEventStartTime,
  onFocusHandled,
  onNavigate,
}: {
  // Llegada desde un resultado de la búsqueda global (ver AppShell.GlobalSearch): salta a la
  // semana de `focusEventStartTime` y abre el diálogo de ese evento en cuanto carguen sus datos.
  focusEventId?: number;
  focusEventStartTime?: string;
  onFocusHandled?: () => void;
  // Para abrir una libreta desde "Entradas recientes" (ver DashboardPage) — opcional porque
  // Agenda puede montarse sin ese contexto (tests, storybook-like usos sueltos).
  onNavigate?: (tab: Tab, focus?: SearchFocus) => void;
} = {}) {
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [selected, setSelected] = useState(() => (focusEventStartTime ? focusEventStartTime.slice(0, 10) : toKey(new Date())));
  const [open, setOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [showFreeTime, setShowFreeTime] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  // "Agenda" (lista) usa los mismos eventos que "Mes" — solo cambia cómo se pintan (lista
  // cronológica agrupada por día en vez de cuadrícula). "Año" tiene su propio endpoint ligero
  // (ver AgendaYearResponse) porque no necesita el evento completo, solo un recuento por día.
  const { data, loading, error, reload } = useFetch(
    () =>
      viewMode === "month" || viewMode === "agenda"
        ? api.get<AgendaResponse>(`/agenda/month/${selected}`)
        : viewMode === "week"
          ? api.get<AgendaResponse>(`/agenda/week/${selected}`)
          : viewMode === "day"
            ? api.get<AgendaResponse>(`/agenda/day/${selected}`)
            : Promise.resolve(null as unknown as AgendaResponse),
    [selected, viewMode]
  );

  // Se resuelve a `null` sin llamar a la API salvo en vista "Año" — evita malgastar una petición
  // en cada cambio de semana/mes/agenda solo porque las deps cambiaron.
  const { data: yearData, loading: yearLoading } = useFetch(
    () => (viewMode === "year" ? api.get<AgendaYearResponse>(`/agenda/year/${selected}`) : Promise.resolve(null)),
    [selected, viewMode]
  );

  // Una vez cargada la semana de destino, abre el diálogo del evento buscado y avisa al padre
  // para que limpie el foco (no se repite en recargas posteriores ni si el usuario navega a mano).
  useEffect(() => {
    if (!focusEventId || !onFocusHandled) return;
    const match = data?.events.find((e) => e.id === focusEventId);
    if (match) {
      setEditingEvent(match);
      onFocusHandled();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusEventId, data?.events]);

  const { data: goalsData } = useFetch(() => api.get<{ goals: Goal[] }>("/goals?status=active"), []);
  const { data: habitsData, reload: reloadHabits } = useFetch(() => api.get<{ habits: Habit[] }>("/habits"), []);
  const { data: notesData, reload: reloadNotes } = useFetch(() => api.get<{ notes: Note[] }>("/notes"), []);
  const { data: recentEntriesData } = useFetch(() => api.get<{ entries: RecentProjectEntry[] }>("/projects/recent-entries"), []);
  // Categorías de evento (Agenda > + Nuevo evento): el propio usuario las gestiona —añadir,
  // renombrar, cambiar el color o borrar, incluidas las que trae la cuenta por defecto— desde
  // EventCategoryManager, embebido tanto en NewEventForm como en EventDialog.
  const { data: categoriesData, reload: reloadCategories } = useFetch(
    () => api.get<{ categories: EventCategory[] }>("/event-categories"),
    []
  );
  const categories = categoriesData?.categories ?? [];

  // Los días de la cuadrícula se calculan a partir de `selected` (una fecha de calendario,
  // sin ambigüedad de zona horaria) — NO a partir de `data.weekStart`/`monthStart`, que son
  // instantes UTC reales: cuando la timezone del usuario va por delante de UTC (p.ej.
  // Europe/Madrid en verano, +2h), la medianoche local del lunes cae en el día UTC ANTERIOR
  // (23:00 del domingo), así que leer `getUTCDate()` sobre ese instante etiquetaría el lunes
  // como "domingo" — un día de desfase en toda la cuadrícula (y en el día de destino al
  // arrastrar una tarjeta). Estas fechas son "de calendario puro" a mediodía UTC, coherentes
  // con `dayKeyOf` (que hace lo mismo al trocear `event.startTime`).
  const week = useMemo(() => {
    if (viewMode !== "week") return [];
    const weekday = new Date(`${selected}T00:00:00.000Z`).getUTCDay();
    const isoWeekday = weekday === 0 ? 7 : weekday;
    const mondayKey = addDays(selected, -(isoWeekday - 1));
    return Array.from({ length: 7 }, (_, i) => new Date(`${addDays(mondayKey, i)}T00:00:00.000Z`));
  }, [viewMode, selected]);

  const month = useMemo(() => {
    if (viewMode !== "month") return [];
    const firstOfMonthKey = `${selected.slice(0, 7)}-01`;
    const startWeekday = new Date(`${firstOfMonthKey}T00:00:00.000Z`).getUTCDay();
    const startIsoWeekday = startWeekday === 0 ? 7 : startWeekday;
    const gridStartKey = addDays(firstOfMonthKey, -(startIsoWeekday - 1));

    const nextMonthFirst = new Date(`${firstOfMonthKey}T00:00:00.000Z`);
    nextMonthFirst.setUTCMonth(nextMonthFirst.getUTCMonth() + 1);
    const lastOfMonthKey = addDays(toKey(nextMonthFirst), -1);
    const endWeekday = new Date(`${lastOfMonthKey}T00:00:00.000Z`).getUTCDay();
    const endIsoWeekday = endWeekday === 0 ? 7 : endWeekday;
    const gridEndKey = addDays(lastOfMonthKey, 7 - endIsoWeekday);

    const days: Date[] = [];
    let cursorKey = gridStartKey;
    while (cursorKey <= gridEndKey) {
      days.push(new Date(`${cursorKey}T00:00:00.000Z`));
      cursorKey = addDays(cursorKey, 1);
    }
    return days;
  }, [viewMode, selected]);

  const today = toKey(new Date());
  const currentMonthKey = selected.slice(0, 7);

  const rangeLabel = useMemo(() => {
    const fmt = (d: Date) => d.toLocaleDateString("es-ES", { day: "numeric", month: "short", timeZone: "UTC" });
    if (viewMode === "day") {
      return new Date(`${selected}T00:00:00.000Z`).toLocaleDateString("es-ES", {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "UTC",
      });
    }
    if (viewMode === "week") {
      if (week.length === 0) return "";
      return `Semana del ${fmt(week[0])} – ${fmt(week[6])}`;
    }
    if (viewMode === "year") return selected.slice(0, 4);
    return new Date(`${selected.slice(0, 7)}-01T00:00:00.000Z`).toLocaleDateString("es-ES", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  }, [viewMode, week, selected]);

  const moveEventToDay = async (event: Event, targetDayKey: string) => {
    if (dayKeyOf(event) === targetDayKey) return;
    const { startTime, endTime } = shiftEventToDay(event, targetDayKey);
    if (event.isRecurringInstance) {
      // Un evento recurrente no se edita entero al arrastrar una tarjeta: se crea/actualiza
      // la excepción de ESA ocurrencia (identificada por originalStartTime), el resto de la
      // serie no se mueve.
      await api.post(`/agenda/events/${event.id}/exceptions`, {
        originalStartTime: event.originalStartTime,
        action: "moved",
        newStartTime: startTime,
        newEndTime: endTime,
      });
    } else {
      await api.put(`/agenda/events/${event.id}`, { startTime, endTime });
    }
    reload();
  };

  return (
    <>
      <PageHeader
        title="Agenda"
        subtitle={rangeLabel}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center overflow-hidden rounded-full border border-border">
              {VIEW_MODES.map(({ value, label }, index) => (
                <button
                  key={value}
                  onClick={() => setViewMode(value)}
                  className={`cursor-pointer whitespace-nowrap px-3 py-2 text-xs font-medium transition-colors ${index > 0 ? "border-l border-border" : ""} ${
                    viewMode === value ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center overflow-hidden rounded-full border border-border">
              <button
                onClick={() =>
                  setSelected((s) =>
                    viewMode === "year" ? addYears(s, -1) : addDays(s, viewMode === "day" ? -1 : viewMode === "week" ? -7 : -28)
                  )
                }
                className="cursor-pointer whitespace-nowrap px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
                aria-label="Anterior"
              >
                ‹
              </button>
              <button
                onClick={() => setSelected(today)}
                className="cursor-pointer whitespace-nowrap border-x border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
              >
                Hoy
              </button>
              <button
                onClick={() =>
                  setSelected((s) =>
                    viewMode === "year" ? addYears(s, 1) : addDays(s, viewMode === "day" ? 1 : viewMode === "week" ? 7 : 28)
                  )
                }
                className="cursor-pointer whitespace-nowrap px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
                aria-label="Siguiente"
              >
                ›
              </button>
            </div>
            <button onClick={() => setShowFreeTime((v) => !v)} className="cursor-pointer whitespace-nowrap rounded-full border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted">
              {showFreeTime ? "Ocultar tiempo libre" : "⏱ Tiempo libre"}
            </button>
            <AgendaFileMenu onExport={() => setExportOpen(true)} onImported={reload} />
            <GoogleCalendarMenu onSynced={reload} />
            <button onClick={() => setOpen((v) => !v)} className="btn-dark">
              {open ? "Cerrar" : "+ Nuevo evento"}
            </button>
          </div>
        }
      />

      {open && (
        <NewEventForm
          date={selected}
          categories={categories}
          onCategoriesChanged={reloadCategories}
          onSubmit={async (input) => {
            await api.post("/agenda/events", input);
            setOpen(false);
            reload();
          }}
        />
      )}

      {error && <ErrorMessage message={error} />}

      {showFreeTime && <FreeTimePanel date={selected} categories={categories} onScheduled={reload} />}

      <section className="mb-8">
        {viewMode === "year" ? (
          yearLoading ? (
            <Loading label="Cargando el año..." />
          ) : (
            <YearGrid
              year={Number(selected.slice(0, 4))}
              counts={yearData?.counts ?? {}}
              today={today}
              onPickDay={(key) => {
                setSelected(key);
                setViewMode("week");
              }}
            />
          )
        ) : loading ? (
          <Loading label="Cargando agenda..." />
        ) : viewMode === "day" ? (
          <DayColumn date={new Date(`${selected}T00:00:00.000Z`)} events={data?.events ?? []} categories={categories} onSelect={setEditingEvent} />
        ) : viewMode === "week" ? (
          week.length > 0 && (
            <WeekTimeGrid
              week={week}
              events={data?.events ?? []}
              categories={categories}
              today={today}
              onSelect={setEditingEvent}
              onMoveToDay={moveEventToDay}
            />
          )
        ) : viewMode === "agenda" ? (
          <AgendaListView events={data?.events ?? []} categories={categories} today={today} onSelect={setEditingEvent} />
        ) : (
          month.length > 0 && (
            <MonthGrid
              days={month}
              events={data?.events ?? []}
              categories={categories}
              today={today}
              currentMonthKey={currentMonthKey}
              onSelect={setEditingEvent}
              onMoveToDay={moveEventToDay}
              onPickDay={(key) => {
                setSelected(key);
                setViewMode("week");
              }}
            />
          )
        )}
      </section>

      {/* Dos columnas parejas: Hábitos + Entradas recientes a la izquierda (flex-1), Objetivos +
          Notas rápidas a la derecha (lg:max-w-sm) — cada columna apilada, así Notas queda justo
          debajo de Objetivos en vez de suelta más abajo a todo lo ancho. */}
      <section className="mb-8 flex flex-col gap-6 lg:flex-row">
        <div className="flex flex-col gap-6 lg:flex-1">
          <HabitsTrackerCard habits={habitsData?.habits ?? []} onChanged={reloadHabits} />
          <RecentEntriesCard
            entries={recentEntriesData?.entries ?? []}
            onOpenProject={(projectId) => onNavigate?.("proyectos", { type: "project", id: projectId })}
          />
        </div>
        <div className="flex w-full flex-col gap-6 lg:max-w-sm">
          <GoalsProgressCard goals={goalsData?.goals ?? []} />
          <QuickNotesCard notes={notesData?.notes ?? []} onChanged={reloadNotes} />
        </div>
      </section>

      {exportOpen && <AgendaExportDialog initialDate={selected} categories={categories} onClose={() => setExportOpen(false)} />}

      {editingEvent && (
        <EventDialog
          event={editingEvent}
          categories={categories}
          onCategoriesChanged={reloadCategories}
          onClose={() => setEditingEvent(null)}
          onSaved={async (input) => {
            await api.put(`/agenda/events/${editingEvent.id}`, input);
            setEditingEvent(null);
            reload();
          }}
          onDeleted={async () => {
            await api.delete(`/agenda/events/${editingEvent.id}`);
            setEditingEvent(null);
            reload();
          }}
          onSetException={async (input) => {
            await api.post(`/agenda/events/${editingEvent.id}/exceptions`, input);
            setEditingEvent(null);
            reload();
          }}
          onRestoreOccurrence={async () => {
            await api.delete(`/agenda/events/${editingEvent.id}/exceptions/${editingEvent.originalStartTime}`);
            setEditingEvent(null);
            reload();
          }}
        />
      )}
    </>
  );
}

const MONTH_NAMES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];
const MINI_DAY_LABELS = ["L", "M", "X", "J", "V", "S", "D"];

// Vista anual: 12 mini-meses en cuadrícula, cada uno con su propio recuento de días (ver
// AgendaYearResponse) — solo un puntito por día con eventos, sin detalle (para eso está la
// semana/mes/lista). Clicar un día salta a la vista semanal de esa fecha, igual que MonthGrid.
function YearGrid({
  year,
  counts,
  today,
  onPickDay,
}: {
  year: number;
  counts: Record<string, number>;
  today: string;
  onPickDay: (key: string) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 12 }, (_, month) => (
        <MiniMonth key={month} year={year} month={month} counts={counts} today={today} onPickDay={onPickDay} />
      ))}
    </div>
  );
}

function MiniMonth({
  year,
  month,
  counts,
  today,
  onPickDay,
}: {
  year: number;
  month: number; // 0-11
  counts: Record<string, number>;
  today: string;
  onPickDay: (key: string) => void;
}) {
  // Misma aritmética de cuadrícula (relleno hasta semana completa, lunes primero) que el `month`
  // useMemo de AgendaPage, pero en Date.UTC directo en vez de pasar por claves de texto — aquí
  // no hace falta reutilizar addDays/toKey porque no depende de `selected` ni se recalcula fuera
  // de este propio componente.
  const cells = useMemo(() => {
    const first = new Date(Date.UTC(year, month, 1));
    const startIsoWeekday = first.getUTCDay() === 0 ? 7 : first.getUTCDay();
    const gridStart = new Date(Date.UTC(year, month, 1 - (startIsoWeekday - 1)));

    const last = new Date(Date.UTC(year, month + 1, 0));
    const endIsoWeekday = last.getUTCDay() === 0 ? 7 : last.getUTCDay();
    const gridEnd = new Date(Date.UTC(year, month, last.getUTCDate() + (7 - endIsoWeekday)));

    const days: Date[] = [];
    for (const cursor = new Date(gridStart); cursor.getTime() <= gridEnd.getTime(); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      days.push(new Date(cursor));
    }
    return days;
  }, [year, month]);

  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <p className="mb-2 text-center text-xs font-medium">{MONTH_NAMES[month]}</p>
      <div className="grid grid-cols-7 gap-y-1">
        {MINI_DAY_LABELS.map((label, i) => (
          <span key={`${label}-${i}`} className="text-center text-[9px] text-muted-foreground">
            {label}
          </span>
        ))}
        {cells.map((d) => {
          const key = toKey(d);
          const inMonth = d.getUTCMonth() === month;
          const isToday = key === today;
          const hasEvents = inMonth && (counts[key] ?? 0) > 0;
          return (
            <button
              key={key}
              onClick={() => onPickDay(key)}
              disabled={!inMonth}
              className={`relative flex aspect-square cursor-pointer items-center justify-center rounded-full text-[10px] transition-colors disabled:cursor-default ${
                !inMonth ? "text-transparent" : isToday ? "bg-foreground font-medium text-background" : "text-foreground hover:bg-muted"
              }`}
            >
              {inMonth ? d.getUTCDate() : "·"}
              {hasEvents && <span className={`absolute bottom-0.5 size-1 rounded-full ${isToday ? "bg-background" : "bg-primary"}`} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Vista "Agenda": lista cronológica agrupada por día (mismos eventos que "Mes", solo cambia la
// presentación) — sin drag-and-drop, que no tiene columnas de día donde soltar.
function AgendaListView({
  events,
  categories,
  today,
  onSelect,
}: {
  events: Event[];
  categories: EventCategory[];
  today: string;
  onSelect: (event: Event) => void;
}) {
  const grouped = useMemo(() => {
    const byDay = new Map<string, Event[]>();
    for (const event of events) {
      const key = dayKeyOf(event);
      const list = byDay.get(key) ?? [];
      list.push(event);
      byDay.set(key, list);
    }
    return Array.from(byDay.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, dayEvents]) => [key, [...dayEvents].sort((a, b) => a.startTime.localeCompare(b.startTime))] as const);
  }, [events]);

  if (grouped.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
        No hay eventos que mostrar en este periodo.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {grouped.map(([dayKey, dayEvents]) => (
        <div key={dayKey} className={`rounded-2xl border p-4 ${dayKey === today ? "border-primary/30 bg-primary/5" : "border-border bg-card"}`}>
          <p className={`mb-3 text-xs font-medium uppercase tracking-wide ${dayKey === today ? "text-primary" : "text-muted-foreground"}`}>
            {new Date(`${dayKey}T00:00:00.000Z`).toLocaleDateString("es-ES", {
              weekday: "long",
              day: "numeric",
              month: "long",
              timeZone: "UTC",
            })}
            {dayKey === today && " · Hoy"}
          </p>
          <div className="space-y-1.5">
            {dayEvents.map((event) => (
              <EventCard
                key={`${event.id}-${event.startTime}`}
                event={event}
                categories={categories}
                onSelect={() => onSelect(event)}
                onDragStart={() => {}}
                onDragEnd={() => {}}
                draggedId={null}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EventCard({
  event,
  categories,
  compact,
  onSelect,
  onDragStart,
  onDragEnd,
  draggedId,
}: {
  event: Event;
  categories: EventCategory[];
  compact?: boolean;
  onSelect: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  draggedId: string | null;
}) {
  const dragKey = `${event.id}-${event.startTime}`;
  // La categoría ya no se rotula con texto ("Trabajo", "Gimnasio"...) — el propio fondo de la
  // tarjeta lleva el color de esa categoría (antes solo la etiqueta lo llevaba), así que sigue
  // siendo distinguible de un vistazo sin ocupar espacio con el nombre. El nombre no desaparece
  // del todo: queda como `title` (tooltip nativo al pasar el ratón) para no perder accesibilidad.
  const title = event.source === "google" ? `Importado de Google Calendar` : eventCategoryLabel(categories, event);
  return (
    <button
      draggable
      title={title}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      className={`w-full cursor-grab rounded-xl border border-border/60 px-2.5 py-2 text-left transition-colors hover:border-primary/30 active:cursor-grabbing ${eventCategoryStyle(
        categories,
        event.categoryId
      )} ${draggedId === dragKey ? "opacity-40" : ""} ${compact ? "px-2 py-1" : ""}`}
    >
      <p className={`truncate font-medium ${compact ? "text-[11px]" : "text-xs"}`}>
        {event.source === "google" && "📅 "}
        {event.title}
        {event.isRecurring && " ↻"}
        {event.isException && " ✎"}
      </p>
      {!compact && (
        <p className="mt-1.5 text-[10px] opacity-70">
          {new Date(event.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} –{" "}
          {new Date(event.endTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </p>
      )}
    </button>
  );
}

function WeekTimeGrid({
  week,
  events,
  categories,
  today,
  onSelect,
  onMoveToDay,
}: {
  week: Date[];
  events: Event[];
  categories: EventCategory[];
  today: string;
  onSelect: (event: Event) => void;
  onMoveToDay: (event: Event, targetDayKey: string) => void;
}) {
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const eventsByDragKey = useMemo(() => {
    const map = new Map<string, Event>();
    events.forEach((e) => map.set(`${e.id}-${e.startTime}`, e));
    return map;
  }, [events]);

  const handleDrop = (e: React.DragEvent, dayKey: string) => {
    e.preventDefault();
    setDragOverKey(null);
    const dragKey = e.dataTransfer.getData("text/plain");
    const event = eventsByDragKey.get(dragKey);
    if (event) onMoveToDay(event, dayKey);
  };

  return (
    <div className="overflow-x-auto rounded-3xl border border-border bg-card shadow-[var(--shadow-soft)]">
      <div className="grid min-w-[720px] grid-cols-7 divide-x divide-border">
        {week.map((d, i) => {
          const key = toKey(d);
          const isToday = key === today;
          const dayEvents = events.filter((e) => dayKeyOf(e) === key).sort((a, b) => a.startTime.localeCompare(b.startTime));

          return (
            <div
              key={key}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverKey(key);
              }}
              onDragLeave={() => setDragOverKey((k) => (k === key ? null : k))}
              onDrop={(e) => handleDrop(e, key)}
              className={`flex flex-col transition-colors ${dragOverKey === key ? "bg-primary/5" : ""}`}
            >
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-xs font-medium text-muted-foreground">{DAY_LABELS[i]}</span>
                <span
                  className={`flex size-6 items-center justify-center rounded-full text-xs ${
                    isToday ? "bg-primary font-bold text-primary-foreground" : "text-foreground"
                  }`}
                >
                  {d.getUTCDate()}
                </span>
              </div>

              <div className="flex flex-1 flex-col gap-1.5 px-1.5 pb-2">
                {dayEvents.map((event) => {
                  const dragKey = `${event.id}-${event.startTime}`;
                  return (
                    <EventCard
                      key={dragKey}
                      event={event}
                      categories={categories}
                      draggedId={draggedKey}
                      onSelect={() => onSelect(event)}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", dragKey);
                        setDraggedKey(dragKey);
                      }}
                      onDragEnd={() => setDraggedKey(null)}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Vista "Día": una sola columna a todo el ancho, sin drag-and-drop (no hay otro día al que
// soltar una tarjeta) — eventos del día ordenados por hora, con detalle completo (igual que una
// columna de WeekTimeGrid, pero sin comprimir).
function DayColumn({
  date,
  events,
  categories,
  onSelect,
}: {
  date: Date;
  events: Event[];
  categories: EventCategory[];
  onSelect: (event: Event) => void;
}) {
  const key = toKey(date);
  const dayEvents = events.filter((e) => dayKeyOf(e) === key).sort((a, b) => a.startTime.localeCompare(b.startTime));

  return (
    <div className="mx-auto max-w-xl rounded-3xl border border-border bg-card p-4 shadow-[var(--shadow-soft)] sm:p-6">
      {dayEvents.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          No hay eventos este día.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {dayEvents.map((event) => (
            <EventCard
              key={`${event.id}-${event.startTime}`}
              event={event}
              categories={categories}
              onSelect={() => onSelect(event)}
              onDragStart={() => {}}
              onDragEnd={() => {}}
              draggedId={null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MonthGrid({
  days,
  events,
  categories,
  today,
  currentMonthKey,
  onSelect,
  onMoveToDay,
  onPickDay,
}: {
  days: Date[];
  events: Event[];
  categories: EventCategory[];
  today: string;
  currentMonthKey: string;
  onSelect: (event: Event) => void;
  onMoveToDay: (event: Event, targetDayKey: string) => void;
  onPickDay: (dayKey: string) => void;
}) {
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const MAX_VISIBLE = 3;

  const eventsByDragKey = useMemo(() => {
    const map = new Map<string, Event>();
    events.forEach((e) => map.set(`${e.id}-${e.startTime}`, e));
    return map;
  }, [events]);

  const handleDrop = (e: React.DragEvent, dayKey: string) => {
    e.preventDefault();
    setDragOverKey(null);
    const dragKey = e.dataTransfer.getData("text/plain");
    const event = eventsByDragKey.get(dragKey);
    if (event) onMoveToDay(event, dayKey);
  };

  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-[var(--shadow-soft)]">
      <div className="grid grid-cols-7 divide-x divide-border border-b border-border">
        {DAY_LABELS.map((label) => (
          <div key={label} className="px-3 py-2.5 text-center text-xs font-medium text-muted-foreground">
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 divide-x divide-y divide-border">
        {days.map((d) => {
          const key = toKey(d);
          const isToday = key === today;
          const inMonth = key.slice(0, 7) === currentMonthKey;
          const dayEvents = events.filter((e) => dayKeyOf(e) === key).sort((a, b) => a.startTime.localeCompare(b.startTime));
          const hidden = Math.max(0, dayEvents.length - MAX_VISIBLE);

          return (
            <div
              key={key}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverKey(key);
              }}
              onDragLeave={() => setDragOverKey((k) => (k === key ? null : k))}
              onDrop={(e) => handleDrop(e, key)}
              className={`flex min-h-[7rem] flex-col gap-1 p-1.5 transition-colors ${
                dragOverKey === key ? "bg-primary/5" : ""
              } ${inMonth ? "" : "bg-muted/30"}`}
            >
              <button
                onClick={() => onPickDay(key)}
                className={`self-end flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-xs transition-colors hover:bg-muted ${
                  isToday ? "bg-primary font-bold text-primary-foreground" : inMonth ? "text-foreground" : "text-muted-foreground/50"
                }`}
              >
                {d.getUTCDate()}
              </button>
              <div className="flex flex-col gap-1">
                {dayEvents.slice(0, MAX_VISIBLE).map((event) => {
                  const dragKey = `${event.id}-${event.startTime}`;
                  return (
                    <EventCard
                      key={dragKey}
                      event={event}
                      categories={categories}
                      compact
                      draggedId={draggedKey}
                      onSelect={() => onSelect(event)}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", dragKey);
                        setDraggedKey(dragKey);
                      }}
                      onDragEnd={() => setDraggedKey(null)}
                    />
                  );
                })}
                {hidden > 0 && (
                  <button onClick={() => onPickDay(key)} className="cursor-pointer px-2 text-left text-[10px] text-muted-foreground hover:text-foreground">
                    +{hidden} más
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FreeTimePanel({ date, categories, onScheduled }: { date: string; categories: EventCategory[]; onScheduled: () => void }) {
  const { data, loading, error, reload } = useFetch(() => api.get<FreeTimeResponse>(`/agenda/free-time/${date}`), [date]);

  const scheduleSuggestion = async (suggestion: FreeTimeResponse["suggestions"][number]) => {
    // Sin selector propio (es una sugerencia de un clic): cae en "Trabajo" si existe, o si no en
    // la primera categoría disponible — el usuario siempre puede cambiarla después desde el
    // evento ya creado.
    const categoryId = categories.find((c) => c.label === "Trabajo")?.id ?? categories[0]?.id;
    if (!categoryId) return; // sin categorías (el usuario las borró todas) — nada que asignar
    await api.post("/agenda/events", {
      title: suggestion.task.title,
      categoryId,
      startTime: suggestion.block.start,
      endTime: new Date(new Date(suggestion.block.start).getTime() + suggestion.task.estimatedMinutes * 60000).toISOString(),
    });
    reload();
    onScheduled();
  };

  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <section className="mb-8 rounded-3xl border border-border bg-card p-6">
      <h2 className="mb-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
        Tiempo libre · {new Date(`${date}T00:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "long" })}
      </h2>
      <p className="mb-4 text-xs text-muted-foreground">Huecos entre 08:00 y 22:00, con sugerencias del Planificador que encajan.</p>

      {loading ? (
        <Loading label="Calculando huecos..." />
      ) : error ? (
        <ErrorMessage message={error} />
      ) : (data?.freeBlocks.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">Sin huecos ese día — agenda completa.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {data?.freeBlocks.map((block) => {
            const suggestion = data.suggestions.find((s) => s.block.start === block.start);
            return (
              <div key={block.start} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-4 py-2.5">
                <span className="text-sm">
                  {fmtTime(block.start)} – {fmtTime(block.end)}{" "}
                  <span className="text-xs text-muted-foreground">({block.durationMinutes} min libres)</span>
                </span>
                {suggestion ? (
                  <button
                    onClick={() => scheduleSuggestion(suggestion)}
                    className="cursor-pointer rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
                  >
                    + Meter "{suggestion.task.title}" ({suggestion.task.estimatedMinutes} min)
                  </button>
                ) : (
                  <span className="text-xs text-muted-foreground/60">Sin tarea pendiente que encaje</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

const EXPORT_SCOPES: { value: ExportScope; label: string }[] = [
  { value: "day", label: "Día" },
  { value: "week", label: "Semana" },
  { value: "month", label: "Mes" },
  { value: "year", label: "Año" },
];

/**
 * Diálogo de exportación: el usuario elige un periodo (día/semana/mes/año, el actual — precargado
 * a partir de `initialDate`, la fecha que se estuviera viendo — o cualquier otro) y un formato
 * (.ics para importar en otro calendario, o PDF). Pide los eventos de ese periodo sin paginar a
 * `/agenda/export/:scope/:date` (ver agendaController.getAgendaExport) y genera el archivo en el
 * propio navegador (ver utils/agendaExport.ts) — no hay petición previa "de vista previa", solo
 * al pulsar "Descargar", igual que FinanceExportMenu en FinanzasPage.tsx.
 */
function AgendaExportDialog({
  initialDate,
  categories,
  onClose,
}: {
  initialDate: string;
  categories: EventCategory[];
  onClose: () => void;
}) {
  const [scope, setScope] = useState<ExportScope>("week");
  const [day, setDay] = useState(initialDate);
  const [week, setWeek] = useState(() => dateKeyToIsoWeekString(initialDate));
  const [month, setMonth] = useState(initialDate.slice(0, 7));
  const [year, setYear] = useState(() => Number(initialDate.slice(0, 4)));
  const [format, setFormat] = useState<"ics" | "pdf">("ics");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fecha (cualquiera dentro del periodo elegido) que se manda al backend — el endpoint calcula
  // el rango exacto (lunes-domingo, día 1-último del mes...) a partir de ella, igual que las
  // vistas semana/mes/año normales.
  const resolvedDate =
    scope === "day"
      ? day
      : scope === "week"
        ? (isoWeekStringToMondayKey(week) ?? initialDate)
        : scope === "month"
          ? `${month}-01`
          : `${year}-01-01`;

  const runExport = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await api.get<AgendaResponse>(`/agenda/export/${scope}/${resolvedDate}`);
      const label = scopeLabel(scope, response);
      if (format === "ics") {
        downloadTextFile(buildIcsFromEvents(response.events), `agenda-${scope}-${resolvedDate}.ics`, "text/calendar;charset=utf-8");
      } else {
        exportEventsToPdf(`Agenda · ${label}`, "", response.events, response.timezone, categories);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo exportar la agenda");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-foreground/50 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-3xl bg-card p-6 shadow-[var(--shadow-soft)] sm:p-8">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-serif text-xl">Exportar agenda</h2>
          <button type="button" onClick={onClose} className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            ✕ Cerrar
          </button>
        </div>

        <p className="mb-1.5 text-xs text-muted-foreground">Periodo</p>
        <div className="mb-4 flex items-center overflow-hidden rounded-full border border-border">
          {EXPORT_SCOPES.map(({ value, label }, index) => (
            <button
              key={value}
              type="button"
              onClick={() => setScope(value)}
              className={`flex-1 cursor-pointer px-3 py-2 text-xs font-medium transition-colors ${index > 0 ? "border-l border-border" : ""} ${
                scope === value ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mb-5">
          {scope === "day" && <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="field-input w-full" />}
          {scope === "week" && <input type="week" value={week} onChange={(e) => setWeek(e.target.value)} className="field-input w-full" />}
          {scope === "month" && <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="field-input w-full" />}
          {scope === "year" && (
            <input type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value))} className="field-input w-full" />
          )}
        </div>

        <p className="mb-1.5 text-xs text-muted-foreground">Formato</p>
        <div className="mb-6 flex items-center overflow-hidden rounded-full border border-border">
          <button
            type="button"
            onClick={() => setFormat("ics")}
            className={`flex-1 cursor-pointer px-3 py-2 text-xs font-medium transition-colors ${
              format === "ics" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            .ics · importar a otro calendario
          </button>
          <button
            type="button"
            onClick={() => setFormat("pdf")}
            className={`flex-1 cursor-pointer border-l border-border px-3 py-2 text-xs font-medium transition-colors ${
              format === "pdf" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            PDF
          </button>
        </div>

        {error && <ErrorMessage message={error} />}

        <button onClick={runExport} disabled={busy} className="btn-dark w-full disabled:opacity-50">
          {busy ? "Exportando..." : "Descargar"}
        </button>
      </div>
    </div>
  );
}

/**
 * Exportar/importar .ics, unificados en un mismo control de dos segmentos (antes eran dos
 * botones sueltos en la cabecera) — "Exportar" abre AgendaExportDialog (día/semana/mes/año
 * concretos, .ics o PDF), "Importar" lee el archivo elegido como texto en el propio navegador y
 * lo manda como JSON (no hace falta multipart para un solo archivo de texto).
 */
function AgendaFileMenu({ onExport, onImported }: { onExport: () => void; onImported: () => void }) {
  const [busy, setBusy] = useState(false);
  const [importSummary, setImportSummary] = useState<IcsImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const importIcs = async (file: File) => {
    setBusy(true);
    setImportSummary(null);
    try {
      const text = await file.text();
      const result = await api.post<IcsImportResult>("/agenda/ics/import", { ics: text });
      setImportSummary(result);
      onImported();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <div className="flex items-center overflow-hidden rounded-full border border-border">
        {/* Solo icono a propósito (sin la etiqueta "Exportar" al lado): con etiqueta, en anchos de
            ventana ajustados este control competía por espacio con el resto de la cabecera y a
            veces acababa recortado — un botón de solo icono no tiene ese problema en ningún ancho.
            `title` conserva la pista para quien pase el ratón por encima (y para lectores de
            pantalla, junto con aria-label). */}
        <button
          onClick={onExport}
          title="Exportar agenda"
          aria-label="Exportar agenda"
          className="flex size-9 cursor-pointer items-center justify-center text-sm text-muted-foreground transition-colors hover:bg-muted"
        >
          ↓
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          title="Importar eventos desde un .ics"
          aria-label="Importar eventos desde un .ics"
          className="flex size-9 cursor-pointer items-center justify-center border-l border-border text-sm text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          ↑
        </button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".ics,text/calendar"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) importIcs(file);
          e.target.value = "";
        }}
      />

      {importSummary && (
        <div className="absolute right-0 top-full z-20 mt-2 w-64 rounded-2xl border border-border bg-card p-3 text-xs shadow-[var(--shadow-soft)]">
          <p className="mb-1 font-medium">Importación completada</p>
          <p className="text-muted-foreground">{importSummary.created} evento(s) creado(s)</p>
          {importSummary.importedAsSingleOccurrence > 0 && (
            <p className="text-muted-foreground">{importSummary.importedAsSingleOccurrence} con recurrencia no soportada (solo 1ª ocurrencia)</p>
          )}
          {importSummary.skippedUnparsable > 0 && <p className="text-muted-foreground">{importSummary.skippedUnparsable} ignorado(s) (sin fecha válida)</p>}
          <button onClick={() => setImportSummary(null)} className="mt-2 cursor-pointer text-primary hover:underline">
            Cerrar
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Integración de solo lectura con Google Calendar (ver googleCalendarService en el backend):
 * conectar es una navegación completa del navegador a la URL de consentimiento de Google (no un
 * fetch de la SPA), y Google redirige de vuelta al dashboard con `?google=connected|error` en la
 * URL (ver App.tsx: aquí no hay router real) — este componente consume ese aviso una sola vez y
 * lo limpia de la URL. Aparte de la sincronización manual, el backend también sincroniza solo
 * cada 30 min (ver googleCalendarSyncScheduler).
 */
function GoogleCalendarMenu({ onSynced }: { onSynced: () => void }) {
  const { data: status, loading, reload } = useFetch(() => api.get<GoogleCalendarStatus>("/integrations/google/status"), []);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [redirectNotice, setRedirectNotice] = useState<"connected" | "error" | null>(null);
  const [syncSummary, setSyncSummary] = useState<GoogleCalendarSyncResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const google = params.get("google");
    if (google !== "connected" && google !== "error") return;
    setRedirectNotice(google);
    params.delete("google");
    const search = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (search ? `?${search}` : ""));
    if (google === "connected") reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const { url } = await api.get<{ url: string }>("/integrations/google/connect");
      window.location.href = url;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "No se pudo iniciar la conexión con Google");
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const result = await api.post<GoogleCalendarSyncResult>("/integrations/google/sync");
      setSyncSummary(result);
      reload();
      onSynced();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "No se pudo sincronizar");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await api.delete("/integrations/google/disconnect");
      setMenuOpen(false);
      setSyncSummary(null);
      reload();
      onSynced();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "No se pudo desconectar");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return null;
  const connected = status?.connected ?? false;

  return (
    <div className="relative">
      <button
        onClick={() => (connected ? setMenuOpen((v) => !v) : connect())}
        disabled={busy}
        title={connected ? `Conectado como ${status?.email}` : "Conectar Google Calendar"}
        className={`cursor-pointer whitespace-nowrap rounded-full border px-3 py-2 text-xs transition-colors disabled:opacity-50 ${
          connected ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"
        }`}
      >
        📅 {connected ? "Google Calendar" : "Conectar Google"}
      </button>

      {redirectNotice && (
        <div className="absolute right-0 top-full z-20 mt-2 w-64 rounded-2xl border border-border bg-card p-3 text-xs shadow-[var(--shadow-soft)]">
          <p className={redirectNotice === "connected" ? "text-primary" : "text-destructive"}>
            {redirectNotice === "connected" ? "Google Calendar conectado" : "No se pudo conectar con Google Calendar"}
          </p>
          <button onClick={() => setRedirectNotice(null)} className="mt-2 cursor-pointer text-muted-foreground hover:underline">
            Cerrar
          </button>
        </div>
      )}

      {actionError && (
        <div className="absolute right-0 top-full z-20 mt-2 w-64 rounded-2xl border border-destructive/30 bg-card p-3 text-xs shadow-[var(--shadow-soft)]">
          <p className="text-destructive">{actionError}</p>
          <button onClick={() => setActionError(null)} className="mt-2 cursor-pointer text-muted-foreground hover:underline">
            Cerrar
          </button>
        </div>
      )}

      {menuOpen && connected && (
        <div className="absolute right-0 top-full z-20 mt-2 w-72 rounded-2xl border border-border bg-card p-3 text-xs shadow-[var(--shadow-soft)]">
          <p className="mb-1 font-medium">Conectado como {status?.email}</p>
          <p className="mb-3 text-muted-foreground">
            {status?.lastSyncedAt ? `Última sincronización: ${new Date(status.lastSyncedAt).toLocaleString("es-ES")}` : "Todavía no se ha sincronizado"}
          </p>
          {syncSummary && (
            <p className="mb-3 text-muted-foreground">
              {syncSummary.imported} nuevo(s) · {syncSummary.updated} actualizado(s) · {syncSummary.removed} eliminado(s)
            </p>
          )}
          <div className="flex gap-2">
            <button onClick={sync} disabled={busy} className="btn-dark flex-1 disabled:opacity-50">
              Sincronizar ahora
            </button>
            <button
              onClick={disconnect}
              disabled={busy}
              className="cursor-pointer rounded-full border border-border px-3 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
            >
              Desconectar
            </button>
          </div>
          <p className="mt-3 text-[10px] text-muted-foreground">
            Se sincroniza sola cada 30 min. Solo importa: editar aquí un evento de Google no cambia nada en tu cuenta, y la próxima
            sincronización lo sobrescribe con la versión de Google.
          </p>
        </div>
      )}
    </div>
  );
}

interface EventInputFields {
  title: string;
  categoryId: number;
  startTime: string;
  endTime: string;
  isRecurring: boolean;
  recurringPattern?: RecurringPattern;
  // Solo se envían cuando recurringPattern === "weekday_range".
  recurringWeekdayStart?: number;
  recurringWeekdayEnd?: number;
  reminderMinutesBefore: number[];
  guests: string[];
}

// Los dos <select> "de X a Y" del formulario, para no duplicarlos tres veces (NewEventForm y
// EventDialog) — el resto de campos de recurrencia (checkbox + select de patrón) sí siguen
// duplicados, ya lo estaban antes de este rango y sus layouts de grid difieren bastante entre
// los dos formularios como para compensar extraerlos también.
function WeekdayRangeFields({
  start,
  end,
  onStartChange,
  onEndChange,
  className,
}: {
  start: number;
  end: number;
  onStartChange: (value: number) => void;
  onEndChange: (value: number) => void;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <select value={start} onChange={(e) => onStartChange(Number(e.target.value))} className="field-input flex-1">
        {WEEKDAYS.map((d) => (
          <option key={d.value} value={d.value}>
            {d.label}
          </option>
        ))}
      </select>
      <span className="shrink-0 text-xs text-muted-foreground">a</span>
      <select value={end} onChange={(e) => onEndChange(Number(e.target.value))} className="field-input flex-1">
        {WEEKDAYS.map((d) => (
          <option key={d.value} value={d.value}>
            {d.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ReminderCheckboxes({ value, onChange }: { value: number[]; onChange: (minutes: number[]) => void }) {
  const toggle = (minutes: number) => {
    onChange(value.includes(minutes) ? value.filter((m) => m !== minutes) : [...value, minutes].sort((a, b) => a - b));
  };
  return (
    <div>
      <p className="mb-1.5 text-xs text-muted-foreground">Avisarme</p>
      <div className="flex flex-wrap gap-2">
        {REMINDER_PRESETS.map((preset) => (
          <label
            key={preset.minutes}
            className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
              value.includes(preset.minutes) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/30"
            }`}
          >
            <input type="checkbox" checked={value.includes(preset.minutes)} onChange={() => toggle(preset.minutes)} className="sr-only" />
            {preset.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function GuestsEditor({ value, onChange }: { value: string[]; onChange: (guests: string[]) => void }) {
  const [draft, setDraft] = useState("");
  return (
    <div>
      <p className="mb-1.5 text-xs text-muted-foreground">Invitados</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((guest) => (
          <span key={guest} className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
            {guest}
            <button type="button" onClick={() => onChange(value.filter((g) => g !== guest))} className="cursor-pointer hover:text-destructive" aria-label={`Quitar a ${guest}`}>
              ✕
            </button>
          </span>
        ))}
        {/* Div, no <form>: este editor vive DENTRO del <form> del evento (NewEventForm/EventDialog)
            — un <form> anidado es HTML inválido y el navegador lo "levanta" fuera de su sitio,
            así que el botón "OK" acababa enviando el formulario del evento entero en vez de
            solo añadir el invitado. type="button" + onClick evita cualquier semántica de envío. */}
        <div className="flex gap-1">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              const trimmed = draft.trim();
              if (!trimmed || value.includes(trimmed)) return;
              onChange([...value, trimmed]);
              setDraft("");
            }}
            placeholder="+ nombre o email"
            className="field-input w-36 text-xs"
          />
          <button
            type="button"
            onClick={() => {
              const trimmed = draft.trim();
              if (!trimmed || value.includes(trimmed)) return;
              onChange([...value, trimmed]);
              setDraft("");
            }}
            className="cursor-pointer rounded-full border border-border px-2 text-xs text-muted-foreground hover:bg-muted"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

// Selector de categoría del evento + gestión inline, fundidos en un solo control: cada categoría
// es un chip clicable que a la vez SELECCIONA esa categoría para el evento (resaltado con borde)
// y permite renombrarla, cambiar su color o borrarla (incluidas las que trae la cuenta por
// defecto, "Trabajo"/"Estudio"...) sin salir del formulario. Antes había un <select> separado
// para elegir + un botón "Gestionar categorías" que enseñaba/ocultaba este mismo panel — quitados
// los dos: el panel de chips se ve siempre y es la única forma de elegir categoría, no hay nada
// que desplegar ni alternar.
function EventCategoryField({
  categoryId,
  onChange,
  categories,
  onCategoriesChanged,
}: {
  categoryId: number | null;
  onChange: (id: number) => void;
  categories: EventCategory[];
  onCategoriesChanged: () => void;
}) {
  return <EventCategoryManager categories={categories} onChanged={onCategoriesChanged} selectedId={categoryId} onSelect={onChange} />;
}

function EventCategoryManager({
  categories,
  onChanged,
  selectedId,
  onSelect,
}: {
  categories: EventCategory[];
  onChanged: () => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  const [editingColorId, setEditingColorId] = useState<number | null>(null);
  const colorPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editingColorId === null) return;
    const closeOnOutsideClick = (e: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) setEditingColorId(null);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [editingColorId]);

  const addCategory = async (label: string, color: CalendarColor) => {
    await api.post("/event-categories", { label, color });
    onChanged();
  };
  const renameCategory = async (id: number, label: string) => {
    await api.put(`/event-categories/${id}`, { label });
    onChanged();
  };
  const changeCategoryColor = async (id: number, color: CalendarColor) => {
    setEditingColorId(null);
    await api.put(`/event-categories/${id}`, { color });
    onChanged();
  };
  const deleteCategory = async (id: number) => {
    await api.delete(`/event-categories/${id}`);
    onChanged();
  };

  return (
    <div className="rounded-2xl border border-border bg-background p-3">
      <p className="mb-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Categorías de evento</p>
      <div className="flex flex-wrap items-center gap-2">
        {categories.map((category) => {
          const isRenaming = renamingId === category.id;
          const isSelected = selectedId === category.id;
          const swatch = CALENDAR_COLOR_OPTIONS.find((o) => o.key === category.color)?.swatch ?? "bg-muted";
          return (
            <div key={category.id} className="group relative">
              {isRenaming ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={async () => {
                    const trimmed = renameValue.trim();
                    setRenamingId(null);
                    if (trimmed && trimmed !== category.label) await renameCategory(category.id, trimmed);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  className="rounded-full border border-primary bg-background px-3 py-1.5 text-xs outline-none"
                />
              ) : (
                // <div> con onClick, no <button>: dentro va el botón de color (y, al pasar el
                // ratón, renombrar/borrar) — anidar <button> dentro de <button> es HTML inválido.
                // Esos botones internos ya paran la propagación del click, así que seleccionar la
                // categoría (clic en el chip) y editarla (clic en sus controles) no chocan entre sí.
                <div
                  onClick={() => onSelect(category.id)}
                  className={`flex cursor-pointer items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs transition-colors ${
                    isSelected ? "border-primary bg-primary/10" : "border-border hover:border-primary/30"
                  }`}
                >
                  <button
                    type="button"
                    title="Cambiar color"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingColorId((id) => (id === category.id ? null : category.id));
                    }}
                    className={`size-3.5 shrink-0 cursor-pointer rounded-full transition-shadow hover:ring-2 hover:ring-foreground/40 ${swatch}`}
                  />
                  <span className={isSelected ? "font-medium text-primary" : ""}>{category.label}</span>
                </div>
              )}
              {editingColorId === category.id && (
                <div
                  ref={colorPickerRef}
                  className="absolute left-0 top-full z-10 mt-1 flex items-center gap-1 rounded-full border border-border bg-card p-1.5 shadow-[var(--shadow-soft)]"
                >
                  {CALENDAR_COLOR_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      title={opt.label}
                      onClick={() => changeCategoryColor(category.id, opt.key)}
                      className={`size-5 shrink-0 cursor-pointer rounded-full ${opt.swatch} ${
                        category.color === opt.key ? "ring-2 ring-foreground ring-offset-1 ring-offset-background" : ""
                      }`}
                    />
                  ))}
                </div>
              )}
              {!isRenaming && (
                <span className="absolute -right-1.5 -top-7 z-10 flex items-center gap-0.5 rounded-full border border-border bg-card px-0.5 py-0.5 opacity-0 shadow-[var(--shadow-soft)] transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    title="Renombrar"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenamingId(category.id);
                      setRenameValue(category.label);
                    }}
                    className="cursor-pointer rounded p-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    title={confirmingDeleteId === category.id ? "Confirmar eliminar" : "Eliminar categoría"}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirmingDeleteId === category.id) {
                        setConfirmingDeleteId(null);
                        deleteCategory(category.id);
                      } else {
                        setConfirmingDeleteId(category.id);
                      }
                    }}
                    onMouseLeave={() => setConfirmingDeleteId((id) => (id === category.id ? null : id))}
                    className={`cursor-pointer rounded p-1 text-xs ${
                      confirmingDeleteId === category.id ? "font-bold text-destructive" : "text-muted-foreground hover:text-destructive"
                    }`}
                  >
                    ✕
                  </button>
                </span>
              )}
            </div>
          );
        })}

        {showAdd ? (
          <AddEventCategoryForm
            onCancel={() => setShowAdd(false)}
            onAdd={async (label, color) => {
              await addCategory(label, color);
              setShowAdd(false);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="cursor-pointer rounded-full border border-dashed border-primary/30 bg-primary/5 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
          >
            + Categoría
          </button>
        )}
      </div>
    </div>
  );
}

function AddEventCategoryForm({ onAdd, onCancel }: { onAdd: (label: string, color: CalendarColor) => Promise<void>; onCancel: () => void }) {
  const [label, setLabel] = useState("");
  const [color, setColor] = useState<CalendarColor>(CALENDAR_COLOR_OPTIONS[0].key);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = label.trim();
    if (!trimmed) return;
    onAdd(trimmed, color);
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 rounded-full border border-border bg-background px-3 py-1">
      <input
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Nombre"
        className="w-28 bg-transparent text-xs outline-none"
      />
      <div className="flex items-center gap-1">
        {CALENDAR_COLOR_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            title={opt.label}
            onClick={() => setColor(opt.key)}
            className={`size-4 shrink-0 cursor-pointer rounded-full ${opt.swatch} ${
              color === opt.key ? "ring-2 ring-foreground ring-offset-1 ring-offset-background" : ""
            }`}
          />
        ))}
      </div>
      <button type="submit" className="btn-dark shrink-0 px-2.5 py-1 text-[11px]">
        Crear
      </button>
      <button type="button" onClick={onCancel} className="shrink-0 cursor-pointer text-xs text-muted-foreground hover:text-foreground">
        Cancelar
      </button>
    </form>
  );
}

function EventDialog({
  event,
  categories,
  onCategoriesChanged,
  onClose,
  onSaved,
  onDeleted,
  onSetException,
  onRestoreOccurrence,
}: {
  event: Event;
  categories: EventCategory[];
  onCategoriesChanged: () => void;
  onClose: () => void;
  onSaved: (input: EventInputFields) => Promise<void>;
  onDeleted: () => Promise<void>;
  onSetException: (input: { originalStartTime?: string; action: "moved" | "cancelled"; newStartTime?: string; newEndTime?: string }) => Promise<void>;
  onRestoreOccurrence: () => Promise<void>;
}) {
  const [title, setTitle] = useState(event.title);
  const [eventDate, setEventDate] = useState(localDateOf(event.startTime));
  const [startTime, setStartTime] = useState(localTimeOf(event.startTime));
  const [endTime, setEndTime] = useState(localTimeOf(event.endTime));
  const [categoryId, setCategoryId] = useState<number | null>(event.categoryId);
  const [isRecurring, setIsRecurring] = useState(event.isRecurring ?? false);
  const [recurringPattern, setRecurringPattern] = useState<RecurringPattern>(event.recurringPattern ?? "weekly");
  // Por defecto lunes a viernes (1-5) — el caso de uso que da nombre a la funcionalidad.
  const [recurringWeekdayStart, setRecurringWeekdayStart] = useState(event.recurringWeekdayStart ?? 1);
  const [recurringWeekdayEnd, setRecurringWeekdayEnd] = useState(event.recurringWeekdayEnd ?? 5);
  const [reminderMinutesBefore, setReminderMinutesBefore] = useState<number[]>(event.reminderMinutesBefore ?? [30]);
  const [guests, setGuests] = useState<string[]>(event.guests ?? []);
  const [submitting, setSubmitting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const buildTimes = () => ({
    startTime: new Date(`${eventDate}T${startTime}:00`).toISOString(),
    endTime: new Date(`${eventDate}T${endTime}:00`).toISOString(),
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-foreground/50 p-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim() || categoryId == null) return;
          setSubmitting(true);
          try {
            await onSaved({
              title: title.trim(),
              categoryId,
              ...buildTimes(),
              isRecurring,
              ...(isRecurring ? { recurringPattern } : {}),
              ...(isRecurring && recurringPattern === "weekday_range" ? { recurringWeekdayStart, recurringWeekdayEnd } : {}),
              reminderMinutesBefore,
              guests,
            });
          } finally {
            setSubmitting(false);
          }
        }}
        className="w-full max-w-md rounded-3xl bg-card p-6 shadow-[var(--shadow-soft)] sm:p-8"
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-serif text-xl">Editar evento</h2>
          <button type="button" onClick={onClose} className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            ✕ Cerrar
          </button>
        </div>

        {event.isRecurringInstance && (
          <p className="mb-4 rounded-xl bg-secondary/40 p-3 text-xs text-muted-foreground">
            Este evento pertenece a una serie recurrente. "Guardar cambios" afecta a toda la serie — usa los botones de abajo para
            {event.isException ? " restaurar" : " mover o cancelar"} solo esta ocurrencia.
          </p>
        )}

        <div className="grid gap-4">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="¿Qué necesitas hacer?" className="field-input" />
          <div className="grid grid-cols-3 gap-3">
            <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} className="field-input" />
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="field-input" />
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="field-input" />
          </div>
          <EventCategoryField
            categoryId={categoryId}
            onChange={setCategoryId}
            categories={categories}
            onCategoriesChanged={onCategoriesChanged}
          />

          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={isRecurring} onChange={(e) => setIsRecurring(e.target.checked)} />
            Evento recurrente
          </label>
          {isRecurring && (
            <select
              value={recurringPattern}
              onChange={(e) => setRecurringPattern(e.target.value as RecurringPattern)}
              className="field-input"
            >
              {RECURRENCES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          )}
          {isRecurring && recurringPattern === "weekday_range" && (
            <WeekdayRangeFields
              start={recurringWeekdayStart}
              end={recurringWeekdayEnd}
              onStartChange={setRecurringWeekdayStart}
              onEndChange={setRecurringWeekdayEnd}
            />
          )}

          <ReminderCheckboxes value={reminderMinutesBefore} onChange={setReminderMinutesBefore} />
          <GuestsEditor value={guests} onChange={setGuests} />
        </div>

        {event.isRecurringInstance && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
            {event.isException ? (
              <button type="button" onClick={onRestoreOccurrence} className="cursor-pointer rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted">
                Restaurar horario original
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onSetException({ originalStartTime: event.originalStartTime, action: "moved", ...buildTimes() })}
                  className="cursor-pointer rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
                >
                  Mover solo esta vez
                </button>
                <button
                  type="button"
                  onClick={() => onSetException({ originalStartTime: event.originalStartTime, action: "cancelled" })}
                  className="cursor-pointer rounded-full border border-border px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                >
                  Cancelar solo esta vez
                </button>
              </>
            )}
          </div>
        )}

        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              if (!confirmingDelete) {
                setConfirmingDelete(true);
                return;
              }
              onDeleted();
            }}
            onBlur={() => setConfirmingDelete(false)}
            className={`cursor-pointer whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              confirmingDelete
                ? "bg-destructive text-destructive-foreground"
                : "text-destructive hover:bg-destructive/10"
            }`}
          >
            {confirmingDelete ? "¿Confirmar eliminar?" : "Eliminar"}
          </button>
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? "Guardando..." : "Guardar cambios"}
          </button>
        </div>
      </form>
    </div>
  );
}

function GoalsProgressCard({ goals }: { goals: Goal[] }) {
  const percentOf = (goal: Goal) => (goal.targetValue > 0 ? Math.min(100, Math.round((goal.currentValue / goal.targetValue) * 100)) : 0);
  const overall = goals.length > 0 ? Math.round(goals.reduce((sum, g) => sum + percentOf(g), 0) / goals.length) : 0;

  return (
    <div className="rounded-3xl bg-primary p-8 text-primary-foreground">
      <h2 className="mb-6 text-xs uppercase tracking-widest opacity-60">Progreso de objetivos</h2>

      {goals.length === 0 ? (
        <p className="text-sm opacity-80">No tienes objetivos activos.</p>
      ) : (
        <div className="flex items-center gap-4">
          <GoalsDonutChart goals={goals} overallPercent={overall} />

          {/* Qué color del donut es cada objetivo: punto + nombre, al lado del donut. */}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {goals.map((goal, i) => (
              <span key={goal.id} className="flex min-w-0 items-center gap-1.5 text-xs">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: GOALS_DONUT_PALETTE[i % GOALS_DONUT_PALETTE.length] }}
                  aria-hidden
                />
                <span className="truncate opacity-80">{goal.title}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NewEventForm({
  date,
  categories,
  onCategoriesChanged,
  onSubmit,
}: {
  date: string;
  categories: EventCategory[];
  onCategoriesChanged: () => void;
  onSubmit: (input: EventInputFields) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [eventDate, setEventDate] = useState(date);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  // La primera categoría (por `order`) precarga el <select> en cuanto llega — antes de eso
  // (fetch inicial todavía en vuelo) queda en null y el formulario no deja enviar (ver el guard
  // en el onSubmit de abajo).
  useEffect(() => {
    if (categoryId === null && categories.length > 0) setCategoryId(categories[0].id);
  }, [categories, categoryId]);
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringPattern, setRecurringPattern] = useState<RecurringPattern>("weekly");
  const [recurringWeekdayStart, setRecurringWeekdayStart] = useState(1);
  const [recurringWeekdayEnd, setRecurringWeekdayEnd] = useState(5);
  const [reminderMinutesBefore, setReminderMinutesBefore] = useState<number[]>([30]);
  const [guests, setGuests] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim() || categoryId == null) return;
        setSubmitting(true);
        try {
          await onSubmit({
            title: title.trim(),
            categoryId,
            startTime: new Date(`${eventDate}T${startTime}:00`).toISOString(),
            endTime: new Date(`${eventDate}T${endTime}:00`).toISOString(),
            isRecurring,
            ...(isRecurring ? { recurringPattern } : {}),
            ...(isRecurring && recurringPattern === "weekday_range" ? { recurringWeekdayStart, recurringWeekdayEnd } : {}),
            reminderMinutesBefore,
            guests,
          });
          setTitle("");
        } finally {
          setSubmitting(false);
        }
      }}
      className="mb-10 card-soft"
    >
      {/* Dos columnas independientes en vez de una única grid de 5 columnas: antes el panel de
          categorías (ahora siempre visible, con todos sus chips) compartía fila con el título/
          fecha/horas, y al ser el más alto de los cinco estiraba la altura de ESA fila — pero el
          resto de campos (recurrencia, avisos, invitados), en filas de la grid POR DEBAJO, no
          tienen nada que ver con esa altura y aun así quedaban empujados hacia abajo, dejando un
          hueco enorme bajo el título/fecha/horas. Con `md:flex-row md:items-start`, la columna
          izquierda (todo excepto categorías) fluye pegada a su propio contenido y la de
          categorías, a la derecha, puede ser tan alta como haga falta sin arrastrar a la otra. */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <div className="grid flex-1 gap-4 md:grid-cols-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="¿Qué necesitas hacer?"
            className="field-input md:col-span-4"
          />
          <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} className="field-input" />
          <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="field-input" />
          <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="field-input" />

          <label className="flex items-center gap-2 text-sm text-muted-foreground md:col-span-4">
            <input type="checkbox" checked={isRecurring} onChange={(e) => setIsRecurring(e.target.checked)} />
            Evento recurrente
          </label>
          {isRecurring && (
            <select
              value={recurringPattern}
              onChange={(e) => setRecurringPattern(e.target.value as RecurringPattern)}
              className="field-input md:col-span-2"
            >
              {RECURRENCES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          )}
          {isRecurring && recurringPattern === "weekday_range" && (
            <WeekdayRangeFields
              start={recurringWeekdayStart}
              end={recurringWeekdayEnd}
              onStartChange={setRecurringWeekdayStart}
              onEndChange={setRecurringWeekdayEnd}
              className="md:col-span-2"
            />
          )}

          <div className="md:col-span-4">
            <ReminderCheckboxes value={reminderMinutesBefore} onChange={setReminderMinutesBefore} />
          </div>
          <div className="md:col-span-4">
            <GuestsEditor value={guests} onChange={setGuests} />
          </div>

          <button type="submit" disabled={submitting} className="btn-primary md:col-span-4 md:justify-self-start">
            {submitting ? "Guardando..." : "Añadir evento"}
          </button>
        </div>

        <div className="md:w-64 md:shrink-0">
          <EventCategoryField categoryId={categoryId} onChange={setCategoryId} categories={categories} onCategoriesChanged={onCategoriesChanged} />
        </div>
      </div>
    </form>
  );
}
