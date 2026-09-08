import { useCallback, useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Modal, ActivityIndicator, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import DateTimePicker, { DateTimePickerChangeEvent } from "@react-native-community/datetimepicker";
import { ApiError } from "../api/client";
import {
  createTransaction,
  deleteTransaction,
  FinanceAnalytics,
  getAnalytics,
  getMonthlyBalance,
  listSavingsGoals,
  listTransactions,
  MonthlyBalance,
  NewTransactionInput,
  Transaction,
  TransactionType,
  updateTransaction,
} from "../api/finance";
import { colors, fonts, radius, shadow } from "../theme";
import { useSidebar, SIDEBAR_CLIP_CLEARANCE } from "../navigation/SidebarContext";

// Puerto directo de dashboard/src/pages/FinanzasPage.tsx — mismos datos (balance del mes,
// movimientos, análisis, resumen de metas de ahorro) y mismos estilos de tarjeta (card-soft,
// panel sólido bg-primary de "Resumen del mes", panel sólido bg-secondary de "Top categorías").
// No pasa por SQLite: ver el comentario de src/api/finance.ts para el porqué. Simplificación
// deliberada frente a la web: sin exportación CSV (descargar/compartir ficheros añade permisos y
// UI que no compensan para una función secundaria) — ver mobile/README.md.

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(amount);
}

const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

