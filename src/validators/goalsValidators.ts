import Joi from "joi";
import { paginationQuerySchema } from "./pagination";

const PERIODS = ["weekly", "monthly", "annual"];

export const idParamSchema = Joi.object({
  id: Joi.number().integer().positive().required(),
});

export const listGoalsQuerySchema = Joi.object({
  status: Joi.string().valid("active", "completed", "expired", "all").default("active"),
}).concat(paginationQuerySchema);

export const createGoalSchema = Joi.object({
  title: Joi.string().min(1).max(200).required(),
  description: Joi.string().max(1000).allow(null, ""),
  period: Joi.string()
    .valid(...PERIODS)
    .required(),
  targetValue: Joi.number().integer().positive().required(),
  bonusPoints: Joi.number().integer().min(0).default(10),
  periodStart: Joi.date().iso(),
  periodEnd: Joi.date().iso().greater(Joi.ref("periodStart")).messages({
    "date.greater": "periodEnd debe ser posterior a periodStart",
  }),
  // Si es true (default), al terminar el periodo se crea sola la meta del siguiente.
  autoRenew: Joi.boolean().default(true),
}).options({ stripUnknown: true });

export const updateGoalSchema = Joi.object({
  title: Joi.string().min(1).max(200),
  description: Joi.string().max(1000).allow(null, ""),
  targetValue: Joi.number().integer().positive(),
  bonusPoints: Joi.number().integer().min(0),
  periodStart: Joi.date().iso(),
  periodEnd: Joi.date().iso(),
  autoRenew: Joi.boolean(),
}).min(1);

export const registerProgressSchema = Joi.object({
  value: Joi.number().integer().required(),
  note: Joi.string().max(500).allow(null, ""),
  date: Joi.date().iso(),
});
