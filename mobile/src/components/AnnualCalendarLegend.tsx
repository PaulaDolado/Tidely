import { useCallback, useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { ApiError } from "../api/client";
import {
  listCategories,
  createCategory,
  renameCategory,
  changeCategoryColor,
  deleteCategory,
  listMarks,
  setDayMark,
} from "../api/calendarLegend";
import { CalendarColor, CalendarLegendCategory } from "../types";
import { CALENDAR_COLOR_CLASSES, CALENDAR_COLOR_OPTIONS } from "../utils/calendarColors";
import { colors, fonts, radius, withAlpha } from "../theme";

const MONTH_NAMES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const DAY_LETTERS = ["L", "M", "X", "J", "V", "S", "D"];

// Formato local YYYY-MM-DD — a propósito NO usa `Date.toISOString()`, ver el mismo comentario en
// dashboard/src/components/AnnualCalendarLegend.tsx.
function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Mismo criterio que la web: un "curso" de 11 meses (septiembre a julio), no el año natural.
function academicYearStart(offset: number): number {
  const now = new Date();
  const startYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return startYear + offset;
}

function monthWeeks(year: number, month: number): (Date | null)[][] {
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startWeekday = (firstDay.getDay() + 6) % 7; // 0 = lunes ... 6 = domingo
  const cells: (Date | null)[] = Array(startWeekday).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/**
 * Puerto de dashboard/src/components/AnnualCalendarLegend.tsx — mismo calendario de curso (11
 * meses) con leyenda de categorías pintables, mismos colores. Simplificación deliberada frente a
 * la web: pintar es tocar día a día (toggle), no arrastrar — la web usa `onMouseDown`/
 * `onMouseEnter` para pintar varios días arrastrando el ratón, gesto que no existe igual en
 * táctil; un solo toque por día ya cubre el caso de uso normal. Meses en una sola columna en vez
 * de la rejilla de hasta 4 columnas de escritorio (aquí no hay sitio para más de una).
 */
export function AnnualCalendarLegend() {
  const [categories, setCategories] = useState<CalendarLegendCategory[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);

  const [yearOffset, setYearOffset] = useState(0);
  const startYear = academicYearStart(yearOffset);

  const [marks, setMarks] = useState<Map<string, number>>(new Map());
  const [loadingMarks, setLoadingMarks] = useState(true);

  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [renamingCategoryId, setRenamingCategoryId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [editingColorCategoryId, setEditingColorCategoryId] = useState<number | null>(null);

  const reloadCategories = useCallback(async () => {
    setLoadingCategories(true);
    try {
      setCategories(await listCategories());
      setCategoriesError(null);
    } catch (err) {
      setCategoriesError(err instanceof ApiError ? err.message : "No se pudieron cargar las categorías");
    } finally {
      setLoadingCategories(false);
    }
  }, []);

  const reloadMarks = useCallback(async () => {
    setLoadingMarks(true);
    try {
      const list = await listMarks(`${startYear}-09-01`, `${startYear + 1}-07-31`);
      setMarks(new Map(list.map((m) => [m.date, m.categoryId])));
    } catch {
      // Silencioso a propósito: un fallo puntual al cambiar de curso no debe tirar toda la
      // pantalla de Horario, que vive por encima de este componente.
    } finally {
      setLoadingMarks(false);
    }
  }, [startYear]);

  useEffect(() => {
    reloadCategories();
  }, [reloadCategories]);

  useEffect(() => {
    reloadMarks();
  }, [reloadMarks]);

  // Copia local optimista: tocar un día actualiza esto al instante sin esperar la respuesta del
  // servidor. Tocar un día ya pintado con la categoría activa lo despinta (mismo criterio que la
  // web al "repintar" con el mismo valor).
  const toggleDay = (key: string) => {
    if (selectedCategoryId === null) return;
    const current = marks.get(key) ?? null;
    const nextValue = current === selectedCategoryId ? null : selectedCategoryId;
    setMarks((prev) => {
      const next = new Map(prev);
      if (nextValue === null) next.delete(key);
      else next.set(key, nextValue);
      return next;
    });
    setDayMark(key, nextValue).catch(() => reloadMarks());
  };

  const handleAddCategory = async (label: string, color: CalendarColor) => {
    await createCategory(label, color);
    setShowAddCategory(false);
    await reloadCategories();
  };

  const handleRenameCategory = async (id: number, label: string) => {
    await renameCategory(id, label);
    await reloadCategories();
  };

  const handleChangeColor = async (id: number, color: CalendarColor) => {
    setEditingColorCategoryId(null);
    await changeCategoryColor(id, color);
    await reloadCategories();
  };

  // Borrado directo, sin doble confirmación: la web pide un segundo clic ("¿Confirmar?"), pero
  // ese patrón depende de un hover que no existe en táctil — mismo criterio que ya usa
  // HorarioScreen.tsx para "Eliminar horario" y "✕" de fila (un solo toque, sin confirmar).
  const handleDeleteCategory = async (id: number) => {
    await deleteCategory(id);
    if (selectedCategoryId === id) setSelectedCategoryId(null);
    await reloadCategories();
    await reloadMarks();
  };

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Calendario anual</Text>
        <View style={styles.yearNav}>
          <Pressable style={styles.yearNavArrowBtn} onPress={() => setYearOffset((v) => v - 1)} hitSlop={6}>
            <Text style={styles.yearNavArrowText}>‹</Text>
          </Pressable>
          <Text style={styles.yearNavLabel}>
            {startYear}–{startYear + 1}
          </Text>
          <Pressable style={styles.yearNavArrowBtn} onPress={() => setYearOffset((v) => v + 1)} hitSlop={6}>
            <Text style={styles.yearNavArrowText}>›</Text>
          </Pressable>
          {yearOffset !== 0 && (
            <Pressable onPress={() => setYearOffset(0)} hitSlop={6}>
              <Text style={styles.yearNavReset}>Curso actual</Text>
            </Pressable>
          )}
        </View>
      </View>

      <Text style={styles.hint}>
        {selectedCategoryId === null
          ? "Elige una categoría de la leyenda de abajo y toca los días para pintarlos."
          : "Toca los días para pintarlos — tócalos otra vez para despintarlos."}
      </Text>

      {categoriesError && <Text style={styles.errorBanner}>{categoriesError}</Text>}

      {loadingCategories || loadingMarks ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 12 }} />
      ) : (
        <View style={styles.months}>
          {Array.from({ length: 11 }, (_, i) => {
            const monthDate = new Date(startYear, 8 + i, 1);
            const year = monthDate.getFullYear();
            const month = monthDate.getMonth();
            const weeks = monthWeeks(year, month);
            return (
              <View key={`${year}-${month}`} style={styles.monthCard}>
                <Text style={styles.monthTitle}>
                  {MONTH_NAMES[month]} {year}
                </Text>
                <View style={styles.weekHeader}>
                  {DAY_LETTERS.map((l, li) => (
                    <Text key={li} style={styles.weekHeaderLetter}>
                      {l}
                    </Text>
                  ))}
                </View>
                {weeks.map((week, wi) => (
                  <View key={wi} style={styles.weekRow}>
                    {week.map((day, di) => {
                      if (!day) return <View key={di} style={styles.dayCellEmpty} />;
                      const key = dateKey(day);
                      const categoryId = marks.get(key) ?? null;
                      const category = categories.find((c) => c.id === categoryId);
                      const classes = category ? CALENDAR_COLOR_CLASSES[category.color] : null;
                      return (
                        <Pressable
                          key={di}
                          onPress={() => toggleDay(key)}
                          style={[
                            styles.dayCell,
                            classes ? { backgroundColor: classes.cellBg, borderColor: classes.cellBorder } : styles.dayCellPlain,
                          ]}
                        >
                          <Text style={styles.dayCellText}>{day.getDate()}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
              </View>
            );
          })}
        </View>
      )}

      <View style={styles.legendCard}>
        <Text style={styles.legendTitle}>Leyenda</Text>
        <View style={styles.legendList}>
          {categories.map((category) => (
            <CategoryChip
              key={category.id}
              category={category}
              isSelected={selectedCategoryId === category.id}
              isRenaming={renamingCategoryId === category.id}
              renameValue={renameValue}
              onRenameValueChange={setRenameValue}
              isEditingColor={editingColorCategoryId === category.id}
              onSelect={() => setSelectedCategoryId((id) => (id === category.id ? null : category.id))}
              onStartRename={() => {
                setRenamingCategoryId(category.id);
                setRenameValue(category.label);
              }}
              onCommitRename={async () => {
                const trimmed = renameValue.trim();
                setRenamingCategoryId(null);
                if (trimmed && trimmed !== category.label) await handleRenameCategory(category.id, trimmed);
              }}
              onToggleColorPicker={() => setEditingColorCategoryId((id) => (id === category.id ? null : category.id))}
              onPickColor={(color) => handleChangeColor(category.id, color)}
              onDeletePress={() => handleDeleteCategory(category.id)}
            />
          ))}

          {showAddCategory ? (
            <AddCategoryForm onCancel={() => setShowAddCategory(false)} onAdd={handleAddCategory} />
          ) : (
            <Pressable style={styles.addCategoryButton} onPress={() => setShowAddCategory(true)}>
              <Text style={styles.addCategoryButtonText}>+ Categoría</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

function CategoryChip({
  category,
  isSelected,
  isRenaming,
  renameValue,
  onRenameValueChange,
  isEditingColor,
  onSelect,
  onStartRename,
  onCommitRename,
  onToggleColorPicker,
  onPickColor,
  onDeletePress,
}: {
  category: CalendarLegendCategory;
  isSelected: boolean;
  isRenaming: boolean;
  renameValue: string;
  onRenameValueChange: (v: string) => void;
  isEditingColor: boolean;
  onSelect: () => void;
  onStartRename: () => void;
  onCommitRename: () => void;
  onToggleColorPicker: () => void;
  onPickColor: (color: CalendarColor) => void;
  onDeletePress: () => void;
}) {
  const classes = CALENDAR_COLOR_CLASSES[category.color];
  return (
    <View style={styles.chipWrap}>
      {isRenaming ? (
        <TextInput
          style={styles.chipRenameInput}
          value={renameValue}
          onChangeText={onRenameValueChange}
          onBlur={onCommitRename}
          onSubmitEditing={onCommitRename}
          autoFocus
        />
      ) : (
        <View style={[styles.chip, isSelected && styles.chipSelected]}>
          <Pressable onPress={onToggleColorPicker} hitSlop={6} style={[styles.chipSwatch, { backgroundColor: classes.swatch }]} />
          <Pressable onPress={onSelect}>
            <Text style={styles.chipLabel}>{category.label}</Text>
          </Pressable>
          <Pressable onPress={onStartRename} hitSlop={6}>
            <Text style={styles.chipAction}>✎</Text>
          </Pressable>
          <Pressable onPress={onDeletePress} hitSlop={6}>
            <Text style={[styles.chipAction, styles.chipActionDelete]}>✕</Text>
          </Pressable>
        </View>
      )}
      {isEditingColor && (
        <View style={styles.colorPicker}>
          {CALENDAR_COLOR_OPTIONS.map((opt) => (
            <Pressable
              key={opt.key}
              onPress={() => onPickColor(opt.key)}
              style={[styles.colorSwatch, { backgroundColor: opt.swatch }, category.color === opt.key && styles.colorSwatchActive]}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function AddCategoryForm({ onAdd, onCancel }: { onAdd: (label: string, color: CalendarColor) => Promise<void>; onCancel: () => void }) {
  const [label, setLabel] = useState("");
  const [color, setColor] = useState<CalendarColor>(CALENDAR_COLOR_OPTIONS[0].key);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await onAdd(trimmed, color);
      setLabel("");
      setColor(CALENDAR_COLOR_OPTIONS[0].key);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.addForm}>
      <TextInput
        style={styles.addFormInput}
        value={label}
        onChangeText={setLabel}
        placeholder="Nombre de la categoría"
        placeholderTextColor={colors.mutedForeground}
        autoFocus
      />
      <View style={styles.colorPicker}>
        {CALENDAR_COLOR_OPTIONS.map((opt) => (
          <Pressable
            key={opt.key}
            onPress={() => setColor(opt.key)}
            style={[styles.colorSwatch, { backgroundColor: opt.swatch }, color === opt.key && styles.colorSwatchActive]}
          />
        ))}
      </View>
      <View style={styles.addFormActions}>
        <Pressable style={styles.addFormSubmit} onPress={submit} disabled={submitting}>
          <Text style={styles.addFormSubmitText}>{submitting ? "Creando…" : "Crear"}</Text>
        </Pressable>
        <Pressable onPress={onCancel} hitSlop={6}>
          <Text style={styles.addFormCancel}>Cancelar</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 32, paddingHorizontal: 20, paddingBottom: 20 },
  sectionHeader: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 },
  sectionTitle: { fontFamily: fonts.serif, fontSize: 22, color: colors.foreground },
  yearNav: { flexDirection: "row", alignItems: "center", gap: 8 },
  yearNavArrowBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 5 },
  yearNavArrowText: { fontFamily: fonts.sans, fontSize: 14, color: colors.mutedForeground },
  yearNavLabel: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.foreground, minWidth: 84, textAlign: "center" },
  yearNavReset: { fontFamily: fonts.sans, fontSize: 11, color: colors.mutedForeground, textDecorationLine: "underline" },

  hint: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground, marginBottom: 12 },
  errorBanner: { fontFamily: fonts.sans, fontSize: 12, color: colors.destructive, marginBottom: 8 },

  months: { gap: 16 },
  monthCard: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 12 },
  monthTitle: {
    fontFamily: fonts.sansBold,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: colors.mutedForeground,
    textAlign: "center",
    marginBottom: 8,
  },
  weekHeader: { flexDirection: "row", marginBottom: 4 },
  weekHeaderLetter: { flex: 1, textAlign: "center", fontFamily: fonts.sansMedium, fontSize: 10, color: colors.mutedForeground },
  weekRow: { flexDirection: "row" },
  dayCell: {
    flex: 1,
    aspectRatio: 1,
    margin: 2,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dayCellPlain: { borderColor: "transparent", backgroundColor: "transparent" },
  dayCellEmpty: { flex: 1, aspectRatio: 1, margin: 2 },
  dayCellText: { fontFamily: fonts.sans, fontSize: 11, color: colors.foreground },

  legendCard: { marginTop: 24, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 16 },
  legendTitle: { fontFamily: fonts.sansBold, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6, color: colors.mutedForeground, marginBottom: 12 },
  legendList: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "flex-start" },

  chipWrap: { maxWidth: "100%" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: 10,
  },
  chipSelected: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  chipSwatch: { width: 14, height: 14, borderRadius: 7 },
  chipLabel: { fontFamily: fonts.sans, fontSize: 13, color: colors.foreground },
  chipAction: { fontFamily: fonts.sansMedium, fontSize: 11, color: colors.mutedForeground, paddingHorizontal: 2 },
  chipActionDelete: { color: colors.destructive, fontFamily: fonts.sansBold },
  chipRenameInput: {
    borderBottomWidth: 1,
    borderBottomColor: colors.primary,
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.foreground,
    minWidth: 120,
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
    backgroundColor: colors.background,
  },
  colorSwatch: { width: 20, height: 20, borderRadius: 10 },
  colorSwatchActive: { borderWidth: 2, borderColor: colors.foreground },

  addCategoryButton: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: withAlpha(colors.primary, 0.3),
    backgroundColor: withAlpha(colors.primary, 0.05),
    borderRadius: radius.full,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  addCategoryButtonText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.primary },

  addForm: {
    minWidth: 220,
    gap: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    padding: 10,
  },
  addFormInput: {
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.input,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.foreground,
    backgroundColor: colors.card,
  },
  addFormActions: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 2 },
  addFormSubmit: { backgroundColor: colors.foreground, borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 8 },
  addFormSubmitText: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.background },
  addFormCancel: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground },
});
