import { useCallback, useEffect, useRef, useState } from "react";
import { View, Pressable, ScrollView, Alert, LayoutChangeEvent } from "react-native";
import { Text, TextInput } from "./AppText";
import Svg, { Circle, G, Line, Path, Text as SvgText } from "react-native-svg";
import { runSync } from "../sync";
import {
  listHabits,
  listHabitLogsForHabit,
  toggleHabitOnDate,
  createHabitLocal,
  renameHabitLocal,
  deleteHabitLocal,
} from "../db/habitsRepo";
import { LocalHabit } from "../types";
import { colors, fonts, radius, withAlpha, themedStyles } from "../theme";

const DAY_LETTERS = ["L", "M", "X", "J", "V", "S", "D"];

// Geometría del gráfico de progreso (ver HabitsProgressPanel) — mismas proporciones que el SVG de
// dashboard/src/components/HabitsTrackerCard.tsx, pero en píxeles reales en vez de un viewBox
// escalado, para que el texto de los ejes no se encoja en pantallas estrechas.
const CHART_H = 170;
const PAD_L = 34;
const PAD_R = 10;
const PAD_T = 12;
const PAD_B = 24;
// En la vista mensual cada día necesita un mínimo de ancho para que quepa su número debajo; si 31
// días no entran en la tarjeta, el gráfico se desplaza en horizontal.
const MONTH_MIN_POINT_SPACING = 20;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

// Fechas (lunes a domingo) de la semana en curso — mismo criterio que
// dashboard/src/components/HabitsTrackerCard.tsx: cada punto tiene una posición FIJA según el día
// de la semana, no una ventana deslizante de "últimos 7 días".
function currentWeekDates(): string[] {
  const today = new Date();
  const isoWeekday = (today.getDay() + 6) % 7; // 0 = lunes ... 6 = domingo (getDay() da 0 = domingo)
  const monday = new Date(today);
  monday.setDate(today.getDate() - isoWeekday);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

// Aritmética de calendario PURA en UTC, igual criterio (y mismo motivo) que AgendaScreen.tsx/
// dashboard/src/pages/AgendaPage.tsx: `todayKey()` de arriba y las fechas que de verdad se
// guardan en `completedDates` salen de `toISOString().slice(0,10)` (UTC), así que estas
// funciones tienen que construir/leer sus fechas en UTC también — mezclar con
// getFullYear/getMonth/getDate (hora LOCAL) desalinearía un día entero el "hoy" resaltado y el
// recuento de cada día para cualquier timezone por delante de UTC.
function utcMonthStart(offsetMonths: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetMonths, 1));
}

function monthDateKeys(monthStart: Date): string[] {
  const count = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) =>
    new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), i + 1)).toISOString().slice(0, 10)
  );
}

interface HabitWithLogs extends LocalHabit {
  completedDates: Set<string>;
}

/**
 * Puerto de dashboard/src/components/HabitsTrackerCard.tsx — misma tira de 7 puntos (lunes a
 * domingo) por hábito, mismos colores (bg-habit/10 border-habit/30), y mismas acciones: marcar
 * cualquier día de la semana en curso (los futuros quedan deshabilitados), crear, renombrar (tocar
 * el nombre) y borrar hábitos, y el panel de progreso con vista semanal/mensual.
 *
 * Todo es offline-first (SQLite + sync, ver habitsRepo.ts): marcas diarias y también crear/renombrar/
 * borrar hábitos se escriben primero en local (la tarjeta se refresca al instante) y suben por /sync
 * en cuanto hay conexión. Un hábito creado offline usa un id provisional hasta sincronizar, así que
 * tras cada sync se recarga la tarjeta para coger el id real.
 */
