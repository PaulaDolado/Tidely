import { Text as RNText, TextInput as RNTextInput, StyleSheet, TextProps, TextInputProps } from "react-native";
import { useFontSize } from "../context/FontSizeContext";

// Ajuste de tamaño de letra global (ver FontSizeContext.tsx) sin tocar los ~400 `fontSize: N`
// sueltos repartidos por cada pantalla (StyleSheet.create de módulo, no hay una "unidad rem" que
// escalar de un tirón como en la web) — en vez de eso, cada pantalla importa `Text`/`TextInput`
// DE AQUÍ en vez de "react-native" (mismo nombre, `import { Text } from "../components/AppText"`,
// así el JSX no cambia ni una línea) y este wrapper multiplica el `fontSize` ya resuelto de su
// `style` por la escala activa, leída con el hook (reactivo de verdad: cada instancia se
// re-renderiza sola en cuanto cambia el ajuste, sin esperar a que la pantalla entera se
// desmonte/remonte). Si el estilo no trae `fontSize` explícito, se deja tal cual (el tamaño por
// defecto de RN, ~14, no necesita escalarse a mano aquí).
export function Text({ style, ...props }: TextProps) {
  const { scale } = useFontSize();
  if (scale === 1) return <RNText style={style} {...props} />;
  const flat = StyleSheet.flatten(style);
  const fontSize = typeof flat?.fontSize === "number" ? flat.fontSize * scale : undefined;
  return <RNText style={fontSize !== undefined ? [style, { fontSize }] : style} {...props} />;
}

export function TextInput({ style, ...props }: TextInputProps) {
  const { scale } = useFontSize();
  if (scale === 1) return <RNTextInput style={style} {...props} />;
  const flat = StyleSheet.flatten(style);
  const fontSize = typeof flat?.fontSize === "number" ? flat.fontSize * scale : undefined;
  return <RNTextInput style={fontSize !== undefined ? [style, { fontSize }] : style} {...props} />;
}
