import { Router } from "express";
import * as googleCalendarController from "../controllers/googleCalendarController";
import { authMiddleware } from "../middlewares/authMiddleware";
import { validate } from "../middlewares/validation";
import { connectQuerySchema, oauthCallbackQuerySchema } from "../validators/googleCalendarValidators";

const router = Router();

// A diferencia del resto de routers (que hacen `router.use(authMiddleware)` una vez arriba, ver
// agenda.routes.ts), aquí NO se puede aplicar globalmente: /callback lo abre el propio navegador
// redirigido por Google, sin nuestra cabecera Authorization — necesita quedar público. El resto
// de rutas sí llevan authMiddleware individualmente.

/**
 * @openapi
 * /integrations/google/status:
 *   get:
 *     tags: [Integraciones]
 *     summary: Estado de la conexión con Google Calendar del usuario (conectado, email, última sincronización)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ connected, email?, lastSyncedAt? }" }
 */
router.get("/status", authMiddleware, googleCalendarController.getStatus);

/**
 * @openapi
 * /integrations/google/connect:
 *   get:
 *     tags: [Integraciones]
 *     summary: URL de consentimiento de Google a la que redirigir el navegador completo (no un fetch)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: client
 *         required: false
 *         schema: { type: string, enum: [web, mobile], default: web }
 *         description: "mobile: al terminar el consentimiento el callback redirige al deep link de la app (tidely://google?status=connected|error) en vez de al dashboard web"
 *     responses:
 *       200: { description: "{ url }" }
 *       400: { description: Integración no configurada en el servidor, o valor de client no permitido }
 */
router.get("/connect", authMiddleware, validate(connectQuerySchema, "query"), googleCalendarController.getConnectUrl);

/**
 * @openapi
 * /integrations/google/callback:
 *   get:
 *     tags: [Integraciones]
 *     summary: Callback OAuth de Google (ruta pública, la abre el propio navegador redirigido por Google)
 *     responses:
 *       302: { description: "Redirige de vuelta al dashboard con ?google=connected o ?google=error; si el flujo se inició con client=mobile, al deep link tidely://google?status=connected o ?status=error" }
 */
router.get("/callback", validate(oauthCallbackQuerySchema, "query"), googleCalendarController.handleCallback);

/**
 * @openapi
 * /integrations/google/sync:
 *   post:
 *     tags: [Integraciones]
 *     summary: Sincroniza ahora los eventos de Google Calendar (import, update y borrado de lo ya no presente)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ imported, updated, removed }" }
 *       404: { description: No hay ninguna cuenta de Google Calendar conectada }
 */
router.post("/sync", authMiddleware, googleCalendarController.sync);

/**
 * @openapi
 * /integrations/google/disconnect:
 *   delete:
 *     tags: [Integraciones]
 *     summary: Desconecta Google Calendar y borra los eventos que se habían importado de él
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ disconnected: true }" }
 */
router.delete("/disconnect", authMiddleware, googleCalendarController.disconnect);

export default router;
