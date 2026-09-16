import { Goal } from "../types";

// Colores que se leen bien sobre la tarjeta bg-solid-card (sage, o el azul apagado propio de
// "Oscuro"/"Sistema" oscuro — ver --solid-card en styles.css) del progreso de objetivos —
// evitamos "primary"/"positive" (son el mismo sage, se camuflarían) y ciclamos si hay más
// objetivos que colores.
export const GOALS_DONUT_PALETTE = ["var(--solid-card-foreground)", "var(--hobby)", "var(--sand)", "var(--warning)"];

// Más pequeño que un donut "de cartel": va al lado de la lista de objetivos dentro de una
// tarjeta estrecha (la barra lateral de Agenda), no tiene toda la tarjeta para él solo.
const SIZE = 108;
const CENTER = SIZE / 2;
const RADIUS = 40;
const STROKE = 13;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function percentOf(goal: Goal): number {
  return goal.targetValue > 0 ? Math.min(100, Math.round((goal.currentValue / goal.targetValue) * 100)) : 0;
}

/**
 * Donut de progreso de objetivos: en vez de una barra por objetivo, cada uno ocupa un espacio
 * (arco) fijo a partes iguales del anillo — el color identifica de qué objetivo se trata (ver
 * leyenda debajo, en AgendaPage) y lo relleno de ese arco es el propio % de progreso del objetivo.
 */
export function GoalsDonutChart({ goals, overallPercent }: { goals: Goal[]; overallPercent: number }) {
  const n = goals.length;
  if (n === 0) return null;

  const gapDeg = n > 1 ? 6 : 0;
  const segDeg = 360 / n - gapDeg;

  return (
    <div className="relative mx-auto" style={{ width: SIZE, height: SIZE }}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE}>
        {/* rotamos -90° para que el primer arco empiece arriba (12h) en vez de a la derecha (3h) */}
        <g transform={`rotate(-90 ${CENTER} ${CENTER})`}>
          {goals.map((goal, i) => {
            const percent = percentOf(goal);
            const startDeg = i * (360 / n);
            const trackLen = (CIRCUMFERENCE * segDeg) / 360;
            const fillLen = trackLen * (percent / 100);
            const dashOffset = -((CIRCUMFERENCE * startDeg) / 360);
            const color = GOALS_DONUT_PALETTE[i % GOALS_DONUT_PALETTE.length];

            return (
              <g key={goal.id}>
                {/* pista: el espacio completo del objetivo, tenue */}
                <circle
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
                <circle
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
              </g>
            );
          })}
        </g>
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-serif text-2xl">{overallPercent}%</span>
        <span className="text-[10px] uppercase tracking-widest opacity-60">en total</span>
      </div>
    </div>
  );
}
