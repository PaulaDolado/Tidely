// Exportar un periodo de la Agenda (día/semana/mes/año) a .ics o PDF — ver AgendaExportDialog
// en AgendaPage.tsx. Los eventos ya llegan de `/agenda/export/:scope/:date` como ocurrencias
// CONCRETAS (recurrentes ya expandidos a instancias sueltas, igual que en las vistas semana/mes),
// así que a diferencia de `src/utils/ics.ts` en el backend (que sí genera RRULE/EXDATE para
// reconstruir la serie completa) aquí basta un VEVENT sin recurrencia por ocurrencia — export con
// alcance ("esta semana", "este año"), no un volcado de la serie entera.

import { AgendaResponse, Event, EventCategory } from "../types";
import { eventCategoryLabel } from "./eventCategories";

export type ExportScope = "day" | "week" | "month" | "year";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatIcsDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function escapeIcsText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

// Igual que foldLine en src/utils/ics.ts (RFC 5545 §3.1): pliega a 75 octetos con continuación
// indentada, algunos clientes truncan o rechazan líneas más largas.
function foldLine(line: string): string {
  const MAX = 75;
  if (line.length <= MAX) return line;
  let result = line.slice(0, MAX);
  let rest = line.slice(MAX);
  while (rest.length > 0) {
    result += `\r\n ${rest.slice(0, MAX - 1)}`;
    rest = rest.slice(MAX - 1);
  }
  return result;
}

/** UID único por OCURRENCIA (no por evento): el mismo evento recurrente puede aportar varias
 * ocurrencias al periodo exportado (p.ej. una reunión semanal, en una exportación de un mes) —
 * reutilizar solo `event.id` chocaría en un UID repetido, inválido en iCalendar. */
export function buildIcsFromEvents(events: Event[]): string {
  const lines: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Tidely//Agenda//ES", "CALSCALE:GREGORIAN"];
  const stamp = formatIcsDate(new Date().toISOString());

  for (const event of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(foldLine(`UID:event-${event.id}-${formatIcsDate(event.startTime)}@tidely.local`));
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${formatIcsDate(event.startTime)}`);
    lines.push(`DTEND:${formatIcsDate(event.endTime)}`);
    lines.push(foldLine(`SUMMARY:${escapeIcsText(event.title)}`));
    if (event.description) lines.push(foldLine(`DESCRIPTION:${escapeIcsText(event.description)}`));
    if (event.location) lines.push(foldLine(`LOCATION:${escapeIcsText(event.location)}`));
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

export function downloadTextFile(text: string, filename: string, mimeType: string) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Instante ISO → fecha/hora "de pared" tal y como se ve en `timezone`, para agrupar y listar
 * ocurrencias en el PDF con el mismo día/hora que el resto de la Agenda (no el del navegador). */
function zonedParts(iso: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { dateKey: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Mismo enfoque que dashboard/src/utils/notebookExport.ts: iframe oculto + window.print(), el
// usuario elige "Guardar como PDF" en el diálogo de impresión del navegador — evita depender de
// una librería de generación de PDF solo para esto.
export function exportEventsToPdf(title: string, subtitle: string, events: Event[], timezone: string, categories: EventCategory[]) {
  const byDay = new Map<string, Event[]>();
  for (const event of events) {
    const { dateKey } = zonedParts(event.startTime, timezone);
    const list = byDay.get(dateKey) ?? [];
    list.push(event);
    byDay.set(dateKey, list);
  }
  const days = Array.from(byDay.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  const bodyHtml =
    days.length === 0
      ? `<p class="empty">No hay eventos en este periodo.</p>`
      : days
          .map(([dateKey, dayEvents]) => {
            const dayLabel = new Date(`${dateKey}T00:00:00.000Z`).toLocaleDateString("es-ES", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
              timeZone: "UTC",
            });
            const rows = [...dayEvents]
              .sort((a, b) => a.startTime.localeCompare(b.startTime))
              .map((event) => {
                const start = zonedParts(event.startTime, timezone).time;
                const end = zonedParts(event.endTime, timezone).time;
                return `
                  <tr>
                    <td class="time">${start} – ${end}</td>
                    <td>
                      <div class="event-title">${escapeHtml(event.title)}</div>
                      <div class="event-meta">${escapeHtml(eventCategoryLabel(categories, event))}${event.location ? ` · ${escapeHtml(event.location)}` : ""}</div>
                    </td>
                  </tr>`;
              })
              .join("");
            return `
              <section class="day-block">
                <h2>${dayLabel}</h2>
                <table>${rows}</table>
              </section>`;
          })
          .join("");

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);

  const cleanup = () => {
    if (iframe.parentNode) document.body.removeChild(iframe);
  };

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    cleanup();
    window.alert("No se pudo preparar el documento para exportar a PDF.");
    return;
  }
  doc.open();
  doc.write(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; line-height: 1.5; margin: 2rem; }
  h1 { font-size: 1.6rem; margin: 0 0 0.25rem; }
  p.subtitle { color: #6b6b6b; font-size: 0.85rem; margin: 0 0 2rem; }
  .day-block { margin-bottom: 1.75rem; page-break-inside: avoid; }
  .day-block h2 { font-size: 1rem; text-transform: capitalize; border-bottom: 1px solid #ccc; padding-bottom: 0.35rem; margin: 0 0 0.5rem; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 0.35rem 0.5rem; vertical-align: top; font-size: 0.9rem; }
  td.time { white-space: nowrap; color: #555; width: 7.5rem; }
  .event-title { font-weight: 600; }
  .event-meta { color: #6b6b6b; font-size: 0.8rem; margin-top: 0.1rem; }
  .empty { color: #6b6b6b; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${subtitle ? `<p class="subtitle">${escapeHtml(subtitle)}</p>` : ""}
${bodyHtml}
</body>
</html>`);
  doc.close();

  const triggerPrint = () => {
    const win = iframe.contentWindow;
    if (!win) return cleanup();
    win.focus();
    win.print();
    // No hay evento fiable de "impresión terminada/cancelada" entre navegadores — quitamos el
    // iframe tras un margen amplio, cuando el diálogo de impresión ya se ha mostrado.
    setTimeout(cleanup, 1000);
  };
  if (doc.readyState === "complete") {
    setTimeout(triggerPrint, 150);
  } else {
    iframe.onload = () => setTimeout(triggerPrint, 150);
  }
}

