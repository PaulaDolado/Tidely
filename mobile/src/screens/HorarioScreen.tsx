import { useCallback, useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Modal, ActivityIndicator, Platform, KeyboardAvoidingView } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import * as SecureStore from "expo-secure-store";
import { useFocusEffect } from "@react-navigation/native";
import { runSync } from "../sync";
import {
  listSchedules,
  createScheduleLocal,
  renameScheduleLocal,
  deleteScheduleLocal,
  moveScheduleLocal,
} from "../db/scheduleRepo";
import {
  listForSchedule,
  createRowLocal,
  updateRowCellLocal,
  deleteRowLocal,
  moveRowLocal,
} from "../db/scheduleRowsRepo";
import { LocalSchedule, LocalScheduleRow } from "../types";
import { colors, fonts, radius, shadow } from "../theme";
import { useSidebar, SIDEBAR_CLIP_CLEARANCE } from "../navigation/SidebarContext";
import { AnnualCalendarLegend } from "../components/AnnualCalendarLegend";

// Puerto de dashboard/src/pages/SchedulePage.tsx — mismo modelo (Schedule con nombre propio +
// ScheduleRow de texto libre lunes-viernes, sin fechas). Offline-first, igual que Agenda/
// Planificador: lee/escribe en SQLite (scheduleRepo/scheduleRowsRepo) y sincroniza vía runSync();
// reordenar (flechas ↑↓) calcula un `order` fraccionario localmente en vez de llamar al endpoint
// de swap `moveSchedule`/`moveRow` (ver scheduleRepo.moveScheduleLocal). Con paridad completa con
// la web: los dos modos de vista ("Flechas" — un horario a la vez — y "Apilado" — todos uno
// debajo de otro) y el calendario anual con leyenda (AnnualCalendarLegend) debajo.
// Simplificación deliberada frente a la web: los borrados (horario/franja) son de un solo toque,
// sin el "¿Confirmar?" de doble clic — ese patrón depende de un hover que no existe en táctil.

type DayKey = "monday" | "tuesday" | "wednesday" | "thursday" | "friday";
const DAY_LABELS: Record<DayKey, string> = {
  monday: "Lunes",
  tuesday: "Martes",
  wednesday: "Miércoles",
  thursday: "Jueves",
  friday: "Viernes",
};
const DAY_KEYS: DayKey[] = ["monday", "tuesday", "wednesday", "thursday", "friday"];

const VIEW_MODE_KEY = "life-organizer.schedule-view-mode";
type ViewMode = "flechas" | "apilado";

