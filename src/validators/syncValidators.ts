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

// Envoltorio común de "creado offline" (localId, sin id de servidor todavía) — se compone
// sobre los schemas de creación YA existentes en cada módulo (agendaValidators/
// plannerValidators/notesValidators/habitsValidators) en vez de redeclarar las reglas de cada
// campo, para que un evento/tarea/nota/hábito sincronizado valide exactamente igual que uno
// creado desde la web.
const localIdField = { localId: Joi.string().uuid().required() };
// Envoltorio común de "editado offline" (id real del servidor + cuándo se hizo el cambio en el
// dispositivo, para la resolución de conflictos por last-write-wins — ver syncService.ts).
const updateEnvelope = { id: Joi.number().integer().positive().required(), clientUpdatedAt: Joi.date().iso().required() };

const eventsSchema = Joi.object({
  create: Joi.array().items(createEventSchema.keys(localIdField)).default([]),
  update: Joi.array().items(updateEventSchema.keys(updateEnvelope)).default([]),
}).default({ create: [], update: [] });

// Una excepción no tiene "localId": se identifica por (eventId, originalStartTime), no por un
// id propio generado por el cliente — por eso es un único array "upsert", igual que
// `agendaService.setEventException` ya upsertea.
const eventExceptionsSchema = Joi.object({
  upsert: Joi.array()
    .items(setExceptionSchema.keys({ eventId: Joi.number().integer().positive().required() }))
    .default([]),
}).default({ upsert: [] });

const tasksSchema = Joi.object({
  create: Joi.array().items(createTaskSchema.keys(localIdField)).default([]),
  update: Joi.array().items(updateTaskSchema.keys(updateEnvelope)).default([]),
}).default({ create: [], update: [] });

const subtaskParentField = { taskId: Joi.number().integer().positive().required() };
// `createSubtaskSchema` solo admite `title` (así lo espera `addSubtask`, que no recibe estado
// inicial) — pero una subtarea creada offline puede haberse completado antes de sincronizar
// nunca, así que aquí se añade `completed` como opcional (syncService la aplica en un segundo
// paso tras crear, ver syncService.ts).
const subtasksSchema = Joi.object({
  create: Joi.array()
    .items(createSubtaskSchema.keys({ ...localIdField, ...subtaskParentField, completed: Joi.boolean() }))
    .default([]),
  update: Joi.array()
    .items(updateSubtaskSchema.keys({ ...updateEnvelope, ...subtaskParentField }))
    .default([]),
}).default({ create: [], update: [] });

// Igual que con las subtareas: `createNoteSchema` solo admite `content`, pero una nota rápida
// creada offline puede haberse marcado como hecha antes de sincronizar — `checked` opcional.
const notesSchema = Joi.object({
  create: Joi.array().items(createNoteSchema.keys({ ...localIdField, checked: Joi.boolean() })).default([]),
  update: Joi.array().items(updateNoteSchema.keys(updateEnvelope)).default([]),
}).default({ create: [], update: [] });

const habitsSchema = Joi.object({
  create: Joi.array().items(createHabitSchema.keys(localIdField)).default([]),
  update: Joi.array().items(updateHabitSchema.keys(updateEnvelope)).default([]),
}).default({ create: [], update: [] });

// HabitLog no se edita in-place (solo alta/baja, ver habitsService.toggleHabitDay) — no hay
// "update", y la creación no lleva localId propio: se identifica por (habitId, date), igual
// que las excepciones de evento.
const habitLogsSchema = Joi.object({
  create: Joi.array()
    .items(
      Joi.object({
        habitId: Joi.number().integer().positive().required(),
        date: Joi.string()
          .pattern(/^\d{4}-\d{2}-\d{2}$/)
          .required(),
      })
    )
    .default([]),
}).default({ create: [] });

// --- Fase 2 de sync: Finanzas, Objetivos, Proyectos, Horario, Páginas personalizadas ---

const transactionsSchema = Joi.object({
  create: Joi.array().items(createTransactionSchema.keys(localIdField)).default([]),
  update: Joi.array().items(updateTransactionSchema.keys(updateEnvelope)).default([]),
}).default({ create: [], update: [] });

const savingsGoalsSchema = Joi.object({
  create: Joi.array().items(createSavingsGoalSchema.keys(localIdField)).default([]),
  update: Joi.array().items(updateSavingsGoalSchema.keys(updateEnvelope)).default([]),
}).default({ create: [], update: [] });

const goalsSchema = Joi.object({
  create: Joi.array().items(createGoalSchema.keys(localIdField)).default([]),
  update: Joi.array().items(updateGoalSchema.keys(updateEnvelope)).default([]),
}).default({ create: [], update: [] });