export function HabitsCard() {
  const [habits, setHabits] = useState<HabitWithLogs[]>([]);
  const [loaded, setLoaded] = useState(false);
  const days = currentWeekDates();
  const [showProgress, setShowProgress] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const list = await listHabits();
    const withLogs = await Promise.all(
      list.map(async (h) => {
        const logs = await listHabitLogsForHabit(h.id);
        return { ...h, completedDates: new Set(logs.map((l) => l.date)) };
      })
    );
    setHabits(withLogs);
    setLoaded(true);
  }, []);

  // Tras cada sync se recarga: puede haber cambiado el id de un hábito recién creado (provisional ->
  // de servidor) o haber bajado hábitos/marcas de otro dispositivo. `runSync` nunca rechaza (devuelve
  // un resultado) y comparte la promesa si ya hay un sync en curso, así que es barato llamarlo aquí.
  const syncThenReload = useCallback(() => {
    runSync().then(reload);
  }, [reload]);

  useEffect(() => {
    reload();
    syncThenReload();
  }, [reload, syncThenReload]);

  const handleToggleDay = async (habitId: number, date: string) => {
    // Los días que aún no han llegado no se pueden marcar (en la web tampoco tiene sentido
    // adelantar un hábito) — el botón ya va deshabilitado, esto es solo una red de seguridad.
    if (date > todayKey()) return;
    await toggleHabitOnDate(habitId, date);
    await reload();
    syncThenReload();
  };

  const handleAdd = async () => {
    const title = newTitle.trim();
    if (!title) return;
    setMessage(null);
    // Se vacía el campo antes de esperar a SQLite: un segundo "intro" no debe crear el hábito dos veces.
    setNewTitle("");
    setAdding(false);
    try {
      await createHabitLocal(title);
      await reload();
      syncThenReload();
    } catch {
      setMessage("No se pudo guardar el hábito.");
    }
  };

  const handleRename = async (id: number, title: string) => {
    setMessage(null);
    try {
      await renameHabitLocal(id, title);
      await reload();
      syncThenReload();
    } catch {
      setMessage("No se pudo renombrar el hábito.");
    }
  };

  const handleDelete = (habit: HabitWithLogs) => {
    // En la web el borrado es un ✕ al pasar el ratón; en el móvil un toque accidental es mucho más
    // fácil, y borrar un hábito se lleva por delante todo su historial — por eso pide confirmación.
    Alert.alert("Eliminar hábito", `¿Eliminar "${habit.title}" y todo su historial?`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: async () => {
          setMessage(null);
          try {
            await deleteHabitLocal(habit.id);
            await reload();
            syncThenReload();
          } catch {
            setMessage("No se pudo eliminar el hábito.");
          }
        },
      },
    ]);
  };

  if (!loaded) return null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>Hábitos diarios</Text>
        <View style={styles.headerButtons}>
          {habits.length > 0 && (
            <Pressable
              onPress={() => setShowProgress((v) => !v)}
              accessibilityLabel={showProgress ? "Ocultar progreso" : "Ver progreso"}
              hitSlop={6}
              style={[styles.circleButton, styles.progressButton, showProgress && styles.progressButtonActive]}
            >
              <Text style={[styles.progressButtonText, showProgress && styles.progressButtonTextActive]}>📈</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => setAdding((v) => !v)}
            accessibilityLabel={adding ? "Cerrar" : "Añadir hábito"}
            hitSlop={6}
            style={[styles.circleButton, styles.addButton]}
          >
            <Text style={styles.addButtonText}>{adding ? "×" : "+"}</Text>
          </Pressable>
        </View>
      </View>

      {adding && (
        <TextInput
          autoFocus
          style={styles.addInput}
          value={newTitle}
          onChangeText={setNewTitle}
          placeholder="Nombre del hábito"
          placeholderTextColor={colors.mutedForeground}
          returnKeyType="done"
          onSubmitEditing={handleAdd}
        />
      )}

      {message && <Text style={styles.message}>{message}</Text>}

      {habits.length === 0 ? (
        <Text style={styles.emptyText}>Todavía no tienes hábitos activos.</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {habits.map((habit, i) => (
            <HabitColumn
              key={habit.id}
              habit={habit}
              days={days}
              first={i === 0}
              onToggleDay={handleToggleDay}
              onRename={handleRename}
              onDelete={() => handleDelete(habit)}
            />
          ))}
        </ScrollView>
      )}

      {showProgress && habits.length > 0 && <HabitsProgressPanel habits={habits} weekDays={days} />}
    </View>
  );
}

