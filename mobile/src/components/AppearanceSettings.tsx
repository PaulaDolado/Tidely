import { View, Pressable, StyleSheet } from "react-native";
import { Text } from "./AppText";
import { useTheme } from "../context/ThemeContext";
import { FONT_SIZE_OPTIONS, useFontSize } from "../context/FontSizeContext";
import { useAuth } from "../auth/AuthContext";
import { api } from "../api/client";
import { fonts, PALETTES, radius, THEME_OPTIONS } from "../theme";
import { MenuLayout } from "../types";

// Puerto de la sección "General > Apariencia" de dashboard/src/components/SettingsDialog.tsx:
// misma idea (6 temas con una miniatura fondo+tarjeta+acento cada uno, tema activo resaltado con
// borde), pero como componente RN suelto en vez de sección de un diálogo más grande — mobile no
// tiene (todavía) el resto de secciones de ese diálogo (Cuenta, políticas...), así que de momento
// esto es TODO el "Ajustes" de mobile, abierto directamente desde el pie del menú (ver
// AppSidebar.tsx). Usa `useTheme()` (reactivo de verdad, ver ThemeContext.tsx), no el `colors`
// estático de theme.ts, para que este propio selector también cambie de golpe al elegir un tema.
export function AppearanceSettings() {
  const { colors } = useTheme();

  return (
    <View style={{ gap: 4 }}>
      <Text style={[styles.title, { color: colors.foreground }]}>Apariencia</Text>
      <Text style={[styles.description, { color: colors.mutedForeground }]}>
        Elige cómo se ve Tidely. "Sistema" mantiene el aspecto actual y sigue el modo claro/oscuro de tu dispositivo.
      </Text>
      <ThemePicker />

      <Text style={[styles.title, styles.sectionSpacing, { color: colors.foreground }]}>Tamaño de letra</Text>
      <Text style={[styles.description, { color: colors.mutedForeground }]}>
        Agranda el texto (y el resto de la interfaz con él) si te cuesta leerlo.
      </Text>
      <FontSizePicker />

      <Text style={[styles.title, styles.sectionSpacing, { color: colors.foreground }]}>Diseño del menú</Text>
      <Text style={[styles.description, { color: colors.mutedForeground }]}>
        Mantén pulsado el ≡ de un apartado del menú para arrastrarlo y cambiar su orden.
      </Text>
      <MenuLayoutPicker />
    </View>
  );
}

