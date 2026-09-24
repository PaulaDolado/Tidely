// Puerto de dashboard/src/utils/agendaExport.ts — misma construcción de .ics y del HTML para el
// PDF (pura, sin DOM), pero sobre las ocurrencias YA EXPANDIDAS localmente (ver
// eventsRepo.listExpandedEvents), no contra `/agenda/export/:scope/:date`: los eventos del móvil
// son offline-first (SQLite + sync), así que exportar lo que hay en el propio dispositivo es más
// fiel a lo que el usuario ve en pantalla que pedirle al backend solo lo YA sincronizado. Tampoco
// hay un `timezone` de cuenta que convertir (ver el mismo comentario en AgendaScreen.tsx): se usa
// la hora local del dispositivo directamente, igual que el resto de la pantalla.

import { EventOccurrence } from "./recurrence";
import { ParsedEvent } from "../db/eventsRepo";
import { EventCategory } from "../types";
import { eventCategoryLabel } from "./eventCategories";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatIcsDate(date: Date): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function escapeIcsText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

// Igual que foldLine en src/utils/ics.ts del backend (RFC 5545 §3.1): pliega a 75 octetos con
// continuación indentada, algunos clientes truncan o rechazan líneas más largas.
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

export function buildIcsFromOccurrences(occurrences: EventOccurrence<ParsedEvent>[]): string {
  const lines: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Tidely//Agenda//ES", "CALSCALE:GREGORIAN"];
  const stamp = formatIcsDate(new Date());

  for (const occ of occurrences) {
    lines.push("BEGIN:VEVENT");
    lines.push(foldLine(`UID:event-${occ.event.id}-${formatIcsDate(occ.startTime)}@tidely.local`));
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${formatIcsDate(occ.startTime)}`);
    lines.push(`DTEND:${formatIcsDate(occ.endTime)}`);
    lines.push(foldLine(`SUMMARY:${escapeIcsText(occ.event.title)}`));
    if (occ.event.description) lines.push(foldLine(`DESCRIPTION:${escapeIcsText(occ.event.description)}`));
    if (occ.event.location) lines.push(foldLine(`LOCATION:${escapeIcsText(occ.event.location)}`));
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function dateKeyOfLocal(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Mismo enfoque que dashboard/src/utils/agendaExport.ts (agrupar por día, una tabla por día) pero
// generando el HTML directamente para expo-print en vez de imprimir un iframe — ver
// exportHtmlToPdf en fileExport.ts.
export function buildAgendaPdfHtml(title: string, subtitle: string, occurrences: EventOccurrence<ParsedEvent>[], categories: EventCategory[]): string {
  const byDay = new Map<string, EventOccurrence<ParsedEvent>[]>();
  for (const occ of occurrences) {
    const key = dateKeyOfLocal(occ.startTime);
    const list = byDay.get(key) ?? [];
    list.push(occ);
    byDay.set(key, list);
  }
  const days = Array.from(byDay.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  const bodyHtml =
    days.length === 0
      ? `<p class="empty">No hay eventos en este periodo.</p>`
      : days
          .map(([dateKey, dayOccurrences]) => {
            const dayLabel = new Date(`${dateKey}T00:00:00`).toLocaleDateString("es-ES", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            });
            const rows = [...dayOccurrences]
              .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
              .map((occ) => {
                const start = occ.startTime.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
                const end = occ.endTime.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
                return `
                  <tr>
                    <td class="time">${start} – ${end}</td>
                    <td>
                      <div class="event-title">${escapeHtml(occ.event.title)}</div>
                      <div class="event-meta">${escapeHtml(eventCategoryLabel(categories, occ.event))}${occ.event.location ? ` · ${escapeHtml(occ.event.location)}` : ""}</div>
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

  return `<!DOCTYPE html>
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
</html>`;
}