/** Texto legible del periodo exportado (título del PDF, nombre del .ics) a partir de los campos
 * que ya trae la respuesta de `/agenda/export/:scope/:date` — evita recalcular límites de
 * semana/mes/año en el frontend cuando el backend ya los da (weekStart/weekEnd, etc.). */
export function scopeLabel(scope: ExportScope, response: AgendaResponse): string {
  const fmtInTz = (iso: string, opts: Intl.DateTimeFormatOptions) =>
    new Date(iso).toLocaleDateString("es-ES", { ...opts, timeZone: response.timezone });

  switch (scope) {
    case "day":
      return response.date
        ? new Date(`${response.date}T00:00:00.000Z`).toLocaleDateString("es-ES", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          })
        : "Día";
    case "week":
      if (!response.weekStart || !response.weekEnd) return "Semana";
      return `Semana del ${fmtInTz(response.weekStart, { day: "numeric", month: "short" })} al ${fmtInTz(response.weekEnd, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })}`;
    case "month":
      return response.month
        ? new Date(`${response.month}-01T00:00:00.000Z`).toLocaleDateString("es-ES", { month: "long", year: "numeric", timeZone: "UTC" })
        : "Mes";
    case "year":
      return response.year ?? "Año";
  }
}

/** "YYYY-Www" (valor nativo de `<input type="week">`) → clave Y-M-D del lunes de esa semana ISO.
 * Monday de la semana 1 = jueves 4 de enero menos (isoWeekday(4 ene) - 1) días; el resto de
 * semanas se desplazan de 7 en 7 desde ahí (definición de semana ISO 8601). */
export function isoWeekStringToMondayKey(value: string): string | null {
  const match = value.match(/^(\d{4})-W(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4IsoWeekday = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay();
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4IsoWeekday - 1));
  const targetMonday = new Date(week1Monday);
  targetMonday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  return targetMonday.toISOString().slice(0, 10);
}

/** Inverso aproximado de `isoWeekStringToMondayKey`: clave Y-M-D → "YYYY-Www" de la semana ISO
 * que la contiene, para precargar `<input type="week">` con la semana de `selected`. */
export function dateKeyToIsoWeekString(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  const target = new Date(d);
  const dayNr = (d.getUTCDay() + 6) % 7; // 0=lunes..6=domingo
  target.setUTCDate(d.getUTCDate() - dayNr + 3); // jueves de esa misma semana ISO
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstThursdayDayNr = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDayNr + 3);
  const weekNumber = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${target.getUTCFullYear()}-W${pad(weekNumber)}`;
}
