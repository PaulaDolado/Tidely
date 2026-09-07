import { useCallback, useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Modal, Switch, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { ApiError } from "../api/client";
import { addProgress, createGoal, deleteGoal, Goal, GoalPeriod, GoalStatus, listGoals, NewGoalInput } from "../api/goals";
import { colors, fonts, radius, shadow } from "../theme";
import { useSidebar, SIDEBAR_CLIP_CLEARANCE } from "../navigation/SidebarContext";

// Puerto directo de dashboard/src/pages/MetasPage.tsx — mismos campos, mismas pestañas, mismo
// cálculo de "ritmo" (paceStatus). A diferencia de Agenda/Planificador, esta pantalla no cachea
// nada en SQLite: Goal/GoalProgress no están en el contrato de sync offline (ver
// src/api/goals.ts), así que cada acción pega directo a la API, igual que la propia web.

const STATUS_TABS: { value: GoalStatus; label: string }[] = [
  { value: "active", label: "Activos" },
  { value: "completed", label: "Completados" },
  { value: "expired", label: "Vencidos" },
  { value: "all", label: "Todos" },
];

// Mismas 3 opciones que el backend acepta (ver goalsValidators.PERIODS en la API) — igual mapa
// que GOAL_PERIOD_LABELS en dashboard/src/pages/MetasPage.tsx.
const GOAL_PERIOD_LABELS: Record<GoalPeriod, string> = {
  weekly: "Semanal",
  monthly: "Mensual",
  annual: "Anual",
};

function percentOf(goal: Goal): number {
  return goal.targetValue > 0 ? Math.min(100, Math.round((goal.currentValue / goal.targetValue) * 100)) : 0;
}

// Mismo criterio "días de calendario" que dashboard/src/pages/MetasPage.tsx:24-28 (comentario
// ahí explica por qué no vale usar milisegundos: una meta creada hace 5 minutos no debe salir ya
// en amarillo).
function calendarDaysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86_400_000);
}

/** Verde si la meta va al ritmo necesario para completarse a tiempo, ámbar si va por detrás —
 * mismo margen (80% del ritmo esperado) que el backend usa para las alertas de "meta en riesgo"
 * (computeGoalRisk en src/services/goalsService.ts), puerto de
 * dashboard/src/pages/MetasPage.tsx:34-45. */
function paceStatus(goal: Goal): "green" | "yellow" {
  if (goal.completed) return "green";
  const start = new Date(goal.periodStart);
  const end = new Date(goal.periodEnd);
  const now = new Date();
  const daysTotal = Math.max(1, calendarDaysBetween(start, end));
  const daysElapsed = Math.min(daysTotal, Math.max(0, calendarDaysBetween(start, now)));
  if (daysElapsed <= 0) return "green";
  const expectedPercent = (daysElapsed / daysTotal) * 100;
  const actualPercent = percentOf(goal);
  return actualPercent >= expectedPercent * 0.8 ? "green" : "yellow";
}

