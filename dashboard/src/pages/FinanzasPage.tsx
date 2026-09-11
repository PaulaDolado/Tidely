import { useEffect, useRef, useState } from "react";
import { PageHeader } from "../components/AppShell";
import { api } from "../api/client";
import { useFetch } from "../hooks/useFetch";
import { Loading, ErrorMessage } from "../components/Feedback";
import { MiniLineChart } from "../components/MiniLineChart";
import { downloadCsv, transactionsToCsv } from "../utils/financeExport";
import { FinanceAnalytics, MonthlyBalance, Pagination, SavingsGoal, Transaction } from "../types";

const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function eur(n: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
}

export function FinanzasPage() {
  const now = new Date();
  const [editingId, setEditingId] = useState<number | null>(null);
  const {
    data: balance,
    loading: loadingBalance,
    error: balanceError,
    reload: reloadBalance,
  } = useFetch(() => api.get<MonthlyBalance>(`/finance/balance/${now.getMonth() + 1}/${now.getFullYear()}`), []);
  const {
    data: txData,
    loading: loadingTx,
    error: txError,
    reload: reloadTx,
  } = useFetch(() => api.get<{ transactions: Transaction[]; pagination: Pagination }>("/finance/transactions?limit=15"), []);
  const { data: analytics, reload: reloadAnalytics } = useFetch(() => api.get<FinanceAnalytics>("/finance/analytics"), []);
  // Solo para los totales de las tarjetas resumen (Ahorro/Inversión) — las metas en sí (crear,
  // ver casillas, eliminar) viven únicamente en "Metas de ahorro", no se duplican aquí.
  const { data: savingsData, reload: reloadSavings } = useFetch(
    () => api.get<{ savingsGoals: SavingsGoal[] }>("/finance/savings-goals"),
    []
  );

  const reloadAll = () => {
    reloadBalance();
    reloadTx();
    reloadAnalytics();
    reloadSavings();
  };

  const savingsGoals = savingsData?.savingsGoals ?? [];
  const totalAhorro = savingsGoals.filter((g) => g.type === "ahorro").reduce((sum, g) => sum + g.currentAmount, 0);
  const totalInversion = savingsGoals.filter((g) => g.type === "inversion").reduce((sum, g) => sum + g.currentAmount, 0);
  const editingTx = txData?.transactions.find((t) => t.id === editingId) ?? null;

  return (
    <>
      <PageHeader title="Finanzas" subtitle="Ingresos, gastos, balance, ahorro e inversión" action={<FinanceExportMenu />} />

      <div className="grid gap-8 lg:grid-cols-12">
        {/* @container: el formulario de alta necesita saber SU propio ancho renderizado, no el
            del viewport — esta columna es solo 8/12 del grid de la página (y el <aside> de la
            web le resta más aún), así que un breakpoint normal (sm:/xl:) sigue basándose en el
            ancho de la ventana y desborda igual aunque la ventana sea grande. */}
        <div className="@container space-y-8 lg:col-span-8">
          {balanceError && <ErrorMessage message={balanceError} />}
          {loadingBalance ? (
            <Loading label="Cargando balance..." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
              <SummaryCard label="Ingresos" value={eur(balance?.income ?? 0)} tone="positive" />
              <SummaryCard label="Gastos" value={eur(balance?.expense ?? 0)} tone="negative" />
              <SummaryCard label="Balance" value={eur(balance?.balance ?? 0)} tone={(balance?.balance ?? 0) >= 0 ? "positive" : "negative"} />
              <SummaryCard label="Ahorro" value={eur(totalAhorro)} tone="positive" />
              <SummaryCard label="Inversión" value={eur(totalInversion)} tone="positive" />
            </div>
          )}

          <MovementForm
            submitLabel="Registrar"
            onSubmit={async (input) => {
              await api.post("/finance/transactions", input);
              reloadAll();
            }}
          />

          <div>
            <h2 className="mb-6 text-xl font-medium">Movimientos</h2>
            {txError && <ErrorMessage message={txError} />}
            <div className="overflow-hidden rounded-3xl border border-border bg-card">
              {loadingTx ? (
                <Loading />
              ) : (txData?.transactions.length ?? 0) === 0 ? (
                <p className="p-8 text-center text-sm text-muted-foreground">Sin movimientos todavía.</p>
              ) : (
                txData?.transactions.map((tx) => (
                  <div key={tx.id} className="group flex items-center justify-between border-b border-border px-6 py-4 last:border-b-0">
                    <div>
                      <p className="font-medium">{tx.description || tx.category}</p>
                      <span className="text-xs uppercase tracking-wider text-muted-foreground">
                        {tx.category} · {new Date(tx.date).toLocaleDateString("es-ES")}
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className={`font-medium ${tx.type === "expense" ? "text-destructive" : "text-primary"}`}>
                        {tx.type === "expense" ? "−" : "+"}
                        {eur(tx.amount)}
                      </span>
                      {/* Un único botón (lápiz) en vez de "Editar"/"Eliminar" separados — abre el
                          diálogo de abajo (editingTx), no edita la fila en su propia posición. */}
                      <button
                        onClick={() => setEditingId(tx.id)}
                        aria-label="Editar movimiento"
                        className="cursor-pointer rounded p-1.5 text-xs text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                      >
                        ✎
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {analytics && (
            <div className="space-y-6">
              <div className="card-soft">
                <h2 className="mb-4 text-sm font-medium">Tendencia (últimos 6 meses)</h2>
                <MiniLineChart
                  data={analytics.monthlyTrend.map((m) => ({ label: MONTH_LABELS[m.month - 1], value: m.balance }))}
                  formatValue={eur}
                />
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6 lg:col-span-4">
          <div className="rounded-3xl bg-primary p-8 text-primary-foreground">
            <h2 className="mb-6 text-xs uppercase tracking-widest opacity-60">Resumen del mes</h2>
            <div className="space-y-4">
              <Row label="Ingresos" value={`+${eur(balance?.income ?? 0)}`} />
              <Row label="Gastos" value={`−${eur(balance?.expense ?? 0)}`} />
              <Row label="Ahorro" value={eur(totalAhorro)} />
              <div className="my-2 h-px bg-primary-foreground/20" />
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Saldo neto</span>
                <span className="font-serif text-xl">{eur(balance?.balance ?? 0)}</span>
              </div>
            </div>
          </div>

          {analytics && (
            <div className="rounded-3xl bg-secondary p-6 text-secondary-foreground">
              <h2 className="mb-4 text-sm font-medium">Top 5 categorías de gasto (este mes)</h2>
              {analytics.topCategories.length === 0 ? (
                <p className="text-sm opacity-70">Sin gastos registrados este mes.</p>
              ) : (
                <ul className="space-y-2">
                  {analytics.topCategories.map((c) => (
                    <li key={c.category} className="flex items-center justify-between border-b border-secondary-foreground/15 pb-2 text-sm last:border-b-0">
                      <span>{c.category}</span>
                      <strong>{eur(c.total)}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {analytics && (
            <div className="card-soft">
              <h2 className="mb-2 text-sm font-medium">Proyección anual</h2>
              <p className="text-sm text-muted-foreground">
                Al ritmo de los últimos {analytics.projectedAnnual.basedOnMonths} meses ({eur(analytics.projectedAnnual.avgMonthlyBalance)}/mes en
                promedio), terminarías el año con{" "}
                <strong className="text-foreground">{eur(analytics.projectedAnnual.projectedYearEnd)}</strong> acumulados.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Mismo patrón que ProfileDialog.tsx: overlay fixed + tarjeta centrada, en vez de editar
          la fila en su propia posición dentro de la lista. */}
      {editingTx && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-foreground/50 p-4"
          onClick={() => setEditingId(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="@container w-full max-w-lg rounded-3xl bg-card p-6 shadow-[var(--shadow-soft)] sm:p-8"
          >
            <div className="mb-6 flex items-center justify-between">
              <h2 className="font-serif text-xl">Editar movimiento</h2>
              <button
                type="button"
                onClick={() => setEditingId(null)}
                className="cursor-pointer text-xs text-muted-foreground hover:text-foreground"
              >
                ✕ Cerrar
              </button>
            </div>
            <MovementForm
              dialog
              initial={{
                type: editingTx.type,
                amount: editingTx.amount,
                category: editingTx.category,
                description: editingTx.description ?? "",
                date: editingTx.date.slice(0, 10),
              }}
              submitLabel="Guardar"
              onCancel={() => setEditingId(null)}
              onSubmit={async (input) => {
                await api.put(`/finance/transactions/${editingTx.id}`, input);
                setEditingId(null);
                reloadAll();
              }}
              onDelete={async () => {
                await api.delete(`/finance/transactions/${editingTx.id}`);
                setEditingId(null);
                reloadAll();
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}

// Mismo patrón que ExportMenu (ProyectosPage) / IcsMenu (AgendaPage): un <details> desplegable
// con "Exportar" — pero aquí, en vez de una lista fija de opciones, cada modo pide un dato
// (el mes, o el año) antes de descargar, así que las dos secciones son mini-formularios en vez
// de simples botones de menú.
function FinanceExportMenu() {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [busy, setBusy] = useState(false);
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [year, setYear] = useState(() => new Date().getFullYear());

  const fetchTransactions = async (from: Date, to: Date) => {
    const result = await api.get<{ transactions: Transaction[] }>(
      `/finance/transactions/export?from=${from.toISOString()}&to=${to.toISOString()}`
    );
    return result.transactions;
  };

  const exportMonth = async () => {
    const [y, m] = month.split("-").map(Number);
    if (!y || !m) return;
    setBusy(true);
    try {
      const from = new Date(y, m - 1, 1);
      const to = new Date(y, m, 0, 23, 59, 59, 999);
      const transactions = await fetchTransactions(from, to);
      downloadCsv(transactionsToCsv(transactions), `finanzas-${month}.csv`);
      if (detailsRef.current) detailsRef.current.open = false;
    } finally {
      setBusy(false);
    }
  };

  const exportYear = async () => {
    setBusy(true);
    try {
      const from = new Date(year, 0, 1);
      const to = new Date(year, 11, 31, 23, 59, 59, 999);
      const transactions = await fetchTransactions(from, to);
      downloadCsv(transactionsToCsv(transactions, { includeMonth: true }), `finanzas-${year}.csv`);
      if (detailsRef.current) detailsRef.current.open = false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <details ref={detailsRef} className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-1 whitespace-nowrap rounded-full border border-border px-4 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground [&::-webkit-details-marker]:hidden">
        Exportar
      </summary>
      <div className="absolute right-0 z-10 mt-2 w-72 rounded-2xl border border-border bg-card p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Un mes</p>
        <div className="mb-4 flex gap-2">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="field-input min-w-0 flex-1 text-sm"
          />
          <button onClick={exportMonth} disabled={busy} className="btn-dark shrink-0 px-3 text-xs disabled:opacity-50">
            Exportar
          </button>
        </div>

        <p className="mb-1.5 border-t border-border pt-3 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          Año completo (por mes)
        </p>
        <div className="flex gap-2">
          <input
            type="number"
            min={2000}
            max={2100}
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="field-input min-w-0 flex-1 text-sm"
          />
          <button onClick={exportYear} disabled={busy} className="btn-dark shrink-0 px-3 text-xs disabled:opacity-50">
            Exportar
          </button>
        </div>
      </div>
    </details>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm opacity-80">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone: "positive" | "negative" }) {
  return (
    <div className="card-soft">
      <p className="text-xs uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={`mt-2 font-serif text-3xl ${tone === "negative" ? "text-destructive" : "text-primary"}`}>{value}</p>
    </div>
  );
}

interface MovementFormValues {
  type: "income" | "expense";
  amount: number;
  category: string;
  description: string;
  date: string; // "YYYY-MM-DD" — createTransactionSchema/updateTransactionSchema aceptan Joi.date().iso().
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// Fecha local (no toISOString(), que desplaza a UTC y puede devolver el día de ayer/mañana según
// la zona horaria) — el usuario elige el día en que ocurrió el movimiento, así que debe coincidir
// con "hoy" en su propia zona.
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Disparador de ancho fijo (solo el icono 📅, sin el texto "dd/mm/aaaa" del `<input type="date">`
// nativo) que abre un panel flotante con el date input de verdad — se usa en la fila compacta de
// MovementForm (ver comentario ahí) para que la fecha no fuerce esa columna a ensancharse. Mismo
// patrón que EditableCell en PlanificadorPage.tsx (disparador + panel que se cierra al clicar
// fuera), pero sin portal a document.body: aquí el campo vive en un grid normal, no en una
// `<table>` cuyo auto-table-layout se viera afectado por el ancho del panel.
function CompactDateField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={value ? new Date(`${value}T00:00:00`).toLocaleDateString("es-ES") : "Elegir fecha"}
        className="field-input flex w-full cursor-pointer items-center justify-center px-0"
      >
        📅
      </button>
      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 rounded-xl border border-border bg-card p-2 shadow-[var(--shadow-soft)]">
          <input
            autoFocus
            type="date"
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              setOpen(false);
            }}
            className="field-input text-sm"
          />
        </div>
      )}
    </div>
  );
}

// Un único formulario para crear (arriba de la lista, con card-soft propia, una sola fila) y
// para editar (`dialog`, dentro del diálogo modal que abre el lápiz de cada movimiento — ver
// `editingTx` de FinanzasPage) — misma validación y mismos campos en los dos casos, para que
// "olvidé poner un movimiento del mes pasado" se corrija sin salir de esta página.
function MovementForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  onDelete,
  dialog,
}: {
  initial?: Partial<MovementFormValues>;
  submitLabel: string;
  onSubmit: (input: MovementFormValues) => Promise<void>;
  onCancel?: () => void;
  onDelete?: () => Promise<void>;
  dialog?: boolean;
}) {
  const [concept, setConcept] = useState(initial?.description ?? "");
  const [amount, setAmount] = useState(initial?.amount != null ? String(initial.amount) : "");
  const [kind, setKind] = useState<"ingreso" | "gasto">(initial?.type === "income" ? "ingreso" : "gasto");
  // Vacío por defecto — sin categoría "general" implícita: el usuario tiene que escribir la
  // suya, igual que ya es obligatorio en el backend (createTransactionSchema.category.required()).
  const [category, setCategory] = useState(initial?.category ?? "");
  const [date, setDate] = useState(initial?.date ?? todayStr());
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Mismo patrón que "Eliminar página" en CustomPagePage.tsx:183-198 — el propio botón pide
  // confirmar cambiando su texto/color en vez de un diálogo aparte; onBlur lo cancela solo.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const value = Number(amount);
        if (!concept.trim() || !value || !category.trim() || !date) return;
        setSaving(true);
        try {
          await onSubmit({
            type: kind === "gasto" ? "expense" : "income",
            amount: value,
            category: category.trim(),
            description: concept.trim(),
            date,
          });
          if (!initial) {
            setConcept("");
            setAmount("");
            setCategory("");
            setDate(todayStr());
          }
        } finally {
          setSaving(false);
        }
      }}
      className={dialog ? "grid gap-4 @sm:grid-cols-2" : "grid gap-4 card-soft @sm:grid-cols-2 @xl:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]"}
    >
      <input
        value={concept}
        onChange={(e) => setConcept(e.target.value)}
        placeholder="Concepto"
        className={dialog ? "field-input @sm:col-span-2" : "field-input @sm:col-span-2 @xl:col-span-1"}
      />
      <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min="0" step="0.01" placeholder="Importe" className="field-input" />
      <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="field-input">
        <option value="gasto">Gasto</option>
        <option value="ingreso">Ingreso</option>
      </select>
      <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Categoría" className="field-input" />
      {/* En el diálogo (2 columnas, de sobra de sitio) el campo de fecha se queda como un
          `<input type="date">` normal — el problema solo aparece en la fila compacta de crear
          (6 columnas en pantallas @xl, ver el grid de más arriba): un date input nativo no puede
          encogerse por debajo del ancho que necesita para pintar su propio texto ("dd/mm/aaaa"),
          así que con una columna `1fr` estrecha termina empujando la última columna (el botón
          "Registrar") fuera de la fila. Reducirlo a un simple icono con ancho fijo (ver
          CompactDateField) evita ese empujón sin tocar el resto del grid. */}
      {dialog ? (
        <input value={date} onChange={(e) => setDate(e.target.value)} type="date" className="field-input" />
      ) : (
        <CompactDateField value={date} onChange={setDate} />
      )}
      {/* En el diálogo, los botones van en su propia fila (span completo); al crear (una sola
          fila junto a los campos en pantallas anchas) el botón de guardar sigue siendo la última
          columna del grid, sin envolver nada — `contents` deja que actúe como si el div no
          existiera, así que su propio ancho de columna se controla desde el <button>. */}
      <div className={dialog ? "flex items-center gap-3 @sm:col-span-2" : "contents"}>
        <button
          type="submit"
          disabled={saving}
          className={dialog ? "btn-dark disabled:opacity-50" : "btn-dark disabled:opacity-50 @sm:col-span-2 @xl:col-span-1"}
        >
          {saving ? "…" : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground">
            Cancelar
          </button>
        )}
        {/* Borrar vive dentro del propio diálogo de edición, no como botón aparte en la lista. */}
        {onDelete && (
          <button
            type="button"
            disabled={deleting}
            onClick={async () => {
              if (!confirmingDelete) {
                setConfirmingDelete(true);
                return;
              }
              setConfirmingDelete(false);
              setDeleting(true);
              try {
                await onDelete();
              } finally {
                setDeleting(false);
              }
            }}
            onBlur={() => setConfirmingDelete(false)}
            className={`ml-auto rounded-full px-2 py-1 text-xs transition-colors disabled:opacity-50 ${
              confirmingDelete ? "bg-destructive text-destructive-foreground" : "text-muted-foreground hover:text-destructive"
            }`}
          >
            {deleting ? "…" : confirmingDelete ? "¿Confirmar eliminar?" : "Eliminar"}
          </button>
        )}
      </div>
    </form>
  );
}
