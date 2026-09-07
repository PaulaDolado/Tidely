import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, FlatList, StyleSheet, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNetInfo } from "@react-native-community/netinfo";
import { useAuth } from "../auth/AuthContext";
import { runSync } from "../sync";
import { listTodayEvents, ParsedEvent } from "../db/eventsRepo";
import { listTasksDueToday, toggleTaskDone } from "../db/tasksRepo";
import { listHabits, isHabitDoneToday, toggleHabitToday } from "../db/habitsRepo";
import { listNotes, createNoteLocal, toggleNoteChecked, deleteNoteLocal } from "../db/notesRepo";
import { EventOccurrence } from "../utils/recurrence";
import { LocalHabit, LocalNote, LocalTask } from "../types";
import { colors, fonts, radius, eventTypeStyle } from "../theme";
import { useSidebar, SIDEBAR_CLIP_CLEARANCE } from "../navigation/SidebarContext";
import { QuickAccessCard } from "../components/QuickAccessCard";
import { RecentEntriesCard } from "../components/RecentEntriesCard";

const SYNC_INTERVAL_MS = 60_000;

// Mapeo de tipos a etiquetas (igual que web)
const EVENT_TYPE_LABELS: Record<string, string> = {
  work: "Trabajo",
  study: "Estudio",
  gym: "Gimnasio",
  meeting: "Reunión",
  evento: "Evento",
  cita: "Cita",
  cumpleanos: "Cumpleaños",
  free: "Libre",
  otro: "Otro",
};

// Estilos especiales por tipo de sección (fondos, bordes y color del título tintados IGUAL que la
// web — antes "habits" llevaba el borde al 50% de opacidad "para que se viera más", pero eso
// hacía que la tarjeta no se pareciera al dashboard; ahora replica exactamente border-habit/30
// bg-habit/10 de dashboard/src/pages/HoyPage.tsx, y "notes" hace lo mismo con border-warning/30
// bg-warning/10 de QuickNotesCard.tsx).
type SectionType = "default" | "habits" | "notes";

