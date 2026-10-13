import { useEffect, useRef, useState } from "react";

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

/** Solo el nombre del mes, en minúsculas: "octubre". */
export function monthName(p: Period): string {
  return new Date(p.year, p.month - 1, 1).toLocaleDateString("es-ES", { month: "long" });
}

const MONTH_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

/**
 * Botón de calendario (junto al "+" de "Resumen del presupuesto") que abre un selector de mes: año con ‹ ›
 * y los 12 meses. Elige el mes que enseñan el presupuesto, "Resumen del mes" y el top de categorías. No deja
 * pasar del mes en curso (no hay datos futuros que ver) y, fuera de él, ofrece volver a "este mes". Se cierra
 * al elegir, al pulsar fuera o con Escape.
 */
export function MonthPickerButton({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(value.year);
  const ref = useRef<HTMLDivElement>(null);
  const now = currentPeriod();
  const atCurrent = isCurrentPeriod(value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    setYear(value.year);
    setOpen((v) => !v);
  };
  const pick = (p: Period) => {
    onChange(p);
    setOpen(false);
  };

  const arrow =
    "flex size-7 cursor-pointer items-center justify-center rounded-full text-base leading-none text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label="Elegir mes"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`Mes: ${periodLabel(value)}`}
        className={`flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full border transition-colors ${
          atCurrent ? "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground" : "border-primary bg-primary/10 text-primary"
        }`}
      >
        <CalendarIcon />
      </button>

      {open && (
        <div role="dialog" aria-label="Elegir mes" className="absolute right-0 top-full z-30 mt-2 w-60 rounded-2xl border border-border bg-card p-3 shadow-[var(--shadow-soft)]">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" className={arrow} onClick={() => setYear((y) => y - 1)} aria-label="Año anterior">
              ‹
            </button>
            <span className="text-sm font-medium">{year}</span>
            <button type="button" className={arrow} onClick={() => setYear((y) => y + 1)} disabled={year >= now.year} aria-label="Año siguiente">
              ›
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {MONTH_SHORT.map((label, i) => {
              const month = i + 1;
              const future = year > now.year || (year === now.year && month > now.month);
              const selected = year === value.year && month === value.month;
              return (
                <button
                  key={label}
                  type="button"
                  disabled={future}
                  onClick={() => pick({ month, year })}
                  aria-pressed={selected}
                  className={`cursor-pointer rounded-xl px-2 py-1.5 text-xs transition-colors disabled:cursor-default disabled:opacity-30 ${
                    selected ? "bg-foreground text-background" : "text-foreground hover:bg-muted disabled:hover:bg-transparent"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {!atCurrent && (
            <button type="button" onClick={() => pick(now)} className="mt-2 w-full cursor-pointer rounded-xl py-1.5 text-center text-[11px] text-primary hover:bg-primary/10">
              Volver a este mes
            </button>
          )}
        </div>
      )}
    </div>
  );
}
