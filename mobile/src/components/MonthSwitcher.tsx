import { useState } from "react";
import { View, Pressable, Modal } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { Text } from "./AppText";
import { colors, fonts, radius, shadow, withAlpha, themedStyles } from "../theme";

// Puerto de dashboard/src/components/MonthSwitcher.tsx: botón de calendario (junto al "+" de "Resumen del
// presupuesto") que abre un selector de mes. Elige el mes que enseñan el presupuesto, "Resumen del mes" y
// el top de categorías; no deja pasar del mes en curso y, fuera de él, ofrece volver a "este mes".

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

/** Solo el nombre del mes, en minúsculas: "octubre". */
export function monthName(p: Period): string {
  return new Date(p.year, p.month - 1, 1).toLocaleDateString("es-ES", { month: "long" });
}

const MONTH_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function CalendarIcon({ color }: { color: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Rect x={3} y={5} width={18} height={16} rx={3} />
      <Path d="M3 10h18M8 3v4M16 3v4" />
    </Svg>
  );
}

export function MonthPickerButton({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(value.year);
  const now = currentPeriod();
  const atCurrent = isCurrentPeriod(value);

  const openPicker = () => {
    setYear(value.year);
    setOpen(true);
  };
  const pick = (p: Period) => {
    onChange(p);
    setOpen(false);
  };

  return (
    <>
      <Pressable
        style={[styles.button, !atCurrent && styles.buttonActive]}
        onPress={openPicker}
        hitSlop={8}
        accessibilityLabel={`Elegir mes (${periodLabel(value)})`}
      >
        <CalendarIcon color={atCurrent ? colors.mutedForeground : colors.primary} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          {/* El segundo Pressable evita que tocar dentro de la tarjeta cierre el selector. */}
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.sheetTitle}>Elegir mes</Text>
            <View style={styles.yearRow}>
              <Pressable style={styles.yearArrow} onPress={() => setYear((y) => y - 1)} hitSlop={8} accessibilityLabel="Año anterior">
                <Text style={styles.yearArrowText}>‹</Text>
              </Pressable>
              <Text style={styles.yearText}>{year}</Text>
              <Pressable
                style={[styles.yearArrow, year >= now.year && styles.disabled]}
                onPress={() => setYear((y) => y + 1)}
                disabled={year >= now.year}
                hitSlop={8}
                accessibilityLabel="Año siguiente"
              >
                <Text style={styles.yearArrowText}>›</Text>
              </Pressable>
            </View>

            <View style={styles.grid}>
              {MONTH_SHORT.map((label, i) => {
                const month = i + 1;
                const future = year > now.year || (year === now.year && month > now.month);
                const selected = year === value.year && month === value.month;
                return (
                  <Pressable
                    key={label}
                    style={[styles.monthCell, selected && styles.monthCellSelected, future && styles.disabled]}
                    onPress={() => pick({ month, year })}
                    disabled={future}
                    accessibilityState={{ selected, disabled: future }}
                  >
                    <Text style={[styles.monthText, selected && styles.monthTextSelected]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {!atCurrent && (
              <Pressable onPress={() => pick(now)} style={styles.backButton}>
                <Text style={styles.backText}>Volver a este mes</Text>
              </Pressable>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = themedStyles(() => ({
  button: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonActive: { borderColor: colors.primary, backgroundColor: withAlpha(colors.primary, 0.1) },
  backdrop: { flex: 1, backgroundColor: "rgba(45,41,38,0.4)", alignItems: "center", justifyContent: "center", padding: 24 },
  sheet: { width: "100%", maxWidth: 320, backgroundColor: colors.card, borderRadius: radius.card, padding: 20, gap: 12, ...shadow },
  sheetTitle: { fontFamily: fonts.serif, fontSize: 22, color: colors.foreground },
  yearRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  yearArrow: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  yearArrowText: { fontFamily: fonts.sans, fontSize: 20, lineHeight: 22, color: colors.mutedForeground },
  yearText: { fontFamily: fonts.sansMedium, fontSize: 16, color: colors.foreground },
  disabled: { opacity: 0.3 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  monthCell: { flexBasis: "30%", flexGrow: 1, paddingVertical: 11, borderRadius: radius.input, alignItems: "center", borderWidth: 1, borderColor: colors.border },
  monthCellSelected: { backgroundColor: colors.foreground, borderColor: colors.foreground },
  monthText: { fontFamily: fonts.sans, fontSize: 14, color: colors.foreground },
  monthTextSelected: { color: colors.background },
  backButton: { alignItems: "center", paddingVertical: 8 },
  backText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.primary },
}));
