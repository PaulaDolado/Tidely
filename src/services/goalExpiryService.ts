import { prisma } from "../config/database";
import { defaultPeriodEnd, GoalPeriod } from "./goalsService";
import { logger } from "../utils/logger";

/**
 * Archiva las metas cuyo `periodEnd` ya pasó (`expired = true`, para que dejen de contar
 * como "activas" en `GET /goals?status=active`) y, si tienen `autoRenew` (default true),
 * crea automáticamente la meta del siguiente periodo con los mismos datos y progreso en
 * cero — así "Ejercicio 5 días" no hay que recrearla a mano cada semana.
 *
 * Idempotente: una vez una meta queda `expired = true`, el filtro `where` ya no la vuelve
 * a traer, así que correr esto varias veces no duplica renovaciones.
 */
export async function processExpiredGoals(
  now: Date = new Date()
): Promise<{ archived: number; renewed: number }> {
  const expiredGoals = await prisma.goal.findMany({
    where: { periodEnd: { lt: now }, expired: false },
  });

  if (expiredGoals.length === 0) return { archived: 0, renewed: 0 };

  let renewed = 0;

  for (const goal of expiredGoals) {
    await prisma.goal.update({ where: { id: goal.id }, data: { expired: true } });

    if (goal.autoRenew) {
      const nextPeriodStart = goal.periodEnd;
      // El fin del nuevo periodo se calcula a partir de `now`, no de `nextPeriodStart`: si la
      // meta lleva mucho tiempo sin procesarse (p.ej. el scheduler estuvo caído varias semanas),
      // `nextPeriodStart` puede seguir muy en el pasado, y usarlo aquí generaría un periodo que
      // ya habría expirado en el momento de crearlo — rompiendo la idempotencia (la próxima
      // pasada volvería a archivar/renovar la meta recién creada). Usando `now` el periodo nuevo
      // siempre cubre el momento actual.
      const nextPeriodEnd = defaultPeriodEnd(goal.period as GoalPeriod, now);

      await prisma.goal.create({
        data: {
          userId: goal.userId,
          title: goal.title,
          description: goal.description,
          period: goal.period,
          targetValue: goal.targetValue,
          bonusPoints: goal.bonusPoints,
          autoRenew: goal.autoRenew,
          periodStart: nextPeriodStart,
          periodEnd: nextPeriodEnd,
        },
      });
      renewed += 1;
    }
  }

  logger.info(`processExpiredGoals: ${expiredGoals.length} archivada(s), ${renewed} renovada(s)`);
  return { archived: expiredGoals.length, renewed };
}
