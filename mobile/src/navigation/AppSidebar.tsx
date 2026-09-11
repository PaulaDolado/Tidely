import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Animated, Easing, View, Text, Pressable, Image, ScrollView, Modal, StyleSheet, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useAuth } from "../auth/AuthContext";
import { useSidebar } from "./SidebarContext";
import { useTheme } from "../context/ThemeContext";
import { ApiError } from "../api/client";
import { createCustomPage, CustomPageSummary, CustomPageTemplate, listCustomPages } from "../api/customPages";
import { NewPageForm } from "../components/NewPageForm";
import { AppearanceSettings } from "../components/AppearanceSettings";
import { ColorPalette, fonts, radius } from "../theme";

// Sidebar lateral para móvil — reemplaza la barra de pestañas inferior (bottom-tabs) por un menú
// lateral colapsable, puerto de dashboard/src/components/AppShell.tsx (<aside> de escritorio) en
// vez del "menú horizontal de pestañas" que llevaba el móvil hasta ahora. Se engancha como
// `tabBar` personalizado de <Tab.Navigator> con `tabBarPosition: "left"` (ver App.tsx): React
// Navigation sigue gestionando el estado/foco de cada pestaña exactamente igual, solo cambia cómo
// se pinta la barra.
//
// A diferencia de la web (columna fija que empuja al resto del contenido), aquí el menú vive
// SIEMPRE fuera del flujo del layout (el `<View>` raíz mide 0x0 — ver el `return` de abajo) y se
// pinta como un cajón que se desliza por ENCIMA del contenido con un fondo oscuro detrás, en vez
// de reservar `sidebarWidth` real en el flex-row del navegador y encoger la pantalla abierta cada
// vez que se despliega (la primera versión de este componente hacía eso, y "deformaba" demasiado
// la pantalla al abrir/cerrar). El panel sigue montado tanto abierto como cerrado (solo se anima
// su `translateX`) para poder animar también la salida, no solo la entrada.
//
// Reutiliza el mismo activo que la web para el botón de esconder/mostrar el menú: la foto real de
// un clip de papel (clipClosed.png/clipOpen.png, ver comentario en AppShell.tsx sobre por qué es
// una foto y no un SVG). Con el menú desplegado se ve clipClosed.png sobre el borde derecho del
// panel (como sujetándolo, y deslizándose con él); colapsado se ve clipOpen.png girado 90°, pegado
// al borde izquierdo de la pantalla — mismo criterio visual que en escritorio.
//
// A diferencia de la web (barra redimensionable a mano arrastrando el borde), aquí el ancho del
// panel solo se AUTO-calcula una vez, midiendo fuera de pantalla cuánto ocupa sin cortarse el
// apartado más largo del menú (ver measureContainer más abajo) — no hay gesto de arrastre táctil
// equivalente al `mousemove` de escritorio, así que se fija ese ancho medido (con un máximo
// relativo al ancho de la pantalla, para no comerse casi toda la pantalla en un móvil pequeño).

const clipClosedSource = require("../../assets/clipClosed.png");
const clipOpenSource = require("../../assets/clipOpen.png");

// Proporciones reales de cada foto (293x197 y 264x131 respectivamente, ver AppShell.tsx) — el alto
// de render sale de mantenerlas, igual que en la web.
const CLIP_CLOSED_W = 56;
const CLIP_CLOSED_H = Math.round((CLIP_CLOSED_W * 197) / 293);
const CLIP_OPEN_W = 56;
const CLIP_OPEN_H = Math.round((CLIP_OPEN_W * 131) / 264);

// Cuánto de más allá del ancho del panel empieza su posición "cerrada" — así ni el panel ni la
// sombra/el clip de su borde derecho asoman por el lado izquierdo mientras desliza.
const OFFSCREEN_MARGIN = 40;
const SLIDE_DURATION_MS = 240;

interface NavItem {
  route: string; // debe coincidir con un name de <Tab.Screen> en App.tsx
  label: string;
  children?: NavItem[];
}

