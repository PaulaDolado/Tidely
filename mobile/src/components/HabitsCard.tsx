import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { runSync } from "../sync";
import { listHabits, listHabitLogsForHabit, toggleHabitToday } from "../db/habitsRepo";
import { LocalHabit } from "../types";
import { colors, fonts, radius, withAlpha } from "../theme";

const DAY_LETTERS = ["L", "M", "X", "J", "V", "S", "D"];

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
    </View>
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
});
