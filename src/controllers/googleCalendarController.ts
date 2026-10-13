import { Response, NextFunction, Request } from "express";
import { AuthRequest } from "../middlewares/authMiddleware";
import { env } from "../config/environment";
import { logger } from "../utils/logger";
import { getGoogleOAuthStateClient } from "../utils/jwt";
import * as googleCalendarService from "../services/googleCalendarService";

export async function getStatus(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const status = await googleCalendarService.getStatus(userId);
    res.json(status);
  } catch (error) {
    next(error);
  }
}

export async function getConnectUrl(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    // Lista cerrada: solo el literal "mobile" cuenta (el schema ya rechaza cualquier otro valor).
    const client = req.query.client === "mobile" ? "mobile" : "web";
    const url = googleCalendarService.getAuthUrl(userId, client);
    res.json({ url });
  } catch (error) {
    next(error);
  }
}

// Deep link de la app móvil (scheme "tidely" en mobile/app.json). Constante fija a propósito: el
// destino NUNCA se construye a partir de nada que venga de la query (sin open redirect) — lo único
// que decide web vs. móvil es el campo firmado dentro de `state`.
const MOBILE_REDIRECT_BASE = "tidely://google";

/**
 * Ruta PÚBLICA (sin authMiddleware, ver googleCalendar.routes): el navegador llega aquí
 * redirigido directamente por Google tras el consentimiento, no como un fetch autenticado de la
 * SPA. Por eso no responde JSON — redirige de vuelta al cliente que inició el flujo:
 *  - web (por defecto): al dashboard (que no tiene router real, ver App.tsx) con `?google=connected`
 *    o `?google=error` en la query, para que AgendaPage lo recoja;
 *  - móvil (state firmado con client="mobile"): al deep link `tidely://google?status=connected|error`,
 *    que reabre la app. Si el state no verifica (caducado/manipulado) no sabemos quién es: web.
 */
export async function handleCallback(req: Request, res: Response): Promise<void> {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
  const redirectBase = env.cors.origin === "*" ? "http://localhost:5173" : env.cors.origin;
  // También cuando Google devuelve `error` (el usuario deniega): la app móvil debe recuperar el foco.
  const isMobile = getGoogleOAuthStateClient(state) === "mobile";
  const redirectTo = (ok: boolean): void => {
    if (isMobile) {
      res.redirect(`${MOBILE_REDIRECT_BASE}?status=${ok ? "connected" : "error"}`);
    } else {
      res.redirect(`${redirectBase}/?google=${ok ? "connected" : "error"}`);
    }
  };

  if (error || !code || !state) {
    redirectTo(false);
    return;
  }

  try {
    await googleCalendarService.handleOAuthCallback(code, state);
    redirectTo(true);
  } catch (err) {
    logger.error("googleCalendarController.handleCallback: fallo procesando el callback de Google", { error: err });
    redirectTo(false);
  }
}

export async function sync(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const result = await googleCalendarService.syncEvents(userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function disconnect(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    await googleCalendarService.disconnect(userId);
    res.json({ disconnected: true });
  } catch (error) {
    next(error);
  }
}
