import Joi from "joi";
import { paginationQuerySchema } from "./pagination";

const STATUSES = ["idea", "en_curso", "pausado", "completado"];
const PRIORITIES = ["low", "medium", "high"];
// Color de la "carpeta" en la galería del dashboard (ver NotebookCover en ProyectosPage.tsx) —
// `null`/ausente ("sin personalizar") deja que el frontend rote los tres tonos por índice como
// hacía antes de que existiera este campo.
const COLORS = ["cover", "sand", "sage"];

export const idParamSchema = Joi.object({
  id: Joi.number().integer().positive().required(),
});

export const projectTaskParamsSchema = Joi.object({
  id: Joi.number().integer().positive().required(),
  taskId: Joi.number().integer().positive().required(),
});

export const listProjectsQuerySchema = Joi.object({
  status: Joi.string().valid(...STATUSES),
  priority: Joi.string().valid(...PRIORITIES),
}).concat(paginationQuerySchema);

export const createProjectSchema = Joi.object({
  title: Joi.string().min(1).max(200).required(),
  description: Joi.string().max(1000).allow(null, ""),
  status: Joi.string()
    .valid(...STATUSES)
    .default("idea"),
  priority: Joi.string()
    .valid(...PRIORITIES)
    .default("medium"),
  deadline: Joi.date().iso().allow(null),
  color: Joi.string()
    .valid(...COLORS)
    .allow(null),
}).options({ stripUnknown: true });

export const updateProjectSchema = Joi.object({
  title: Joi.string().min(1).max(200),
  description: Joi.string().max(1000).allow(null, ""),
  status: Joi.string().valid(...STATUSES),
  priority: Joi.string().valid(...PRIORITIES),
  deadline: Joi.date().iso().allow(null),
  color: Joi.string()
    .valid(...COLORS)
    .allow(null),
}).min(1);

export const createTaskSchema = Joi.object({
  title: Joi.string().min(1).max(200).required(),
}).options({ stripUnknown: true });

export const updateTaskSchema = Joi.object({
  title: Joi.string().min(1).max(200).required(),
}).options({ stripUnknown: true });

// `completed` es obligatorio (no un toggle implícito en el servidor): el cliente siempre sabe
// a qué estado quiere pasar el apunte, así un doble-click accidental no lo deja en un estado
// indeseado por casualidad.
export const setTaskCompletedSchema = Joi.object({
  completed: Joi.boolean().required(),
}).options({ stripUnknown: true });

export const projectPageParamsSchema = Joi.object({
  id: Joi.number().integer().positive().required(),
  pageId: Joi.number().integer().positive().required(),
});

// `content` es el HTML enriquecido de la página (listas, negrita/cursiva, <img> con imágenes
// embebidas como data URL). El límite generoso es a propósito: unas pocas fotos en base64
// ocupan varios MB de texto. Ver el body parser dedicado en projects.routes.ts.
export const createPageSchema = Joi.object({
  title: Joi.string().max(200).allow(null, ""),
  content: Joi.string().max(8_000_000).allow(""),
}).options({ stripUnknown: true });

export const updatePageSchema = Joi.object({
  title: Joi.string().max(200).allow(null, ""),
  content: Joi.string().max(8_000_000).allow(""),
  order: Joi.number().integer().min(0),
}).min(1);
