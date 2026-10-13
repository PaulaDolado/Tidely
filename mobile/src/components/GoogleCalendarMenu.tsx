import { useCallback, useEffect, useRef, useState } from "react";
import { View, Pressable, StyleSheet, Modal, Alert, Linking, AppState, ScrollView, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "./AppText";
import { useTheme } from "../context/ThemeContext";
import { fonts, radius, withAlpha } from "../theme";
import { ApiError } from "../api/client";
import {
  GoogleCalendarStatus,
  disconnectGoogle,
  getGoogleConnectUrl,
  getGoogleStatus,
  parseGoogleDeepLink,
  syncGoogleNow,
} from "../api/googleCalendar";

type Busy = "connect" | "sync" | "disconnect" | null;
type Notice = { kind: "ok" | "error"; text: string } | null;

// ApiError con status 0 = `fetch` ni siquiera llegó al servidor (ver api/client.ts): es "sin
// conexión", no un fallo de la API, y merece un mensaje que diga qué hacer en vez del técnico.
function friendlyError(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.status === 0) {
    return "Sin conexión. Conéctate a internet e inténtalo de nuevo.";
  }
  return err instanceof Error ? err.message : fallback;
}

/**
 * Botón "📅 Google" de la cabecera de Agenda + hoja inferior para conectar, sincronizar y
 * desconectar Google Calendar. Versión móvil de GoogleCalendarMenu del dashboard
 * (dashboard/src/pages/AgendaPage.tsx), con una diferencia de fondo: en la web "conectar" es
 * navegar la propia pestaña a Google y volver con `?google=connected` en la URL; aquí se abre el
 * navegador del sistema (Linking.openURL) y el backend, al terminar, redirige al deep link
 * `tidely://google?status=connected|error` (ver parseGoogleDeepLink), que reabre la app y llega
 * como evento "url" de Linking. Como el deep link puede no entregarse (el usuario cierra el
 * navegador a mano, o el sistema lo bloquea), el estado también se relee cada vez que la app
 * vuelve a primer plano — así la verdad siempre es lo que dice el servidor, no el enlace.
 *
 * `onSynced` se llama tras sincronizar o desconectar (cambian los eventos importados en el
 * servidor): AgendaScreen lo usa para traerlos a la base local con su `sync`.
 */
