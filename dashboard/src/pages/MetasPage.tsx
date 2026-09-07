import { FormEvent, useState } from "react";
import { PageHeader } from "../components/AppShell";
import { api } from "../api/client";
import { useFetch } from "../hooks/useFetch";
import { Loading, ErrorMessage, EmptyState } from "../components/Feedback";
import { Goal, GoalStatus, Pagination } from "../types";

const STATUS_TABS: { value: GoalStatus; label: string }[] = [
  { value: "active", label: "Activos" },
  { value: "completed", label: "Completados" },
  { value: "expired", label: "Vencidos" },
  { value: "all", label: "Todos" },
];

// Mismas 3 opciones que el backend acepta (ver goalsValidators.PERIODS) — "annual" se apoya en
// `defaultPeriodEnd` calculando fin de año (goalsService.ts), igual que "weekly"/"monthly" ya
// calculaban fin de semana/mes.
const GOAL_PERIOD_LABELS: Record<Goal["period"], string> = {
  weekly: "Semanal",
  monthly: "Mensual",
  annual: "Anual",
};

function percentOf(goal: Goal): number {
  return goal.targetValue > 0 ? Math.min(100, Math.round((goal.currentValue / goal.targetValue) * 100)) : 0;
}

// Diferencia en días de calendario (no horas transcurridas) entre dos fechas — igual que
// `differenceInCalendarDays` de date-fns, que es lo que usa el backend en computeGoalRisk.
// Importa porque si se calculara en milisegundos, una meta creada hace 5 minutos ya tendría
// "días transcurridos" > 0 y aparecería en amarillo aunque el usuario no haya tenido ni
// tiempo de registrar progreso todavía.
function calendarDaysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86_400_000);
}

// Verde si la meta va al ritmo necesario para completarse a tiempo, amarillo si va por detrás.
// Mismo margen (80% del ritmo esperado) que usa el backend para las alertas de "meta en riesgo"
// (ver computeGoalRisk en src/services/goalsService.ts), para que el color coincida con esas
// notificaciones en vez de ser un umbral de porcentaje inventado aparte.
function paceStatus(goal: Goal): "green" | "yellow" {
  if (goal.completed) return "green";
  const start = new Date(goal.periodStart);
  const end = new Date(goal.periodEnd);
  const now = new Date();
  const daysTotal = Math.max(1, calendarDaysBetween(start, end));
  const daysElapsed = Math.min(daysTotal, Math.max(0, calendarDaysBetween(start, now)));
  if (daysElapsed <= 0) return "green"; // mismo día de creación, aún no hay ritmo que evaluar
  const expectedPercent = (daysElapsed / daysTotal) * 100;
  const actualPercent = percentOf(goal);
  return actualPercent >= expectedPercent * 0.8 ? "green" : "yellow";
}