export function FinanzasScreen() {
  const { collapsed } = useSidebar();
  const [balance, setBalance] = useState<MonthlyBalance | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [analytics, setAnalytics] = useState<FinanceAnalytics | null>(null);
  const [savingsTotal, setSavingsTotal] = useState(0);
  const [investmentTotal, setInvestmentTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "new" = formulario de alta; una Transaction = editándola (mismo Modal/MovementForm para los
  // dos casos, ver más abajo) — así se puede corregir la fecha de un movimiento que se olvidó
  // registrar el mes pasado, en vez de tener que borrarlo y crearlo de nuevo.
  const [formTx, setFormTx] = useState<Transaction | "new" | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const now = new Date();
      const [bal, txs, stats, savingsGoals] = await Promise.all([
        getMonthlyBalance(now.getMonth() + 1, now.getFullYear()),
        listTransactions(15),
        getAnalytics(),
        listSavingsGoals("all"),
      ]);
      setBalance(bal);
      setTransactions(txs);
      setAnalytics(stats);
      setSavingsTotal(savingsGoals.filter((g) => g.type === "ahorro").reduce((sum, g) => sum + g.currentAmount, 0));
      setInvestmentTotal(savingsGoals.filter((g) => g.type === "inversion").reduce((sum, g) => sum + g.currentAmount, 0));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar las finanzas");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const handleCreate = async (input: NewTransactionInput) => {
    await createTransaction(input);
    setFormTx(null);
    await reload();
  };

  const handleUpdate = async (id: number, input: NewTransactionInput) => {
    await updateTransaction(id, input);
    setFormTx(null);
    await reload();
  };

  const handleDelete = async (id: number) => {
    await deleteTransaction(id);
    await reload();
  };

  const maxTrend = Math.max(1, ...(analytics?.monthlyTrend.map((m) => Math.max(Math.abs(m.income), Math.abs(m.expense))) ?? [1]));

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.header, collapsed && { paddingLeft: SIDEBAR_CLIP_CLEARANCE }]}>
        <Text style={styles.title}>Finanzas</Text>
        <Pressable style={styles.newButton} onPress={() => setFormTx("new")}>
          <Text style={styles.newButtonText}>+ Nuevo</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {error && <Text style={styles.errorBanner}>{error}</Text>}
        {loading && !balance ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
        ) : (
          <>
            <View style={styles.summaryRow}>
              <SummaryCard label="Ingresos" value={formatMoney(balance?.income ?? 0)} color={colors.positive} />
              <SummaryCard label="Gastos" value={formatMoney(balance?.expense ?? 0)} color={colors.destructive} />
              <SummaryCard
                label="Balance"
                value={formatMoney(balance?.balance ?? 0)}
                color={(balance?.balance ?? 0) >= 0 ? colors.positive : colors.destructive}
              />
              {/* Ahorro e Inversión usan el mismo verde que Ingresos en la web (tone="positive" en
                  las cinco, ver FinanzasPage.tsx) — no un color por categoría propio. */}
              <SummaryCard label="Ahorro" value={formatMoney(savingsTotal)} color={colors.positive} />
              <SummaryCard label="Inversión" value={formatMoney(investmentTotal)} color={colors.positive} />
            </View>

            {analytics && analytics.monthlyTrend.length > 0 && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Tendencia (últimos {analytics.monthlyTrend.length} meses)</Text>
                <View style={styles.trendRow}>
                  {analytics.monthlyTrend.map((m) => {
                    const positive = m.balance >= 0;
                    const height = Math.max(4, (Math.abs(m.balance) / maxTrend) * 60);
                    return (
                      <View key={`${m.year}-${m.month}`} style={styles.trendBarWrap}>
                        <View style={styles.trendBarTrack}>
                          <View
                            style={[
                              styles.trendBar,
                              { height, backgroundColor: positive ? colors.positive : colors.destructive },
                            ]}
                          />
                        </View>
                        <Text style={styles.trendLabel}>{MONTH_LABELS[m.month - 1]}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* rounded-3xl bg-primary p-8 text-primary-foreground de la web ("Resumen del mes")
                — antes se omitía a propósito por duplicar las tarjetas de arriba en una pantalla
                de una sola columna (ver el comentario de cabecera), pero el usuario lo quiere de
                vuelta con el mismo estilo que en la web, justo antes de "Top categorías". */}
            {balance && (
              <View style={styles.cardPrimary}>
                <Text style={[styles.cardTitle, styles.cardTitlePrimary]}>Resumen del mes</Text>
                <View style={{ gap: 16 }}>
                  <View style={styles.summaryMonthRow}>
                    <Text style={styles.summaryMonthLabel}>Ingresos</Text>
                    <Text style={styles.summaryMonthValue}>+{formatMoney(balance.income)}</Text>
                  </View>
                  <View style={styles.summaryMonthRow}>
                    <Text style={styles.summaryMonthLabel}>Gastos</Text>
                    <Text style={styles.summaryMonthValue}>−{formatMoney(balance.expense)}</Text>
                  </View>
                  <View style={styles.summaryMonthRow}>
                    <Text style={styles.summaryMonthLabel}>Ahorro</Text>
                    <Text style={styles.summaryMonthValue}>{formatMoney(savingsTotal)}</Text>
                  </View>
                  <View style={styles.summaryMonthDivider} />
                  <View style={styles.summaryMonthRow}>
                    <Text style={styles.summaryMonthNetLabel}>Saldo neto</Text>
                    <Text style={styles.summaryMonthNetValue}>{formatMoney(balance.balance)}</Text>
                  </View>
                </View>
              </View>
            )}

            {analytics && (
              // rounded-3xl bg-secondary p-6 text-secondary-foreground de la web — fondo sólido
              // arena, sin borde (a diferencia de card-soft, que sí lo lleva).
              <View style={styles.cardSecondary}>
                <Text style={[styles.cardTitle, styles.cardTitleSecondary]}>Top 5 categorías de gasto (este mes)</Text>
                {analytics.topCategories.length === 0 ? (
                  <Text style={styles.categoryEmptyText}>Sin gastos registrados este mes.</Text>
                ) : (
                  <View>
                    {analytics.topCategories.map((c, i) => (
                      <View
                        key={c.category}
                        style={[styles.categoryRow, i < analytics.topCategories.length - 1 && styles.categoryRowDivider]}
                      >
                        <Text style={styles.categoryName}>{c.category}</Text>
                        <Text style={styles.categoryAmount}>{formatMoney(c.total)}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}

            {analytics && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Proyección anual</Text>
                <Text style={styles.projectionText}>
                  Con el ritmo de los últimos {analytics.projectedAnnual.basedOnMonths} meses (balance medio{" "}
                  {formatMoney(analytics.projectedAnnual.avgMonthlyBalance)}/mes), acabarías el año con un balance proyectado de{" "}
                  <Text style={{ fontFamily: fonts.sansBold }}>{formatMoney(analytics.projectedAnnual.projectedYearEnd)}</Text>.
                </Text>
              </View>
            )}

            <View style={{ gap: 12 }}>
              <Text style={styles.sectionTitle}>Movimientos recientes</Text>
              {/* overflow-hidden rounded-3xl border border-border bg-card de la web: UN recuadro
                  contenedor con filas separadas por raya (border-b), no una tarjeta suelta por
                  movimiento — y, a diferencia de card-soft, sin sombra. */}
              <View style={styles.transactionsCard}>
                {transactions.length === 0 ? (
                  <Text style={styles.transactionsEmptyText}>Sin movimientos todavía.</Text>
                ) : (
                  transactions.map((t, i) => (
                    <View key={t.id} style={[styles.transactionRow, i === transactions.length - 1 && styles.transactionRowLast]}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.transactionTitle}>{t.description || t.category}</Text>
                        <Text style={styles.transactionMeta}>
                          {t.category} · {new Date(t.date).toLocaleDateString("es-ES")}
                        </Text>
                      </View>
                      <Text style={[styles.transactionAmount, { color: t.type === "income" ? colors.positive : colors.destructive }]}>
                        {t.type === "income" ? "+" : "-"}
                        {formatMoney(t.amount)}
                      </Text>
                      {/* Un único botón (lápiz) en vez de "Editar"/"Borrar" separados — borrar
                          vive dentro del propio formulario de edición (ver onDelete más abajo). */}
                      <Pressable onPress={() => setFormTx(t)} hitSlop={6} accessibilityLabel="Editar movimiento">
                        <Text style={styles.editIcon}>✎</Text>
                      </Pressable>
                    </View>
                  ))
                )}
              </View>
            </View>
          </>
        )}
      </ScrollView>

      <Modal visible={formTx !== null} animationType="slide" transparent onRequestClose={() => setFormTx(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            {formTx !== null && (
              <MovementForm
                initial={formTx === "new" ? undefined : formTx}
                onCancel={() => setFormTx(null)}
                onSubmit={async (input) => {
                  if (formTx === "new") await handleCreate(input);
                  else await handleUpdate((formTx as Transaction).id, input);
                }}
                onDelete={
                  formTx === "new"
                    ? undefined
                    : async () => {
                        await handleDelete((formTx as Transaction).id);
                        setFormTx(null);
                      }
                }
              />
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

// Un único formulario para crear (initial=undefined, fecha por defecto hoy) y para editar
// (initial=la Transaction, precarga todos los campos incluida la fecha) — así se puede corregir
// la fecha de un movimiento que se olvidó registrar el mes pasado sin borrarlo y crearlo de nuevo.
function MovementForm({
  initial,
  onSubmit,
  onCancel,
  onDelete,
}: {
  initial?: Transaction;
  onSubmit: (input: NewTransactionInput) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
}) {
  const [concept, setConcept] = useState(initial?.description ?? "");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [kind, setKind] = useState<TransactionType>(initial?.type ?? "expense");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [date, setDate] = useState(initial ? new Date(initial.date) : new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Mismo patrón que "Eliminar página" en PaginaDetailScreen.tsx:184-194 (`confirmingDelete`) —
  // el propio botón pide confirmar cambiando su texto/color en vez de un diálogo aparte; sin blur
  // en táctil para cancelarlo solo, así que se cancela solo a los 3s si no se toca una segunda vez.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (!confirmingDelete) return;
    const timer = setTimeout(() => setConfirmingDelete(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmingDelete]);

  const submit = async () => {
    const n = Number(amount);
    if (!concept.trim() || !n || !category.trim()) return;
    setSaving(true);
    await onSubmit({ type: kind, amount: Math.abs(n), category: category.trim(), description: concept.trim(), date: date.toISOString() });
    setSaving(false);
  };

  const remove = async () => {
    if (!onDelete) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setConfirmingDelete(false);
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <Text style={styles.modalTitle}>{initial ? "Editar movimiento" : "Nuevo movimiento"}</Text>

      <View style={styles.chipRow}>
        {(["expense", "income"] as TransactionType[]).map((k) => (
          <Pressable key={k} style={[styles.chip, kind === k && styles.chipSelected]} onPress={() => setKind(k)}>
            <Text style={[styles.chipText, kind === k && styles.chipTextSelected]}>{k === "income" ? "Ingreso" : "Gasto"}</Text>
          </Pressable>
        ))}
      </View>

      <TextInput style={styles.input} placeholder="Concepto" value={concept} onChangeText={setConcept} />
      <TextInput style={styles.input} placeholder="Importe" value={amount} onChangeText={setAmount} keyboardType="numeric" />
      <TextInput style={styles.input} placeholder="Categoría" value={category} onChangeText={setCategory} />

      <Text style={styles.fieldLabel}>Fecha</Text>
      <Pressable style={styles.dateButton} onPress={() => setShowPicker(true)}>
        <Text style={styles.dateButtonText}>{date.toLocaleDateString("es-ES")}</Text>
      </Pressable>
      {showPicker && (
        <DateTimePicker
          value={date}
          mode="date"
          display={Platform.OS === "ios" ? "inline" : "default"}
          onValueChange={(_event: DateTimePickerChangeEvent, selected?: Date) => {
            setShowPicker(false);
            if (selected) setDate(selected);
          }}
          onDismiss={() => setShowPicker(false)}
        />
      )}

      <Pressable style={styles.saveButton} onPress={submit} disabled={saving}>
        <Text style={styles.saveButtonText}>{saving ? "Guardando…" : initial ? "Guardar cambios" : "Guardar movimiento"}</Text>
      </Pressable>
      <Pressable style={styles.cancelButton} onPress={onCancel}>
        <Text style={styles.cancelButtonText}>Cancelar</Text>
      </Pressable>
      {/* Borrar vive dentro del propio formulario de edición, no como botón aparte en la lista —
          ver el pedido de "solo el lápiz" en Movimientos recientes (onDelete solo llega al editar). */}
      {onDelete && (
        <Pressable
          style={[styles.deleteButton, confirmingDelete && styles.deleteButtonConfirming]}
          onPress={remove}
          disabled={deleting}
        >
          <Text style={[styles.deleteButtonText, confirmingDelete && styles.deleteButtonTextConfirming]}>
            {deleting ? "Eliminando…" : confirmingDelete ? "¿Confirmar eliminar?" : "Eliminar movimiento"}
          </Text>
        </Pressable>
      )}
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

  summaryRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  // card-soft de la web (rounded-3xl border-border bg-card shadow-soft) — antes llevaba
  // radius.input (rounded-xl), un radio bastante más cerrado que el rounded-3xl real.
  summaryCard: {
    flexBasis: "31%",
    flexGrow: 1,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 4,
    ...shadow,
  },
  summaryLabel: {
    fontFamily: fonts.sansBold,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: colors.mutedForeground,
  },
  summaryValue: { fontFamily: fonts.serif, fontSize: 18 },

  // card-soft de la web — p-6 (24px), no los 16px que llevaba antes.
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 24,
    gap: 12,
    ...shadow,
  },
  // rounded-3xl bg-secondary p-6 text-secondary-foreground de la web ("Top categorías") — fondo
  // sólido arena, sin borde ni sombra (a diferencia de `card`/card-soft).
  cardSecondary: {
    backgroundColor: colors.secondary,
    borderRadius: radius.card,
    padding: 24,
    gap: 12,
  },
  cardTitle: {
    fontFamily: fonts.sansBold,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: colors.mutedForeground,
  },
  cardTitleSecondary: { color: colors.secondaryForeground },

  // rounded-3xl bg-primary p-8 text-primary-foreground de la web ("Resumen del mes") — fondo
  // sólido sage, sin borde ni sombra, más padding que card-soft (p-8=32 vs p-6=24).
  cardPrimary: { backgroundColor: colors.primary, borderRadius: radius.card, padding: 32, gap: 12 },
  cardTitlePrimary: { color: colors.primaryForeground, opacity: 0.6 },
  summaryMonthRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  summaryMonthLabel: { fontFamily: fonts.sans, fontSize: 13, color: colors.primaryForeground, opacity: 0.8 },
  summaryMonthValue: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.primaryForeground },
  // h-px bg-primary-foreground/20 de la web.
  summaryMonthDivider: { height: 1, backgroundColor: "rgba(251, 250, 247, 0.2)" },
  summaryMonthNetLabel: { fontFamily: fonts.sansSemiBold, fontSize: 14, color: colors.primaryForeground },
  summaryMonthNetValue: { fontFamily: fonts.serif, fontSize: 20, color: colors.primaryForeground },
  trendRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", height: 90 },
  trendBarWrap: { alignItems: "center", gap: 6, flex: 1 },
  trendBarTrack: { height: 64, justifyContent: "flex-end" },
  trendBar: { width: 18, borderRadius: 4 },
  trendLabel: { fontFamily: fonts.sans, fontSize: 10, color: colors.mutedForeground },

  // text-sm opacity-70 de la web (mismo color secondary-foreground que el resto del panel).
  categoryEmptyText: { fontFamily: fonts.sans, fontSize: 13, color: colors.secondaryForeground, opacity: 0.7 },
  categoryRow: { flexDirection: "row", justifyContent: "space-between", paddingBottom: 8 },
  // border-b border-secondary-foreground/15 pb-2 de la web (las filas van dentro de la tarjeta
  // arena de arriba, así que la raya es del mismo tono que el texto, no del gris neutro de
  // `colors.border`).
  categoryRowDivider: { borderBottomWidth: 1, borderBottomColor: "rgba(45, 41, 38, 0.15)", marginBottom: 8 },
  categoryName: { fontFamily: fonts.sans, fontSize: 13, color: colors.secondaryForeground, textTransform: "capitalize" },
  // Sin rojo: la web deja el importe en el mismo color que el resto del texto (<strong>, sin
  // clase de color) — todas las filas de este panel son gastos, así que un tono destructivo por
  // fila sería redundante encima del propio título "Top categorías DE GASTO".
  categoryAmount: { fontFamily: fonts.sansBold, fontSize: 13, color: colors.secondaryForeground },

  projectionText: { fontFamily: fonts.sans, fontSize: 13, color: colors.mutedForeground, lineHeight: 19 },

  sectionTitle: {
    fontFamily: fonts.sansBold,
    fontSize: 12,
    color: colors.mutedForeground,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  // overflow-hidden rounded-3xl border border-border bg-card de la web — SIN shadow-soft (a
  // diferencia de card-soft: la web no le pone sombra a este contenedor).
  transactionsCard: {
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  transactionsEmptyText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.mutedForeground,
    textAlign: "center",
    padding: 32,
  },
  // border-b border-border px-6 py-4 last:border-b-0 de la web — cada fila es solo una raya
  // divisoria dentro del recuadro de arriba, no su propia tarjeta con fondo/borde/radio.
  transactionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  transactionRowLast: { borderBottomWidth: 0 },
  transactionTitle: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.foreground },
  transactionMeta: { fontFamily: fonts.sans, fontSize: 11, color: colors.mutedForeground, textTransform: "capitalize" },
  transactionAmount: { fontFamily: fonts.sansBold, fontSize: 14 },
  // Único botón por movimiento (lápiz) — Borrar ya no vive en la fila, ver deleteButton más abajo.
  editIcon: { fontSize: 16, color: colors.mutedForeground },

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
  // Mismo patrón que AgendaScreen.tsx: fieldLabel + un botón que abre el DateTimePicker nativo en
  // vez de un TextInput libre — la fecha es la única entrada que no tiene sentido teclear a mano.
  fieldLabel: {
    fontFamily: fonts.sansBold,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: colors.mutedForeground,
    marginBottom: 6,
  },
  dateButton: {
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.input,
    padding: 12,
    marginBottom: 12,
    backgroundColor: colors.card,
    alignItems: "center",
  },
  dateButtonText: { fontFamily: fonts.sans, fontSize: 14, color: colors.foreground },
  saveButton: { backgroundColor: colors.primary, borderRadius: radius.full, padding: 15, alignItems: "center", marginTop: 8 },
  saveButtonText: { fontFamily: fonts.sansMedium, color: colors.primaryForeground, fontSize: 15 },
  cancelButton: { alignItems: "center", padding: 10 },
  cancelButtonText: { fontFamily: fonts.sans, color: colors.mutedForeground, fontSize: 14 },
  deleteButton: { alignItems: "center", padding: 10, borderRadius: radius.full },
  deleteButtonConfirming: { backgroundColor: colors.destructive },
  deleteButtonText: { fontFamily: fonts.sansMedium, color: colors.destructive, fontSize: 14 },
  deleteButtonTextConfirming: { color: colors.destructiveForeground, fontWeight: "700" },
});
