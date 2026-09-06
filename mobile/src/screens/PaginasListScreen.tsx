import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, Modal, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ApiError } from "../api/client";
import {
  CustomPageSummary,
  CustomPageTemplate,
  createCustomPage,
  deleteCustomPage,
  listCustomPages,
  moveCustomPage,
  TEMPLATE_LABELS,
} from "../api/customPages";
import { colors, fonts, radius, shadow } from "../theme";
import { useSidebar, SIDEBAR_CLIP_CLEARANCE } from "../navigation/SidebarContext";
import { NewPageForm } from "../components/NewPageForm";
import { PaginasStackParamList } from "./PaginasScreen";

// Lista de "Páginas personalizadas" — puerto de la parte de gestión de páginas que en la web vive
// repartida entre dashboard/src/pages/DashboardPage.tsx (fetch/crear/renombrar/borrar) y el menú
// lateral de AppShell.tsx (crear/reordenar/borrar). Aquí es su propia pantalla porque el móvil no
// tiene un menú lateral persistente — tocar una página navega al detalle (ver
// PaginaDetailScreen.tsx) dentro de la misma pestaña (pila anidada, ver PaginasScreen.tsx).
// Solo la plantilla "Galería" tiene editor propio en el móvil por ahora (ver
// mobile/README.md) — el resto se puede crear/ver/renombrar/borrar, pero su contenido solo se
// edita desde la web.

type Props = NativeStackScreenProps<PaginasStackParamList, "Lista">;

export function PaginasListScreen({ navigation }: Props) {
  const { collapsed } = useSidebar();
  const [pages, setPages] = useState<CustomPageSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  // Mismo patrón que el "✕" de "Tus páginas" en dashboard/src/components/AppShell.tsx
  // (`confirmingDeletePageId`) — el propio botón "Borrar" pide confirmar cambiando su texto en
  // vez de un diálogo aparte; sin hover/mouseleave en táctil para cancelarlo solo, así que se
  // cancela a los 3s si no se toca una segunda vez (ver el efecto de abajo).
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);

  useEffect(() => {
    if (confirmingDeleteId === null) return;
    const timer = setTimeout(() => setConfirmingDeleteId(null), 3000);
    return () => clearTimeout(timer);
  }, [confirmingDeleteId]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // "galeria" no aparece aquí: ya tiene su propio apartado "Galería" en el menú principal
      // (con una sola por cuenta, ver AppSidebar.openGallery) — listarla también en esta pantalla
      // duplicaría la entrada.
      setPages((await listCustomPages()).filter((p) => p.template !== "galeria"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar las páginas");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const handleCreate = async (title: string, template: CustomPageTemplate) => {
    const created = await createCustomPage(title, template);
    setShowCreate(false);
    await reload();
    navigation.navigate("Detalle", { id: created.id, title: created.title });
  };

  const handleDelete = async (id: number) => {
    if (confirmingDeleteId !== id) {
      setConfirmingDeleteId(id);
      return;
    }
    setConfirmingDeleteId(null);
    await deleteCustomPage(id);
    await reload();
  };

  const handleMove = async (id: number, direction: "up" | "down") => {
    await moveCustomPage(id, direction);
    await reload();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.header, collapsed && { paddingLeft: SIDEBAR_CLIP_CLEARANCE }]}>
        <Text style={styles.title}>Páginas</Text>
        <Pressable style={styles.newButton} onPress={() => setShowCreate(true)}>
          <Text style={styles.newButtonText}>+ Nueva</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {error && <Text style={styles.errorBanner}>{error}</Text>}
        {loading && pages.length === 0 ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
        ) : pages.length === 0 ? (
          <Text style={styles.emptyText}>Aún no tienes páginas personalizadas. Crea una para empezar.</Text>
        ) : (
          pages.map((page, index) => (
            <Pressable
              key={page.id}
              style={styles.pageRow}
              onPress={() => navigation.navigate("Detalle", { id: page.id, title: page.title })}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.pageTitle}>{page.title}</Text>
                <Text style={styles.pageMeta}>{page.subtitle || TEMPLATE_LABELS[page.template]}</Text>
              </View>
              <View style={styles.pageActions}>
                <Pressable onPress={() => handleMove(page.id, "up")} disabled={index === 0} hitSlop={8}>
                  <Text style={[styles.actionText, index === 0 && styles.actionDisabled]}>↑</Text>
                </Pressable>
                <Pressable onPress={() => handleMove(page.id, "down")} disabled={index === pages.length - 1} hitSlop={8}>
                  <Text style={[styles.actionText, index === pages.length - 1 && styles.actionDisabled]}>↓</Text>
                </Pressable>
                <Pressable onPress={() => handleDelete(page.id)} hitSlop={8}>
                  <Text style={[styles.actionText, styles.actionDelete, confirmingDeleteId === page.id && styles.actionDeleteConfirming]}>
                    {confirmingDeleteId === page.id ? "¿Confirmar?" : "Borrar"}
                  </Text>
                </Pressable>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>

      <Modal visible={showCreate} animationType="slide" transparent onRequestClose={() => setShowCreate(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <NewPageForm onCancel={() => setShowCreate(false)} onSubmit={handleCreate} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, paddingBottom: 8 },
  title: { fontFamily: fonts.serif, fontSize: 30, color: colors.foreground },
  newButton: { backgroundColor: colors.foreground, borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 8 },
  newButtonText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.background },
  content: { padding: 20, paddingTop: 8, gap: 10, paddingBottom: 40 },
  errorBanner: { fontFamily: fonts.sans, fontSize: 12, color: colors.destructive },
  emptyText: { fontFamily: fonts.sans, fontSize: 14, color: colors.mutedForeground, fontStyle: "italic" },

  pageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    ...shadow,
  },
  pageTitle: { fontFamily: fonts.sansSemiBold, fontSize: 16, color: colors.foreground },
  pageMeta: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground, marginTop: 2 },
  pageActions: { flexDirection: "row", alignItems: "center", gap: 12 },
  actionText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.mutedForeground },
  actionDisabled: { opacity: 0.3 },
  actionDelete: { color: colors.destructive },
  // font-bold text-destructive de la web al confirmar (AppShell.tsx) — un tono más marcado que el
  // "Borrar" suelto de antes de tocarlo.
  actionDeleteConfirming: { fontFamily: fonts.sansBold, fontWeight: "700" },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(45,41,38,0.4)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    padding: 20,
    maxHeight: "88%",
  },
});
