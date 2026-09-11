import { useCallback, useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Modal, Switch, Platform } from "react-native";
// Ver el comentario de este mismo import en HoyScreen.tsx: el `SafeAreaView` de "react-native"
// está deprecado, este es el reemplazo recomendado.
import { SafeAreaView } from "react-native-safe-area-context";
import DateTimePicker, { DateTimePickerChangeEvent } from "@react-native-community/datetimepicker";
import { useFocusEffect } from "@react-navigation/native";
import { runSync } from "../sync";
import { listExpandedEvents, createEventLocal, updateEventLocal, deleteEventLocal, ParsedEvent } from "../db/eventsRepo";
import { EventOccurrence } from "../utils/recurrence";
import {
  listEventCategories,
  createEventCategory,
  renameEventCategory,
  changeEventCategoryColor,
  deleteEventCategory,
} from "../api/eventCategories";
import { eventCategoryLabel, eventCategoryStyle } from "../utils/eventCategories";
import { CALENDAR_COLOR_OPTIONS } from "../utils/calendarColors";
import {
  CalendarColor,
  EventCategory,
  RECURRING_PATTERNS,
  RECURRING_PATTERN_LABELS,
  RecurringPattern,
  REMINDER_PRESETS_MINUTES,
  REMINDER_PRESET_LABELS,
} from "../types";
import { colors, fonts, radius, shadow } from "../theme";
import { useSidebar, SIDEBAR_CLIP_CLEARANCE } from "../navigation/SidebarContext";
import { HabitsCard } from "../components/HabitsCard";
import { RecentEntriesCard } from "../components/RecentEntriesCard";
import { GoalsProgressCard } from "../components/GoalsProgressCard";
import { QuickNotesCard } from "../components/QuickNotesCard";

// Etiquetas de día en el mismo criterio "clave UTC" que `todayKey()` usa en el resto de la app
// (ver eventsRepo.ts) — una simplificación deliberada frente al manejo de timezone del backend
// (dateHelpers.ts/safeTimezone), documentada en el plan de esta fase.
const WEEKDAY_LABELS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function dateKeyOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function mondayOfWeek(date: Date): Date {
  const day = date.getUTCDay(); // 0 = domingo
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + diff));
  return monday;
}

function addDaysUTC(date: Date, n: number): Date {
  return new Date(date.getTime() + n * 86_400_000);
}

interface EventForm {
  id: string | null;
  title: string;
  description: string;
  categoryId: number | null;
  startTime: Date;
  endTime: Date;
  location: string;
  isRecurring: boolean;
  recurringPattern: RecurringPattern;
  reminders: Set<number>;
  guestsText: string;
}

function defaultForm(dateKey: string): EventForm {
  const startTime = new Date(`${dateKey}T12:00:00.000Z`);
  const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);
  return {
    id: null,
    title: "",
    description: "",
    // null hasta que llegue la primera categoría de la cuenta (ver el useEffect en
    // AgendaScreen que la precarga en cuanto `listEventCategories()` responde).
    categoryId: null,
    startTime,
    endTime,
    location: "",
    isRecurring: false,
    recurringPattern: "weekly",
    reminders: new Set(),
    guestsText: "",
  };
}

function formToOccurrenceEditor(event: ParsedEvent): EventForm {
  return {
    id: event.id,
    title: event.title,
    description: event.description ?? "",
    categoryId: event.categoryId,
    startTime: new Date(event.startTime),
    endTime: new Date(event.endTime),
    location: event.location ?? "",
    isRecurring: event.isRecurring,
    recurringPattern: (event.recurringPattern ?? "weekly") as RecurringPattern,
    reminders: new Set(event.reminderMinutesBefore),
    guestsText: event.guests.join(", "),
  };
}

