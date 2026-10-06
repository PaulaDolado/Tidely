import { useAuth } from "../context/AuthContext";
import { ENABLED_SECTIONS, RecentProjectEntry } from "../types";

// "hace 5 min" / "hace 3h" / "ayer" / "27 ago" — a partir de 2 días ya se enseña la fecha.
function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "ahora mismo";
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `hace ${diffHours}h`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays === 1) return "ayer";
  return new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

function RecentEntryRow({ entry, onOpen }: { entry: RecentProjectEntry; onOpen: () => void }) {
  return (
    <li>
      <button
        onClick={onOpen}
        className="flex w-full cursor-pointer flex-col gap-1 rounded-xl border border-border px-4 py-2.5 text-left transition-colors hover:border-primary/30"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <span className="truncate">{entry.pageTitle}</span>
            <span className="shrink-0 text-xs font-normal text-muted-foreground">· {entry.projectTitle}</span>
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">{formatRelative(entry.updatedAt)}</span>
        </div>
        {entry.preview && <p className="truncate text-xs text-muted-foreground">{entry.preview}</p>}
      </button>
    </li>
  );
}

/**
 * Últimas páginas de libreta tocadas (ver projectsService.listRecentEntries) — aparece en la
 * vista Hoy y en la Agenda (debajo de Hábitos diarios), compartido para no duplicar el marcado
 * ni el formateo de fecha relativa.
 *
 * `entries` = undefined significa "todavía cargando" (o la petición falló): no se pinta nada, para
 * no enseñar un "no tienes libretas" falso mientras llegan los datos. Un array vacío, en cambio,
 * es un vacío de verdad (ninguna página en ninguna libreta) y se explica con un mensaje en vez de
 * hacer desaparecer la tarjeta sin más. Si el usuario ha desactivado el apartado Libreta
 * ("proyectos", ver Ajustes), la tarjeta no tiene sentido y tampoco se pinta.
 */
export function RecentEntriesCard({
  entries,
  onOpenProject,
}: {
  entries: RecentProjectEntry[] | undefined;
  onOpenProject: (projectId: number) => void;
}) {
  const { user } = useAuth();
  const libretaEnabled = (user?.enabledSections ?? ENABLED_SECTIONS).includes("proyectos");
  if (entries === undefined || !libretaEnabled) return null;

  return (
    <section className="rounded-3xl border border-border bg-card p-6">
      <h2 className="mb-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">📓 Entradas recientes en tus libretas</h2>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no has escrito en ninguna libreta.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <RecentEntryRow key={entry.id} entry={entry} onOpen={() => onOpenProject(entry.projectId)} />
          ))}
        </ul>
      )}
    </section>
  );
}
