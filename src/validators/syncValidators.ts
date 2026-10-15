import Joi from "joi";
import { createEventSchema, updateEventSchema, setExceptionSchema } from "./agendaValidators";
import { createTaskSchema, updateTaskSchema, createSubtaskSchema, updateSubtaskSchema } from "./plannerValidators";
import { createNoteSchema, updateNoteSchema } from "./notesValidators";
import { createHabitSchema, updateHabitSchema } from "./habitsValidators";
import { createTransactionSchema, updateTransactionSchema, createSavingsGoalSchema, updateSavingsGoalSchema } from "./financeValidators";
import { createGoalSchema, updateGoalSchema, registerProgressSchema, updateProgressSchema } from "./goalsValidators";
import {
  createProjectSchema,
  updateProjectSchema,
  createTaskSchema as createProjectTaskSchema,
  updateTaskSchema as updateProjectTaskSchema,
  createPageSchema as createProjectPageSchema,
  updatePageSchema as updateProjectPageSchema,
} from "./projectsValidators";
import { createScheduleSchema, updateScheduleSchema, updateRowSchema } from "./scheduleValidators";
import { createCategorySchema, updateCategorySchema } from "./calendarLegendValidators";
import { createCustomPageSchema, updateCustomPageSchema } from "./customPagesValidators";

export const syncPullQuerySchema = Joi.object({
  // Sin `since`: bootstrap completo (todo lo del usuario, sin filtrar por fecha).
  since: Joi.date().iso(),
}).options({ stripUnknown: true });

// El cuerpo del push NO se valida entero de golpe: si un solo elemento no fuera válido (una nota
// demasiado larga, una fecha mal formada...), todo el lote se rechazaría con un 400 y el móvil no
// podría subir nada más hasta arreglarlo a mano. El middleware (`syncPushSchema`) comprueba solo la
// forma del sobre, y cada elemento se valida por separado con el esquema de su sección y operación
// (`validateSyncPushItems`): el que no pasa se rechaza solo, sin bloquear al resto (ver
// syncService.push y `failures` en su respuesta).

// Envoltorio común de "creado offline" (localId, sin id de servidor todavía) — se compone
// sobre los schemas de creación YA existentes en cada módulo (agendaValidators/
// plannerValidators/notesValidators/habitsValidators) en vez de redeclarar las reglas de cada
// campo, para que un evento/tarea/nota/hábito sincronizado valide exactamente igual que uno
// creado desde la web.
const localIdField = { localId: Joi.string().uuid().required() };
// Envoltorio común de "editado offline" (id real del servidor + cuándo se hizo el cambio en el
// dispositivo, para la resolución de conflictos por last-write-wins — ver syncService.ts).
const updateEnvelope = { id: Joi.number().integer().positive().required(), clientUpdatedAt: Joi.date().iso().required() };

const events = {
  create: createEventSchema.keys(localIdField),
  update: updateEventSchema.keys(updateEnvelope),
};

// Una excepción no tiene "localId": se identifica por (eventId, originalStartTime), no por un
// id propio generado por el cliente — por eso es un único array "upsert", igual que
// `agendaService.setEventException` ya upsertea.
const eventExceptions = {
  upsert: setExceptionSchema.keys({ eventId: Joi.number().integer().positive().required() }),
};

const tasks = {
  create: createTaskSchema.keys(localIdField),
  update: updateTaskSchema.keys(updateEnvelope),
};

const subtaskParentField = { taskId: Joi.number().integer().positive().required() };
// `createSubtaskSchema` solo admite `title` (así lo espera `addSubtask`, que no recibe estado
// inicial) — pero una subtarea creada offline puede haberse completado antes de sincronizar
// nunca, así que aquí se añade `completed` como opcional (syncService la aplica en un segundo
// paso tras crear, ver syncService.ts).
const subtasks = {
  create: createSubtaskSchema.keys({ ...localIdField, ...subtaskParentField, completed: Joi.boolean() }),
  update: updateSubtaskSchema.keys({ ...updateEnvelope, ...subtaskParentField }),
};

// Igual que con las subtareas: `createNoteSchema` solo admite `content`, pero una nota rápida
// creada offline puede haberse marcado como hecha antes de sincronizar — `checked` opcional.
const notes = {
  create: createNoteSchema.keys({ ...localIdField, checked: Joi.boolean() }),
  update: updateNoteSchema.keys(updateEnvelope),
};

const habits = {
  create: createHabitSchema.keys(localIdField),
  update: updateHabitSchema.keys(updateEnvelope),
};

// HabitLog no se edita in-place (solo alta/baja, ver habitsService.toggleHabitDay) — no hay
// "update", y la creación no lleva localId propio: se identifica por (habitId, date), igual
// que las excepciones de evento.
const habitLogs = {
  create: Joi.object({
    habitId: Joi.number().integer().positive().required(),
    date: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .required(),
  }),
};

