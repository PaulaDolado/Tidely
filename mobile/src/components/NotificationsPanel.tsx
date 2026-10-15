import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, AppState, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "./AppText";
import { useTheme } from "../context/ThemeContext";
import { ApiError } from "../api/client";
import {
  AppNotification,
  deleteNotification,
  getUnreadCount,
  listUnreadNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../api/notifications";
import { ColorPalette, fonts, radius } from "../theme";

// Cada cuánto se vuelve a preguntar cuántas hay sin leer — modesto a propósito: no hay push del
// sistema (ver api/notifications.ts), así que esto es lo único que las trae mientras la app está
// abierta; al volver a primer plano se refresca además al instante (ver el AppState de abajo).
const POLL_INTERVAL_MS = 60_000;

/**
 * Contador de notificaciones sin leer, vivo mientras la app esté abierta — lo usa AppSidebar tanto
 * para el badge de la campana como para el punto sobre el clip con el menú colapsado. `offline`
 * distingue "no hay ninguna" de "no he podido preguntar" (sin red / sesión caducada), para no
 * mostrar un 0 engañoso.
 */
export function useUnreadNotifications() {
  const [count, setCount] = useState(0);
  const [offline, setOffline] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setCount(await getUnreadCount());
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    // El intervalo se queda dormido con la app en segundo plano — al volver a "active" se
    // refresca sin esperar al siguiente tick.
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [refresh]);

  return { count, offline, refresh, setCount };
}

const TYPE_ICON: Record<AppNotification["type"], string> = {
  event_reminder: "📅",
  goal_at_risk: "🎯",
  task_due: "✅",
  event_invitation: "✉️",
  budget_exceeded: "💸",
};

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(minutes) || minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return `hace ${days} d`;
}

/**
 * Campana + panel de notificaciones — puerto de NotificationsWidget en dashboard/src/components/
 * AppShell.tsx. En vez de un desplegable flotante, el panel es una hoja inferior (mismo patrón que
 * los demás diálogos del menú). Solo muestra las últimas sin leer; además de "Marcar todas como
 * leídas" permite marcar o borrar una a una (endpoints que la web aún no usa desde este widget).
 */
export function NotificationsBell({
  unread,
  offline,
  refreshCount,
  onUnreadChange,
}: {
  unread: number;
  offline: boolean;
  refreshCount: () => Promise<void>;
  onUnreadChange: (count: number) => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listUnreadNotifications());
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 0
          ? "Sin conexión. Las notificaciones necesitan internet."
          : err instanceof ApiError
            ? err.message
            : "No se pudieron cargar las notificaciones."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // Tras cualquier cambio: recarga la lista (para rellenar hasta 5 si había más) y el contador.
  const afterChange = async () => {
    await Promise.all([load(), refreshCount()]);
  };

  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      await afterChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo completar la acción. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  const markAll = () =>
    run(async () => {
      await markAllNotificationsRead();
      onUnreadChange(0);
    });

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={unread > 0 ? `Notificaciones, ${unread} sin leer` : "Notificaciones"}
        style={styles.bell}
      >
        <Text style={[styles.bellIcon, offline && styles.bellIconOffline]}>🔔</Text>
        {unread > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unread > 99 ? "99+" : unread}</Text>
          </View>
        )}
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.header}>
              <Text style={styles.title}>Notificaciones</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                <Text style={styles.close}>Cerrar</Text>
              </Pressable>
            </View>

            {loading && items.length === 0 ? (
              <ActivityIndicator color={colors.primary} style={styles.loading} />
            ) : error && items.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>{error}</Text>
                <Pressable onPress={load} style={styles.retry}>
                  <Text style={styles.retryText}>Reintentar</Text>
                </Pressable>
              </View>
            ) : items.length === 0 ? (
              <Text style={styles.emptyText}>Sin notificaciones nuevas.</Text>
            ) : (
              <>
                <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
                  {items.map((n) => (
                    <View key={n.id} style={styles.item}>
                      <Text style={styles.itemIcon}>{TYPE_ICON[n.type] ?? "🔔"}</Text>
                      <View style={styles.itemBody}>
                        <Text style={styles.itemTitle}>{n.title}</Text>
                        <Text style={styles.itemMessage}>{n.message}</Text>
                        <Text style={styles.itemTime}>{timeAgo(n.createdAt)}</Text>
                      </View>
                      <View style={styles.itemActions}>
                        <Pressable
                          onPress={() => run(() => markNotificationRead(n.id))}
                          hitSlop={8}
                          accessibilityLabel="Marcar como leída"
                          style={styles.itemAction}
                        >
                          <Text style={styles.itemActionText}>✓</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => run(() => deleteNotification(n.id))}
                          hitSlop={8}
                          accessibilityLabel="Eliminar notificación"
                          style={styles.itemAction}
                        >
                          <Text style={styles.itemActionText}>✕</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </ScrollView>
                {error && <Text style={styles.errorText}>{error}</Text>}
                <Pressable onPress={markAll} disabled={busy} style={styles.markAll}>
                  <Text style={styles.markAllText}>Marcar todas como leídas</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    bell: { paddingHorizontal: 6, paddingVertical: 4 },
    bellIcon: { fontSize: 18 },
    // Apagada cuando no se pudo preguntar al servidor (sin red) — el número del badge sería viejo.
    bellIconOffline: { opacity: 0.45 },
    badge: {
      position: "absolute",
      top: -2,
      right: -2,
      minWidth: 18,
      height: 18,
      paddingHorizontal: 4,
      borderRadius: 9,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    badgeText: { fontFamily: fonts.sansBold, fontSize: 10, color: colors.primaryForeground },
    backdrop: { flex: 1, backgroundColor: "rgba(45,41,38,0.4)", justifyContent: "flex-end" },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: radius.card,
      borderTopRightRadius: radius.card,
      padding: 20,
      maxHeight: "80%",
    },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
    title: { fontFamily: fonts.serif, fontSize: 20, color: colors.foreground },
    close: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.mutedForeground },
    loading: { marginVertical: 24 },
    empty: { alignItems: "center", gap: 10 },
    emptyText: { fontFamily: fonts.sans, fontSize: 13, color: colors.mutedForeground, textAlign: "center", paddingVertical: 16 },
    retry: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.full, backgroundColor: colors.muted },
    retryText: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.foreground },
    list: { flexGrow: 0 },
    listContent: { gap: 8 },
    item: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderRadius: radius.input, backgroundColor: colors.muted, padding: 12 },
    itemIcon: { fontSize: 16 },
    itemBody: { flex: 1, minWidth: 0 },
    itemTitle: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.foreground },
    itemMessage: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground, marginTop: 2 },
    itemTime: { fontFamily: fonts.sans, fontSize: 10, color: colors.mutedForeground, marginTop: 4, opacity: 0.8 },
    itemActions: { flexDirection: "row", gap: 6 },
    itemAction: { paddingHorizontal: 4, paddingVertical: 2 },
    itemActionText: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.mutedForeground },
    errorText: { fontFamily: fonts.sans, fontSize: 12, color: colors.destructive, marginTop: 8, textAlign: "center" },
    markAll: { marginTop: 12, paddingVertical: 10, alignItems: "center" },
    markAllText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.primary },
  });
}