function HabitColumn({
  habit,
  days,
  first,
  onToggleDay,
  onRename,
  onDelete,
}: {
  habit: HabitWithLogs;
  days: string[];
  first: boolean;
  onToggleDay: (habitId: number, date: string) => void;
  onRename: (id: number, title: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(habit.title);
  // Un ref además del estado: al pulsar "intro" el TextInput dispara onSubmitEditing y justo
  // después onBlur, y sin esto el renombrado se enviaría dos veces.
  const editingRef = useRef(false);
  const today = todayKey();

  const startEditing = () => {
    setTitle(habit.title);
    editingRef.current = true;
    setEditing(true);
  };

  const saveTitle = () => {
    if (!editingRef.current) return;
    editingRef.current = false;
    setEditing(false);
    const trimmed = title.trim();
    if (!trimmed || trimmed === habit.title) {
      setTitle(habit.title);
      return;
    }
    onRename(habit.id, trimmed);
  };

  return (
    <View style={[styles.column, !first && styles.columnBorder]}>
      <View style={styles.columnHeader}>
        {editing ? (
          <TextInput
            autoFocus
            style={styles.habitTitleInput}
            value={title}
            onChangeText={setTitle}
            onBlur={saveTitle}
            onSubmitEditing={saveTitle}
            returnKeyType="done"
          />
        ) : (
          <Pressable style={styles.habitTitleButton} onPress={startEditing} accessibilityLabel="Renombrar hábito">
            <Text style={styles.habitTitle} numberOfLines={1}>
              {habit.title}
            </Text>
          </Pressable>
        )}
        <Pressable onPress={onDelete} hitSlop={8} accessibilityLabel="Eliminar hábito">
          <Text style={styles.deleteMark}>✕</Text>
        </Pressable>
      </View>
      <View style={styles.dotsRow}>
        {days.map((date, di) => {
          const isToday = date === today;
          const isFuture = date > today;
          const isCompleted = habit.completedDates.has(date);
          return (
            <Pressable
              key={date}
              disabled={isFuture}
              onPress={() => onToggleDay(habit.id, date)}
              style={[styles.dotColumn, isFuture && styles.dotColumnFuture]}
            >
              <Text style={[styles.dayLetter, isToday && styles.dayLetterToday]}>{DAY_LETTERS[di]}</Text>
              <View style={[styles.dot, isCompleted ? styles.dotCompleted : styles.dotEmpty, isToday && styles.dotToday]} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Progreso de los hábitos (puerto de HabitsProgressPanel de la web): por cada día, el % de hábitos
 * activos que se marcaron ese día (3 de 4 = 75%), con un punto por día unidos por una línea. Vista
 * semanal (la semana en curso, lunes a domingo, igual que la tira de arriba) o mensual (con el mes
 * anterior a un toque: el servidor solo guarda ~62 días de historial, ver HISTORY_DAYS en
 * habitsService). Los días que aún no han llegado no se pintan: no son un 0%, son "todavía no".
 * Geometría calculada a mano sobre `react-native-svg`, sin librería de gráficos aparte.
 */
function HabitsProgressPanel({ habits, weekDays }: { habits: HabitWithLogs[]; weekDays: string[] }) {
  const [mode, setMode] = useState<"week" | "month">("week");
  const [monthOffset, setMonthOffset] = useState(0); // 0 = este mes, -1 = el anterior
  const [availableWidth, setAvailableWidth] = useState(0);
  const today = todayKey();

  const monthStart = utcMonthStart(monthOffset);
  const dates = mode === "week" ? weekDays : monthDateKeys(monthStart);
  const labels = mode === "week" ? DAY_LETTERS : dates.map((d) => String(Number(d.slice(8, 10))));

  const points = dates.map((date, i) => {
    const marked = habits.reduce((n, h) => (h.completedDates.has(date) ? n + 1 : n), 0);
    return { date, label: labels[i], marked, percent: Math.round((marked / habits.length) * 100), future: date > today };
  });
  const elapsed = points.filter((p) => !p.future);

  // Semana: el gráfico ocupa justo el ancho de la tarjeta. Mes: al menos MONTH_MIN_POINT_SPACING
  // por día; si no cabe, se desplaza en horizontal.
  const chartWidth =
    mode === "week" ? availableWidth : Math.max(availableWidth, PAD_L + PAD_R + points.length * MONTH_MIN_POINT_SPACING);
  const innerW = chartWidth - PAD_L - PAD_R;
  const innerH = CHART_H - PAD_T - PAD_B;
  const xOf = (i: number) => PAD_L + ((i + 0.5) * innerW) / points.length;
  const yOf = (percent: number) => PAD_T + innerH * (1 - percent / 100);
  const linePath = points
    .map((p, i) => (p.future ? null : `${i === 0 || points[i - 1].future ? "M" : "L"} ${xOf(i)} ${yOf(p.percent)}`))
    .filter(Boolean)
    .join(" ");

  const totalMarked = elapsed.reduce((n, p) => n + p.marked, 0);
  const average = elapsed.length > 0 ? Math.round(elapsed.reduce((n, p) => n + p.percent, 0) / elapsed.length) : null;
  const rawMonthLabel = monthStart.toLocaleDateString("es-ES", { month: "long", year: "numeric", timeZone: "UTC" });
  const monthLabel = rawMonthLabel.charAt(0).toUpperCase() + rawMonthLabel.slice(1);

  const onChartLayout = (e: LayoutChangeEvent) => setAvailableWidth(Math.floor(e.nativeEvent.layout.width));

  return (
    <View style={styles.progress}>
      <View style={styles.progressHeader}>
        <View style={styles.segmented}>
          {(["week", "month"] as const).map((m, i) => (
            <Pressable key={m} onPress={() => setMode(m)} style={[styles.segment, i > 0 && styles.segmentBorder, mode === m && styles.segmentActive]}>
              <Text style={[styles.segmentText, mode === m && styles.segmentTextActive]}>{m === "week" ? "Semana" : "Mes"}</Text>
            </Pressable>
          ))}
        </View>
        {mode === "month" && (
          <View style={styles.monthNav}>
            <Pressable onPress={() => setMonthOffset(-1)} disabled={monthOffset === -1} hitSlop={8} accessibilityLabel="Mes anterior">
              <Text style={[styles.monthNavButton, monthOffset === -1 && styles.monthNavButtonDisabled]}>‹</Text>
            </Pressable>
            <Text style={styles.monthNavLabel}>{monthLabel}</Text>
            <Pressable onPress={() => setMonthOffset(0)} disabled={monthOffset === 0} hitSlop={8} accessibilityLabel="Mes siguiente">
              <Text style={[styles.monthNavButton, monthOffset === 0 && styles.monthNavButtonDisabled]}>›</Text>
            </Pressable>
          </View>
        )}
      </View>

      <View onLayout={onChartLayout}>
        {availableWidth > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} scrollEnabled={chartWidth > availableWidth}>
            <Svg width={chartWidth} height={CHART_H}>
              {[0, 50, 100].map((tick) => (
                <G key={tick}>
                  <Line
                    x1={PAD_L}
                    x2={chartWidth - PAD_R}
                    y1={yOf(tick)}
                    y2={yOf(tick)}
                    stroke={withAlpha(colors.habit, 0.25)}
                    strokeWidth={1}
                    strokeDasharray="3 4"
                  />
                  <SvgText x={PAD_L - 6} y={yOf(tick) + 3} textAnchor="end" fontSize={10} fill={colors.mutedForeground} fontFamily={fonts.sans}>
                    {`${tick}%`}
                  </SvgText>
                </G>
              ))}
              {linePath !== "" && <Path d={linePath} fill="none" stroke={colors.habit} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
              {points.map((p, i) => (
                <G key={p.date}>
                  {!p.future && (
                    <Circle
                      cx={xOf(i)}
                      cy={yOf(p.percent)}
                      r={p.date === today ? 5 : 3.5}
                      fill={p.date === today ? colors.habit : colors.card}
                      stroke={colors.habit}
                      strokeWidth={p.date === today ? 0 : 1.8}
                    />
                  )}
                  <SvgText
                    x={xOf(i)}
                    y={CHART_H - 6}
                    textAnchor="middle"
                    fontSize={mode === "week" ? 11 : 9}
                    fill={p.date === today ? colors.habit : colors.mutedForeground}
                    fontFamily={p.date === today ? fonts.sansBold : fonts.sans}
                  >
                    {p.label}
                  </SvgText>
                </G>
              ))}
            </Svg>
          </ScrollView>
        )}
      </View>

      {average === null ? (
        <Text style={styles.progressEmpty}>Todavía no hay días para calcular el progreso.</Text>
      ) : (
        <View style={styles.summary}>
          <Text style={styles.summaryPercent}>{average}%</Text>
          <View style={styles.summaryTextBox}>
            <Text style={styles.summaryTitle}>Cumplimiento medio {mode === "week" ? "de la semana" : "del mes"}</Text>
            <Text style={styles.summaryDetail}>
              {totalMarked} {totalMarked === 1 ? "marca" : "marcas"} en {elapsed.length} {elapsed.length === 1 ? "día" : "días"} con{" "}
              {habits.length} {habits.length === 1 ? "hábito" : "hábitos"}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = themedStyles(() => ({
  // rounded-3xl border-habit/30 bg-habit/10 p-6 de la web.
  card: {
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderColor: withAlpha(colors.habit, 0.3),
    backgroundColor: withAlpha(colors.habit, 0.1),
    padding: 24,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 16 },
  headerButtons: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: {
    flex: 1,
    minWidth: 0,
    fontFamily: fonts.sansBold,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: colors.habit,
  },
  circleButton: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  progressButton: { borderWidth: 1, borderColor: colors.habit },
  progressButtonActive: { backgroundColor: colors.habit },
  progressButtonText: { fontSize: 12 },
  progressButtonTextActive: { color: colors.primaryForeground },
  addButton: { backgroundColor: colors.habit },
  addButtonText: { fontFamily: fonts.sansBold, fontSize: 16, lineHeight: 18, color: colors.primaryForeground },
  addInput: {
    backgroundColor: colors.background,
    borderRadius: radius.input,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.foreground,
  },
  message: { fontFamily: fonts.sans, fontSize: 12, color: colors.destructive, marginBottom: 12 },
  emptyText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.mutedForeground,
    fontStyle: "italic",
  },
  row: { gap: 16 },
  column: { minWidth: 128, gap: 6 },
  columnBorder: {
    borderLeftWidth: 1,
    borderLeftColor: withAlpha(colors.habit, 0.25),
    paddingLeft: 16,
  },
  columnHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  habitTitleButton: { flex: 1, minWidth: 0 },
  habitTitle: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.foreground,
  },
  habitTitleInput: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.habit,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.foreground,
  },
  deleteMark: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.mutedForeground },
  dotsRow: { flexDirection: "row", gap: 4 },
  dotColumn: { alignItems: "center", gap: 4 },
  dotColumnFuture: { opacity: 0.4 },
  dayLetter: { fontFamily: fonts.sans, fontSize: 9, color: colors.mutedForeground },
  dayLetterToday: { fontFamily: fonts.sansBold, color: colors.habit },
  dot: { width: 14, height: 14, borderRadius: 7 },
  dotEmpty: { backgroundColor: withAlpha(colors.habit, 0.15) },
  dotCompleted: { backgroundColor: colors.habit },
  dotToday: { borderWidth: 2, borderColor: colors.habit },

  // --- Panel de progreso (HabitsProgressPanel) ---
  progress: { marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: withAlpha(colors.habit, 0.25) },
  progressHeader: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 },
  segmented: {
    flexDirection: "row",
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: withAlpha(colors.habit, 0.4),
    overflow: "hidden",
  },
  segment: { paddingHorizontal: 12, paddingVertical: 4 },
  segmentBorder: { borderLeftWidth: 1, borderLeftColor: withAlpha(colors.habit, 0.4) },
  segmentActive: { backgroundColor: colors.habit },
  segmentText: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.habit },
  segmentTextActive: { color: colors.primaryForeground },
  monthNav: { flexDirection: "row", alignItems: "center", gap: 8 },
  monthNavButton: { fontFamily: fonts.sansBold, fontSize: 16, color: colors.habit, paddingHorizontal: 4 },
  monthNavButtonDisabled: { opacity: 0.3 },
  monthNavLabel: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.foreground, minWidth: 110, textAlign: "center" },
  progressEmpty: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground, marginTop: 8 },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginTop: 12,
    borderRadius: radius.input,
    backgroundColor: withAlpha(colors.habit, 0.1),
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  summaryPercent: { fontFamily: fonts.serif, fontSize: 30, color: colors.habit },
  summaryTextBox: { flex: 1, minWidth: 0 },
  summaryTitle: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.foreground },
  summaryDetail: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground },
}));
