import { useCallback, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { G, Circle } from "react-native-svg";
import { useFocusEffect } from "@react-navigation/native";
import { listGoals, Goal } from "../api/goals";
import { colors, fonts, radius } from "../theme";

// Colores que se leen bien sobre la tarjeta bg-primary (sage) del progreso de objetivos — mismo
// criterio que dashboard/src/components/GoalsDonutChart.tsx (evita primary/positive, que son el
// mismo sage y se camuflarían), traducido a los tokens RGB de theme.ts.
const GOALS_DONUT_PALETTE = [colors.primaryForeground, colors.hobby, colors.secondary, colors.warning];

// Más pequeño que un donut "de cartel": va al lado de la lista de objetivos, no tiene toda la
// tarjeta para él solo — mismas medidas que la web.
const SIZE = 108;
const CENTER = SIZE / 2;
const RADIUS = 40;
const STROKE = 13;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function percentOf(goal: Goal): number {
  return goal.targetValue > 0 ? Math.min(100, Math.round((goal.currentValue / goal.targetValue) * 100)) : 0;
}

/** Puerto de dashboard/src/components/GoalsDonutChart.tsx: cada objetivo ocupa un arco fijo a
 * partes iguales del anillo — el color identifica de qué objetivo se trata (ver leyenda al lado)
 * y lo relleno de ese arco es el propio % de progreso del objetivo. */
function GoalsDonutChart({ goals, overallPercent }: { goals: Goal[]; overallPercent: number }) {
  const n = goals.length;
  if (n === 0) return null;

  const gapDeg = n > 1 ? 6 : 0;
  const segDeg = 360 / n - gapDeg;

  return (
    <View style={styles.donutWrap}>
      <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {/* rotamos -90° para que el primer arco empiece arriba (12h) en vez de a la derecha (3h) */}
        <G rotation={-90} originX={CENTER} originY={CENTER}>
          {goals.map((goal, i) => {
            const percent = percentOf(goal);
            const startDeg = i * (360 / n);
            const trackLen = (CIRCUMFERENCE * segDeg) / 360;
            const fillLen = trackLen * (percent / 100);
            const dashOffset = -((CIRCUMFERENCE * startDeg) / 360);
            const color = GOALS_DONUT_PALETTE[i % GOALS_DONUT_PALETTE.length];

            return (
              <G key={goal.id}>
                {/* pista: el espacio completo del objetivo, tenue */}
                <Circle
                  cx={CENTER}
                  cy={CENTER}
                  r={RADIUS}
                  fill="none"
                  stroke={color}
                  strokeOpacity={0.25}
                  strokeWidth={STROKE}
                  strokeDasharray={`${trackLen} ${CIRCUMFERENCE - trackLen}`}
                  strokeDashoffset={dashOffset}
                  strokeLinecap="round"
                />
                {/* relleno: la parte de ese espacio ya completada */}
                <Circle
                  cx={CENTER}
                  cy={CENTER}
                  r={RADIUS}
                  fill="none"
                  stroke={color}
                  strokeWidth={STROKE}
                  strokeDasharray={`${fillLen} ${CIRCUMFERENCE - fillLen}`}
                  strokeDashoffset={dashOffset}
                  strokeLinecap="round"
                />
              </G>
            );
          })}
        </G>
      </Svg>
      <View style={styles.donutCenter} pointerEvents="none">
        <Text style={styles.donutPercent}>{overallPercent}%</Text>
        <Text style={styles.donutLabel}>en total</Text>
      </View>
    </View>
  );
}

/** Puerto de la función GoalsProgressCard definida dentro de dashboard/src/pages/AgendaPage.tsx.
 * A diferencia de Hábitos/Notas, Objetivos NO pasa por SQLite (ver api/goals.ts: no forma parte
 * del contrato de sync offline), así que este componente hace su propia llamada REST y necesita
 * conexión, igual que MetasPage/ObjetivosScreen.
 *
 * useFocusEffect (no un useEffect de montaje único): Agenda y Objetivos son pestañas hermanas del
 * mismo Tab.Navigator (ver App.tsx), así que esta tarjeta se queda montada de fondo mientras el
 * usuario registra progreso en Objetivos — sin recargar al recuperar el foco, se quedaba con los
 * datos de la primera vez que se montó Agenda hasta reiniciar la app entera. Mismo patrón que ya
 * usa ObjetivosScreen.tsx para su propio listGoals. */
export function GoalsProgressCard() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loaded, setLoaded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      listGoals("active")
        .then(setGoals)
        .catch(() => setGoals([]))
        .finally(() => setLoaded(true));
    }, [])
  );

  if (!loaded) return null;

  const overall = goals.length > 0 ? Math.round(goals.reduce((sum, g) => sum + percentOf(g), 0) / goals.length) : 0;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Progreso de objetivos</Text>
      {goals.length === 0 ? (
        <Text style={styles.emptyText}>No tienes objetivos activos.</Text>
      ) : (
        <View style={styles.row}>
          <GoalsDonutChart goals={goals} overallPercent={overall} />
          <View style={styles.legend}>
            {goals.map((goal, i) => (
              <View key={goal.id} style={styles.legendRow}>
                <View style={[styles.legendDot, { backgroundColor: GOALS_DONUT_PALETTE[i % GOALS_DONUT_PALETTE.length] }]} />
                <Text style={styles.legendText} numberOfLines={1}>
                  {goal.title}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // rounded-3xl bg-primary p-8 text-primary-foreground de la web.
  card: {
    borderRadius: radius.card,
    backgroundColor: colors.primary,
    padding: 32,
  },
  title: {
    fontFamily: fonts.sansBold,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: colors.primaryForeground,
    opacity: 0.6,
    marginBottom: 24,
  },
  emptyText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.primaryForeground,
    opacity: 0.8,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 16 },
  donutWrap: { width: SIZE, height: SIZE, alignItems: "center", justifyContent: "center" },
  donutCenter: { position: "absolute", alignItems: "center", justifyContent: "center" },
  donutPercent: { fontFamily: fonts.serif, fontSize: 24, color: colors.primaryForeground },
  donutLabel: {
    fontFamily: fonts.sans,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: colors.primaryForeground,
    opacity: 0.6,
  },
  legend: { flex: 1, minWidth: 0, gap: 8 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 },
  legendDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  legendText: { flex: 1, minWidth: 0, fontFamily: fonts.sans, fontSize: 12, color: colors.primaryForeground, opacity: 0.8 },
});
