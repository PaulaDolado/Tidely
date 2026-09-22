// Tipos compartidos por la app móvil. Deliberadamente más pequeños que los del dashboard web
// (dashboard/src/types.ts) — esta app solo cachea/edita el subconjunto que tiene sentido offline
// en un teléfono (ver mobile/README.md para el alcance exacto de cada fase), no todos los campos
// que expone la API (p.ej. no hay `image`/`notes`/`customFields` en Task, ni multi-tablero).

// Mismos 7 valores que ENABLED_SECTIONS en dashboard/src/types.ts (backend: src/validators/
// authValidators.ts) — "Hoy" y "Agenda" no son opcionales, así que no están aquí.
export const ENABLED_SECTIONS = ["planificador", "horario", "objetivos", "galeria", "finanzas", "metasAhorro", "proyectos"] as const;
export type EnabledSection = (typeof ENABLED_SECTIONS)[number];

// Mismos textos que SECTION_LABELS/SECTION_DESCRIPTIONS en dashboard/src/types.ts — compartidos
// entre el asistente de bienvenida (OnboardingScreen) y Ajustes más adelante.
export const SECTION_LABELS: Record<EnabledSection, string> = {
  planificador: "Planificador",
  horario: "Horario",
  objetivos: "Objetivos",
  galeria: "Galería",
  finanzas: "Finanzas",
  metasAhorro: "Metas de ahorro",
  proyectos: "Libreta",
};
export const SECTION_DESCRIPTIONS: Record<EnabledSection, string> = {
  planificador: "Tableros de tareas kanban, con propiedades personalizadas.",
  horario: "Horario semanal por franjas y calendario anual.",
  objetivos: "Metas semanales, mensuales o anuales con progreso.",
  galeria: "Fotos y notas en collage, como una pared de marcos.",
  finanzas: "Ingresos, gastos y balance del mes.",
  metasAhorro: "Ahorro e inversión como casillas de progreso.",
  proyectos: "Cuaderno con notas enriquecidas por proyecto.",
};

export type MenuLayout = "default" | "compact";

export interface User {
  id: number;
  email: string;
  name: string;
  timezone?: string;
  // Elegidos en el asistente de bienvenida tras registrarse (ver OnboardingScreen.tsx) — controla
  // qué apartados opcionales aparecen en el menú (ver AppSidebar.tsx). Opcional en el tipo porque
  // `updateUser()` en AuthContext hace parches parciales; en la práctica /auth/me siempre lo manda.
  enabledSections?: EnabledSection[];
  // Si ya completó el asistente de bienvenida — false solo justo tras registrarse una cuenta
  // nueva (ver App.tsx: mientras sea false, se muestra OnboardingScreen en vez de la app).
  onboardingCompleted?: boolean;
  // Diseño del menú (ver AppSidebar.tsx): "default" separa los apartados fijos de "Tus páginas"
  // en dos grupos, "compact" los muestra todos juntos sin esa cabecera — mismo criterio que
  // dashboard/src/types.ts.
  menuLayout?: MenuLayout;
  // Orden manual de los apartados del menú (mantener pulsado y arrastrar, ver AppSidebar.tsx) —
  // array de `route` ("Hoy", "Agenda", "galeria", ids de página propia...). Los que faltan aquí
  // van al final en su orden habitual.
  menuOrder?: string[];
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

// Referencia mínima a otro usuario (nunca el email) — igual selección que PUBLIC_USER_SELECT en
// el backend (eventInvitationService.ts) y PublicUserRef en dashboard/src/types.ts.
export interface PublicUserRef {
  id: number;
  name: string;
  username: string;
}

// Distintivo de "compartido" tal cual lo devuelve el servidor (GET /sync/pull), igual forma que
// EventSharing en agendaService.ts (backend) y dashboard/src/types.ts — ver `EventSharing` más
// abajo para la versión aplanada que de verdad se guarda en SQLite/usan las pantallas.
export type ServerEventSharing =
  | { role: "owner"; with: PublicUserRef[] }
  | { role: "invitee"; owner: PublicUserRef; invitationId: number };

// Versión aplanada de ServerEventSharing para SQLite/las pantallas: `owner` solo lleva nombre/
// username (no `id`, que esta app no necesita ni guarda localmente — ver
// LocalEvent.sharingOwnerName/Username en types.ts/eventsRepo.ts) y "owner" no guarda la lista de
// invitados (quien creó el evento la consulta en directo contra la API si hace falta, ver
// api/eventInvitations.ts). Si `role` es "invitee", el evento es de SOLO LECTURA: no se puede
// editar ni borrar, solo aceptar/rechazar la invitación o quitárselo del calendario del todo (ver
// AgendaScreen.tsx).
export type EventSharing =
  | { role: "owner" }
  | { role: "invitee"; owner: { name: string; username: string }; invitationId: number };

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
  // `null` en el caso normal (evento sin compartir) — ver ServerEventSharing arriba.
  sharing?: ServerEventSharing | null;
}

