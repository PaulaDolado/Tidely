import { useState } from "react";
import { api } from "../api/client";
import { Habit } from "../types";

const STRIP_DAYS = 7; // un punto por cada día de la semana, lunes a domingo
const DAY_LETTERS = ["L", "M", "X", "J", "V", "S", "D"];

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

// Fechas (lunes a domingo) de la semana en curso — a propósito NO es una ventana deslizante de
// "últimos 7 días" (donde hoy siempre cae en la última posición): así cada punto tiene una
// posición FIJA según el día de la semana (lunes = 1er punto ... domingo = 7º), y marcar un
// hábito desde "Hoy" siempre rellena el punto que le toca a ese día (ver toggleHabitToday en
// HoyPage, que marca la fecha de hoy — aquí solo cambia dónde se pinta esa marca).
// Al empezar una semana nueva, estas fechas cambian solas y los 7 puntos vuelven a aparecer sin
// marcar (no hay registros para las fechas nuevas todavía) — sin tocar la racha, que se calcula
// aparte a partir de TODO el historial de HabitLog (ver streak en habitsService.listHabits), así
// que no se pierde por este reinicio visual de la semana.
function currentWeekDates(): string[] {
  const today = new Date();
  const isoWeekday = (today.getDay() + 6) % 7; // 0 = lunes ... 6 = domingo (getDay() da 0 = domingo)
  const monday = new Date(today);
  monday.setDate(today.getDate() - isoWeekday);
  return Array.from({ length: STRIP_DAYS }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

/**
 * Seguimiento de hábitos diarios, junto a "Progreso de objetivos" en la Agenda: a diferencia de
 * un objetivo (un número hacia una meta con fecha de fin), un hábito no se "completa" — se marca
 * o no cada día, y lo que importa es la racha. Cada hábito muestra los 7 días de la semana en
 * curso (lunes a domingo), clicable para marcar/desmarcar cualquiera de esos días (no solo hoy).
 */
export function HabitsTrackerCard({ habits, onChanged }: { habits: Habit[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const days = currentWeekDates();

  const toggleDay = async (habitId: number, date: string) => {
    await api.post(`/habits/${habitId}/toggle`, { date });
    onChanged();
  };

  const renameHabit = async (id: number, newTitle: string) => {
    await api.put(`/habits/${id}`, { title: newTitle });
    onChanged();
  };

  const removeHabit = async (id: number) => {
    await api.delete(`/habits/${id}`);
    onChanged();
  };

  return (
    <div className="rounded-3xl border border-habit/30 bg-habit/10 p-6">
      {/* Simplificado a propósito: sin texto de "vacío" — solo el título y un "+" arriba a la
          derecha que despliega el alta, igual esté vacío o ya tenga hábitos. */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-widest text-habit">Hábitos diarios</h2>
        <div className="flex items-center gap-2">
          {habits.length > 0 && (
            <button
              onClick={() => setShowProgress((v) => !v)}
              aria-label={showProgress ? "Ocultar progreso" : "Ver progreso"}
              aria-expanded={showProgress}
              title={showProgress ? "Ocultar progreso" : "Ver progreso"}
              className={`flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full border border-habit transition-colors ${
                showProgress ? "bg-habit text-background" : "text-habit hover:bg-habit/15"
              }`}
            >
              <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="2,12 6,7 9,10 14,3" />
                <circle cx="2" cy="12" r="0.8" fill="currentColor" />
                <circle cx="6" cy="7" r="0.8" fill="currentColor" />
                <circle cx="9" cy="10" r="0.8" fill="currentColor" />
                <circle cx="14" cy="3" r="0.8" fill="currentColor" />
              </svg>
            </button>
          )}
          <button
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Cerrar" : "Añadir hábito"}
            className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full bg-habit text-sm leading-none text-background transition-opacity hover:opacity-80"
          >
            {open ? "×" : "+"}
          </button>
        </div>
      </div>

      {open && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!title.trim()) return;
            setSubmitting(true);
            try {
              await api.post("/habits", { title: title.trim() });
              setTitle("");
              onChanged();
            } finally {
              setSubmitting(false);
            }
          }}
          className="mb-4"
        >
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Nombre del hábito"
            disabled={submitting}
            className="field-input w-full bg-background text-sm"
          />
        </form>
      )}

      {habits.length > 0 && (
        <ul className="flex overflow-x-auto">
          {habits.map((habit) => (
            <HabitColumn
              key={habit.id}
              habit={habit}
              days={days}
              onToggleDay={toggleDay}
              onRename={renameHabit}
              onDelete={removeHabit}
            />
          ))}
        </ul>
      )}

      {showProgress && habits.length > 0 && <HabitsProgressPanel habits={habits} weekDays={days} />}
    </div>
  );
}

// Medidas del gráfico en unidades del viewBox (el SVG se escala al ancho de la tarjeta).
const CHART_W = 640;
const CHART_H = 170;
const PAD_L = 34;
const PAD_R = 10;
const PAD_T = 12;
const PAD_B = 24;

// Aritmética de calendario en UTC, igual que `todayKey()` y que las fechas que guarda el servidor
// (`completedDates` son claves UTC): mezclar horas locales desplazaría un día el "hoy" y el recuento.
function utcMonthStart(offsetMonths: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetMonths, 1));
}

