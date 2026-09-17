import { useCallback, useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator, Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { runSync } from "../sync";
import { listProjects, createProjectLocal } from "../db/projectsRepo";
import { createProjectTaskLocal } from "../db/projectTasksRepo";
import { LocalProject } from "../types";
import { colors, fonts, radius, shadow } from "../theme";
import { useSidebar, SIDEBAR_CLIP_CLEARANCE } from "../navigation/SidebarContext";
import { ProyectosStackParamList } from "./ProyectosScreen";
import { FolderIcon } from "../components/FolderIcon";

// Galería de proyectos — puerto de dashboard/src/pages/ProyectosPage.tsx. La web pinta cada
// proyecto como la tapa de una carpeta de archivador (pestaña recortada, colores alternos); aquí
// se simplifica a una lista de tarjetas (mismo criterio que PaginasListScreen.tsx), pero con un
// icono de carpeta (FolderIcon) que retoma esa misma idea — mismos dos tonos alternos que
// `NotebookCover` (dashboard/src/pages/ProyectosPage.tsx): `colors.cover` (tapa marrón) /
// `colors.secondary` (arena), sin inventar una paleta "carpeta amarilla" ajena a la web.
// Offline-first, igual que el resto de pantallas: lee/escribe en SQLite (projectsRepo) y
// sincroniza vía runSync().
type ProjectStatus = "idea" | "en_curso" | "pausado" | "completado";
const STATUS_LABELS: Record<ProjectStatus, string> = {
  idea: "Idea",
  en_curso: "En curso",
  pausado: "Pausado",
  completado: "Completado",
};

type Props = NativeStackScreenProps<ProyectosStackParamList, "Lista">;

export function ProyectosListScreen({ navigation }: Props) {
  const { collapsed } = useSidebar();
  const [projects, setProjects] = useState<LocalProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setProjects(await listProjects());
    setLoading(false);
  }, []);

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
    }, [])
  );

  const handleCreate = async (title: string, note: string) => {
    const id = await createProjectLocal({ title, description: note || null, status: "idea", priority: "medium", deadline: null, color: null });
    // Mismo detalle que la web: el apunte rápido opcional del formulario de creación se guarda
    // como la primera tarea de la libreta, no como `description` duplicada.
    if (note.trim()) await createProjectTaskLocal(id, note.trim());
    setShowCreate(false);
    await reload();
    await sync();
    navigation.navigate("Detalle", { id, title });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.header, collapsed && { paddingLeft: SIDEBAR_CLIP_CLEARANCE }]}>
        <Text style={styles.title}>Proyectos</Text>
        <Pressable style={styles.newButton} onPress={() => setShowCreate(true)}>
          <Text style={styles.newButtonText}>+ Nuevo</Text>
        </Pressable>
      </View>

      {syncError && <Text style={styles.errorBanner}>{syncError} — se reintentará solo</Text>}

      <ScrollView contentContainerStyle={styles.content}>
        {loading && projects.length === 0 ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
        ) : projects.length === 0 ? (
          <Text style={styles.emptyText}>Todavía no tienes proyectos.</Text>
        ) : (
          projects.map((project, index) => {
            // Mismo alternado que `dark = i % 2 === 0` en NotebookCover (ProyectosPage.tsx): no
            // hay color propio por proyecto en el modelo de datos (ni en la web ni en la API),
            // así que el tono se alterna por posición, no por id.
            const dark = index % 2 === 0;
            return (
              <Pressable
                key={project.id}
                style={styles.projectCard}
                onPress={() => navigation.navigate("Detalle", { id: project.id, title: project.title })}
              >
                <View style={styles.projectHeader}>
                  <FolderIcon size={40} color={dark ? colors.cover : colors.secondary} shade={dark ? colors.secondary : colors.cover} />
                  <Text style={styles.projectTitle} numberOfLines={1}>
                    {project.title}
                  </Text>
                  <View style={styles.statusBadge}>
                    <Text style={styles.statusBadgeText}>{STATUS_LABELS[project.status as ProjectStatus] ?? project.status}</Text>
                  </View>
                </View>
                {project.description && (
                  <Text style={styles.projectDescription} numberOfLines={2}>
                    {project.description}
                  </Text>
                )}
                <Text style={styles.openHint}>Toca para abrir tus apuntes →</Text>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <Modal visible={showCreate} animationType="slide" transparent onRequestClose={() => setShowCreate(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <NewProjectForm onCancel={() => setShowCreate(false)} onSubmit={handleCreate} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function NewProjectForm({ onSubmit, onCancel }: { onSubmit: (title: string, note: string) => Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    await onSubmit(title.trim(), note);
    setSaving(false);
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <Text style={styles.modalTitle}>Nuevo proyecto</Text>

      <Text style={styles.fieldLabel}>Nombre del proyecto</Text>
      <TextInput style={styles.input} placeholder="Nombre del proyecto" value={title} onChangeText={setTitle} />

      <Text style={styles.fieldLabel}>Apunte rápido (opcional)</Text>
      <TextInput style={styles.input} placeholder="¿De qué trata?" value={note} onChangeText={setNote} />

      <Pressable style={styles.saveButton} onPress={submit} disabled={saving || !title.trim()}>
        <Text style={styles.saveButtonText}>{saving ? "Abriendo…" : "Abrir página"}</Text>
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
  content: { padding: 20, paddingTop: 8, gap: 12, paddingBottom: 40 },
  errorBanner: { fontFamily: fonts.sans, fontSize: 12, color: colors.destructive },
  emptyText: { fontFamily: fonts.sans, fontSize: 14, color: colors.mutedForeground, fontStyle: "italic" },

  projectCard: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.secondary,
    padding: 18,
    ...shadow,
  },
  // alignItems "center" (no "flex-start" como antes) — con el FolderIcon (más alto que una línea
  // de texto) al principio de la fila, "flex-start" dejaba el título y la chapa de estado
  // pegados arriba mientras el icono se extendía varios px por debajo, descentrados entre sí.
  projectHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  projectTitle: { flex: 1, minWidth: 0, fontFamily: fonts.serif, fontSize: 20, color: colors.foreground },
  statusBadge: { backgroundColor: colors.muted, borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 3 },
  statusBadgeText: { fontFamily: fonts.sansMedium, fontSize: 11, color: colors.mutedForeground },
  projectDescription: { marginTop: 6, fontFamily: fonts.sans, fontSize: 13, color: colors.mutedForeground },
  openHint: { marginTop: 12, fontFamily: fonts.sans, fontSize: 11, color: colors.mutedForeground },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(45,41,38,0.4)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    padding: 20,
    maxHeight: "88%",
  },
  modalTitle: { fontFamily: fonts.serif, fontSize: 24, color: colors.foreground, marginBottom: 16 },
  fieldLabel: {
    fontFamily: fonts.sansBold,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: colors.mutedForeground,
    marginBottom: 6,
  },
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
