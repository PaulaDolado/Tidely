import { useMemo, useState } from "react";

const MONTH_NAMES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
const DAY_LABELS = ["L", "M", "X", "J", "V", "S", "D"];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// "YYYY-MM-DD" en hora local (no toISOString(), que pasa a UTC y puede cambiar el día)
function toKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

// Calendario para elegir un día. Cambiar de mes con las flechas solo cambia el mes que se ve:
// `onPick` llega únicamente al pulsar un día (o "Hoy"), así que quien lo usa dentro de un panel
// puede cerrarlo ahí sin que se cierre al ir de octubre a julio. Con el `<input type="date">`
// nativo no se podía: Chrome cambia el valor (y dispara onChange) al pasar de mes.
export function DayPicker({ value, onPick }: { value: string; onPick: (value: string) => void }) {
  const today = toKey(new Date());
  const [view, setView] = useState(() => {
    const d = parseKey(value) ?? new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  // Semanas completas, lunes primero (mismo criterio que MiniMonth de AgendaPage)
  const cells = useMemo(() => {
    const first = new Date(view.year, view.month, 1);
    const offset = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
    const total = Math.ceil((offset + daysInMonth) / 7) * 7;
    return Array.from({ length: total }, (_, i) => new Date(view.year, view.month, 1 - offset + i));
  }, [view]);

  const shiftMonth = (delta: number) =>
    setView(({ year, month }) => {
      const d = new Date(year, month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });

  return (
    <div className="w-64 select-none">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          aria-label="Mes anterior"
          className="flex size-7 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          ‹
        </button>
        <p className="text-sm font-medium first-letter:uppercase" aria-live="polite">
          {MONTH_NAMES[view.month]} de {view.year}
        </p>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          aria-label="Mes siguiente"
          className="flex size-7 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-y-1">
        {DAY_LABELS.map((label) => (
          <span key={label} className="text-center text-[10px] text-muted-foreground">
            {label}
          </span>
        ))}
        {cells.map((d) => {
          const key = toKey(d);
          const inMonth = d.getMonth() === view.month;
          const selected = key === value;
          const isToday = key === today;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onPick(key)}
              aria-label={d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              aria-pressed={selected}
              className={`flex aspect-square cursor-pointer items-center justify-center rounded-full text-xs transition-colors ${
                selected
                  ? "bg-foreground font-medium text-background"
                  : isToday
                    ? "font-medium text-primary ring-1 ring-primary hover:bg-muted"
                    : inMonth
                      ? "text-foreground hover:bg-muted"
                      : "text-muted-foreground/50 hover:bg-muted"
              }`}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={() => onPick(today)}
          className="cursor-pointer rounded-full px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          Hoy
        </button>
      </div>
    </div>
  );
}
