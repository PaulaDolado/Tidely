import { Router } from "express";
import * as customPagesController from "../controllers/customPagesController";
import { authMiddleware } from "../middlewares/authMiddleware";
import { validate } from "../middlewares/validation";
import {
  idParamSchema,
  createCustomPageSchema,
  updateCustomPageSchema,
  moveCustomPageSchema,
} from "../validators/customPagesValidators";

const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /custom-pages:
 *   get:
 *     tags: [CustomPages]
 *     summary: Lista las páginas personalizadas del usuario (menú "+ Nueva página"), ordenadas
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ pages: [...] }, sin `content` (ver GET /custom-pages/{id})" }
 *   post:
 *     tags: [CustomPages]
 *     summary: Crea una página nueva a partir de un modelo (nota, kanban, galeria, finanzas, proyectos, objetivos, agenda, hoy o viajes)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Página creada, con el contenido inicial de su modelo }
 */
router.get("/", customPagesController.listCustomPages);
router.post("/", validate(createCustomPageSchema), customPagesController.createCustomPage);

/**
 * @openapi
 * /custom-pages/{id}:
 *   get:
 *     tags: [CustomPages]
 *     summary: Detalle de una página personalizada, con su contenido completo
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Página con contenido }
 *   put:
 *     tags: [CustomPages]
 *     summary: Edita el nombre, el contenido y/o el orden de una página personalizada
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Página actualizada }
 *   delete:
 *     tags: [CustomPages]
 *     summary: Elimina una página personalizada
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Página eliminada }
 */
router.get("/:id", validate(idParamSchema, "params"), customPagesController.getCustomPage);
router.put(
  "/:id",
  validate(idParamSchema, "params"),
  validate(updateCustomPageSchema),
  customPagesController.updateCustomPage
);
router.delete("/:id", validate(idParamSchema, "params"), customPagesController.deleteCustomPage);

/**
 * @openapi
 * /custom-pages/{id}/move:
 *   put:
 *     tags: [CustomPages]
 *     summary: Sube o baja una página un puesto en el menú (intercambia su orden con la vecina)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Página movida (no-op si ya está en el extremo) }
 */
router.put("/:id/move", validate(idParamSchema, "params"), validate(moveCustomPageSchema), customPagesController.moveCustomPage);

export default router;
