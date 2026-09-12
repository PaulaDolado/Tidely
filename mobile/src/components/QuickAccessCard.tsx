import { useEffect, useState } from "react";
import { View, Text, Pressable, TextInput, Modal, ScrollView, StyleSheet, Alert } from "react-native";
import Svg, { Path } from "react-native-svg";
import {
  QUICK_ACCESS_APPS,
  QuickAccessApp,
  CustomQuickAccessLink,
  loadSelectedIds,
  saveSelectedIds,
  loadCustomLinks,
  addCustomLink,
  removeCustomLink,
  customLinkToApp,
  openQuickAccessApp,
} from "../utils/quickAccessApps";
import { colors, fonts, radius, withAlpha } from "../theme";

// Puerto de dashboard/src/components/QuickAccessCard.tsx — mismo catálogo, misma idea (elegir qué
// apps mostrar + enlaces propios), pero con estado cargado de forma asíncrona (SecureStore, ver
// utils/quickAccessApps.ts) en vez del useState perezoso sobre localStorage que usa la web.
export function QuickAccessCard() {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [customLinks, setCustomLinks] = useState<CustomQuickAccessLink[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    Promise.all([loadSelectedIds(), loadCustomLinks()]).then(([ids, links]) => {
      setSelectedIds(ids);
      setCustomLinks(links);
      setLoaded(true);
    });
  }, []);

  const toggle = (id: string) => {
    const next = selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id];
    setSelectedIds(next);
    saveSelectedIds(next);
  };

  const handleAddCustomLink = async (input: { label: string; url: string; emoji: string }) => {
    const link = await addCustomLink(input);
    if (link) setCustomLinks((prev) => [...prev, link]);
    return link;
  };

  const handleRemoveCustomLink = async (id: string) => {
    await removeCustomLink(id);
    setCustomLinks((prev) => prev.filter((link) => link.id !== id));
  };

  // Antes de que termine de cargar SecureStore no pintamos nada — evita un parpadeo mostrando
  // "sin apps seleccionadas" un instante antes de que aparezcan las de verdad.
  if (!loaded) return null;

  const selectedApps = [...QUICK_ACCESS_APPS.filter((app) => selectedIds.includes(app.id)), ...customLinks.map(customLinkToApp)];

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>🔗 Acceso rápido</Text>
        <Pressable onPress={() => setEditing(true)} hitSlop={8}>
          <Text style={styles.editLink}>Editar</Text>
        </Pressable>
      </View>

      {selectedApps.length === 0 ? (
        <Text style={styles.emptyText}>Sin apps seleccionadas todavía.</Text>
      ) : (
        <View style={styles.grid}>
          {selectedApps.map((app) => (
            <Pressable key={app.id} style={styles.gridItem} onPress={() => openQuickAccessApp(app)}>
              <AppLogo app={app} size={44} />
              <Text numberOfLines={1} style={styles.gridLabel}>
                {app.label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <Modal visible={editing} animationType="slide" transparent onRequestClose={() => setEditing(false)}>
        <QuickAccessEditModal
          selectedIds={selectedIds}
          onToggle={toggle}
          customLinks={customLinks}
          onAddCustomLink={handleAddCustomLink}
          onRemoveCustomLink={handleRemoveCustomLink}
          onClose={() => setEditing(false)}
        />
      </Modal>
    </View>
  );
}

// Logo oficial de la marca sobre una casilla de su color, en blanco — mismo tratamiento que en la
// web (ver AppLogo ahí). Los enlaces personalizados no traen `icon` (path de logo), traen `emoji`.
function AppLogo({ app, size }: { app: QuickAccessApp; size: 32 | 44 }) {
  const boxStyle = size === 44 ? styles.logoBoxLarge : styles.logoBoxSmall;
  return (
    <View style={[styles.logoBox, boxStyle, { backgroundColor: app.color }]}>
      {app.icon ? (
        <Svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24">
          <Path d={app.icon} fill="#fff" />
        </Svg>
      ) : (
        <Text style={{ fontSize: size === 44 ? 18 : 14, lineHeight: size === 44 ? 20 : 16 }}>{app.emoji}</Text>
      )}
    </View>
  );
}

function QuickAccessEditModal({
  selectedIds,
  onToggle,
  customLinks,
  onAddCustomLink,
  onRemoveCustomLink,
  onClose,
}: {
  selectedIds: string[];
  onToggle: (id: string) => void;
  customLinks: CustomQuickAccessLink[];
  onAddCustomLink: (input: { label: string; url: string; emoji: string }) => Promise<CustomQuickAccessLink | null>;
  onRemoveCustomLink: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Pressable style={styles.modalBackdrop} onPress={onClose}>
      <Pressable style={styles.modalPanel} onPress={(e) => e.stopPropagation()}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Acceso rápido</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Text style={styles.modalClose}>✕ Cerrar</Text>
          </Pressable>
        </View>
        <Text style={styles.modalSubtitle}>Elige qué apps quieres ver como accesos directos en "Hoy".</Text>

        <ScrollView style={styles.modalScroll}>
          {QUICK_ACCESS_APPS.map((app) => {
            const checked = selectedIds.includes(app.id);
            return (
              <Pressable key={app.id} style={styles.checkRow} onPress={() => onToggle(app.id)}>
                <View style={[styles.checkbox, checked && styles.checkboxChecked]}>{checked && <Text style={styles.checkboxMark}>✓</Text>}</View>
                <AppLogo app={app} size={32} />
                <Text numberOfLines={1} style={styles.checkRowLabel}>
                  {app.label}
                </Text>
              </Pressable>
            );
          })}

          <View style={styles.divider} />
          <Text style={styles.sectionLabel}>Tus enlaces</Text>

          {customLinks.map((link) => (
            <View key={link.id} style={styles.checkRow}>
              <AppLogo app={customLinkToApp(link)} size={32} />
              <Text numberOfLines={1} style={styles.checkRowLabel}>
                {link.label}
              </Text>
              <Pressable
                onPress={() =>
                  Alert.alert("Eliminar enlace", `¿Quitar "${link.label}" de tus accesos rápidos?`, [
                    { text: "Cancelar", style: "cancel" },
                    { text: "Eliminar", style: "destructive", onPress: () => onRemoveCustomLink(link.id) },
                  ])
                }
                hitSlop={8}
              >
                <Text style={styles.removeLink}>✕</Text>
              </Pressable>
            </View>
          ))}

          <AddCustomLinkForm onAdd={onAddCustomLink} />
        </ScrollView>
      </Pressable>
    </Pressable>
  );
}

// Nombre, URL (se normaliza en normalizeQuickAccessUrl) y un emoji como icono — si se deja vacío,
// la inicial del nombre hace de icono por defecto (ver addCustomLink).
function AddCustomLinkForm({ onAdd }: { onAdd: (input: { label: string; url: string; emoji: string }) => Promise<CustomQuickAccessLink | null> }) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [emoji, setEmoji] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    const link = await onAdd({ label, url, emoji });
    setSubmitting(false);
    if (!link) {
      setError("Pon un nombre y una URL válida (p. ej. notion.so/mi-pagina).");
      return;
    }
    setLabel("");
    setUrl("");
    setEmoji("");
    setError("");
  };

  return (
    <View style={styles.addForm}>
      <View style={styles.addFormRow}>
        <TextInput
          value={emoji}
          onChangeText={setEmoji}
          placeholder="🔗"
          maxLength={4}
          placeholderTextColor={colors.mutedForeground}
          style={styles.addFormEmoji}
        />
        <TextInput
          value={label}
          onChangeText={setLabel}
          placeholder="Nombre"
          placeholderTextColor={colors.mutedForeground}
          style={styles.addFormInput}
        />
      </View>
      <TextInput
        value={url}
        onChangeText={setUrl}
        placeholder="URL (p. ej. notion.so/mi-pagina)"
        placeholderTextColor={colors.mutedForeground}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.addFormInput, { width: "100%" }]}
      />
      {error !== "" && <Text style={styles.addFormError}>{error}</Text>}
      <Pressable style={styles.addFormSubmit} onPress={submit} disabled={submitting}>
        <Text style={styles.addFormSubmitText}>{submitting ? "Añadiendo…" : "+ Añadir enlace"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // rounded-3xl border-primary/30 bg-primary/10 p-6 de la web.
  card: {
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderColor: withAlpha(colors.primary, 0.3),
    backgroundColor: withAlpha(colors.primary, 0.1),
    padding: 24,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  title: {
    fontFamily: fonts.sansBold,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: colors.primary,
  },
  editLink: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.mutedForeground,
  },
  emptyText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.mutedForeground,
    fontStyle: "italic",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  gridItem: {
    width: 64,
    alignItems: "center",
    gap: 6,
  },
  gridLabel: {
    fontFamily: fonts.sans,
    fontSize: 10,
    color: colors.mutedForeground,
    textAlign: "center",
  },
  logoBox: {
    alignItems: "center",
    justifyContent: "center",
  },
  logoBoxLarge: {
    width: 44,
    height: 44,
    borderRadius: 16,
  },
  logoBoxSmall: {
    width: 32,
    height: 32,
    borderRadius: 10,
  },

  // ========== MODAL DE EDICIÓN ==========
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(45, 41, 38, 0.5)",
    justifyContent: "flex-end",
  },
  modalPanel: {
    maxHeight: "80%",
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    padding: 24,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  modalTitle: {
    fontFamily: fonts.serif,
    fontSize: 20,
    color: colors.foreground,
  },
  modalClose: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.mutedForeground,
  },
  modalSubtitle: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.mutedForeground,
    marginBottom: 16,
  },
  modalScroll: {
    maxHeight: "100%",
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  checkRowLabel: {
    flex: 1,
    minWidth: 0,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.foreground,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkboxMark: {
    color: colors.primaryForeground,
    fontSize: 12,
    fontFamily: fonts.sansBold,
  },
  removeLink: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.mutedForeground,
    padding: 4,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 16,
  },
  sectionLabel: {
    fontFamily: fonts.sansBold,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: colors.mutedForeground,
    marginBottom: 8,
  },
  addForm: {
    marginTop: 12,
    gap: 8,
    borderRadius: radius.input,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: withAlpha(colors.primary, 0.3),
    backgroundColor: withAlpha(colors.primary, 0.05),
    padding: 12,
  },
  addFormRow: {
    flexDirection: "row",
    gap: 8,
  },
  addFormEmoji: {
    width: 48,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    textAlign: "center",
    paddingVertical: 8,
    fontSize: 16,
  },
  addFormInput: {
    flex: 1,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.foreground,
  },
  addFormError: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.destructive,
  },
  addFormSubmit: {
    backgroundColor: colors.primary,
    borderRadius: radius.input,
    paddingVertical: 10,
    alignItems: "center",
  },
  addFormSubmitText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 13,
    color: colors.primaryForeground,
  },
});
