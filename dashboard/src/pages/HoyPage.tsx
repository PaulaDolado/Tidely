import { useEffect } from "react";
import { PageHeader, SearchFocus, Tab } from "../components/AppShell";
import { api } from "../api/client";
import { useFetch } from "../hooks/useFetch";
import { Loading, ErrorMessage } from "../components/Feedback";
import { QuickNotesCard } from "../components/QuickNotesCard";
import { QuickAccessCard } from "../components/QuickAccessCard";
import { RecentEntriesCard } from "../components/RecentEntriesCard";
import { Habit, Task, TodayResponse } from "../types";

const TYPE_LABELS: Record<string, string> = {
  work: "Trabajo",
  study: "Estudio",
  gym: "Gimnasio",
  meeting: "Reunión",
  evento: "Evento",
  cita: "Cita",
  free: "Libre",
};
const TYPE_STYLES: Record<string, string> = {
  work: "bg-primary/15 text-primary",
  study: "bg-secondary/70 text-foreground",
  gym: "bg-hobby/15 text-hobby",
  meeting: "bg-warning/15 text-warning",
  evento: "bg-positive/15 text-positive",
  cita: "bg-habit/15 text-habit",
  free: "bg-muted text-muted-foreground",
};

/**
 * Vista "Hoy": un único vistazo a lo que toca hoy, en vez de entrar a Agenda + Planificador +
 * hábitos por separado — pensada como pantalla de aterrizaje (ver DashboardPage, es la pestaña
 * inicial). Todo sale de un único `GET /today` (ver todayService en el backend).
 */
