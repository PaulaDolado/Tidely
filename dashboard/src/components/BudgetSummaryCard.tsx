import { FormEvent, useState } from "react";
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
    <div className="relative mx-auto size-44">
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
        <span className="font-serif text-2xl leading-tight">{eur(total)}</span>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">gastado</span>
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

function CategoryRow({ category, onEdit }: { category: BudgetSummaryCategory; onEdit: () => void }) {
  const ratio = category.budget > 0 ? category.spent / category.budget : category.spent > 0 ? 2 : 0;
  const over = ratio > 1;
  return (
    <li className="group">
      <div className="flex items-center gap-2 text-sm">
        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: colorVar(category.color) }} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-medium">{category.name}</span>
        <span className={`shrink-0 text-xs ${over ? "font-medium text-destructive" : "text-muted-foreground"}`}>
          {eur(category.spent)} / {eur(category.budget)}
        </span>
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Editar ${category.name}`}
          className="shrink-0 cursor-pointer rounded p-1 text-xs text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus:opacity-100 group-hover:opacity-100"
        >
          ✎
        </button>
      </div>
      <div className="ml-4.5 mt-1 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(Math.min(ratio, 1) * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.min(ratio, 1) * 100}%`, backgroundColor: over ? "var(--destructive)" : colorVar(category.color) }}
          />
        </div>
        <span className="w-10 shrink-0 text-right text-[10px] text-muted-foreground">{pct(category.percent)}</span>
      </div>
    </li>
  );
}

/**
 * "Resumen del presupuesto" (Finanzas): donut con los gastos del mes repartidos por categoría y,
 * debajo, cuánto se lleva gastado de lo que le toca a cada una — su % de los ingresos del mes.
 * Las categorías (nombre, color y %) se crean con "+" y se editan con el lápiz de cada fila; se
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

      <Donut slices={slices} total={total} />
      {total === 0 && <p className="mt-2 text-center text-xs text-muted-foreground">Sin gastos registrados este mes.</p>}

      {summary.categories.length === 0 ? (
        <p className="mt-4 text-center text-sm text-muted-foreground">No tienes categorías. Añade una con el "+".</p>
      ) : (
        <ul className="mt-5 space-y-3">
          {summary.categories.map((c) =>
            editingId === c.id ? (
              <li key={c.id}>
                <CategoryForm
                  initial={{ name: c.name, color: c.color, percent: c.percent }}
                  maxPercent={summary.unassignedPercent + c.percent}
                  submitLabel="Guardar"
                  onCancel={() => setEditingId(null)}
                  onSubmit={async (values) => {
                    await api.put(`/finance/budget-categories/${c.id}`, values);
                    afterChange();
                  }}
                  onDelete={async () => {
                    await api.delete(`/finance/budget-categories/${c.id}`);
                    afterChange();
                  }}
                />
              </li>
            ) : (
              <CategoryRow
                key={c.id}
                category={c}
                onEdit={() => {
                  setAdding(false);
                  setEditingId(c.id);
                }}
              />
            )
          )}
          {summary.uncategorizedSpent > 0 && (
            <li className="flex items-center gap-2 text-sm">
              <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: colorVar("muted") }} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate font-medium">Sin categoría</span>
              <span className="shrink-0 text-xs text-muted-foreground">{eur(summary.uncategorizedSpent)}</span>
            </li>
          )}
        </ul>
      )}

      <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
        Presupuestado {pct(summary.assignedPercent)} de los ingresos · sin asignar {pct(summary.unassignedPercent)}
        {summary.income <= 0 && " · este mes aún no hay ingresos, así que los presupuestos salen a 0 €"}
      </p>
    </div>
  );
}
