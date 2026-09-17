import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { colors, fonts } from "../theme";
import { PaginasListScreen } from "./PaginasListScreen";
import { PaginaDetailScreen } from "./PaginaDetailScreen";
import { DetailBackButton } from "../components/DetailBackButton";

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
        options={({ route, navigation }) => ({
          title: route.params.title,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
          headerTitleStyle: { fontFamily: fonts.sansSemiBold },
          headerShadowVisible: false,
          // Flecha de volver custom, no la nativa por defecto: con el menú lateral colapsado, esa
          // flecha caía justo debajo del clip flotante (ver DetailBackButton.tsx).
          headerLeft: () => <DetailBackButton onPress={() => navigation.goBack()} />,
        })}
      />
    </Stack.Navigator>
  );
}
