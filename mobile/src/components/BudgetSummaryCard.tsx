import { useState } from "react";
import { View, Pressable, Modal, ScrollView, KeyboardAvoidingView, ActivityIndicator } from "react-native";
import { Text, TextInput } from "./AppText";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, G } from "react-native-svg";
import { ApiError } from "../api/client";
import {
  BUDGET_COLORS,
  BudgetColor,
  BudgetSummary,
  BudgetSummaryCategory,
  createBudgetCategory,
  deleteBudgetCategory,
  updateBudgetCategory,
} from "../api/finance";
import { MonthPickerButton, Period, periodLabel } from "./MonthSwitcher";
import { colors, fonts, radius, shadow, themedStyles } from "../theme";

// Puerto de dashboard/src/components/BudgetSummaryCard.tsx: "Resumen del presupuesto" de Finanzas —
// un donut con los gastos del mes por categoría y, a sus lados, cada categoría con lo gastado frente
// a su máximo (su % de la última nómina o, sin nómina, de los ingresos del mes): la mitad a la izquierda con el texto alineado a la
// izquierda y la mitad a la derecha alineada a la derecha. Se pide y se edita por REST (ver
// api/finance.ts), así que necesita conexión: sin ella se avisa en vez de enseñar una tarjeta vacía.
//
// Las categorías se enlazan con los movimientos por NOMBRE (ver budgetService en el backend): apuntar
// un gasto con la categoría "Casa" suma a la porción de Casa; lo que no coincide con ninguna cae en
// "Otro".

function eur(n: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
}

