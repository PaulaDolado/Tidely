import { api } from "../api/client";
import { SavedPlace, TravelContent, Trip } from "../api/customPages";

// Lógica de datos de la plantilla "viajes" (ver components/TravelPlanner.tsx) — mismo criterio que
// dashboard/src/utils/travel.ts.

/** El viaje que se enseña por defecto: el próximo que aún no ha terminado; si no queda ninguno, el
 * último. `today` en YYYY-MM-DD. */
export function pickDefaultTrip(trips: Trip[], today: string): Trip | null {
  const sorted = [...trips].sort((a, b) => a.startDate.localeCompare(b.startDate));
  return sorted.find((t) => t.endDate >= today) ?? sorted[sorted.length - 1] ?? null;
}

/** Devuelve el contenido con `places` dentro de cada viaje. Los lugares sueltos de una página antigua
 * (`content.places`) pasan al viaje por defecto, que es el que el usuario veía al abrirla. Pura: no
 * guarda nada, se aplica en cada lectura y se persiste con el siguiente cambio. */
export function normalizeTravelContent(content: TravelContent, today: string): { trips: Trip[]; places: SavedPlace[] } {
  const legacy = content.places ?? [];
  const withPlaces = (content.trips ?? []).map((t) => ({ ...t, places: t.places ?? [] }));
  if (legacy.length === 0 || withPlaces.length === 0) return { trips: withPlaces, places: legacy };

  const targetId = pickDefaultTrip(withPlaces, today)?.id;
  return {
    trips: withPlaces.map((t) => (t.id === targetId ? { ...t, places: [...t.places, ...legacy] } : t)),
    places: [],
  };
}

// Antepone https:// si falta el esquema y rechaza todo lo que no sea http/https. Sin `new URL(...)`:
// Hermes no trae ese global (ver normalizeQuickAccessUrl).
export function normalizePlaceUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const withProtocol = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  return /^https?:\/\/[^/?#]+/i.test(withProtocol) ? withProtocol : null;
}

/** "https://www.ejemplo.com/ruta" → "ejemplo.com". */
export function hostnameOf(url: string): string {
  const match = /^https?:\/\/([^/?#]+)/i.exec(url);
  return match ? match[1].replace(/^www\./i, "") : url;
}

interface LinkPreviewResult {
  title: string | null;
  description: string | null;
  image: string | null;
  favicon: string | null;
}

/** Previsualización de una URL vía GET /link-preview; `null` si falla (guardar nunca depende de ella). */
export async function fetchLinkPreview(url: string): Promise<LinkPreviewResult | null> {
  try {
    return await api.get<LinkPreviewResult>(`/link-preview?url=${encodeURIComponent(url)}`);
  } catch {
    return null;
  }
}