export function GoogleCalendarMenu({ onSynced }: { onSynced?: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<GoogleCalendarStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [summary, setSummary] = useState<string | null>(null);
  // Evita setState tras desmontar (la petición de estado puede tardar y AgendaScreen cambiar de pantalla).
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const next = await getGoogleStatus();
      if (mounted.current) setStatus(next);
    } catch (err) {
      // Sin conexión no se pierde lo último que sabíamos del estado; solo se avisa si la hoja
      // está abierta (el botón de la cabecera no debe llenar la pantalla de errores por sí solo).
      if (mounted.current) setNotice((prev) => prev ?? { kind: "error", text: friendlyError(err, "No se pudo consultar el estado de Google Calendar") });
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  // Vuelta del navegador mediante el deep link tidely://google?status=...
  useEffect(() => {
    const sub = Linking.addEventListener("url", ({ url }) => {
      const result = parseGoogleDeepLink(url);
      if (!result) return;
      setBusy(null);
      setOpen(true);
      if (result === "connected") {
        setNotice({ kind: "ok", text: "Conectado a Google Calendar" });
        refreshStatus();
      } else {
        setNotice({ kind: "error", text: "No se pudo conectar con Google Calendar. Inténtalo de nuevo." });
      }
    });
    return () => sub.remove();
  }, [refreshStatus]);

  // Al volver a primer plano (p. ej. tras el consentimiento en el navegador, con o sin deep link).
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshStatus();
    });
    return () => sub.remove();
  }, [refreshStatus]);

  const openMenu = () => {
    setNotice(null);
    setOpen(true);
    refreshStatus();
  };

  const connect = async () => {
    setBusy("connect");
    setNotice(null);
    try {
      const url = await getGoogleConnectUrl();
      await Linking.openURL(url);
    } catch (err) {
      setNotice({ kind: "error", text: friendlyError(err, "No se pudo iniciar la conexión con Google") });
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const sync = async () => {
    setBusy("sync");
    setNotice(null);
    try {
      const result = await syncGoogleNow();
      if (!mounted.current) return;
      setSummary(`${result.imported} nuevo(s) · ${result.updated} actualizado(s) · ${result.removed} eliminado(s)`);
      refreshStatus();
      onSynced?.();
    } catch (err) {
      if (mounted.current) setNotice({ kind: "error", text: friendlyError(err, "No se pudo sincronizar") });
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const doDisconnect = async () => {
    setBusy("disconnect");
    setNotice(null);
    try {
      await disconnectGoogle();
      if (!mounted.current) return;
      setSummary(null);
      setOpen(false);
      refreshStatus();
      onSynced?.();
    } catch (err) {
      if (mounted.current) setNotice({ kind: "error", text: friendlyError(err, "No se pudo desconectar") });
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const confirmDisconnect = () => {
    Alert.alert(
      "Desconectar Google Calendar",
      "Se borrarán de Tidely los eventos que se importaron desde Google. Tu calendario de Google no se toca.",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Desconectar", style: "destructive", onPress: doDisconnect },
      ]
    );
  };

  const connected = status?.connected ?? false;
  const disabled = busy !== null;

  return (
    <>
      <Pressable
        style={[
          styles.trigger,
          { borderColor: connected ? withAlpha(colors.primary, 0.3) : colors.border },
          connected && { backgroundColor: withAlpha(colors.primary, 0.1) },
        ]}
        onPress={openMenu}
        accessibilityLabel={connected ? `Google Calendar conectado como ${status?.email}` : "Conectar Google Calendar"}
      >
        <Text style={[styles.triggerText, { color: connected ? colors.primary : colors.mutedForeground }]}>📅 Google</Text>
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: insets.bottom + 20 }]}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={[styles.title, { color: colors.foreground }]}>Google Calendar</Text>

              {notice && (
                <Text style={[styles.notice, { color: notice.kind === "ok" ? colors.primary : colors.destructive }]}>{notice.text}</Text>
              )}

              {connected ? (
                <>
                  <Text style={[styles.strong, { color: colors.foreground }]}>Conectado como {status?.email}</Text>
                  <Text style={[styles.muted, { color: colors.mutedForeground }]}>
                    {status?.lastSyncedAt
                      ? `Última sincronización: ${new Date(status.lastSyncedAt).toLocaleString("es-ES")}`
                      : "Todavía no se ha sincronizado"}
                  </Text>
                  {summary && <Text style={[styles.muted, { color: colors.mutedForeground }]}>{summary}</Text>}

                  <Pressable
                    style={[styles.primaryButton, { backgroundColor: colors.primary }, disabled && styles.disabled]}
                    onPress={sync}
                    disabled={disabled}
                  >
                    {busy === "sync" ? (
                      <ActivityIndicator color={colors.primaryForeground} />
                    ) : (
                      <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>Sincronizar ahora</Text>
                    )}
                  </Pressable>
                  <Pressable
                    style={[styles.secondaryButton, { borderColor: colors.border }, disabled && styles.disabled]}
                    onPress={confirmDisconnect}
                    disabled={disabled}
                  >
                    <Text style={[styles.secondaryButtonText, { color: colors.destructive }]}>
                      {busy === "disconnect" ? "Desconectando…" : "Desconectar"}
                    </Text>
                  </Pressable>
                  <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                    Se sincroniza sola cada 30 min. Solo importa: editar aquí un evento de Google no cambia nada en tu cuenta, y la
                    próxima sincronización lo sobrescribe con la versión de Google.
                  </Text>
                </>
              ) : (
                <>
                  <Text style={[styles.muted, { color: colors.mutedForeground }]}>
                    Importa tus eventos de Google Calendar a la agenda de Tidely. Se abrirá el navegador para dar el permiso y al
                    terminar volverás aquí.
                  </Text>
                  <Pressable
                    style={[styles.primaryButton, { backgroundColor: colors.primary }, disabled && styles.disabled]}
                    onPress={connect}
                    disabled={disabled}
                  >
                    {busy === "connect" ? (
                      <ActivityIndicator color={colors.primaryForeground} />
                    ) : (
                      <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>Conectar con Google Calendar</Text>
                    )}
                  </Pressable>
                </>
              )}

              <Pressable style={styles.closeButton} onPress={() => setOpen(false)}>
                <Text style={[styles.closeButtonText, { color: colors.mutedForeground }]}>Cerrar</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: { height: 32, paddingHorizontal: 12, borderRadius: radius.full, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  triggerText: { fontFamily: fonts.sansMedium, fontSize: 12 },
  backdrop: { flex: 1, backgroundColor: "rgba(45,41,38,0.4)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card, padding: 20, maxHeight: "88%" },
  title: { fontFamily: fonts.serif, fontSize: 24, marginBottom: 16 },
  notice: { fontFamily: fonts.sans, fontSize: 13, marginBottom: 12 },
  strong: { fontFamily: fonts.sansMedium, fontSize: 14, marginBottom: 4 },
  muted: { fontFamily: fonts.sans, fontSize: 13, marginBottom: 12 },
  hint: { fontFamily: fonts.sans, fontSize: 11, marginTop: 14 },
  primaryButton: { borderRadius: radius.full, padding: 15, alignItems: "center", marginTop: 8 },
  primaryButtonText: { fontFamily: fonts.sansMedium, fontSize: 15 },
  secondaryButton: { borderWidth: 1, borderRadius: radius.full, padding: 13, alignItems: "center", marginTop: 10 },
  secondaryButtonText: { fontFamily: fonts.sansMedium, fontSize: 14 },
  disabled: { opacity: 0.5 },
  closeButton: { alignItems: "center", padding: 10, marginTop: 6 },
  closeButtonText: { fontFamily: fonts.sans, fontSize: 14 },
});
