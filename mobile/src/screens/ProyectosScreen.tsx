import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { colors, fonts } from "../theme";
import { ProyectosListScreen } from "./ProyectosListScreen";
import { ProyectoDetailScreen } from "./ProyectoDetailScreen";
import { DetailBackButton } from "../components/DetailBackButton";

// "Proyectos" necesita drill-down (galería → cuaderno de un proyecto), así que monta su propia
// pila anidada dentro de la pestaña — mismo patrón que "Páginas" (ver PaginasScreen.tsx).
export type ProyectosStackParamList = {
  Lista: undefined;
  Detalle: { id: string; title: string };
};

const Stack = createNativeStackNavigator<ProyectosStackParamList>();

export function ProyectosScreen() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Lista" component={ProyectosListScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="Detalle"
        component={ProyectoDetailScreen}
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
