import { useEffect, useState } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { Text } from "./AppText";
import { useNavigation } from "@react-navigation/native";
import { listRecentEntries, RecentProjectEntry } from "../api/projects";
import { colors, fonts, radius } from "../theme";

// Puerto de dashboard/src/components/RecentEntriesCard.tsx — últimas páginas de libreta tocadas
// (ver GET /projects/recent-entries), en la vista "Hoy". Sin estado vacío explícito: si no hay
// entradas, no renderiza nada, igual que la web (no hace falta un hueco de "nada por aquí" para
// una tarjeta que ni siquiera es el foco principal de la pantalla).
function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "ahora mismo";
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `hace ${diffHours}h`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays === 1) return "ayer";
  return new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

export function RecentEntriesCard() {
  const [entries, setEntries] = useState<RecentProjectEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const navigation = useNavigation();

  useEffect(() => {
    listRecentEntries()
      .then(setEntries)
      .catch(() => setEntries([])) // sin conexión / error: se calla, no es la sección principal de "Hoy"
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded || entries.length === 0) return null;

  const openEntry = (entry: RecentProjectEntry) => {
    // Navegación entre pestañas: "Proyectos" monta su propia pila anidada (ver
    // ProyectosScreen.tsx). `useNavigation()` sin genérico no conoce esa forma anidada (ni el
    // resto del árbol de rutas de App.tsx, que no conviene importar aquí solo para esta llamada),
    // así que se pasa por `any` para esta única llamada en vez de tipar todo el navigator.
    (navigation.navigate as (name: string, params: unknown) => void)("Proyectos", {
      screen: "Detalle",
      params: { id: entry.projectId, title: entry.projectTitle },
    });
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>📓 Entradas recientes en tus libretas</Text>
      <View style={styles.list}>
        {entries.map((entry) => (
          <Pressable key={entry.id} style={styles.row} onPress={() => openEntry(entry)}>
            <View style={styles.rowHeader}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {entry.pageTitle} <Text style={styles.rowProject}>· {entry.projectTitle}</Text>
              </Text>
              <Text style={styles.rowTime}>{formatRelative(entry.updatedAt)}</Text>
            </View>
            {entry.preview !== "" && (
              <Text style={styles.rowPreview} numberOfLines={1}>
                {entry.preview}
              </Text>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // rounded-3xl border-border bg-card p-6 de la web (tarjeta neutra, sin tinte de color). Sin
  // sombra a propósito — ver el comentario en el estilo `section` de HoyScreen.tsx.
  card: {
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 24,
  },
  title: {
    fontFamily: fonts.sansBold,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: colors.mutedForeground,
    marginBottom: 16,
  },
  list: { gap: 8 },
  row: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.input,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 2,
  },
  rowHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  rowTitle: { flex: 1, minWidth: 0, fontFamily: fonts.sansMedium, fontSize: 14, color: colors.foreground },
  rowProject: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground },
  rowTime: { fontFamily: fonts.sans, fontSize: 11, color: colors.mutedForeground, flexShrink: 0 },
  rowPreview: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground },
});