export function HorarioScreen() {
  const { collapsed } = useSidebar();
  const insets = useSafeAreaInsets();
  const [schedules, setSchedules] = useState<LocalSchedule[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [rows, setRows] = useState<LocalScheduleRow[]>([]);
  const [loadingSchedules, setLoadingSchedules] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("flechas");

  const active = schedules[activeIndex] ?? null;

  // Preferencia persistida — equivalente móvil del `localStorage` que usa SchedulePage.tsx, pero
  // asíncrono (SecureStore), así que arranca en "flechas" y cambia en cuanto carga el valor
  // guardado (si lo hay).
  useEffect(() => {
    SecureStore.getItemAsync(VIEW_MODE_KEY).then((stored) => {
      if (stored === "apilado" || stored === "flechas") setViewMode(stored);
    });
  }, []);

  const changeViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    SecureStore.setItemAsync(VIEW_MODE_KEY, mode);
  };

  const reloadSchedules = useCallback(async () => {
    setLoadingSchedules(true);
    setSchedules(await listSchedules());
    setLoadingSchedules(false);
  }, []);

  const sync = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    const result = await runSync();
    setSyncing(false);
    if (result.success) await reloadSchedules();
    else setSyncError(result.error ?? "No se pudo sincronizar");
  }, [reloadSchedules]);

  useFocusEffect(
    useCallback(() => {
      reloadSchedules();
      sync();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  // Si se borra el horario activo (o cambia el total), el índice no debe quedar fuera de rango.
  useEffect(() => {
    if (activeIndex > schedules.length - 1) setActiveIndex(Math.max(0, schedules.length - 1));
  }, [schedules.length, activeIndex]);

  // En cuanto el horario recién creado aparece en `schedules`, salta a él — mismo patrón que
  // dashboard/src/pages/SchedulePage.tsx:93-101.
  useEffect(() => {
    if (pendingFocusId === null) return;
    const index = schedules.findIndex((s) => s.id === pendingFocusId);
    if (index !== -1) {
      setActiveIndex(index);
      setPendingFocusId(null);
    }
  }, [schedules, pendingFocusId]);

  const reloadRows = useCallback(async (scheduleId: string) => {
    setLoadingRows(true);
    setRows(await listForSchedule(scheduleId));
    setLoadingRows(false);
  }, []);

  useEffect(() => {
    if (active) reloadRows(active.id);
    else setRows([]);
    setRenaming(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  const handleCreateSchedule = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const id = await createScheduleLocal(trimmed);
    setNewName("");
    setShowCreate(false);
    setPendingFocusId(id);
    await reloadSchedules();
    await sync();
  };

  const handleRename = async () => {
    if (!active) return;
    const trimmed = nameDraft.trim();
    setRenaming(false);
    if (!trimmed || trimmed === active.name) return;
    await renameScheduleLocal(active.id, trimmed);
    await reloadSchedules();
    await sync();
  };

  const handleDeleteSchedule = async () => {
    if (!active) return;
    await deleteScheduleLocal(active.id);
    await reloadSchedules();
    await sync();
  };

  const handleMoveSchedule = async (direction: "up" | "down") => {
    if (!active) return;
    await moveScheduleLocal(active.id, direction);
    await reloadSchedules();
    await sync();
  };

  const updateLocalCell = (rowId: string, field: DayKey | "timeLabel", value: string) => {
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, [field]: value } : r)));
  };

  const persistCell = async (rowId: string, field: DayKey | "timeLabel", value: string) => {
    await updateRowCellLocal(rowId, field, value);
    await sync();
  };

  const handleAddRow = async () => {
    if (!active) return;
    await createRowLocal(active.id, "");
    await reloadRows(active.id);
    await sync();
  };

  const handleDeleteRow = async (rowId: string) => {
    if (!active) return;
    await deleteRowLocal(rowId);
    await reloadRows(active.id);
    await sync();
  };

  const handleMoveRow = async (rowId: string, direction: "up" | "down") => {
    if (!active) return;
    await moveRowLocal(rowId, direction);
    await reloadRows(active.id);
    await sync();
  };

  // Versiones "por id" de las acciones de arriba, para el modo Apilado: ahí cada
  // ScheduleTableCard gestiona su propio horario, no el `active` de la vista Flechas.
  const renameScheduleById = async (id: string, name: string) => {
    await renameScheduleLocal(id, name);
    await reloadSchedules();
    await sync();
  };
  const deleteScheduleById = async (id: string) => {
    await deleteScheduleLocal(id);
    await reloadSchedules();
    await sync();
  };
  const moveScheduleById = async (id: string, direction: "up" | "down") => {
    await moveScheduleLocal(id, direction);
    await reloadSchedules();
    await sync();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.header, collapsed && { paddingLeft: SIDEBAR_CLIP_CLEARANCE }]}>
        <Text style={styles.title}>Horario</Text>
        <Pressable style={styles.newButton} onPress={() => setShowCreate(true)}>
          <Text style={styles.newButtonText}>+ Nuevo</Text>
        </Pressable>
      </View>

      <View style={styles.viewModeRow}>
        <View style={styles.viewModePill}>
          <Pressable
            style={[styles.viewModeButton, viewMode === "flechas" && styles.viewModeButtonActive]}
            onPress={() => changeViewMode("flechas")}
          >
            <Text style={[styles.viewModeButtonText, viewMode === "flechas" && styles.viewModeButtonTextActive]}>Flechas</Text>
          </Pressable>
          <Pressable
            style={[styles.viewModeButton, viewMode === "apilado" && styles.viewModeButtonActive]}
            onPress={() => changeViewMode("apilado")}
          >
            <Text style={[styles.viewModeButtonText, viewMode === "apilado" && styles.viewModeButtonTextActive]}>Apilado</Text>
          </Pressable>
        </View>
      </View>

      {syncError && <Text style={styles.errorBanner}>{syncError} — se reintentará solo</Text>}
      {syncing && (
        <View style={styles.syncBar}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.syncText}>Sincronizando…</Text>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.screenScroll}>
        {loadingSchedules && schedules.length === 0 ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
        ) : schedules.length === 0 ? (
          <View style={styles.content}>
            <Text style={styles.emptyText}>Aún no tienes ningún horario. Crea uno para empezar.</Text>
          </View>
        ) : viewMode === "flechas" ? (
          <>
            <View style={styles.nav}>
              <Pressable disabled={activeIndex === 0} onPress={() => setActiveIndex((i) => i - 1)}>
                <Text style={[styles.navArrow, activeIndex === 0 && styles.navArrowDisabled]}>‹</Text>
              </Pressable>

              {renaming ? (
                <TextInput
                  style={styles.nameInput}
                  value={nameDraft}
                  onChangeText={setNameDraft}
                  onBlur={handleRename}
                  onSubmitEditing={handleRename}
                  autoFocus
                />
              ) : (
                <Pressable
                  style={styles.nameButton}
                  onPress={() => {
                    setNameDraft(active?.name ?? "");
                    setRenaming(true);
                  }}
                >
                  <Text style={styles.navTitle}>{active?.name}</Text>
                </Pressable>
              )}

              <Pressable disabled={activeIndex >= schedules.length - 1} onPress={() => setActiveIndex((i) => i + 1)}>
                <Text style={[styles.navArrow, activeIndex >= schedules.length - 1 && styles.navArrowDisabled]}>›</Text>
              </Pressable>
            </View>

            <View style={styles.toolbar}>
              <Text style={styles.toolbarHint}>
                {activeIndex + 1} de {schedules.length}
              </Text>
              <View style={styles.toolbarActions}>
                <Pressable onPress={() => handleMoveSchedule("up")} disabled={activeIndex === 0}>
                  <Text style={[styles.toolbarAction, activeIndex === 0 && styles.navArrowDisabled]}>↑</Text>
                </Pressable>
                <Pressable onPress={() => handleMoveSchedule("down")} disabled={activeIndex >= schedules.length - 1}>
                  <Text style={[styles.toolbarAction, activeIndex >= schedules.length - 1 && styles.navArrowDisabled]}>↓</Text>
                </Pressable>
                <Pressable onPress={handleDeleteSchedule}>
                  <Text style={[styles.toolbarAction, styles.toolbarDelete]}>Eliminar horario</Text>
                </Pressable>
              </View>
            </View>

            <ScheduleTableGrid
              rows={rows}
              loading={loadingRows}
              onCellChange={updateLocalCell}
              onCellBlur={persistCell}
              onAddRow={handleAddRow}
              onDeleteRow={handleDeleteRow}
              onMoveRow={handleMoveRow}
            />
          </>
        ) : (
          <View style={styles.stackedList}>
            {schedules.map((schedule, index) => (
              <ScheduleTableCard
                key={schedule.id}
                schedule={schedule}
                canMoveUp={index > 0}
                canMoveDown={index < schedules.length - 1}
                onRename={(name) => renameScheduleById(schedule.id, name)}
                onDelete={() => deleteScheduleById(schedule.id)}
                onMoveUp={() => moveScheduleById(schedule.id, "up")}
                onMoveDown={() => moveScheduleById(schedule.id, "down")}
              />
            ))}
          </View>
        )}

        <AnnualCalendarLegend />
      </ScrollView>

      <Modal visible={showCreate} animationType="slide" transparent onRequestClose={() => setShowCreate(false)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 20 }]}>
            <Text style={styles.modalTitle}>Nuevo horario</Text>
            <TextInput style={styles.input} placeholder="Ej. 1r trimestre" value={newName} onChangeText={setNewName} autoFocus />
            <Pressable style={styles.saveButton} onPress={handleCreateSchedule}>
              <Text style={styles.saveButtonText}>Crear horario</Text>
            </Pressable>
            <Pressable style={styles.cancelButton} onPress={() => setShowCreate(false)}>
              <Text style={styles.cancelButtonText}>Cancelar</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