// Mismo árbol que NAV en dashboard/src/components/AppShell.tsx (Agenda agrupa Planificador y
// Horario, Finanzas agrupa Ahorro) — el móvil hasta ahora lo aplanaba (FLAT_NAV) porque una fila
// horizontal de pestañas no tenía sitio para anidar; una columna vertical sí, así que aquí se
// replica la jerarquía real de escritorio en vez de la versión aplanada.
//
// "Páginas" NO está aquí a propósito: ya no es un apartado que navegue a una lista, es el botón
// "+ Nueva página" al final del menú (ver más abajo, después de este NAV.map) — mismo criterio
// que el botón "+ Nueva página" de dashboard/src/components/AppShell.tsx, que tampoco vive dentro
// del <nav> de apartados sino aparte, junto al listado de "Tus páginas". La pantalla "Lista"
// (PaginasListScreen.tsx) sigue existiendo y sigue siendo alcanzable volviendo atrás desde el
// detalle de una página — solo se quitó como entrada directa del menú.
const NAV: NavItem[] = [
  { route: "Hoy", label: "Hoy" },
  {
    route: "Agenda",
    label: "Agenda",
    children: [
      { route: "Planificador", label: "Planificador" },
      { route: "Horario", label: "Horario" },
    ],
  },
  { route: "Objetivos", label: "Objetivos" },
  {
    route: "Finanzas",
    label: "Finanzas",
    children: [{ route: "Ahorro", label: "Metas de ahorro" }],
  },
  { route: "Proyectos", label: "Proyectos" },
];

// Clave de medición para el botón "+ Nueva página" (ver measureContainer) — no es una `route` de
// verdad, así que no puede compartir claves con NAV/App.tsx.
const NEW_PAGE_LABEL = "+ Nueva página";
const NEW_PAGE_KEY = "__new_page__";

const DEFAULT_WIDTH = 220;
// Añadido al ancho de texto medido: paddingHorizontal del botón (2*12) + paddingHorizontal de la
// columna (2*20) — equivalente al SIDEBAR_PADDING_X de la web, pero para el layout de aquí.
const WIDTH_PADDING = 24 + 40;
// Extra que suman el indentado + borde de los subapartados (ml-3 pl-3 border, ver childList).
const CHILD_INDENT = 28;

