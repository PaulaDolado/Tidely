import { Router } from "express";
import * as financeController from "../controllers/financeController";
import { authMiddleware } from "../middlewares/authMiddleware";
import { validate } from "../middlewares/validation";
import {
  idParamSchema,
  monthYearParamSchema,
  yearParamSchema,
  listTransactionsQuerySchema,
  exportTransactionsQuerySchema,
  createTransactionSchema,
  updateTransactionSchema,
  createSavingsGoalSchema,
  listSavingsGoalsQuerySchema,
  contributeSchema,
  analyticsQuerySchema,
} from "../validators/financeValidators";

const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /finance/balance/{month}/{year}:
 *   get:
 *     tags: [Finance]
 *     summary: Balance del mes (ingresos - gastos)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Balance mensual }
 */
router.get(
  "/balance/:month/:year",
  validate(monthYearParamSchema, "params"),
  financeController.getMonthlyBalance
);

/**
 * @openapi
 * /finance/surplus/{month}/{year}:
 *   get:
 *     tags: [Finance]
 *     summary: Sobrante disponible acumulado en meses anteriores al indicado, sin contar lo ya comprometido en metas de ahorro
 *     description: Para el dashboard de ahorro — "si quedan ingresos de meses anteriores tras quitar los gastos de ese mismo mes". El mes/año de la URL queda FUERA del cálculo (normalmente se pasa el mes en curso, que aún puede sumar gastos).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ month, year, totalBalance, committedToGoals, availableSurplus }" }
 */
router.get(
  "/surplus/:month/:year",
  validate(monthYearParamSchema, "params"),
  financeController.getAvailableSurplus
);

/**
 * @openapi
 * /finance/balance/year/{year}:
 *   get:
 *     tags: [Finance]
 *     summary: Balance anual con desglose mensual
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Balance anual }
 */
router.get("/balance/year/:year", validate(yearParamSchema, "params"), financeController.getAnnualBalance);

/**
 * @openapi
 * /finance/transactions:
 *   get:
 *     tags: [Finance]
 *     summary: Historial de transacciones (filtrable)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [income, expense] }
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200: { description: Lista paginada de transacciones }
 *   post:
 *     tags: [Finance]
 *     summary: Registrar ingreso/gasto
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Transacción creada }
 */
router.get(
  "/transactions",
  validate(listTransactionsQuerySchema, "query"),
  financeController.listTransactions
);
router.post("/transactions", validate(createTransactionSchema), financeController.createTransaction);

/**
 * @openapi
 * /finance/transactions/export:
 *   get:
 *     tags: [Finance]
 *     summary: Todas las transacciones de un rango de fechas, sin paginar (para exportar)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: from
 *         required: true
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         required: true
 *         schema: { type: string, format: date }
 *     responses:
 *       200: { description: "{ transactions: [...] }, ordenadas por fecha ascendente" }
 */
router.get(
  "/transactions/export",
  validate(exportTransactionsQuerySchema, "query"),
  financeController.exportTransactions
);

/**
 * @openapi
 * /finance/transactions/{id}:
 *   put:
 *     tags: [Finance]
 *     summary: Editar transacción
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Transacción actualizada }
 *   delete:
 *     tags: [Finance]
 *     summary: Eliminar transacción
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Transacción eliminada }
 */
router.put(
  "/transactions/:id",
  validate(idParamSchema, "params"),
  validate(updateTransactionSchema),
  financeController.updateTransaction
);
router.delete(
  "/transactions/:id",
  validate(idParamSchema, "params"),
  financeController.deleteTransaction
);

/**
 * @openapi
 * /finance/savings-goals:
 *   get:
 *     tags: [Finance]
 *     summary: Metas de ahorro con progreso calculado
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Lista de metas de ahorro }
 *   post:
 *     tags: [Finance]
 *     summary: Crear meta de ahorro
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Meta de ahorro creada }
 */
router.get(
  "/savings-goals",
  validate(listSavingsGoalsQuerySchema, "query"),
  financeController.listSavingsGoals
);
router.post(
  "/savings-goals",
  validate(createSavingsGoalSchema),
  financeController.createSavingsGoal
);

/**
 * @openapi
 * /finance/savings-goals/{id}:
 *   delete:
 *     tags: [Finance]
 *     summary: Eliminar meta de ahorro
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Meta de ahorro eliminada }
 */
router.delete(
  "/savings-goals/:id",
  validate(idParamSchema, "params"),
  financeController.deleteSavingsGoal
);

/**
 * @openapi
 * /finance/savings-goals/{id}/contribute:
 *   post:
 *     tags: [Finance]
 *     summary: Asignar (o retirar) dinero a una meta de ahorro por "casillas"
 *     description: Crea una transacción real (income si amount>0, expense si amount<0) etiquetada con la categoría de la meta. Pensado para el grid de casillas del dashboard — cada clic llama este endpoint con ±stepAmount.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount]
 *             properties:
 *               amount: { type: number, description: "Positivo para aportar, negativo para retirar/corregir" }
 *     responses:
 *       201: { description: Meta de ahorro con currentAmount/progressPercent actualizados }
 */
router.post(
  "/savings-goals/:id/contribute",
  validate(idParamSchema, "params"),
  validate(contributeSchema),
  financeController.contributeToSavingsGoal
);

/**
 * @openapi
 * /finance/analytics:
 *   get:
 *     tags: [Finance]
 *     summary: Top 5 categorías de gasto, tendencia mensual y proyección anual
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: month
 *         schema: { type: integer }
 *       - in: query
 *         name: year
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Analytics financieros }
 */
router.get("/analytics", validate(analyticsQuerySchema, "query"), financeController.getAnalytics);

export default router;
