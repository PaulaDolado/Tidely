import { useCallback, useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Modal, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { ApiError } from "../api/client";
import {
  contributeSavingsGoal,
  createSavingsGoal,
  deleteSavingsGoal,
  listSavingsGoals,
  NewSavingsGoalInput,
  SavingsGoal,
  SavingsGoalType,
} from "../api/finance";
import { colors, fonts, radius, shadow, withAlpha } from "../theme";
import { useSidebar, SIDEBAR_CLIP_CLEARANCE } from "../navigation/SidebarContext";

// Puerto directo de dashboard/src/pages/MetasAhorroPage.tsx + dashboard/src/components/
// SavingsGoals.tsx — mismo "grid de casillas" (cada casilla = stepAmount, tocarla aporta o retira
// dinero de verdad vía POST .../contribute, que crea una Transaction real; el progreso no se
// guarda, se recalcula siempre desde las Transactions de esa categoría — ver src/api/finance.ts).
// No pasa por SQLite, igual que Finanzas/Horario/Objetivos.

const PREVIEW_BOXES = 30;
const MAX_TOTAL_BOXES = 2000;
const TYPE_LABELS: Record<SavingsGoalType, string> = { ahorro: "Ahorro", inversion: "Inversión" };

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(amount);
}

function boxLabel(amount: number): string {
  if (amount >= 1000) {
    const k = amount / 1000;
    const rounded = Math.round(k * 10) / 10;
    return `${rounded.toString().replace(".", ",")}k€`;
  }
  return `${Math.round(amount)}€`;
}

// Mismo slug que dashboard/src/components/SavingsGoals.tsx:211-218 — el usuario nunca ve ni
// escribe esta categoría, solo sirve para filtrar qué Transactions cuentan para la meta.
function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Mismo criterio que paceStatus() en dashboard/src/pages/MetasAhorroPage.tsx:25-35: verde si no
// hay fecha límite o ya se llegó al 100%; si no, compara el % de progreso con el % de tiempo
// transcurrido entre la creación y la fecha límite.
function paceStatus(goal: SavingsGoal): "green" | "yellow" {
  if (!goal.deadline || goal.progressPercent >= 100) return "green";
  const start = new Date(goal.createdAt);
  const end = new Date(goal.deadline);
  const now = new Date();
  const daysTotal = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
  const daysElapsed = Math.min(daysTotal, Math.max(0, Math.round((now.getTime() - start.getTime()) / 86_400_000)));
  if (daysElapsed <= 0) return "green";
  const expectedPercent = (daysElapsed / daysTotal) * 100;
  return goal.progressPercent >= expectedPercent * 0.8 ? "green" : "yellow";
}

const TABS: { value: SavingsGoalType | "all"; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "ahorro", label: "Ahorro" },
  { value: "inversion", label: "Inversión" },
];

