import { useCallback, useState } from "react";
import { View, Pressable, ScrollView, StyleSheet, ActivityIndicator, Modal, KeyboardAvoidingView } from "react-native";
import { Text, TextInput } from "../components/AppText";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
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
// icono de carpeta (FolderIcon) que retoma esa misma idea — con los mismos tonos que
// `NotebookCover` (dashboard/src/pages/ProyectosPage.tsx): `colors.cover` (cuero), `colors.secondary`
// (arena) y `colors.solidCard` (salvia), elegidos al crear el proyecto (project.color) y, si no hay
// color, rotando por posición; sin inventar una paleta "carpeta amarilla" ajena a la web.
// Offline-first, igual que el resto de pantallas: lee/escribe en SQLite (projectsRepo) y
// sincroniza vía runSync().
type ProjectStatus = "idea" | "en_curso" | "pausado" | "completado";
const STATUS_LABELS: Record<ProjectStatus, string> = {
  idea: "Idea",
  en_curso: "En curso",
  pausado: "Pausado",
  completado: "Completado",
};

// Colores de carpeta elegibles al crear un proyecto — mismos tres valores y nombres que
// PROJECT_COLORS/PROJECT_COLOR_LABELS en la web (cover/sand/sage). El valor guardado es la
// CLAVE ("cover"), no un hex, porque así lo espera el backend y así lo lee la web; el hex real
// sale del tema activo (colors.*) en el momento de pintar, igual que TONE_CLASSES en la web.
type ProjectColor = "cover" | "sand" | "sage";
const PROJECT_COLORS: ProjectColor[] = ["cover", "sand", "sage"];
const PROJECT_COLOR_LABELS: Record<ProjectColor, string> = { cover: "Cuero", sand: "Arena", sage: "Verde salvia" };

// `colors` es mutable (cambia con el tema), por eso se resuelve en una función y no en una
// constante de módulo, que se quedaría con los valores del tema del primer render.
function folderTones(tone: ProjectColor): { body: string; shade: string } {
  switch (tone) {
    case "cover":
      return { body: colors.cover, shade: colors.secondary };
    case "sand":
      return { body: colors.secondary, shade: colors.cover };
    default:
      return { body: colors.solidCard, shade: colors.secondary };
  }
}

function swatchColor(tone: ProjectColor): string {
  return folderTones(tone).body;
}

function isProjectColor(value: string | null): value is ProjectColor {
  return value === "cover" || value === "sand" || value === "sage";
}

type Props = NativeStackScreenProps<ProyectosStackParamList, "Lista">;

export function ProyectosListScreen({ navigation }: Props) {
  const { collapsed } = useSidebar();
  const insets = useSafeAreaInsets();
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

  const handleCreate = async (title: string, note: string, color: ProjectColor | null) => {
    const id = await createProjectLocal({ title, description: note || null, status: "idea", priority: "medium", deadline: null, color });
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
            // Igual que la web (`project.color ?? PROJECT_COLORS[i % 3]`): el color elegido al
            // crear manda; sin color (o con un valor desconocido) la carpeta rota por posición.
            const tone = isProjectColor(project.color) ? project.color : PROJECT_COLORS[index % PROJECT_COLORS.length];
            const folder = folderTones(tone);
            return (
              <Pressable
                key={project.id}
                style={styles.projectCard}
                onPress={() => navigation.navigate("Detalle", { id: project.id, title: project.title })}
              >
                <View style={styles.projectHeader}>
                  <FolderIcon size={40} color={folder.body} shade={folder.shade} />
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
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior="padding">
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 20 }]}>
            <NewProjectForm onCancel={() => setShowCreate(false)} onSubmit={handleCreate} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function NewProjectForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (title: string, note: string, color: ProjectColor | null) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  // `null` = "Automático": se guarda color null y la carpeta rota por posición, como en la web.
  const [color, setColor] = useState<ProjectColor | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    await onSubmit(title.trim(), note, color);
    setSaving(false);
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <Text style={styles.modalTitle}>Nuevo proyecto</Text>

      <Text style={styles.fieldLabel}>Nombre del proyecto</Text>
      <TextInput style={styles.input} placeholder="Nombre del proyecto" value={title} onChangeText={setTitle} />

      <Text style={styles.fieldLabel}>Apunte rápido (opcional)</Text>
      <TextInput style={styles.input} placeholder="¿De qué trata?" value={note} onChangeText={setNote} />

      <Text style={styles.fieldLabel}>Color de la carpeta</Text>
      <View style={styles.swatchRow}>
        <Pressable
          accessibilityLabel="Automático"
          onPress={() => setColor(null)}
          style={[styles.swatch, styles.swatchAuto, color === null && styles.swatchSelected]}
        />
        {PROJECT_COLORS.map((c) => (
          <Pressable
            key={c}
            accessibilityLabel={PROJECT_COLOR_LABELS[c]}
            onPress={() => setColor(c)}
            style={[styles.swatch, { backgroundColor: swatchColor(c), borderWidth: 1, borderColor: colors.border }, color === c && styles.swatchSelected]}
          />
        ))}
        <Text style={styles.swatchName}>{color === null ? "Automático" : PROJECT_COLOR_LABELS[color]}</Text>
      </View>

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
  swatchRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 },
  swatch: { width: 30, height: 30, borderRadius: radius.full },
  swatchAuto: { borderWidth: 1, borderStyle: "dashed", borderColor: colors.mutedForeground },
  // Anillo exterior al seleccionar, como el ring-2 de los swatches de la web.
  swatchSelected: { borderWidth: 3, borderColor: colors.foreground },
  swatchName: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground },
  saveButton: { backgroundColor: colors.primary, borderRadius: radius.full, padding: 15, alignItems: "center", marginTop: 8 },
  saveButtonText: { fontFamily: fonts.sansMedium, color: colors.primaryForeground, fontSize: 15 },
  cancelButton: { alignItems: "center", padding: 10 },
  cancelButtonText: { fontFamily: fonts.sans, color: colors.mutedForeground, fontSize: 14 },
});