export function MetasPage() {
  const [status, setStatus] = useState<GoalStatus>("active");
  const [open, setOpen] = useState(false);

  const { data, loading, error, reload } = useFetch(
    () => api.get<{ goals: Goal[]; pagination: Pagination }>(`/goals?status=${status}`),
    [status]
  );

  // Panel de progreso: siempre sobre las metas activas, independientemente de la pestaña
  // seleccionada abajo — así el resumen de arriba no desaparece si el usuario mira "Vencidas".
  const { data: activeData, reload: reloadActive } = useFetch(
    () => api.get<{ goals: Goal[] }>("/goals?status=active"),
    []
  );

  const reloadAll = () => {
    reload();
    reloadActive();
  };

  return (
    <>
      <PageHeader
        title="Objetivos"
        subtitle="Objetivos semanales y mensuales, con racha y bonificación"
        action={
          <button onClick={() => setOpen((v) => !v)} className="btn-dark">
            {open ? "Cerrar" : "+ Nuevo objetivo"}
          </button>
        }
      />

      <ProgressOverviewPanel goals={activeData?.goals ?? []} />

      {open && (
        <NewGoalForm
          onSubmit={async (input) => {
            await api.post("/goals", input);
            setOpen(false);
            reloadAll();
          }}
        />
      )}

      <div className="mb-8 flex gap-2 overflow-x-auto">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatus(tab.value)}
            className={`whitespace-nowrap rounded-full px-4 py-2 text-sm transition-colors ${
              status === tab.value ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && <ErrorMessage message={error} />}
      {loading ? (
        <Loading label="Cargando objetivos..." />
      ) : (data?.goals.length ?? 0) === 0 ? (
        <EmptyState message="No hay objetivos en esta categoría." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {data?.goals.map((goal) => <GoalCard key={goal.id} goal={goal} onChanged={reloadAll} />)}
        </div>
      )}
    </>
  );
}

function ProgressOverviewPanel({ goals }: { goals: Goal[] }) {
  return (
    <section className="mb-8 rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-soft)]">
      <h2 className="mb-4 text-xs font-medium uppercase tracking-widest text-muted-foreground">
        Progreso de tus objetivos activos
      </h2>

      {goals.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tienes objetivos activos ahora mismo.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {goals.map((goal) => {
            const percent = percentOf(goal);
            const status = paceStatus(goal);
            const barColor = status === "green" ? "bg-positive" : "bg-warning";
            const textColor = status === "green" ? "text-positive" : "text-warning";

            return (
              <div key={goal.id} className="rounded-2xl border border-border bg-background p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{goal.title}</span>
                  <span className={`shrink-0 font-serif text-lg ${textColor}`}>{percent}%</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                  <div className={`h-full transition-all ${barColor}`} style={{ width: `${percent}%` }} />
                </div>
                <p className={`mt-1.5 text-[11px] font-medium ${textColor}`}>
                  {status === "green" ? "Al ritmo previsto" : "Por detrás del ritmo"}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function GoalCard({ goal, onChanged }: { goal: Goal; onChanged: () => void }) {
  const [value, setValue] = useState("1");
  const percent = goal.targetValue > 0 ? Math.min(100, Math.round((goal.currentValue / goal.targetValue) * 100)) : 0;

  const registerProgress = async (e: FormEvent) => {
    e.preventDefault();
    const n = Number(value);
    if (!n) return;
    await api.post(`/goals/${goal.id}/progress`, { value: n });
    onChanged();
  };

  const remove = async () => {
    await api.delete(`/goals/${goal.id}`);
    onChanged();
  };

  return (
    <article className="card-soft flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <h2 className="font-serif text-2xl">{goal.title}</h2>
        <div className="flex flex-col items-end gap-1">
          {goal.completed && <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">✓ Completado</span>}
          {goal.expired && !goal.completed && (
            <span className="rounded-full bg-destructive/10 px-3 py-1 text-xs font-bold text-destructive">Vencido</span>
          )}
        </div>
      </div>
      {goal.description && <p className="text-sm text-muted-foreground">{goal.description}</p>}
      <p className="text-sm text-muted-foreground">
        {GOAL_PERIOD_LABELS[goal.period]} · {goal.currentValue}/{goal.targetValue} · 🏆 {goal.bonusPoints} pts
        {goal.autoRenew && " · se renueva sola"}
      </p>

      <div className="h-3 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
      </div>

      {!goal.completed && !goal.expired && (
        <form onSubmit={registerProgress} className="flex items-center gap-2">
          <input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="field-input w-24"
          />
          <button type="submit" className="btn-primary px-4 py-2 text-xs">
            Registrar progreso
          </button>
        </form>
      )}

      <button onClick={remove} className="cursor-pointer self-end text-xs text-muted-foreground hover:text-destructive">
        Eliminar
      </button>
    </article>
  );
}

interface NewGoalInput {
  title: string;
  period: Goal["period"];
  targetValue: number;
  autoRenew: boolean;
}

function NewGoalForm({ onSubmit }: { onSubmit: (input: NewGoalInput) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [period, setPeriod] = useState<Goal["period"]>("weekly");
  const [targetValue, setTargetValue] = useState("5");
  const [autoRenew, setAutoRenew] = useState(true);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim()) return;
        await onSubmit({ title: title.trim(), period, targetValue: Number(targetValue) || 1, autoRenew });
        setTitle("");
      }}
      className="mb-10 grid gap-4 card-soft md:grid-cols-[2fr_1fr_1fr_auto]"
    >
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej. Ejercicio 5 días" className="field-input" />
      <select value={period} onChange={(e) => setPeriod(e.target.value as Goal["period"])} className="field-input">
        {(Object.keys(GOAL_PERIOD_LABELS) as Goal["period"][]).map((p) => (
          <option key={p} value={p}>
            {GOAL_PERIOD_LABELS[p]}
          </option>
        ))}
      </select>
      <input type="number" min="1" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} className="field-input" />
      <label className="flex items-center gap-2 whitespace-nowrap text-sm text-muted-foreground">
        <input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} />
        Renovar sola
      </label>
      <button type="submit" className="btn-primary md:col-span-4 md:justify-self-start">
        Crear objetivo
      </button>
    </form>
  );
}