export function MetasAhorroScreen() {
  const { collapsed } = useSidebar();
  const [tab, setTab] = useState<SavingsGoalType | "all">("all");
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [allGoals, setAllGoals] = useState<SavingsGoal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [boxesModalGoal, setBoxesModalGoal] = useState<SavingsGoal | null>(null);

  const reload = useCallback(async (currentTab: SavingsGoalType | "all") => {
    setLoading(true);
    setError(null);
    try {
      const [list, all] = await Promise.all([listSavingsGoals(currentTab), currentTab === "all" ? Promise.resolve(null) : listSavingsGoals("all")]);
      setGoals(list);
      setAllGoals(currentTab === "all" ? list : (all ?? []));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar las metas de ahorro");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload(tab);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab])
  );

  const handleCreate = async (input: { name: string; type: SavingsGoalType; targetAmount: number; stepAmount: number }) => {
    const category = `${input.type}-${slugify(input.name)}`;
    const payload: NewSavingsGoalInput = { ...input, category };
    await createSavingsGoal(payload);
    setShowCreate(false);
    await reload(tab);
  };

  const handleDelete = async (id: number) => {
    await deleteSavingsGoal(id);
    await reload(tab);
  };

  const handleContribute = async (id: number, amount: number) => {
    await contributeSavingsGoal(id, amount);
    await reload(tab);
    if (boxesModalGoal?.id === id) {
      const refreshed = await listSavingsGoals("all");
      setBoxesModalGoal(refreshed.find((g) => g.id === id) ?? null);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.header, collapsed && { paddingLeft: SIDEBAR_CLIP_CLEARANCE }]}>
        <Text style={styles.title}>Metas de ahorro</Text>
        <Pressable style={styles.newButton} onPress={() => setShowCreate(true)}>
          <Text style={styles.newButtonText}>+ Nueva</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {error && <Text style={styles.errorBanner}>{error}</Text>}

        <ProgressOverview goals={allGoals} />

        <View style={styles.tabRow}>
          {TABS.map((t) => (
            <Pressable key={t.value} style={[styles.tabChip, tab === t.value && styles.tabChipSelected]} onPress={() => setTab(t.value)}>
              <Text style={[styles.tabChipText, tab === t.value && styles.tabChipTextSelected]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>

        {loading && goals.length === 0 ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
        ) : goals.length === 0 ? (
          <Text style={styles.emptyText}>No hay metas de ahorro en esta categoría.</Text>
        ) : (
          <View style={{ gap: 16 }}>
            {goals.map((goal) => (
              <SavingsGoalCard
                key={goal.id}
                goal={goal}
                onDelete={() => handleDelete(goal.id)}
                onContribute={(amount) => handleContribute(goal.id, amount)}
                onOpenAllBoxes={() => setBoxesModalGoal(goal)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      <Modal visible={showCreate} animationType="slide" transparent onRequestClose={() => setShowCreate(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <NewSavingsGoalForm onCancel={() => setShowCreate(false)} onSubmit={handleCreate} />
          </View>
        </View>
      </Modal>

      <Modal visible={boxesModalGoal !== null} animationType="slide" transparent onRequestClose={() => setBoxesModalGoal(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            {boxesModalGoal && (
              <ScrollView>
                <Text style={styles.modalTitle}>{boxesModalGoal.name}</Text>
                <BoxesGrid goal={boxesModalGoal} limit={MAX_TOTAL_BOXES} onContribute={(amount) => handleContribute(boxesModalGoal.id, amount)} />
                <Pressable style={styles.cancelButton} onPress={() => setBoxesModalGoal(null)}>
                  <Text style={styles.cancelButtonText}>Cerrar</Text>
                </Pressable>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function ProgressOverview({ goals }: { goals: SavingsGoal[] }) {
  return (
    <View style={styles.overviewCard}>
      <Text style={styles.overviewTitle}>Progreso de tus metas de ahorro</Text>
      {goals.length === 0 ? (
        <Text style={styles.emptyText}>No tienes metas de ahorro todavía.</Text>
      ) : (
        <View style={{ gap: 10 }}>
          {goals.map((goal) => {
            const status = paceStatus(goal);
            const color = status === "green" ? colors.positive : colors.warning;
            const percent = Math.min(100, Math.round(goal.progressPercent));
            return (
              <View key={goal.id} style={styles.overviewRow}>
                <View style={styles.overviewRowHeader}>
                  <Text style={styles.overviewRowTitle} numberOfLines={1}>
                    {goal.name}
                  </Text>
                  <Text style={[styles.overviewPercent, { color }]}>{percent}%</Text>
                </View>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${percent}%`, backgroundColor: color }]} />
                </View>
                <Text style={[styles.overviewStatus, { color }]}>{status === "green" ? "Al ritmo previsto" : "Por detrás del ritmo"}</Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function BoxesGrid({ goal, limit, onContribute }: { goal: SavingsGoal; limit: number; onContribute: (amount: number) => void }) {
  const step = goal.stepAmount > 0 ? goal.stepAmount : 100;
  const boxCount = Math.min(limit, Math.max(1, Math.ceil(goal.targetAmount / step)));
  const filled = Math.min(boxCount, Math.round(goal.currentAmount / step));

  const handlePress = (index: number) => {
    const newFilled = index + 1 === filled ? index : index + 1;
    const delta = (newFilled - filled) * step;
    if (delta !== 0) onContribute(delta);
  };

  return (
    <View style={styles.boxesGrid}>
      {Array.from({ length: boxCount }, (_, i) => {
        const isFilled = i < filled;
        // Mismo criterio que el ternario de dashboard/src/components/SavingsGoals.tsx: "llena" y
        // "milestone" son estados EXCLUYENTES, no combinables — antes ambos estilos se aplicaban
        // a la vez sobre una casilla llena que también fuera milestone (cada 10), y como
        // `boxMilestone` iba después en el array de estilos, le pisaba el fondo verde sólido con
        // el tinte claro, deshaciendo visualmente su propio "conseguida".
        const isMilestone = !isFilled && (i + 1) % 10 === 0;
        return (
          <Pressable
            key={i}
            style={[styles.box, isFilled ? styles.boxFilled : isMilestone && styles.boxMilestone]}
            onPress={() => handlePress(i)}
          >
            <Text
              style={[
                styles.boxText,
                isFilled ? [styles.boxTextFilled, styles.boxTextStrike] : isMilestone && styles.boxTextMilestone,
              ]}
            >
              {boxLabel((i + 1) * step)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SavingsGoalCard({
  goal,
  onDelete,
  onContribute,
  onOpenAllBoxes,
}: {
  goal: SavingsGoal;
  onDelete: () => void;
  onContribute: (amount: number) => void;
  onOpenAllBoxes: () => void;
}) {
  const step = goal.stepAmount > 0 ? goal.stepAmount : 100;
  const totalBoxes = Math.min(MAX_TOTAL_BOXES, Math.max(1, Math.ceil(goal.targetAmount / step)));
  const hasMore = totalBoxes > PREVIEW_BOXES;

  return (
    <View style={styles.goalCard}>
      <View style={styles.goalCardHeader}>
        <Text style={styles.goalTitle}>{goal.name}</Text>
        <View style={[styles.badge, { backgroundColor: goal.type === "ahorro" ? colors.habitTint : colors.hobbyTint }]}>
          <Text style={[styles.badgeText, { color: goal.type === "ahorro" ? colors.habit : colors.hobby }]}>{TYPE_LABELS[goal.type]}</Text>
        </View>
      </View>

      <Text style={styles.goalMeta}>
        {formatMoney(goal.currentAmount)} / {formatMoney(goal.targetAmount)} · {Math.round(goal.progressPercent)}%
        {goal.deadline ? ` · límite ${new Date(goal.deadline).toLocaleDateString("es-ES")}` : ""}
      </Text>

      <View style={styles.progressTrackLarge}>
        <View style={[styles.progressFill, { width: `${Math.min(100, goal.progressPercent)}%`, backgroundColor: colors.primary }]} />
      </View>

      <BoxesGrid goal={goal} limit={PREVIEW_BOXES} onContribute={onContribute} />
      {hasMore && (
        <Pressable onPress={onOpenAllBoxes}>
          <Text style={styles.seeAllText}>Ver las {totalBoxes} casillas →</Text>
        </Pressable>
      )}

      <Pressable style={styles.deleteLink} onPress={onDelete}>
        <Text style={styles.deleteLinkText}>Eliminar</Text>
      </Pressable>
    </View>
  );
}

function NewSavingsGoalForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (input: { name: string; type: SavingsGoalType; targetAmount: number; stepAmount: number }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<SavingsGoalType>("ahorro");
  const [targetAmount, setTargetAmount] = useState("");
  const [stepAmount, setStepAmount] = useState("100");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const target = Number(targetAmount);
    const step = Number(stepAmount);
    if (!name.trim() || !(target > 0) || !(step > 0)) return;
    setSaving(true);
    await onSubmit({ name: name.trim(), type, targetAmount: target, stepAmount: step });
    setSaving(false);
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <Text style={styles.modalTitle}>Nueva meta de ahorro</Text>

      <TextInput style={styles.input} placeholder="Ej. Vacaciones a Japón" value={name} onChangeText={setName} />

      <View style={styles.chipRow}>
        {(["ahorro", "inversion"] as SavingsGoalType[]).map((t) => (
          <Pressable key={t} style={[styles.chip, type === t && styles.chipSelected]} onPress={() => setType(t)}>
            <Text style={[styles.chipText, type === t && styles.chipTextSelected]}>{TYPE_LABELS[t]}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.fieldLabel}>Cantidad objetivo</Text>
      <TextInput style={styles.input} value={targetAmount} onChangeText={setTargetAmount} keyboardType="numeric" placeholder="1000" />

      <Text style={styles.fieldLabel}>€ por casilla</Text>
      <TextInput style={styles.input} value={stepAmount} onChangeText={setStepAmount} keyboardType="numeric" />

      <Pressable style={styles.saveButton} onPress={submit} disabled={saving}>
        <Text style={styles.saveButtonText}>{saving ? "Creando…" : "Crear meta"}</Text>
      </Pressable>
      <Pressable style={styles.cancelButton} onPress={onCancel}>
        <Text style={styles.cancelButtonText}>Cancelar</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, paddingBottom: 8 },
  title: { fontFamily: fonts.serif, fontSize: 26, color: colors.foreground, flexShrink: 1 },
  newButton: { backgroundColor: colors.foreground, borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 8 },
  newButtonText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.background },
  content: { padding: 20, paddingTop: 8, gap: 16, paddingBottom: 40 },
  errorBanner: { fontFamily: fonts.sans, fontSize: 12, color: colors.destructive },
  emptyText: { fontFamily: fonts.sans, fontSize: 14, color: colors.mutedForeground, fontStyle: "italic" },

  // card-soft de la web — p-6 (24px), no los 16px que llevaba antes.
  overviewCard: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 24,
    gap: 12,
    ...shadow,
  },
  overviewTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: colors.mutedForeground,
  },
  // rounded-2xl border border-border bg-background p-4 de la web (MetasAhorroPage.tsx) — antes
  // no llevaba borde y usaba radius.input (rounded-xl, más cerrado que el rounded-2xl real).
  overviewRow: { backgroundColor: colors.background, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 6 },
  overviewRowHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  overviewRowTitle: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.foreground, flexShrink: 1 },
  overviewPercent: { fontFamily: fonts.serif, fontSize: 18 },
  overviewStatus: { fontFamily: fonts.sansMedium, fontSize: 11 },
  progressTrack: { height: 10, borderRadius: radius.full, backgroundColor: colors.muted, overflow: "hidden" },
  progressTrackLarge: { height: 12, borderRadius: radius.full, backgroundColor: colors.muted, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: radius.full },

  tabRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tabChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border },
  tabChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabChipText: { fontFamily: fonts.sans, fontSize: 13, color: colors.mutedForeground },
  tabChipTextSelected: { fontFamily: fonts.sansMedium, color: colors.primaryForeground },

  // card-soft de la web — p-6 (24px), no los 16px que llevaba antes.
  goalCard: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 24,
    gap: 12,
    ...shadow,
  },
  goalCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  goalTitle: { fontFamily: fonts.serif, fontSize: 22, color: colors.foreground, flexShrink: 1 },
  badge: { borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontFamily: fonts.sansBold, fontSize: 11 },
  goalMeta: { fontFamily: fonts.sans, fontSize: 13, color: colors.mutedForeground },

  boxesGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  box: {
    width: 52,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  boxFilled: { backgroundColor: colors.primary, borderColor: colors.primary },
  // border-primary/40 bg-primary/15 font-bold de la web — antes solo engordaba el borde
  // (borderWidth:2) sin tinte, así que una casilla milestone casi no se distinguía de una vacía.
  boxMilestone: { borderColor: withAlpha(colors.primary, 0.4), backgroundColor: colors.primaryTint },
  boxText: { fontFamily: fonts.sansMedium, fontSize: 10, color: colors.mutedForeground },
  boxTextFilled: { color: colors.primaryForeground },
  boxTextStrike: { textDecorationLine: "line-through" },
  boxTextMilestone: { fontFamily: fonts.sansBold, color: colors.foreground },
  seeAllText: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.primary },

  deleteLink: { alignSelf: "flex-end" },
  deleteLinkText: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground },

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
  saveButton: { backgroundColor: colors.primary, borderRadius: radius.full, padding: 15, alignItems: "center", marginTop: 8 },
  saveButtonText: { fontFamily: fonts.sansMedium, color: colors.primaryForeground, fontSize: 15 },
  cancelButton: { alignItems: "center", padding: 10 },
  cancelButtonText: { fontFamily: fonts.sans, color: colors.mutedForeground, fontSize: 14 },
});
