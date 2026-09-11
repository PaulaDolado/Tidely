// Tipos compartidos por la app móvil. Deliberadamente más pequeños que los del dashboard web
// (dashboard/src/types.ts) — esta app solo cachea/edita el subconjunto que tiene sentido offline
// en un teléfono (ver mobile/README.md para el alcance exacto de cada fase), no todos los campos
// que expone la API (p.ej. no hay `image`/`notes`/`customFields` en Task, ni multi-tablero).

export interface User {
  id: number;
  email: string;
  name: string;
  timezone?: string;
}

export interface AuthResponse {
  token: string;
  refreshToken: string;
  user: User;
}

// --- Constantes compartidas por los formularios (mismos valores que agendaValidators.ts /
// plannerValidators.ts en el backend — ver comentarios ahí para el porqué de cada uno) ---

export const RECURRING_PATTERNS = ["daily", "weekly", "biweekly", "monthly"] as const;
export type RecurringPattern = (typeof RECURRING_PATTERNS)[number];

export const RECURRING_PATTERN_LABELS: Record<RecurringPattern, string> = {
  daily: "Cada día",
  weekly: "Cada semana",
  biweekly: "Cada 2 semanas",
  monthly: "Cada mes",
};

// Mismos presets que el formulario de evento en dashboard/src/pages/AgendaPage.tsx.
export const REMINDER_PRESETS_MINUTES = [15, 30, 60, 1440] as const;
export const REMINDER_PRESET_LABELS: Record<number, string> = {
  15: "15 min antes",
  30: "30 min antes",
  60: "1 hora antes",
  1440: "1 día antes",
};

export const TASK_STATUSES = ["todo", "in_progress", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "Por hacer",
  in_progress: "En progreso",
  done: "Hecho",
};

export const TASK_PRIORITIES = ["low", "medium", "high"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
};

// --- Filas tal cual las devuelve el servidor (GET /sync/pull) ---
// Son los modelos de Prisma "en crudo", no las respuestas ya elaboradas de /agenda, /planner,
// etc. — por eso llevan `userId`/`plannerId` y no atraviesan ningún check de "pertenece al
// proyecto X". Solo se listan aquí los campos que esta app realmente usa; el resto (p.ej.
// `image`/`notes`/`customFields` de Task) llega en la respuesta real pero no se declara ni se
// guarda.

