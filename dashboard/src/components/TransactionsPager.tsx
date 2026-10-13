export type PageSize = number | "all";

export const DEFAULT_PAGE_SIZE = 10;
// Hasta cuántos movimientos por página se ofrece elegir; "Todo" cubre lo demás. El backend admite como
// máximo 100 por petición (ver listTransactionsQuerySchema).
const MAX_PAGE_SIZE = 100;

/** 10, 20, 30… hasta cubrir `total` (con tope en 100), más "Todo". */
function pageSizeOptions(total: number): number[] {
  const top = Math.min(MAX_PAGE_SIZE, Math.max(10, Math.ceil(total / 10) * 10));
  return Array.from({ length: top / 10 }, (_, i) => (i + 1) * 10);
}

/**
 * Pie de la lista de movimientos: cuántos mostrar por página (10, 20, 30…, o "Todo") y flechas ‹ › para
 * pasar de página, con el rango visible ("11–20 de 47"). Solo se pinta cuando hay más de 10 movimientos
 * (ver FinanzasPage): con 10 o menos la lista cabe entera y no hace falta.
 */
export function TransactionsPager({
  total,
  page,
  pages,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  total: number;
  page: number;
  pages: number;
  pageSize: PageSize;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: PageSize) => void;
}) {
  const all = pageSize === "all";
  const size = all ? total : pageSize;
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(total, page * size);
  const arrow =
    "flex size-8 cursor-pointer items-center justify-center rounded-full border border-border text-base leading-none text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:cursor-default disabled:opacity-30 disabled:hover:border-border disabled:hover:text-muted-foreground";

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
      <label className="flex items-center gap-2">
        Mostrar
        <select
          value={String(pageSize)}
          onChange={(e) => onPageSizeChange(e.target.value === "all" ? "all" : Number(e.target.value))}
          className="field-input w-auto px-3 py-1.5 text-xs text-foreground"
          aria-label="Movimientos por página"
        >
          {pageSizeOptions(total).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
          <option value="all">Todo</option>
        </select>
      </label>

      <div className="flex items-center gap-3">
        <span aria-live="polite">{all ? `${total} movimientos` : `${from}–${to} de ${total}`}</span>
        {!all && pages > 1 && (
          <div className="flex items-center gap-1.5">
            <button type="button" className={arrow} onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label="Página anterior">
              ‹
            </button>
            <button type="button" className={arrow} onClick={() => onPageChange(page + 1)} disabled={page >= pages} aria-label="Página siguiente">
              ›
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const STORAGE_KEY = "tidely.finance.pageSize";

/** Tamaño de página recordado entre visitas (por navegador); 10 si no hay o no es válido. */
export function readStoredPageSize(): PageSize {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "all") return "all";
    const n = Number(raw);
    return Number.isInteger(n) && n >= 10 && n <= MAX_PAGE_SIZE && n % 10 === 0 ? n : DEFAULT_PAGE_SIZE;
  } catch {
    return DEFAULT_PAGE_SIZE;
  }
}

export function storePageSize(size: PageSize): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(size));
  } catch {
    // sin localStorage simplemente no se recuerda
  }
}
