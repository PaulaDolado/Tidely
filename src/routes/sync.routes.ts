import { Router, Request, Response, NextFunction } from "express";
import * as syncController from "../controllers/syncController";
import { authMiddleware } from "../middlewares/authMiddleware";
import { validate } from "../middlewares/validation";
import { syncPullQuerySchema, syncPushSchema, validateSyncPushItems } from "../validators/syncValidators";
import { ValidationError } from "../utils/errorHandler";

const router = Router();

router.use(authMiddleware);

// Tras comprobar la forma del sobre, valida cada elemento por separado: los que no pasan quedan como
// `null` en el cuerpo y su fallo se le pasa al servicio (ver syncValidators.validateSyncPushItems).
// Un cliente que no pide `partialFailures` recibe un 400 como antes en cuanto uno no es válido.
function validatePushItems(req: Request, res: Response, next: NextFunction): void {
  const { body, failures } = validateSyncPushItems(req.body);
  if (!body.partialFailures && failures.length > 0) {
    next(new ValidationError(failures.map((f) => f.message).join("; ")));
    return;
  }
  req.body = body;
  res.locals.syncRejected = failures;
  next();
}

/**
 * @openapi
 * /sync/pull:
 *   get:
 *     tags: [Sync]
 *     summary: Descarga cambios (eventos, tareas, notas, hábitos...) desde `since` para el cliente offline
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: since
 *         schema: { type: string, format: date-time }
 *         description: Cursor ISO-8601 devuelto por el `pull` anterior (el propio `serverTime`). Sin `since`, bootstrap completo.
 *     responses:
 *       200: { description: Cambios desde el cursor, más un nuevo cursor `serverTime` y los tombstones de lo borrado }
 */
router.get("/pull", validate(syncPullQuerySchema, "query"), syncController.pull);

/**
 * @openapi
 * /sync/push:
 *   post:
 *     tags: [Sync]
 *     summary: Sube cambios hechos offline (creados, editados, borrados) y reconcilia con el servidor
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "Mapeo de localId→id para lo creado, conflictos (last-write-wins) para lo editado y `failures`: los elementos que no se han aplicado (no válidos o rechazados), con su sección e índice. Un elemento rechazado no impide aplicar los demás." }
 *       400: { description: El sobre no tiene la forma esperada (una sección que no es una lista, por ejemplo) }
 */
router.post("/push", validate(syncPushSchema), validatePushItems, syncController.push);

export default router;
