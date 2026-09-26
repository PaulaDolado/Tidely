import { Transaction } from "../types";

// Mismo patrón que agenda.ics (ver AgendaPage.IcsMenu) para "descargar un archivo generado a
// partir de datos ya traídos del backend": se construye el texto en el propio cliente y se
// dispara la descarga con un <a download> sintético — no hay generación de CSV en el backend
// (GET /finance/transactions/export solo trae las filas, sin paginar, ver financeService).

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

// Escapa una celda para CSV (RFC 4180): solo hace falta entrecomillar si lleva coma, comilla o
// salto de línea — el separador aquí es ";" (no ",") porque Excel en español lo interpreta como
// separador de columnas de forma nativa al abrir el archivo, sin pedir "Texto en columnas".
function csvCell(value: string): string {
  if (/[";\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function amountCell(t: Transaction): string {
  // Number(...) a propósito: GET /finance/transactions/export devuelve las filas de Prisma tal
  // cual, y su campo `amount` (Decimal) serializa a JSON como STRING (p.ej. "12.50"), no como
  // number a pesar de lo que dice el tipo Transaction. Para un gasto, el "-" delante ya fuerza la
  // conversión a number de forma implícita y por eso parecía funcionar; para un ingreso,
  // t.amount.toFixed(2) se llamaba sobre un string y no existe, y el CSV entero fallaba en cuanto
  // el periodo tenía algún ingreso. Coma decimal (formato español) y signo según tipo, para que
  // sume/reste bien de un vistazo sin tener que mirar también la columna "Tipo".
  const amount = Number(t.amount);
  const signed = t.type === "expense" ? -amount : amount;
  return signed.toFixed(2).replace(".", ",");
}

// `includeMonth`: para el export anual, una columna "Mes" al principio es lo que "diferencia
// cada mes dentro del año" pedido — todo en un único CSV (una fila por movimiento), pero
// agrupable/filtrable por mes en Excel/Sheets sin tener que abrir 12 archivos.
export function transactionsToCsv(transactions: Transaction[], options: { includeMonth?: boolean } = {}): string {
  const headers = [
    ...(options.includeMonth ? ["Mes"] : []),
    "Fecha",
    "Tipo",
    "Categoría",
    "Descripción",
    "Importe (€)",
  ];

  const rows = transactions.map((t) => {
    const date = new Date(t.date);
    return [
      ...(options.includeMonth ? [MONTH_NAMES[date.getMonth()]] : []),
      date.toLocaleDateString("es-ES"),
      t.type === "income" ? "Ingreso" : "Gasto",
      t.category,
      t.description ?? "",
      amountCell(t),
    ]
      .map(csvCell)
      .join(";");
  });

  // BOM al principio: sin esto, Excel en Windows interpreta el UTF-8 como Latin-1 y las tildes
  // ("Categoría", "Descripción"...) salen mal — con el BOM las reconoce y las pinta bien.
  return "﻿" + [headers.join(";"), ...rows].join("\r\n");
}

export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
