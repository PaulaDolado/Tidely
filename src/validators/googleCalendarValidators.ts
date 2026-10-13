import Joi from "joi";

// El callback lo dispara el propio Google redirigiendo el navegador — si el usuario deniega el
// consentimiento, Google añade `error` en vez de `code`/`state` (ver googleCalendarController).
export const oauthCallbackQuerySchema = Joi.object({
  code: Joi.string(),
  state: Joi.string(),
  error: Joi.string(),
}).options({ stripUnknown: true, allowUnknown: true });

// `client` (opcional) dice a qué cliente volver tras el consentimiento: la app móvil manda
// "mobile" para que el callback la devuelva por deep link en vez de al dashboard web. Lista
// cerrada a propósito — nunca se acepta una URL ni un valor libre del cliente.
export const connectQuerySchema = Joi.object({
  client: Joi.string().valid("web", "mobile"),
}).options({ stripUnknown: true, allowUnknown: true });
