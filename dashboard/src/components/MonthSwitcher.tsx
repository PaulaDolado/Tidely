export interface Period {
  month: number; // 1-12
  year: number;
}

export function currentPeriod(): Period {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

export function isCurrentPeriod(p: Period): boolean {
  const now = currentPeriod();
  return p.month === now.month && p.year === now.year;
}

/** "octubre de 2026" → "Octubre de 2026" */
export function periodLabel(p: Period): string {
  const label = new Date(p.year, p.month - 1, 1).toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function shift(p: Period, delta: number): Period {
  const d = new Date(p.year, p.month - 1 + delta, 1);
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}

/**
 * Selector ‹ mes › de Finanzas: elige el mes que enseñan "Resumen del presupuesto", "Resumen del mes"
 * y el top de categorías. No deja pasar del mes en curso (no hay datos futuros que ver) y, fuera de
 * él, ofrece volver a "Este mes" de un clic.
 */
export function MonthSwitcher({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const atCurrent = isCurrentPeriod(value);
  const arrow =
    "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border text-base leading-none text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:cursor-default disabled:opacity-30 disabled:hover:border-border disabled:hover:text-muted-foreground";

  return (
    <div className="flex items-center justify-between gap-3" role="group" aria-label="Mes que se muestra">
      <button type="button" className={arrow} onClick={() => onChange(shift(value, -1))} aria-label="Mes anterior">
        ‹
      </button>
      <div className="flex min-w-0 flex-col items-center">
        <span className="truncate text-sm font-medium" aria-live="polite">
          {periodLabel(value)}
        </span>
        {!atCurrent && (
          <button type="button" onClick={() => onChange(currentPeriod())} className="cursor-pointer text-[11px] text-primary hover:underline">
            Volver a este mes
          </button>
        )}
      </div>
      <button type="button" className={arrow} onClick={() => onChange(shift(value, 1))} disabled={atCurrent} aria-label="Mes siguiente">
        ›
      </button>
    </div>
  );
}