export function AgendaScreen() {
  const { collapsed } = useSidebar();
  const [weekStart, setWeekStart] = useState(() => mondayOfWeek(new Date()));
  const [selectedDateKey, setSelectedDateKey] = useState(() => dateKeyOf(new Date()));
  const [occurrences, setOccurrences] = useState<EventOccurrence<ParsedEvent>[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [form, setForm] = useState<EventForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<"start-date" | "start-time" | "end-date" | "end-time" | null>(null);
  // Categorías de evento (Agenda > + Nuevo evento): igual que la leyenda del calendario anual,
  // se leen directas de la API (no pasan por SQLite/sync) — ver api/eventCategories.ts.
  const [categories, setCategories] = useState<EventCategory[]>([]);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [showCategoryManager, setShowCategoryManager] = useState(false);

  const reloadCategories = useCallback(async () => {
    try {
      setCategories(await listEventCategories());
      setCategoriesError(null);
    } catch {
      setCategoriesError("No se pudieron cargar las categorías");
    }
  }, []);

  useEffect(() => {
    reloadCategories();
  }, [reloadCategories]);

  // Precarga la primera categoría (por `order`) en cuanto llega, solo si el formulario abierto es
  // de un evento NUEVO (form.id === null) — un evento antiguo sin categoría (categoryId null, ver
  // el mismo comentario en dashboard/src/pages/AgendaPage.tsx) no debe verse "recategorizado" solo
  // por abrir su diálogo de edición.
  useEffect(() => {
    if (form && form.id === null && form.categoryId === null && categories.length > 0) {
      setForm({ ...form, categoryId: categories[0].id });
    }
  }, [form, categories]);

  const reload = useCallback(async () => {
    const rangeStart = weekStart;
    const rangeEnd = addDaysUTC(weekStart, 7);
    const rows = await listExpandedEvents(rangeStart, rangeEnd);
    setOccurrences(rows);
  }, [weekStart]);

  const sync = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    const result = await runSync();
    setSyncing(false);
    if (result.success) {
      await reload();
    } else {
      setSyncError(result.error ?? "No se pudo sincronizar");
    }
  }, [reload]);

  useFocusEffect(
    useCallback(() => {
      reload();
      sync();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [weekStart])
  );

  const weekDays = Array.from({ length: 7 }, (_, i) => addDaysUTC(weekStart, i));
  const dayEvents = occurrences
    .filter((occ) => dateKeyOf(occ.startTime) === selectedDateKey)
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  const goToWeek = (deltaWeeks: number) => setWeekStart((w) => addDaysUTC(w, deltaWeeks * 7));
  const goToToday = () => {
    const today = new Date();
    setWeekStart(mondayOfWeek(today));
    setSelectedDateKey(dateKeyOf(today));
  };

  const openCreate = () => setForm(defaultForm(selectedDateKey));
  const openEdit = (occ: EventOccurrence<ParsedEvent>) => setForm(formToOccurrenceEditor(occ.event));
  const closeForm = () => {
    setForm(null);
    setPicker(null);
    setShowCategoryManager(false);
  };

  const toggleReminder = (minutes: number) => {
    if (!form) return;
    const next = new Set(form.reminders);
    if (next.has(minutes)) next.delete(minutes);
    else next.add(minutes);
    setForm({ ...form, reminders: next });
  };

  const handleSave = async () => {
    if (!form || !form.title.trim() || form.endTime.getTime() <= form.startTime.getTime() || form.categoryId == null) return;
    setSaving(true);
    const guests = form.guestsText
      .split(",")
      .map((g) => g.trim())
      .filter(Boolean);
    const input = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      // `type` es la columna heredada (ver el comentario en types.ts/schema.ts) — se mantiene
      // rellena con el nombre de la categoría elegida, igual que hace el backend al crear/editar.
      type: categories.find((c) => c.id === form.categoryId)?.label ?? "Otro",
      categoryId: form.categoryId,
      startTime: form.startTime.toISOString(),
      endTime: form.endTime.toISOString(),
      location: form.location.trim() || null,
      isRecurring: form.isRecurring,
      recurringPattern: form.isRecurring ? form.recurringPattern : null,
      reminderMinutesBefore: Array.from(form.reminders),
      guests,
    };
    if (form.id) {
      await updateEventLocal(form.id, input);
    } else {
      await createEventLocal(input);
    }
    setSaving(false);
    closeForm();
    await reload();
    sync();
  };

  const handleDelete = async () => {
    if (!form?.id) return;
    await deleteEventLocal(form.id);
    closeForm();
    await reload();
    sync();
  };

  const onPickerChange = (field: "startTime" | "endTime", mode: "date" | "time") => (_event: DateTimePickerChangeEvent, selected: Date) => {
    setPicker(null);
    if (!form) return;
    const current = new Date(form[field]);
    if (mode === "date") current.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
    else current.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    setForm({ ...form, [field]: current });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.header, collapsed && { paddingLeft: SIDEBAR_CLIP_CLEARANCE }]}>
        <Text style={styles.title}>Agenda</Text>
        <View style={styles.headerRight}>
          <Text style={styles.syncText}>{syncing ? "Sincronizando…" : ""}</Text>
        </View>
      </View>
      {syncError && <Text style={styles.errorBanner}>{syncError} — se reintentará solo</Text>}

      <View style={styles.weekNav}>
        <Pressable onPress={() => goToWeek(-1)}>
          <Text style={styles.navButton}>‹ Semana</Text>
        </Pressable>
        <Pressable onPress={goToToday}>
          <Text style={styles.navButtonToday}>Hoy</Text>
        </Pressable>
        <Pressable onPress={() => goToWeek(1)}>
          <Text style={styles.navButton}>Semana ›</Text>
        </Pressable>
      </View>

      <View style={styles.weekStrip}>
        {weekDays.map((day) => {
          const key = dateKeyOf(day);
          const selected = key === selectedDateKey;
          return (
            <Pressable key={key} style={[styles.dayChip, selected && styles.dayChipSelected]} onPress={() => setSelectedDateKey(key)}>
              <Text style={[styles.dayChipWeekday, selected && styles.dayChipTextSelected]}>{WEEKDAY_LABELS[day.getUTCDay()]}</Text>
              <Text style={[styles.dayChipNumber, selected && styles.dayChipTextSelected]}>{day.getUTCDate()}</Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {dayEvents.length === 0 && <Text style={styles.emptyText}>Sin eventos este día</Text>}
        {dayEvents.map((occ) => (
          <Pressable key={`${occ.event.id}-${occ.startTime.toISOString()}`} style={styles.eventCard} onPress={() => openEdit(occ)}>
            <Text style={styles.eventTime}>
              {occ.startTime.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })} –{" "}
              {occ.endTime.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
            </Text>
            <View style={styles.eventInfo}>
              <Text style={styles.eventTitle}>{occ.event.title}</Text>
              <View style={[styles.eventTypeBadge, { backgroundColor: eventCategoryStyle(categories, occ.event.categoryId).bg }]}>
                <Text style={[styles.eventTypeText, { color: eventCategoryStyle(categories, occ.event.categoryId).text }]}>
                  {eventCategoryLabel(categories, occ.event)}
                </Text>
              </View>
              {occ.event.location ? <Text style={styles.eventLocation}>{occ.event.location}</Text> : null}
            </View>
            {occ.event.isRecurring && <Text style={styles.recurringBadge}>↻</Text>}
          </Pressable>
        ))}

        {/* Debajo de la vista semanal: mismos bloques que la web (dashboard/src/pages/AgendaPage.tsx),
            apilados en una sola columna en vez de la rejilla de dos columnas de escritorio. */}
        <View style={styles.extraSections}>
          <HabitsCard />
          <RecentEntriesCard />
          <GoalsProgressCard />
          <QuickNotesCard />
        </View>
      </ScrollView>

      <Pressable style={styles.fab} onPress={openCreate}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>

      <Modal visible={form !== null} animationType="slide" onRequestClose={closeForm} transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>{form?.id ? "Editar evento" : "Nuevo evento"}</Text>

              <TextInput
                style={styles.input}
                placeholder="Título"
                value={form?.title ?? ""}
                onChangeText={(t) => form && setForm({ ...form, title: t })}
              />
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                placeholder="Descripción (opcional)"
                value={form?.description ?? ""}
                onChangeText={(t) => form && setForm({ ...form, description: t })}
                multiline
              />

              <View style={styles.categoryHeaderRow}>
                <Text style={styles.fieldLabel}>Categoría</Text>
                <Pressable onPress={() => setShowCategoryManager((v) => !v)} hitSlop={6}>
                  <Text style={styles.manageCategoriesLink}>{showCategoryManager ? "Ocultar" : "Gestionar"}</Text>
                </Pressable>
              </View>
              {categoriesError && <Text style={styles.errorBanner}>{categoriesError}</Text>}
              <View style={styles.chipRow}>
                {categories.length === 0 && <Text style={styles.emptyText}>Sin categorías todavía</Text>}
                {categories.map((category) => (
                  <Pressable
                    key={category.id}
                    style={[styles.chip, form?.categoryId === category.id && styles.chipSelected]}
                    onPress={() => form && setForm({ ...form, categoryId: category.id })}
                  >
                    <Text style={[styles.chipText, form?.categoryId === category.id && styles.chipTextSelected]}>{category.label}</Text>
                  </Pressable>
                ))}
              </View>
              {showCategoryManager && (
                <EventCategoryManager
                  categories={categories}
                  onChanged={reloadCategories}
                  onError={(message) => setCategoriesError(message)}
                />
              )}

              <Text style={styles.fieldLabel}>Empieza</Text>
              <View style={styles.dateRow}>
                <Pressable style={styles.dateButton} onPress={() => setPicker("start-date")}>
                  <Text style={styles.dateButtonText}>{form?.startTime.toLocaleDateString("es-ES")}</Text>
                </Pressable>
                <Pressable style={styles.dateButton} onPress={() => setPicker("start-time")}>
                  <Text style={styles.dateButtonText}>
                    {form?.startTime.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                  </Text>
                </Pressable>
              </View>

              <Text style={styles.fieldLabel}>Termina</Text>
              <View style={styles.dateRow}>
                <Pressable style={styles.dateButton} onPress={() => setPicker("end-date")}>
                  <Text style={styles.dateButtonText}>{form?.endTime.toLocaleDateString("es-ES")}</Text>
                </Pressable>
                <Pressable style={styles.dateButton} onPress={() => setPicker("end-time")}>
                  <Text style={styles.dateButtonText}>{form?.endTime.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</Text>
                </Pressable>
              </View>

              <TextInput
                style={styles.input}
                placeholder="Ubicación (opcional)"
                value={form?.location ?? ""}
                onChangeText={(t) => form && setForm({ ...form, location: t })}
              />

              <View style={styles.switchRow}>
                <Text style={styles.fieldLabel}>Se repite</Text>
                <Switch
                  value={form?.isRecurring ?? false}
                  onValueChange={(v) => {
                    if (form) setForm({ ...form, isRecurring: v });
                  }}
                  trackColor={{ false: colors.muted, true: colors.primary }}
                  thumbColor={colors.card}
                />
              </View>
              {form?.isRecurring && (
                <View style={styles.chipRow}>
                  {RECURRING_PATTERNS.map((pattern) => (
                    <Pressable
                      key={pattern}
                      style={[styles.chip, form.recurringPattern === pattern && styles.chipSelected]}
                      onPress={() => setForm({ ...form, recurringPattern: pattern })}
                    >
                      <Text style={[styles.chipText, form.recurringPattern === pattern && styles.chipTextSelected]}>
                        {RECURRING_PATTERN_LABELS[pattern]}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}

              <Text style={styles.fieldLabel}>Avisos</Text>
              <View style={styles.chipRow}>
                {REMINDER_PRESETS_MINUTES.map((minutes) => (
                  <Pressable
                    key={minutes}
                    style={[styles.chip, form?.reminders.has(minutes) && styles.chipSelected]}
                    onPress={() => toggleReminder(minutes)}
                  >
                    <Text style={[styles.chipText, form?.reminders.has(minutes) && styles.chipTextSelected]}>
                      {REMINDER_PRESET_LABELS[minutes]}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <TextInput
                style={styles.input}
                placeholder="Invitados, separados por coma"
                value={form?.guestsText ?? ""}
                onChangeText={(t) => form && setForm({ ...form, guestsText: t })}
              />

              <Pressable style={styles.saveButton} onPress={handleSave} disabled={saving}>
                <Text style={styles.saveButtonText}>{saving ? "Guardando…" : "Guardar"}</Text>
              </Pressable>
              {form?.id && (
                <Pressable style={styles.deleteButton} onPress={handleDelete}>
                  <Text style={styles.deleteButtonText}>Borrar evento</Text>
                </Pressable>
              )}
              <Pressable style={styles.cancelButton} onPress={closeForm}>
                <Text style={styles.cancelButtonText}>Cancelar</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {form && picker === "start-date" && (
        <DateTimePicker
          value={form.startTime}
          mode="date"
          display={Platform.OS === "ios" ? "inline" : "default"}
          onValueChange={onPickerChange("startTime", "date")}
          onDismiss={() => setPicker(null)}
        />
      )}
      {form && picker === "start-time" && (
        <DateTimePicker
          value={form.startTime}
          mode="time"
          display="default"
          onValueChange={onPickerChange("startTime", "time")}
          onDismiss={() => setPicker(null)}
        />
      )}
      {form && picker === "end-date" && (
        <DateTimePicker
          value={form.endTime}
          mode="date"
          display={Platform.OS === "ios" ? "inline" : "default"}
          onValueChange={onPickerChange("endTime", "date")}
          onDismiss={() => setPicker(null)}
        />
      )}
      {form && picker === "end-time" && (
        <DateTimePicker
          value={form.endTime}
          mode="time"
          display="default"
          onValueChange={onPickerChange("endTime", "time")}
          onDismiss={() => setPicker(null)}
        />
      )}
    </SafeAreaView>
  );
}

// Gestión de categorías de evento (añadir, renombrar, recolorear o borrar, incluidas las que
// trae la cuenta por defecto) sin salir del formulario de creación/edición — puerto simplificado
// de CategoryChip/AddCategoryForm en components/AnnualCalendarLegend.tsx: aquí no hay "pintar
// días", solo la lista editable, y el borrado es directo (un toque, sin doble confirmación) igual
// que el resto de "✕" de esta app (ver el comentario de ese mismo criterio en AnnualCalendarLegend).
function EventCategoryManager({
  categories,
  onChanged,
  onError,
}: {
  categories: EventCategory[];
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [editingColorId, setEditingColorId] = useState<number | null>(null);

  const guarded = (action: () => Promise<unknown>) => async () => {
    try {
      await action();
      await onChanged();
    } catch {
      onError("No se pudo actualizar la categoría");
    }
  };

  return (
    <View style={managerStyles.card}>
      <Text style={managerStyles.title}>Categorías de evento</Text>
      <View style={managerStyles.list}>
        {categories.map((category) => {
          const swatch = CALENDAR_COLOR_OPTIONS.find((o) => o.key === category.color)?.swatch ?? colors.muted;
          const isRenaming = renamingId === category.id;
          return (
            <View key={category.id} style={managerStyles.chipWrap}>
              {isRenaming ? (
                <TextInput
                  style={managerStyles.renameInput}
                  value={renameValue}
                  onChangeText={setRenameValue}
                  autoFocus
                  onBlur={guarded(async () => {
                    const trimmed = renameValue.trim();
                    setRenamingId(null);
                    if (trimmed && trimmed !== category.label) await renameEventCategory(category.id, trimmed);
                  })}
                  onSubmitEditing={guarded(async () => {
                    const trimmed = renameValue.trim();
                    setRenamingId(null);
                    if (trimmed && trimmed !== category.label) await renameEventCategory(category.id, trimmed);
                  })}
                />
              ) : (
                <View style={managerStyles.chip}>
                  <Pressable
                    onPress={() => setEditingColorId((id) => (id === category.id ? null : category.id))}
                    hitSlop={6}
                    style={[managerStyles.chipSwatch, { backgroundColor: swatch }]}
                  />
                  <Text style={managerStyles.chipLabel}>{category.label}</Text>
                  <Pressable
                    onPress={() => {
                      setRenamingId(category.id);
                      setRenameValue(category.label);
                    }}
                    hitSlop={6}
                  >
                    <Text style={managerStyles.chipAction}>✎</Text>
                  </Pressable>
                  <Pressable onPress={guarded(() => deleteEventCategory(category.id))} hitSlop={6}>
                    <Text style={[managerStyles.chipAction, managerStyles.chipActionDelete]}>✕</Text>
                  </Pressable>
                </View>
              )}
              {editingColorId === category.id && (
                <View style={managerStyles.colorPicker}>
                  {CALENDAR_COLOR_OPTIONS.map((opt) => (
                    <Pressable
                      key={opt.key}
                      onPress={guarded(async () => {
                        setEditingColorId(null);
                        await changeEventCategoryColor(category.id, opt.key);
                      })}
                      style={[managerStyles.colorSwatch, { backgroundColor: opt.swatch }, category.color === opt.key && managerStyles.colorSwatchActive]}
                    />
                  ))}
                </View>
              )}
            </View>
          );
        })}

        {showAdd ? (
          <AddEventCategoryForm
            onCancel={() => setShowAdd(false)}
            onAdd={async (label, color) => {
              try {
                await createEventCategory(label, color);
                setShowAdd(false);
                await onChanged();
              } catch {
                onError("No se pudo crear la categoría");
              }
            }}
          />
        ) : (
          <Pressable style={managerStyles.addButton} onPress={() => setShowAdd(true)}>
            <Text style={managerStyles.addButtonText}>+ Categoría</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function AddEventCategoryForm({ onAdd, onCancel }: { onAdd: (label: string, color: CalendarColor) => Promise<void>; onCancel: () => void }) {
  const [label, setLabel] = useState("");
  const [color, setColor] = useState<CalendarColor>(CALENDAR_COLOR_OPTIONS[0].key);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await onAdd(trimmed, color);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={managerStyles.addForm}>
      <TextInput
        style={managerStyles.addFormInput}
        value={label}
        onChangeText={setLabel}
        placeholder="Nombre de la categoría"
        placeholderTextColor={colors.mutedForeground}
        autoFocus
      />
      <View style={managerStyles.colorPicker}>
        {CALENDAR_COLOR_OPTIONS.map((opt) => (
          <Pressable
            key={opt.key}
            onPress={() => setColor(opt.key)}
            style={[managerStyles.colorSwatch, { backgroundColor: opt.swatch }, color === opt.key && managerStyles.colorSwatchActive]}
          />
        ))}
      </View>
      <View style={managerStyles.addFormActions}>
        <Pressable style={managerStyles.addFormSubmit} onPress={submit} disabled={submitting}>
          <Text style={managerStyles.addFormSubmitText}>{submitting ? "Creando…" : "Crear"}</Text>
        </Pressable>
        <Pressable onPress={onCancel} hitSlop={6}>
          <Text style={managerStyles.addFormCancel}>Cancelar</Text>
        </Pressable>
      </View>
    </View>
  );
}

const managerStyles = StyleSheet.create({
  card: { marginTop: 4, marginBottom: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, padding: 10 },
  title: { fontFamily: fonts.sansBold, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6, color: colors.mutedForeground, marginBottom: 8 },
  list: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "flex-start" },
  chipWrap: { maxWidth: "100%" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: 10,
  },
  chipSwatch: { width: 12, height: 12, borderRadius: 6 },
  chipLabel: { fontFamily: fonts.sans, fontSize: 12, color: colors.foreground },
  chipAction: { fontFamily: fonts.sansMedium, fontSize: 10, color: colors.mutedForeground, paddingHorizontal: 2 },
  chipActionDelete: { color: colors.destructive, fontFamily: fonts.sansBold },
  renameInput: {
    borderBottomWidth: 1,
    borderBottomColor: colors.primary,
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.foreground,
    minWidth: 100,
    paddingVertical: 4,
  },
  colorPicker: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
    padding: 6,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  colorSwatch: { width: 18, height: 18, borderRadius: 9 },
  colorSwatchActive: { borderWidth: 2, borderColor: colors.foreground },
  addButton: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(95, 113, 97, 0.3)",
    backgroundColor: "rgba(95, 113, 97, 0.05)",
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  addButtonText: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.primary },
  addForm: { minWidth: 200, gap: 8, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 10 },
  addFormInput: {
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.input,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.foreground,
    backgroundColor: colors.background,
  },
  addFormActions: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 2 },
  addFormSubmit: { backgroundColor: colors.foreground, borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 8 },
  addFormSubmitText: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.background },
  addFormCancel: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, paddingBottom: 8 },
  title: { fontFamily: fonts.serif, fontSize: 30, color: colors.foreground },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  syncText: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground },
  errorBanner: { fontFamily: fonts.sans, fontSize: 12, color: colors.destructive, paddingHorizontal: 20, paddingBottom: 8 },
  weekNav: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingBottom: 8 },
  navButton: { fontFamily: fonts.sans, fontSize: 13, color: colors.mutedForeground },
  navButtonToday: { fontFamily: fonts.sansBold, fontSize: 13, color: colors.primary },
  weekStrip: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 8 },
  dayChip: { alignItems: "center", padding: 8, borderRadius: radius.input, width: 42 },
  dayChipSelected: { backgroundColor: colors.primary },
  dayChipWeekday: { fontFamily: fonts.sans, fontSize: 11, color: colors.mutedForeground },
  dayChipNumber: { fontFamily: fonts.sansBold, fontSize: 15, color: colors.foreground, marginTop: 2 },
  dayChipTextSelected: { color: colors.primaryForeground },
  list: { padding: 20, paddingTop: 8, gap: 10 },
  extraSections: { gap: 20, marginTop: 16, paddingBottom: 12 },
  emptyText: { fontFamily: fonts.sans, fontSize: 14, color: colors.mutedForeground, fontStyle: "italic" },
  eventCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 12,
    ...shadow,
  },
  eventTime: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground, width: 76 },
  eventInfo: { flex: 1, gap: 4 },
  eventTitle: { fontFamily: fonts.sansSemiBold, fontSize: 15, color: colors.foreground },
  eventTypeBadge: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.full },
  eventTypeText: { fontFamily: fonts.sansMedium, fontSize: 11 },
  eventLocation: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground },
  recurringBadge: { fontSize: 16, color: colors.primary },
  fab: {
    position: "absolute",
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    ...shadow,
  },
  fabText: { color: colors.primaryForeground, fontSize: 28, fontFamily: fonts.sansBold, marginTop: -2 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(45,41,38,0.4)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    padding: 20,
    maxHeight: "88%",
  },
  modalTitle: { fontFamily: fonts.serif, fontSize: 24, color: colors.foreground, marginBottom: 16 },
  input: {
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.input,
    padding: 12,
    marginBottom: 12,
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.foreground,
    backgroundColor: colors.card,
  },
  inputMultiline: { minHeight: 60, textAlignVertical: "top" },
  categoryHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  manageCategoriesLink: { fontFamily: fonts.sans, fontSize: 11, color: colors.mutedForeground, textDecorationLine: "underline" },
  fieldLabel: {
    fontFamily: fonts.sansBold,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: colors.mutedForeground,
    marginBottom: 6,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.full,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.primaryTint, borderColor: colors.primary },
  chipText: { fontFamily: fonts.sans, fontSize: 13, color: colors.mutedForeground },
  chipTextSelected: { fontFamily: fonts.sansMedium, color: colors.primary },
  dateRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  dateButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.input,
    padding: 12,
    backgroundColor: colors.card,
    alignItems: "center",
  },
  dateButtonText: { fontFamily: fonts.sans, fontSize: 14, color: colors.foreground },
  switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  saveButton: { backgroundColor: colors.primary, borderRadius: radius.full, padding: 15, alignItems: "center", marginTop: 8 },
  saveButtonText: { fontFamily: fonts.sansMedium, color: colors.primaryForeground, fontSize: 15 },
  deleteButton: { alignItems: "center", padding: 14 },
  deleteButtonText: { fontFamily: fonts.sansMedium, color: colors.destructive, fontSize: 14 },
  cancelButton: { alignItems: "center", padding: 10 },
  cancelButtonText: { fontFamily: fonts.sans, color: colors.mutedForeground, fontSize: 14 },
});
