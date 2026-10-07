import { api } from "../api/client";
import { SavedPlace, Trip } from "../types";

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
