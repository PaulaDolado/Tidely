import { useCallback, useState } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { Text } from "./AppText";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useAuth } from "../auth/AuthContext";
import { listRecentEntries, RecentProjectEntry } from "../api/projects";
import { ENABLED_SECTIONS } from "../types";
import { colors, fonts, radius } from "../theme";

// Puerto de dashboard/src/components/RecentEntriesCard.tsx — últimas páginas de libreta tocadas
// (ver GET /projects/recent-entries), en las vistas "Hoy" y "Agenda". Va directa a la API (no pasa
// por SQLite), así que necesita conexión: sin ella se avisa en la propia tarjeta en vez de
// desaparecer, y si ya había entradas cargadas se conservan en pantalla.
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
  const { user } = useAuth();
  const [entries, setEntries] = useState<RecentProjectEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const navigation = useNavigation();

  // useFocusEffect (no un useEffect de montaje único): Hoy y Agenda son pestañas que se quedan
  // montadas de fondo, así que con un solo fetch al montar la tarjeta se quedaba con las entradas
  // de la primera vez hasta reiniciar la app, aunque el usuario hubiera editado una libreta entre
  // medias. Mismo patrón que GoalsProgressCard.
  useFocusEffect(
    useCallback(() => {
      listRecentEntries()
        .then((next) => {
          setEntries(next);
          setFailed(false);
        })
        .catch(() => setFailed(true)) // se conservan las entradas ya cargadas, si las había
        .finally(() => setLoaded(true));
    }, [])
  );

  // Si el usuario ha desactivado el apartado Libreta ("proyectos", ver Ajustes) la tarjeta no
  // tiene sentido — igual criterio que en la web.
  if (!(user?.enabledSections ?? ENABLED_SECTIONS).includes("proyectos")) return null;
  if (!loaded) return null;

  if (entries.length === 0) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>📓 Entradas recientes en tus libretas</Text>
        <Text style={styles.emptyText}>
          {failed ? "Sin conexión: no se pueden cargar tus libretas ahora mismo." : "Todavía no has escrito en ninguna libreta."}
        </Text>
      </View>
    );
  }

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
      {failed && <Text style={styles.staleNotice}>Sin conexión: puede que no estén al día.</Text>}
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
  emptyText: { fontFamily: fonts.sans, fontSize: 13, color: colors.mutedForeground, fontStyle: "italic" },
  staleNotice: { fontFamily: fonts.sans, fontSize: 11, color: colors.warning, marginTop: -8, marginBottom: 10 },
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