export function HoyPage({ onNavigate }: { onNavigate: (tab: Tab, focus?: SearchFocus) => void }) {
  const { data, loading, error, reload } = useFetch(() => api.get<TodayResponse>("/today"), []);

  // "Hoy" es la pantalla de aterrizaje — se queda abierta más tiempo que el resto (no hay razón
  // para cambiar de pestaña si no hace falta), así que es la que más se nota vieja si algo cambia
  // por otro lado: completar una tarea desde el Planificador, marcar un hábito desde el móvil,
  // etc. La API es REST normal (sin WebSockets ni Server-Sent Events, ver src/app.ts), así que
  // nada de eso llega solo hasta aquí — hay que ir a buscarlo. En vez de recargar toda la página,
  // se refresca solo en los momentos en los que tiene sentido:
  //  - Al recuperar el foco la pestaña/ventana (volver de otra app o pestaña del navegador).
  //  - Al volver a quedar visible (mismo caso, cubierto también por si el navegador no dispara
  //    "focus" — varía según navegador/SO, ver el mismo criterio en utils/quickAccessApps.ts).
  //  - Cada 60s mientras la pestaña sigue visible, como red de seguridad para el caso que NINGUNO
  //    de los eventos anteriores cubre: la pestaña de "Hoy" sigue enfocada en el ordenador y el
  //    cambio se hizo desde el móvil sin tocar esta ventana para nada.
  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") reload();
    };
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    const intervalId = window.setInterval(refreshIfVisible, 60_000);
    return () => {
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
      window.clearInterval(intervalId);
    };
  }, [reload]);

  const dateLabel = data ? new Date(`${data.date}T00:00:00.000Z`).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }) : "";

  const toggleTaskDone = async (task: Task) => {
    await api.put(`/planner/tasks/${task.id}`, { status: task.status === "done" ? "todo" : "done" });
    reload();
  };

  const toggleHabitToday = async (habit: Habit) => {
    await api.post(`/habits/${habit.id}/toggle`, {});
    reload();
  };

  return (
    <>
      <PageHeader
        title="Hoy"
        subtitle={dateLabel ? dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1) : ""}
        action={
          (data?.combinedStreak ?? 0) > 0 ? (
            <span className="flex items-center gap-1.5 rounded-full bg-habit/15 px-4 py-2 text-sm font-medium text-habit">
              🔥 Racha combinada: {data?.combinedStreak} día{data?.combinedStreak === 1 ? "" : "s"}
            </span>
          ) : undefined
        }
      />

      {error && <ErrorMessage message={error} />}

      {loading && !data ? (
        <Loading label="Cargando tu día..." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="flex flex-col gap-6">
            <section className="rounded-3xl border border-border bg-card p-6">
              <h2 className="mb-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">📅 Eventos de hoy</h2>
              {data?.events.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin eventos hoy — día libre.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {data?.events.map((event) => (
                    <li key={`${event.id}-${event.startTime}`}>
                      <button
                        onClick={() => onNavigate("agenda", { type: "event", id: event.id, startTime: event.startTime })}
                        className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-border px-4 py-2.5 text-left transition-colors hover:border-primary/30"
                      >
                        <span className="w-16 shrink-0 text-xs text-muted-foreground">
                          {new Date(event.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm">{event.title}</span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${TYPE_STYLES[event.type] ?? "bg-muted text-muted-foreground"}`}>
                          {TYPE_LABELS[event.type] ?? event.type}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-3xl border border-border bg-card p-6">
              <h2 className="mb-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">✅ Tareas con vencimiento hoy</h2>
              {data?.tasksDueToday.length === 0 ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">Ninguna tarea vence hoy.</p>
                  <button
                    onClick={() => onNavigate("planificador")}
                    className="shrink-0 cursor-pointer whitespace-nowrap text-sm font-medium text-primary hover:underline"
                  >
                    Ir al Planificador →
                  </button>
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {data?.tasksDueToday.map((task) => (
                    <li key={task.id} className="flex items-center gap-3 rounded-xl border border-border px-4 py-2.5">
                      <button
                        onClick={() => toggleTaskDone(task)}
                        aria-label={task.status === "done" ? "Marcar como pendiente" : "Marcar como hecha"}
                        className={`flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full border text-[10px] transition-colors ${
                          task.status === "done" ? "border-positive bg-positive/20 text-positive" : "border-foreground/30 hover:border-primary/50"
                        }`}
                      >
                        {task.status === "done" ? "✓" : ""}
                      </button>
                      <button
                        onClick={() => onNavigate("planificador", { type: "task", id: task.id })}
                        className={`min-w-0 flex-1 cursor-pointer truncate text-left text-sm hover:underline ${
                          task.status === "done" ? "text-muted-foreground line-through" : ""
                        }`}
                      >
                        {task.title}
                      </button>
                      {task.subtasks.length > 0 && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {task.subtasks.filter((s) => s.completed).length}/{task.subtasks.length}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <RecentEntriesCard
              entries={data?.recentProjectEntries ?? []}
              onOpenProject={(projectId) => onNavigate("proyectos", { type: "project", id: projectId })}
            />
          </div>

          <div className="flex flex-col gap-6">
            <section className="rounded-3xl border border-habit/30 bg-habit/10 p-6">
              <h2 className="mb-4 text-xs font-bold uppercase tracking-widest text-habit">🔁 Hábitos</h2>
              {data?.habits.length === 0 ? (
                <p className="text-sm text-muted-foreground">Todavía no tienes hábitos activos.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {data?.habits.map((habit) => {
                    const doneToday = habit.completedDates.includes(data.date);
                    return (
                      <li key={habit.id} className="flex items-center justify-between gap-2">
                        <span className={`truncate text-sm ${doneToday ? "text-muted-foreground line-through" : ""}`}>{habit.title}</span>
                        <button
                          onClick={() => toggleHabitToday(habit)}
                          className={`shrink-0 cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                            doneToday ? "bg-habit text-background" : "border border-habit/40 text-habit hover:bg-habit/20"
                          }`}
                        >
                          {doneToday ? "✓ Hecho" : "Marcar"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <QuickNotesCard notes={data?.notes ?? []} onChanged={reload} />

            <QuickAccessCard />
          </div>
        </div>
      )}
    </>
  );
}
