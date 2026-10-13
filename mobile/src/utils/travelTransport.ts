import { TransportDetail } from "../api/customPages";

// Utilidades puras de "Detalles del transporte": cadenas de tramos con transbordo, escala entre dos
// tramos, texto del horario y qué tramos se pueden enlazar. Sin React ni Intl para que se puedan probar
// sueltas y den el mismo texto en cualquier dispositivo (Hermes no siempre trae los datos de es-ES).

const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "2026-11-30" -> "30 nov". Si la clave no es válida se devuelve tal cual. */
export function shortDay(key: string): string {
  const [, month, day] = key.split("-").map(Number);
  if (!Number.isFinite(month) || !Number.isFinite(day) || month < 1 || month > 12) return key;
  return `${day} ${MONTHS_ES[month - 1]}`;
}

function compareLegs(a: TransportDetail, b: TransportDetail): number {
  return a.date.localeCompare(b.date) || (a.departureTime ?? "").localeCompare(b.departureTime ?? "");
}

/**
 * Agrupa los tramos del viaje en cadenas: cada cadena empieza en un tramo al que no apunta el `nextId`
 * de ningún otro y sigue por `nextId`. Un conjunto de visitados evita bucles (datos corruptos o dos
 * tramos que se apuntan entre sí) y los tramos que queden sin visitar forman cadenas propias para no
 * perderlos nunca de la lista.
 */
export function buildTransportChains(legs: TransportDetail[]): TransportDetail[][] {
  const byId = new Map(legs.map((d) => [d.id, d]));
  // Un tramo que se apunta a sí mismo no cuenta como "continuación de otro": sigue siendo inicio.
  const referenced = new Set<string>();
  for (const d of legs) if (d.nextId && d.nextId !== d.id && byId.has(d.nextId)) referenced.add(d.nextId);

  const visited = new Set<string>();
  const follow = (start: TransportDetail): TransportDetail[] => {
    const chain: TransportDetail[] = [];
    let cur: TransportDetail | undefined = start;
    while (cur && !visited.has(cur.id)) {
      visited.add(cur.id);
      chain.push(cur);
      cur = cur.nextId ? byId.get(cur.nextId) : undefined;
    }
    return chain;
  };

  const chains: TransportDetail[][] = [];
  for (const start of legs.filter((d) => !referenced.has(d.id)).sort(compareLegs)) {
    const chain = follow(start);
    if (chain.length > 0) chains.push(chain);
  }
  for (const rest of legs.filter((d) => !visited.has(d.id)).sort(compareLegs)) {
    const chain = follow(rest);
    if (chain.length > 0) chains.push(chain);
  }
  return chains;
}

function toMs(date: string, time: string | undefined): number | null {
  if (!time) return null;
  // En UTC a propósito: solo se restan dos instantes del mismo "reloj de pared", sin cambios de hora.
  const ms = Date.parse(`${date}T${time}:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Minutos entre la llegada de `from` (su fecha de llegada, o la de salida si no tiene, + hora de llegada)
 * y la salida de `to`. Negativo = la conexión no llega a tiempo. null si falta alguna de las dos horas.
 */
export function layoverMinutes(from: TransportDetail, to: TransportDetail): number | null {
  const arrival = toMs(from.arrivalDate ?? from.date, from.arrivalTime);
  const departure = toMs(to.date, to.departureTime);
  if (arrival === null || departure === null) return null;
  return Math.round((departure - arrival) / 60_000);
}

/** 80 -> "1 h 20 min", 120 -> "2 h", 45 -> "45 min". */
export function formatLayover(minutes: number): string {
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Horario de un tramo: "30 nov · 08:35 → 11:05", "30 nov 22:10 → 1 dic 06:40", "30 nov · sale 08:35" o "30 nov". */
export function formatSchedule(d: TransportDetail): string {
  const day = shortDay(d.date);
  const otherDay = !!d.arrivalDate && d.arrivalDate !== d.date;
  if (otherDay) {
    const left = d.departureTime ? `${day} ${d.departureTime}` : day;
    const right = d.arrivalTime ? `${shortDay(d.arrivalDate as string)} ${d.arrivalTime}` : shortDay(d.arrivalDate as string);
    return `${left} → ${right}`;
  }
  if (d.departureTime && d.arrivalTime) return `${day} · ${d.departureTime} → ${d.arrivalTime}`;
  if (d.departureTime) return `${day} · sale ${d.departureTime}`;
  if (d.arrivalTime) return `${day} · llega ${d.arrivalTime}`;
  return day;
}

/**
 * Error de coherencia entre fechas y horas de un tramo, o null si está bien. La llegada nunca puede ser
 * anterior a la salida: ni por fecha, ni —en el mismo día— por hora.
 */
export function validateTransportTimes(v: { date: string; departureTime?: string; arrivalDate?: string; arrivalTime?: string }): string | null {
  if (v.arrivalDate && v.arrivalDate < v.date) return "La fecha de llegada no puede ser anterior a la de salida.";
  const sameDay = !v.arrivalDate || v.arrivalDate === v.date;
  if (sameDay && v.departureTime && v.arrivalTime && v.arrivalTime < v.departureTime) return "La llegada no puede ser anterior a la salida.";
  return null;
}

/**
 * Tramos que puede elegir `currentId` como continuación ("Continúa con"). Se excluyen: él mismo, los que
 * ya son la continuación de OTRO tramo (cada tramo tiene como mucho un anterior) y todos los que lo
 * preceden en una cadena (enlazarlos cerraría un ciclo). `previousId` es el tramo del que viene un
 * transporte recién creado desde "Crear transporte de conexión": aún no está enlazado en los datos
 * (se enlaza al guardar), pero ya cuenta como su antecesor.
 */
export function linkCandidates(legs: TransportDetail[], currentId?: string, previousId?: string): TransportDetail[] {
  const ancestors = new Set<string>();
  const queue: string[] = [];
  if (currentId) queue.push(currentId);
  if (previousId) {
    ancestors.add(previousId);
    queue.push(previousId);
  }
  // Sube por los tramos cuyo nextId apunta a alguno de la cola; el conjunto evita bucles.
  const seen = new Set<string>(queue);
  while (queue.length > 0) {
    const id = queue.shift() as string;
    for (const d of legs) {
      if (d.nextId === id && !seen.has(d.id)) {
        seen.add(d.id);
        ancestors.add(d.id);
        queue.push(d.id);
      }
    }
  }
  const takenByOther = new Set<string>();
  for (const d of legs) if (d.nextId && d.id !== currentId) takenByOther.add(d.nextId);
  return legs
    .filter((d) => d.id !== currentId && !ancestors.has(d.id) && !takenByOther.has(d.id))
    .sort(compareLegs);
}
