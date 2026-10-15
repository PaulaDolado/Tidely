import { api } from "../api/client";
import { SavedPlace, TransportDetail, TransportType, Trip, TripAttachment } from "../types";

// Lógica de datos de la plantilla "viajes" (ver TravelPlannerTemplate), separada del componente para
// que sea fácil de razonar: normalizar el contenido guardado, elegir el viaje por defecto y
// preparar la URL/miniatura de un lugar guardado.

export interface TravelContent {
  trips: Trip[];
  // LEGADO: antes los lugares guardados eran comunes a todos los viajes de la página y vivían aquí.
  // Ahora pertenecen a cada viaje (Trip.places); este campo solo existe en páginas guardadas antes
  // del cambio y se vacía en cuanto se pliega dentro de un viaje (ver normalizeTravelContent).
  places?: SavedPlace[];
}

/** El viaje que se enseña por defecto: el próximo que aún no ha terminado (el que antes empieza); si
 * ya no queda ninguno por delante, el último. `today` en YYYY-MM-DD. */
export function pickDefaultTrip(trips: Trip[], today: string): Trip | null {
  const sorted = [...trips].sort((a, b) => a.startDate.localeCompare(b.startDate));
  return sorted.find((t) => t.endDate >= today) ?? sorted[sorted.length - 1] ?? null;
}

/**
 * Devuelve el contenido con `places` dentro de cada viaje (nunca `undefined`). Si la página es
 * antigua y aún tiene lugares sueltos en `content.places`, se pasan al viaje por defecto — es el que
 * el usuario veía al abrir la página, así que no "desaparecen" — y el campo queda vacío. Si no hay
 * viajes todavía, se conservan sueltos hasta que se cree el primero (ver addTrip en el componente).
 * Es una función pura: no guarda nada, se aplica en cada lectura y se persiste con el siguiente cambio.
 */
export function normalizeTravelContent(content: TravelContent, today: string): { trips: Trip[]; places: SavedPlace[] } {
  const legacy = content.places ?? [];
  const withPlaces = content.trips.map((t) => ({ ...t, places: t.places ?? [] }));
  if (legacy.length === 0 || withPlaces.length === 0) return { trips: withPlaces, places: legacy };

  const targetId = pickDefaultTrip(withPlaces, today)?.id;
  return {
    trips: withPlaces.map((t) => (t.id === targetId ? { ...t, places: [...t.places, ...legacy] } : t)),
    places: [],
  };
}

// Antepone https:// si no hay esquema y rechaza cualquier esquema que no sea http/https (esto se abre
// con un enlace: nada de "javascript:"). Mismo criterio que normalizeQuickAccessUrl.
export function normalizePlaceUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withProtocol = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

/** "https://www.ejemplo.com/ruta" → "ejemplo.com" (para enseñar de dónde es el marcador). */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

interface LinkPreviewResult {
  title: string | null;
  description: string | null;
  image: string | null;
  favicon: string | null;
}

/** Previsualización de una URL (título, descripción, imagen e icono) vía GET /link-preview — la
 * petición la hace el servidor porque el navegador no puede leer el <head> de una web ajena (CORS).
 * `null` si falla (sin red, sitio caído, URL privada...): guardar un lugar nunca depende de esto. */
export async function fetchLinkPreview(url: string): Promise<LinkPreviewResult | null> {
  try {
    return await api.get<LinkPreviewResult>(`/link-preview?url=${encodeURIComponent(url)}`);
  } catch {
    return null;
  }
}

// --- Archivos adjuntos y datos de las secciones del viaje (transporte, contactos, equipaje) ---

// Los archivos (tarjeta de embarque, billetes...) se guardan embebidos como data URL dentro del
// `content` de la página, igual que las fotos: el backend lo trata como JSON opaco y lo limita a
// 8.000.000 de caracteres (ver CONTENT_BYTE_LIMIT en customPagesValidators.ts). Por eso hay un tope por
// archivo y otro para el conjunto de adjuntos de la página, dejando sitio a las fotos de los viajes.
export const MAX_ATTACHMENT_BYTES = 1_500_000;
export const MAX_TOTAL_ATTACHMENT_CHARS = 4_000_000;

export const TRANSPORT_TYPES: { value: TransportType; label: string; icon: string }[] = [
  { value: "flight", label: "Vuelo", icon: "✈️" },
  { value: "train", label: "Tren", icon: "🚆" },
  { value: "bus", label: "Autobús", icon: "🚌" },
  { value: "boat", label: "Barco", icon: "⛴️" },
  { value: "car", label: "Coche", icon: "🚗" },
  { value: "other", label: "Otro", icon: "🧭" },
];

export function transportMeta(type: TransportType) {
  return TRANSPORT_TYPES.find((t) => t.value === type) ?? TRANSPORT_TYPES[TRANSPORT_TYPES.length - 1];
}

/** Caracteres que ocupan los adjuntos de transporte de todos los viajes (el límite es sobre el JSON). */
export function attachmentChars(trips: Trip[]): number {
  let total = 0;
  for (const trip of trips) {
    for (const t of trip.transport ?? []) for (const a of t.attachments ?? []) total += a.dataUrl.length;
  }
  return total;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}