export function ObjetivosScreen() {
  const { collapsed } = useSidebar();
  const [status, setStatus] = useState<GoalStatus>("active");
  const [goals, setGoals] = useState<Goal[]>([]);
  const [activeGoals, setActiveGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const reload = useCallback(async (currentStatus: GoalStatus) => {
    setLoading(true);
    setError(null);
    try {
      const [list, active] = await Promise.all([listGoals(currentStatus), currentStatus === "active" ? Promise.resolve(null) : listGoals("active")]);
      setGoals(list);
      setActiveGoals(currentStatus === "active" ? list : (active ?? []));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los objetivos");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload(status);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status])
  );

  const handleCreate = async (input: NewGoalInput) => {
    await createGoal(input);
    setShowCreate(false);
    await reload(status);
  };

  const handleDelete = async (id: number) => {
    await deleteGoal(id);
    await reload(status);
  };

  const handleRegisterProgress = async (id: number, value: number) => {
    await addProgress(id, value);
    await reload(status);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.header, collapsed && { paddingLeft: SIDEBAR_CLIP_CLEARANCE }]}>
        <Text style={styles.title}>Objetivos</Text>
        <Pressable style={styles.newButton} onPress={() => setShowCreate(true)}>
          <Text style={styles.newButtonText}>+ Nuevo</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {error && <Text style={styles.errorBanner}>{error}</Text>}

        <ProgressOverview goals={activeGoals} />

        <View style={styles.tabRow}>
          {STATUS_TABS.map((tab) => (
            <Pressable
              key={tab.value}
              style={[styles.tabChip, status === tab.value && styles.tabChipSelected]}
              onPress={() => setStatus(tab.value)}
            >
              <Text style={[styles.tabChipText, status === tab.value && styles.tabChipTextSelected]}>{tab.label}</Text>
            </Pressable>
          ))}
        </View>

        {loading && goals.length === 0 ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
        ) : goals.length === 0 ? (
          <Text style={styles.emptyText}>No hay objetivos en esta categoría.</Text>
        ) : (
          <View style={{ gap: 16 }}>
            {goals.map((goal) => (
              <GoalCard key={goal.id} goal={goal} onDelete={() => handleDelete(goal.id)} onRegisterProgress={(v) => handleRegisterProgress(goal.id, v)} />
            ))}
          </View>
        )}
      </ScrollView>

      <Modal visible={showCreate} animationType="slide" transparent onRequestClose={() => setShowCreate(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <NewGoalForm onCancel={() => setShowCreate(false)} onSubmit={handleCreate} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function ProgressOverview({ goals }: { goals: Goal[] }) {
  return (
    <View style={styles.overviewCard}>
      <Text style={styles.overviewTitle}>Progreso de tus objetivos activos</Text>
      {goals.length === 0 ? (
        <Text style={styles.emptyText}>No tienes objetivos activos ahora mismo.</Text>
      ) : (
        <View style={{ gap: 10 }}>
          {goals.map((goal) => {
            const percent = percentOf(goal);
            const status = paceStatus(goal);
            const color = status === "green" ? colors.positive : colors.warning;
            return (
              <View key={goal.id} style={styles.overviewRow}>
                <View style={styles.overviewRowHeader}>
                  <Text style={styles.overviewRowTitle} numberOfLines={1}>
                    {goal.title}
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

function GoalCard({ goal, onDelete, onRegisterProgress }: { goal: Goal; onDelete: () => void; onRegisterProgress: (value: number) => void }) {
  const [value, setValue] = useState("1");
  const percent = percentOf(goal);

  const submit = () => {
    const n = Number(value);
    if (!n) return;
    onRegisterProgress(n);
  };

  return (
    <View style={styles.goalCard}>
      <View style={styles.goalCardHeader}>
        <Text style={styles.goalTitle}>{goal.title}</Text>
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          {goal.completed && (
            <View style={[styles.badge, { backgroundColor: colors.primaryTint }]}>
              <Text style={[styles.badgeText, { color: colors.primary }]}>✓ Completado</Text>
            </View>
          )}
          {goal.expired && !goal.completed && (
            <View style={[styles.badge, { backgroundColor: colors.destructiveTint }]}>
              <Text style={[styles.badgeText, { color: colors.destructive }]}>Vencido</Text>
            </View>
          )}
        </View>
      </View>

      {goal.description ? <Text style={styles.goalDescription}>{goal.description}</Text> : null}

      <Text style={styles.goalMeta}>
        {GOAL_PERIOD_LABELS[goal.period]} · {goal.currentValue}/{goal.targetValue} · 🏆 {goal.bonusPoints} pts
        {goal.autoRenew ? " · se renueva sola" : ""}
      </Text>

      <View style={styles.progressTrackLarge}>
        <View style={[styles.progressFill, { width: `${percent}%`, backgroundColor: colors.primary }]} />
      </View>

      {!goal.completed && !goal.expired && (
        <View style={styles.progressForm}>
          <TextInput style={styles.progressInput} value={value} onChangeText={setValue} keyboardType="numeric" />
          <Pressable style={styles.progressButton} onPress={submit}>
            <Text style={styles.progressButtonText}>Registrar progreso</Text>
          </Pressable>
        </View>
      )}

      <Pressable style={styles.deleteLink} onPress={onDelete}>
        <Text style={styles.deleteLinkText}>Eliminar</Text>
      </Pressable>
    </View>
  );
}

function NewGoalForm({ onSubmit, onCancel }: { onSubmit: (input: NewGoalInput) => Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [period, setPeriod] = useState<GoalPeriod>("weekly");
  const [targetValue, setTargetValue] = useState("5");
  const [autoRenew, setAutoRenew] = useState(true);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    await onSubmit({ title: title.trim(), period, targetValue: Number(targetValue) || 1, autoRenew });
    setSaving(false);
    setTitle("");
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <Text style={styles.modalTitle}>Nuevo objetivo</Text>

      <TextInput style={styles.input} placeholder="Ej. Ejercicio 5 días" value={title} onChangeText={setTitle} />

      <Text style={styles.fieldLabel}>Periodo</Text>
      <View style={styles.chipRow}>
        {(Object.keys(GOAL_PERIOD_LABELS) as GoalPeriod[]).map((p) => (
          <Pressable key={p} style={[styles.chip, period === p && styles.chipSelected]} onPress={() => setPeriod(p)}>
            <Text style={[styles.chipText, period === p && styles.chipTextSelected]}>{GOAL_PERIOD_LABELS[p]}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.fieldLabel}>Objetivo (cantidad)</Text>
      <TextInput style={styles.input} value={targetValue} onChangeText={setTargetValue} keyboardType="numeric" />

      <View style={styles.switchRow}>
        <Text style={styles.fieldLabel}>Renovar sola</Text>
        <Switch value={autoRenew} onValueChange={setAutoRenew} trackColor={{ false: colors.muted, true: colors.primary }} thumbColor={colors.card} />
      </View>

      <Pressable style={styles.saveButton} onPress={submit} disabled={saving}>
        <Text style={styles.saveButtonText}>{saving ? "Creando…" : "Crear objetivo"}</Text>
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
  title: { fontFamily: fonts.serif, fontSize: 30, color: colors.foreground },
  newButton: { backgroundColor: colors.foreground, borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 8 },
  newButtonText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.background },
  content: { padding: 20, paddingTop: 8, gap: 16, paddingBottom: 40 },
  errorBanner: { fontFamily: fonts.sans, fontSize: 12, color: colors.destructive },
  emptyText: { fontFamily: fonts.sans, fontSize: 14, color: colors.mutedForeground, fontStyle: "italic" },

  overviewCard: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
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
  overviewRow: { backgroundColor: colors.background, borderRadius: radius.input, padding: 12, gap: 6 },
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

  goalCard: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 12,
    ...shadow,
  },
  goalCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  goalTitle: { fontFamily: fonts.serif, fontSize: 22, color: colors.foreground, flexShrink: 1 },
  badge: { borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontFamily: fonts.sansBold, fontSize: 11 },
  goalDescription: { fontFamily: fonts.sans, fontSize: 13, color: colors.mutedForeground },
  goalMeta: { fontFamily: fonts.sans, fontSize: 13, color: colors.mutedForeground },
  progressForm: { flexDirection: "row", gap: 8 },
  progressInput: {
    width: 72,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.input,
    padding: 10,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.foreground,
    backgroundColor: colors.background,
  },
  progressButton: { flex: 1, backgroundColor: colors.primary, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
  progressButtonText: { fontFamily: fonts.sansMedium, color: colors.primaryForeground, fontSize: 13 },
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
  switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  saveButton: { backgroundColor: colors.primary, borderRadius: radius.full, padding: 15, alignItems: "center", marginTop: 8 },
  saveButtonText: { fontFamily: fonts.sansMedium, color: colors.primaryForeground, fontSize: 15 },
  cancelButton: { alignItems: "center", padding: 10 },
  cancelButtonText: { fontFamily: fonts.sans, color: colors.mutedForeground, fontSize: 14 },
});