// --- Fase 2 de sync: Finanzas, Objetivos, Proyectos, Horario, Páginas personalizadas ---

const transactions = {
  create: createTransactionSchema.keys(localIdField),
  update: updateTransactionSchema.keys(updateEnvelope),
};

const savingsGoals = {
  create: createSavingsGoalSchema.keys(localIdField),
  update: updateSavingsGoalSchema.keys(updateEnvelope),
};

const goals = {
  create: createGoalSchema.keys(localIdField),
  update: updateGoalSchema.keys(updateEnvelope),
};

// A diferencia de HabitLog, un GoalProgress SÍ se puede editar/borrar offline (ver
// goalsService.ts updateProgress/deleteProgress, que revierten currentValue) — por eso necesita
// `localId` como cualquier entidad creable, no solo (habitId, date).
const goalProgress = {
  create: registerProgressSchema.keys({ ...localIdField, goalId: Joi.number().integer().positive().required() }),
  update: updateProgressSchema.keys({ ...updateEnvelope, goalId: Joi.number().integer().positive().required() }),
};

const projects = {
  create: createProjectSchema.keys(localIdField),
  update: updateProjectSchema.keys(updateEnvelope),
};

const projectParentField = { projectId: Joi.number().integer().positive().required() };

// `completed` opcional en el create: igual que con subtareas/notas, una tarea de proyecto creada
// offline puede haberse marcado como hecha antes de sincronizar nunca (ver syncService.ts).
const projectTasks = {
  create: createProjectTaskSchema.keys({ ...localIdField, ...projectParentField, completed: Joi.boolean() }),
  update: updateProjectTaskSchema.keys({ ...updateEnvelope, ...projectParentField, completed: Joi.boolean() }),
};

const projectPages = {
  create: createProjectPageSchema.keys({ ...localIdField, ...projectParentField }),
  update: updateProjectPageSchema.keys({ ...updateEnvelope, ...projectParentField }),
};

const schedules = {
  create: createScheduleSchema.keys(localIdField),
  update: updateScheduleSchema.keys(updateEnvelope),
};

const scheduleParentField = { scheduleId: Joi.number().integer().positive().required() };

// Reutiliza `updateRowSchema` (todos los campos opcionales, incluido `order`) también para
// `create`: una fila creada offline puede llegar ya con celdas rellenas — más simple que
// duplicar la lista de campos entre create/update (ver addRowSchema, que solo cubre timeLabel).
const scheduleRows = {
  create: updateRowSchema.keys({ ...localIdField, ...scheduleParentField }),
  update: updateRowSchema.keys({ ...updateEnvelope, ...scheduleParentField }),
};

const calendarLegendCategories = {
  create: createCategorySchema.keys(localIdField),
  update: updateCategorySchema.keys(updateEnvelope),
};

// Una marca de día no tiene "update" ni id propio conocido por el cliente — se identifica por
// fecha y siempre sustituye (pintar encima cambia el color, no lo acumula), igual criterio que
// `eventExceptions`. Un `categoryId: null` (borrar la marca) va por `deletes`, no por aquí.
const calendarDayMarks = {
  upsert: Joi.object({
    date: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .required(),
    categoryId: Joi.number().integer().positive().required(),
  }),
};

const customPages = {
  create: createCustomPageSchema.keys(localIdField),
  update: updateCustomPageSchema.keys(updateEnvelope),
};

// Formas de "borrar", según cómo se identifica cada tipo (ver syncService.ts):
// - la mayoría por su `id` de servidor;
// - una excepción de evento por (eventId, originalStartTime) — no tiene id propio conocido
//   por el cliente hasta que hace un pull;
// - una subtarea necesita también `taskId` (deleteSubtask lo exige, ver plannerService.ts);
// - un HabitLog se borra "desmarcando el día" (habitId, date) — no por id, igual que un
//   registro no se referencia por id en ningún otro sitio de la app (ver habitsService.ts);
// - GoalProgress/ProjectTask/ProjectPage/ScheduleRow necesitan también el id de su padre;
// - CalendarDayMark se borra por `date`, igual criterio que HabitLog.
const deleteSchema = Joi.alternatives().try(
  Joi.object({
    entityType: Joi.string()
      .valid(
        "event",
        "task",
        "note",
        "habit",
        "transaction",
        "savingsGoal",
        "goal",
        "project",
        "schedule",
        "calendarLegendCategory",
        "customPage"
      )
      .required(),
    id: Joi.number().integer().positive().required(),
  }),
  Joi.object({
    entityType: Joi.string().valid("subtask").required(),
    id: Joi.number().integer().positive().required(),
    taskId: Joi.number().integer().positive().required(),
  }),
  Joi.object({
    entityType: Joi.string().valid("eventException").required(),
    eventId: Joi.number().integer().positive().required(),
    originalStartTime: Joi.date().iso().required(),
  }),
  Joi.object({
    entityType: Joi.string().valid("habitLog").required(),
    habitId: Joi.number().integer().positive().required(),
    date: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .required(),
  }),
  Joi.object({
    entityType: Joi.string().valid("goalProgress").required(),
    id: Joi.number().integer().positive().required(),
    goalId: Joi.number().integer().positive().required(),
  }),
  Joi.object({
    entityType: Joi.string().valid("projectTask", "projectPage").required(),
    id: Joi.number().integer().positive().required(),
    projectId: Joi.number().integer().positive().required(),
  }),
  Joi.object({
    entityType: Joi.string().valid("scheduleRow").required(),
    id: Joi.number().integer().positive().required(),
    scheduleId: Joi.number().integer().positive().required(),
  }),
  Joi.object({
    entityType: Joi.string().valid("calendarDayMark").required(),
    date: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .required(),
  })
);

