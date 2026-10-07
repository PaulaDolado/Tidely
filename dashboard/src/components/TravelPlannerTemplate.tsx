import { ChangeEvent, FormEvent, ReactNode, useMemo, useRef, useState } from "react";
import { EmptyState } from "./Feedback";
import { newId } from "../utils/id";
import { fetchLinkPreview, hostnameOf, normalizePlaceUrl, normalizeTravelContent, pickDefaultTrip, TravelContent } from "../utils/travel";
import { SavedPlace, TravelItineraryItem, Trip } from "../types";

// Plantilla "viajes" de las páginas personalizadas (ver CustomPagePage): un panel de control de
// viajes — formulario para añadir un viaje, cuatro indicadores y tres paneles (viaje seleccionado,
// itinerario y lugares guardados). Todo vive en `content` ({ trips }), sin tablas propias, igual
// que el resto de plantillas; este componente es "controlado": recibe su parte del contenido y
// devuelve el objeto completo actualizado vía `onChange`.
//
// El itinerario y los lugares guardados son DEL VIAJE seleccionado (Trip.itinerary / Trip.places):
// al cambiar de viaje, los dos paneles muestran lo de ese viaje.

const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // 3MB, igual límite que el resto de imágenes de páginas
// Una foto de viaje a resolución de móvil pesa varios MB; se reduce y se recomprime antes de
// embeberla como data URL para que unas cuantas fotos no agoten el límite de tamaño del `content`
// de la página (ver CONTENT_BYTE_LIMIT en el backend).
const MAX_IMAGE_SIDE = 1200;
const ITINERARY_PREVIEW = 4;
const PLACES_PREVIEW = 4;
const PLACE_DESCRIPTION_MAX = 160;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// Las fechas del viaje son fechas de calendario (YYYY-MM-DD) sin zona horaria — se comparan como
// texto y se restan siempre en UTC, para que un cambio de hora no desplace el recuento de días.
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function diffDays(laterKey: string, earlierKey: string): number {
  return Math.round((Date.parse(`${laterKey}T00:00:00Z`) - Date.parse(`${earlierKey}T00:00:00Z`)) / 86_400_000);
}