// Extraído aparte (no solo dentro de AppearanceSettings) porque OnboardingScreen reutiliza este
// mismo grid tal cual en su paso 2 — mismo componente, mismo comportamiento (tocar aplica el tema
// al instante vía useTheme, no hace falta "guardar" aparte). Mismo criterio que ThemePicker en
// dashboard/src/components/SettingsDialog.tsx (reutilizado ahí por OnboardingWizard.tsx).
export function ThemePicker() {
  const { theme, setTheme, colors } = useTheme();

  return (
    <View style={styles.grid}>
      {THEME_OPTIONS.map((option) => {
        const palette = PALETTES[option.value];
        const selected = theme === option.value;
        return (
          <Pressable
            key={option.value}
            onPress={() => setTheme(option.value)}
            style={[styles.card, { borderColor: selected ? colors.primary : colors.border, borderWidth: selected ? 2 : 1 }]}
          >
            <View style={[styles.preview, { backgroundColor: palette.background }]}>
              <View style={[styles.previewCard, { backgroundColor: palette.card }]} />
              <View style={[styles.previewDot, { backgroundColor: palette.primary }]} />
            </View>
            <Text style={[styles.label, { color: selected ? colors.primary : colors.foreground }]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Igual criterio que en la web: aplica al instante, sin botón "Guardar" — cada tarjeta muestra
// una "Aa" a su propio tamaño real (fontSize en vez de un valor fijo) para ver la diferencia
// antes de elegir.
function FontSizePicker() {
  const { fontSize, setFontSize } = useFontSize();
  const { colors } = useTheme();

  return (
    <View style={styles.optionRow}>
      {FONT_SIZE_OPTIONS.map((option) => {
        const selected = fontSize === option.value;
        return (
          <Pressable
            key={option.value}
            onPress={() => setFontSize(option.value)}
            style={[styles.optionCard, { borderColor: selected ? colors.primary : colors.border, borderWidth: selected ? 2 : 1 }]}
          >
            <Text style={[styles.optionSample, { color: selected ? colors.primary : colors.foreground, fontSize: FONT_SIZE_PREVIEW[option.value] }]}>
              Aa
            </Text>
            <Text style={[styles.label, { color: selected ? colors.primary : colors.foreground }]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Tamaños fijos de la muestra "Aa" — a propósito NO reutiliza `useFontSize().scale` (que ya
// escalaría el `fontSize` de este propio Text vía AppText, ver el comentario ahí): la idea es
// enseñar los 3 tamaños EN PROPORCIÓN entre sí en la misma pantalla, no que las 3 miniaturas
// crezcan juntas según el ajuste ya activo.
const FONT_SIZE_PREVIEW: Record<"normal" | "grande" | "xl", number> = { normal: 16, grande: 18, xl: 20 };

const MENU_LAYOUT_OPTIONS: { value: MenuLayout; label: string; description: string }[] = [
  { value: "default", label: "Por defecto", description: "Apartados fijos y \"Tus páginas\" en dos grupos separados." },
  { value: "compact", label: "Compacto", description: "Todo el menú en una sola lista, sin distinguir \"Tus páginas\"." },
];

// Igual criterio que MenuLayoutPicker en dashboard/src/components/SettingsDialog.tsx: aplica
// optimista vía updateUser primero (el menú cambia sin esperar a la red), el PUT va detrás sin
// bloquear la UI — si falla, se reintenta solo al volver a tocar una opción.
function MenuLayoutPicker() {
  const { user, updateUser } = useAuth();
  const { colors } = useTheme();
  const layout = user?.menuLayout ?? "default";

  const choose = (value: MenuLayout) => {
    if (value === layout) return;
    updateUser({ menuLayout: value });
    api.put("/auth/me/menu", { menuLayout: value }).catch(() => {});
  };

  return (
    <View style={{ gap: 8 }}>
      {MENU_LAYOUT_OPTIONS.map((option) => {
        const selected = layout === option.value;
        return (
          <Pressable
            key={option.value}
            onPress={() => choose(option.value)}
            style={[styles.optionListCard, { borderColor: selected ? colors.primary : colors.border, borderWidth: selected ? 2 : 1 }]}
          >
            <Text style={[styles.label, { marginTop: 0, color: selected ? colors.primary : colors.foreground }]}>{option.label}</Text>
            <Text style={[styles.optionDescription, { color: colors.mutedForeground }]}>{option.description}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.sansSemiBold, fontSize: 16 },
  sectionSpacing: { marginTop: 20 },
  description: { fontFamily: fonts.sans, fontSize: 13, marginTop: 2, marginBottom: 14, lineHeight: 18 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  card: { width: 92, borderRadius: radius.input, padding: 6 },
  preview: { height: 46, borderRadius: 8, padding: 5, flexDirection: "row", alignItems: "flex-end", gap: 4 },
  previewCard: { flex: 1, height: "100%", borderRadius: 5 },
  previewDot: { width: 12, height: 12, borderRadius: radius.full },
  label: { marginTop: 6, fontFamily: fonts.sansMedium, fontSize: 12 },
  optionRow: { flexDirection: "row", gap: 10 },
  optionCard: { flex: 1, borderRadius: radius.input, padding: 10, alignItems: "center" },
  optionSample: { fontFamily: fonts.sansSemiBold },
  optionListCard: { borderRadius: radius.input, padding: 12 },
  optionDescription: { fontFamily: fonts.sans, fontSize: 12, marginTop: 3, lineHeight: 16 },
});
