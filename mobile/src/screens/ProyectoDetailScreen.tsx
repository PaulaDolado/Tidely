import { useCallback, useEffect, useState } from "react";
import { View, Pressable, ScrollView, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { Text, TextInput } from "../components/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { runSync } from "../sync";
import { getProject, updateProjectLocal, deleteProjectLocal } from "../db/projectsRepo";
import {
  listForProject as listTasksForProject,
  createProjectTaskLocal,
  updateProjectTaskTitleLocal,
  setProjectTaskCompletedLocal,
  deleteProjectTaskLocal,
} from "../db/projectTasksRepo";
import {
  listForProject as listPagesForProject,
  createProjectPageLocal,
  updateProjectPageLocal,
  deleteProjectPageLocal,
} from "../db/projectPagesRepo";
import { LocalProject, LocalProjectPage, LocalProjectTask } from "../types";
import { htmlToPlainText, plainTextToHtml } from "../utils/htmlText";
import { colors, fonts, radius, shadow } from "../theme";
import { ProyectosStackParamList } from "./ProyectosScreen";

// Cuaderno de un proyecto — puerto de ProjectNotebook + ProjectPages en
// dashboard/src/pages/ProyectosPage.tsx. Offline-first, igual que el resto de pantallas: lee/
// escribe en SQLite (projectsRepo/projectTasksRepo/projectPagesRepo) y sincroniza vía runSync().
// Dos simplificaciones deliberadas frente a la web:
//   - El contenido de cada página se edita como texto plano, no con el editor enriquecido de la
//     web (negrita/listas/imágenes) — no hay ninguna librería de rich text en package.json, y
//     traer una solo para esto es demasiado para lo que se pidió. Ver utils/htmlText.ts
//     (htmlToPlainText/plainTextToHtml) para la conversión en los dos sentidos — compartido con la
//     plantilla "Nota en blanco" de página personalizada (PaginaDetailScreen.tsx).
//   - Guardado explícito con un botón, no autoguardado a los 600ms de cada tecla — mismo criterio
//     que el resto de editores del móvil (ver PaginaDetailScreen.tsx).
// La exportación a PDF/Word de la web tampoco tiene equivalente aquí (usa el diálogo de impresión
// del navegador y un blob .doc, ninguno de los dos existe en un teléfono).
type ProjectStatus = "idea" | "en_curso" | "pausado" | "completado";
const STATUS_LABELS: Record<ProjectStatus, string> = {
  idea: "Idea",
  en_curso: "En curso",
  pausado: "Pausado",
  completado: "Completado",
};
const STATUS_ORDER: ProjectStatus[] = ["idea", "en_curso", "pausado", "completado"];

function computeProgress(tasks: LocalProjectTask[]): { total: number; completed: number } {
  const total = tasks.length;
  const completed = tasks.filter((t) => t.completed === 1).length;
  return { total, completed };
}

type Props = NativeStackScreenProps<ProyectosStackParamList, "Detalle">;

export function ProyectoDetailScreen({ route, navigation }: Props) {
  const { id: projectId } = route.params;
  const [project, setProject] = useState<LocalProject | null>(null);
  const [tasks, setTasks] = useState<LocalProjectTask[]>([]);
  const [pages, setPages] = useState<LocalProjectPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [pageTitle, setPageTitle] = useState("");
  const [content, setContent] = useState("");
  const [savingContent, setSavingContent] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [taskDraft, setTaskDraft] = useState("");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTaskTitle, setEditingTaskTitle] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    const [loadedProject, loadedTasks, loadedPages] = await Promise.all([
      getProject(projectId),
      listTasksForProject(projectId),
      listPagesForProject(projectId),
    ]);
    setProject(loadedProject);
    setTasks(loadedTasks);
    setPages(loadedPages);
    setLoading(false);
  }, [projectId]);

  const sync = useCallback(async () => {
    setSyncError(null);
    const result = await runSync();
    if (result.success) await reload();
    else setSyncError(result.error ?? "No se pudo sincronizar");
  }, [reload]);

  useFocusEffect(
    useCallback(() => {
      reload();
      sync();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId])
  );

  // Selecciona la primera página en cuanto cargan (si no hay ninguna abierta ya) — igual que en
  // la web.
  useEffect(() => {
    if (selectedPageId === null && pages.length > 0) selectPage(pages[0]);
    // Si la página seleccionada se borró en otro sitio, vuelve a la primera disponible.
    if (selectedPageId !== null && !pages.some((p) => p.id === selectedPageId)) {
      if (pages.length > 0) selectPage(pages[0]);
      else setSelectedPageId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages]);

  function selectPage(page: LocalProjectPage) {
    setSelectedPageId(page.id);
    setPageTitle(page.title);
    setContent(htmlToPlainText(page.content));
    setDirty(false);
  }

  const cycleStatus = async () => {
    if (!project) return;
    const next = STATUS_ORDER[(STATUS_ORDER.indexOf(project.status as ProjectStatus) + 1) % STATUS_ORDER.length];
    await updateProjectLocal(projectId, {
      title: project.title,
      description: project.description,
      status: next,
      priority: project.priority,
      deadline: project.deadline,
      color: project.color,
    });
    await reload();
    await sync();
  };

  const confirmDeleteProject = () => {
    Alert.alert("Eliminar proyecto", `¿Seguro que quieres eliminar "${project?.title}" y todas sus páginas?`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: async () => {
          await deleteProjectLocal(projectId);
          await sync();
          navigation.goBack();
        },
      },
    ]);
  };

  // --- Apuntes rápidos ---

  const addTask = async () => {
    const title = taskDraft.trim();
    if (!title) return;
    setTaskDraft("");
    await createProjectTaskLocal(projectId, title);
    await reload();
    await sync();
  };

  const toggleTask = async (task: LocalProjectTask) => {
    await setProjectTaskCompletedLocal(task.id, task.completed !== 1);
    await reload();
    await sync();
  };

  const saveTaskTitle = async (taskId: string, title: string) => {
    setEditingTaskId(null);
    const trimmed = title.trim();
    if (!trimmed) return; // vacío: se descarta el cambio, igual que en la web
    await updateProjectTaskTitleLocal(taskId, trimmed);
    await reload();
    await sync();
  };

  const confirmDeleteTask = (task: LocalProjectTask) => {
    Alert.alert("Eliminar apunte", `¿Quitar "${task.title}"?`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: async () => {
          await deleteProjectTaskLocal(task.id);
          await reload();
          await sync();
        },
      },
    ]);
  };

  // --- Páginas ---

  const addPage = async () => {
    const id = await createProjectPageLocal(projectId, `Página ${pages.length + 1}`);
    const refreshed = await listPagesForProject(projectId);
    setPages(refreshed);
    const created = refreshed.find((p) => p.id === id);
    if (created) selectPage(created);
    await sync();
  };

  const saveTitle = async () => {
    if (selectedPageId === null) return;
    const trimmed = pageTitle.trim();
    if (!trimmed) return;
    await updateProjectPageLocal(selectedPageId, { title: trimmed });
    setPages((prev) => prev.map((p) => (p.id === selectedPageId ? { ...p, title: trimmed } : p)));
    await sync();
  };

  const saveContent = async () => {
    if (selectedPageId === null) return;
    setSavingContent(true);
    try {
      const html = plainTextToHtml(content);
      await updateProjectPageLocal(selectedPageId, { content: html });
      setPages((prev) => prev.map((p) => (p.id === selectedPageId ? { ...p, content: html } : p)));
      setDirty(false);
    } finally {
      setSavingContent(false);
    }
    await sync();
  };

  // Página vacía se borra sin preguntar (nada que perder); con contenido, pide confirmación —
  // igual que en la web.
  const handleDeletePage = (page: LocalProjectPage) => {
    const isEmpty = !page.content || htmlToPlainText(page.content).trim() === "";
    const doDelete = async () => {
      await deleteProjectPageLocal(page.id);
      setPages((prev) => prev.filter((p) => p.id !== page.id));
      await sync();
    };
    if (isEmpty) {
      doDelete();
      return;
    }
    Alert.alert("Eliminar página", `¿Seguro que quieres eliminar "${page.title}"?`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Eliminar", style: "destructive", onPress: doDelete },
    ]);
  };

  if (loading && !project) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  if (!project) return null;

  const progress = computeProgress(tasks);

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      {syncError && <Text style={styles.errorBanner}>{syncError} — se reintentará solo</Text>}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.statusRow}>
          <Pressable style={styles.statusBadge} onPress={cycleStatus}>
            <Text style={styles.statusBadgeText}>{STATUS_LABELS[project.status as ProjectStatus] ?? project.status}</Text>
          </Pressable>
          <Text style={styles.progressText}>
            {progress.completed}/{progress.total} apuntes resueltos
          </Text>
        </View>

        {/* APUNTES RÁPIDOS */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Apuntes rápidos</Text>
          <View style={styles.taskInputRow}>
            <TextInput
              style={styles.taskInput}
              placeholder="Escribe un apunte rápido…"
              placeholderTextColor={colors.mutedForeground}
              value={taskDraft}
              onChangeText={setTaskDraft}
              onSubmitEditing={addTask}
            />
            <Pressable style={styles.taskAddButton} onPress={addTask}>
              <Text style={styles.taskAddButtonText}>+</Text>
            </Pressable>
          </View>

          {tasks.length === 0 ? (
            <Text style={styles.emptyText}>Aún no tienes apuntes en esta libreta.</Text>
          ) : (
            tasks.map((task) => (
              <View key={task.id} style={styles.taskRow}>
                <Pressable
                  style={[styles.taskCheckbox, task.completed === 1 && styles.taskCheckboxDone]}
                  onPress={() => toggleTask(task)}
                >
                  {task.completed === 1 && <Text style={styles.taskCheckboxMark}>✓</Text>}
                </Pressable>
                {editingTaskId === task.id ? (
                  <TextInput
                    autoFocus
                    style={styles.taskEditInput}
                    value={editingTaskTitle}
                    onChangeText={setEditingTaskTitle}
                    onBlur={() => saveTaskTitle(task.id, editingTaskTitle)}
                    onSubmitEditing={() => saveTaskTitle(task.id, editingTaskTitle)}
                  />
                ) : (
                  <Pressable
                    style={{ flex: 1, minWidth: 0 }}
                    onPress={() => {
                      if (task.completed === 1) return;
                      setEditingTaskTitle(task.title);
                      setEditingTaskId(task.id);
                    }}
                  >
                    <Text numberOfLines={2} style={[styles.taskTitle, task.completed === 1 && styles.taskTitleDone]}>
                      {task.title}
                    </Text>
                  </Pressable>
                )}
                <Pressable onPress={() => confirmDeleteTask(task)} hitSlop={8}>
                  <Text style={styles.taskDelete}>✕</Text>
                </Pressable>
              </View>
            ))
          )}
        </View>

        {/* PÁGINAS */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Páginas</Text>

          <View style={styles.pageChipRow}>
            {pages.map((page) => (
              <Pressable
                key={page.id}
                style={[styles.pageChip, page.id === selectedPageId && styles.pageChipSelected]}
                onPress={() => selectPage(page)}
              >
                <Text style={[styles.pageChipText, page.id === selectedPageId && styles.pageChipTextSelected]} numberOfLines={1}>
                  {page.title}
                </Text>
                <Pressable onPress={() => handleDeletePage(page)} hitSlop={8}>
                  <Text style={[styles.pageChipDelete, page.id === selectedPageId && styles.pageChipTextSelected]}> ✕</Text>
                </Pressable>
              </Pressable>
            ))}
            <Pressable style={styles.pageChipAdd} onPress={addPage}>
              <Text style={styles.pageChipAddText}>+ Página</Text>
            </Pressable>
          </View>

          {pages.length === 0 ? (
            <Text style={styles.emptyText}>Aún no tienes páginas. Crea una para escribir tus apuntes.</Text>
          ) : selectedPageId === null ? null : (
            <>
              <TextInput
                style={styles.pageTitleInput}
                value={pageTitle}
                onChangeText={setPageTitle}
                onBlur={saveTitle}
                onSubmitEditing={saveTitle}
                placeholder="Título de la página"
                placeholderTextColor={colors.mutedForeground}
              />
              <TextInput
                style={styles.pageContentInput}
                value={content}
                onChangeText={(t) => {
                  setContent(t);
                  setDirty(true);
                }}
                placeholder="Escribe aquí…"
                placeholderTextColor={colors.mutedForeground}
                multiline
                textAlignVertical="top"
              />
              <Pressable style={styles.saveContentButton} onPress={saveContent} disabled={savingContent || !dirty}>
                <Text style={styles.saveContentButtonText}>{savingContent ? "Guardando…" : dirty ? "Guardar" : "Guardado"}</Text>
              </Pressable>
            </>
          )}
        </View>

        <Pressable style={styles.deleteProjectButton} onPress={confirmDeleteProject}>
          <Text style={styles.deleteProjectText}>Eliminar proyecto</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 24, paddingBottom: 40 },
  errorBanner: { fontFamily: fonts.sans, fontSize: 13, color: colors.destructive, padding: 20 },
  emptyText: { fontFamily: fonts.sans, fontSize: 13, color: colors.mutedForeground, fontStyle: "italic" },

  statusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  statusBadge: { backgroundColor: colors.secondary, borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 6 },
  statusBadgeText: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.secondaryForeground },
  progressText: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground },

  section: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    gap: 10,
    ...shadow,
  },
  sectionLabel: {
    fontFamily: fonts.sansBold,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: colors.mutedForeground,
  },

  // Apuntes rápidos
  taskInputRow: { flexDirection: "row", gap: 8 },
  taskInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.input,
    backgroundColor: colors.background,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.foreground,
  },
  taskAddButton: { width: 40, backgroundColor: colors.primary, borderRadius: radius.input, alignItems: "center", justifyContent: "center" },
  taskAddButtonText: { color: colors.primaryForeground, fontSize: 20, fontFamily: fonts.sansBold },
  taskRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    borderRadius: radius.input,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  taskCheckbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  taskCheckboxDone: { backgroundColor: colors.primaryTint, borderColor: colors.primary },
  taskCheckboxMark: { fontSize: 10, color: colors.primary, fontFamily: fonts.sansBold },
  taskTitle: { fontFamily: fonts.sans, fontSize: 14, color: colors.foreground },
  taskTitleDone: { color: colors.mutedForeground, textDecorationLine: "line-through" },
  taskEditInput: {
    flex: 1,
    minWidth: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.primary,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.foreground,
    paddingVertical: 2,
  },
  taskDelete: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.mutedForeground, padding: 4 },

  // Páginas
  pageChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pageChip: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
    maxWidth: 180,
  },
  pageChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  pageChipText: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground, flexShrink: 1 },
  pageChipTextSelected: { color: colors.primaryForeground },
  pageChipDelete: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground, opacity: 0.7 },
  pageChipAdd: {
    borderRadius: radius.full,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pageChipAddText: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground },
  pageTitleInput: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: 8,
    fontFamily: fonts.serif,
    fontSize: 18,
    color: colors.foreground,
  },
  pageContentInput: {
    minHeight: 180,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.input,
    backgroundColor: colors.background,
    padding: 12,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.foreground,
  },
  saveContentButton: {
    alignSelf: "flex-start",
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  saveContentButtonText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.primaryForeground },

  deleteProjectButton: { alignItems: "center", paddingVertical: 12 },
  deleteProjectText: { fontFamily: fonts.sansSemiBold, fontSize: 13, color: colors.destructive },
});
