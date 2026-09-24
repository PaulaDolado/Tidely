// Puerto de dashboard/src/utils/financeExport.ts — misma lógica de construcción del CSV (pura,
// sin DOM), solo cambia cómo se "descarga" el resultado (ver saveAndShareText en fileExport.ts).

interface ExportableTransaction {
  type: "income" | "expense";
  amount: number;
  category: string;
  description: string | null;
  date: string;
}

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

// Escapa una celda para CSV (RFC 4180): el separador es ";" (no ",") porque Excel en español lo
// interpreta como separador de columnas de forma nativa al abrir el archivo.
function csvCell(value: string): string {
  if (/[";\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function amountCell(t: ExportableTransaction): string {
  const signed = t.type === "expense" ? -t.amount : t.amount;
  return signed.toFixed(2).replace(".", ",");
}

export function transactionsToCsv(transactions: ExportableTransaction[], options: { includeMonth?: boolean } = {}): string {
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
  // salen mal — con el BOM las reconoce y las pinta bien.
  return "﻿" + [headers.join(";"), ...rows].join("\r\n");
}
