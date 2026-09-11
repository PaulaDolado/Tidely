import { Router } from "express";
import * as eventCategoryController from "../controllers/eventCategoryController";
import { authMiddleware } from "../middlewares/authMiddleware";
import { validate } from "../middlewares/validation";
import { idParamSchema, createEventCategorySchema, updateEventCategorySchema } from "../validators/eventCategoryValidators";

const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /event-categories:
 *   get:
 *     tags: [EventCategories]
 *     summary: Lista las categorías de evento de la cuenta (ver Agenda > + Nuevo evento)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ categories: [...] }" }
 *   post:
 *     tags: [EventCategories]
 *     summary: Crea una categoría de evento (nombre + color de la paleta de la app)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Categoría creada }
 */
router.get("/", eventCategoryController.listCategories);
router.post("/", validate(createEventCategorySchema), eventCategoryController.createCategory);

/**
 * @openapi
 * /event-categories/{id}:
 *   put:
 *     tags: [EventCategories]
 *     summary: Edita el nombre, color o el orden de una categoría de evento
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Categoría actualizada }
 *   delete:
 *     tags: [EventCategories]
 *     summary: Elimina una categoría de evento (los eventos que la usaban se quedan sin categoría)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Categoría eliminada }
 */
router.put("/:id", validate(idParamSchema, "params"), validate(updateEventCategorySchema), eventCategoryController.updateCategory);
router.delete("/:id", validate(idParamSchema, "params"), eventCategoryController.deleteCategory);

export default router;
