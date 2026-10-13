import { useMemo, useState } from "react";
import { View, Pressable, ScrollView, StyleSheet, Modal, Image, Alert, Platform, KeyboardAvoidingView, Linking } from "react-native";
import { Text, TextInput } from "./AppText";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import DateTimePicker, { DateTimePickerChangeEvent } from "@react-native-community/datetimepicker";
import { PackingItem, SavedPlace, TransportDetail, TransportType, TravelContent, TravelItineraryItem, Trip, TripAttachment, TripContact } from "../api/customPages";
import { fetchLinkPreview, hostnameOf, normalizePlaceUrl, normalizeTravelContent, pickDefaultTrip } from "../utils/travel";
import { attachmentChars, openAttachment, pickAttachment, totalAttachmentChars } from "../utils/travelFiles";
import { buildTransportChains, formatLayover, formatSchedule, layoverMinutes, linkCandidates, shortDay, validateTransportTimes } from "../utils/travelTransport";
import { colors, fonts, radius, shadow, withAlpha } from "../theme";

// Plantilla "viajes" de las páginas personalizadas — puerto de
// dashboard/src/components/TravelPlannerTemplate.tsx: formulario para añadir un viaje, cuatro
// indicadores y tres bloques (viaje seleccionado, itinerario y lugares guardados), apilados en una
// sola columna en vez de la rejilla de escritorio. Simplificaciones deliberadas frente a la web: el
// texto de un viaje/lugar se edita en un diálogo con botón "Guardar" (igual que el resto de
// editores del móvil, ver KanbanCardForm), no al vuelo en cada tecla.
//
// El itinerario y los lugares guardados son DEL viaje seleccionado (Trip.itinerary / Trip.places).

const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // igual límite que el resto de imágenes de páginas
const ITINERARY_PREVIEW = 4;
const PLACES_PREVIEW = 4;
const PLACE_DESCRIPTION_MAX = 160;