// Esquema de cada elemento, por sección y operación.
const ITEM_SCHEMAS: Record<string, Record<string, Joi.Schema>> = {
  events,
  eventExceptions,
  tasks,
  subtasks,
  notes,
  habits,
  habitLogs,
  transactions,
  savingsGoals,
  goals,
  goalProgress,
  projects,
  projectTasks,
  projectPages,
  schedules,
  scheduleRows,
  calendarLegendCategories,
  calendarDayMarks,
  customPages,
};

// Tipo de entidad de cada sección: el mismo nombre que usan `idMappings`, `conflicts` y `deletes`.
const SECTION_ENTITY: Record<string, string> = {
  events: "event",
  eventExceptions: "eventException",
  tasks: "task",
  subtasks: "subtask",
  notes: "note",
  habits: "habit",
  habitLogs: "habitLog",
  transactions: "transaction",
  savingsGoals: "savingsGoal",
  goals: "goal",
  goalProgress: "goalProgress",
  projects: "project",
  projectTasks: "projectTask",
  projectPages: "projectPage",
  schedules: "schedule",
  scheduleRows: "scheduleRow",
  calendarLegendCategories: "calendarLegendCategory",
  calendarDayMarks: "calendarDayMark",
  customPages: "customPage",
};

// Cualquier lista de objetos: lo que lleva cada uno se mira después, elemento a elemento.
const anyItems = Joi.array().items(Joi.object().unknown(true)).default([]);

/** Forma del sobre del push: cada sección con sus listas de objetos (y `deletes`). */
export const syncPushSchema = Joi.object({
  ...Object.fromEntries(
    Object.entries(ITEM_SCHEMAS).map(([section, ops]) => {
      const opNames = Object.keys(ops);
      return [
        section,
        Joi.object(Object.fromEntries(opNames.map((op) => [op, anyItems]))).default(Object.fromEntries(opNames.map((op) => [op, []]))),
      ];
    })
  ),
  deletes: anyItems,
}).options({ stripUnknown: true });

/** Un elemento del push que el servidor no ha aplicado. `index` es su posición en `body[section][op]` (o en `body.deletes`). */
export interface SyncPushFailure {
  section: string;
  op: string;
  index: number;
  entityType: string;
  status: number;
  message: string;
  // true si el fallo puede ser pasajero (error interno, base de datos caída...) y tiene sentido reintentarlo.
  retryable: boolean;
}

/**
 * Valida cada elemento de un push (que ya tiene la forma de `syncPushSchema`) contra el esquema de
 * su sección, con las mismas opciones que el middleware `validate`. Devuelve el cuerpo con los
 * elementos válidos ya normalizados y los inválidos sustituidos por `null` (así cada uno conserva
 * su índice), y un fallo por cada elemento inválido.
 */
export function validateSyncPushItems(body: Record<string, unknown>): { body: Record<string, unknown>; failures: SyncPushFailure[] } {
  const failures: SyncPushFailure[] = [];

  const check = (schema: Joi.Schema, item: unknown, at: Pick<SyncPushFailure, "section" | "op" | "index" | "entityType">) => {
    const { error, value } = schema.validate(item, { abortEarly: false, stripUnknown: true });
    if (!error) return value;
    failures.push({ ...at, status: 400, message: error.details.map((d) => d.message).join("; "), retryable: false });
    return null;
  };

  const result: Record<string, unknown> = {};
  for (const [section, ops] of Object.entries(ITEM_SCHEMAS)) {
    const lists = (body[section] ?? {}) as Record<string, unknown[] | undefined>;
    result[section] = Object.fromEntries(
      Object.entries(ops).map(([op, schema]) => [
        op,
        (lists[op] ?? []).map((item, index) => check(schema, item, { section, op, index, entityType: SECTION_ENTITY[section] })),
      ])
    );
  }

  result.deletes = ((body.deletes ?? []) as unknown[]).map((item, index) => {
    const entityType = (item as { entityType?: unknown }).entityType;
    return check(deleteSchema, item, { section: "deletes", op: "delete", index, entityType: typeof entityType === "string" ? entityType : "desconocido" });
  });

  return { body: result, failures };
}
