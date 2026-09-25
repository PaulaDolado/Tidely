import { ReactNode, useEffect, useRef, useState } from "react";
import { View, Pressable, Modal, ScrollView, StyleSheet, ActivityIndicator, KeyboardAvoidingView } from "react-native";
import { Text, TextInput } from "./AppText";
import { useTheme } from "../context/ThemeContext";
import { search, SearchResults } from "../api/search";
import { ColorPalette, fonts, radius } from "../theme";

const SEARCH_DEBOUNCE_MS = 300;

// Qué hacer al elegir un resultado — cada tipo lleva lo mínimo que su pantalla destino necesita
// (ver handleSearchPick en AppSidebar.tsx). Puerto de SearchFocus en dashboard/src/components/
// AppShell.tsx, pero más reducido: en el móvil solo Proyectos habla directo con el servidor (no
// pasa por SQLite), así que es el único caso donde se puede saltar al detalle exacto por id —
// eventos/tareas/notas navegan a la pantalla general (ver el comentario en AgendaScreen.tsx).
export type SearchPick =
  | { type: "event"; startTime: string }
  | { type: "task" }
  | { type: "note" }
  | { type: "project"; id: number; title: string };

/**
 * Puerto de GlobalSearch en dashboard/src/components/AppShell.tsx — en vez de un desplegable bajo
 * un campo de texto siempre visible (no cabe bien en una barra lateral estrecha de móvil), aquí es
 * un botón que abre una hoja a pantalla casi completa con el campo y los resultados, mismo criterio
 * de debounce (300ms) y de agrupar por tipo (Eventos/Tareas/Notas/Proyectos).
 */
export function GlobalSearch({ onPick }: { onPick: (pick: SearchPick) => void }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        setResults(await search(trimmed));
      } catch {
        // Sin conexión, sesión caducada... se queda sin resultados en vez de romper la hoja.
        setResults(null);
      } finally {
        setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setResults(null);
  };

  const pick = (value: SearchPick) => {
    onPick(value);
    close();
  };

  const hasResults =
    !!results && (results.events.length > 0 || results.tasks.length > 0 || results.notes.length > 0 || results.projects.length > 0);

  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={[styles.trigger, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <Text numberOfLines={1} style={[styles.triggerText, { color: colors.mutedForeground }]}>
          🔎 Buscar en todo...
        </Text>
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={close}>
        {/* "padding" en los dos sistemas: un <Modal transparent> no hereda el adjustResize del
            Activity en Android, así que dejar `undefined` ahí (solo iOS) hacía que el teclado
            tapara los campos de más abajo sin que nada los desplazara. */}
        <KeyboardAvoidingView
          style={[styles.backdrop, { backgroundColor: "rgba(45,41,38,0.4)" }]}
          behavior="padding"
        >
          <View style={[styles.sheet, { backgroundColor: colors.background }]}>
            <View style={styles.header}>
              <TextInput
                autoFocus
                value={query}
                onChangeText={setQuery}
                placeholder="Buscar en todo..."
                placeholderTextColor={colors.mutedForeground}
                style={[styles.input, { borderColor: colors.inputBorder, backgroundColor: colors.card, color: colors.foreground }]}
              />
              <Pressable onPress={close} hitSlop={8}>
                <Text style={[styles.cancel, { color: colors.mutedForeground }]}>Cancelar</Text>
              </Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.results}>
              {query.trim().length < 2 ? (
                <Text style={[styles.hint, { color: colors.mutedForeground }]}>Escribe al menos 2 letras para buscar.</Text>
              ) : loading ? (
                <ActivityIndicator color={colors.primary} style={styles.loading} />
              ) : !hasResults ? (
                <Text style={[styles.hint, { color: colors.mutedForeground }]}>Sin resultados para "{query.trim()}".</Text>
              ) : (
                <>
                  {results!.events.length > 0 && (
                    <SearchGroup label="Eventos" colors={colors}>
                      {results!.events.map((e) => (
                        <SearchRow
                          key={`event-${e.id}`}
                          title={e.title}
                          subtitle={`${new Date(e.startTime).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}${e.isRecurring ? " · recurrente" : ""}`}
                          colors={colors}
                          onPress={() => pick({ type: "event", startTime: e.startTime })}
                        />
                      ))}
                    </SearchGroup>
                  )}
                  {results!.tasks.length > 0 && (
                    <SearchGroup label="Tareas" colors={colors}>
                      {results!.tasks.map((t) => (
                        <SearchRow key={`task-${t.id}`} title={t.title} colors={colors} onPress={() => pick({ type: "task" })} />
                      ))}
                    </SearchGroup>
                  )}
                  {results!.notes.length > 0 && (
                    <SearchGroup label="Notas" colors={colors}>
                      {results!.notes.map((n) => (
                        <SearchRow key={`note-${n.id}`} title={n.content} colors={colors} onPress={() => pick({ type: "note" })} />
                      ))}
                    </SearchGroup>
                  )}
                  {results!.projects.length > 0 && (
                    <SearchGroup label="Proyectos" colors={colors}>
                      {results!.projects.map((p) => (
                        <SearchRow
                          key={`project-${p.id}`}
                          title={p.title}
                          colors={colors}
                          onPress={() => pick({ type: "project", id: p.id, title: p.title })}
                        />
                      ))}
                    </SearchGroup>
                  )}
                </>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

function SearchGroup({ label, colors, children }: { label: string; colors: ColorPalette; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>{label}</Text>
      {children}
    </View>
  );
}

function SearchRow({ title, subtitle, colors, onPress }: { title: string; subtitle?: string; colors: ColorPalette; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.row}>
      <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.foreground }]}>
        {title}
      </Text>
      {subtitle && (
        <Text numberOfLines={1} style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
          {subtitle}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  trigger: { borderWidth: 1, borderRadius: radius.input, paddingHorizontal: 14, paddingVertical: 10 },
  triggerText: { fontFamily: fonts.sans, fontSize: 13 },
  backdrop: { flex: 1 },
  sheet: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, padding: 16 },
  input: { flex: 1, borderWidth: 1, borderRadius: radius.input, paddingHorizontal: 14, paddingVertical: 10, fontFamily: fonts.sans, fontSize: 15 },
  cancel: { fontFamily: fonts.sansMedium, fontSize: 13 },
  results: { paddingHorizontal: 16, paddingBottom: 24 },
  loading: { marginTop: 24 },
  hint: { fontFamily: fonts.sans, fontSize: 13, textAlign: "center", marginTop: 24 },
  group: { marginBottom: 14 },
  groupLabel: { fontFamily: fonts.sansBold, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4, paddingHorizontal: 8 },
  row: { paddingHorizontal: 8, paddingVertical: 9, borderRadius: radius.input },
  rowTitle: { fontFamily: fonts.sansMedium, fontSize: 14 },
  rowSubtitle: { fontFamily: fonts.sans, fontSize: 11, marginTop: 1 },
});
