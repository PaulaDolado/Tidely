import { useState } from "react";
import { PageHeader } from "../components/AppShell";
import { api } from "../api/client";
import { useFetch } from "../hooks/useFetch";
import { Loading, ErrorMessage, EmptyState } from "../components/Feedback";
import { SavingsGoalCard, NewSavingsGoalForm, SAVINGS_GOAL_TYPES, SAVINGS_GOAL_TYPE_LABELS } from "../components/SavingsGoals";
import { AvailableSurplus, SavingsGoal } from "../types";

// Mismo formateador que FinanzasPage.tsx (`eur`) — nombre distinto porque no hay un util
// compartido entre páginas de Finanzas todavía (cada una define el suyo, ver CustomPagePage.tsx).
function eur(n: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
}

type FilterTab = "all" | SavingsGoal["type"];
const TABS: { value: FilterTab; label: string }[] = [
  { value: "all", label: "Todas" },
  ...SAVINGS_GOAL_TYPES.map((t) => ({ value: t, label: SAVINGS_GOAL_TYPE_LABELS[t] })),
];

// Diferencia en días de calendario entre dos fechas — igual criterio que en MetasPage
// (computeGoalRisk del backend), para que "al ritmo" signifique lo mismo en toda la app.
function calendarDaysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86_400_000);
}

// Verde si va al ritmo necesario para llegar al objetivo antes de la fecha límite (o si no
// tiene fecha límite: sin plazo no hay ritmo que evaluar). Amarillo si va por detrás.
function paceStatus(goal: SavingsGoal): "green" | "yellow" {
  if (goal.progressPercent >= 100 || !goal.deadline) return "green";
  const start = new Date(goal.createdAt);
  const end = new Date(goal.deadline);
  const now = new Date();
  const daysTotal = Math.max(1, calendarDaysBetween(start, end));
  const daysElapsed = Math.min(daysTotal, Math.max(0, calendarDaysBetween(start, now)));
  if (daysElapsed <= 0) return "green";
  const expectedPercent = (daysElapsed / daysTotal) * 100;
  return goal.progressPercent >= expectedPercent * 0.8 ? "green" : "yellow";
}

export function MetasAhorroPage() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<FilterTab>("all");
  const { data, loading, error, reload } = useFetch(
    () => api.get<{ savingsGoals: SavingsGoal[] }>(`/finance/savings-goals${tab === "all" ? "" : `?type=${tab}`}`),
    [tab]
  );

  // Panel de progreso: siempre sobre todas las metas, independientemente de la pestaña
  // seleccionada abajo — igual que el de Objetivos, para que no desaparezca al filtrar.
  const { data: allData, reload: reloadAll } = useFetch(
    () => api.get<{ savingsGoals: SavingsGoal[] }>("/finance/savings-goals"),
    []
  );

  // "Si quedan ingresos de meses anteriores tras quitar los gastos de ese mismo mes" — ver
  // financeService.getAvailableSurplus. Se pide con el mes EN CURSO (queda fuera del cálculo, ver
  // el comentario del backend), así que solo cuenta lo que ya quedó cerrado en meses pasados.
  const { data: surplusData, reload: reloadSurplus } = useFetch(() => {
    const now = new Date();
    return api.get<AvailableSurplus>(`/finance/surplus/${now.getMonth() + 1}/${now.getFullYear()}`);
  }, []);

  const reloadBoth = () => {
    reload();
    reloadAll();
    reloadSurplus();
  };

  return (
    <>
      <PageHeader
        title="Metas de ahorro e inversión"
        subtitle="Cada casilla representa un tramo fijo de dinero — haz clic para asignarlo"
        action={
          <button onClick={() => setOpen((v) => !v)} className="btn-dark">
            {open ? "Cerrar" : "+ Nueva meta"}
          </button>
        }
      />

      {surplusData && surplusData.availableSurplus > 0 && <AvailableSurplusCard surplus={surplusData} />}

      <SavingsProgressOverviewPanel goals={allData?.savingsGoals ?? []} />

      {open && (
        <NewSavingsGoalForm
          defaultType={tab === "all" ? "ahorro" : tab}
          onSubmit={async (input) => {
            await api.post("/finance/savings-goals", input);
            setOpen(false);
            reloadBoth();
          }}
        />
      )}

      <div className="mb-8 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`cursor-pointer rounded-full px-4 py-2 text-sm transition-colors ${
              tab === t.value ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <ErrorMessage message={error} />}
      {loading && !data ? (
        // Solo en la carga inicial: en un `reload()` (p.ej. tras pisar una casilla), mantener la
        // rejilla montada evita perder el estado local de cada tarjeta — el modal de "ver todas
        // las casillas" se cerraba solo en cada clic porque este `<Loading>` desmontaba la tarjeta.
        <Loading label="Cargando metas de ahorro..." />
      ) : (data?.savingsGoals.length ?? 0) === 0 ? (
        <EmptyState message="Todavía no tienes metas en esta categoría. Crea la primera arriba." />
      ) : (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {data?.savingsGoals.map((goal) => (
            <SavingsGoalCard key={goal.id} goal={goal} onChanged={reloadBoth} />
          ))}
        </div>
      )}
    </>
  );
}

// Solo se renderiza si availableSurplus > 0 (ver el `&&` en MetasAhorroPage) — si no queda nada
// libre de meses anteriores, no tiene sentido ocupar espacio con un "0 €" que no aporta nada.
function AvailableSurplusCard({ surplus }: { surplus: AvailableSurplus }) {
  return (
    <section className="mb-8 rounded-3xl border border-primary/30 bg-primary/5 p-6 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Sobrante disponible</h2>
          <p className="mt-1 font-serif text-3xl text-primary">{eur(surplus.availableSurplus)}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Ingresos de meses anteriores que quedaron libres tras sus propios gastos y que todavía no has asignado a
            ninguna meta — asígnalos abajo tocando las casillas de la meta que quieras reforzar.
          </p>
        </div>
        {surplus.committedToGoals > 0 && (
          <p className="shrink-0 text-xs text-muted-foreground">
            (de un total acumulado de {eur(surplus.totalBalance)}; {eur(surplus.committedToGoals)} ya están en tus
            metas)
          </p>
        )}
      </div>
    </section>
  );
}

function SavingsProgressOverviewPanel({ goals }: { goals: SavingsGoal[] }) {
  return (
    <section className="mb-8 rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-soft)]">
      <h2 className="mb-4 text-xs font-medium uppercase tracking-widest text-muted-foreground">
        Progreso de tus metas de ahorro e inversión
      </h2>

      {goals.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no tienes metas de ahorro ni de inversión.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {goals.map((goal) => {
            const percent = goal.progressPercent;
            const status = paceStatus(goal);
            const barColor = status === "green" ? "bg-positive" : "bg-warning";
            const textColor = status === "green" ? "text-positive" : "text-warning";

            return (
              <div key={goal.id} className="rounded-2xl border border-border bg-background p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">
                    {SAVINGS_GOAL_TYPE_LABELS[goal.type]} · {goal.name}
                  </span>
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