function monthDateKeys(monthStart: Date): string[] {
  const count = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) =>
    new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), i + 1)).toISOString().slice(0, 10)
  );
}

/**
 * Progreso de los hábitos: por cada día, el % de hábitos activos que se marcaron ese día (3 de 4
 * = 75%), con un punto por día unidos por una línea para ver los picos y los valles. Vista semanal
 * (la semana en curso, lunes a domingo, igual que la tira de arriba) o mensual (con el mes anterior
 * a un clic: el servidor solo devuelve ~2 meses de historial, ver HISTORY_DAYS en habitsService).
 * Los días que aún no han llegado no se pintan: no son un 0%, son "todavía no".
 */
function HabitsProgressPanel({ habits, weekDays }: { habits: Habit[]; weekDays: string[] }) {
  const [mode, setMode] = useState<"week" | "month">("week");
  const [monthOffset, setMonthOffset] = useState(0); // 0 = este mes, -1 = el anterior
  const today = todayKey();

  const monthStart = utcMonthStart(monthOffset);
  const dates = mode === "week" ? weekDays : monthDateKeys(monthStart);
  const labels = mode === "week" ? DAY_LETTERS : dates.map((d) => String(Number(d.slice(8, 10))));

  const completedByHabit = habits.map((h) => new Set(h.completedDates));
  const points = dates.map((date, i) => {
    const marked = completedByHabit.reduce((n, set) => (set.has(date) ? n + 1 : n), 0);
    return { date, label: labels[i], marked, percent: Math.round((marked / habits.length) * 100), future: date > today };
  });
  const elapsed = points.filter((p) => !p.future);

  const innerW = CHART_W - PAD_L - PAD_R;
  const innerH = CHART_H - PAD_T - PAD_B;
  const xOf = (i: number) => PAD_L + ((i + 0.5) * innerW) / points.length;
  const yOf = (percent: number) => PAD_T + innerH * (1 - percent / 100);
  const linePath = points
    .map((p, i) => (p.future ? null : `${i === 0 || points[i - 1].future ? "M" : "L"} ${xOf(i)} ${yOf(p.percent)}`))
    .filter(Boolean)
    .join(" ");

  const totalMarked = elapsed.reduce((n, p) => n + p.marked, 0);
  const average = elapsed.length > 0 ? Math.round(elapsed.reduce((n, p) => n + p.percent, 0) / elapsed.length) : null;
  const rawMonthLabel = monthStart.toLocaleDateString("es-ES", { month: "long", year: "numeric", timeZone: "UTC" });
  const monthLabel = rawMonthLabel.charAt(0).toUpperCase() + rawMonthLabel.slice(1);

  return (
    <div className="mt-5 border-t border-habit/25 pt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center overflow-hidden rounded-full border border-habit/40 text-xs">
          {(["week", "month"] as const).map((m, i) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`cursor-pointer px-3 py-1 font-medium transition-colors ${i > 0 ? "border-l border-habit/40" : ""} ${
                mode === m ? "bg-habit text-background" : "text-habit hover:bg-habit/10"
              }`}
            >
              {m === "week" ? "Semana" : "Mes"}
            </button>
          ))}
        </div>
        {mode === "month" && (
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => setMonthOffset(-1)}
              disabled={monthOffset === -1}
              aria-label="Mes anterior"
              className="cursor-pointer px-1 text-habit disabled:cursor-default disabled:opacity-30"
            >
              ‹
            </button>
            <span className="min-w-[8.5rem] text-center font-medium">{monthLabel}</span>
            <button
              onClick={() => setMonthOffset(0)}
              disabled={monthOffset === 0}
              aria-label="Mes siguiente"
              className="cursor-pointer px-1 text-habit disabled:cursor-default disabled:opacity-30"
            >
              ›
            </button>
          </div>
        )}
      </div>

      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full" role="img" aria-label="Porcentaje de hábitos marcados por día">
        {[0, 50, 100].map((tick) => (
          <g key={tick}>
            <line x1={PAD_L} x2={CHART_W - PAD_R} y1={yOf(tick)} y2={yOf(tick)} stroke="currentColor" className="text-habit/25" strokeDasharray="3 4" />
            <text x={PAD_L - 6} y={yOf(tick) + 3} textAnchor="end" className="fill-muted-foreground" fontSize="10">
              {tick}%
            </text>
          </g>
        ))}
        {linePath && <path d={linePath} fill="none" stroke="currentColor" className="text-habit" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
        {points.map((p, i) => (
          <g key={p.date}>
            {!p.future && (
              <circle
                cx={xOf(i)}
                cy={yOf(p.percent)}
                r={p.date === today ? 5 : 3.5}
                className={p.date === today ? "fill-habit" : "fill-card"}
                stroke="currentColor"
                strokeWidth={p.date === today ? 0 : 1.8}
                style={{ color: "var(--color-habit)" }}
              >
                <title>{`${p.date.split("-").reverse().join("/")}: ${p.marked} de ${habits.length} hábitos (${p.percent}%)`}</title>
              </circle>
            )}
            <text
              x={xOf(i)}
              y={CHART_H - 6}
              textAnchor="middle"
              fontSize={mode === "week" ? 11 : 9}
              className={p.date === today ? "fill-habit font-bold" : "fill-muted-foreground"}
            >
              {p.label}
            </text>
          </g>
        ))}
      </svg>

      {average === null ? (
        <p className="mt-2 text-xs text-muted-foreground">Todavía no hay días para calcular el progreso.</p>
      ) : (
        <div className="mt-3 flex items-center gap-4 rounded-2xl bg-habit/10 px-4 py-3">
          <span className="font-serif text-3xl leading-none text-habit">{average}%</span>
          <div className="min-w-0 text-xs">
            <p className="font-medium">Cumplimiento medio {mode === "week" ? "de la semana" : "del mes"}</p>
            <p className="text-muted-foreground">
              {totalMarked} {totalMarked === 1 ? "marca" : "marcas"} en {elapsed.length} {elapsed.length === 1 ? "día" : "días"} con {habits.length}{" "}
              {habits.length === 1 ? "hábito" : "hábitos"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function HabitColumn({
  habit,
  days,
  onToggleDay,
  onRename,
  onDelete,
}: {
  habit: Habit;
  days: string[];
  onToggleDay: (habitId: number, date: string) => void;
  onRename: (id: number, title: string) => void;
  onDelete: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(habit.title);
  const completed = new Set(habit.completedDates);

  const saveTitle = () => {
    setEditing(false);
    const trimmed = title.trim();
    if (!trimmed || trimmed === habit.title) {
      setTitle(habit.title);
      return;
    }
    onRename(habit.id, trimmed);
  };

  return (
    <li className="group min-w-[132px] flex-1 border-l border-habit/25 px-4 first:border-l-0 first:pl-0 last:pr-0">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
        {editing ? (
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setTitle(habit.title);
                setEditing(false);
              }
            }}
            className="w-full min-w-0 border-b border-habit bg-transparent outline-none"
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            title="Haz clic para renombrar"
            className="min-w-0 flex-1 cursor-text truncate text-left decoration-dotted hover:underline"
          >
            {habit.title}
          </button>
        )}
        <button
          onClick={() => onDelete(habit.id)}
          className="shrink-0 cursor-pointer text-xs text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
          aria-label="Eliminar hábito"
        >
          ✕
        </button>
      </div>
      <div className="flex gap-1">
        {days.map((date, i) => {
          const isCompleted = completed.has(date);
          const isToday = date === todayKey();
          return (
            <div key={date} className="flex flex-col items-center gap-1">
              <span className={`text-[9px] leading-none ${isToday ? "font-bold text-habit" : "text-muted-foreground"}`}>
                {DAY_LETTERS[i]}
              </span>
              <button
                onClick={() => onToggleDay(habit.id, date)}
                title={isToday ? "Hoy" : undefined}
                aria-label={`${DAY_LETTERS[i]}${isToday ? " (hoy)" : ""}${isCompleted ? " (marcado)" : ""}`}
                // El anillo de "hoy" va hacia DENTRO (ring-inset), no hacia fuera con offset: la
                // fila vive en un <ul overflow-x-auto> (ver más abajo) y, por la propia regla de
                // CSS de overflow, eso fuerza a que el overflow vertical también se recorte — un
                // anillo con offset hacia fuera se salía unos px del círculo y se cortaba (se
                // veía como un trocito de línea en vez de un anillo completo). Hacia dentro nunca
                // sale de la caja del propio botón, así no hay nada que recortar.
                className={`size-3.5 shrink-0 rounded-full transition-colors ${
                  isCompleted ? "bg-habit" : "bg-habit/15 hover:bg-habit/30"
                } ${isToday ? "ring-2 ring-inset ring-habit" : ""}`}
              />
            </div>
          );
        })}
      </div>
    </li>
  );
}