function getSectionStyle(type: SectionType) {
  switch (type) {
    case "habits":
      // En web: border-habit/30 bg-habit/10 text-habit
      return {
        backgroundColor: "rgba(51, 131, 173, 0.1)", // habit 10%
        borderColor: "rgba(51, 131, 173, 0.3)", // habit 30%
        borderWidth: 1.5,
        titleColor: colors.habit,
      };
    case "notes": 
      // En web: border-warning/30 bg-warning/10 text-warning
      return {
        backgroundColor: "rgba(200, 123, 0, 0.1)", // warning 10%
        borderColor: "rgba(200, 123, 0, 0.3)", // warning 30%
        borderWidth: 1.5,
        titleColor: colors.warning,
      };
    default:
      // En web: border-border bg-card (blanco/crema) text-muted-foreground
      return {
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderWidth: 1,
        titleColor: colors.mutedForeground,
      };
  }
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function HoyScreen() {
  const { user, logout } = useAuth();
  const { isConnected } = useNetInfo();
  const { collapsed } = useSidebar();

  const [events, setEvents] = useState<EventOccurrence<ParsedEvent>[]>([]);
  const [tasks, setTasks] = useState<LocalTask[]>([]);
  const [habits, setHabits] = useState<(LocalHabit & { done: boolean })[]>([]);
  const [notes, setNotes] = useState<LocalNote[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [nextEvents, nextTasks, nextHabits, nextNotes] = await Promise.all([
      listTodayEvents(),
      listTasksDueToday(),
      listHabits(),
      listNotes(),
    ]);
    const habitsWithDone = await Promise.all(
      nextHabits.map(async (h) => ({
        ...h,
        done: await isHabitDoneToday(h.id),
      }))
    );
    setEvents(nextEvents);
    setTasks(nextTasks);
    setHabits(habitsWithDone);
    setNotes(nextNotes);
  }, []);

  const sync = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    const result = await runSync();
    setSyncing(false);
    if (result.success) {
      setLastSyncedAt(result.at);
      await reload();
    } else {
      setSyncError(result.error ?? "No se pudo sincronizar");
    }
  }, [reload]);

  useEffect(() => {
    reload();
    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wasConnected = useRef(isConnected);
  useEffect(() => {
    if (isConnected && !wasConnected.current) sync();
    wasConnected.current = isConnected;
  }, [isConnected, sync]);

  useEffect(() => {
    const id = setInterval(() => {
      if (isConnected) sync();
    }, SYNC_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isConnected, sync]);

  const handleToggleTask = async (id: string) => {
    await toggleTaskDone(id);
    await reload();
    sync();
  };

  const handleToggleHabit = async (id: number) => {
    await toggleHabitToday(id);
    await reload();
    sync();
  };

  const handleToggleNote = async (id: string) => {
    await toggleNoteChecked(id);
    await reload();
    sync();
  };

  const handleDeleteNote = async (id: string) => {
    await deleteNoteLocal(id);
    await reload();
    sync();
  };

  const handleAddNote = async () => {
    const content = noteDraft.trim();
    if (!content) return;
    setNoteDraft("");
    await createNoteLocal(content);
    await reload();
    sync();
  };

  const todayDate = new Date();
  const habitsCompletedToday = habits.filter((h) => h.done).length;
  const showStreak = habitsCompletedToday > 0;

  return (
    <SafeAreaView style={styles.container}>
      {/* HEADER */}
      <View style={[styles.header, collapsed && { paddingLeft: SIDEBAR_CLIP_CLEARANCE }]}>
        <View style={styles.headerLeft}>
          <Text style={styles.title}>Hoy</Text>
          <Text style={styles.dateSubtitle}>{formatDate(todayDate)}</Text>
        </View>
        <View style={styles.headerRight}>
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor: isConnected ? colors.primary : colors.destructive,
              },
            ]}
          />
          <Text style={styles.statusText}>
            {isConnected ? "En línea" : "Sin conexión"}
          </Text>
        </View>
      </View>

      {/* SYNC BAR */}
      <View style={styles.syncBar}>
        <Text style={styles.syncText}>
          {syncing
            ? "Sincronizando…"
            : lastSyncedAt
              ? `Última sync: ${formatTime(new Date(lastSyncedAt))}`
              : "Sin sincronizar aún"}
        </Text>
        <Pressable
          style={styles.syncButtonContainer}
          onPress={sync}
          disabled={syncing}
        >
          {syncing ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={styles.syncButton}>Sincronizar</Text>
          )}
        </Pressable>
      </View>

      {syncError && (
        <Text style={styles.errorBanner}>
          {syncError} — se reintentará solo
        </Text>
      )}

      {/* RACHA BANNER */}
      {showStreak && (
        <View style={styles.streakBanner}>
          <Text style={styles.streakText}>
            🔥 Racha combinada: {habitsCompletedToday} día
            {habitsCompletedToday === 1 ? "" : "s"}
          </Text>
        </View>
      )}

      <FlatList
        data={[{ key: "content" }]}
        keyExtractor={(item) => item.key}
        renderItem={() => (
          <View style={styles.content}>
            {/* EVENTOS */}
            <Section title="📅 Eventos de hoy">
              {events.length === 0 && (
                <EmptyText text="Sin eventos hoy — día libre." />
              )}
              {events.map((occ) => {
                const typeStyle = eventTypeStyle(occ.event.type);
                return (
                  <View
                    key={`${occ.event.id}-${occ.startTime.toISOString()}`}
                    style={styles.eventRow}
                  >
                    <Text style={styles.eventTime}>
                      {formatTime(occ.startTime)}
                    </Text>
                    <View style={styles.eventContent}>
                      <Text
                        style={styles.eventTitle}
                        numberOfLines={1}
                      >
                        {occ.event.title}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.eventTypeBadge,
                        { backgroundColor: typeStyle.bg },
                      ]}
                    >
                      <Text
                        style={[
                          styles.eventTypeBadgeText,
                          { color: typeStyle.text },
                        ]}
                      >
                        {EVENT_TYPE_LABELS[occ.event.type] ||
                          occ.event.type}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </Section>

            {/* TAREAS */}
            <Section title="✅ Tareas con vencimiento hoy">
              {tasks.length === 0 && (
                <EmptyText text="Ninguna tarea vence hoy." />
              )}
              {tasks.map((t) => (
                <Pressable
                  key={t.id}
                  style={styles.taskRow}
                  onPress={() => handleToggleTask(t.id)}
                >
                  <Checkbox checked={t.status === "done"} />
                  <Text
                    style={[
                      styles.taskTitle,
                      t.status === "done" && styles.taskTitleDone,
                    ]}
                    numberOfLines={2}
                  >
                    {t.title}
                  </Text>
                  {(t.synced === 0 || t.pendingOp === "update") && (
                    <Text style={styles.pendingTag}>pendiente</Text>
                  )}
                </Pressable>
              ))}
            </Section>

            {/* ENTRADAS RECIENTES EN TUS LIBRETAS */}
            <RecentEntriesCard />

            {/* HÁBITOS */}
            <Section title="🔁 Hábitos" type="habits">
              {habits.length === 0 && (
                <EmptyText text="Todavía no tienes hábitos activos." />
              )}
              {habits.map((h) => (
                <View key={h.id} style={styles.habitRow}>
                  <Text
                    style={[
                      styles.habitTitle,
                      h.done && styles.habitTitleDone,
                    ]}
                  >
                    {h.title}
                  </Text>
                  <Pressable
                    style={[
                      styles.habitButton,
                      h.done && styles.habitButtonDone,
                    ]}
                    onPress={() => handleToggleHabit(h.id)}
                  >
                    <Text
                      style={[
                        styles.habitButtonText,
                        h.done && styles.habitButtonTextDone,
                      ]}
                    >
                      {h.done ? "✓ Hecho" : "Marcar"}
                    </Text>
                  </Pressable>
                </View>
              ))}
            </Section>

            {/* NOTAS RÁPIDAS */}
            <Section title="📝 Notas rápidas" type="notes">
              <View style={styles.noteInputRow}>
                <TextInput
                  style={styles.noteInput}
                  placeholder="Nueva nota…"
                  placeholderTextColor={colors.mutedForeground}
                  value={noteDraft}
                  onChangeText={setNoteDraft}
                  onSubmitEditing={handleAddNote}
                />
                <Pressable
                  style={styles.addButton}
                  onPress={handleAddNote}
                >
                  <Text style={styles.addButtonText}>+</Text>
                </Pressable>
              </View>
              {notes.length === 0 && <EmptyText text="Sin notas" />}
              {notes.map((n) => (
                <View key={n.id} style={styles.noteRow}>
                  <Pressable
                    style={styles.noteContent}
                    onPress={() => handleToggleNote(n.id)}
                  >
                    <Checkbox checked={n.checked === 1} />
                    <Text
                      style={[
                        styles.noteText,
                        n.checked === 1 && styles.noteTextDone,
                      ]}
                      numberOfLines={2}
                    >
                      {n.content}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => handleDeleteNote(n.id)}>
                    <Text style={styles.deleteText}>Borrar</Text>
                  </Pressable>
                </View>
              ))}
            </Section>

            {/* ACCESO RÁPIDO */}
            <QuickAccessCard />

            <Pressable style={styles.logoutButton} onPress={logout}>
              <Text style={styles.logoutText}>Cerrar sesión</Text>
            </Pressable>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

function Section({
  title,
  children,
  type = "default",
}: {
  title: string;
  children: React.ReactNode;
  type?: SectionType;
}) {
  const sectionStyle = getSectionStyle(type);
  return (
    // El título vive DENTRO del recuadro de color (como el <h2> dentro de <section className="...
    // p-6"> en la web), no fuera de él — antes el título flotaba por encima de una caja aparte con
    // menos padding, así que el recuadro se veía más pequeño y menos "tarjeta" que en escritorio.
    <View
      style={[
        styles.section,
        {
          backgroundColor: sectionStyle.backgroundColor,
          borderColor: sectionStyle.borderColor,
          borderWidth: sectionStyle.borderWidth,
        },
      ]}
    >
      <Text style={[styles.sectionTitle, { color: sectionStyle.titleColor }]}>{title}</Text>
      <View style={styles.sectionContent}>{children}</View>
    </View>
  );
}

function EmptyText({ text }: { text: string }) {
  return <Text style={styles.emptyText}>{text}</Text>;
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <View
      style={[
        styles.checkbox,
        checked && styles.checkboxChecked,
      ]}
    >
      {checked && <Text style={styles.checkboxMark}>✓</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  // ========== LAYOUT BASE ==========
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 20,
    paddingTop: 12,
    gap: 24,
    paddingBottom: 40,
  },

  // ========== HEADER ==========
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
  },
  headerLeft: {
    flex: 1,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 32,
    fontWeight: "600",
    color: colors.foreground,
  },
  dateSubtitle: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.mutedForeground,
    marginTop: 2,
    textTransform: "capitalize",
  },
  userSubtitle: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.mutedForeground,
    marginTop: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.mutedForeground,
  },

  // ========== SYNC BAR ==========
  syncBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
  },
  syncText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.mutedForeground,
    flex: 1,
  },
  syncButtonContainer: {
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  syncButton: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 12,
    color: colors.primary,
  },
  errorBanner: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.destructive,
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: colors.destructiveTint,
    borderBottomWidth: 1,
    borderBottomColor: colors.destructive,
  },

  // ========== RACHA BANNER ==========
  streakBanner: {
    marginHorizontal: 20,
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.habitTint,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.habit + "50",
  },
  streakText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 13,
    color: colors.habit,
    textAlign: "center",
  },

  // ========== SECTIONS ==========
  // rounded-3xl + p-6 (24px) de la web — antes esto tenía menos padding (16/12) y sin radio en el
  // wrapper exterior (el radio vivía en sectionContent, que ahora ya no lleva fondo/borde propios,
  // ver Section más arriba). Sin sombra (`shadow`, con `elevation` para Android) a propósito: en
  // Android, `elevation` sobre un fondo translúcido (bg-habit/10, bg-warning/10 — un color con
  // alpha, no sólido) pinta un halo grueso del mismo tono pegado al borde en vez de una sombra
  // suave, porque el sistema compone la sombra por debajo del fondo semitransparente y ambos se
  // mezclan visualmente. QuickAccessCard (también con fondo translúcido) nunca llevó sombra por
  // esto mismo — aquí se sigue el mismo criterio: solo borde, sin elevación.
  section: {
    borderRadius: radius.card,
    padding: 24,
  },
  sectionTitle: {
    fontFamily: fonts.sansBold,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 16, // mb-4 de la web
  },
  sectionContent: {
    gap: 8, // flex flex-col gap-2 de la web
  },

  // ========== EVENTOS ==========
  eventRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 0,
  },
  eventRowLast: {
    borderBottomWidth: 0,
  },
  eventTime: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.mutedForeground,
    width: 44,
    fontWeight: "500",
  },
  eventContent: {
    flex: 1,
    minWidth: 0,
  },
  eventTitle: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.foreground,
    fontWeight: "500",
  },
  eventTypeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.full,
    alignSelf: "flex-start",
  },
  eventTypeBadgeText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 9,
    fontWeight: "600",
  },

  // ========== TAREAS ==========
  taskRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 0,
  },
  taskTitle: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.foreground,
    flex: 1,
  },
  taskTitleDone: {
    textDecorationLine: "line-through",
    color: colors.mutedForeground,
  },
  pendingTag: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    color: colors.warning,
    backgroundColor: colors.warningTint,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: "hidden",
  },

  // ========== HÁBITOS ==========
  habitRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 0,
    gap: 10,
  },
  habitTitle: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.foreground,
    flex: 1,
  },
  habitTitleDone: {
    textDecorationLine: "line-through",
    color: colors.mutedForeground,
  },
  habitButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.habit + "60",
  },
  habitButtonDone: {
    backgroundColor: colors.habit,
    borderColor: colors.habit,
  },
  habitButtonText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 11,
    color: colors.habit,
    fontWeight: "600",
  },
  habitButtonTextDone: {
    color: colors.primaryForeground,
  },

  // ========== CHECKBOX ==========
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkboxMark: {
    color: colors.primaryForeground,
    fontSize: 12,
    fontFamily: fonts.sansBold,
  },

  // ========== NOTAS ==========
  noteInputRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  noteInput: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: radius.input,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.foreground,
  },
  addButton: {
    width: 40,
    backgroundColor: colors.primary,
    borderRadius: radius.input,
    alignItems: "center",
    justifyContent: "center",
  },
  addButtonText: {
    color: colors.primaryForeground,
    fontSize: 22,
    fontFamily: fonts.sansBold,
  },
  noteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 0,
    // El renglón de una hoja de libreta, igual que border-b border-warning/30 en QuickNotesCard.
    borderBottomWidth: 1,
    borderBottomColor: "rgba(200, 123, 0, 0.3)",
  },
  noteContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  noteText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.foreground,
    flex: 1,
  },
  noteTextDone: {
    textDecorationLine: "line-through",
    color: colors.mutedForeground,
  },
  deleteText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 12,
    color: colors.destructive,
    fontWeight: "600",
  },
  emptyText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.mutedForeground,
    fontStyle: "italic",
    paddingVertical: 8,
  },

  // ========== LOGOUT ==========
  logoutButton: {
    alignItems: "center",
    paddingVertical: 16,
    marginTop: 8,
  },
  logoutText: {
    fontFamily: fonts.sansSemiBold,
    color: colors.destructive,
    fontSize: 14,
    fontWeight: "600",
  },
});
