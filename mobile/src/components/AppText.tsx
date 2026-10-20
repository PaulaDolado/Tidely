import { Text as RNText, TextInput as RNTextInput, StyleSheet, TextProps, TextInputProps } from "react-native";
import { useFontSize } from "../context/FontSizeContext";
import { useTheme } from "../context/ThemeContext";

// Ajuste de tamaño de letra global (ver FontSizeContext.tsx) sin tocar los ~400 `fontSize: N`
// sueltos repartidos por cada pantalla (StyleSheet.create de módulo, no hay una "unidad rem" que
// escalar de un tirón como en la web) — en vez de eso, cada pantalla importa `Text`/`TextInput`
// DE AQUÍ en vez de "react-native" (mismo nombre, `import { Text } from "../components/AppText"`,
// así el JSX no cambia ni una línea) y este wrapper multiplica el `fontSize` ya resuelto de su
// `style` por la escala activa, leída con el hook (reactivo de verdad: cada instancia se
// re-renderiza sola en cuanto cambia el ajuste, sin esperar a que la pantalla entera se
// desmonte/remonte). Si el estilo no trae `fontSize` explícito, se deja tal cual (el tamaño por
// defecto de RN, ~14, no necesita escalarse a mano aquí).
//
// También pone los colores por defecto del tema cuando el componente no los indica: sin esto, un texto o un campo
// sin `color` salía en el negro de React Native y, en modo oscuro, era ilegible sobre el fondo; y el texto de
// ayuda de un campo (placeholder) usaba el gris del sistema en vez del atenuado del tema.
export function Text({ style, ...props }: TextProps) {
  const { scale } = useFontSize();
  const { colors } = useTheme();
  const flat = StyleSheet.flatten(style);
  const color = flat?.color === undefined ? { color: colors.foreground } : null;
  const fontSize = scale !== 1 && typeof flat?.fontSize === "number" ? { fontSize: flat.fontSize * scale } : null;
  if (!color && !fontSize) return <RNText style={style} {...props} />;
  return <RNText style={[color, style, fontSize]} {...props} />;
}

export function TextInput({ style, placeholderTextColor, selectionColor, cursorColor, ...props }: TextInputProps) {
  const { scale } = useFontSize();
  const { colors } = useTheme();
  const flat = StyleSheet.flatten(style);
  const color = flat?.color === undefined ? { color: colors.foreground } : null;
  const fontSize = scale !== 1 && typeof flat?.fontSize === "number" ? { fontSize: flat.fontSize * scale } : null;
  return (
    <RNTextInput
      style={color || fontSize ? [color, style, fontSize] : style}
      placeholderTextColor={placeholderTextColor ?? colors.mutedForeground}
      selectionColor={selectionColor ?? colors.primary}
      cursorColor={cursorColor ?? colors.primary}
      {...props}
    />
  );
}