/** Abre un adjunto: imágenes y PDF en otra pestaña y el resto se descarga. Chrome no deja navegar a una
 * `data:` URL desde un enlace, así que se pasa por un Blob. */
export async function openAttachment(att: TripAttachment): Promise<void> {
  const blob = await (await fetch(att.dataUrl)).blob();
  const url = URL.createObjectURL(blob);
  if (att.mime.startsWith("image/") || att.mime === "application/pdf") {
    window.open(url, "_blank", "noopener");
  } else {
    const a = document.createElement("a");
    a.href = url;
    a.download = att.name;
    a.click();
  }
  // Se libera tarde: la pestaña nueva necesita la URL viva mientras carga.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function shortDay(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

/** Horario de un trayecto: "30 nov · 08:35 → 11:05", "30 nov 22:10 → 1 dic 06:40" (llega otro día),
 * "30 nov · sale 08:35" (solo se sabe la salida) o solo "30 nov". */
export function formatTransportSchedule(t: TransportDetail): string {
  const arrivesOtherDay = !!t.arrivalDate && t.arrivalDate !== t.date;
  if (arrivesOtherDay) {
    return `${shortDay(t.date)}${t.departureTime ? ` ${t.departureTime}` : ""} → ${shortDay(t.arrivalDate as string)}${t.arrivalTime ? ` ${t.arrivalTime}` : ""}`;
  }
  if (t.departureTime && t.arrivalTime) return `${shortDay(t.date)} · ${t.departureTime} → ${t.arrivalTime}`;
  if (t.departureTime) return `${shortDay(t.date)} · sale ${t.departureTime}`;
  if (t.arrivalTime) return `${shortDay(t.date)} · llega ${t.arrivalTime}`;
  return shortDay(t.date);
}

function toMinutes(date: string, time: string): number {
  return Date.parse(`${date}T${time}:00Z`) / 60_000;
}

/** Minutos entre la llegada de `from` y la salida de `to` (negativo = la conexión no llega a tiempo);
 * `null` si falta alguna hora. */
export function layoverMinutes(from: TransportDetail, to: TransportDetail): number | null {
  if (!from.arrivalTime || !to.departureTime) return null;
  return toMinutes(to.date, to.departureTime) - toMinutes(from.arrivalDate ?? from.date, from.arrivalTime);
}

/** 80 → "1 h 20 min", 45 → "45 min", 120 → "2 h". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/**
 * Agrupa los trayectos en cadenas de conexión: cada cadena empieza en un trayecto al que NADIE apunta con
 * `nextId` y sigue los `nextId`. Las cadenas salen ordenadas por la salida de su primer trayecto. Con
 * guarda de ciclos: lo que quede sin visitar (un ciclo) se enseña como cadenas sueltas en vez de colgar.
 */
export function buildTransportChains(items: TransportDetail[]): TransportDetail[][] {
  const byId = new Map(items.map((t) => [t.id, t]));
  const referenced = new Set(items.map((t) => t.nextId).filter((id): id is string => !!id && byId.has(id)));
  const order = (a: TransportDetail, b: TransportDetail) =>
    `${a.date} ${a.departureTime ?? ""}`.localeCompare(`${b.date} ${b.departureTime ?? ""}`);
  const visited = new Set<string>();
  const chains: TransportDetail[][] = [];

  const follow = (start: TransportDetail) => {
    const chain: TransportDetail[] = [];
    let current: TransportDetail | undefined = start;
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      chain.push(current);
      current = current.nextId ? byId.get(current.nextId) : undefined;
    }
    // La segunda pasada filtra los no visitados ANTES de recorrer: en un ciclo, el segundo trayecto ya se ha
    // visitado al seguir el primero y daría una cadena vacía (y `chain[0]` revienta en TravelExtras).
    if (chain.length > 0) chains.push(chain);
  };

  [...items].filter((t) => !referenced.has(t.id)).sort(order).forEach(follow);
  [...items].filter((t) => !visited.has(t.id)).sort(order).forEach(follow);
  return chains;
}

/** Trayectos a los que `from` puede enlazarse como continuación: no él mismo, no uno que ya continúa a OTRO
 * trayecto y no uno que lo preceda en una cadena (cerraría un ciclo). */
export function transferCandidates(items: TransportDetail[], fromId: string | undefined): TransportDetail[] {
  const preceding = new Set<string>();
  if (fromId) {
    const byNext = new Map<string, string[]>();
    for (const t of items) if (t.nextId) byNext.set(t.nextId, [...(byNext.get(t.nextId) ?? []), t.id]);
    const stack = [fromId];
    while (stack.length > 0) {
      const id = stack.pop() as string;
      for (const prev of byNext.get(id) ?? []) {
        if (!preceding.has(prev)) {
          preceding.add(prev);
          stack.push(prev);
        }
      }
    }
  }
  const takenByOthers = new Set(items.filter((t) => t.nextId && t.id !== fromId).map((t) => t.nextId as string));
  return items.filter((t) => t.id !== fromId && !preceding.has(t.id) && !takenByOthers.has(t.id));
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Teléfono "razonable": solo dígitos, espacios y + - ( ) . con al menos 5 dígitos. */
export function isValidPhone(value: string): boolean {
  return /^[0-9+\-().\s]+$/.test(value) && (value.match(/\d/g) ?? []).length >= 5;
}