export function AppSidebar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const { collapsed, setCollapsed } = useSidebar();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [labelWidths, setLabelWidths] = useState<Record<string, number>>({});
  const [showCreatePage, setShowCreatePage] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [customPages, setCustomPages] = useState<CustomPageSummary[]>([]);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const activeRoute = state.routes[state.index].name;
  const maxWidth = Math.round(screenWidth * 0.74);
  // "Tus páginas" no repite la galería: ya tiene su propio botón (ver openGallery/render).
  const otherPages = customPages.filter((p) => p.template !== "galeria");

  const measuredMax = Math.max(0, ...Object.values(labelWidths));
  const sidebarWidth = Math.min(Math.max(DEFAULT_WIDTH, measuredMax + WIDTH_PADDING), maxWidth);

  // 0 = escondido del todo, 1 = desplegado — se anima con `Animated.timing` (ver el efecto de
  // abajo) en vez de saltar directamente, para el efecto de cajón deslizante que se pidió en vez
  // de que el contenido se comprima de golpe.
  const progress = useRef(new Animated.Value(collapsed ? 0 : 1)).current;
  useEffect(() => {
    Animated.timing(progress, {
      toValue: collapsed ? 0 : 1,
      duration: SLIDE_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [collapsed, progress]);

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-(sidebarWidth + OFFSCREEN_MARGIN), 0],
  });

  const onMeasureLabel = (key: string, width: number) => {
    setLabelWidths((prev) => (prev[key] === width ? prev : { ...prev, [key]: width }));
  };

  // Igual que "Tus páginas" en dashboard/src/components/AppShell.tsx — un fallo puntual no debe
  // romper el resto del sidebar, ya se reintentará la próxima vez que se abra el menú.
  const reloadCustomPages = useCallback(async () => {
    try {
      setCustomPages(await listCustomPages());
    } catch {
      // silencioso a propósito, ver el comentario de arriba
    }
  }, []);

  useEffect(() => {
    reloadCustomPages();
  }, [reloadCustomPages]);

  // AppSidebar no es una pantalla con su propio ciclo de foco (useFocusEffect) — es el `tabBar`,
  // siempre montado — así que recarga cada vez que se ABRE el menú, para reflejar páginas creadas/
  // renombradas/borradas desde la web o desde PaginasListScreen (alcanzable volviendo atrás desde
  // el detalle) sin esperar a la próxima vez que se monte AppSidebar entero (nunca, en la práctica).
  useEffect(() => {
    if (!collapsed) reloadCustomPages();
  }, [collapsed, reloadCustomPages]);

  // Navegar SIEMPRE cierra el menú (a diferencia de la web, donde el <aside> se queda fijo) —
  // en una pantalla de móvil, dejarlo desplegado tapando el contenido tras elegir a dónde ir
  // sería un paso extra de más; el usuario ya puede volver a abrirlo con el clip cuando lo
  // necesite. Aparte de toggleSection a propósito: eso no navega a ningún sitio, así que no debe
  // cerrar nada.
  const goTo = (route: string) => {
    navigation.navigate(route);
    setCollapsed(true);
  };

  const toggleSection = (route: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(route)) next.delete(route);
      else next.add(route);
      return next;
    });
  };

  // Igual que goTo(), pero para "Detalle" de la pila anidada de Páginas (ver App.tsx:
  // RootTabParamList.Páginas ya acepta NavigatorScreenParams para esto) — mismo criterio que
  // handleCreate en PaginasListScreen.tsx: crear salta directo al detalle de la página nueva, no
  // se queda en ningún listado intermedio.
  const handleCreatePage = async (title: string, template: CustomPageTemplate) => {
    const created = await createCustomPage(title, template);
    setShowCreatePage(false);
    await reloadCustomPages();
    navigation.navigate("Páginas", { screen: "Detalle", params: { id: created.id, title: created.title } });
    setCollapsed(true);
  };

  const openPage = (page: CustomPageSummary) => {
    navigation.navigate("Páginas", { screen: "Detalle", params: { id: page.id, title: page.title } });
    setCollapsed(true);
  };

  // "Galería" es un apartado del menú principal (como Hoy/Agenda/...), igual que en
  // dashboard/src/components/AppShell.tsx: por debajo sigue siendo una página personalizada de
  // plantilla "galeria", pero nunca hay más de una — busca la del usuario (consulta fresca, no
  // el `customPages` ya en estado, para no crear una segunda por una lista todavía sin cargar la
  // primera vez) o la crea, y navega a su detalle igual que openPage/handleCreatePage.
  //
  // Con try/catch a propósito, a diferencia de antes: si listCustomPages/createCustomPage fallaba
  // (sesión caducada, sin red…), el error se quedaba sin capturar y no pasaba nada visible al
  // tocar "Galería" — ni se navegaba ni se cerraba el menú, así que parecía que el botón no hacía
  // nada. Mismo mensaje que el resto de pantallas (ApiError.message si lo hay).
  const openGallery = async () => {
    try {
      const pages = await listCustomPages();
      let galleryPage = pages.find((p) => p.template === "galeria") ?? null;
      if (!galleryPage) galleryPage = await createCustomPage("Galería", "galeria");
      await reloadCustomPages();
      navigation.navigate("Páginas", { screen: "Detalle", params: { id: galleryPage.id, title: galleryPage.title } });
      setCollapsed(true);
    } catch (err) {
      Alert.alert("No se pudo abrir la galería", err instanceof ApiError ? err.message : "Inténtalo de nuevo.");
    }
  };

  const topOffset = insets.top + 16;

  return (
    // Raíz 0x0 a propósito: no reserva ancho en el flex-row del navegador ni abierto ni cerrado
    // (a diferencia de la primera versión, que sí lo hacía estando desplegado y por eso encogía
    // el contenido) — tanto el fondo oscuro como el panel escapan de este tamaño con
    // `position: absolute`, así que la pantalla de detrás nunca cambia de tamaño.
    <>
      {/* Fondo oscuro semitransparente: se interpone entre el menú y el contenido mientras
          desliza, y tocarlo cierra el menú. `pointerEvents` en "none" mientras está cerrado para
          no robarle toques al contenido (aunque su opacidad ya sea 0). */}
      <Animated.View
        pointerEvents={collapsed ? "none" : "auto"}
        style={[styles.backdrop, { width: screenWidth, height: screenHeight, opacity: progress }]}
      >
        <Pressable style={styles.backdropTouchable} onPress={() => setCollapsed(true)} />
      </Animated.View>

      {/* Botón para reabrir el menú — solo mientras está colapsado; con el menú abierto, el clip
          que lo cierra vive DENTRO del panel (más abajo) y se desliza con él. */}
      {collapsed && (
        <Pressable
          onPress={() => setCollapsed(false)}
          accessibilityRole="button"
          accessibilityLabel="Mostrar menú"
          hitSlop={12}
          style={[styles.clipButton, { top: topOffset, left: 4, width: CLIP_OPEN_H, height: CLIP_OPEN_W }]}
        >
          <Image
            source={clipOpenSource}
            resizeMode="contain"
            style={{ width: CLIP_OPEN_W, height: CLIP_OPEN_H, transform: [{ rotate: "90deg" }] }}
          />
        </Pressable>
      )}

      {/* Panel deslizante — siempre montado (para poder animar también la salida), con
          `pointerEvents` desactivados mientras está fuera de pantalla para que no robe toques al
          contenido de detrás aunque ya no se vea. */}
      <Animated.View
        pointerEvents={collapsed ? "none" : "auto"}
        style={[styles.sidebar, { width: sidebarWidth, height: screenHeight, transform: [{ translateX }] }]}
      >
        {/* Clon invisible del menú, fuera de pantalla, solo para medir el ancho natural del
            apartado más largo sin cortarse — mismo truco que measureRef en AppShell.tsx. */}
        <View style={styles.measureContainer} pointerEvents="none">
          {NAV.map((item) => (
            <View key={item.route}>
              <Text style={styles.measureLabel} onLayout={(e) => onMeasureLabel(item.route, e.nativeEvent.layout.width)}>
                {item.label}
              </Text>
              {item.children?.map((child) => (
                <Text
                  key={child.route}
                  style={styles.measureLabelChild}
                  onLayout={(e) => onMeasureLabel(child.route, e.nativeEvent.layout.width + CHILD_INDENT)}
                >
                  {child.label}
                </Text>
              ))}
            </View>
          ))}
          <Text style={styles.measureLabel} onLayout={(e) => onMeasureLabel(NEW_PAGE_KEY, e.nativeEvent.layout.width)}>
            {NEW_PAGE_LABEL}
          </Text>
        </View>

        <ScrollView style={{ paddingTop: topOffset }} contentContainerStyle={styles.scrollContent}>
          <Text style={styles.brand}>Tidely</Text>

          <View style={styles.nav}>
            {NAV.map((item) => {
              const sectionCollapsed = collapsedSections.has(item.route);
              const isActive = activeRoute === item.route;
              return (
                <View key={item.route}>
                  <View style={styles.navRow}>
                    <Pressable onPress={() => goTo(item.route)} style={[styles.navButton, isActive && styles.navButtonActive]}>
                      <Text numberOfLines={1} style={[styles.navLabel, isActive && styles.navLabelActive]}>
                        {item.label}
                      </Text>
                    </Pressable>
                    {/* Aparte a propósito del botón de arriba, igual que en AppShell.tsx: uno
                        navega a la página del apartado, el otro solo pliega/despliega sus hijos. */}
                    {item.children && (
                      <Pressable
                        onPress={() => toggleSection(item.route)}
                        hitSlop={8}
                        accessibilityLabel={sectionCollapsed ? `Mostrar subapartados de ${item.label}` : `Ocultar subapartados de ${item.label}`}
                        style={styles.chevronButton}
                      >
                        <Text style={[styles.chevron, sectionCollapsed && styles.chevronCollapsed]}>▾</Text>
                      </Pressable>
                    )}
                  </View>

                  {item.children && !sectionCollapsed && (
                    <View style={styles.childList}>
                      {item.children.map((child) => {
                        const childActive = activeRoute === child.route;
                        return (
                          <Pressable
                            key={child.route}
                            onPress={() => goTo(child.route)}
                            style={[styles.childButton, childActive && styles.navButtonActive]}
                          >
                            <Text numberOfLines={1} style={[styles.childLabel, childActive && styles.navLabelActive]}>
                              {child.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })}

            {/* Apartado del menú principal, no una página personalizada más de "Tus páginas" —
                mismo criterio que el botón "Galería" de dashboard/src/components/AppShell.tsx:
                por debajo sigue siendo una página de plantilla "galeria", pero openGallery busca
                la existente o crea la primera, así que el usuario no ve ese paso intermedio. */}
            <Pressable onPress={openGallery} style={styles.navButton}>
              <Text numberOfLines={1} style={styles.navLabel}>
                Galería
              </Text>
            </Pressable>

            {/* "Tus páginas" — mismo criterio que dashboard/src/components/AppShell.tsx: cada
                página creada aparece aquí, tocarla navega directo a su detalle. Sin renombrar/
                borrar inline (eso ya se puede hacer entrando en el detalle de la página, ver
                PaginaDetailScreen.tsx) — el pedido era solo que se vieran en el menú. Excluye
                "galeria": esa ya tiene su propio hueco arriba, listarla aquí también duplicaría. */}
            {otherPages.length > 0 && (
              <>
                <Text style={styles.navSectionLabel}>Tus páginas</Text>
                {otherPages.map((page) => (
                  <Pressable key={page.id} onPress={() => openPage(page)} style={styles.navButton}>
                    <Text numberOfLines={1} style={styles.navLabel}>
                      {page.title}
                    </Text>
                  </Pressable>
                ))}
              </>
            )}

            {/* Al final del todo, no un apartado más: translúcido con borde punteado (mismo
                criterio que el botón "+ Nueva página" de dashboard/src/components/AppShell.tsx)
                para distinguirlo del resto — es una acción de "crear algo nuevo", no una pestaña
                a la que navegar. Abre el diálogo de crear página directamente, en vez de navegar
                a un listado primero (ver handleCreatePage). */}
            <Pressable onPress={() => setShowCreatePage(true)} style={styles.newPageButton}>
              <Text numberOfLines={1} style={styles.newPageLabel}>
                {NEW_PAGE_LABEL}
              </Text>
            </Pressable>
          </View>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          {/* Mismo gesto que la web (AppShell.tsx): tocar el nombre abre Ajustes — de momento solo
              "Apariencia" (ver AppearanceSettings), el resto de secciones del diálogo web
              (Cuenta, políticas...) todavía no tienen pantalla propia en mobile. */}
          <Pressable style={styles.footerUser} onPress={() => setShowSettings(true)} hitSlop={8}>
            <Text numberOfLines={1} style={styles.userName}>
              {user?.name}
            </Text>
            <Text numberOfLines={1} style={styles.userEmail}>
              {user?.email}
            </Text>
          </Pressable>
          <Pressable onPress={logout} hitSlop={8}>
            <Text style={styles.logout}>Salir</Text>
          </Pressable>
        </View>

        {/* Botón de esconder el menú a caballo del borde derecho del panel — se desliza con él
            porque vive dentro del propio Animated.View. */}
        <Pressable
          onPress={() => setCollapsed(true)}
          accessibilityRole="button"
          accessibilityLabel="Ocultar menú"
          hitSlop={12}
          style={[styles.clipButton, { top: topOffset, left: sidebarWidth - CLIP_CLOSED_W / 2, width: CLIP_CLOSED_W, height: CLIP_CLOSED_H }]}
        >
          <Image source={clipClosedSource} resizeMode="contain" style={{ width: CLIP_CLOSED_W, height: CLIP_CLOSED_H }} />
        </Pressable>
      </Animated.View>

      {/* Mismo diálogo (plantilla + título) que dashboard/src/components/AppShell.tsx abre al
          pulsar "+ Nueva página" — un <Modal> nativo, no otra pantalla del stack, así que no hace
          falta pasar por "Lista" para crear. */}
      <Modal visible={showCreatePage} animationType="slide" transparent onRequestClose={() => setShowCreatePage(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <NewPageForm onCancel={() => setShowCreatePage(false)} onSubmit={handleCreatePage} />
          </View>
        </View>
      </Modal>

      <Modal visible={showSettings} animationType="slide" transparent onRequestClose={() => setShowSettings(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setShowSettings(false)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.settingsHeader}>
              <Text style={styles.settingsTitle}>Ajustes</Text>
              <Pressable onPress={() => setShowSettings(false)} hitSlop={8}>
                <Text style={styles.settingsClose}>Cerrar</Text>
              </Pressable>
            </View>
            <AppearanceSettings />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

// Función, no objeto suelto: antes `styles` se calculaba UNA vez al importar este fichero (con
// los colores del tema que estuviera activo en ese instante) y ya no se enteraba de más cambios
// — ahora el componente la vuelve a llamar (ver `useMemo(() => createStyles(colors), [colors])`
// arriba) cada vez que `useTheme()` entrega una paleta distinta.
function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    zIndex: 20,
    elevation: 20,
    backgroundColor: "rgba(45, 41, 38, 0.4)",
  },
  backdropTouchable: {
    flex: 1,
  },
  sidebar: {
    position: "absolute",
    top: 0,
    left: 0,
    zIndex: 25,
    elevation: 25,
    backgroundColor: colors.background,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    // Sombra hacia el contenido que tapa, como una hoja real levantada del resto — visible sobre
    // todo en iOS (shadow*); Android ya tiene su propia sombra de `elevation`.
    shadowColor: "#000",
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 24,
  },
  measureContainer: {
    position: "absolute",
    left: -9999,
    top: 0,
  },
  measureLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  measureLabelChild: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  brand: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 20,
    color: colors.foreground,
  },
  nav: {
    gap: 4,
  },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  navButton: {
    flex: 1,
    minWidth: 0,
    borderRadius: radius.input,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  navButtonActive: {
    backgroundColor: colors.primaryTint,
  },
  navLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 15,
    color: colors.mutedForeground,
  },
  navLabelActive: {
    color: colors.primary,
  },
  chevronButton: {
    padding: 8,
  },
  chevron: {
    fontSize: 12,
    color: colors.mutedForeground,
  },
  chevronCollapsed: {
    transform: [{ rotate: "-90deg" }],
  },
  childList: {
    marginLeft: 12,
    paddingLeft: 12,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    gap: 2,
  },
  childButton: {
    borderRadius: radius.input,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  childLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.mutedForeground,
  },
  // px-3 pb-1 text-xs font-bold uppercase tracking-widest text-muted-foreground del "Tus páginas"
  // de la web.
  navSectionLabel: {
    fontFamily: fonts.sansBold,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: colors.mutedForeground,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 2,
  },
  // border-dashed border-primary/30 bg-primary/5 text-primary del botón "+ Nueva página" de la
  // web — lo distingue del resto de filas del menú, que son texto liso sin fondo ni borde.
  newPageButton: {
    marginTop: 4,
    borderRadius: radius.input,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(95, 113, 97, 0.3)",
    backgroundColor: "rgba(95, 113, 97, 0.05)",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  newPageLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 15,
    color: colors.primary,
  },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(45,41,38,0.4)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    padding: 20,
    maxHeight: "88%",
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerUser: {
    flex: 1,
    minWidth: 0,
  },
  userName: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.foreground,
  },
  userEmail: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.mutedForeground,
  },
  logout: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.mutedForeground,
  },
  clipButton: {
    position: "absolute",
    zIndex: 30,
    elevation: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  settingsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  settingsTitle: {
    fontFamily: fonts.serif,
    fontSize: 20,
    color: colors.foreground,
  },
  settingsClose: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.mutedForeground,
  },
  });
}
