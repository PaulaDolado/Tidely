import { useMemo, useState } from "react";
import { View, Pressable, ScrollView, StyleSheet, Modal, Image, Alert, Platform, KeyboardAvoidingView } from "react-native";
import { Text, TextInput } from "./AppText";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import DateTimePicker, { DateTimePickerChangeEvent } from "@react-native-community/datetimepicker";
import { SavedPlace, TravelContent, TravelItineraryItem, Trip } from "../api/customPages";
import { colors, fonts, radius, shadow, withAlpha } from "../theme";

// Plantilla "viajes" de las páginas personalizadas — puerto de
// dashboard/src/components/TravelPlannerTemplate.tsx: formulario para añadir un viaje, cuatro
// indicadores y tres bloques (viaje seleccionado, itinerario y lugares guardados), apilados en una
// sola columna en vez de la rejilla de escritorio. Simplificaciones deliberadas frente a la web: el
// texto de un viaje/lugar se edita en un diálogo con botón "Guardar" (igual que el resto de
// editores del móvil, ver KanbanCardForm), no al vuelo en cada tecla.

const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // igual límite que el resto de imágenes de páginas
const ITINERARY_PREVIEW = 4;
const PLACES_PREVIEW = 3;

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
function fmtDate(key: string, withYear = false): string {
  return keyToDate(key).toLocaleDateString("es-ES", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
}
function fmtRange(trip: Trip): string {
  return trip.startDate === trip.endDate ? fmtDate(trip.startDate, true) : `${fmtDate(trip.startDate)} – ${fmtDate(trip.endDate, true)}`;
}
function fmtMoney(n: number): string {
  return n.toLocaleString("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

async function pickImageData(): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    Alert.alert("Permiso necesario", "Activa el acceso a tus fotos para añadir una imagen.");
    return null;
  }
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], base64: true, quality: 0.5 });
  if (result.canceled || !result.assets[0]?.base64) return null;
  const base64 = result.assets[0].base64;
  if (base64.length * 0.75 > MAX_IMAGE_BYTES) {
    Alert.alert("Imagen demasiado grande", "El límite es de 3 MB por imagen.");
    return null;
  }
  return `data:image/jpeg;base64,${base64}`;
}

