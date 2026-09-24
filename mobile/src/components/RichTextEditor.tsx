import { useEffect, useRef, useState } from "react";
import { View, StyleSheet, Modal, Pressable, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { Text, TextInput } from "./AppText";
import WebView, { WebViewMessageEvent } from "react-native-webview";
import * as ImagePicker from "expo-image-picker";
import { RICH_EDITOR_HTML } from "./richEditorHtml";
import { colors, fonts, radius } from "../theme";

// Puerto táctil de dashboard/src/components/RichTextEditor.tsx — ver richEditorHtml.ts para el
// porqué de la arquitectura (WebView con contentEditable/execCommand dentro, ya que RN no tiene
// nada parecido) y el protocolo de mensajes entre esta capa RN y esa página. Este componente es
// solo el "cristal": estado de sincronización del HTML externo/interno, el selector de imagen
// (expo-image-picker, que sí es nativo) y un diálogo propio para lo que necesita teclado (URL de
// enlace, LaTeX de una ecuación) en vez de window.prompt(), que react-native-webview no soporta
// de forma fiable.
const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // mismo límite que MAX_IMAGE_BYTES en PaginaDetailScreen.tsx

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

export function RichTextEditor({ value, onChange, placeholder }: RichTextEditorProps) {
  const webViewRef = useRef<WebView>(null);
  // Último HTML que ESTE editor emitió o recibió — evita reinyectar el mismo contenido cuando
  // `value` cambia solo porque el padre acaba de guardar lo que el propio WebView emitió
  // (mismo criterio que el useEffect del RichTextEditor de escritorio: "solo se reescribe si el
  // contenido realmente cambió por fuera").
  const lastSyncedRef = useRef("");
  const readyRef = useRef(false);
  const [prompt, setPrompt] = useState<{ kind: "link" | "equation" } | null>(null);
  const [promptValue, setPromptValue] = useState("");

  const inject = (js: string) => webViewRef.current?.injectJavaScript(`${js}; true;`);

  useEffect(() => {
    if (!readyRef.current || value === lastSyncedRef.current) return;
    lastSyncedRef.current = value;
    inject(`window.setEditorHtml(${JSON.stringify(value)})`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleMessage = async (event: WebViewMessageEvent) => {
    let msg: { type: string; html?: string; current?: string; message?: string };
    try {
      msg = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }

    if (msg.type === "ready") {
      readyRef.current = true;
      lastSyncedRef.current = value;
      inject(`window.setEditorHtml(${JSON.stringify(value)})`);
      if (placeholder) inject(`window.setEditorPlaceholder(${JSON.stringify(placeholder)})`);
      return;
    }
    if (msg.type === "change" && msg.html !== undefined) {
      lastSyncedRef.current = msg.html;
      onChange(msg.html);
      return;
    }
    if (msg.type === "request-link") {
      setPromptValue("https://");
      setPrompt({ kind: "link" });
      return;
    }
    if (msg.type === "request-equation") {
      setPromptValue(msg.current ?? "");
      setPrompt({ kind: "equation" });
      return;
    }
    if (msg.type === "request-image") {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Permiso necesario", "Activa el acceso a tus fotos para añadir una imagen.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], base64: true, quality: 0.7 });
      if (result.canceled || !result.assets[0]?.base64) return;
      const base64 = result.assets[0].base64;
      if (base64.length * 0.75 > MAX_IMAGE_BYTES) {
        Alert.alert("Imagen demasiado grande", "El límite es de 3 MB por imagen.");
        return;
      }
      inject(`window.applyImage(${JSON.stringify(`data:image/jpeg;base64,${base64}`)})`);
      return;
    }
    if (msg.type === "alert") {
      Alert.alert("Aviso", msg.message ?? "");
    }
  };

  const submitPrompt = () => {
    if (!prompt) return;
    const fn = prompt.kind === "link" ? "applyLink" : "applyEquation";
    inject(`window.${fn}(${JSON.stringify(promptValue.trim())})`);
    setPrompt(null);
  };

  return (
    <View style={styles.wrap}>
      <WebView
        ref={webViewRef}
        originWhitelist={["*"]}
        source={{ html: RICH_EDITOR_HTML }}
        onMessage={handleMessage}
        style={styles.webview}
        hideKeyboardAccessoryView
      />

      <Modal visible={prompt !== null} transparent animationType="fade" onRequestClose={() => setPrompt(null)}>
        <KeyboardAvoidingView style={styles.promptBackdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.promptCard}>
            <Text style={styles.promptTitle}>{prompt?.kind === "link" ? "URL del enlace" : "Fórmula en LaTeX"}</Text>
            <TextInput
              autoFocus
              style={styles.promptInput}
              value={promptValue}
              onChangeText={setPromptValue}
              placeholder={prompt?.kind === "link" ? "https://" : "E = mc^2"}
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={submitPrompt}
            />
            <View style={styles.promptActions}>
              <Pressable onPress={() => setPrompt(null)} hitSlop={8}>
                <Text style={styles.promptCancel}>Cancelar</Text>
              </Pressable>
              <Pressable style={styles.promptSubmit} onPress={submitPrompt}>
                <Text style={styles.promptSubmitText}>Aplicar</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 440, borderRadius: radius.card, overflow: "hidden", borderWidth: 1, borderColor: colors.border },
  webview: { flex: 1, backgroundColor: "transparent" },
  promptBackdrop: { flex: 1, backgroundColor: "rgba(45,41,38,0.4)", alignItems: "center", justifyContent: "center", padding: 24 },
  promptCard: { width: "100%", maxWidth: 400, backgroundColor: colors.card, borderRadius: radius.card, padding: 20, gap: 12 },
  promptTitle: { fontFamily: fonts.sansBold, fontSize: 14, color: colors.foreground },
  promptInput: {
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.input,
    padding: 12,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.foreground,
    backgroundColor: colors.background,
  },
  promptActions: { flexDirection: "row", justifyContent: "flex-end", gap: 16, marginTop: 4 },
  promptCancel: { fontFamily: fonts.sans, fontSize: 13, color: colors.mutedForeground },
  promptSubmit: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: 16, paddingVertical: 8 },
  promptSubmitText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.primaryForeground },
});
