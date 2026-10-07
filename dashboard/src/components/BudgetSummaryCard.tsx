import { FormEvent, ReactNode, useState } from "react";
import { api, ApiError } from "../api/client";
import { CALENDAR_COLOR_OPTIONS } from "../utils/calendarColors";
import { BudgetSummary, BudgetSummaryCategory, CalendarColor } from "../types";

function eur(n: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
}

function pct(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
}

// Color de una categoría como valor CSS — los mismos tokens de diseño que el resto de la app, así
// el donut sigue el tema activo. Se usan las variables BASE (--habit, --hobby...) y no las
// `--color-*` de Tailwind: Tailwind v4 solo emite estas últimas si alguna clase de utilidad las
// usa, así que las que no (hobby, warning, negative...) llegaban vacías y la porción salía sin
// color. "muted" se pinta con el gris de texto (el fondo `muted` sería casi invisible sobre la
// tarjeta).
function colorVar(color: CalendarColor): string {
  return color === "muted" ? "var(--muted-foreground)" : `var(--${color})`;
}

// Donut: geometría en unidades del viewBox.
const SIZE = 120;
const RADIUS = 46;
const STROKE = 16;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface Slice {
  key: string;
  label: string;
  color: CalendarColor;
  spent: number;
}

function Donut({ slices, total }: { slices: Slice[]; total: number }) {
  let offset = 0;
  return (
    <div className="relative size-28 shrink-0">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="size-full -rotate-90" role="img" aria-label="Gastos del mes por categoría">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="var(--muted)" strokeWidth={STROKE} />
        {total > 0 &&
          slices
            .filter((s) => s.spent > 0)
            .map((s) => {
              const length = (s.spent / total) * CIRCUMFERENCE;
              const circle = (
                <circle
                  key={s.key}
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={RADIUS}
                  fill="none"
                  stroke={colorVar(s.color)}
                  strokeWidth={STROKE}
                  strokeDasharray={`${length} ${CIRCUMFERENCE - length}`}
                  strokeDashoffset={-offset}
                >
                  <title>{`${s.label}: ${eur(s.spent)} (${Math.round((s.spent / total) * 100)}% de los gastos)`}</title>
                </circle>
              );
              offset += length;
              return circle;
            })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="font-serif text-lg leading-tight">{eur(total)}</span>
        <span className="text-[9px] uppercase tracking-widest text-muted-foreground">gastado</span>
      </div>
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: CalendarColor; onChange: (color: CalendarColor) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Color">
      {CALENDAR_COLOR_OPTIONS.map((opt) => (
        <button
          key={opt.key}
          type="button"
          role="radio"
          aria-checked={value === opt.key}
          aria-label={opt.label}
          title={opt.label}
          onClick={() => onChange(opt.key)}
          style={{ backgroundColor: colorVar(opt.key) }}
          className={`size-6 cursor-pointer rounded-full transition-transform hover:scale-110 ${
            value === opt.key ? "ring-2 ring-foreground ring-offset-2 ring-offset-card" : ""
          }`}
        />
      ))}
    </div>
  );
}

// Formulario compartido por "añadir" (botón +) y "editar" (lápiz de cada categoría): nombre, color y
// % de los ingresos del mes. Los errores del servidor (nombre repetido, pasarse del 100%...) se
// enseñan tal cual, que ya vienen redactados para el usuario.
function CategoryForm({
  initial,
  maxPercent,
  submitLabel,
  onSubmit,
  onCancel,
  onDelete,
}: {
  initial: { name: string; color: CalendarColor; percent: number };
  maxPercent: number;
  submitLabel: string;
  onSubmit: (values: { name: string; color: CalendarColor; percent: number }) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
}) {
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState(initial.color);
  const [percent, setPercent] = useState(String(initial.percent));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = Number(percent);
    if (!name.trim() || !Number.isFinite(value) || value < 0 || value > 100) {
      setError("Pon un nombre y un porcentaje entre 0 y 100.");
      return;
    }
    run(() => onSubmit({ name: name.trim(), color, percent: value }));
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-border bg-background p-3">
      <div className="grid grid-cols-[1fr_5.5rem] gap-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={50}
          placeholder="Nombre de la categoría"
          className="field-input min-w-0 px-3 py-2 text-sm"
        />
        <div className="relative">
          <input
            type="number"
            min={0}
            max={100}
            step="0.5"
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
            aria-label="Porcentaje de los ingresos"
            className="field-input w-full px-3 py-2 pr-7 text-sm"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
        </div>
      </div>
      <ColorPicker value={color} onChange={setColor} />
      <p className="text-xs text-muted-foreground">
        % de tus ingresos del mes. {maxPercent > 0 ? `Puedes asignar hasta ${pct(maxPercent)}.` : "Ya has asignado el 100%."}
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className="btn-dark px-4 py-1.5 text-xs disabled:opacity-50">
          {busy ? "…" : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          Cancelar
        </button>
        {onDelete && (
          <button
            type="button"
            disabled={busy}
            onClick={() => (confirmingDelete ? run(onDelete) : setConfirmingDelete(true))}
            onBlur={() => setConfirmingDelete(false)}
            className={`ml-auto cursor-pointer rounded-full px-2 py-1 text-xs transition-colors ${
              confirmingDelete ? "bg-destructive text-destructive-foreground" : "text-muted-foreground hover:text-destructive"
            }`}
          >
            {confirmingDelete ? "¿Confirmar eliminar?" : "Eliminar"}
          </button>
        )}
      </div>
    </form>
  );
}

type LabelAlign = "left" | "right" | "center";

const ALIGN_CLASSES: Record<LabelAlign, { text: string; row: string }> = {
  left: { text: "text-left", row: "justify-start" },
  right: { text: "text-right", row: "justify-end" },
  center: { text: "text-center", row: "justify-center" },
};

// Una categoría colocada alrededor del donut: su nombre, "gastado / presupuesto" con el lápiz de
// editar al lado y, debajo, su % de los ingresos. Sin barra de progreso: si se pasa de lo que le
// toca, el gasto sale en rojo.
function CategoryLabel({
  name,
  color,
  spent,
  budget,
  percent,
  align,
  active,
  onEdit,
}: {
  name: string;
  color: CalendarColor;
  spent: number;
  budget?: number; // sin presupuesto (p. ej. "Sin categoría") solo se enseña lo gastado
  percent?: number;
  align: LabelAlign;
  active?: boolean;
  onEdit?: () => void;
}) {
  const over = budget !== undefined && spent > budget;
  const a = ALIGN_CLASSES[align];
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 rounded-xl px-1.5 py-1 ${a.text} ${active ? "bg-muted" : ""}`}>
      <div className={`flex min-w-0 items-center gap-1.5 ${a.row}`}>
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: colorVar(color) }} aria-hidden="true" />
        <span className="min-w-0 text-[11px] font-medium leading-tight [overflow-wrap:anywhere]" title={name}>
          {name}
        </span>
      </div>
      <div className={`flex items-center gap-0.5 text-[11px] ${a.row} ${over ? "font-medium text-destructive" : "text-muted-foreground"}`}>
        <span className="whitespace-nowrap">{budget === undefined ? eur(spent) : `${eur(spent)} / ${eur(budget)}`}</span>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Editar ${name}`}
            className="shrink-0 cursor-pointer rounded px-0.5 text-[11px] text-muted-foreground opacity-60 transition-opacity hover:opacity-100 focus:opacity-100"
          >
            ✎
          </button>
        )}
      </div>
      {percent !== undefined && <span className="text-[10px] text-muted-foreground">{pct(percent)}</span>}
    </div>
  );
}

