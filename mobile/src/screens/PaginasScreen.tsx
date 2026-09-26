import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { colors, fonts } from "../theme";
import { PaginasListScreen } from "./PaginasListScreen";
import { PaginaDetailScreen } from "./PaginaDetailScreen";

// "Páginas" es la única pestaña que necesita drill-down (lista → detalle de una página), así que
// es la única que monta su propia pila (`native-stack`, ya usado en Fase 1 antes de pasar a
// pestañas) anidada dentro de la pestaña — patrón estándar de React Navigation para esto. El resto
// de pestañas son pantallas planas sin esta necesidad.
export type PaginasStackParamList = {
  Lista: undefined;
  Detalle: { id: string; title: string };
};

const Stack = createNativeStackNavigator<PaginasStackParamList>();

export function PaginasScreen() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Lista" component={PaginasListScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="Detalle"
        component={PaginaDetailScreen}
        options={({ route }) => ({
          title: route.params.title,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
          headerTitleStyle: { fontFamily: fonts.sansSemiBold },
          headerShadowVisible: false,
          // Sin flecha de volver: tanto Galería como "+ Nueva página" abren este detalle
          // directamente desde el menú lateral (sin pasar antes por "Lista"), así que la flecha
          // ahí siempre volvía a "Hoy" (la pestaña activa al abrirlo), no a ningún sitio
          // relacionado con la propia página — más confuso que útil. Para las páginas SÍ abiertas
          // desde "Lista" (tocando una en el listado), el menú lateral y la pestaña "Páginas" de
          // la barra inferior siguen sirviendo para volver. `headerBackVisible: false`, no
          // `headerLeft: () => null`: en native-stack solo la primera oculta de verdad la flecha
          // nativa — con `headerLeft` a secas, la flecha por defecto de Android seguía apareciendo
          // (y quedando tapada bajo el clip flotante del menú, el mismo problema que ya arregló
          // DetailBackButton en Proyectos).
          headerBackVisible: false,
        })}
      />
    </Stack.Navigator>
  );
}
