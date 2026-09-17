import Joi from "joi";

const TRANSACTION_TYPES = ["income", "expense"];
const SAVINGS_GOAL_TYPES = ["ahorro", "inversion"];

export const idParamSchema = Joi.object({
  id: Joi.number().integer().positive().required(),
});

export const monthYearParamSchema = Joi.object({
  month: Joi.number().integer().min(1).max(12).required(),
  year: Joi.number().integer().min(2000).max(2100).required(),
});

export const yearParamSchema = Joi.object({
  year: Joi.number().integer().min(2000).max(2100).required(),
});

export const listTransactionsQuerySchema = Joi.object({
  type: Joi.string().valid(...TRANSACTION_TYPES),
  category: Joi.string().max(50),
  from: Joi.date().iso(),
  to: Joi.date().iso(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

// A diferencia de listTransactionsQuerySchema: `from`/`to` obligatorios (exportar "todo" sin
// rango no tiene sentido) y sin paginación — un export tiene que traer TODAS las transacciones
// del rango, no una página de 100 (ver financeService.exportTransactions).
export const exportTransactionsQuerySchema = Joi.object({
  from: Joi.date().iso().required(),
  to: Joi.date().iso().required(),
});

export const createTransactionSchema = Joi.object({
  type: Joi.string()
    .valid(...TRANSACTION_TYPES)
    .required(),
  amount: Joi.number().positive().precision(2).required(),
  category: Joi.string().min(1).max(50).required(),
  description: Joi.string().max(500).allow(null, ""),
  date: Joi.date().iso(),
}).options({ stripUnknown: true });

export const updateTransactionSchema = Joi.object({
  type: Joi.string().valid(...TRANSACTION_TYPES),
  amount: Joi.number().positive().precision(2),
  category: Joi.string().min(1).max(50),
  description: Joi.string().max(500).allow(null, ""),
  date: Joi.date().iso(),
}).min(1);

export const listSavingsGoalsQuerySchema = Joi.object({
  type: Joi.string().valid(...SAVINGS_GOAL_TYPES),
});

export const createSavingsGoalSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  type: Joi.string()
    .valid(...SAVINGS_GOAL_TYPES)
    .default("ahorro"),
  targetAmount: Joi.number().positive().precision(2).required(),
  category: Joi.string().min(1).max(50).required(),
  // Valor de cada "casilla" en la vista de progreso (ej. 100€ por casilla).
  stepAmount: Joi.number().positive().precision(2).default(100),
  deadline: Joi.date().iso().allow(null),
}).options({ stripUnknown: true });

export const updateSavingsGoalSchema = Joi.object({
  name: Joi.string().min(1).max(100),
  type: Joi.string().valid(...SAVINGS_GOAL_TYPES),
  targetAmount: Joi.number().positive().precision(2),
  category: Joi.string().min(1).max(50),
  stepAmount: Joi.number().positive().precision(2),
  deadline: Joi.date().iso().allow(null),
}).min(1);

export const contributeSchema = Joi.object({
  // Positivo: aporta a la meta (crea un income). Negativo: retira/corrige (crea un expense).
  amount: Joi.number().precision(2).invalid(0).required().messages({
    "any.invalid": "amount no puede ser 0",
  }),
});

export const analyticsQuerySchema = Joi.object({
  month: Joi.number().integer().min(1).max(12),
  year: Joi.number().integer().min(2000).max(2100),
});