// Filas de categorías por encima/debajo del donut: dos columnas; si queda una suelta al final, se
// centra en vez de quedarse pegada a la izquierda.
function LabelGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-2 gap-y-1 [&>*:last-child:nth-child(odd)]:col-span-2">{children}</div>;
}

/**
 * "Resumen del presupuesto" (Finanzas): un donut con los gastos del mes repartidos por categoría y,
 * alrededor de él, cada categoría con lo gastado frente a lo que le toca (su % de los ingresos del
 * mes). Se reparten en tres zonas — unas encima, dos a los lados y el resto debajo — para que
 * quepan en una tarjeta estrecha sin recortar los nombres.
 *
 * Las categorías (nombre, color y %) se crean con "+" y se editan con el lápiz de cada una; se
 * enlazan con los movimientos por NOMBRE (ver budgetService en el backend), así que apuntar un
 * gasto con la categoría "Casa" suma a la porción de Casa. Lo que no coincide con ninguna cae en
 * "Otro".
 */
export function BudgetSummaryCard({
  summary,
  onChanged,
}: {
  summary: BudgetSummary | null;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  if (!summary) return null;

  const slices: Slice[] = summary.categories.map((c) => ({ key: String(c.id), label: c.name, color: c.color, spent: c.spent }));
  if (summary.uncategorizedSpent > 0) {
    slices.push({ key: "uncategorized", label: "Sin categoría", color: "muted", spent: summary.uncategorizedSpent });
  }
  const total = slices.reduce((sum, s) => sum + s.spent, 0);

  // Color sugerido para una categoría nueva: el primero de la paleta que no esté en uso.
  const usedColors = new Set(summary.categories.map((c) => c.color));
  const suggestedColor = CALENDAR_COLOR_OPTIONS.find((o) => !usedColors.has(o.key))?.key ?? "primary";

  const afterChange = () => {
    setAdding(false);
    setEditingId(null);
    onChanged();
  };

  // Reparto alrededor del donut: dos categorías a los lados (una a cada lado), y el resto mitad
  // encima y mitad debajo, en el orden de la lista.
  const categories = summary.categories;
  const sideCount = Math.min(2, categories.length);
  const topCount = Math.ceil((categories.length - sideCount) / 2);
  const top = categories.slice(0, topCount);
  const sides = categories.slice(topCount, topCount + sideCount);
  const bottom = categories.slice(topCount + sideCount);
  const editing = categories.find((c) => c.id === editingId) ?? null;

  const labelFor = (c: BudgetSummaryCategory, align: LabelAlign) => (
    <CategoryLabel
      key={c.id}
      name={c.name}
      color={c.color}
      spent={c.spent}
      budget={c.budget}
      percent={c.percent}
      align={align}
      active={editingId === c.id}
      onEdit={() => {
        setAdding(false);
        setEditingId(c.id);
      }}
    />
  );

  return (
    <div className="card-soft">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Resumen del presupuesto</h2>
        <button
          type="button"
          onClick={() => {
            setEditingId(null);
            setAdding((v) => !v);
          }}
          aria-label={adding ? "Cerrar" : "Añadir categoría"}
          title={adding ? "Cerrar" : "Añadir categoría"}
          className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full bg-foreground text-sm leading-none text-background transition-opacity hover:opacity-80"
        >
          {adding ? "×" : "+"}
        </button>
      </div>

      {adding && (
        <div className="mb-4">
          <CategoryForm
            initial={{ name: "", color: suggestedColor, percent: Math.min(10, summary.unassignedPercent) }}
            maxPercent={summary.unassignedPercent}
            submitLabel="Añadir"
            onCancel={() => setAdding(false)}
            onSubmit={async (values) => {
              await api.post("/finance/budget-categories", values);
              afterChange();
            }}
          />
        </div>
      )}

      <div className="space-y-2">
        {top.length > 0 && <LabelGrid>{top.map((c) => labelFor(c, "center"))}</LabelGrid>}

        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5">
          <div>{sides[0] && labelFor(sides[0], "right")}</div>
          <Donut slices={slices} total={total} />
          <div>{sides[1] && labelFor(sides[1], "left")}</div>
        </div>

        {(bottom.length > 0 || summary.uncategorizedSpent > 0) && (
          <LabelGrid>
            {bottom.map((c) => labelFor(c, "center"))}
            {summary.uncategorizedSpent > 0 && <CategoryLabel key="uncategorized" name="Sin categoría" color="muted" spent={summary.uncategorizedSpent} align="center" />}
          </LabelGrid>
        )}
      </div>

      {categories.length === 0 && <p className="mt-3 text-center text-sm text-muted-foreground">No tienes categorías. Añade una con el "+".</p>}

      {editing && (
        <div className="mt-4">
          <CategoryForm
            key={editing.id}
            initial={{ name: editing.name, color: editing.color, percent: editing.percent }}
            maxPercent={summary.unassignedPercent + editing.percent}
            submitLabel="Guardar"
            onCancel={() => setEditingId(null)}
            onSubmit={async (values) => {
              await api.put(`/finance/budget-categories/${editing.id}`, values);
              afterChange();
            }}
            onDelete={async () => {
              await api.delete(`/finance/budget-categories/${editing.id}`);
              afterChange();
            }}
          />
        </div>
      )}
    </div>
  );
}
