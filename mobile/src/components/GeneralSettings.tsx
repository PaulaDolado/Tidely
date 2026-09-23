import { useState } from "react";
import { View, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Text } from "./AppText";
import { useAuth } from "../auth/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { api, ApiError } from "../api/client";
import { fonts, radius } from "../theme";
import { ENABLED_SECTIONS, EnabledSection, SECTION_DESCRIPTIONS, SECTION_LABELS } from "../types";

// Puerto de SectionsPicker en dashboard/src/components/SettingsDialog.tsx — hasta ahora los
// apartados del menú solo se elegían UNA vez, en OnboardingScreen (que usa este mismo checklist
// tal cual, ver sus estilos), sin forma de volver a tocarlos después. Mismo criterio que la web:
// lleva su propio botón "Guardar" (no aplica cada toque al instante) porque cambiar de apartados
// reordena/oculta cosas del menú de golpe, a diferencia de un tema o un tamaño de letra.
export function SectionsPicker() {
  const { user, updateUser } = useAuth();
  const { colors } = useTheme();
  const [selected, setSelected] = useState<Set<EnabledSection>>(() => new Set(user?.enabledSections ?? ENABLED_SECTIONS));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (section: EnabledSection) => {
    setSaved(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const enabledSections = ENABLED_SECTIONS.filter((s) => selected.has(s));
      const profile = await api.put<{ enabledSections: EnabledSection[] }>("/auth/me/onboarding", { enabledSections });
      updateUser({ enabledSections: profile.enabledSections });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron guardar los apartados.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View>
      <Text style={[styles.title, { color: colors.foreground }]}>Apartados del menú</Text>
      <Text style={[styles.description, { color: colors.mutedForeground }]}>
        Qué apartados quieres ver en el menú lateral — los mismos que elegiste al registrarte, puedes cambiarlos cuando quieras.
      </Text>

      <View style={{ gap: 10 }}>
        {ENABLED_SECTIONS.map((section) => {
          const checked = selected.has(section);
          return (
            <Pressable
              key={section}
              onPress={() => toggle(section)}
              style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: checked ? colors.primary : colors.border, borderWidth: checked ? 2 : 1 }]}
            >
              <View
                style={[
                  styles.checkbox,
                  { borderColor: checked ? colors.primary : colors.border, backgroundColor: checked ? colors.primary : "transparent" },
                ]}
              >
                {checked && <Text style={[styles.checkMark, { color: colors.primaryForeground }]}>✓</Text>}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.sectionLabel, { color: colors.foreground }]}>{SECTION_LABELS[section]}</Text>
                <Text style={[styles.sectionDescription, { color: colors.mutedForeground }]}>{SECTION_DESCRIPTIONS[section]}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {error && (
        <Text style={[styles.errorBox, { color: colors.destructive, borderColor: colors.destructive }]}>⚠️ {error}</Text>
      )}
      {saved && <Text style={[styles.success, { color: colors.primary }]}>Apartados actualizados.</Text>}

      <Pressable onPress={save} disabled={saving} style={[styles.button, { backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }]}>
        {saving ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Guardar apartados</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.sansSemiBold, fontSize: 16 },
  description: { fontFamily: fonts.sans, fontSize: 13, marginTop: 2, marginBottom: 14, lineHeight: 18 },
  sectionCard: { flexDirection: "row", alignItems: "flex-start", gap: 12, borderRadius: radius.card, padding: 14 },
  checkbox: { marginTop: 2, width: 20, height: 20, borderRadius: 6, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  checkMark: { fontSize: 11, fontFamily: fonts.sansBold },
  sectionLabel: { fontFamily: fonts.sansMedium, fontSize: 14 },
  sectionDescription: { fontFamily: fonts.sans, fontSize: 12, marginTop: 2 },
  errorBox: { fontFamily: fonts.sans, fontSize: 12, borderWidth: 1, borderRadius: radius.input, padding: 10, marginTop: 10 },
  success: { fontFamily: fonts.sans, fontSize: 12, marginTop: 10 },
  button: { borderRadius: radius.full, paddingVertical: 13, alignItems: "center", justifyContent: "center", marginTop: 14 },
  buttonText: { fontFamily: fonts.sansMedium, fontSize: 15 },
});