/** Botón con la fecha actual que abre el selector nativo al tocarlo. */
function DateField({ label, value, onChange, compact }: { label?: string; value: string; onChange: (key: string) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={compact ? undefined : { flex: 1 }}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <Pressable style={styles.dateButton} onPress={() => setOpen(true)}>
        <Text style={styles.dateButtonText}>📅 {fmtDate(value, true)}</Text>
      </Pressable>
      {open && (
        <DateTimePicker
          value={keyToDate(value)}
          mode="date"
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
  const trips = content.trips ?? [];
  const places = content.places ?? [];
  const today = todayKey();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingTripId, setEditingTripId] = useState<string | null>(null);
  const [editingPlaceId, setEditingPlaceId] = useState<string | null>(null);
  const [showFullItinerary, setShowFullItinerary] = useState(false);
  const [showAllPlaces, setShowAllPlaces] = useState(false);

  const [destination, setDestination] = useState("");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [activityDate, setActivityDate] = useState<string | null>(null);
  const [activityTitle, setActivityTitle] = useState("");
  const [placeName, setPlaceName] = useState("");

  const update = (patch: Partial<TravelContent>) => onChange({ trips, places, ...patch });

  const sortedTrips = useMemo(() => [...trips].sort((a, b) => a.startDate.localeCompare(b.startDate)), [trips]);
  const upcoming = sortedTrips.filter((t) => t.endDate >= today);
  const defaultTrip = upcoming[0] ?? sortedTrips[sortedTrips.length - 1] ?? null;
  const selected = trips.find((t) => t.id === selectedId) ?? defaultTrip;
  const itinerary = useMemo(() => [...(selected?.itinerary ?? [])].sort((a, b) => a.date.localeCompare(b.date)), [selected]);
  const favorites = places.filter((p) => p.favorite).length;

  const addTrip = async () => {
    const trimmed = destination.trim();
    if (!trimmed) return;
    const trip: Trip = { id: Crypto.randomUUID(), destination: trimmed, startDate: from, endDate: to < from ? from : to, itinerary: [] };
    setSelectedId(trip.id);
    setDestination("");
    await update({ trips: [...trips, trip] });
  };

  const patchTrip = (id: string, patch: Partial<Trip>) => update({ trips: trips.map((t) => (t.id === id ? { ...t, ...patch } : t)) });

  const removeTrip = async (id: string) => {
    if (selectedId === id) setSelectedId(null);
    setEditingTripId(null);
    await update({ trips: trips.filter((t) => t.id !== id) });
  };

  const addActivity = async () => {
    const title = activityTitle.trim();
    if (!selected || !title) return;
    const item: TravelItineraryItem = { id: Crypto.randomUUID(), date: activityDate ?? selected.startDate, title };
    setActivityTitle("");
    await patchTrip(selected.id, { itinerary: [...selected.itinerary, item] });
  };

  const removeActivity = (itemId: string) => selected && patchTrip(selected.id, { itinerary: selected.itinerary.filter((it) => it.id !== itemId) });

  const addPlace = async () => {
    const name = placeName.trim();
    if (!name) return;
    setPlaceName("");
    await update({ places: [...places, { id: Crypto.randomUUID(), name }] });
  };

  const patchPlace = (id: string, patch: Partial<SavedPlace>) => update({ places: places.map((p) => (p.id === id ? { ...p, ...patch } : p)) });

  const removePlace = async (id: string) => {
    setEditingPlaceId(null);
    await update({ places: places.filter((p) => p.id !== id) });
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
      hint: favorites === 0 ? "Tus sitios por visitar" : `${favorites} ${favorites === 1 ? "favorito" : "favoritos"}`,
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
              <Pressable key={t.id} style={[styles.chip, selected?.id === t.id && styles.chipSelected]} onPress={() => setSelectedId(t.id)}>
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
        <Text style={styles.cardTitle}>Mi itinerario</Text>
        {selected ? (
          <>
            {itinerary.length === 0 ? (
              <Text style={styles.emptyText}>Todavía no hay actividades. Añade la primera abajo.</Text>
            ) : (
              <View style={styles.timeline}>
                {(showFullItinerary ? itinerary : itinerary.slice(0, ITINERARY_PREVIEW)).map((it) => (
                  <View key={it.id} style={styles.timelineRow}>
                    <View style={styles.timelineDot} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.mutedSmall}>{fmtDate(it.date)}</Text>
                      <Text style={styles.timelineTitle}>{it.title}</Text>
                      {it.notes ? <Text style={styles.mutedSmall}>{it.notes}</Text> : null}
                    </View>
                    <Pressable onPress={() => removeActivity(it.id)} hitSlop={8}>
                      <Text style={styles.deleteX}>✕</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
            <DateField compact value={activityDate ?? selected.startDate} onChange={setActivityDate} />
            <View style={styles.addRow}>
              <TextInput style={[styles.input, styles.addInput]} placeholder="Nueva actividad…" value={activityTitle} onChangeText={setActivityTitle} onSubmitEditing={addActivity} />
              <Pressable style={styles.addButton} onPress={addActivity}>
                <Text style={styles.addButtonText}>+</Text>
              </Pressable>
            </View>
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
        <Text style={styles.cardTitle}>Lugares guardados</Text>
        {places.length === 0 ? (
          <Text style={styles.emptyText}>Guarda aquí los sitios que quieres visitar.</Text>
        ) : (
          <View style={{ gap: 12 }}>
            {(showAllPlaces ? places : places.slice(0, PLACES_PREVIEW)).map((p) => (
              <View key={p.id} style={styles.placeRow}>
                <Pressable style={styles.placeMain} onPress={() => setEditingPlaceId(p.id)}>
                  {p.imageData ? (
                    <Image source={{ uri: p.imageData }} style={styles.placeThumb} />
                  ) : (
                    <View style={[styles.placeThumb, styles.placeThumbPlaceholder]}>
                      <Text style={{ fontSize: 20 }}>📍</Text>
                    </View>
                  )}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.placeName} numberOfLines={1}>
                      {p.name}
                    </Text>
                    {p.description ? (
                      <Text style={styles.mutedSmall} numberOfLines={1}>
                        {p.description}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
                <Pressable onPress={() => patchPlace(p.id, { favorite: !p.favorite })} hitSlop={8}>
                  <Text style={[styles.heart, p.favorite && styles.heartOn]}>{p.favorite ? "♥" : "♡"}</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
        <View style={styles.addRow}>
          <TextInput style={[styles.input, styles.addInput]} placeholder="Nuevo lugar…" value={placeName} onChangeText={setPlaceName} onSubmitEditing={addPlace} />
          <Pressable style={styles.addButton} onPress={addPlace}>
            <Text style={styles.addButtonText}>+</Text>
          </Pressable>
        </View>
        {places.length > PLACES_PREVIEW && (
          <Pressable style={styles.outlineButton} onPress={() => setShowAllPlaces((v) => !v)}>
            <Text style={styles.outlineButtonText}>{showAllPlaces ? "Ver menos" : `Ver todos (${places.length})`}</Text>
          </Pressable>
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

      <Modal visible={editingPlace !== null} animationType="slide" transparent onRequestClose={() => setEditingPlaceId(null)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior="padding">
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 20 }]}>
            {editingPlace && (
              <PlaceForm
                key={editingPlace.id}
                place={editingPlace}
                onSave={async (patch) => {
                  await patchPlace(editingPlace.id, patch);
                  setEditingPlaceId(null);
                }}
                onDelete={() => removePlace(editingPlace.id)}
                onClose={() => setEditingPlaceId(null)}
              />
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
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

function PlaceForm({
  place,
  onSave,
  onDelete,
  onClose,
}: {
  place: SavedPlace;
  onSave: (patch: Partial<SavedPlace>) => Promise<void>;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(place.name);
  const [description, setDescription] = useState(place.description ?? "");
  const [imageData, setImageData] = useState(place.imageData ?? null);
  const [favorite, setFavorite] = useState(!!place.favorite);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await onSave({ name: name.trim(), description: description.trim() || undefined, imageData, favorite });
    setSaving(false);
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <Text style={styles.modalTitle}>Lugar guardado</Text>
      <ImageBlock value={imageData} onChange={setImageData} />
      <TextInput style={styles.input} placeholder="Nombre del lugar" value={name} onChangeText={setName} />
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
      <Pressable style={styles.primaryButton} onPress={submit} disabled={saving}>
        <Text style={styles.primaryButtonText}>{saving ? "Guardando…" : "Guardar"}</Text>
      </Pressable>
      <Pressable style={styles.deleteButton} onPress={onDelete}>
        <Text style={styles.deleteButtonText}>Eliminar lugar</Text>
      </Pressable>
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
  deleteX: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground, paddingHorizontal: 4 },
  addRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  addInput: { flex: 1 },
  addButton: { backgroundColor: colors.foreground, borderRadius: radius.input, width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  addButtonText: { fontFamily: fonts.sansBold, fontSize: 20, color: colors.background },

  placeRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  placeMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12 },
  placeThumb: { width: 52, height: 52, borderRadius: radius.input },
  placeThumbPlaceholder: { alignItems: "center", justifyContent: "center", backgroundColor: withAlpha(colors.positive, 0.12) },
  placeName: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.foreground },
  heart: { fontSize: 22, color: withAlpha(colors.mutedForeground, 0.6) },
  heartOn: { color: colors.destructive },
  favoriteToggle: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4, marginBottom: 8 },
  favoriteToggleText: { fontFamily: fonts.sans, fontSize: 14, color: colors.foreground },

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