// A diferencia de HabitLog, un GoalProgress SÍ se puede editar/borrar offline (ver
// goalsService.ts updateProgress/deleteProgress, que revierten currentValue) — por eso necesita
// `localId` como cualquier entidad creable, no solo (habitId, date).
const goalProgressSchema = Joi.object({
  create: Joi.array()
    .items(registerProgressSchema.keys({ ...localIdField, goalId: Joi.number().integer().positive().required() }))
    .default([]),
  update: Joi.array()
    .items(updateProgressSchema.keys({ ...updateEnvelope, goalId: Joi.number().integer().positive().required() }))
    .default([]),
}).default({ create: [], update: [] });

const projectsSchema = Joi.object({
  create: Joi.array().items(createProjectSchema.keys(localIdField)).default([]),
  update: Joi.array().items(updateProjectSchema.keys(updateEnvelope)).default([]),
}).default({ create: [], update: [] });

const projectParentField = { projectId: Joi.number().integer().positive().required() };

// `completed` opcional en el create: igual que con subtareas/notas, una tarea de proyecto creada
// offline puede haberse marcado como hecha antes de sincronizar nunca (ver syncService.ts).
const projectTasksSchema = Joi.object({
  create: Joi.array()
    .items(createProjectTaskSchema.keys({ ...localIdField, ...projectParentField, completed: Joi.boolean() }))
    .default([]),
  update: Joi.array()
    .items(updateProjectTaskSchema.keys({ ...updateEnvelope, ...projectParentField, completed: Joi.boolean() }))
    .default([]),
}).default({ create: [], update: [] });

const projectPagesSchema = Joi.object({
  create: Joi.array().items(createProjectPageSchema.keys({ ...localIdField, ...projectParentField })).default([]),
  update: Joi.array().items(updateProjectPageSchema.keys({ ...updateEnvelope, ...projectParentField })).default([]),
}).default({ create: [], update: [] });

const schedulesSchema = Joi.object({
  create: Joi.array().items(createScheduleSchema.keys(localIdField)).default([]),
  update: Joi.array().items(updateScheduleSchema.keys(updateEnvelope)).default([]),
}).default({ create: [], update: [] });

const scheduleParentField = { scheduleId: Joi.number().integer().positive().required() };

// Reutiliza `updateRowSchema` (todos los campos opcionales, incluido `order`) también para
// `create`: una fila creada offline puede llegar ya con celdas rellenas — más simple que
// duplicar la lista de campos entre create/update (ver addRowSchema, que solo cubre timeLabel).
const scheduleRowsSchema = Joi.object({
  create: Joi.array().items(updateRowSchema.keys({ ...localIdField, ...scheduleParentField })).default([]),
  update: Joi.array().items(updateRowSchema.keys({ ...updateEnvelope, ...scheduleParentField })).default([]),
}).default({ create: [], update: [] });

const calendarLegendCategoriesSchema = Joi.object({
  create: Joi.array().items(createCategorySchema.keys(localIdField)).default([]),
  update: Joi.array().items(updateCategorySchema.keys(updateEnvelope)).default([]),
}).default({ create: [], update: [] });

// Una marca de día no tiene "update" ni id propio conocido por el cliente — se identifica por
// fecha y siempre sustituye (pintar encima cambia el color, no lo acumula), igual criterio que
// `eventExceptionsSchema`. Un `categoryId: null` (borrar la marca) va por `deletes`, no por aquí.
const calendarDayMarksSchema = Joi.object({
  upsert: Joi.array()
    .items(
      Joi.object({
        date: Joi.string()
          .pattern(/^\d{4}-\d{2}-\d{2}$/)
          .required(),
        categoryId: Joi.number().integer().positive().required(),
      })
    )
    .default([]),
}).default({ upsert: [] });

const customPagesSchema = Joi.object({
  create: Joi.array().items(createCustomPageSchema.keys(localIdField)).default([]),
  update: Joi.array().items(updateCustomPageSchema.keys(updateEnvelope)).default([]),
}).default({ create: [], update: [] });

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

export const syncPushSchema = Joi.object({
  events: eventsSchema,
  eventExceptions: eventExceptionsSchema,
  tasks: tasksSchema,
  subtasks: subtasksSchema,
  notes: notesSchema,
  habits: habitsSchema,
  habitLogs: habitLogsSchema,
  transactions: transactionsSchema,
  savingsGoals: savingsGoalsSchema,
  goals: goalsSchema,
  goalProgress: goalProgressSchema,
  projects: projectsSchema,
  projectTasks: projectTasksSchema,
  projectPages: projectPagesSchema,
  schedules: schedulesSchema,
  scheduleRows: scheduleRowsSchema,
  calendarLegendCategories: calendarLegendCategoriesSchema,
  calendarDayMarks: calendarDayMarksSchema,
  customPages: customPagesSchema,
  deletes: Joi.array().items(deleteSchema).default([]),
}).options({ stripUnknown: true });