// Fila de invitación tal cual la devuelve la API de invitaciones (ver api/eventInvitations.ts) —
// no pasa por SQLite/sync, igual criterio que EventCategory/CalendarLegendCategory: se lee
// directa de la API cada vez que hace falta, no se cachea offline.
export interface EventInvitation {
  id: number;
  eventId: number;
  inviterId: number;
  inviteeId: number;
  status: "pending" | "accepted" | "declined";
  createdAt: string;
  updatedAt: string;
  // Presente en GET /agenda/events/:id/invitations (vista de quien creó el evento).
  invitee?: PublicUserRef;
  // Presentes en GET /agenda/invitations (vista de "lo que he recibido").
  inviter?: PublicUserRef;
  event?: { id: number; title: string; startTime: string; endTime: string; location: string | null; isRecurring: boolean };
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

// --- Fase 2 de sync: Finanzas, Objetivos, Proyectos, Horario, Páginas personalizadas ---
// Mismo criterio que arriba: solo los campos que el móvil realmente usa, tal cual los devuelve
// `GET /sync/pull` (filas crudas de Prisma).

export interface ServerTransaction {
  id: number;
  type: "income" | "expense";
  amount: number;
  category: string;
  description: string | null;
  date: string;
  updatedAt: string;
}

// `currentAmount`/`progressPercent` NO viajan por sync (el backend los calcula sumando
// Transaction al listar, nunca se guardan en la fila — ver financeService.listSavingsGoals): el
// móvil los calcula igual, sumando sus `transactions` locales de esa categoría.
export interface ServerSavingsGoal {
  id: number;
  name: string;
  type: "ahorro" | "inversion";
  targetAmount: number;
  category: string;
  stepAmount: number;
  deadline: string | null;
  // Necesario para el cálculo de "ritmo" (¿va a tiempo para la fecha límite?) en
  // MetasAhorroScreen, igual que dashboard/src/pages/MetasAhorroPage.tsx.
  createdAt: string;
  updatedAt: string;
}

export interface ServerGoal {
  id: number;
  title: string;
  description: string | null;
  period: "weekly" | "monthly" | "annual";
  targetValue: number;
  currentValue: number;
  completed: boolean;
  bonusPoints: number;
  periodStart: string;
  periodEnd: string;
  expired: boolean;
  autoRenew: boolean;
  updatedAt: string;
}

export interface ServerGoalProgress {
  id: number;
  goalId: number;
  value: number;
  note: string | null;
  date: string;
  updatedAt: string;
}

export interface ServerProject {
  id: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  deadline: string | null;
  color: string | null;
  updatedAt: string;
}

export interface ServerProjectTask {
  id: number;
  projectId: number;
  title: string;
  completed: boolean;
  updatedAt: string;
}

export interface ServerProjectPage {
  id: number;
  projectId: number;
  title: string;
  content: string; // HTML — blob opaco para el sync, ver mobile/src/api/projects.ts
  order: number;
  updatedAt: string;
}

export interface ServerSchedule {
  id: number;
  name: string;
  order: number;
  updatedAt: string;
}

export interface ServerScheduleRow {
  id: number;
  scheduleId: number;
  order: number;
  timeLabel: string;
  monday: string;
  tuesday: string;
  wednesday: string;
  thursday: string;
  friday: string;
  updatedAt: string;
}

export interface ServerCalendarLegendCategory {
  id: number;
  label: string;
  color: CalendarColor;
  order: number;
  updatedAt: string;
}

export interface ServerCalendarDayMark {
  id: number;
  date: string;
  categoryId: number;
  updatedAt: string;
}

export interface ServerCustomPage {
  id: number;
  title: string;
  subtitle: string | null;
  template: string;
  content: unknown; // JSON por plantilla — blob opaco para el sync, ver mobile/src/api/customPages.ts
  order: number;
  updatedAt: string;
}

export interface SyncTombstone {
  id: number;
  entityType:
    | "event"
    | "eventException"
    | "task"
    | "subtask"
    | "note"
    | "habit"
    | "habitLog"
    | "transaction"
    | "savingsGoal"
    | "goal"
    | "goalProgress"
    | "project"
    | "projectTask"
    | "projectPage"
    | "schedule"
    | "scheduleRow"
    | "calendarLegendCategory"
    | "calendarDayMark"
    | "customPage";
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
  transactions: ServerTransaction[];
  savingsGoals: ServerSavingsGoal[];
  goals: ServerGoal[];
  goalProgress: ServerGoalProgress[];
  projects: ServerProject[];
  projectTasks: ServerProjectTask[];
  projectPages: ServerProjectPage[];
  schedules: ServerSchedule[];
  scheduleRows: ServerScheduleRow[];
  calendarLegendCategories: ServerCalendarLegendCategory[];
  calendarDayMarks: ServerCalendarDayMark[];
  customPages: ServerCustomPage[];
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
  // Columnas planas del `sharing` recibido en el pull (ver ServerEvent.sharing) — se aplanan en
  // vez de guardarse como un JSON anidado porque son pocas y simples, y así se pueden leer/filtrar
  // directas en SQL si hiciera falta. `sharingRole` es null en el caso normal (sin compartir);
  // `sharingOwnerName`/`sharingOwnerUsername`/`sharingInvitationId` solo se rellenan cuando
  // `sharingRole = 'invitee'` (ver parseEvent en eventsRepo.ts, que las reconstruye en un único
  // `sharing` para las pantallas, igual forma que EventSharing).
  sharingRole: "owner" | "invitee" | null;
  sharingOwnerName: string | null;
  sharingOwnerUsername: string | null;
  sharingInvitationId: number | null;
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

// --- Fase 2 de sync: mismo patrón id/synced/pendingOp que arriba para todo lo que el móvil
// puede CREAR offline. `currentAmount` de SavingsGoal no se guarda (se calcula, ver
// ServerSavingsGoal); `content` de ProjectPage/CustomPage viaja tal cual (blob opaco).

export interface LocalTransaction {
  id: string;
  type: "income" | "expense";
  amount: number;
  category: string;
  description: string | null;
  date: string;
  updatedAt: string;
  synced: 0 | 1;
  pendingOp: "update" | "delete" | null;
}

export interface LocalSavingsGoal {
  id: string;
  name: string;
  type: "ahorro" | "inversion";
  targetAmount: number;
  category: string;
  stepAmount: number;
  deadline: string | null;
  createdAt: string;
  updatedAt: string;
  synced: 0 | 1;
  pendingOp: "update" | "delete" | null;
}

export interface LocalGoal {
  id: string;
  title: string;
  description: string | null;
  period: "weekly" | "monthly" | "annual";
  targetValue: number;
  currentValue: number;
  completed: 0 | 1;
  bonusPoints: number;
  periodStart: string;
  periodEnd: string;
  expired: 0 | 1;
  autoRenew: 0 | 1;
  updatedAt: string;
  synced: 0 | 1;
  pendingOp: "update" | "delete" | null;
}

// A diferencia de HabitLog, SÍ se edita/borra offline (ver goalsService.updateProgress/
// deleteProgress en el backend) — necesita el mismo triple id/synced/pendingOp que una entidad
// creable normal, no la clave compuesta de HabitLog.
export interface LocalGoalProgress {
  id: string;
  goalId: string;
  value: number;
  note: string | null;
  date: string;
  updatedAt: string;
  synced: 0 | 1;
  pendingOp: "update" | "delete" | null;
}

export interface LocalProject {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  deadline: string | null;
  color: string | null;
  updatedAt: string;
  synced: 0 | 1;
  pendingOp: "update" | "delete" | null;
}

export interface LocalProjectTask {
  id: string;
  projectId: string;
  title: string;
  completed: 0 | 1;
  updatedAt: string;
  synced: 0 | 1;
  pendingOp: "update" | "delete" | null;
}

export interface LocalProjectPage {
  id: string;
  projectId: string;
  title: string;
  content: string;
  order: number;
  updatedAt: string;
  synced: 0 | 1;
  pendingOp: "update" | "delete" | null;
}

export interface LocalSchedule {
  id: string;
  name: string;
  order: number;
  updatedAt: string;
  synced: 0 | 1;
  pendingOp: "update" | "delete" | null;
}

export interface LocalScheduleRow {
  id: string;
  scheduleId: string;
  order: number;
  timeLabel: string;
  monday: string;
  tuesday: string;
  wednesday: string;
  thursday: string;
  friday: string;
  updatedAt: string;
  synced: 0 | 1;
  pendingOp: "update" | "delete" | null;
}

export interface LocalCalendarLegendCategory {
  id: string;
  label: string;
  color: CalendarColor;
  order: number;
  updatedAt: string;
  synced: 0 | 1;
  pendingOp: "update" | "delete" | null;
}

// Clave natural (`date`), no un id local generado por el cliente — igual criterio que
// `LocalEventException`, pero esta SÍ se escribe localmente (pintar/despintar un día), así que
// necesita su propio `synced`/`pendingOp` para saber qué subir (ver calendarLegendRepo.ts).
// `categoryId` es el id (local o de servidor, como texto) de `calendar_legend_categories.id`,
// igual que `subtasks.taskId` referencia `tasks.id`.
export interface LocalCalendarDayMark {
  date: string;
  categoryId: string;
  serverId: number | null; // id real de la marca — permite emparejar su tombstone al borrarla en otro dispositivo
  updatedAt: string;
  synced: 0 | 1;
  pendingOp: "upsert" | "delete" | null;
}

export interface LocalCustomPage {
  id: string;
  title: string;
  subtitle: string | null;
  template: string;
  content: unknown;
  order: number;
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
