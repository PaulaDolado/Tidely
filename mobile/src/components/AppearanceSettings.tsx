import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTheme } from "../context/ThemeContext";
import { fonts, PALETTES, radius, THEME_OPTIONS } from "../theme";

// Puerto de la sección "General > Apariencia" de dashboard/src/components/SettingsDialog.tsx:
// misma idea (5 temas con una miniatura fondo+tarjeta+acento cada uno, tema activo resaltado con
// borde), pero como componente RN suelto en vez de sección de un diálogo más grande — mobile no
// tiene (todavía) el resto de secciones de ese diálogo (Cuenta, políticas...), así que de momento
// esto es TODO el "Ajustes" de mobile, abierto directamente desde el pie del menú (ver
// AppSidebar.tsx). Usa `useTheme()` (reactivo de verdad, ver ThemeContext.tsx), no el `colors`
// estático de theme.ts, para que este propio selector también cambie de golpe al elegir un tema.
export function AppearanceSettings() {
  const { theme, setTheme, colors } = useTheme();

  return (
    <View style={{ gap: 4 }}>
      <Text style={[styles.title, { color: colors.foreground }]}>Apariencia</Text>
      <Text style={[styles.description, { color: colors.mutedForeground }]}>
        Elige cómo se ve Tidely. "Sistema" mantiene el aspecto actual y sigue el modo claro/oscuro de tu dispositivo.
      </Text>
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
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.sansSemiBold, fontSize: 16 },
  description: { fontFamily: fonts.sans, fontSize: 13, marginTop: 2, marginBottom: 14, lineHeight: 18 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  card: { width: 92, borderRadius: radius.input, padding: 6 },
  preview: { height: 46, borderRadius: 8, padding: 5, flexDirection: "row", alignItems: "flex-end", gap: 4 },
  previewCard: { flex: 1, height: "100%", borderRadius: 5 },
  previewDot: { width: 12, height: 12, borderRadius: radius.full },
  label: { marginTop: 6, fontFamily: fonts.sansMedium, fontSize: 12 },
});
