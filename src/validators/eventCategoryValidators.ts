import Joi from "joi";

// Misma paleta cerrada que calendarLegendValidators.ts (CALENDAR_COLORS) — se duplica en vez de
// importar entre dominios porque son conceptos distintos (categoría de evento vs. leyenda del
// calendario anual) que solo comparten los tokens de color del diseño, no la tabla.
export const EVENT_CATEGORY_COLORS = ["primary", "secondary", "habit", "hobby", "positive", "negative", "warning", "muted"] as const;

export const idParamSchema = Joi.object({
  id: Joi.number().integer().positive().required(),
});

export const createEventCategorySchema = Joi.object({
  label: Joi.string().min(1).max(60).required(),
  color: Joi.string()
    .valid(...EVENT_CATEGORY_COLORS)
    .required(),
}).options({ stripUnknown: true });

export const updateEventCategorySchema = Joi.object({
  label: Joi.string().min(1).max(60),
  color: Joi.string().valid(...EVENT_CATEGORY_COLORS),
  order: Joi.number().integer().min(0),
}).min(1);
