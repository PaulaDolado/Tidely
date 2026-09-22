import { useMemo, useState } from "react";
import { View, Pressable, ScrollView, StyleSheet, ActivityIndicator } from "react-native";
import { Text } from "../components/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../auth/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { ThemePicker } from "../components/AppearanceSettings";
import { api, ApiError } from "../api/client";
import { ColorPalette, fonts, radius } from "../theme";
import { ENABLED_SECTIONS, EnabledSection, SECTION_DESCRIPTIONS, SECTION_LABELS } from "../types";

type Step = "apartados" | "apariencia";

/**
 * Asistente de bienvenida, se muestra en vez de la app justo después de registrarse — mientras
 * `user.onboardingCompleted` sea `false` (ver App.tsx) — nunca se vuelve a mostrar una vez
 * completado. Puerto de dashboard/src/pages/OnboardingWizard.tsx: mismos dos pasos.
 *  1. Qué apartados opcionales quiere el usuario en el menú — todos marcados por defecto, así que
 *     "quiero todos" es tan simple como tocar "Siguiente" sin tocar nada.
 *  2. Apariencia — mismo componente que Ajustes (AppearanceSettings), elegir aquí es tan
 *     permanente (o tan poco) como en Ajustes: se puede cambiar cuando se quiera después.
 * El PUT a /auth/me/onboarding solo manda los apartados — el tema no necesita ir al backend, ya
 * vive en AsyncStorage vía ThemeContext, igual que cuando se cambia desde Ajustes.
 */
export function OnboardingScreen() {
  const { updateUser } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [step, setStep] = useState<Step>("apartados");
  const [selected, setSelected] = useState<Set<EnabledSection>>(new Set(ENABLED_SECTIONS));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (section: EnabledSection) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const finish = async () => {
    setSaving(true);
    setError(null);
    try {
      const enabledSections = ENABLED_SECTIONS.filter((s) => selected.has(s));
      const profile = await api.put<{ enabledSections: EnabledSection[]; onboardingCompleted: boolean }>("/auth/me/onboarding", {
        enabledSections,
      });
      updateUser({ enabledSections: profile.enabledSections, onboardingCompleted: profile.onboardingCompleted });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar — inténtalo de nuevo.");
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>Bienvenido a Tidely</Text>
        <Text style={styles.stepLabel}>{step === "apartados" ? "Paso 1 de 2 — Apartados" : "Paso 2 de 2 — Apariencia"}</Text>

        {step === "apartados" ? (
          <>
            <Text style={styles.description}>
              ¿Qué apartados quieres tener en tu menú? Puedes elegir todos los que quieras — y cambiarlo cuando quieras después
              desde Ajustes.
            </Text>

            <View style={{ gap: 10 }}>
              {ENABLED_SECTIONS.map((section) => {
                const checked = selected.has(section);
                return (
                  <Pressable
                    key={section}
                    onPress={() => toggle(section)}
                    style={[styles.sectionCard, { borderColor: checked ? colors.primary : colors.border, borderWidth: checked ? 2 : 1 }]}
                  >
                    <View style={[styles.checkbox, { borderColor: checked ? colors.primary : colors.border, backgroundColor: checked ? colors.primary : "transparent" }]}>
                      {checked && <Text style={styles.checkMark}>✓</Text>}
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.sectionLabel}>{SECTION_LABELS[section]}</Text>
                      <Text style={styles.sectionDescription}>{SECTION_DESCRIPTIONS[section]}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <Pressable onPress={() => setStep("apariencia")} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Siguiente</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.description}>
              "Sistema" mantiene el aspecto actual y sigue el modo claro/oscuro de tu dispositivo. Puedes probar los distintos
              temas ahora mismo — se aplican al instante.
            </Text>
            <ThemePicker />

            <Text style={styles.hint}>ℹ️ Esto siempre se puede cambiar más adelante desde Ajustes.</Text>

            {error && <Text style={styles.error}>⚠️ {error}</Text>}

            <View style={styles.footerRow}>
              <Pressable onPress={() => setStep("apartados")} disabled={saving} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Atrás</Text>
              </Pressable>
              <Pressable onPress={finish} disabled={saving} style={[styles.primaryButton, styles.primaryButtonFlex]}>
                {saving ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <Text style={styles.primaryButtonText}>Empezar a usar Tidely</Text>
                )}
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scrollContent: { padding: 20, paddingBottom: 40, gap: 16 },
    title: { fontFamily: fonts.serif, fontSize: 28, color: colors.foreground, textAlign: "center", marginTop: 8 },
    stepLabel: { fontFamily: fonts.sans, fontSize: 13, color: colors.mutedForeground, textAlign: "center", marginBottom: 4 },
    description: { fontFamily: fonts.sans, fontSize: 14, color: colors.mutedForeground, lineHeight: 20 },
    sectionCard: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
      borderRadius: radius.card,
      padding: 14,
      backgroundColor: colors.card,
    },
    checkbox: {
      marginTop: 2,
      width: 20,
      height: 20,
      borderRadius: 6,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    checkMark: { fontSize: 11, color: colors.primaryForeground, fontFamily: fonts.sansBold },
    sectionLabel: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.foreground },
    sectionDescription: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground, marginTop: 2 },
    primaryButton: {
      backgroundColor: colors.primary,
      borderRadius: radius.full,
      paddingVertical: 14,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 8,
    },
    primaryButtonFlex: { flex: 1, marginTop: 0 },
    primaryButtonText: { fontFamily: fonts.sansMedium, color: colors.primaryForeground, fontSize: 15 },
    secondaryButton: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.full,
      paddingVertical: 14,
      paddingHorizontal: 20,
      alignItems: "center",
      justifyContent: "center",
    },
    secondaryButtonText: { fontFamily: fonts.sans, fontSize: 14, color: colors.mutedForeground },
    footerRow: { flexDirection: "row", gap: 10, marginTop: 8 },
    hint: {
      fontFamily: fonts.sans,
      fontSize: 12,
      color: colors.mutedForeground,
      backgroundColor: colors.muted,
      borderRadius: radius.input,
      padding: 10,
    },
    error: { fontFamily: fonts.sans, fontSize: 12, color: colors.destructive },
  });
}
