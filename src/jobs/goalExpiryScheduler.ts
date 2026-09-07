import cron, { ScheduledTask } from "node-cron";
import { processExpiredGoals } from "../services/goalExpiryService";
import { logger } from "../utils/logger";

const CRON_EXPRESSION = "0 * * * *"; // cada hora en punto — los periodos son semanales/mensuales/anuales, no hace falta más frecuencia

/**
 * Arranca el cron de expiración/renovación de metas. Igual que `notificationScheduler`,
 * se llama solo desde `src/index.ts`, nunca desde `app.ts` (para que los tests de
 * integración, que importan `app.ts`, no levanten un cron de fondo).
 */
export function startGoalExpiryScheduler(): ScheduledTask {
  logger.info(`♻️  Scheduler de expiración de metas activo (${CRON_EXPRESSION})`);
  return cron.schedule(CRON_EXPRESSION, () => {
    processExpiredGoals().catch((error) => {
      logger.error("goalExpiryScheduler: fallo en processExpiredGoals", { error });
    });
  });
}
