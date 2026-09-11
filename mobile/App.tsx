import { useCallback } from "react";
import { StatusBar } from "expo-status-bar";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer, NavigatorScreenParams } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import * as SplashScreen from "expo-splash-screen";
import { useFonts, Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold, Outfit_700Bold } from "@expo-google-fonts/outfit";
import { InstrumentSerif_400Regular } from "@expo-google-fonts/instrument-serif";
import { AuthProvider, useAuth } from "./src/auth/AuthContext";
import { ThemeProvider, useTheme } from "./src/context/ThemeContext";
import { AppSidebar } from "./src/navigation/AppSidebar";
import { SidebarProvider } from "./src/navigation/SidebarContext";
import { LoginScreen } from "./src/screens/LoginScreen";
import { HoyScreen } from "./src/screens/HoyScreen";
import { AgendaScreen } from "./src/screens/AgendaScreen";
import { PlanificadorScreen } from "./src/screens/PlanificadorScreen";
import { HorarioScreen } from "./src/screens/HorarioScreen";
import { ObjetivosScreen } from "./src/screens/ObjetivosScreen";
import { FinanzasScreen } from "./src/screens/FinanzasScreen";
import { MetasAhorroScreen } from "./src/screens/MetasAhorroScreen";
import { PaginasScreen, PaginasStackParamList } from "./src/screens/PaginasScreen";
import { ProyectosScreen } from "./src/screens/ProyectosScreen";

// Mantiene la splash nativa visible hasta que las fuentes (ver más abajo) terminen de cargar —
// llamada en scope global, no dentro de un componente, tal y como pide la propia documentación
// de expo-splash-screen (si se llama demasiado tarde, la splash ya se habrá ocultado sola).
SplashScreen.preventAutoHideAsync();

// 9 pestañas (Hoy / Agenda / Planificador / Horario / Objetivos / Finanzas / Ahorro / Páginas /
// Proyectos). El propio `<Tab.Navigator>` sigue siendo `createBottomTabNavigator` (gestiona el
// estado/foco de cada pestaña igual que siempre), pero con `tabBarPosition: "left"` y un `tabBar`
// personalizado (ver src/navigation/AppSidebar.tsx) se pinta como un menú lateral colapsable en
// vez de la barra inferior — puerto del <aside> de escritorio
// (dashboard/src/components/AppShell.tsx), que ahora SÍ agrupa Planificador+Horario bajo Agenda y
// Ahorro bajo Finanzas igual que la web, en vez de aplanarlos como hacía la barra horizontal
// anterior (ahí sí faltaba sitio para anidar; en una columna vertical no). Ver mobile/README.md
// para el resto de secciones de la web que aún no tienen pantalla propia (Hobbies...). Horario,
// Objetivos, Finanzas, Ahorro, Páginas y Proyectos son las únicas que NO pasan por SQLite (ver
// src/api/schedule.ts, src/api/goals.ts, src/api/finance.ts, src/api/customPages.ts,
// src/api/projects.ts): necesitan conexión, igual que en la propia web. Cada pantalla pinta su
// propia cabecera dentro de su SafeAreaView (headerShown: false a nivel de pestañas), salvo
// "Páginas" y "Proyectos", que montan su propia pila anidada con cabecera nativa para el detalle
// — ver PaginasScreen.tsx / ProyectosScreen.tsx.
export type RootTabParamList = {
  Hoy: undefined;
  Agenda: undefined;
  Planificador: undefined;
  Horario: undefined;
  Objetivos: undefined;
  Finanzas: undefined;
  Ahorro: undefined;
  // NavigatorScreenParams (no `undefined` a secas, como el resto): AppSidebar navega directo a
  // "Detalle" tras crear una página desde el diálogo "+ Nueva página" del menú, en vez de dejar
  // que el usuario aterrice siempre en "Lista" — ver AppSidebar.tsx.
  Páginas: NavigatorScreenParams<PaginasStackParamList> | undefined;
  Proyectos: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

function Root() {
  const { user, ready } = useAuth();
  const { colors } = useTheme();

  if (!ready) {
    // Comprobando si había sesión guardada en SecureStore — instantáneo en la práctica, pero
    // evita un parpadeo Login→Hoy si el dispositivo tarda un poco.
    return (
      <View style={[styles.loading, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!user) return <LoginScreen />;

  return (
    // SidebarProvider por fuera del Navigator: AppSidebar (el tabBar) y todas las pantallas
    // (hermanas suyas dentro del Navigator, no hijas) necesitan leer/escribir el mismo "¿está
    // colapsado el menú?" — ver SidebarContext.tsx para el porqué.
    <SidebarProvider>
      <NavigationContainer>
        <Tab.Navigator
          tabBar={(props) => <AppSidebar {...props} />}
          screenOptions={{
            headerShown: false,
            tabBarPosition: "left",
          }}
        >
          <Tab.Screen name="Hoy" component={HoyScreen} />
          <Tab.Screen name="Agenda" component={AgendaScreen} />
          <Tab.Screen name="Planificador" component={PlanificadorScreen} />
          <Tab.Screen name="Horario" component={HorarioScreen} />
          <Tab.Screen name="Objetivos" component={ObjetivosScreen} />
          <Tab.Screen name="Finanzas" component={FinanzasScreen} />
          <Tab.Screen name="Ahorro" component={MetasAhorroScreen} />
          <Tab.Screen name="Páginas" component={PaginasScreen} />
          <Tab.Screen name="Proyectos" component={ProyectosScreen} />
        </Tab.Navigator>
      </NavigationContainer>
    </SidebarProvider>
  );
}

export default function App() {
  // Mismas familias que la web (dashboard/src/styles.css): "Outfit" para texto/UI, "Instrument
  // Serif" para títulos — ver src/theme.ts. Los cuatro pesos de Outfit cubren todo lo que los
  // estilos de las pantallas usan (regular/medium/semibold/bold); Instrument Serif solo tiene
  // variante regular (400) tal como la sirve Google Fonts.
  const [fontsLoaded] = useFonts({
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
    InstrumentSerif_400Regular,
  });

  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded) await SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider onLayout={onLayoutRootView}>
      <ThemeProvider>
        <AuthProvider>
          <Root />
          <ThemedStatusBar />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

// Iconos claros sobre fondo oscuro y viceversa — sin esto, un tema oscuro (Oscuro/Espresso, o
// "Sistema" con el dispositivo en oscuro) dejaría la hora/batería del sistema en negro sobre
// negro, ilegibles.
function ThemedStatusBar() {
  const { isDark } = useTheme();
  return <StatusBar style={isDark ? "light" : "dark"} />;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
});
