import Joi from "joi";

export const idParamSchema = Joi.object({
  id: Joi.number().integer().positive().required(),
});

export const rowParamsSchema = Joi.object({
  id: Joi.number().integer().positive().required(),
  rowId: Joi.number().integer().positive().required(),
});

export const createScheduleSchema = Joi.object({
  name: Joi.string().min(1).max(60).required(),
}).options({ stripUnknown: true });

export const updateScheduleSchema = Joi.object({
  name: Joi.string().min(1).max(60),
  // Opcional: reordenar offline escribiendo un `order` fraccionario (ver syncService.ts / Fase
  // 2 de sync) en vez de pasar por POST /schedules/:id/move.
  order: Joi.number(),
})
  .min(1)
  .options({ stripUnknown: true });

// Texto libre por celda (asignatura, aula, lo que el usuario quiera escribir) — sin estructura
// forzada, tal como pidió: "ya agrego yo cada asignatura en cada espacio". Multilínea (ver
// ScheduleCell en el dashboard), de ahí el límite más generoso que un campo de una sola línea.
const CELL_MAX = 500;

export const addRowSchema = Joi.object({
  timeLabel: Joi.string().max(50).allow(""),
}).options({ stripUnknown: true });

export const updateRowSchema = Joi.object({
  timeLabel: Joi.string().max(50).allow(""),
  monday: Joi.string().max(CELL_MAX).allow(""),
  tuesday: Joi.string().max(CELL_MAX).allow(""),
  wednesday: Joi.string().max(CELL_MAX).allow(""),
  thursday: Joi.string().max(CELL_MAX).allow(""),
  friday: Joi.string().max(CELL_MAX).allow(""),
  // Ver comentario en updateScheduleSchema.order.
  order: Joi.number(),
}).min(1);

export const moveSchema = Joi.object({
  direction: Joi.string().valid("up", "down").required(),
});