// Tipos de transporte: el icono y la etiqueta salen de aquí (la etiqueta también es el título por defecto).
const TRANSPORT_TYPES: { value: TransportType; icon: string; label: string }[] = [
  { value: "flight", icon: "✈️", label: "Vuelo" },
  { value: "train", icon: "🚆", label: "Tren" },
  { value: "bus", icon: "🚌", label: "Autobús" },
  { value: "boat", icon: "⛴️", label: "Barco" },
  { value: "car", icon: "🚗", label: "Coche" },
  { value: "other", icon: "🧭", label: "Otro" },
];
function transportMeta(type: TransportType) {
  return TRANSPORT_TYPES.find((t) => t.value === type) ?? TRANSPORT_TYPES[TRANSPORT_TYPES.length - 1];
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Teléfono "suelto": solo dígitos, espacios y + - ( ) . con al menos 5 dígitos.
function isValidPhone(phone: string): boolean {
  return /^[0-9\s+\-().]+$/.test(phone) && phone.replace(/\D/g, "").length >= 5;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// Fechas de calendario (YYYY-MM-DD) sin zona horaria, como en la web: se convierten a un Date
// LOCAL a mediodía solo para el selector de fecha (así ningún cambio de hora las desplaza de día) y
// se leen de vuelta con los getters locales.
function keyToDate(key: string): Date {
  return new Date(`${key}T12:00:00`);
}
function dateToKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function todayKey(): string {
  return dateToKey(new Date());
}
function diffDays(laterKey: string, earlierKey: string): number {
  return Math.round((Date.parse(`${laterKey}T00:00:00Z`) - Date.parse(`${earlierKey}T00:00:00Z`)) / 86_400_000);
}
// Las claves YYYY-MM-DD se comparan bien como texto.
function clampDateKey(key: string, min: string, max: string): string {
  return key < min ? min : key > max ? max : key;
}

function fmtDate(key: string, withYear = false): string {
  return keyToDate(key).toLocaleDateString("es-ES", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
}
function fmtRange(trip: Trip): string {
  return trip.startDate === trip.endDate ? fmtDate(trip.startDate, true) : `${fmtDate(trip.startDate)} – ${fmtDate(trip.endDate, true)}`;
}
function fmtMoney(n: number): string {
  return n.toLocaleString("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
// Precio por persona: con céntimos fijos cuando los hay ("3,10 €", no "3,1 €"), sin ellos si es entero.
function fmtPrice(n: number): string {
  return n.toLocaleString("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
}

// La web reduce cada foto a 1200 px de lado máximo y JPEG 0.82 antes de embeberla (readResizedImage en
// TravelPlannerTemplate.tsx) para no pasarse de los 8 MB de `content` por página (ver
// CONTENT_BYTE_LIMIT en src/validators/customPagesValidators.ts). Aquí no hay forma de reducir las
// dimensiones sin una dependencia nueva (expo-image-manipulator no está instalado y expo-image-
// picker no tiene opción de tamaño máximo), así que se compensa con más compresión JPEG que el
// resto de imágenes de páginas y manteniendo el tope de 3 MB por foto.
const TRIP_IMAGE_QUALITY = 0.4;

async function pickImageData(): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    Alert.alert("Permiso necesario", "Activa el acceso a tus fotos para añadir una imagen.");
    return null;
  }
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], base64: true, quality: TRIP_IMAGE_QUALITY });
  if (result.canceled || !result.assets[0]?.base64) return null;
  const base64 = result.assets[0].base64;
  if (base64.length * 0.75 > MAX_IMAGE_BYTES) {
    Alert.alert("Imagen demasiado grande", "El límite es de 3 MB por imagen. Prueba con una foto más pequeña.");
    return null;
  }
  return `data:image/jpeg;base64,${base64}`;
}

/** Botón con la fecha actual que abre el selector nativo al tocarlo. */
function DateField({
  label,
  value,
  onChange,
  compact,
  min,
  max,
  emptyLabel,
  pickerStart,
  onClear,
}: {
  label?: string;
  value: string;
  onChange: (key: string) => void;
  compact?: boolean;
  // Límites opcionales (claves YYYY-MM-DD) del selector nativo — ver la fecha de las actividades del
  // itinerario, que solo puede caer dentro del viaje.
  min?: string;
  max?: string;
  // Fecha opcional (la de llegada de un transporte): con `value` vacío se muestra `emptyLabel`, el
  // selector abre en `pickerStart` y, con una fecha elegida, "Quitar fecha" la vacía.
  emptyLabel?: string;
  pickerStart?: string;
  onClear?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={compact ? undefined : { flex: 1 }}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <Pressable style={styles.dateButton} onPress={() => setOpen(true)}>
        <Text style={styles.dateButtonText}>📅 {value ? fmtDate(value, true) : (emptyLabel ?? "Sin fecha")}</Text>
      </Pressable>
      {value && onClear ? (
        <Pressable onPress={onClear} hitSlop={6}>
          <Text style={styles.removeText}>Quitar fecha</Text>
        </Pressable>
      ) : null}
      {open && (
        <DateTimePicker
          value={keyToDate(value || pickerStart || todayKey())}
          mode="date"
          minimumDate={min ? keyToDate(min) : undefined}
          maximumDate={max ? keyToDate(max) : undefined}
          display={Platform.OS === "ios" ? "inline" : "default"}
          onValueChange={(_event: DateTimePickerChangeEvent, selected: Date) => {
            setOpen(false);
            if (selected) onChange(dateToKey(selected));
          }}
          onDismiss={() => setOpen(false)}
        />
      )}
    </View>
  );
}

export function TravelPlannerEditor({ content, onChange }: { content: TravelContent; onChange: (next: TravelContent) => Promise<void> }) {
  const insets = useSafeAreaInsets();
  const today = todayKey();
  // Lugares ya dentro de cada viaje (los sueltos de una página antigua, plegados en el viaje por defecto).
  const normalized = useMemo(() => normalizeTravelContent(content, today), [content, today]);
  const trips = normalized.trips;
  const legacyPlaces = normalized.places;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingTripId, setEditingTripId] = useState<string | null>(null);
  // "new" = lugar nuevo (el "+" de la cabecera de "Lugares guardados").
  const [editingPlaceId, setEditingPlaceId] = useState<string | "new" | null>(null);
  const [showFullItinerary, setShowFullItinerary] = useState(false);
  const [showAllPlaces, setShowAllPlaces] = useState(false);

  const [destination, setDestination] = useState("");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  // "new" = entrada nueva del itinerario (el "+" de la cabecera de "Mi itinerario").
  const [editingItemId, setEditingItemId] = useState<string | "new" | null>(null);
  // "Qué empacar": el campo de texto en línea se abre con el "+" y se queda abierto para ir anotando seguido.
  const [packingOpen, setPackingOpen] = useState(false);
  const [packingDraft, setPackingDraft] = useState("");
  // "new" = entrada nueva (el "+" de la cabecera de cada bloque).
  const [editingTransportId, setEditingTransportId] = useState<string | "new" | null>(null);
  const [editingContactId, setEditingContactId] = useState<string | "new" | null>(null);
  // "Crear transporte de conexión": el formulario nuevo que se abre justo después de guardar un tramo
  // sabe de qué tramo viene (para enlazarlo al guardar) y arranca en la fecha de llegada de ese tramo.
  // `transportFormSeq` cambia la `key` del formulario: si no, "new" tras "new" reutilizaría el estado.
  const [connectFromId, setConnectFromId] = useState<string | null>(null);
  const [connectDate, setConnectDate] = useState<string | null>(null);
  const [transportFormSeq, setTransportFormSeq] = useState(0);

  const update = (patch: Partial<TravelContent>) => onChange({ trips, places: legacyPlaces, ...patch });

  const sortedTrips = useMemo(() => [...trips].sort((a, b) => a.startDate.localeCompare(b.startDate)), [trips]);
  const upcoming = sortedTrips.filter((t) => t.endDate >= today);
  const selected = trips.find((t) => t.id === selectedId) ?? pickDefaultTrip(trips, today);
  const itinerary = useMemo(() => [...(selected?.itinerary ?? [])].sort((a, b) => a.date.localeCompare(b.date)), [selected]);
  const places = selected?.places ?? [];
  const favorites = places.filter((p) => p.favorite).length;
  const packing = selected?.packing ?? [];
  const packedCount = packing.filter((p) => p.packed).length;
  const transport = useMemo(() => selected?.transport ?? [], [selected]);
  // Cada transbordo es OTRO transporte del viaje enlazado con `nextId`: se pintan agrupados en cadenas.
  const transportChains = useMemo(() => buildTransportChains(transport), [transport]);
  const contacts = selected?.contacts ?? [];

  const addTrip = async () => {
    const trimmed = destination.trim();
    if (!trimmed) return;
    // Si la página aún no tiene viajes, sus lugares sueltos pasan al primero.
    const trip: Trip = { id: Crypto.randomUUID(), destination: trimmed, startDate: from, endDate: to < from ? from : to, itinerary: [], places: legacyPlaces };
    setSelectedId(trip.id);
    setDestination("");
    await update({ trips: [...trips, trip], places: [] });
  };

  const patchTrip = (id: string, patch: Partial<Trip>) => update({ trips: trips.map((t) => (t.id === id ? { ...t, ...patch } : t)) });

  const removeTrip = async (id: string) => {
    if (selectedId === id) setSelectedId(null);
    setEditingTripId(null);
    await update({ trips: trips.filter((t) => t.id !== id) });
  };

  // Una entrada del itinerario es una actividad (nombre, enlace, precio/pp y descripción) o la visita a un
  // lugar guardado, ambas con su fecha.
  const saveItem = async (id: string | "new", values: Omit<TravelItineraryItem, "id">) => {
    if (!selected) return;
    const next =
      id === "new"
        ? [...selected.itinerary, { id: Crypto.randomUUID(), ...values }]
        : selected.itinerary.map((it) => (it.id === id ? { id: it.id, ...values } : it));
    setEditingItemId(null);
    await patchTrip(selected.id, { itinerary: next });
  };

  const removeItem = async (itemId: string) => {
    if (!selected) return;
    setEditingItemId(null);
    await patchTrip(selected.id, { itinerary: selected.itinerary.filter((it) => it.id !== itemId) });
  };

  // Los lugares son del viaje seleccionado: cualquier cambio reescribe `places` de ESE viaje.
  const setPlaces = async (next: SavedPlace[]) => {
    if (selected) await patchTrip(selected.id, { places: next });
  };

  const patchPlace = (id: string, patch: Partial<SavedPlace>) => setPlaces(places.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const removePlace = async (id: string) => {
    setEditingPlaceId(null);
    await setPlaces(places.filter((p) => p.id !== id));
  };

  const savePlace = async (id: string | "new", values: Omit<SavedPlace, "id">) => {
    if (id === "new") await setPlaces([...places, { id: Crypto.randomUUID(), ...values }]);
    else await patchPlace(id, values);
    setEditingPlaceId(null);
  };

  // Qué empacar: cada cambio reescribe `packing` del viaje seleccionado.
  const setPacking = async (next: PackingItem[]) => {
    if (selected) await patchTrip(selected.id, { packing: next });
  };

  const addPackingItem = async () => {
    const text = packingDraft.trim();
    if (!text) {
      // Enviar vacío cierra el campo (es la forma de "terminar" de anotar).
      setPackingOpen(false);
      return;
    }
    // Se vacía el campo ya, sin esperar a guardar, para poder seguir escribiendo el siguiente.
    setPackingDraft("");
    await setPacking([...packing, { id: Crypto.randomUUID(), text }]);
  };

  const closeTransport = () => {
    setEditingTransportId(null);
    setConnectFromId(null);
    setConnectDate(null);
  };

  // `createConnection`: el formulario pidió "Crear transporte de conexión" — se guarda este tramo y se abre
  // otro nuevo. Todo el cambio (tramo + enlace del tramo anterior) va en UN solo patchTrip: dos seguidos
  // partirían del mismo `selected` y el segundo pisaría al primero.
  const saveTransport = async (id: string | "new", values: Omit<TransportDetail, "id">, createConnection?: boolean) => {
    if (!selected) return;
    const current = selected.transport ?? [];
    const legId = id === "new" ? Crypto.randomUUID() : id;
    let next = id === "new" ? [...current, { id: legId, ...values }] : current.map((d) => (d.id === id ? { id: d.id, ...values } : d));
    // Este tramo era el "nuevo transporte de conexión" de otro: ahora que existe, el otro continúa con él.
    if (id === "new" && connectFromId) next = next.map((d) => (d.id === connectFromId ? { ...d, nextId: legId } : d));
    if (createConnection) {
      setConnectFromId(legId);
      setConnectDate(values.arrivalDate ?? values.date);
      setTransportFormSeq((n) => n + 1);
      setEditingTransportId("new");
    } else {
      closeTransport();
    }
    await patchTrip(selected.id, { transport: next });
  };

  // Al borrar un tramo, los que lo tenían como continuación dejan de apuntar a un id que ya no existe
  // (conservan "necesita transbordo", así que vuelven a mostrar el aviso de transbordo pendiente).
  const removeTransport = async (id: string) => {
    if (!selected) return;
    closeTransport();
    await patchTrip(selected.id, {
      transport: (selected.transport ?? []).filter((d) => d.id !== id).map((d) => (d.nextId === id ? { ...d, nextId: undefined } : d)),
    });
  };

  const saveContact = async (id: string | "new", values: Omit<TripContact, "id">) => {
    if (!selected) return;
    const next = id === "new" ? [...contacts, { id: Crypto.randomUUID(), ...values }] : contacts.map((c) => (c.id === id ? { id: c.id, ...values } : c));
    setEditingContactId(null);
    await patchTrip(selected.id, { contacts: next });
  };

  const removeContact = async (id: string) => {
    if (!selected) return;
    setEditingContactId(null);
    await patchTrip(selected.id, { contacts: contacts.filter((c) => c.id !== id) });
  };

  const daysToGo = selected ? diffDays(selected.startDate, today) : null;
  const ongoing = selected ? selected.startDate <= today && selected.endDate >= today : false;
  const stats = [
    {
      icon: "🧳",
      color: colors.primary,
      value: String(upcoming.length),
      label: "Viajes próximos",
      hint: upcoming.length === 0 ? "Ninguno por delante" : `Tienes ${upcoming.length} ${upcoming.length === 1 ? "viaje planificado" : "viajes planificados"}`,
    },
    {
      icon: "📍",
      color: colors.positive,
      value: String(places.length),
      label: "Lugares guardados",
      hint: !selected ? "Sin viaje seleccionado" : favorites === 0 ? `En ${selected.destination}` : `${favorites} ${favorites === 1 ? "favorito" : "favoritos"} en ${selected.destination}`,
    },
    {
      icon: "🗓️",
      color: colors.hobby,
      value: !selected ? "—" : ongoing ? "¡Ya!" : daysToGo !== null && daysToGo > 0 ? String(daysToGo) : "—",
      label: ongoing ? "Viaje en curso" : "Días para el viaje",
      hint: !selected ? "Sin viaje seleccionado" : ongoing ? `Estás en ${selected.destination}` : daysToGo !== null && daysToGo > 0 ? `Viaje a ${selected.destination}` : "Este viaje ya terminó",
    },
    {
      icon: "💶",
      color: colors.warning,
      value: selected?.budget != null ? fmtMoney(selected.budget) : "—",
      label: "Presupuesto",
      hint: selected?.budget != null ? "Total estimado" : "Sin presupuesto",
    },
  ];

  const tripPanelTitle = !selected ? "Próximo viaje" : selected.endDate < today ? "Último viaje" : selected.id === upcoming[0]?.id ? "Próximo viaje" : "Viaje";
  const editingTrip = trips.find((t) => t.id === editingTripId) ?? null;
  const editingPlace = places.find((p) => p.id === editingPlaceId) ?? null;
  const editingItem = itinerary.find((it) => it.id === editingItemId) ?? null;
  const itemDialogOpen = selected !== null && (editingItemId === "new" || editingItem !== null);
  const placeDialogOpen = selected !== null && (editingPlaceId === "new" || editingPlace !== null);
  const editingTransport = transport.find((d) => d.id === editingTransportId) ?? null;
  const transportDialogOpen = selected !== null && (editingTransportId === "new" || editingTransport !== null);
  const editingContact = contacts.find((c) => c.id === editingContactId) ?? null;
  const contactDialogOpen = selected !== null && (editingContactId === "new" || editingContact !== null);

  return (
    <View style={{ gap: 16 }}>
      <View style={styles.card}>
        <Text style={styles.cardTitleSerif}>Planifica tu próximo destino</Text>
        <TextInput style={styles.input} placeholder="🔎 Ciudad o país…" value={destination} onChangeText={setDestination} onSubmitEditing={addTrip} />
        <View style={styles.dateRow}>
          <DateField
            label="Desde"
            value={from}
            onChange={(key) => {
              setFrom(key);
              if (to < key) setTo(key);
            }}
          />
          <DateField label="Hasta" value={to < from ? from : to} onChange={(key) => setTo(key < from ? from : key)} />
        </View>
        <Pressable style={styles.primaryButton} onPress={addTrip}>
          <Text style={styles.primaryButtonText}>+ Añadir viaje</Text>
        </Pressable>
        {sortedTrips.length > 1 && (
          <View style={styles.chipRow}>
            {sortedTrips.map((t) => (
              <Pressable
                key={t.id}
                style={[styles.chip, selected?.id === t.id && styles.chipSelected]}
                onPress={() => {
                  setSelectedId(t.id);
                  // El campo de equipaje en línea es de un viaje concreto: se cierra al cambiar de viaje.
                  setPackingOpen(false);
                  setPackingDraft("");
                }}
              >
                <Text style={[styles.chipText, selected?.id === t.id && styles.chipTextSelected]}>{t.destination}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      <View style={styles.statsGrid}>
        {stats.map((s) => (
          <View key={s.label} style={[styles.statCard, { backgroundColor: withAlpha(s.color, 0.1), borderColor: withAlpha(s.color, 0.3) }]}>
            <Text style={styles.statIcon}>{s.icon}</Text>
            <Text style={styles.statValue} numberOfLines={1}>
              {s.value}
            </Text>
            <Text style={styles.statLabel} numberOfLines={1}>
              {s.label}
            </Text>
            <Text style={styles.statHint} numberOfLines={2}>
              {s.hint}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{tripPanelTitle}</Text>
        {selected ? (
          <>
            {selected.imageData ? (
              <Image source={{ uri: selected.imageData }} style={styles.tripImage} />
            ) : (
              <View style={[styles.tripImage, styles.tripImagePlaceholder]}>
                <Text style={{ fontSize: 44 }}>✈️</Text>
              </View>
            )}
            <Text style={styles.tripName}>{selected.destination}</Text>
            <Text style={styles.mutedSmall}>
              📅 {fmtRange(selected)} · {diffDays(selected.endDate, selected.startDate) + 1} {diffDays(selected.endDate, selected.startDate) === 0 ? "día" : "días"}
            </Text>
            <Text style={styles.mutedSmall}>
              🗓️ {itinerary.length} {itinerary.length === 1 ? "actividad" : "actividades"} · 📍 {places.length} {places.length === 1 ? "lugar" : "lugares"}
            </Text>
            {selected.notes ? (
              <Text style={styles.tripNotes} numberOfLines={3}>
                {selected.notes}
              </Text>
            ) : null}
            <Pressable style={styles.outlineButton} onPress={() => setEditingTripId(selected.id)}>
              <Text style={styles.outlineButtonText}>Ver viaje</Text>
            </Pressable>
          </>
        ) : (
          <Text style={styles.emptyText}>Añade un viaje arriba para empezar a planificarlo.</Text>
        )}
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Mi itinerario</Text>
          {selected && (
            <Pressable style={styles.plusButton} onPress={() => setEditingItemId("new")} hitSlop={8} accessibilityLabel="Añadir al itinerario">
              <Text style={styles.plusButtonText}>+</Text>
            </Pressable>
          )}
        </View>
        {selected ? (
          <>
            {itinerary.length === 0 ? (
              <Text style={styles.emptyText}>Todavía no hay nada planificado. Con el + añade una actividad o un lugar guardado a su fecha.</Text>
            ) : (
              <View style={styles.timeline}>
                {(showFullItinerary ? itinerary : itinerary.slice(0, ITINERARY_PREVIEW)).map((it) => {
                  const isPlace = it.kind === "place";
                  const place = isPlace ? places.find((p) => p.id === it.placeId) : undefined;
                  const name = place?.name ?? it.title;
                  const url = isPlace ? place?.url : it.url;
                  const description = isPlace ? place?.description : it.description;
                  const price = !isPlace && it.pricePerPerson != null ? it.pricePerPerson : null;
                  return (
                    <View key={it.id} style={styles.timelineRow}>
                      <View style={styles.timelineDot} />
                      {/* Tocar la entrada la edita; el enlace se abre aparte. */}
                      <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => setEditingItemId(it.id)} accessibilityLabel={`Editar ${name}`}>
                        <Text style={styles.mutedSmall}>{fmtDate(it.date)}</Text>
                        <Text style={styles.timelineTitle}>
                          {isPlace ? "📍 " : ""}
                          {name}
                          {price !== null ? <Text style={styles.timelinePrice}>{`  · ${fmtPrice(price)}/pp`}</Text> : null}
                        </Text>
                        {description ? (
                          <Text style={styles.mutedSmall} numberOfLines={2}>
                            {description}
                          </Text>
                        ) : null}
                        {it.notes ? <Text style={styles.mutedSmall}>{it.notes}</Text> : null}
                      </Pressable>
                      {url ? (
                        <Pressable onPress={() => Linking.openURL(url).catch(() => undefined)} hitSlop={8} accessibilityLabel={`Abrir ${hostnameOf(url)}`}>
                          <Text style={styles.timelineLink} numberOfLines={1}>
                            {hostnameOf(url)}
                          </Text>
                        </Pressable>
                      ) : null}
                      <Pressable onPress={() => removeItem(it.id)} hitSlop={8} accessibilityLabel={`Quitar ${name}`}>
                        <Text style={styles.deleteX}>✕</Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            )}
            {itinerary.length > ITINERARY_PREVIEW && (
              <Pressable style={styles.outlineButton} onPress={() => setShowFullItinerary((v) => !v)}>
                <Text style={styles.outlineButtonText}>{showFullItinerary ? "Ver menos" : `Ver itinerario completo (${itinerary.length})`}</Text>
              </Pressable>
            )}
          </>
        ) : (
          <Text style={styles.emptyText}>El itinerario aparece aquí al elegir un viaje.</Text>
        )}
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Lugares guardados</Text>
          {selected && (
            <Pressable style={styles.plusButton} onPress={() => setEditingPlaceId("new")} hitSlop={8} accessibilityLabel="Añadir lugar">
              <Text style={styles.plusButtonText}>+</Text>
            </Pressable>
          )}
        </View>
        {!selected ? (
          <Text style={styles.emptyText}>Los lugares guardados aparecen aquí al elegir un viaje.</Text>
        ) : places.length === 0 ? (
          <Text style={styles.emptyText}>Guarda aquí los sitios de {selected.destination} que quieres visitar, con su enlace.</Text>
        ) : (
          <View style={{ gap: 12 }}>
            {(showAllPlaces ? places : places.slice(0, PLACES_PREVIEW)).map((p) => (
              <View key={p.id} style={styles.placeRow}>
                {/* Con URL, tocar el marcador la abre; sin ella, abre la edición. */}
                <Pressable
                  style={styles.placeMain}
                  onPress={() => (p.url ? Linking.openURL(p.url).catch(() => setEditingPlaceId(p.id)) : setEditingPlaceId(p.id))}
                  onLongPress={() => setEditingPlaceId(p.id)}
                >
                  <PlaceThumb place={p} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.placeName} numberOfLines={1}>
                      {p.name}
                    </Text>
                    {p.description ? (
                      <Text style={styles.mutedSmall} numberOfLines={2}>
                        {p.description}
                      </Text>
                    ) : null}
                    {p.url ? (
                      <Text style={styles.placeHost} numberOfLines={1}>
                        {hostnameOf(p.url)}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
                <Pressable onPress={() => patchPlace(p.id, { favorite: !p.favorite })} hitSlop={8}>
                  <Text style={[styles.heart, p.favorite && styles.heartOn]}>{p.favorite ? "♥" : "♡"}</Text>
                </Pressable>
                <Pressable onPress={() => setEditingPlaceId(p.id)} hitSlop={8} accessibilityLabel={`Editar ${p.name}`}>
                  <Text style={styles.editPencil}>✎</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
        {places.length > PLACES_PREVIEW && (
          <Pressable style={styles.outlineButton} onPress={() => setShowAllPlaces((v) => !v)}>
            <Text style={styles.outlineButtonText}>{showAllPlaces ? "Ver menos" : `Ver todos (${places.length})`}</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <CardTitle title="Qué empacar" destination={selected?.destination} />
          {selected && (
            <View style={styles.headerRight}>
              {packing.length > 0 && <Text style={styles.counterText}>{`${packedCount}/${packing.length}`}</Text>}
              <Pressable style={styles.plusButton} onPress={() => setPackingOpen(true)} hitSlop={8} accessibilityLabel="Añadir a la lista de equipaje">
                <Text style={styles.plusButtonText}>+</Text>
              </Pressable>
            </View>
          )}
        </View>
        {!selected ? (
          <Text style={styles.emptyText}>La lista de equipaje aparece aquí al elegir un viaje.</Text>
        ) : (
          <>
            {packingOpen && (
              <TextInput
                style={styles.input}
                placeholder="Añade algo a la maleta…"
                value={packingDraft}
                onChangeText={setPackingDraft}
                onSubmitEditing={addPackingItem}
                submitBehavior="submit"
                returnKeyType="done"
                autoFocus
                maxLength={120}
              />
            )}
            {packing.length === 0 ? (
              !packingOpen && <Text style={styles.emptyText}>Anota aquí lo que no puedes olvidar para {selected.destination}.</Text>
            ) : (
              <View style={{ gap: 4 }}>
                {packing.map((p) => (
                  <View key={p.id} style={styles.packingRow}>
                    <Pressable
                      style={styles.packingMain}
                      onPress={() => setPacking(packing.map((x) => (x.id === p.id ? { ...x, packed: !x.packed } : x)))}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: !!p.packed }}
                    >
                      <View style={[styles.checkbox, p.packed && styles.checkboxOn]}>{p.packed ? <Text style={styles.checkboxTick}>✓</Text> : null}</View>
                      <Text style={[styles.packingText, p.packed && styles.packingTextDone]}>{p.text}</Text>
                    </Pressable>
                    <Pressable onPress={() => setPacking(packing.filter((x) => x.id !== p.id))} hitSlop={8} accessibilityLabel={`Quitar ${p.text}`}>
                      <Text style={styles.deleteX}>✕</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <CardTitle title="Detalles del transporte" destination={selected?.destination} />
          {selected && (
            <Pressable style={styles.plusButton} onPress={() => setEditingTransportId("new")} hitSlop={8} accessibilityLabel="Añadir transporte">
              <Text style={styles.plusButtonText}>+</Text>
            </Pressable>
          )}
        </View>
        {!selected ? (
          <Text style={styles.emptyText}>El transporte aparece aquí al elegir un viaje.</Text>
        ) : transport.length === 0 ? (
          <Text style={styles.emptyText}>Guarda aquí vuelos, trenes y demás de {selected.destination}, con sus billetes o tarjetas de embarque.</Text>
        ) : (
          <View style={{ gap: 16 }}>
            {transportChains.map((chain) => (
              <View key={chain[0].id} style={{ gap: 8 }}>
                {chain.map((d, i) => {
                  const meta = transportMeta(d.type);
                  const attachments = d.attachments ?? [];
                  const prev = i > 0 ? chain[i - 1] : null;
                  const layover = prev ? layoverMinutes(prev, d) : null;
                  return (
                    // Las continuaciones (transbordos) van sangradas y con una línea a la izquierda.
                    <View key={d.id} style={prev ? styles.transportContinuation : undefined}>
                      {prev ? (
                        <View style={styles.transferConnector}>
                          <Text style={styles.transferLabel}>{prev.transferPlace?.trim() ? `↳ Transbordo en ${prev.transferPlace.trim()}` : "↳ Transbordo"}</Text>
                          {layover !== null && layover < 0 ? (
                            <Text style={styles.transferWarning}>⚠ La conexión no llega a tiempo</Text>
                          ) : layover !== null ? (
                            <Text style={styles.mutedSmall}>{`escala de ${formatLayover(layover)}`}</Text>
                          ) : null}
                        </View>
                      ) : null}
                      <View style={styles.transportRow}>
                        <Text style={styles.transportIcon}>{meta.icon}</Text>
                        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                          <Pressable onPress={() => setEditingTransportId(d.id)} accessibilityLabel={`Editar ${d.title || meta.label}`}>
                            <Text style={styles.timelineTitle}>{d.title?.trim() || meta.label}</Text>
                            <Text style={styles.mutedSmall}>{formatSchedule(d)}</Text>
                            {d.details ? (
                              <Text style={styles.mutedSmall} numberOfLines={2}>
                                {d.details}
                              </Text>
                            ) : null}
                          </Pressable>
                          {attachments.length > 0 && (
                            <View style={styles.attachmentRow}>
                              {attachments.map((a) => (
                                <AttachmentChip key={a.id} attachment={a} />
                              ))}
                            </View>
                          )}
                          {d.needsTransfer && i === chain.length - 1 ? (
                            <Text style={styles.transferHint}>Transbordo pendiente: añade el transporte de conexión</Text>
                          ) : null}
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        )}
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <CardTitle title="Contactos importantes" destination={selected?.destination} />
          {selected && (
            <Pressable style={styles.plusButton} onPress={() => setEditingContactId("new")} hitSlop={8} accessibilityLabel="Añadir contacto">
              <Text style={styles.plusButtonText}>+</Text>
            </Pressable>
          )}
        </View>
        {!selected ? (
          <Text style={styles.emptyText}>Los contactos aparecen aquí al elegir un viaje.</Text>
        ) : contacts.length === 0 ? (
          <Text style={styles.emptyText}>Guarda aquí alojamientos, guías o teléfonos de emergencia de {selected.destination}.</Text>
        ) : (
          <View style={{ gap: 14 }}>
            {contacts.map((c) => (
              <View key={c.id} style={{ gap: 3 }}>
                <Pressable onPress={() => setEditingContactId(c.id)} accessibilityLabel={`Editar ${c.name}`}>
                  <Text style={styles.contactName}>{c.name}</Text>
                  {c.location ? <Text style={styles.mutedSmall}>📍 {c.location}</Text> : null}
                </Pressable>
                {c.phone ? (
                  <Pressable
                    style={styles.contactLinkWrap}
                    onPress={() => Linking.openURL(`tel:${c.phone?.replace(/\s/g, "")}`).catch(() => Alert.alert("No se puede llamar", "Este dispositivo no puede iniciar la llamada."))}
                    hitSlop={6}
                    accessibilityLabel={`Llamar a ${c.name}`}
                  >
                    <Text style={styles.contactLink}>📞 {c.phone}</Text>
                  </Pressable>
                ) : null}
                {c.email ? (
                  <Pressable
                    style={styles.contactLinkWrap}
                    onPress={() => Linking.openURL(`mailto:${c.email}`).catch(() => Alert.alert("No se puede escribir", "No hay ninguna aplicación de correo disponible."))}
                    hitSlop={6}
                    accessibilityLabel={`Escribir a ${c.name}`}
                  >
                    <Text style={styles.contactLink}>✉️ {c.email}</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
        )}
      </View>

      <Modal visible={editingTrip !== null} animationType="slide" transparent onRequestClose={() => setEditingTripId(null)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior="padding">
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 20 }]}>
            {editingTrip && (
              <TripForm
                key={editingTrip.id}
                trip={editingTrip}
                onSave={async (patch) => {
                  await patchTrip(editingTrip.id, patch);
                  setEditingTripId(null);
                }}
                onDelete={() =>
                  Alert.alert("Eliminar viaje", `Se borrará "${editingTrip.destination}" con todo su itinerario.`, [
                    { text: "Cancelar", style: "cancel" },
                    { text: "Eliminar", style: "destructive", onPress: () => removeTrip(editingTrip.id) },
                  ])
                }
                onClose={() => setEditingTripId(null)}
              />
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={itemDialogOpen} animationType="slide" transparent onRequestClose={() => setEditingItemId(null)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior="padding">
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 20 }]}>
            {itemDialogOpen && selected && editingItemId && (
              <ItineraryForm
                key={editingItemId}
                trip={selected}
                places={places}
                item={editingItem ?? undefined}
                onSave={(values) => saveItem(editingItemId, values)}
                onDelete={editingItem ? () => removeItem(editingItem.id) : undefined}
                onClose={() => setEditingItemId(null)}
              />
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={placeDialogOpen} animationType="slide" transparent onRequestClose={() => setEditingPlaceId(null)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior="padding">
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 20 }]}>
            {placeDialogOpen && editingPlaceId && (
              <PlaceForm
                key={editingPlaceId}
                place={editingPlace ?? undefined}
                onSave={(values) => savePlace(editingPlaceId, values)}
                onDelete={editingPlace ? () => removePlace(editingPlace.id) : undefined}
                onClose={() => setEditingPlaceId(null)}
              />
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={transportDialogOpen} animationType="slide" transparent onRequestClose={closeTransport}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior="padding">
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 20 }]}>
            {transportDialogOpen && selected && editingTransportId && (
              <TransportForm
                key={`${editingTransportId}:${transportFormSeq}`}
                trip={selected}
                detail={editingTransport ?? undefined}
                // Solo en el transporte de conexión recién abierto: tramo del que viene y fecha de partida.
                previousId={editingTransport ? undefined : (connectFromId ?? undefined)}
                initialDate={editingTransport ? undefined : (connectDate ?? undefined)}
                // Adjuntos que ya ocupan sitio fuera de este formulario (otros viajes y otras entradas).
                otherChars={totalAttachmentChars(trips) - attachmentChars(editingTransport?.attachments)}
                onSave={(values, createConnection) => saveTransport(editingTransportId, values, createConnection)}
                onDelete={
                  editingTransport
                    ? () =>
                        Alert.alert("Eliminar transporte", "Se borrará también con sus archivos adjuntos.", [
                          { text: "Cancelar", style: "cancel" },
                          { text: "Eliminar", style: "destructive", onPress: () => removeTransport(editingTransport.id) },
                        ])
                    : undefined
                }
                onClose={closeTransport}
              />
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={contactDialogOpen} animationType="slide" transparent onRequestClose={() => setEditingContactId(null)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior="padding">
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 20 }]}>
            {contactDialogOpen && editingContactId && (
              <ContactForm
                key={editingContactId}
                contact={editingContact ?? undefined}
                onSave={(values) => saveContact(editingContactId, values)}
                onDelete={
                  editingContact
                    ? () =>
                        Alert.alert("Eliminar contacto", `Se borrará "${editingContact.name}".`, [
                          { text: "Cancelar", style: "cancel" },
                          { text: "Eliminar", style: "destructive", onPress: () => removeContact(editingContact.id) },
                        ])
                    : undefined
                }
                onClose={() => setEditingContactId(null)}
              />
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// Título de un bloque del viaje seleccionado con el destino debajo, en pequeño y apagado: deja claro que
// el equipaje, el transporte y los contactos son DE ese viaje y no de la página entera.
function CardTitle({ title, destination }: { title: string; destination?: string }) {
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={styles.cardTitle}>{title}</Text>
      {destination ? (
        <Text style={styles.cardSubtitle} numberOfLines={1}>
          {destination}
        </Text>
      ) : null}
    </View>
  );
}

function ImageBlock({ value, onChange }: { value: string | null | undefined; onChange: (imageData: string | null) => void }) {
  return (
    <View style={{ marginBottom: 12 }}>
      {value ? <Image source={{ uri: value }} style={styles.formImage} /> : null}
      <View style={styles.imageActions}>
        <Pressable
          style={styles.outlineButton}
          onPress={async () => {
            const data = await pickImageData();
            if (data) onChange(data);
          }}
        >
          <Text style={styles.outlineButtonText}>{value ? "Cambiar foto" : "🖼️ Añadir foto"}</Text>
        </Pressable>
        {value ? (
          <Pressable onPress={() => onChange(null)} hitSlop={6}>
            <Text style={styles.removeText}>Quitar</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function TripForm({
  trip,
  onSave,
  onDelete,
  onClose,
}: {
  trip: Trip;
  onSave: (patch: Partial<Trip>) => Promise<void>;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [destination, setDestination] = useState(trip.destination);
  const [startDate, setStartDate] = useState(trip.startDate);
  const [endDate, setEndDate] = useState(trip.endDate);
  const [budgetText, setBudgetText] = useState(trip.budget != null ? String(trip.budget) : "");
  const [notes, setNotes] = useState(trip.notes ?? "");
  const [imageData, setImageData] = useState(trip.imageData ?? null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!destination.trim()) return;
    const budget = budgetText.trim() === "" ? null : Number(budgetText.replace(",", "."));
    setSaving(true);
    await onSave({
      destination: destination.trim(),
      startDate,
      endDate: endDate < startDate ? startDate : endDate,
      budget: budget != null && Number.isFinite(budget) && budget >= 0 ? budget : null,
      notes: notes.trim() || undefined,
      imageData,
    });
    setSaving(false);
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <Text style={styles.modalTitle}>Tu viaje</Text>
      <ImageBlock value={imageData} onChange={setImageData} />
      <TextInput style={styles.input} placeholder="Destino" value={destination} onChangeText={setDestination} />
      <View style={styles.dateRow}>
        <DateField
          label="Desde"
          value={startDate}
          onChange={(key) => {
            setStartDate(key);
            if (endDate < key) setEndDate(key);
          }}
        />
        <DateField label="Hasta" value={endDate < startDate ? startDate : endDate} onChange={(key) => setEndDate(key < startDate ? startDate : key)} />
      </View>
      <Text style={styles.fieldLabel}>Presupuesto estimado (€)</Text>
      <TextInput
        style={styles.input}
        placeholder="Sin presupuesto"
        keyboardType="decimal-pad"
        value={budgetText}
        onChangeText={(t) => setBudgetText(t.replace(/[^0-9.,]/g, ""))}
      />
      <TextInput
        style={[styles.input, styles.inputMultiline]}
        placeholder="Notas del viaje: alojamiento, vuelos, ideas…"
        value={notes}
        onChangeText={setNotes}
        multiline
      />
      <Pressable style={styles.primaryButton} onPress={submit} disabled={saving}>
        <Text style={styles.primaryButtonText}>{saving ? "Guardando…" : "Guardar"}</Text>
      </Pressable>
      <Pressable style={styles.deleteButton} onPress={onDelete}>
        <Text style={styles.deleteButtonText}>Eliminar viaje</Text>
      </Pressable>
      <Pressable style={styles.cancelButton} onPress={onClose}>
        <Text style={styles.cancelButtonText}>Cancelar</Text>
      </Pressable>
    </ScrollView>
  );
}

// Alta/edición de una entrada del itinerario: o una ACTIVIDAD nueva (nombre, enlace, precio por persona
// y una breve descripción) o la VISITA a un lugar ya guardado del viaje; en los dos casos con su fecha,
// que solo puede caer dentro del viaje (como min/max en la web).
function ItineraryForm({
  trip,
  places,
  item,
  onSave,
  onDelete,
  onClose,
}: {
  trip: Trip;
  places: SavedPlace[];
  item?: TravelItineraryItem; // undefined = entrada nueva
  onSave: (values: Omit<TravelItineraryItem, "id">) => Promise<void>;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"activity" | "place">(item?.kind === "place" ? "place" : "activity");
  const [date, setDate] = useState(clampDateKey(item?.date ?? trip.startDate, trip.startDate, trip.endDate));
  const [name, setName] = useState(item?.kind === "place" ? "" : (item?.title ?? ""));
  const [url, setUrl] = useState(item?.url ?? "");
  const [price, setPrice] = useState(item?.pricePerPerson != null ? String(item.pricePerPerson).replace(".", ",") : "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [placeId, setPlaceId] = useState(item?.placeId && places.some((p) => p.id === item.placeId) ? item.placeId : (places[0]?.id ?? ""));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (mode === "place") {
      const place = places.find((p) => p.id === placeId);
      if (!place) {
        setError("Elige un lugar guardado.");
        return;
      }
      setSaving(true);
      await onSave({ kind: "place", date, title: place.name, placeId: place.id, notes: item?.notes });
      setSaving(false);
      return;
    }

    if (!name.trim()) {
      setError("Ponle un nombre a la actividad.");
      return;
    }
    const rawUrl = url.trim();
    const normalizedUrl = rawUrl ? normalizePlaceUrl(rawUrl) : null;
    if (rawUrl && !normalizedUrl) {
      setError("El enlace no es válido. Usa una dirección http o https.");
      return;
    }
    const amount = price.trim() === "" ? null : Number(price.replace(",", "."));
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      setError("El precio por persona debe ser un número válido.");
      return;
    }
    setSaving(true);
    await onSave({
      kind: "activity",
      date,
      title: name.trim(),
      url: normalizedUrl ?? undefined,
      pricePerPerson: amount,
      description: description.trim() || undefined,
      notes: item?.notes,
    });
    setSaving(false);
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <Text style={styles.modalTitle}>{item ? "Editar itinerario" : "Añadir al itinerario"}</Text>

      <View style={[styles.chipRow, { marginBottom: 12 }]}>
        {(
          [
            ["activity", "Actividad nueva"],
            ["place", "Lugar guardado"],
          ] as const
        ).map(([value, label]) => (
          <Pressable key={value} style={[styles.chip, mode === value && styles.chipSelected]} onPress={() => setMode(value)}>
            <Text style={[styles.chipText, mode === value && styles.chipTextSelected]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <DateField label="Fecha" value={date} min={trip.startDate} max={trip.endDate} onChange={setDate} />

      {mode === "activity" ? (
        <View style={{ gap: 10, marginTop: 12 }}>
          <TextInput style={styles.input} placeholder="Nombre de la actividad" value={name} onChangeText={setName} maxLength={120} />
          <TextInput
            style={styles.input}
            placeholder="Enlace (https://…)"
            value={url}
            onChangeText={setUrl}
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={styles.input}
            placeholder="Precio por persona (€)"
            value={price}
            onChangeText={(t) => setPrice(t.replace(/[^0-9.,]/g, ""))}
            keyboardType="decimal-pad"
          />
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            placeholder="Breve descripción: horario, qué incluye, cómo llegar…"
            value={description}
            onChangeText={setDescription}
            maxLength={300}
            multiline
          />
        </View>
      ) : places.length === 0 ? (
        <Text style={[styles.emptyText, { marginTop: 12 }]}>
          Todavía no hay lugares guardados en {trip.destination}. Guárdalos con el + de «Lugares guardados» y vuelve aquí para ponerles fecha.
        </Text>
      ) : (
        <View style={{ gap: 6, marginTop: 12 }}>
          <Text style={styles.fieldLabel}>Lugar</Text>
          {places.map((p) => (
            <Pressable key={p.id} style={[styles.placeOption, placeId === p.id && styles.placeOptionSelected]} onPress={() => setPlaceId(p.id)}>
              <Text style={[styles.placeOptionText, placeId === p.id && styles.chipTextSelected]} numberOfLines={1}>
                {p.favorite ? "♥ " : ""}
                {p.name}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {error ? <Text style={[styles.errorText, { marginTop: 8 }]}>{error}</Text> : null}
      <Pressable style={[styles.primaryButton, { marginTop: 14 }]} onPress={submit} disabled={saving || (mode === "place" && places.length === 0)}>
        <Text style={styles.primaryButtonText}>{saving ? "Guardando…" : "Guardar"}</Text>
      </Pressable>
      {onDelete ? (
        <Pressable style={styles.deleteButton} onPress={onDelete}>
          <Text style={styles.deleteButtonText}>Quitar del itinerario</Text>
        </Pressable>
      ) : null}
      <Pressable style={styles.cancelButton} onPress={onClose}>
        <Text style={styles.cancelButtonText}>Cancelar</Text>
      </Pressable>
    </ScrollView>
  );
}

// Chip de un adjunto: al tocarlo se escribe el archivo en la caché y se abre la hoja nativa de
// compartir/abrir. Con `onRemove` (en el formulario) lleva una ✕ para quitarlo.
function AttachmentChip({ attachment, onRemove }: { attachment: TripAttachment; onRemove?: () => void }) {
  const [opening, setOpening] = useState(false);
  const open = async () => {
    if (opening) return;
    setOpening(true);
    try {
      await openAttachment(attachment);
    } catch (e) {
      Alert.alert("No se pudo abrir el archivo", e instanceof Error ? e.message : "Inténtalo de nuevo.");
    } finally {
      setOpening(false);
    }
  };
  return (
    <View style={styles.attachmentChip}>
      <Pressable onPress={open} hitSlop={6} accessibilityLabel={`Abrir ${attachment.name}`} style={{ flexShrink: 1 }}>
        <Text style={styles.attachmentChipText} numberOfLines={1}>
          {opening ? "Abriendo…" : `📎 ${attachment.name}`}
        </Text>
      </Pressable>
      {onRemove ? (
        <Pressable onPress={onRemove} hitSlop={8} accessibilityLabel={`Quitar ${attachment.name}`}>
          <Text style={styles.deleteX}>✕</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function timeToDate(time: string): Date {
  const [h, m] = time.split(":").map(Number);
  const d = new Date();
  d.setHours(Number.isFinite(h) ? h : 9, Number.isFinite(m) ? m : 0, 0, 0);
  return d;
}

/** Botón con la hora (HH:MM) que abre el selector nativo; con hora puesta, "Quitar hora" la vacía. */
function TimeField({ label, value, onChange, defaultTime }: { label: string; value: string; onChange: (time: string) => void; defaultTime: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable style={styles.dateButton} onPress={() => setOpen(true)}>
        <Text style={styles.dateButtonText}>🕐 {value || "Sin hora"}</Text>
      </Pressable>
      {value ? (
        <Pressable onPress={() => onChange("")} hitSlop={6}>
          <Text style={styles.removeText}>Quitar hora</Text>
        </Pressable>
      ) : null}
      {open && (
        <DateTimePicker
          value={timeToDate(value || defaultTime)}
          mode="time"
          display="default"
          is24Hour
          onValueChange={(_event: DateTimePickerChangeEvent, selected: Date) => {
            setOpen(false);
            if (selected) onChange(`${pad2(selected.getHours())}:${pad2(selected.getMinutes())}`);
          }}
          onDismiss={() => setOpen(false)}
        />
      )}
    </View>
  );
}

// Alta/edición de un transporte (vuelo, tren…): tipo, título opcional, salida y llegada (fecha y hora; la
// fecha no se limita al rango del viaje: se puede salir el día antes o volver el día después), un
// transbordo opcional —que es OTRO transporte del mismo viaje, enlazado con `nextId`—, datos libres y adjuntos.
function TransportForm({
  trip,
  detail,
  previousId,
  initialDate,
  otherChars,
  onSave,
  onDelete,
  onClose,
}: {
  trip: Trip;
  detail?: TransportDetail; // undefined = transporte nuevo
  previousId?: string; // tramo del que continúa este transporte de conexión (aún sin enlazar en los datos)
  initialDate?: string; // fecha de salida inicial de un transporte de conexión
  otherChars: number; // caracteres de adjuntos que ya ocupan sitio fuera de este formulario
  // `createConnection`: guardar este tramo y abrir enseguida uno nuevo que continúe con él.
  onSave: (values: Omit<TransportDetail, "id">, createConnection?: boolean) => Promise<void>;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [type, setType] = useState<TransportType>(detail?.type ?? "flight");
  const [title, setTitle] = useState(detail?.title ?? "");
  const [date, setDate] = useState(detail?.date ?? initialDate ?? trip.startDate);
  const [departureTime, setDepartureTime] = useState(detail?.departureTime ?? "");
  const [arrivalDate, setArrivalDate] = useState(detail?.arrivalDate ?? "");
  const [arrivalTime, setArrivalTime] = useState(detail?.arrivalTime ?? "");
  const [needsTransfer, setNeedsTransfer] = useState(!!detail?.needsTransfer);
  const [transferPlace, setTransferPlace] = useState(detail?.transferPlace ?? "");
  const candidates = useMemo(() => linkCandidates(trip.transport ?? [], detail?.id, previousId), [trip.transport, detail?.id, previousId]);
  // "" = aún sin elegir; el enlace guardado solo se conserva si sigue siendo un candidato válido.
  const [nextId, setNextId] = useState(detail?.nextId && candidates.some((c) => c.id === detail.nextId) ? detail.nextId : "");
  const [createNext, setCreateNext] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState(detail?.details ?? "");
  const [attachments, setAttachments] = useState<TripAttachment[]>(detail?.attachments ?? []);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);

  const attach = async () => {
    if (picking) return;
    setPicking(true);
    try {
      const result = await pickAttachment(otherChars + attachmentChars(attachments));
      if (!result) return;
      if ("error" in result) {
        Alert.alert("No se pudo adjuntar", result.error);
        return;
      }
      setAttachments((prev) => [...prev, result.attachment]);
    } catch (e) {
      Alert.alert("No se pudo adjuntar", e instanceof Error ? e.message : "No se pudo leer el archivo.");
    } finally {
      setPicking(false);
    }
  };

  const submit = async () => {
    setError(null);
    // La fecha de llegada solo se guarda si es otro día (si coincide con la de salida es lo mismo que vacía).
    const arrivalDay = arrivalDate && arrivalDate !== date ? arrivalDate : undefined;
    const problem = validateTransportTimes({ date, departureTime: departureTime || undefined, arrivalDate: arrivalDate || undefined, arrivalTime: arrivalTime || undefined });
    if (problem) {
      setError(problem);
      return;
    }
    // "Crear transporte de conexión" deja este tramo sin `nextId`: se enlaza al guardar el nuevo.
    const connect = needsTransfer && createNext;
    setSaving(true);
    await onSave(
      {
        type,
        title: title.trim() || undefined,
        date,
        departureTime: departureTime || undefined,
        arrivalDate: arrivalDay,
        arrivalTime: arrivalTime || undefined,
        details: details.trim() || undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
        // Con el transbordo apagado se limpian también el lugar y el enlace.
        needsTransfer: needsTransfer ? true : undefined,
        transferPlace: needsTransfer ? transferPlace.trim() || undefined : undefined,
        nextId: needsTransfer && !connect ? nextId || undefined : undefined,
      },
      connect,
    );
    setSaving(false);
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <Text style={styles.modalTitle}>{detail ? "Editar transporte" : "Añadir transporte"}</Text>

      <View style={[styles.chipRow, { marginBottom: 12 }]}>
        {TRANSPORT_TYPES.map((t) => (
          <Pressable key={t.value} style={[styles.chip, type === t.value && styles.chipSelected]} onPress={() => setType(t.value)}>
            <Text style={[styles.chipText, type === t.value && styles.chipTextSelected]}>
              {t.icon} {t.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <TextInput style={styles.input} placeholder="Título (p. ej. Madrid → Lisboa)" value={title} onChangeText={setTitle} maxLength={120} />

      <View style={[styles.dateRow, { marginTop: 12 }]}>
        <DateField label="Fecha de salida" value={date} onChange={setDate} />
        <TimeField label="Hora de salida" value={departureTime} onChange={setDepartureTime} defaultTime="09:00" />
      </View>
      <View style={[styles.dateRow, { marginTop: 12 }]}>
        {/* Vacía = llega el mismo día; el selector no deja elegir antes de la salida. */}
        <DateField
          label="Fecha de llegada"
          value={arrivalDate}
          min={date}
          emptyLabel="Mismo día"
          pickerStart={date}
          onChange={setArrivalDate}
          onClear={() => setArrivalDate("")}
        />
        <TimeField label="Hora de llegada" value={arrivalTime} onChange={setArrivalTime} defaultTime={departureTime || "12:00"} />
      </View>

      <Pressable
        style={styles.transferToggle}
        onPress={() => setNeedsTransfer((v) => !v)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: needsTransfer }}
      >
        <View style={[styles.checkbox, needsTransfer && styles.checkboxOn]}>{needsTransfer ? <Text style={styles.checkboxTick}>✓</Text> : null}</View>
        <Text style={styles.packingText}>Necesita transbordo</Text>
      </Pressable>
      {needsTransfer && (
        <View style={styles.transferBlock}>
          <TextInput
            style={styles.input}
            placeholder="Transbordo en (estación, aeropuerto…)"
            value={transferPlace}
            onChangeText={setTransferPlace}
            maxLength={120}
          />
          <Text style={styles.fieldLabel}>Continúa con</Text>
          <Pressable
            style={[styles.placeOption, !createNext && nextId === "" && styles.placeOptionSelected]}
            onPress={() => {
              setNextId("");
              setCreateNext(false);
            }}
          >
            <Text style={[styles.placeOptionText, !createNext && nextId === "" && styles.chipTextSelected]}>— Aún sin elegir —</Text>
          </Pressable>
          {candidates.map((c) => {
            const meta = transportMeta(c.type);
            const selectedLeg = !createNext && nextId === c.id;
            return (
              <Pressable
                key={c.id}
                style={[styles.placeOption, selectedLeg && styles.placeOptionSelected]}
                onPress={() => {
                  setNextId(c.id);
                  setCreateNext(false);
                }}
              >
                <Text style={[styles.placeOptionText, selectedLeg && styles.chipTextSelected]} numberOfLines={1}>
                  {`${meta.icon} ${c.title?.trim() || meta.label} · ${shortDay(c.date)}${c.departureTime ? ` ${c.departureTime}` : ""}`}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            style={[styles.placeOption, createNext && styles.placeOptionSelected]}
            onPress={() => {
              setNextId("");
              setCreateNext(true);
            }}
          >
            <Text style={[styles.placeOptionText, createNext && styles.chipTextSelected]}>+ Crear transporte de conexión</Text>
          </Pressable>
          {createNext ? <Text style={styles.mutedSmall}>Al guardar se abrirá un transporte nuevo con la fecha de llegada de este.</Text> : null}
        </View>
      )}

      <TextInput
        style={[styles.input, styles.inputMultiline]}
        placeholder="Datos: operador, nº de vuelo o tren, asiento, referencia de reserva, terminal…"
        value={details}
        onChangeText={setDetails}
        maxLength={600}
        multiline
      />

      <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Archivos adjuntos</Text>
      {attachments.length > 0 && (
        <View style={[styles.attachmentRow, { marginBottom: 8 }]}>
          {attachments.map((a) => (
            <AttachmentChip key={a.id} attachment={a} onRemove={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))} />
          ))}
        </View>
      )}
      <Pressable style={styles.outlineButton} onPress={attach} disabled={picking}>
        <Text style={styles.outlineButtonText}>{picking ? "Leyendo archivo…" : "📎 Adjuntar archivo (tarjeta de embarque, billete…)"}</Text>
      </Pressable>

      {error ? <Text style={[styles.errorText, { marginTop: 8 }]}>{error}</Text> : null}
      <Pressable style={[styles.primaryButton, { marginTop: 14 }]} onPress={submit} disabled={saving || picking}>
        <Text style={styles.primaryButtonText}>{saving ? "Guardando…" : "Guardar"}</Text>
      </Pressable>
      {onDelete ? (
        <Pressable style={styles.deleteButton} onPress={onDelete}>
          <Text style={styles.deleteButtonText}>Eliminar</Text>
        </Pressable>
      ) : null}
      <Pressable style={styles.cancelButton} onPress={onClose}>
        <Text style={styles.cancelButtonText}>Cancelar</Text>
      </Pressable>
    </ScrollView>
  );
}

// Alta/edición de un contacto del viaje. Solo el nombre es obligatorio; teléfono y correo se validan
// "por encima" (no hace falta un formato estricto, solo cazar erratas evidentes).
function ContactForm({
  contact,
  onSave,
  onDelete,
  onClose,
}: {
  contact?: TripContact; // undefined = contacto nuevo
  onSave: (values: Omit<TripContact, "id">) => Promise<void>;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(contact?.name ?? "");
  const [location, setLocation] = useState(contact?.location ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!name.trim()) {
      setError("Ponle un nombre al contacto.");
      return;
    }
    if (phone.trim() && !isValidPhone(phone.trim())) {
      setError("El teléfono no es válido. Usa solo números, espacios y + - ( ).");
      return;
    }
    if (email.trim() && !EMAIL_RE.test(email.trim())) {
      setError("El correo no es válido.");
      return;
    }
    setSaving(true);
    await onSave({
      name: name.trim(),
      location: location.trim() || undefined,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
    });
    setSaving(false);
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <Text style={styles.modalTitle}>{contact ? "Editar contacto" : "Nuevo contacto"}</Text>
      <View style={{ gap: 10 }}>
        <TextInput style={styles.input} placeholder="Nombre" value={name} onChangeText={setName} maxLength={120} />
        <TextInput style={styles.input} placeholder="Ubicación" value={location} onChangeText={setLocation} maxLength={160} />
        <TextInput style={styles.input} placeholder="Teléfono" value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={40} />
        <TextInput
          style={styles.input}
          placeholder="Correo"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={160}
        />
      </View>
      {error ? <Text style={[styles.errorText, { marginTop: 8 }]}>{error}</Text> : null}
      <Pressable style={[styles.primaryButton, { marginTop: 14 }]} onPress={submit} disabled={saving}>
        <Text style={styles.primaryButtonText}>{saving ? "Guardando…" : "Guardar"}</Text>
      </Pressable>
      {onDelete ? (
        <Pressable style={styles.deleteButton} onPress={onDelete}>
          <Text style={styles.deleteButtonText}>Eliminar</Text>
        </Pressable>
      ) : null}
      <Pressable style={styles.cancelButton} onPress={onClose}>
        <Text style={styles.cancelButtonText}>Cancelar</Text>
      </Pressable>
    </ScrollView>
  );
}

// Miniatura del marcador: la imagen de la página y, si no hay o no carga, su icono; sin ninguno de
// los dos (o sin URL), un 📍. `imageData` es la foto subida a mano de los lugares antiguos.
function PlaceThumb({ place }: { place: SavedPlace }) {
  const sources = [
    ...(place.imageData ? [{ uri: place.imageData, icon: false }] : []),
    ...(place.thumbnailUrl ? [{ uri: place.thumbnailUrl, icon: false }] : []),
    ...(place.faviconUrl ? [{ uri: place.faviconUrl, icon: true }] : []),
  ];
  const [failed, setFailed] = useState(0);
  const current = sources[failed];
  return (
    <View style={[styles.placeThumb, styles.placeThumbPlaceholder]}>
      {current ? (
        <Image
          source={{ uri: current.uri }}
          style={current.icon ? styles.placeFavicon : styles.placeThumbImage}
          resizeMode={current.icon ? "contain" : "cover"}
          onError={() => setFailed((n) => n + 1)}
        />
      ) : (
        <Text style={{ fontSize: 20 }}>📍</Text>
      )}
    </View>
  );
}

// Alta/edición de un lugar: nombre, URL y descripción. Al guardar con URL se pide su previsualización
// (miniatura, y título/descripción si faltan); si falla, el lugar se guarda igual sin miniatura.
function PlaceForm({
  place,
  onSave,
  onDelete,
  onClose,
}: {
  place?: SavedPlace; // undefined = lugar nuevo
  onSave: (values: Omit<SavedPlace, "id">) => Promise<void>;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(place?.name ?? "");
  const [url, setUrl] = useState(place?.url ?? "");
  const [description, setDescription] = useState(place?.description ?? "");
  const [favorite, setFavorite] = useState(!!place?.favorite);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
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

    await onSave({
      name: name.trim() || fallbackName || (normalizedUrl ? hostnameOf(normalizedUrl) : ""),
      url: normalizedUrl ?? undefined,
      description: description.trim() || fallbackDescription.slice(0, PLACE_DESCRIPTION_MAX) || undefined,
      thumbnailUrl,
      faviconUrl,
      imageData: place?.imageData ?? null,
      favorite,
    });
    setSaving(false);
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <Text style={styles.modalTitle}>{place ? "Editar lugar" : "Nuevo lugar"}</Text>
      <TextInput style={styles.input} placeholder="Nombre del lugar" value={name} onChangeText={setName} />
      <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Dirección (URL)</Text>
      <TextInput
        style={styles.input}
        placeholder="https://…"
        value={url}
        onChangeText={setUrl}
        keyboardType="url"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextInput
        style={[styles.input, styles.inputMultiline]}
        placeholder="Por qué quieres ir, qué ver allí…"
        value={description}
        onChangeText={setDescription}
        multiline
      />
      <Pressable style={styles.favoriteToggle} onPress={() => setFavorite((v) => !v)}>
        <Text style={[styles.heart, favorite && styles.heartOn]}>{favorite ? "♥" : "♡"}</Text>
        <Text style={styles.favoriteToggleText}>Favorito</Text>
      </Pressable>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <Pressable style={styles.primaryButton} onPress={submit} disabled={saving}>
        <Text style={styles.primaryButtonText}>{saving ? "Guardando…" : "Guardar"}</Text>
      </Pressable>
      {onDelete ? (
        <Pressable style={styles.deleteButton} onPress={onDelete}>
          <Text style={styles.deleteButtonText}>Eliminar lugar</Text>
        </Pressable>
      ) : null}
      <Pressable style={styles.cancelButton} onPress={onClose}>
        <Text style={styles.cancelButtonText}>Cancelar</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    gap: 10,
    ...shadow,
  },
  cardTitle: { fontFamily: fonts.sansBold, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6, color: colors.mutedForeground },
  cardSubtitle: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground, marginTop: 1 },
  cardTitleSerif: { fontFamily: fonts.serif, fontSize: 20, color: colors.foreground },
  fieldLabel: { fontFamily: fonts.sansBold, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.8, color: colors.mutedForeground, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.input,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.foreground,
    backgroundColor: colors.background,
  },
  inputMultiline: { minHeight: 90, textAlignVertical: "top", marginTop: 8 },
  dateRow: { flexDirection: "row", gap: 10 },
  dateButton: {
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.input,
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: colors.background,
    marginBottom: 4,
  },
  dateButtonText: { fontFamily: fonts.sans, fontSize: 13, color: colors.foreground },
  primaryButton: { backgroundColor: colors.foreground, borderRadius: radius.full, paddingVertical: 13, alignItems: "center", marginTop: 4 },
  primaryButtonText: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.background },
  outlineButton: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: withAlpha(colors.primary, 0.4),
    borderRadius: radius.full,
    paddingHorizontal: 16,
    paddingVertical: 9,
    marginTop: 4,
  },
  outlineButtonText: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.primary },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border },
  chipSelected: { backgroundColor: colors.foreground, borderColor: colors.foreground },
  chipText: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground },
  chipTextSelected: { color: colors.background },

  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  statCard: { flexBasis: "47%", flexGrow: 1, borderRadius: radius.card, borderWidth: 1.5, padding: 16, gap: 2 },
  statIcon: { fontSize: 22, marginBottom: 4 },
  statValue: { fontFamily: fonts.serif, fontSize: 24, color: colors.foreground },
  statLabel: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.foreground },
  statHint: { fontFamily: fonts.sans, fontSize: 11, color: colors.mutedForeground },

  tripImage: { width: "100%", height: 170, borderRadius: radius.input },
  tripImagePlaceholder: { alignItems: "center", justifyContent: "center", backgroundColor: withAlpha(colors.primary, 0.12) },
  tripName: { fontFamily: fonts.serif, fontSize: 22, color: colors.foreground, marginTop: 4 },
  tripNotes: { fontFamily: fonts.sans, fontSize: 13, color: colors.mutedForeground },
  mutedSmall: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground },
  emptyText: { fontFamily: fonts.sans, fontSize: 13, color: colors.mutedForeground, fontStyle: "italic" },

  timeline: { borderLeftWidth: 1, borderLeftColor: colors.border, marginLeft: 4, paddingLeft: 16, gap: 14 },
  timelineRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  timelineDot: {
    position: "absolute",
    left: -22,
    top: 5,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.card,
  },
  timelineTitle: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.foreground },
  timelinePrice: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground },
  timelineLink: { fontFamily: fonts.sans, fontSize: 11, color: colors.primary, maxWidth: 90 },
  placeOption: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.input, paddingHorizontal: 12, paddingVertical: 10 },
  placeOptionSelected: { backgroundColor: colors.foreground, borderColor: colors.foreground },
  placeOptionText: { fontFamily: fonts.sans, fontSize: 14, color: colors.foreground },
  deleteX: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground, paddingHorizontal: 4 },
  addRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  addInput: { flex: 1 },
  addButton: { backgroundColor: colors.foreground, borderRadius: radius.input, width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  addButtonText: { fontFamily: fonts.sansBold, fontSize: 20, color: colors.background },

  placeRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  placeMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12 },
  placeThumb: { width: 52, height: 52, borderRadius: radius.input },
  placeThumbPlaceholder: { alignItems: "center", justifyContent: "center", backgroundColor: withAlpha(colors.positive, 0.12), overflow: "hidden" },
  placeThumbImage: { width: "100%", height: "100%" },
  placeFavicon: { width: 28, height: 28 },
  placeHost: { fontFamily: fonts.sans, fontSize: 10, color: withAlpha(colors.mutedForeground, 0.8) },
  editPencil: { fontSize: 14, color: colors.mutedForeground },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  plusButton: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.foreground, alignItems: "center", justifyContent: "center" },
  plusButtonText: { fontFamily: fonts.sansBold, fontSize: 16, lineHeight: 18, color: colors.background },
  errorText: { fontFamily: fonts.sans, fontSize: 12, color: colors.destructive, marginBottom: 8 },
  placeName: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.foreground },
  heart: { fontSize: 22, color: withAlpha(colors.mutedForeground, 0.6) },
  heartOn: { color: colors.destructive },
  favoriteToggle: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4, marginBottom: 8 },
  favoriteToggleText: { fontFamily: fonts.sans, fontSize: 14, color: colors.foreground },

  headerRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  counterText: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.mutedForeground },
  packingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  packingMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.inputBorder, alignItems: "center", justifyContent: "center" },
  checkboxOn: { backgroundColor: colors.foreground, borderColor: colors.foreground },
  checkboxTick: { fontFamily: fonts.sansBold, fontSize: 13, lineHeight: 15, color: colors.background },
  packingText: { flex: 1, fontFamily: fonts.sans, fontSize: 14, color: colors.foreground },
  packingTextDone: { textDecorationLine: "line-through", opacity: 0.45 },
  transportRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  transportContinuation: { marginLeft: 15, paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: withAlpha(colors.primary, 0.35), gap: 8 },
  transferConnector: { gap: 1 },
  transferLabel: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.primary },
  transferWarning: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.destructive },
  transferHint: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground, fontStyle: "italic" },
  transferToggle: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14, paddingVertical: 4 },
  transferBlock: { gap: 8, marginTop: 6, paddingLeft: 12, borderLeftWidth: 1, borderLeftColor: colors.border },
  transportIcon: { fontSize: 22, width: 30, textAlign: "center" },
  attachmentRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  attachmentChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: "100%",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: withAlpha(colors.primary, 0.4),
  },
  attachmentChipText: { fontFamily: fonts.sans, fontSize: 12, color: colors.primary },
  contactName: { fontFamily: fonts.sansBold, fontSize: 14, color: colors.foreground },
  contactLinkWrap: { alignSelf: "flex-start" },
  contactLink: { fontFamily: fonts.sans, fontSize: 13, color: colors.primary },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(45,41,38,0.4)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card, padding: 20, maxHeight: "90%" },
  modalTitle: { fontFamily: fonts.serif, fontSize: 24, color: colors.foreground, marginBottom: 16 },
  formImage: { width: "100%", height: 170, borderRadius: radius.input, marginBottom: 8 },
  imageActions: { flexDirection: "row", alignItems: "center", gap: 16 },
  removeText: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.destructive },
  deleteButton: { alignItems: "center", padding: 14 },
  deleteButtonText: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.destructive },
  cancelButton: { alignItems: "center", padding: 10 },
  cancelButtonText: { fontFamily: fonts.sans, fontSize: 14, color: colors.mutedForeground },
});
