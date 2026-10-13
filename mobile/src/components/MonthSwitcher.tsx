import { View, Pressable, StyleSheet } from "react-native";
import { Text } from "./AppText";
import { colors, fonts, withAlpha } from "../theme";

// Puerto de dashboard/src/components/MonthSwitcher.tsx: selector ‹ mes › de Finanzas. Elige el mes
// que enseñan "Resumen del presupuesto", "Resumen del mes" y el top de categorías; no deja pasar del
// mes en curso y, fuera de él, ofrece volver a "este mes" de un toque.

export interface Period {
  month: number; // 1-12
  year: number;
}

export function currentPeriod(): Period {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

export function isCurrentPeriod(p: Period): boolean {
  const now = currentPeriod();
  return p.month === now.month && p.year === now.year;
}

/** "octubre de 2026" → "Octubre de 2026" */
export function periodLabel(p: Period): string {
  const label = new Date(p.year, p.month - 1, 1).toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function shift(p: Period, delta: number): Period {
  const d = new Date(p.year, p.month - 1 + delta, 1);
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}

export function MonthSwitcher({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const atCurrent = isCurrentPeriod(value);
  return (
    <View style={styles.row} accessibilityLabel="Mes que se muestra">
      <Pressable style={styles.arrow} onPress={() => onChange(shift(value, -1))} hitSlop={6} accessibilityLabel="Mes anterior">
        <Text style={styles.arrowText}>‹</Text>
      </Pressable>
      <View style={styles.center}>
        <Text style={styles.label} numberOfLines={1}>
          {periodLabel(value)}
        </Text>
        {!atCurrent && (
          <Pressable onPress={() => onChange(currentPeriod())} hitSlop={6}>
            <Text style={styles.back}>Volver a este mes</Text>
          </Pressable>
        )}
      </View>
      <Pressable
        style={[styles.arrow, atCurrent && styles.arrowDisabled]}
        onPress={() => onChange(shift(value, 1))}
        disabled={atCurrent}
        hitSlop={6}
        accessibilityLabel="Mes siguiente"
        accessibilityState={{ disabled: atCurrent }}
      >
        <Text style={styles.arrowText}>›</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  arrow: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
  },
  arrowDisabled: { opacity: 0.3 },
  arrowText: { fontFamily: fonts.sans, fontSize: 18, lineHeight: 20, color: colors.mutedForeground },
  center: { flex: 1, alignItems: "center", minWidth: 0 },
  label: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.foreground },
  back: { fontFamily: fonts.sans, fontSize: 11, color: withAlpha(colors.primary, 1) },
});