function pct(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1).replace(".", ",")}%`;
}

// Los mismos 8 tokens de color que la web; "muted" se pinta con el gris de texto (el fondo `muted`
// sería casi invisible sobre la tarjeta).
function colorOf(color: BudgetColor): string {
  return color === "muted" ? colors.mutedForeground : colors[color];
}

const COLOR_LABELS: Record<BudgetColor, string> = {
  primary: "Verde salvia",
  habit: "Azul",
  positive: "Verde",
  hobby: "Naranja",
  warning: "Amarillo",
  negative: "Rojo",
  secondary: "Arena",
  muted: "Gris",
};

// Donut: geometría en unidades del viewBox.
const SIZE = 120;
const RADIUS = 46;
const STROKE = 16;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const DONUT_PX = 124;

interface Slice {
  key: string;
  color: BudgetColor;
  spent: number;
}

// En el centro, "gastado / máximo": el máximo es la suma de los máximos de las categorías; si lo
// gastado lo supera, sale en rojo, igual que en cada categoría.
function Donut({ slices, total, max }: { slices: Slice[]; total: number; max: number }) {
  let offset = 0;
  return (
    <View style={styles.donut}>
      <Svg width={DONUT_PX} height={DONUT_PX} viewBox={`0 0 ${SIZE} ${SIZE}`} accessibilityLabel="Gastos del mes por categoría">
        <G rotation={-90} origin={`${SIZE / 2}, ${SIZE / 2}`}>
          <Circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke={colors.muted} strokeWidth={STROKE} />
          {total > 0 &&
            slices
              .filter((s) => s.spent > 0)
              .map((s) => {
                const length = (s.spent / total) * CIRCUMFERENCE;
                const circle = (
                  <Circle
                    key={s.key}
                    cx={SIZE / 2}
                    cy={SIZE / 2}
                    r={RADIUS}
                    fill="none"
                    stroke={colorOf(s.color)}
                    strokeWidth={STROKE}
                    strokeDasharray={`${length} ${CIRCUMFERENCE - length}`}
                    strokeDashoffset={-offset}
                  />
                );
                offset += length;
                return circle;
              })}
        </G>
      </Svg>
      <View style={styles.donutCenter} pointerEvents="none">
        <Text style={[styles.donutTotal, total > max && { color: colors.destructive }]} numberOfLines={1} adjustsFontSizeToFit>
          {eur(total)}
        </Text>
        <Text style={styles.donutMax} numberOfLines={1} adjustsFontSizeToFit>
          / {eur(max)}
        </Text>
        <Text style={styles.donutCaption}>GASTADO</Text>
      </View>
    </View>
  );
}

type Side = "left" | "right";

// Una categoría a un lado del donut: su nombre, "gastado / presupuesto" con el lápiz de editar al
// lado y, debajo, su % de la nómina. Si se pasa de su máximo, el gasto sale en rojo.
function CategoryLabel({
  name,
  color,
  spent,
  budget,
  percent,
  side,
  onEdit,
}: {
  name: string;
  color: BudgetColor;
  spent: number;
  budget?: number; // sin presupuesto (p. ej. "Sin categoría") solo se enseña lo gastado
  percent?: number;
  side: Side;
  onEdit?: () => void;
}) {
  const right = side === "right";
  const over = budget !== undefined && spent > budget;
  const align = { alignItems: right ? ("flex-end" as const) : ("flex-start" as const) };
  return (
    <View style={[styles.label, align]}>
      <View style={[styles.labelNameRow, right && { flexDirection: "row-reverse" }]}>
        <View style={[styles.dot, { backgroundColor: colorOf(color) }]} />
        <Text style={[styles.labelName, { textAlign: right ? "right" : "left" }]} numberOfLines={2}>
          {name}
        </Text>
      </View>
      <View style={[styles.labelAmountRow, right && { flexDirection: "row-reverse" }]}>
        <Text style={[styles.labelAmount, over && styles.labelAmountOver]}>
          {budget === undefined ? eur(spent) : `${eur(spent)} / ${eur(budget)}`}
        </Text>
        {onEdit && (
          <Pressable onPress={onEdit} hitSlop={8} accessibilityLabel={`Editar ${name}`}>
            <Text style={styles.editIcon}>✎</Text>
          </Pressable>
        )}
      </View>
      {percent !== undefined && <Text style={styles.labelPercent}>{pct(percent)}</Text>}
    </View>
  );
}

// Formulario compartido por "añadir" (botón +) y "editar" (lápiz de cada categoría): nombre, color y
// % de la última nómina. Los errores del servidor (nombre repetido, pasarse del 100%...) se
// enseñan tal cual, que ya vienen redactados para el usuario.
function CategoryForm({
  initial,
  maxPercent,
  submitLabel,
  onSubmit,
  onCancel,
  onDelete,
}: {
  initial: { name: string; color: BudgetColor; percent: number };
  maxPercent: number;
  submitLabel: string;
  onSubmit: (values: { name: string; color: BudgetColor; percent: number }) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
}) {
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState(initial.color);
  const [percent, setPercent] = useState(String(initial.percent).replace(".", ","));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar. Inténtalo de nuevo.");
      setBusy(false);
    }
  };

  const submit = () => {
    const value = Number(percent.replace(",", "."));
    if (!name.trim() || !Number.isFinite(value) || value < 0 || value > 100) {
      setError("Pon un nombre y un porcentaje entre 0 y 100.");
      return;
    }
    run(() => onSubmit({ name: name.trim(), color, percent: value }));
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <Text style={styles.modalTitle}>{onDelete ? "Editar categoría" : "Nueva categoría"}</Text>
      <Text style={styles.fieldLabel}>Nombre</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} maxLength={50} placeholder="Nombre de la categoría" autoFocus />
      <Text style={[styles.fieldLabel, { marginTop: 12 }]}>% de tu última nómina</Text>
      <TextInput
        style={styles.input}
        value={percent}
        onChangeText={(t) => setPercent(t.replace(/[^0-9.,]/g, ""))}
        keyboardType="decimal-pad"
        accessibilityLabel="Porcentaje de la nómina"
      />
      <Text style={styles.hint}>{maxPercent > 0 ? `Puedes asignar hasta ${pct(maxPercent)}.` : "Ya has asignado el 100%."}</Text>
      <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Color</Text>
      <View style={styles.swatchRow}>
        {BUDGET_COLORS.map((c) => (
          <Pressable
            key={c}
            onPress={() => setColor(c)}
            accessibilityRole="radio"
            accessibilityState={{ selected: color === c }}
            accessibilityLabel={COLOR_LABELS[c]}
            style={[styles.swatch, { backgroundColor: colorOf(c) }, color === c && styles.swatchSelected]}
          />
        ))}
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <Pressable style={styles.primaryButton} onPress={submit} disabled={busy}>
        <Text style={styles.primaryButtonText}>{busy ? "Guardando…" : submitLabel}</Text>
      </Pressable>
      {onDelete ? (
        <Pressable style={styles.deleteButton} onPress={() => run(onDelete)} disabled={busy}>
          <Text style={styles.deleteButtonText}>Eliminar categoría</Text>
        </Pressable>
      ) : null}
      <Pressable style={styles.cancelButton} onPress={onCancel}>
        <Text style={styles.cancelButtonText}>Cancelar</Text>
      </Pressable>
    </ScrollView>
  );
}

export function BudgetSummaryCard({
  summary,
  failed,
  period,
  onPeriodChange,
  onChanged,
}: {
  summary: BudgetSummary | null;
  failed: boolean; // la última petición del presupuesto falló (sin conexión...)
  period: Period; // mes que se enseña (el botón de calendario de la cabecera lo cambia)
  onPeriodChange: (p: Period) => void;
  onChanged: () => Promise<void> | void;
}) {
  const insets = useSafeAreaInsets();
  // "new" = formulario de alta; una categoría = editándola.
  const [form, setForm] = useState<BudgetSummaryCategory | "new" | null>(null);

  if (!summary) {
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.cardTitle}>Resumen del presupuesto</Text>
            <Text style={styles.periodText}>{periodLabel(period)}</Text>
          </View>
          <MonthPickerButton value={period} onChange={onPeriodChange} />
        </View>
        {failed ? <Text style={styles.emptyText}>El presupuesto necesita conexión. Se cargará al volver a tenerla.</Text> : <ActivityIndicator color={colors.primary} />}
      </View>
    );
  }

  const slices: Slice[] = summary.categories.map((c) => ({ key: String(c.id), color: c.color, spent: c.spent }));
  if (summary.uncategorizedSpent > 0) slices.push({ key: "uncategorized", color: "muted", spent: summary.uncategorizedSpent });
  const total = slices.reduce((sum, s) => sum + s.spent, 0);

  // Color sugerido para una categoría nueva: el primero de la paleta que no esté en uso.
  const usedColors = new Set(summary.categories.map((c) => c.color));
  const suggestedColor = BUDGET_COLORS.find((c) => !usedColors.has(c)) ?? "primary";

  // Mitad a cada lado, en el orden de la lista (la izquierda se queda con la más grande si son impares).
  const categories = summary.categories;
  const leftCount = Math.ceil(categories.length / 2);
  const left = categories.slice(0, leftCount);
  const right = categories.slice(leftCount);

  // Categorías que ya han gastado más que su máximo, de más a menos pasadas. Sin base de presupuesto
  // (ni nómina ni ingresos aún) todo máximo es 0 y cualquier gasto "se pasaría": no se avisa.
  const overspent =
    summary.budgetBase.amount > 0
      ? categories.filter((c) => c.spent - c.budget > 0.5).sort((a, b) => b.spent - b.budget - (a.spent - a.budget))
      : [];
  const overspentText = [
    ...overspent.slice(0, 3).map((c) => `${c.name} (+${eur(c.spent - c.budget)})`),
    ...(overspent.length > 3 ? [`${overspent.length - 3} más`] : []),
  ].reduce((text, part, i, all) => (i === 0 ? part : `${text}${i === all.length - 1 ? " y " : ", "}${part}`), "");

  const finish = async () => {
    setForm(null);
    await onChanged();
  };

  const labelFor = (c: BudgetSummaryCategory, side: Side) => (
    <CategoryLabel key={c.id} name={c.name} color={c.color} spent={c.spent} budget={c.budget} percent={c.percent} side={side} onEdit={() => setForm(c)} />
  );

  const editing = form !== null && form !== "new" ? form : null;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.cardTitle}>Resumen del presupuesto</Text>
          <Text style={styles.periodText}>{periodLabel(period)}</Text>
          {/* De dónde sale el máximo de cada categoría (ver budgetService.getBudgetSummary) */}
          <Text style={styles.baseText}>
            {summary.budgetBase.source === "nomina" && summary.budgetBase.date
              ? `Sobre tu nómina del ${new Date(summary.budgetBase.date).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}: ${eur(summary.budgetBase.amount)}`
              : `Sin nómina registrada: sobre los ingresos del mes (${eur(summary.budgetBase.amount)})`}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <MonthPickerButton value={period} onChange={onPeriodChange} />
          <Pressable style={styles.plusButton} onPress={() => setForm("new")} hitSlop={8} accessibilityLabel="Añadir categoría">
            <Text style={styles.plusButtonText}>+</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.body}>
        <View style={[styles.column, { alignItems: "flex-start" }]}>{left.map((c) => labelFor(c, "left"))}</View>
        <Donut slices={slices} total={total} max={summary.totalBudget} />
        <View style={[styles.column, { alignItems: "flex-end" }]}>
          {right.map((c) => labelFor(c, "right"))}
          {summary.uncategorizedSpent > 0 && <CategoryLabel name="Sin categoría" color="muted" spent={summary.uncategorizedSpent} side="right" />}
        </View>
      </View>

      {categories.length === 0 && <Text style={styles.emptyText}>No tienes categorías. Añade una con el "+".</Text>}

      {overspent.length > 0 && (
        <View style={styles.alertBox} accessibilityRole="alert">
          <Text style={styles.alertText}>⚠ Te has pasado en {overspentText}.</Text>
        </View>
      )}

      {categories.length > 0 && (
        <Text style={styles.assignedText}>
          {summary.unassignedPercent > 0.005
            ? `Asignado ${pct(summary.assignedPercent)} · sin asignar ${pct(summary.unassignedPercent)}`
            : `Asignado ${pct(summary.assignedPercent)}`}
        </Text>
      )}

      <Modal visible={form !== null} animationType="slide" transparent onRequestClose={() => setForm(null)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior="padding">
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 20 }]}>
            {form === "new" && (
              <CategoryForm
                initial={{ name: "", color: suggestedColor, percent: Math.min(10, summary.unassignedPercent) }}
                maxPercent={summary.unassignedPercent}
                submitLabel="Añadir"
                onCancel={() => setForm(null)}
                onSubmit={async (values) => {
                  await createBudgetCategory(values);
                  await finish();
                }}
              />
            )}
            {editing && (
              <CategoryForm
                key={editing.id}
                initial={{ name: editing.name, color: editing.color, percent: editing.percent }}
                maxPercent={summary.unassignedPercent + editing.percent}
                submitLabel="Guardar"
                onCancel={() => setForm(null)}
                onSubmit={async (values) => {
                  await updateBudgetCategory(editing.id, values);
                  await finish();
                }}
                onDelete={async () => {
                  await deleteBudgetCategory(editing.id);
                  await finish();
                }}
              />
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = themedStyles(() => ({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    gap: 12,
    ...shadow,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardTitle: { fontFamily: fonts.sansBold, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.8, color: colors.mutedForeground },
  plusButton: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.foreground, alignItems: "center", justifyContent: "center" },
  plusButtonText: { fontFamily: fonts.sansBold, fontSize: 16, lineHeight: 18, color: colors.background },
  alertBox: { backgroundColor: colors.destructiveTint, borderRadius: radius.input, paddingHorizontal: 12, paddingVertical: 8 },
  alertText: { fontFamily: fonts.sans, fontSize: 12, color: colors.destructive },
  assignedText: { fontFamily: fonts.sans, fontSize: 11, color: colors.mutedForeground, textAlign: "center" },
  emptyText: { fontFamily: fonts.sans, fontSize: 13, color: colors.mutedForeground, fontStyle: "italic", textAlign: "center" },

  body: { flexDirection: "row", alignItems: "center", gap: 6 },
  column: { flex: 1, minWidth: 0, gap: 10 },
  donut: { width: DONUT_PX, height: DONUT_PX, alignItems: "center", justifyContent: "center" },
  donutCenter: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center", paddingHorizontal: 26 },
  donutTotal: { fontFamily: fonts.serif, fontSize: 20, color: colors.foreground },
  donutMax: { fontFamily: fonts.sans, fontSize: 10, color: colors.mutedForeground },
  baseText: { fontFamily: fonts.sans, fontSize: 11, color: colors.mutedForeground },
  periodText: { fontFamily: fonts.sansMedium, fontSize: 11, color: colors.foreground, opacity: 0.8, marginTop: 2 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  donutCaption: { fontFamily: fonts.sans, fontSize: 8, letterSpacing: 1.2, color: colors.mutedForeground },

  label: { gap: 2, maxWidth: "100%" },
  labelNameRow: { flexDirection: "row", alignItems: "center", gap: 4, maxWidth: "100%" },
  dot: { width: 6, height: 6, borderRadius: 3 },
  labelName: { fontFamily: fonts.sansMedium, fontSize: 11, color: colors.foreground, flexShrink: 1 },
  labelAmountRow: { flexDirection: "row", alignItems: "center", gap: 3, flexWrap: "wrap" },
  labelAmount: { fontFamily: fonts.sans, fontSize: 10, color: colors.mutedForeground },
  labelAmountOver: { fontFamily: fonts.sansMedium, color: colors.destructive },
  labelPercent: { fontFamily: fonts.sans, fontSize: 10, color: colors.mutedForeground },
  editIcon: { fontSize: 12, color: colors.mutedForeground },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(45,41,38,0.4)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card, padding: 20, maxHeight: "90%" },
  modalTitle: { fontFamily: fonts.serif, fontSize: 24, color: colors.foreground, marginBottom: 16 },
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
  hint: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground, marginTop: 4 },
  swatchRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 8 },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: "transparent" },
  swatchSelected: { borderColor: colors.foreground },
  errorText: { fontFamily: fonts.sans, fontSize: 12, color: colors.destructive, marginTop: 8 },
  primaryButton: { backgroundColor: colors.foreground, borderRadius: radius.full, paddingVertical: 13, alignItems: "center", marginTop: 12 },
  primaryButtonText: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.background },
  deleteButton: { alignItems: "center", padding: 14 },
  deleteButtonText: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.destructive },
  cancelButton: { alignItems: "center", padding: 10 },
  cancelButtonText: { fontFamily: fonts.sans, fontSize: 14, color: colors.mutedForeground },
}));