function fmtDate(key: string, withYear = false): string {
  return new Date(`${key}T00:00:00`).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

function fmtRange(trip: Trip): string {
  return trip.startDate === trip.endDate ? fmtDate(trip.startDate, true) : `${fmtDate(trip.startDate)} – ${fmtDate(trip.endDate, true)}`;
}

function fmtMoney(n: number): string {
  return n.toLocaleString("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function readResizedImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("No se pudo leer la imagen."));
      img.onload = () => {
        const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("No se pudo procesar la imagen."));
        // Fondo blanco: un PNG con transparencia saldría negro al pasarlo a JPEG.
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export function TravelPlannerTemplate({
  trips,
  places,
  onChange,
}: {
  trips: Trip[];
  // LEGADO: lugares sueltos de páginas guardadas antes de que pertenecieran a cada viaje (ver
  // normalizeTravelContent) — se pliegan solos dentro del viaje por defecto.
  places?: SavedPlace[];
  onChange: (content: TravelContent) => void;
}) {
  const today = todayKey();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // `placeId: null` = lugar nuevo (el "+" de la cabecera de "Lugares guardados").
  const [dialog, setDialog] = useState<{ kind: "trip" } | { kind: "place"; placeId: string | null } | null>(null);
  const [showFullItinerary, setShowFullItinerary] = useState(false);
  const [showAllPlaces, setShowAllPlaces] = useState(false);

  const [destination, setDestination] = useState("");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);

  const [activityDate, setActivityDate] = useState("");
  const [activityTitle, setActivityTitle] = useState("");

  // Contenido ya con los lugares dentro de cada viaje (los antiguos, plegados en el viaje por
  // defecto) — todo lo de abajo lee de aquí, no de las props en bruto.
  const content = useMemo(() => normalizeTravelContent({ trips, places }, today), [trips, places, today]);
  const allTrips = content.trips;

  const update = (patch: Partial<TravelContent>) => onChange({ trips: allTrips, places: content.places, ...patch });

  const sortedTrips = useMemo(() => [...allTrips].sort((a, b) => a.startDate.localeCompare(b.startDate)), [allTrips]);
  const upcoming = sortedTrips.filter((t) => t.endDate >= today);
  // Sin elección explícita se enseña el viaje por defecto (el próximo; si no queda ninguno, el último).
  const selected = allTrips.find((t) => t.id === selectedId) ?? pickDefaultTrip(allTrips, today);

  const itinerary = useMemo(
    () => [...(selected?.itinerary ?? [])].sort((a, b) => a.date.localeCompare(b.date)),
    [selected]
  );
  const selectedPlaces = selected?.places ?? [];
  const favorites = selectedPlaces.filter((p) => p.favorite).length;

  const addTrip = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = destination.trim();
    if (!trimmed || !from || !to) return;
    // Los lugares sueltos de una página antigua (sin viajes hasta ahora) pasan al primer viaje.
    const trip: Trip = {
      id: newId(),
      destination: trimmed,
      startDate: from,
      endDate: to < from ? from : to,
      itinerary: [],
      places: content.places,
    };
    update({ trips: [...allTrips, trip], places: [] });
    setSelectedId(trip.id);
    setDestination("");
  };

  const patchTrip = (id: string, patch: Partial<Trip>) =>
    update({ trips: allTrips.map((t) => (t.id === id ? { ...t, ...patch } : t)) });

  const removeTrip = (id: string) => {
    update({ trips: allTrips.filter((t) => t.id !== id) });
    if (selectedId === id) setSelectedId(null);
    setDialog(null);
  };

  const addActivity = (e: FormEvent) => {
    e.preventDefault();
    const title = activityTitle.trim();
    if (!selected || !title) return;
    const item: TravelItineraryItem = { id: newId(), date: activityDate || selected.startDate, title };
    patchTrip(selected.id, { itinerary: [...selected.itinerary, item] });
    setActivityTitle("");
  };

  const removeActivity = (itemId: string) => {
    if (!selected) return;
    patchTrip(selected.id, { itinerary: selected.itinerary.filter((it) => it.id !== itemId) });
  };

  // Los lugares son del viaje seleccionado: cualquier cambio reescribe `places` de ESE viaje.
  const setPlaces = (next: SavedPlace[]) => {
    if (selected) patchTrip(selected.id, { places: next });
  };

  const savePlace = (placeId: string | null, values: Omit<SavedPlace, "id">) => {
    if (placeId === null) setPlaces([...selectedPlaces, { id: newId(), ...values }]);
    else setPlaces(selectedPlaces.map((p) => (p.id === placeId ? { ...p, ...values } : p)));
    setDialog(null);
  };

  const removePlace = (placeId: string) => {
    setPlaces(selectedPlaces.filter((p) => p.id !== placeId));
    setDialog(null);
  };

  const toggleFavorite = (placeId: string) =>
    setPlaces(selectedPlaces.map((p) => (p.id === placeId ? { ...p, favorite: !p.favorite } : p)));

  // Indicadores: el 2º, el 3º y el 4º hablan del viaje seleccionado, no de "todos los viajes".
  const daysToGo = selected ? diffDays(selected.startDate, today) : null;
  const ongoing = selected ? selected.startDate <= today && selected.endDate >= today : false;
  const stats = [
    {
      icon: "🧳",
      tone: "border-primary/30 bg-primary/10",
      value: String(upcoming.length),
      label: "Viajes próximos",
      hint: upcoming.length === 0 ? "Ninguno por delante" : `Tienes ${upcoming.length} ${upcoming.length === 1 ? "viaje planificado" : "viajes planificados"}`,
    },
    {
      icon: "📍",
      tone: "border-positive/30 bg-positive/10",
      value: String(selectedPlaces.length),
      label: "Lugares guardados",
      hint: !selected ? "Sin viaje seleccionado" : favorites > 0 ? `${plural(favorites, "favorito", "favoritos")} en ${selected.destination}` : `En ${selected.destination}`,
    },
    {
      icon: "🗓️",
      tone: "border-hobby/30 bg-hobby/10",
      value: !selected ? "—" : ongoing ? "¡Ya!" : daysToGo !== null && daysToGo > 0 ? String(daysToGo) : "—",
      label: ongoing ? "Viaje en curso" : "Días para el viaje",
      hint: !selected ? "Sin viaje seleccionado" : ongoing ? `Estás en ${selected.destination}` : daysToGo !== null && daysToGo > 0 ? `Viaje a ${selected.destination}` : "Este viaje ya terminó",
    },
    {
      icon: "💶",
      tone: "border-warning/30 bg-warning/10",
      value: selected?.budget != null ? fmtMoney(selected.budget) : "—",
      label: "Presupuesto",
      hint: selected?.budget != null ? "Total estimado" : "Sin presupuesto",
    },
  ];

  const openTrip = dialog?.kind === "trip" ? selected : undefined;
  const openPlaceId = dialog?.kind === "place" ? dialog.placeId : undefined; // undefined = diálogo cerrado
  const openPlace = openPlaceId ? selectedPlaces.find((p) => p.id === openPlaceId) : undefined;
  const tripPanelTitle = !selected ? "Próximo viaje" : selected.endDate < today ? "Último viaje" : selected.id === upcoming[0]?.id ? "Próximo viaje" : "Viaje";

  return (
    <div className="space-y-6">
      <form onSubmit={addTrip} className="card-soft">
        <h2 className="mb-4 font-serif text-xl">Planifica tu próximo destino</h2>
        <div className="grid gap-3 md:grid-cols-[1fr_170px_170px_auto]">
          <input
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="🔎 Ciudad o país…"
            className="field-input"
          />
          <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Desde
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                if (to < e.target.value) setTo(e.target.value);
              }}
              className="field-input normal-case tracking-normal text-foreground"
            />
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Hasta
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
              className="field-input normal-case tracking-normal text-foreground"
            />
          </label>
          <button type="submit" className="btn-dark self-end">
            + Añadir viaje
          </button>
        </div>

        {sortedTrips.length > 1 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {sortedTrips.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedId(t.id)}
                className={`cursor-pointer rounded-full border px-3 py-1 text-xs transition-colors ${
                  selected?.id === t.id ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {t.destination}
              </button>
            ))}
          </div>
        )}
      </form>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className={`flex items-center gap-4 rounded-3xl border p-5 ${s.tone}`}>
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-card text-2xl shadow-[var(--shadow-soft)]" aria-hidden="true">
              {s.icon}
            </span>
            <div className="min-w-0">
              <p className="truncate font-serif text-2xl leading-tight">{s.value}</p>
              <p className="truncate text-xs font-medium">{s.label}</p>
              <p className="truncate text-xs text-muted-foreground">{s.hint}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Viaje seleccionado */}
        <section className="card-soft flex flex-col">
          <h3 className="mb-4 text-xs font-medium uppercase tracking-widest text-muted-foreground">{tripPanelTitle}</h3>
          {selected ? (
            <>
              {selected.imageData ? (
                <img src={selected.imageData} alt={selected.destination} className="h-44 w-full rounded-2xl object-cover" />
              ) : (
                <div className="flex h-44 w-full items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 via-secondary/60 to-hobby/20 text-5xl" aria-hidden="true">
                  ✈️
                </div>
              )}
              <h4 className="mt-4 font-serif text-xl">{selected.destination}</h4>
              <p className="mt-1 text-xs text-muted-foreground">
                📅 {fmtRange(selected)} · {diffDays(selected.endDate, selected.startDate) + 1} {diffDays(selected.endDate, selected.startDate) === 0 ? "día" : "días"}
              </p>
              {/* El itinerario y los lugares de abajo son de ESTE viaje: aquí se ve de un vistazo
                  cuánto llevan. */}
              <p className="mt-1 text-xs text-muted-foreground">
                🗓️ {plural(itinerary.length, "actividad", "actividades")} · 📍 {plural(selectedPlaces.length, "lugar", "lugares")}
              </p>
              {selected.notes && <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">{selected.notes}</p>}
              <button
                type="button"
                onClick={() => setDialog({ kind: "trip" })}
                className="mt-auto cursor-pointer self-start rounded-full border border-primary/40 px-4 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
              >
                Ver viaje
              </button>
            </>
          ) : (
            <EmptyState message="Añade un viaje arriba para empezar a planificarlo." />
          )}
        </section>

        {/* Itinerario del viaje seleccionado */}
        <section className="card-soft flex flex-col">
          <h3 className="mb-4 text-xs font-medium uppercase tracking-widest text-muted-foreground">Mi itinerario</h3>
          {selected ? (
            <>
              {itinerary.length === 0 ? (
                <p className="mb-4 text-sm text-muted-foreground">Todavía no hay actividades. Añade la primera abajo.</p>
              ) : (
                <ul className="relative mb-4 space-y-4 border-l border-border pl-5">
                  {(showFullItinerary ? itinerary : itinerary.slice(0, ITINERARY_PREVIEW)).map((it) => (
                    <li key={it.id} className="group relative">
                      <span className="absolute -left-[26px] top-1.5 size-2.5 rounded-full border-2 border-card bg-primary" aria-hidden="true" />
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">{fmtDate(it.date)}</p>
                          <p className="text-sm font-medium">{it.title}</p>
                          {it.notes && <p className="text-xs text-muted-foreground">{it.notes}</p>}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeActivity(it.id)}
                          title="Eliminar actividad"
                          className="shrink-0 cursor-pointer text-xs opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
                        >
                          ✕
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <form onSubmit={addActivity} className="mb-4 space-y-2">
                <input
                  type="date"
                  value={activityDate || selected.startDate}
                  min={selected.startDate}
                  max={selected.endDate}
                  onChange={(e) => setActivityDate(e.target.value)}
                  className="field-input w-full px-3 py-2 text-xs"
                />
                <div className="flex gap-2">
                  <input
                    value={activityTitle}
                    onChange={(e) => setActivityTitle(e.target.value)}
                    placeholder="Nueva actividad…"
                    className="field-input min-w-0 flex-1 px-3 py-2 text-xs"
                  />
                  <button type="submit" className="btn-dark px-4 py-2 text-xs">
                    +
                  </button>
                </div>
              </form>

              {itinerary.length > ITINERARY_PREVIEW && (
                <button
                  type="button"
                  onClick={() => setShowFullItinerary((v) => !v)}
                  className="mt-auto cursor-pointer self-start rounded-full border border-primary/40 px-4 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                >
                  {showFullItinerary ? "Ver menos" : `Ver itinerario completo (${itinerary.length})`}
                </button>
              )}
            </>
          ) : (
            <EmptyState message="El itinerario aparece aquí al elegir un viaje." />
          )}
        </section>

        {/* Lugares guardados DEL viaje seleccionado: marcadores (miniatura de la URL + texto) */}
        <section className="card-soft flex flex-col">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Lugares guardados</h3>
            {selected && (
              <button
                type="button"
                onClick={() => setDialog({ kind: "place", placeId: null })}
                aria-label="Añadir lugar"
                title="Añadir lugar"
                className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full bg-foreground text-sm leading-none text-background transition-opacity hover:opacity-80"
              >
                +
              </button>
            )}
          </div>

          {!selected ? (
            <EmptyState message="Los lugares guardados aparecen aquí al elegir un viaje." />
          ) : selectedPlaces.length === 0 ? (
            <p className="text-sm text-muted-foreground">Guarda aquí los sitios de {selected.destination} que quieres visitar, con su enlace.</p>
          ) : (
            <ul className="space-y-1">
              {(showAllPlaces ? selectedPlaces : selectedPlaces.slice(0, PLACES_PREVIEW)).map((p) => (
                <PlaceBookmark
                  key={p.id}
                  place={p}
                  onEdit={() => setDialog({ kind: "place", placeId: p.id })}
                  onToggleFavorite={() => toggleFavorite(p.id)}
                />
              ))}
            </ul>
          )}

          {selectedPlaces.length > PLACES_PREVIEW && (
            <button
              type="button"
              onClick={() => setShowAllPlaces((v) => !v)}
              className="mt-4 cursor-pointer self-start rounded-full border border-primary/40 px-4 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
            >
              {showAllPlaces ? "Ver menos" : `Ver todos (${selectedPlaces.length})`}
            </button>
          )}
        </section>
      </div>

      {openTrip && (
        <TripDialog trip={openTrip} onChange={(patch) => patchTrip(openTrip.id, patch)} onRemove={() => removeTrip(openTrip.id)} onClose={() => setDialog(null)} />
      )}
      {openPlaceId !== undefined && selected && (openPlaceId === null || openPlace) && (
        <PlaceDialog
          key={openPlaceId ?? "new"}
          place={openPlace}
          onSave={(values) => savePlace(openPlaceId, values)}
          onRemove={openPlace ? () => removePlace(openPlace.id) : undefined}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

// Miniatura del marcador: la imagen de la página y, si no hay o no carga, su icono; sin ninguno de
// los dos (o sin URL), un 📍. `imageData` es la foto subida a mano de los lugares antiguos.
function PlaceThumb({ place }: { place: SavedPlace }) {
  const sources = [
    ...(place.imageData ? [{ src: place.imageData, icon: false }] : []),
    ...(place.thumbnailUrl ? [{ src: place.thumbnailUrl, icon: false }] : []),
    ...(place.faviconUrl ? [{ src: place.faviconUrl, icon: true }] : []),
  ];
  const [failed, setFailed] = useState(0);
  const current = sources[failed];

  return (
    <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-positive/10 text-xl">
      {current ? (
        <img
          src={current.src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed((n) => n + 1)}
          // Un favicon es diminuto: se centra con margen en vez de estirarlo a todo el cuadrado.
          className={current.icon ? "size-7 object-contain" : "size-full object-cover"}
        />
      ) : (
        <span aria-hidden="true">📍</span>
      )}
    </span>
  );
}

// Un lugar guardado como marcador: miniatura a la izquierda y el texto al lado. Con URL, todo el
// marcador es un enlace que la abre en otra pestaña; sin ella, abre la edición. El corazón y el
// lápiz van aparte, a la derecha.
function PlaceBookmark({
  place,
  onEdit,
  onToggleFavorite,
}: {
  place: SavedPlace;
  onEdit: () => void;
  onToggleFavorite: () => void;
}) {
  const body = (
    <>
      <PlaceThumb place={place} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{place.name}</span>
        {place.description && <span className="line-clamp-2 block text-xs text-muted-foreground">{place.description}</span>}
        {place.url && <span className="block truncate text-[10px] text-muted-foreground/70">{hostnameOf(place.url)}</span>}
      </span>
    </>
  );
  const rowClass = "flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1.5 text-left transition-colors hover:bg-muted/60";

  return (
    <li className="group flex items-center gap-1">
      {place.url ? (
        <a href={place.url} target="_blank" rel="noopener noreferrer" title={place.url} className={rowClass}>
          {body}
        </a>
      ) : (
        <button type="button" onClick={onEdit} className={`${rowClass} cursor-pointer`}>
          {body}
        </button>
      )}
      <button
        type="button"
        onClick={onToggleFavorite}
        title={place.favorite ? "Quitar de favoritos" : "Marcar como favorito"}
        className={`shrink-0 cursor-pointer text-lg ${place.favorite ? "text-destructive" : "text-muted-foreground/50 hover:text-destructive"}`}
      >
        {place.favorite ? "♥" : "♡"}
      </button>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Editar ${place.name}`}
        title="Editar"
        className="shrink-0 cursor-pointer rounded p-1 text-xs text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus:opacity-100 group-hover:opacity-100"
      >
        ✎
      </button>
    </li>
  );
}

function DialogShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-foreground/50 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[90vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-3xl bg-card p-6 shadow-[var(--shadow-soft)] sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <h2 className="font-serif text-2xl">{title}</h2>
          <button type="button" onClick={onClose} title="Cerrar" className="cursor-pointer rounded-lg p-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ImageField({ value, alt, onChange }: { value?: string | null; alt: string; onChange: (imageData: string | null) => void }) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    if (file.size > MAX_IMAGE_BYTES * 4) {
      window.alert("La imagen es demasiado grande.");
      return;
    }
    setUploading(true);
    try {
      onChange(await readResizedImage(file));
    } catch {
      window.alert("No se pudo cargar esa imagen.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      {value ? (
        <div className="relative overflow-hidden rounded-2xl">
          <img src={value} alt={alt} className="h-44 w-full object-cover" />
          <div className="absolute right-2 top-2 flex gap-1">
            <button type="button" onClick={() => inputRef.current?.click()} className="cursor-pointer rounded-lg bg-background/80 px-2 py-1 text-xs font-medium shadow-sm hover:bg-background">
              Cambiar
            </button>
            <button type="button" onClick={() => onChange(null)} className="cursor-pointer rounded-lg bg-background/80 px-2 py-1 text-xs font-medium text-destructive shadow-sm hover:bg-background">
              Quitar
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex h-32 w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-primary/30 text-sm text-muted-foreground hover:bg-primary/5"
        >
          <span className="text-2xl" aria-hidden="true">
            🖼️
          </span>
          {uploading ? "Cargando..." : "Añadir foto"}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function DeleteButton({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  // Confirmación "clic otra vez" (no window.confirm), igual que "Eliminar tarjeta"/"Eliminar página".
  const [confirming, setConfirming] = useState(false);
  return (
    <button
      type="button"
      onClick={() => (confirming ? onConfirm() : setConfirming(true))}
      onBlur={() => setConfirming(false)}
      className={`cursor-pointer self-start rounded-full px-4 py-2 text-xs transition-colors ${
        confirming ? "bg-destructive text-destructive-foreground" : "border border-border text-muted-foreground hover:text-destructive"
      }`}
    >
      {confirming ? "¿Confirmar eliminar?" : label}
    </button>
  );
}

function TripDialog({
  trip,
  onChange,
  onRemove,
  onClose,
}: {
  trip: Trip;
  onChange: (patch: Partial<Trip>) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  // Texto local para el presupuesto: convertir a número en cada tecla se comería escrituras
  // intermedias como "12." o el campo vacío.
  const [budgetText, setBudgetText] = useState(trip.budget != null ? String(trip.budget) : "");

  return (
    <DialogShell title="Tu viaje" onClose={onClose}>
      <ImageField value={trip.imageData} alt={trip.destination} onChange={(imageData) => onChange({ imageData })} />
      <input
        value={trip.destination}
        onChange={(e) => onChange({ destination: e.target.value })}
        placeholder="Destino"
        className="field-input font-serif text-lg"
      />
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          Desde
          <input
            type="date"
            value={trip.startDate}
            onChange={(e) => e.target.value && onChange({ startDate: e.target.value, ...(trip.endDate < e.target.value ? { endDate: e.target.value } : {}) })}
            className="field-input normal-case tracking-normal text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          Hasta
          <input
            type="date"
            value={trip.endDate}
            min={trip.startDate}
            onChange={(e) => e.target.value && onChange({ endDate: e.target.value })}
            className="field-input normal-case tracking-normal text-foreground"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        Presupuesto estimado (€)
        <input
          type="number"
          min={0}
          step="0.01"
          value={budgetText}
          onChange={(e) => {
            setBudgetText(e.target.value);
            const n = Number(e.target.value);
            onChange({ budget: e.target.value.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : null });
          }}
          placeholder="Sin presupuesto"
          className="field-input normal-case tracking-normal text-foreground"
        />
      </label>
      <textarea
        value={trip.notes ?? ""}
        onChange={(e) => onChange({ notes: e.target.value || undefined })}
        placeholder="Notas del viaje: alojamiento, vuelos, ideas…"
        className="field-input min-h-[7rem] resize-y"
      />
      <DeleteButton label="Eliminar viaje" onConfirm={onRemove} />
    </DialogShell>
  );
}

// Alta/edición de un lugar guardado: nombre, URL y descripción. Al guardar con URL se pide su
// previsualización (miniatura, y título/descripción si faltan) — ver fetchLinkPreview; si falla, el
// lugar se guarda igual, solo que sin miniatura.
function PlaceDialog({
  place,
  onSave,
  onRemove,
  onClose,
}: {
  place?: SavedPlace; // undefined = lugar nuevo
  onSave: (values: Omit<SavedPlace, "id">) => void;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(place?.name ?? "");
  const [url, setUrl] = useState(place?.url ?? "");
  const [description, setDescription] = useState(place?.description ?? "");
  const [favorite, setFavorite] = useState(!!place?.favorite);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const rawUrl = url.trim();
    const normalizedUrl = rawUrl ? normalizePlaceUrl(rawUrl) : null;
    if (rawUrl && !normalizedUrl) {
      setError("La URL no es válida. Usa una dirección http o https.");
      return;
    }
    if (!name.trim() && !normalizedUrl) {
      setError("Ponle un nombre o una URL al lugar.");
      return;
    }

    setSaving(true);
    let thumbnailUrl = place?.thumbnailUrl;
    let faviconUrl = place?.faviconUrl;
    let fallbackName = "";
    let fallbackDescription = "";

    if (!normalizedUrl) {
      thumbnailUrl = undefined;
      faviconUrl = undefined;
    } else if (normalizedUrl !== place?.url || (!thumbnailUrl && !faviconUrl)) {
      const preview = await fetchLinkPreview(normalizedUrl);
      thumbnailUrl = preview?.image ?? undefined;
      faviconUrl = preview?.favicon ?? undefined;
      fallbackName = preview?.title?.trim() || "";
      fallbackDescription = preview?.description?.trim() || "";
    }

    onSave({
      name: name.trim() || fallbackName || (normalizedUrl ? hostnameOf(normalizedUrl) : ""),
      url: normalizedUrl ?? undefined,
      description: description.trim() || fallbackDescription.slice(0, PLACE_DESCRIPTION_MAX) || undefined,
      thumbnailUrl,
      faviconUrl,
      imageData: place?.imageData ?? null,
      favorite,
    });
  };

  return (
    <DialogShell title={place ? "Editar lugar" : "Nuevo lugar"} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del lugar" className="field-input font-serif text-lg" />
        <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          Dirección (URL)
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            inputMode="url"
            className="field-input normal-case tracking-normal text-foreground"
          />
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Descripción: por qué quieres ir, qué ver allí…"
          className="field-input min-h-[6rem] resize-y"
        />
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} />
          Favorito
        </label>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving} className="btn-dark disabled:opacity-50">
            {saving ? "Guardando…" : "Guardar"}
          </button>
          <button type="button" onClick={onClose} className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            Cancelar
          </button>
          {onRemove && (
            <span className="ml-auto">
              <DeleteButton label="Eliminar lugar" onConfirm={onRemove} />
            </span>
          )}
        </div>
      </form>
    </DialogShell>
  );
}
