import Joi from "joi";

// Modelos disponibles al crear una página desde "+ Nueva página" (ver AppShell en el dashboard):
// "nota", "kanban" y "galeria" son plantillas genéricas; el resto son versiones propias y
// simplificadas de una sección existente (Finanzas/Proyectos/Objetivos/Agenda/Hoy), con sus
// propios datos — no leen ni escriben en Transaction/Project/Goal/Event/etc.
export const TEMPLATES = ["nota", "kanban", "galeria", "finanzas", "proyectos", "objetivos", "agenda", "hoy"] as const;

export const idParamSchema = Joi.object({
  id: Joi.number().integer().positive().required(),
});

export const createCustomPageSchema = Joi.object({
  title: Joi.string().min(1).max(100).required(),
  template: Joi.string()
    .valid(...TEMPLATES)
    .required(),
}).options({ stripUnknown: true });

// Límite en bytes del JSON serializado, no en número de claves (Joi no valida tamaño de objetos
// directamente) — igual de generoso que el content de ProjectPage.content: la plantilla "nota"
// guarda HTML con imágenes embebidas como data URL, que puede pesar varios MB.
const CONTENT_BYTE_LIMIT = 8_000_000;

// `content` es el JSON con la forma que le corresponde a `template` (ver customPagesService) —
// se sobrescribe entero en cada guardado, igual que ProjectPage.content.
export const updateCustomPageSchema = Joi.object({
  title: Joi.string().min(1).max(100),
  // Vacío/null borra el subtítulo escrito por el usuario y vuelve a mostrar el icono+nombre de
  // la plantilla por defecto (ver CustomPagePage).
  subtitle: Joi.string().max(150).allow(null, ""),
  content: Joi.object()
    .unknown(true)
    .custom((value, helpers) => {
      if (JSON.stringify(value).length > CONTENT_BYTE_LIMIT) return helpers.error("any.invalid");
      return value;
    }, "límite de tamaño del contenido"),
  // No entero: el móvil calcula un punto medio fraccionario entre vecinos para reordenar offline
  // (ver syncService.ts / mobile tasksRepo::moveTask), igual que Schedule.order.
  order: Joi.number().min(0),
}).min(1);

export const moveCustomPageSchema = Joi.object({
  direction: Joi.string().valid("up", "down").required(),
});
