import { ChangeEvent, FormEvent, ReactNode, useMemo, useRef, useState } from "react";
import { EmptyState } from "./Feedback";
import { newId } from "../utils/id";
import { SavedPlace, TravelItineraryItem, Trip } from "../types";

// Plantilla "viajes" de las páginas personalizadas (ver CustomPagePage): un panel de control de
// viajes — formulario para añadir un viaje, cuatro indicadores y tres paneles (viaje seleccionado,
// itinerario y lugares guardados). Todo vive en `content` ({ trips, places }), sin tablas propias,
// igual que el resto de plantillas; este componente es "controlado": recibe su parte del contenido
// y devuelve el objeto completo actualizado vía `onChange`.

const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // 3MB, igual límite que el resto de imágenes de páginas
// Una foto de viaje a resolución de móvil pesa varios MB; se reduce y se recomprime antes de
// embeberla como data URL para que unas cuantas fotos no agoten el límite de tamaño del `content`
// de la página (ver CONTENT_BYTE_LIMIT en el backend).
const MAX_IMAGE_SIDE = 1200;
const ITINERARY_PREVIEW = 4;
const PLACES_PREVIEW = 3;

interface TravelContent {
  trips: Trip[];
  places: SavedPlace[];
}

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
  places: SavedPlace[];
  onChange: (content: TravelContent) => void;
}) {
  const today = todayKey();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ kind: "trip" | "place"; id: string } | null>(null);
  const [showFullItinerary, setShowFullItinerary] = useState(false);
  const [showAllPlaces, setShowAllPlaces] = useState(false);

  const [destination, setDestination] = useState("");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);

  const [activityDate, setActivityDate] = useState("");
  const [activityTitle, setActivityTitle] = useState("");
  const [placeName, setPlaceName] = useState("");

  const update = (patch: Partial<TravelContent>) => onChange({ trips, places, ...patch });

  const sortedTrips = useMemo(() => [...trips].sort((a, b) => a.startDate.localeCompare(b.startDate)), [trips]);
  const upcoming = sortedTrips.filter((t) => t.endDate >= today);
  // Sin elección explícita se enseña el próximo viaje; si ya no queda ninguno por delante, el último.
  const defaultTrip = upcoming[0] ?? sortedTrips[sortedTrips.length - 1] ?? null;
  const selected = trips.find((t) => t.id === selectedId) ?? defaultTrip;

  const itinerary = useMemo(
    () => [...(selected?.itinerary ?? [])].sort((a, b) => a.date.localeCompare(b.date)),
    [selected]
  );
  const favorites = places.filter((p) => p.favorite).length;

  const addTrip = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = destination.trim();
    if (!trimmed || !from || !to) return;
    const trip: Trip = { id: newId(), destination: trimmed, startDate: from, endDate: to < from ? from : to, itinerary: [] };
    update({ trips: [...trips, trip] });
    setSelectedId(trip.id);
    setDestination("");
  };

  const patchTrip = (id: string, patch: Partial<Trip>) =>
    update({ trips: trips.map((t) => (t.id === id ? { ...t, ...patch } : t)) });

  const removeTrip = (id: string) => {
    update({ trips: trips.filter((t) => t.id !== id) });
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

  const addPlace = (e: FormEvent) => {
    e.preventDefault();
    const name = placeName.trim();
    if (!name) return;
    update({ places: [...places, { id: newId(), name }] });
    setPlaceName("");
  };

  const patchPlace = (id: string, patch: Partial<SavedPlace>) =>
    update({ places: places.map((p) => (p.id === id ? { ...p, ...patch } : p)) });

  const removePlace = (id: string) => {
    update({ places: places.filter((p) => p.id !== id) });
    setDialog(null);
  };

  // Indicadores: el 3º y el 4º hablan del viaje seleccionado, no de "todos los viajes".
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
      value: String(places.length),
      label: "Lugares guardados",
      hint: favorites === 0 ? "Tus sitios por visitar" : `${favorites} ${favorites === 1 ? "favorito" : "favoritos"}`,
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

  const openTrip = dialog?.kind === "trip" ? trips.find((t) => t.id === dialog.id) : undefined;
  const openPlace = dialog?.kind === "place" ? places.find((p) => p.id === dialog.id) : undefined;
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
              {selected.notes && <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">{selected.notes}</p>}
              <button
                type="button"
                onClick={() => setDialog({ kind: "trip", id: selected.id })}
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

        {/* Lugares guardados (compartidos por todos los viajes) */}
        <section className="card-soft flex flex-col">
          <h3 className="mb-4 text-xs font-medium uppercase tracking-widest text-muted-foreground">Lugares guardados</h3>
          {places.length === 0 ? (
            <p className="mb-4 text-sm text-muted-foreground">Guarda aquí los sitios que quieres visitar.</p>
          ) : (
            <ul className="mb-4 space-y-3">
              {(showAllPlaces ? places : places.slice(0, PLACES_PREVIEW)).map((p) => (
                <li key={p.id} className="flex items-center gap-3">
                  <button type="button" onClick={() => setDialog({ kind: "place", id: p.id })} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left">
                    {p.imageData ? (
                      <img src={p.imageData} alt={p.name} className="size-14 shrink-0 rounded-xl object-cover" />
                    ) : (
                      <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-positive/10 text-xl" aria-hidden="true">
                        📍
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{p.name}</span>
                      {p.description && <span className="block truncate text-xs text-muted-foreground">{p.description}</span>}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => patchPlace(p.id, { favorite: !p.favorite })}
                    title={p.favorite ? "Quitar de favoritos" : "Marcar como favorito"}
                    className={`shrink-0 cursor-pointer text-lg ${p.favorite ? "text-destructive" : "text-muted-foreground/50 hover:text-destructive"}`}
                  >
                    {p.favorite ? "♥" : "♡"}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={addPlace} className="mb-4 flex gap-2">
            <input
              value={placeName}
              onChange={(e) => setPlaceName(e.target.value)}
              placeholder="Nuevo lugar…"
              className="field-input min-w-0 flex-1 px-3 py-2 text-xs"
            />
            <button type="submit" className="btn-dark px-4 py-2 text-xs">
              +
            </button>
          </form>

          {places.length > PLACES_PREVIEW && (
            <button
              type="button"
              onClick={() => setShowAllPlaces((v) => !v)}
              className="mt-auto cursor-pointer self-start rounded-full border border-primary/40 px-4 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
            >
              {showAllPlaces ? "Ver menos" : `Ver todos (${places.length})`}
            </button>
          )}
        </section>
      </div>

      {openTrip && (
        <TripDialog trip={openTrip} onChange={(patch) => patchTrip(openTrip.id, patch)} onRemove={() => removeTrip(openTrip.id)} onClose={() => setDialog(null)} />
      )}
      {openPlace && (
        <PlaceDialog place={openPlace} onChange={(patch) => patchPlace(openPlace.id, patch)} onRemove={() => removePlace(openPlace.id)} onClose={() => setDialog(null)} />
      )}
    </div>
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

function PlaceDialog({
  place,
  onChange,
  onRemove,
  onClose,
}: {
  place: SavedPlace;
  onChange: (patch: Partial<SavedPlace>) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  return (
    <DialogShell title="Lugar guardado" onClose={onClose}>
      <ImageField value={place.imageData} alt={place.name} onChange={(imageData) => onChange({ imageData })} />
      <input value={place.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="Nombre del lugar" className="field-input font-serif text-lg" />
      <textarea
        value={place.description ?? ""}
        onChange={(e) => onChange({ description: e.target.value || undefined })}
        placeholder="Por qué quieres ir, qué ver allí…"
        className="field-input min-h-[6rem] resize-y"
      />
      <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
        <input type="checkbox" checked={!!place.favorite} onChange={(e) => onChange({ favorite: e.target.checked })} />
        Favorito
      </label>
      <DeleteButton label="Eliminar lugar" onConfirm={onRemove} />
    </DialogShell>
  );
}
