import { Pressable, StyleSheet } from "react-native";
import { Text } from "./AppText";
import { useSidebar, SIDEBAR_CLIP_CLEARANCE } from "../navigation/SidebarContext";
import { colors, fonts } from "../theme";

/**
 * Flecha de "volver" para la cabecera NATIVA de un stack de detalle (Proyectos > libreta,
 * Páginas > página) — a diferencia de las pantallas de lista, que pintan su propia cabecera y ya
 * se apartan del clip flotante con `SIDEBAR_CLIP_CLEARANCE` (ver SidebarContext.tsx), estas
 * pantallas usan el header nativo de React Navigation, cuya flecha de volver por defecto no sabe
 * nada del clip: con el menú colapsado, ambos caían en la misma esquina superior-izquierda y se
 * solapaban. Mismo criterio de "la pantalla se aparta del clip, no al revés" que ya usa el resto
 * de la app, aplicado aquí a mano porque `headerLeft` no admite un padding condicional desde las
 * `options` del Stack.Screen — hay que sustituir el botón entero.
 */
export function DetailBackButton({ onPress }: { onPress: () => void }) {
  const { collapsed } = useSidebar();
  return (
    <Pressable onPress={onPress} hitSlop={12} style={collapsed ? styles.collapsedOffset : undefined}>
      <Text style={styles.arrow}>‹</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  arrow: { fontSize: 28, fontFamily: fonts.sansMedium, color: colors.foreground, lineHeight: 28 },
  collapsedOffset: { marginLeft: SIDEBAR_CLIP_CLEARANCE },
});