/** Tabla lunes-viernes pura: recibe `rows` ya cargadas y solo dispara los callbacks — la usan
 * tanto el modo Flechas (rows del `active` de arriba) como cada ScheduleTableCard del modo
 * Apilado (rows propias de ese horario), evitando duplicar el marcado de la tabla dos veces. */
function ScheduleTableGrid({
  rows,
  loading,
  onCellChange,
  onCellBlur,
  onAddRow,
  onDeleteRow,
  onMoveRow,
}: {
  rows: LocalScheduleRow[];
  loading: boolean;
  onCellChange: (rowId: string, field: DayKey | "timeLabel", value: string) => void;
  onCellBlur: (rowId: string, field: DayKey | "timeLabel", value: string) => void;
  onAddRow: () => void;
  onDeleteRow: (rowId: string) => void;
  onMoveRow: (rowId: string, direction: "up" | "down") => void;
}) {
  if (loading) return <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />;

  return (
    <ScrollView horizontal contentContainerStyle={styles.tableScroll} showsHorizontalScrollIndicator>
      <View style={styles.table}>
        <View style={styles.tableHeaderRow}>
          <View style={[styles.cell, styles.timeCell]}>
            <Text style={styles.headerText}>Hora</Text>
          </View>
          {DAY_KEYS.map((key) => (
            <View key={key} style={[styles.cell, styles.dayCell]}>
              <Text style={styles.headerText}>{DAY_LABELS[key]}</Text>
            </View>
          ))}
          <View style={[styles.cell, styles.actionsCell]} />
        </View>

        {rows.map((row, index) => (
          <View key={row.id} style={styles.tableRow}>
            <View style={[styles.cell, styles.timeCell]}>
              <TextInput
                style={styles.timeCellInput}
                value={row.timeLabel}
                placeholder="08:00 - 10:00"
                placeholderTextColor={colors.mutedForeground}
                multiline
                onChangeText={(v) => onCellChange(row.id, "timeLabel", v)}
                onBlur={() => onCellBlur(row.id, "timeLabel", row.timeLabel)}
              />
            </View>
            {DAY_KEYS.map((key) => (
              <View key={key} style={[styles.cell, styles.dayCell]}>
                <TextInput
                  style={styles.dayCellInput}
                  value={row[key]}
                  placeholder="—"
                  placeholderTextColor={colors.border}
                  multiline
                  onChangeText={(v) => onCellChange(row.id, key, v)}
                  onBlur={() => onCellBlur(row.id, key, row[key])}
                />
              </View>
            ))}
            <View style={[styles.cell, styles.actionsCell]}>
              <Pressable onPress={() => onMoveRow(row.id, "up")} disabled={index === 0}>
                <Text style={[styles.rowAction, index === 0 && styles.navArrowDisabled]}>↑</Text>
              </Pressable>
              <Pressable onPress={() => onMoveRow(row.id, "down")} disabled={index === rows.length - 1}>
                <Text style={[styles.rowAction, index === rows.length - 1 && styles.navArrowDisabled]}>↓</Text>
              </Pressable>
              <Pressable onPress={() => onDeleteRow(row.id)}>
                <Text style={[styles.rowAction, styles.toolbarDelete]}>✕</Text>
              </Pressable>
            </View>
          </View>
        ))}

        <Pressable style={styles.addRowButton} onPress={onAddRow}>
          <Text style={styles.addRowButtonText}>+ Añadir franja horaria</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

/** Un horario completo (título propio + su ScheduleTableGrid) del modo Apilado — puerto de
 * ScheduleTable en dashboard/src/pages/SchedulePage.tsx: a diferencia del modo Flechas (que
 * comparte el `rows`/`reloadRows` de HorarioScreen), aquí cada tarjeta carga y guarda sus propias
 * filas, porque en Apilado hay varios horarios visibles a la vez. */
function ScheduleTableCard({
  schedule,
  canMoveUp,
  canMoveDown,
  onRename,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  schedule: LocalSchedule;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onRename: (name: string) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [rows, setRows] = useState<LocalScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(schedule.name);

  const reload = useCallback(async () => {
    setLoading(true);
    setRows(await listForSchedule(schedule.id));
    setLoading(false);
  }, [schedule.id]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    setNameDraft(schedule.name);
  }, [schedule.name]);

  const updateLocalCell = (rowId: string, field: DayKey | "timeLabel", value: string) => {
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, [field]: value } : r)));
  };

  const persistCell = async (rowId: string, field: DayKey | "timeLabel", value: string) => {
    await updateRowCellLocal(rowId, field, value);
    await runSync();
  };

  const handleAddRow = async () => {
    await createRowLocal(schedule.id, "");
    await reload();
    await runSync();
  };

  const handleDeleteRow = async (rowId: string) => {
    await deleteRowLocal(rowId);
    await reload();
    await runSync();
  };

  const handleMoveRow = async (rowId: string, direction: "up" | "down") => {
    await moveRowLocal(rowId, direction);
    await reload();
    await runSync();
  };

  const handleRename = () => {
    const trimmed = nameDraft.trim();
    setRenaming(false);
    if (!trimmed || trimmed === schedule.name) {
      setNameDraft(schedule.name);
      return;
    }
    onRename(trimmed);
  };

  return (
    <View>
      <View style={styles.stackedHeader}>
        {renaming ? (
          <TextInput
            style={styles.stackedNameInput}
            value={nameDraft}
            onChangeText={setNameDraft}
            onBlur={handleRename}
            onSubmitEditing={handleRename}
            autoFocus
          />
        ) : (
          <Pressable
            style={styles.stackedTitleButton}
            onPress={() => {
              setNameDraft(schedule.name);
              setRenaming(true);
            }}
          >
            <Text style={styles.stackedTitle} numberOfLines={1}>
              {schedule.name}
            </Text>
          </Pressable>
        )}
        <View style={styles.toolbarActions}>
          <Pressable onPress={onMoveUp} disabled={!canMoveUp}>
            <Text style={[styles.toolbarAction, !canMoveUp && styles.navArrowDisabled]}>↑</Text>
          </Pressable>
          <Pressable onPress={onMoveDown} disabled={!canMoveDown}>
            <Text style={[styles.toolbarAction, !canMoveDown && styles.navArrowDisabled]}>↓</Text>
          </Pressable>
          <Pressable onPress={onDelete}>
            <Text style={[styles.toolbarAction, styles.toolbarDelete]}>Eliminar horario</Text>
          </Pressable>
        </View>
      </View>

      <ScheduleTableGrid
        rows={rows}
        loading={loading}
        onCellChange={updateLocalCell}
        onCellBlur={persistCell}
        onAddRow={handleAddRow}
        onDeleteRow={handleDeleteRow}
        onMoveRow={handleMoveRow}
      />
    </View>
  );
}

