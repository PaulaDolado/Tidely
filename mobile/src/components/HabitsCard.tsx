import { useCallback, useEffect, useState } from "react";
import { View, Pressable, ScrollView, StyleSheet } from "react-native";
import { Text } from "./AppText";
import Svg, { Circle, Line, Path } from "react-native-svg";
import { runSync } from "../sync";
import { listHabits, listHabitLogsForHabit, toggleHabitToday } from "../db/habitsRepo";
import { LocalHabit } from "../types";
import { colors, fonts, radius, withAlpha } from "../theme";

const DAY_LETTERS = ["L", "M", "X", "J", "V", "S", "D"];

// Geometría del gráfico de evolución mensual (ver HabitsEvolutionChart) — un punto por día,
// separados lo bastante para que quepa el número del día debajo sin solaparse.
const POINT_SPACING = 22;
const CHART_HEIGHT = 120;
const CHART_PADDING_TOP = 14;
const CHART_PADDING_BOTTOM = 10;

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
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonths(date: Date, n: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + n, 1));
}

function daysInMonth(monthStart: Date): number {
  return new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)).getUTCDate();
}

/** Clave "YYYY-MM-DD" del día `day` (1-indexado) del mes de `monthStart` — mismo formato que
 * `completedDates` (ver `todayKey()`/`toggleHabitToday` en habitsRepo.ts). */
function dateKeyOf(monthStart: Date, day: number): string {
  return `${monthStart.getUTCFullYear()}-${pad2(monthStart.getUTCMonth() + 1)}-${pad2(day)}`;
}

interface HabitWithLogs extends LocalHabit {
  completedDates: Set<string>;
}

/**
 * Puerto de dashboard/src/components/HabitsTrackerCard.tsx — misma tira de 7 puntos (lunes a
 * domingo) por hábito, mismos colores (bg-habit/10 border-habit/30). A diferencia de la web, el
 * móvil solo puede marcar/desmarcar HOY (ver habitsRepo.ts: "el móvil no crea/edita hábitos, solo
 * marca el día"), así que los puntos de otros días son de solo lectura y no hay alta, renombrado
 * ni borrado de hábitos aquí — eso solo se puede hacer desde la web.
 */