export interface ServerEvent {
  id: number;
  title: string;
  description: string | null;
  // Deprecado: ver el mismo comentario en dashboard/src/types.ts / prisma/schema.prisma — la
  // categoría de verdad es `categoryId` (ver EventCategory, más abajo).
  type: string;
  categoryId: number | null;
  startTime: string;
  endTime: string;
  location: string | null;
  isRecurring: boolean;
  recurringPattern: RecurringPattern | null;
  reminderMinutesBefore: number[];
  guests: string[];
  source: "tidely" | "google";
  googleEventId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ServerEventException {
  id: number;
  eventId: number;
  originalStartTime: string;
  status: "moved" | "cancelled";
  newStartTime: string | null;
  newEndTime: string | null;
  updatedAt: string;
}

export interface ServerTask {
  id: number;
  plannerId: number;
  projectId: number | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  order: number;
  dueDate: string | null;
  tags: string[];
  estimatedMinutes: number | null;
  actualMinutes: number;
  updatedAt: string;
}

export interface ServerSubtask {
  id: number;
  taskId: number;
  title: string;
  completed: boolean;
  updatedAt: string;
}

export interface ServerHabit {
  id: number;
  title: string;
  active: boolean;
  updatedAt: string;
}

export interface ServerHabitLog {
  id: number;
  habitId: number;
  date: string;
  createdAt: string;
}

export interface ServerNote {
  id: number;
  content: string;
  checked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SyncTombstone {
  id: number;
  entityType: "event" | "eventException" | "task" | "subtask" | "note" | "habit" | "habitLog";
  entityId: number;
  deletedAt: string;
}

export interface PullResponse {
  serverTime: string;
  events: ServerEvent[];
  eventExceptions: ServerEventException[];
  tasks: ServerTask[];
  subtasks: ServerSubtask[];
  notes: ServerNote[];
  habits: ServerHabit[];
  habitLogs: ServerHabitLog[];
  tombstones: SyncTombstone[];
}

export interface PushResult {
  idMappings: { entityType: string; localId: string; id: number }[];
  conflicts: { entityType: string; id: number }[];
}

// --- Filas tal cual se guardan en SQLite local (ver db/schema.ts) ---
//
// `events`, `tasks` y `subtasks` comparten el mismo patrón que `notes` ya usaba en Fase 1 (único
// sitio donde el móvil creaba filas nuevas entonces): `id TEXT PRIMARY KEY` — un uuid
// (`expo-crypto`) mientras la fila no existe todavía en el servidor, sustituido por el id de
// servidor (como texto) en cuanto se sincroniza — más `synced INTEGER` (0 = solo local) y
// `pendingOp` (`'update'|'delete'|null`; `'create'` queda implícito en `synced=0`). Se generaliza
// aquí porque ahora los tres tipos necesitan poder CREARSE offline (antes eventos/tareas eran de
// solo lectura o solo-editar-estado — ver mobile/README.md).

export interface LocalEvent {
  id: string;
  title: string;
  description: string | null;
  type: string;
  categoryId: number | null;
  startTime: string;
  endTime: string;
  location: string | null;
  isRecurring: 0 | 1;
  recurringPattern: RecurringPattern | null;
  reminderMinutesBefore: string; // JSON de number[] — ver utils/json.ts
  guests: string; // JSON de string[]
  source: "tidely" | "google";
  googleEventId: string | null;
  createdAt: string;
  updatedAt: string;
  synced: 0 | 1;
  pendingOp: "update" | "delete" | null;
}

// Solo caché de lectura (el móvil no crea/edita excepciones en esta fase, ver README) — igual
// criterio que `habits`/`event` de solo-lectura de Fase 1.
export interface LocalEventException {
  eventId: string;
  originalStartTime: string;
  serverId: number | null; // id de servidor de la excepción — permite borrarla por tombstone (ver eventExceptionsRepo)
  status: "moved" | "cancelled";
  newStartTime: string | null;
  newEndTime: string | null;
  updatedAt: string;
}

export interface LocalTask {
  id: string;
  plannerId: number | null;
  projectId: number | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  order: number;
  dueDate: string | null;
  tags: string; // JSON de string[]
  estimatedMinutes: number | null;
  actualMinutes: number;
  updatedAt: string;
  synced: 0 | 1;
  pendingOp: "update" | "delete" | null;
}

export interface LocalSubtask {
  id: string;
  taskId: string;
  title: string;
  completed: 0 | 1;
  updatedAt: string;
  synced: 0 | 1;
  pendingOp: "update" | "delete" | null;
}

export interface LocalHabit {
  id: number;
  title: string;
  updatedAt: string;
}

export interface LocalHabitLog {
  habitId: number;
  date: string;
  serverId: number | null; // null hasta que un pull confirma el id real (ver sync/push.ts)
  pending: "create" | "delete" | null; // null = confirmado con el servidor
}

export interface LocalNote {
  id: string; // uuid mientras no está sincronizada; id del servidor (como texto) en cuanto lo está
  content: string;
  checked: 0 | 1;
  createdAt: string;
  updatedAt: string;
  synced: 0 | 1;
  pendingOp: "update" | "delete" | null;
}

// Colores disponibles para la leyenda del calendario anual (Horario > vista anual) — mismo
// conjunto que dashboard/src/types.ts, ver mobile/src/utils/calendarColors.ts para su traducción
// a los tokens RGB de theme.ts.
export type CalendarColor = "primary" | "secondary" | "habit" | "hobby" | "positive" | "negative" | "warning" | "muted";

// Categoría de la leyenda del calendario anual — compartida para toda la cuenta, no por horario/
// trimestre (ver api/calendarLegend.ts: tampoco pasa por SQLite, igual que Schedule).
export interface CalendarLegendCategory {
  id: number;
  label: string;
  color: CalendarColor;
  order: number;
}

// Un día del calendario anual pintado con una categoría.
export interface CalendarDayMark {
  date: string; // YYYY-MM-DD
  categoryId: number;
}

// Categoría de evento (Agenda > + Nuevo evento) — mismo concepto que CalendarLegendCategory
// (nombre + color de la paleta de la app, gestionable por el usuario) pero para categorizar
// eventos en vez de días del calendario anual. Igual que calendar-legend, no pasa por SQLite ni
// por sync/ (ver api/eventCategories.ts): solo `categoryId` en el propio Event viaja offline.
export interface EventCategory {
  id: number;
  label: string;
  color: CalendarColor;
  order: number;
}