const TIME_COL_WIDTH = 96;
const DAY_COL_WIDTH = 128;
const ACTIONS_COL_WIDTH = 60;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, paddingBottom: 8 },
  title: { fontFamily: fonts.serif, fontSize: 30, color: colors.foreground },
  newButton: { backgroundColor: colors.foreground, borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 8 },
  newButtonText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.background },
  content: { padding: 20 },
  errorBanner: { fontFamily: fonts.sans, fontSize: 12, color: colors.destructive, paddingHorizontal: 20, paddingBottom: 8 },
  syncBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 8, gap: 8 },
  syncText: { fontFamily: fonts.sans, fontSize: 11, color: colors.mutedForeground },
  emptyText: { fontFamily: fonts.sans, fontSize: 14, color: colors.mutedForeground, fontStyle: "italic" },

  // rounded-full border border-border p-1 de la web (SchedulePage.tsx) — el toggle Flechas/Apilado.
  viewModeRow: { paddingHorizontal: 20, paddingBottom: 8 },
  viewModePill: {
    flexDirection: "row",
    alignSelf: "flex-start",
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
    gap: 2,
  },
  viewModeButton: { borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 6 },
  viewModeButtonActive: { backgroundColor: colors.primary },
  viewModeButtonText: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.mutedForeground },
  viewModeButtonTextActive: { color: colors.primaryForeground },

  screenScroll: { paddingBottom: 20 },

  nav: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: 20 },
  navArrow: { fontFamily: fonts.sansBold, fontSize: 24, color: colors.mutedForeground },
  navArrowDisabled: { opacity: 0.3 },
  navTitle: { fontFamily: fonts.serif, fontSize: 24, color: colors.foreground, textAlign: "center" },
  nameButton: { flex: 1, alignItems: "center" },
  nameInput: {
    flex: 1,
    fontFamily: fonts.serif,
    fontSize: 24,
    color: colors.foreground,
    textAlign: "center",
    borderBottomWidth: 1,
    borderBottomColor: colors.primary,
    paddingVertical: 2,
  },

  toolbar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  toolbarHint: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground },
  toolbarActions: { flexDirection: "row", alignItems: "center", gap: 16 },
  toolbarAction: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.mutedForeground },
  toolbarDelete: { color: colors.destructive },

  // ========== MODO APILADO ==========
  stackedList: { gap: 28 },
  stackedHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  stackedTitleButton: { flexShrink: 1, minWidth: 0 },
  stackedTitle: { fontFamily: fonts.serif, fontSize: 22, color: colors.foreground },
  stackedNameInput: {
    flex: 1,
    minWidth: 120,
    fontFamily: fonts.serif,
    fontSize: 22,
    color: colors.foreground,
    borderBottomWidth: 1,
    borderBottomColor: colors.primary,
    paddingVertical: 2,
  },

  tableScroll: { paddingHorizontal: 20, paddingBottom: 30 },
  table: {
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    overflow: "hidden",
    ...shadow,
  },
  tableHeaderRow: { flexDirection: "row", backgroundColor: colors.muted },
  tableRow: { flexDirection: "row", borderTopWidth: 1, borderTopColor: colors.border },
  cell: { borderRightWidth: 1, borderRightColor: colors.border, padding: 8, justifyContent: "center" },
  timeCell: { width: TIME_COL_WIDTH },
  dayCell: { width: DAY_COL_WIDTH },
  actionsCell: { width: ACTIONS_COL_WIDTH, borderRightWidth: 0, flexDirection: "row", justifyContent: "center", gap: 4 },
  headerText: {
    fontFamily: fonts.sansBold,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: colors.mutedForeground,
  },
  timeCellInput: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.mutedForeground, minHeight: 40 },
  dayCellInput: { fontFamily: fonts.sans, fontSize: 13, color: colors.foreground, minHeight: 40 },
  rowAction: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.mutedForeground, padding: 2 },
  addRowButton: { padding: 14, alignItems: "center", borderTopWidth: 1, borderTopColor: colors.border },
  addRowButtonText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.primary },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(45,41,38,0.4)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    padding: 20,
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
  saveButton: { backgroundColor: colors.primary, borderRadius: radius.full, padding: 15, alignItems: "center", marginTop: 8 },
  saveButtonText: { fontFamily: fonts.sansMedium, color: colors.primaryForeground, fontSize: 15 },
  cancelButton: { alignItems: "center", padding: 10 },
  cancelButtonText: { fontFamily: fonts.sans, color: colors.mutedForeground, fontSize: 14 },
});
