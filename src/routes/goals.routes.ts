import { Router } from "express";
import * as goalsController from "../controllers/goalsController";
import { authMiddleware } from "../middlewares/authMiddleware";
import { validate } from "../middlewares/validation";
import {
  idParamSchema,
  listGoalsQuerySchema,
  createGoalSchema,
  updateGoalSchema,
  registerProgressSchema,
  progressParamSchema,
  updateProgressSchema,
} from "../validators/goalsValidators";

const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /goals:
 *   get:
 *     tags: [Goals]
 *     summary: Lista metas del usuario
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, completed, expired, all], default: active }
 *     responses:
 *       200: { description: Lista de metas }
 *   post:
 *     tags: [Goals]
 *     summary: Crear meta
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Meta creada }
 */
router.get("/", validate(listGoalsQuerySchema, "query"), goalsController.listGoals);
router.post("/", validate(createGoalSchema), goalsController.createGoal);

/**
 * @openapi
 * /goals/{id}:
 *   get:
 *     tags: [Goals]
 *     summary: Detalle de una meta + progreso
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Meta con histórico de progreso }
 *       404: { description: Meta no encontrada }
 *   put:
 *     tags: [Goals]
 *     summary: Editar meta
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Meta actualizada }
 *   delete:
 *     tags: [Goals]
 *     summary: Eliminar meta
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Meta eliminada }
 */
router.get("/:id", validate(idParamSchema, "params"), goalsController.getGoal);
router.put(
  "/:id",
  validate(idParamSchema, "params"),
  validate(updateGoalSchema),
  goalsController.updateGoal
);
router.delete("/:id", validate(idParamSchema, "params"), goalsController.deleteGoal);

/**
 * @openapi
 * /goals/{id}/progress:
 *   post:
 *     tags: [Goals]
 *     summary: Registrar progreso de una meta
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Progreso registrado, incluye si se completó la meta }
 */
router.post(
  "/:id/progress",
  validate(idParamSchema, "params"),
  validate(registerProgressSchema),
  goalsController.registerProgress
);

/**
 * @openapi
 * /goals/{id}/progress/{progressId}:
 *   put:
 *     tags: [Goals]
 *     summary: Editar un registro de progreso (reajusta currentValue/completed de la meta)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Registro y meta actualizados }
 *   delete:
 *     tags: [Goals]
 *     summary: Eliminar un registro de progreso (revierte currentValue/completed de la meta)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Registro eliminado }
 */
router.put(
  "/:id/progress/:progressId",
  validate(progressParamSchema, "params"),
  validate(updateProgressSchema),
  goalsController.updateProgress
);
router.delete(
  "/:id/progress/:progressId",
  validate(progressParamSchema, "params"),
  goalsController.deleteProgress
);

/**
 * @openapi
 * /goals/{id}/analytics:
 *   get:
 *     tags: [Goals]
 *     summary: Estadísticas de racha y % completado de una meta
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Analytics de la meta }
 */
router.get("/:id/analytics", validate(idParamSchema, "params"), goalsController.getAnalytics);

export default router;
