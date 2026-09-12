import { useCallback, useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { runSync } from "../sync";
import { listNotes, createNoteLocal, toggleNoteChecked, deleteNoteLocal } from "../db/notesRepo";
import { LocalNote } from "../types";
import { colors, fonts, radius, withAlpha } from "../theme";

/**
 * Puerto de dashboard/src/components/QuickNotesCard.tsx — mismo estilo (bg-warning/10,
 * border-warning/30, renglones con raya inferior como una hoja de libreta), pero autoalimentado
 * desde SQLite (notesRepo) en vez de recibir `notes`/`onChanged` por props, mismo criterio que
 * RecentEntriesCard.tsx en este mismo directorio.
 */
export function QuickNotesCard() {
  const [notes, setNotes] = useState<LocalNote[]>([]);
  const [draft, setDraft] = useState("");
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    setNotes(await listNotes());
    setLoaded(true);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleToggle = async (id: string) => {
    await toggleNoteChecked(id);
    await reload();
    runSync();
  };

  const handleDelete = async (id: string) => {
    await deleteNoteLocal(id);
    await reload();
    runSync();
  };

  const handleAdd = async () => {
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    await createNoteLocal(content);
    await reload();
    runSync();
  };

  if (!loaded) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>📌 Notas rápidas</Text>

      {notes.length === 0 ? (
        <Text style={styles.emptyText}>Sin notas todavía.</Text>
      ) : (
        <View style={styles.list}>
          {notes.map((note) => (
            <View key={note.id} style={styles.row}>
              <Pressable style={styles.rowContent} onPress={() => handleToggle(note.id)}>
                <Checkbox checked={note.checked === 1} />
                <Text style={[styles.noteText, note.checked === 1 && styles.noteTextDone]} numberOfLines={3}>
                  {note.content}
                </Text>
              </Pressable>
              <Pressable onPress={() => handleDelete(note.id)} hitSlop={8}>
                <Text style={styles.deleteMark}>✕</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      <TextInput
        style={styles.input}
        placeholder="+ Añadir nota"
        placeholderTextColor={colors.mutedForeground}
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={handleAdd}
      />
    </View>
  );
}

function Checkbox({ checked }: { checked: boolean }) {
  return <View style={[styles.checkbox, checked && styles.checkboxChecked]}>{checked && <Text style={styles.checkboxMark}>✓</Text>}</View>;
}

const styles = StyleSheet.create({
  // rounded-3xl border-warning/30 bg-warning/10 p-6 de la web.
  card: {
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderColor: withAlpha(colors.warning, 0.3),
    backgroundColor: withAlpha(colors.warning, 0.1),
    padding: 24,
  },
  title: {
    fontFamily: fonts.sansBold,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: colors.warning,
    marginBottom: 16,
  },
  emptyText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.mutedForeground,
    fontStyle: "italic",
    marginBottom: 16,
  },
  list: { marginBottom: 16 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: withAlpha(colors.warning, 0.3),
  },
  rowContent: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 10 },
  noteText: { flex: 1, fontFamily: fonts.sans, fontSize: 14, color: colors.foreground },
  noteTextDone: { textDecorationLine: "line-through", color: colors.mutedForeground },
  deleteMark: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.mutedForeground, paddingHorizontal: 4 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  checkboxChecked: { backgroundColor: colors.warning, borderColor: colors.warning },
  checkboxMark: { color: colors.primaryForeground, fontSize: 12, fontFamily: fonts.sansBold },
  input: {
    backgroundColor: colors.background,
    borderRadius: radius.input,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.foreground,
  },
});
