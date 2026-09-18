import Joi from "joi";

const STATUSES = ["todo", "in_progress", "done"];
const PRIORITIES = ["low", "medium", "high"];
const MAX_TAGS = 10;
const FIELD_TYPES = ["text", "number", "date", "select"];
const MAX_FIELD_OPTIONS = 30;

export const idParamSchema = Joi.object({
  id: Joi.number().integer().positive().required(),
});

export const subtaskParamSchema = Joi.object({
  id: Joi.number().integer().positive().required(),
  subtaskId: Joi.number().integer().positive().required(),
});

export const fieldParamSchema = Joi.object({
  id: Joi.number().integer().positive().required(),
  fieldId: Joi.number().integer().positive().required(),
});

// Columnas personalizadas de UN planner (ver PlannerField) — `options` solo tiene sentido con
// type "select", pero se acepta igualmente con otros tipos y simplemente no se usa (más simple
// que forzar condicionalmente el esquema, y da igual si el cliente manda de más).
export const createFieldSchema = Joi.object({
  name: Joi.string().min(1).max(40).required(),
  type: Joi.string()
    .valid(...FIELD_TYPES)
    .required(),
  options: Joi.array().items(Joi.string().trim().min(1).max(40)).max(MAX_FIELD_OPTIONS),
}).options({ stripUnknown: true });

export const updateFieldSchema = Joi.object({
  name: Joi.string().min(1).max(40),
  options: Joi.array().items(Joi.string().trim().min(1).max(40)).max(MAX_FIELD_OPTIONS),
})
  .min(1)
  .options({ stripUnknown: true });

export const moveFieldSchema = Joi.object({
  direction: Joi.string().valid("up", "down").required(),
});

// Valores de las columnas personalizadas de una tarea: objeto plano { [fieldId]: valor }. La
// clave es el id (numérico) de un PlannerField como string de objeto JSON — no se valida contra
// los fields reales del planner aquí (eso obligaría a una consulta extra en cada guardado); un
// fieldId que ya no existe simplemente no se muestra en ningún sitio, sin romper nada.
const customFieldsSchema = Joi.object().pattern(
  Joi.string().pattern(/^\d+$/),
  Joi.alternatives().try(Joi.string().max(500).allow(""), Joi.number(), Joi.valid(null))
);

// Varios tableros de planificador con nombre propio — mismo patrón que Schedule (Horario), ver
// scheduleValidators.ts.
export const createPlannerSchema = Joi.object({
  name: Joi.string().min(1).max(60).required(),
}).options({ stripUnknown: true });

export const updatePlannerSchema = Joi.object({
  name: Joi.string().min(1).max(60).required(),
}).options({ stripUnknown: true });

export const movePlannerSchema = Joi.object({
  direction: Joi.string().valid("up", "down").required(),
});

export const listTasksQuerySchema = Joi.object({
  // Opcional: si se omite, plannerService cae en el planner por defecto del usuario (ver
  // getOrCreateDefaultPlanner) — el dashboard SIEMPRE lo manda (sabe qué tablero está mostrando),
  // pero el protocolo de sync del móvil es anterior a este concepto y no lo conoce.
  plannerId: Joi.number().integer().positive(),
  projectId: Joi.number().integer().positive(),
  tag: Joi.string().trim().min(1).max(30),
}).options({ stripUnknown: true });

const tagsSchema = Joi.array().items(Joi.string().trim().min(1).max(30)).max(MAX_TAGS);

// `image` es una foto embebida como data URL (igual que en las páginas de proyecto y el kanban
// de páginas personalizadas) — límite generoso por lo mismo, unos MB en base64. `notes` es el
// recuadro grande sin nombre del diálogo de detalles: mucho más margen que `description` (que
// sigue siendo el resumen corto) porque es justo el sitio para "todo lo demás".
const imageSchema = Joi.string().max(8_000_000).allow(null, "");
const notesSchema = Joi.string().max(20_000).allow(null, "");

export const createTaskSchema = Joi.object({
  // Igual que en listTasksQuerySchema: opcional a nivel de validación (el service cae en el
  // planner por defecto si falta), pero el dashboard siempre lo manda.
  plannerId: Joi.number().integer().positive(),
  title: Joi.string().min(1).max(150).required(),
  description: Joi.string().max(2000).allow(null, ""),
  image: imageSchema,
  notes: notesSchema,
  // Vista "compacta" de la tarjeta en el tablero (imagen a la izquierda, texto a la derecha) —
  // sin efecto si la tarea no tiene imagen, ver TaskCard/TaskDetailDialog en el dashboard.
  compact: Joi.boolean(),
  status: Joi.string().valid(...STATUSES),
  priority: Joi.string().valid(...PRIORITIES),
  order: Joi.number(),
  dueDate: Joi.date().iso().allow(null),
  tags: tagsSchema,
  estimatedMinutes: Joi.number().integer().min(1).max(100000).allow(null),
  projectId: Joi.number().integer().positive().allow(null),
  customFields: customFieldsSchema,
}).options({ stripUnknown: true });

export const updateTaskSchema = Joi.object({
  title: Joi.string().min(1).max(150),
  description: Joi.string().max(2000).allow(null, ""),
  image: imageSchema,
  notes: notesSchema,
  compact: Joi.boolean(),
  status: Joi.string().valid(...STATUSES),
  priority: Joi.string().valid(...PRIORITIES),
  order: Joi.number(),
  dueDate: Joi.date().iso().allow(null),
  tags: tagsSchema,
  estimatedMinutes: Joi.number().integer().min(1).max(100000).allow(null),
  projectId: Joi.number().integer().positive().allow(null),
  customFields: customFieldsSchema,
}).min(1);

export const logTimeSchema = Joi.object({
  minutes: Joi.number().integer().min(1).max(1000).required(),
});

export const createSubtaskSchema = Joi.object({
  title: Joi.string().min(1).max(150).required(),
}).options({ stripUnknown: true });

export const updateSubtaskSchema = Joi.object({
  title: Joi.string().min(1).max(150),
  completed: Joi.boolean(),
}).min(1);