export function HabitsCard() {
  const [habits, setHabits] = useState<HabitWithLogs[]>([]);
  const [loaded, setLoaded] = useState(false);
  const days = currentWeekDates();
  const [showChart, setShowChart] = useState(false);
  const [chartMonth, setChartMonth] = useState(() => startOfMonth(new Date()));

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

  useEffect(() => {
    reload();
  }, [reload]);

  const handleToggleToday = async (habitId: number) => {
    await toggleHabitToday(habitId);
    await reload();
    runSync();
  };

  if (!loaded) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Hábitos diarios</Text>
      {habits.length === 0 ? (
        <Text style={styles.emptyText}>Todavía no tienes hábitos activos.</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {habits.map((habit, i) => (
            <View key={habit.id} style={[styles.column, i > 0 && styles.columnBorder]}>
              <Text style={styles.habitTitle} numberOfLines={1}>
                {habit.title}
              </Text>
              <View style={styles.dotsRow}>
                {days.map((date, di) => {
                  const isToday = date === todayKey();
                  const isCompleted = habit.completedDates.has(date);
                  return (
                    <Pressable
                      key={date}
                      disabled={!isToday}
                      onPress={() => handleToggleToday(habit.id)}
                      style={styles.dotColumn}
                    >
                      <Text style={[styles.dayLetter, isToday && styles.dayLetterToday]}>{DAY_LETTERS[di]}</Text>
                      <View style={[styles.dot, isCompleted ? styles.dotCompleted : styles.dotEmpty, isToday && styles.dotToday]} />
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      {habits.length > 0 && (
        <>
          <Pressable style={styles.chartToggle} onPress={() => setShowChart((v) => !v)}>
            <Text style={styles.chartToggleText}>{showChart ? "Ocultar gráfico" : "📈 Ver gráfico"}</Text>
          </Pressable>
          {showChart && (
            <View style={styles.chartSection}>
              <View style={styles.chartNav}>
                <Pressable onPress={() => setChartMonth((m) => addMonths(m, -1))} hitSlop={8}>
                  <Text style={styles.chartNavButton}>‹</Text>
                </Pressable>
                <Text style={styles.chartNavLabel}>
                  {chartMonth.toLocaleDateString("es-ES", { month: "long", year: "numeric", timeZone: "UTC" })}
                </Text>
                <Pressable onPress={() => setChartMonth((m) => addMonths(m, 1))} hitSlop={8}>
                  <Text style={styles.chartNavButton}>›</Text>
                </Pressable>
              </View>
              <HabitsEvolutionChart habits={habits} monthStart={chartMonth} />
            </View>
          )}
        </>
      )}
    </View>
  );
}

/**
 * Evolución diaria del mes: un punto por día con el número de hábitos marcados ESE día (de 0 al
 * total de hábitos activos), unidos por líneas — a diferencia de la tira semanal de arriba (un
 * hábito por columna), aquí se agregan TODOS los hábitos en una sola serie para ver los picos
 * ("hoy hice 4 de 5 hábitos") de un vistazo. Sin equivalente en la web todavía — nuevo, no un
 * puerto — pero mismo criterio visual que el resto de gráficos del móvil (GoalsProgressCard):
 * geometría calculada a mano sobre `react-native-svg`, sin librería de gráficos aparte.
 */
function HabitsEvolutionChart({ habits, monthStart }: { habits: HabitWithLogs[]; monthStart: Date }) {
  const total = habits.length;
  const days = daysInMonth(monthStart);
  const counts = Array.from({ length: days }, (_, i) => {
    const key = dateKeyOf(monthStart, i + 1);
    return habits.reduce((n, h) => (h.completedDates.has(key) ? n + 1 : n), 0);
  });

  const maxY = Math.max(1, total);
  const chartWidth = Math.max(days * POINT_SPACING, 200);
  const plotHeight = CHART_HEIGHT - CHART_PADDING_TOP - CHART_PADDING_BOTTOM;
  const xOf = (i: number) => i * POINT_SPACING + POINT_SPACING / 2;
  const yOf = (count: number) => CHART_PADDING_TOP + plotHeight * (1 - count / maxY);

  const linePath = counts.map((count, i) => `${i === 0 ? "M" : "L"} ${xOf(i)} ${yOf(count)}`).join(" ");
  const now = new Date();
  const todayIndex =
    now.getUTCFullYear() === monthStart.getUTCFullYear() && now.getUTCMonth() === monthStart.getUTCMonth() ? now.getUTCDate() - 1 : -1;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <Svg width={chartWidth} height={CHART_HEIGHT}>
        <Line
          x1={0}
          y1={yOf(0)}
          x2={chartWidth}
          y2={yOf(0)}
          stroke={withAlpha(colors.habit, 0.25)}
          strokeWidth={1}
          strokeDasharray="2 3"
        />
        <Line
          x1={0}
          y1={yOf(maxY)}
          x2={chartWidth}
          y2={yOf(maxY)}
          stroke={withAlpha(colors.habit, 0.25)}
          strokeWidth={1}
          strokeDasharray="2 3"
        />
        {counts.length > 1 && <Path d={linePath} stroke={colors.habit} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />}
        {counts.map((count, i) => (
          <Circle
            key={i}
            cx={xOf(i)}
            cy={yOf(count)}
            r={i === todayIndex ? 4.5 : 3}
            fill={i === todayIndex ? colors.habit : colors.card}
            stroke={colors.habit}
            strokeWidth={i === todayIndex ? 0 : 1.5}
          />
        ))}
      </Svg>
      <View style={styles.chartDayLabels}>
        {counts.map((_, i) => (
          <Text key={i} style={[styles.chartDayLabel, { width: POINT_SPACING }, i === todayIndex && styles.chartDayLabelToday]}>
            {i + 1}
          </Text>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // rounded-3xl border-habit/30 bg-habit/10 p-6 de la web.
  card: {
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderColor: withAlpha(colors.habit, 0.3),
    backgroundColor: withAlpha(colors.habit, 0.1),
    padding: 24,
  },
  title: {
    fontFamily: fonts.sansBold,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: colors.habit,
    marginBottom: 16,
  },
  emptyText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.mutedForeground,
    fontStyle: "italic",
  },
  row: { gap: 16 },
  column: { minWidth: 104, gap: 6 },
  columnBorder: {
    borderLeftWidth: 1,
    borderLeftColor: withAlpha(colors.habit, 0.25),
    paddingLeft: 16,
  },
  habitTitle: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.foreground,
  },
  dotsRow: { flexDirection: "row", gap: 4 },
  dotColumn: { alignItems: "center", gap: 4 },
  dayLetter: { fontFamily: fonts.sans, fontSize: 9, color: colors.mutedForeground },
  dayLetterToday: { fontFamily: fonts.sansBold, color: colors.habit },
  dot: { width: 14, height: 14, borderRadius: 7 },
  dotEmpty: { backgroundColor: withAlpha(colors.habit, 0.15) },
  dotCompleted: { backgroundColor: colors.habit },
  dotToday: { borderWidth: 2, borderColor: colors.habit },

  // --- Gráfico de evolución mensual (HabitsEvolutionChart) ---
  chartToggle: { alignSelf: "flex-start", marginTop: 16 },
  chartToggleText: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.habit },
  chartSection: { marginTop: 12 },
  chartNav: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 },
  chartNavButton: { fontFamily: fonts.sansBold, fontSize: 15, color: colors.habit, paddingHorizontal: 4 },
  chartNavLabel: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.foreground, textTransform: "capitalize" },
  chartDayLabels: { flexDirection: "row" },
  chartDayLabel: { fontFamily: fonts.sans, fontSize: 9, color: colors.mutedForeground, textAlign: "center" },
  chartDayLabelToday: { fontFamily: fonts.sansBold, color: colors.habit },
});
