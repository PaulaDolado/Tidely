export interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

// `username` es un alias de login independiente del email — ambos sirven para iniciar sesión
// (ver SettingsDialog/AppShell/LoginPage). El email requiere verificación (ver `emailVerified`),
// pero el login no la exige: solo se muestra un aviso hasta que se confirme.
export interface User {
  id: number;
  email: string;
  username: string;
  name: string;
  lastName?: string | null;
  timezone?: string;
  emailVerified: boolean;
  // Fecha (ISO) a partir de la cual se puede volver a cambiar el username — null si nunca se
  // cambió o si el cooldown de 15 días ya pasó. Ver SettingsDialog.
  nextUsernameChangeAllowedAt?: string | null;
  // Elegidos en el asistente de bienvenida tras registrarse (ver OnboardingWizard) — controla
  // qué apartados opcionales aparecen en el menú lateral (ver AppShell.tsx). Opcional en el tipo
  // porque `updateUser()` en AuthContext hace parches parciales; en la práctica /auth/me siempre
  // lo manda.
  enabledSections?: EnabledSection[];
  // Si ya completó el asistente de bienvenida — false solo justo tras registrarse una cuenta
  // nueva (ver DashboardPage: mientras sea false, se muestra el asistente en vez de la app).
  onboardingCompleted?: boolean;
}

// Mismos 7 valores que ENABLED_SECTIONS en src/validators/authValidators.ts (backend) — "Hoy" y
// "Agenda" no son opcionales, así que no están aquí.
export const ENABLED_SECTIONS = ["planificador", "horario", "objetivos", "galeria", "finanzas", "metasAhorro", "proyectos"] as const;
export type EnabledSection = (typeof ENABLED_SECTIONS)[number];

// Compartidas entre OnboardingWizard (elegirlos la primera vez, tras registrarse) y SettingsDialog
// (cambiarlos luego desde Ajustes → General) — mismo concepto en dos sitios, una sola fuente para
// no duplicar texto. La etiqueta de "proyectos" dice "Libreta" a propósito, aunque el apartado del
// menú lateral se siga llamando "Proyectos" (ver AppShell.NAV) — el propio README ya llama
// "cuaderno"/"libreta" a esa sección.
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

export interface AuthResponse {
  token: string;
  refreshToken: string;
  user: User;
}

export type RecurringPattern = "daily" | "weekly" | "biweekly" | "monthly" | "weekday_range";

export interface Event {
  id: number;
  title: string;
  description: string | null;
  // Deprecado: ver el mismo comentario en prisma/schema.prisma — la categoría de verdad es
  // `categoryId` (ver EventCategory), esto solo se conserva para eventos antiguos.
  type: string;
  // Categoría del evento (ver Agenda > + Nuevo evento) — null en eventos sin categoría (p.ej.
  // importados por .ics, o cuya categoría se borró).
  categoryId: number | null;
  startTime: string;
  endTime: string;
  location: string | null;
  isRecurring?: boolean;
  recurringPattern?: RecurringPattern | null;
  // Solo con recurringPattern = "weekday_range" (p.ej. de lunes a viernes) — convención ISO
  // 1=lunes..7=domingo, ver el mismo comentario en prisma/schema.prisma.
  recurringWeekdayStart?: number | null;
  recurringWeekdayEnd?: number | null;
  isRecurringInstance?: boolean;
  reminderMinutesBefore: number[];
  guests: string[];
  // Solo en ocurrencias recurrentes: horario "natural" (sin excepción) de esta ocurrencia —
  // necesario para crear/editar la excepción de ESTA ocurrencia concreta (ver EventException).
  originalStartTime?: string;
  isException?: boolean;
  exceptionStatus?: "moved";
  // "google" en los importados por la integración de solo lectura con Google Calendar (ver
  // GoogleCalendarCard en el dashboard) — "tidely" (o ausente, en respuestas antiguas) en el
  // resto. Editar/mover uno de estos desde Tidely no se refleja en Google, y la próxima
  // sincronización lo sobrescribe con la versión de Google.
  source?: "tidely" | "google";
  // Distintivo de "compartido" (ver EventInvitation) — `null` en el caso normal (evento sin
  // compartir con nadie). Si lo ves porque ACEPTASTE una invitación de otra persona (role
  // "invitee"), el evento es de solo lectura para ti: no puedes editarlo ni borrarlo, solo
  // aceptar/rechazar la invitación o quitártelo del calendario del todo (ver
  // EventInvitationsSection en AgendaPage.tsx).
  sharing?: EventSharing | null;
}

export interface PublicUserRef {
  id: number;
  name: string;
  username: string;
}

export type EventSharing =
  | { role: "owner"; with: PublicUserRef[] }
  | { role: "invitee"; owner: PublicUserRef };

export interface EventInvitation {
  id: number;
  eventId: number;
  inviterId: number;
  inviteeId: number;
  status: "pending" | "accepted" | "declined";
  createdAt: string;
  updatedAt: string;
  // Presente en GET /agenda/events/:id/invitations (vista del dueño del evento).
  invitee?: PublicUserRef;
  // Presentes en GET /agenda/invitations (vista de "lo que he recibido").
  inviter?: PublicUserRef;
  event?: { id: number; title: string; startTime: string; endTime: string; location: string | null; isRecurring: boolean };
}

export interface GoogleCalendarStatus {
  connected: boolean;
  email?: string;
  lastSyncedAt?: string | null;
}

export interface GoogleCalendarSyncResult {
  imported: number;
  updated: number;
  removed: number;
}

export interface AgendaResponse {
  week?: string;
  date?: string;
  month?: string;
  year?: string;
  weekStart?: string;
  weekEnd?: string;
  monthStart?: string;
  monthEnd?: string;
  yearStart?: string;
  yearEnd?: string;
  timezone: string;
  events: Event[];
  pagination: Pagination;
}

// Vista anual (ver YearGrid en el dashboard): no trae los eventos completos, solo cuántos hay
// cada día — de sobra para pintar el puntito en la cuadrícula de 12 mini-meses.
export interface AgendaYearResponse {
  year: string;
  timezone: string;
  counts: Record<string, number>;
}

export interface FreeBlock {
  start: string;
  end: string;
  durationMinutes: number;
}

export interface FreeTimeSuggestion {
  block: { start: string; end: string };
  task: { id: number; title: string; estimatedMinutes: number };
}

export interface FreeTimeResponse {
  date: string;
  timezone: string;
  freeBlocks: FreeBlock[];
  suggestions: FreeTimeSuggestion[];
}

export interface Habit {
  id: number;
  title: string;
  streak: number;
  completedDates: string[]; // YYYY-MM-DD, últimos 30 días con marca
}

export interface Note {
  id: number;
  content: string;
  checked: boolean;
  createdAt: string;
}

export type TaskStatus = "todo" | "in_progress" | "done";
export type TaskPriority = "low" | "medium" | "high";

export interface Subtask {
  id: number;
  title: string;
  completed: boolean;
}

// Columna personalizada definida por el usuario — mismo concepto en dos sitios (Planner y el
// kanban de páginas personalizadas), por eso vive aquí compartido en vez de duplicado. `options`
// solo se usa con type "select". El valor real de cada tarea/tarjeta para un field es un
// `CustomFieldValue`, guardado en un mapa `{ [fieldId]: valor }`.
export type CustomFieldType = "text" | "number" | "date" | "select";

export interface CustomFieldDef {
  id: string;
  name: string;
  type: CustomFieldType;
  options?: string[];
}

export type CustomFieldValue = string | number | null;
export type CustomFieldValues = Record<string, CustomFieldValue>;

// Tablero de planificador con nombre propio — el usuario puede tener varios (ver Planner en el
// backend), mismo patrón que Schedule más abajo.
export interface Planner {
  id: number;
  name: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

// Columna personalizada de UN planner concreto (ver PlannerField en el backend) — a diferencia de
// CustomFieldDef (id de tipo string, usado en el kanban de páginas personalizadas cuyo contenido
// es JSON de cliente), aquí el id es un entero real de la base de datos.
export interface PlannerField {
  id: number;
  plannerId: number;
  name: string;
  type: CustomFieldType;
  options: string[];
  order: number;
}

export interface Task {
  id: number;
  plannerId: number;
  title: string;
  description: string | null;
  // Foto embebida como data URL (ver TaskDetailDialog en el dashboard).
  image: string | null;
  // Recuadro grande sin nombre del diálogo de detalles — texto libre aparte de `description`.
  notes: string | null;
  // Vista "compacta" de la tarjeta en el tablero (ver TaskCard): imagen a la izquierda, título/
  // descripción a la derecha, en vez de la imagen a ancho completo encima del texto. Sin efecto
  // si la tarjeta no tiene imagen.
  compact: boolean;
  status: TaskStatus;
  priority: TaskPriority;
  order: number;
  dueDate: string | null;
  tags: string[];
  estimatedMinutes: number | null;
  actualMinutes: number;
  projectId: number | null;
  subtasks: Subtask[];
  customFields: CustomFieldValues;
}

export type GoalStatus = "active" | "completed" | "expired" | "all";

export interface Goal {
  id: number;
  title: string;
  description: string | null;
  period: "weekly" | "monthly" | "annual";
  targetValue: number;
  currentValue: number;
  completed: boolean;
  expired: boolean;
  autoRenew: boolean;
  bonusPoints: number;
  periodStart: string;
  periodEnd: string;
}

export interface Transaction {
  id: number;
  type: "income" | "expense";
  amount: number;
  category: string;
  description: string | null;
  date: string;
}

export interface MonthlyBalance {
  month: number;
  year: number;
  income: number;
  expense: number;
  balance: number;
}

export interface FinanceAnalytics {
  month: number;
  year: number;
  topCategories: { category: string; total: number }[];
  monthlyTrend: MonthlyBalance[];
  projectedAnnual: {
    basedOnMonths: number;
    avgMonthlyBalance: number;
    projectedYearEnd: number;
  };
}

// Ver GET /finance/surplus/:month/:year — dinero acumulado en meses ANTERIORES al indicado (el
// mes en curso queda fuera, ver financeService.getAvailableSurplus) que todavía no está
// comprometido en ninguna meta de ahorro.
export interface AvailableSurplus {
  month: number;
  year: number;
  totalBalance: number;
  committedToGoals: number;
  availableSurplus: number;
}

export interface SavingsGoal {
  id: number;
  name: string;
  type: "ahorro" | "inversion";
  targetAmount: number;
  currentAmount: number;
  progressPercent: number;
  stepAmount: number;
  category: string;
  deadline: string | null;
  createdAt: string;
}

export interface ProjectTask {
  id: number;
  title: string;
  completed: boolean;
}

// Color de la "carpeta" del proyecto en la galería (ver NotebookCover en ProyectosPage.tsx) — los
// tres tonos sólidos de la paleta cálida del sistema de diseño (--cover, --secondary/sand,
// --primary/sage). `null` en proyectos creados antes de que existiera este campo: la galería cae
// entonces a la rotación por índice de siempre en vez de a un color fijo.
export type ProjectColor = "cover" | "sand" | "sage";

export interface Project {
  id: number;
  title: string;
  description: string | null;
  status: "idea" | "en_curso" | "pausado" | "completado";
  priority: "low" | "medium" | "high";
  deadline: string | null;
  color: ProjectColor | null;
  tasks?: ProjectTask[];
  progress?: { total: number; completed: number; percent: number };
}

// Página de la libreta de un proyecto: contenido enriquecido (HTML) al estilo de un documento
// de texto — listas, negrita/cursiva, imágenes embebidas como data URL.
export interface ProjectPage {
  id: number;
  projectId: number;
  title: string;
  content: string;
  order: number;
}

export interface Notification {
  id: number;
  type: "event_reminder" | "goal_at_risk" | "task_due";
  title: string;
  message: string;
  relatedId: number | null;
  read: boolean;
  createdAt: string;
}

export interface RecentProjectEntry {
  id: number;
  projectId: number;
  projectTitle: string;
  pageTitle: string;
  preview: string;
  updatedAt: string;
}

export interface TodayResponse {
  date: string;
  timezone: string;
  events: Event[];
  tasksDueToday: Task[];
  habits: Habit[];
  notes: Note[];
  recentProjectEntries: RecentProjectEntry[];
  combinedStreak: number;
}

export interface SearchResults {
  query: string;
  events: { id: number; title: string; startTime: string; isRecurring: boolean }[];
  tasks: { id: number; title: string; status: TaskStatus; plannerId: number }[];
  notes: { id: number; content: string }[];
  projects: { id: number; title: string; status: Project["status"] }[];
}

export interface IcsImportResult {
  created: number;
  skippedUnparsable: number;
  importedAsSingleOccurrence: number;
}

// Páginas personalizadas ("+ Nueva página" en el menú lateral, ver AppShell/CreatePageModal).
// Cada `template` determina la forma de `content` — el dashboard interpreta cada una con su
// propio componente (ver CustomPageView).
export type CustomPageTemplate = "nota" | "kanban" | "galeria" | "finanzas" | "proyectos" | "objetivos" | "agenda" | "hoy";

// Fila devuelta por GET /custom-pages (lista para el menú) — sin `content`, que solo llega en el
// detalle (GET /custom-pages/:id) para no cargar el JSON completo de cada página solo para pintar
// el menú.
export interface CustomPageSummary {
  id: number;
  title: string;
  // Línea editable bajo el título (ver CustomPagePage) — null si el usuario no ha escrito una,
  // en cuyo caso se muestra el icono+nombre de la plantilla como valor por defecto.
  subtitle: string | null;
  // Emoji propio de la página — null si el usuario no ha elegido uno, en cuyo caso se muestra el
  // de la plantilla (CUSTOM_PAGE_TEMPLATE_META[template].icon) como valor por defecto, mismo
  // criterio que `subtitle`.
  icon: string | null;
  template: CustomPageTemplate;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface KanbanCard {
  id: string;
  text: string;
  // Imagen embebida como data URL (igual que RichTextEditor.insertImage) — null/undefined si la
  // tarjeta no tiene ninguna. No es una URL a un archivo aparte: vive dentro del propio JSON de
  // CustomPage.content, así que "añadir/actualizar/eliminar" es solo sobrescribir este campo.
  image?: string | null;
  // Resumen corto opcional (ver KanbanCardDialog) — mismo papel que Task.description en el
  // Planificador: un vistazo rápido, distinto del recuadro grande de `notes`.
  description?: string;
  // Recuadro grande SIN nombre del diálogo de detalles de la tarjeta (ver KanbanCardDialog en el
  // dashboard) — mismo campo/idea que Task.notes en el Planificador, pero aquí vive dentro del
  // propio JSON de CustomPage.content, igual que `image`.
  notes?: string | null;
  // Vista "compacta" de la tarjeta en el tablero (ver KanbanCardItem): imagen a la izquierda,
  // título/descripción a la derecha, en vez de la imagen a ancho completo encima del texto. Sin
  // efecto si la tarjeta no tiene imagen. Vive en el propio JSON, igual que `image`/`notes`.
  compact?: boolean;
  // Valores de las columnas personalizadas del tablero (ver CustomPageContentMap["kanban"].fieldDefs
  // más abajo), indexados por CustomFieldDef.id.
  fields?: CustomFieldValues;
}

export interface KanbanColumn {
  id: string;
  title: string;
  cards: KanbanCard[];
}

// Una entrada de la Galería (ver GalleryTemplate en CustomPagePage): foto y/o texto libre, ambos
// opcionales — puede ser solo una foto, solo una nota, o las dos cosas. `imageData` es una data
// URL embebida (mismo patrón que KanbanCard.image), no una fila propia: vive dentro del JSON de
// CustomPage.content, así que "id" es un uuid generado en el cliente (ver newId), no un id de fila.
export interface GalleryEntry {
  id: string;
  title?: string;
  text?: string;
  imageData?: string | null;
}

export interface FinanceEntry {
  id: string;
  type: "income" | "expense";
  amount: number;
  category: string;
  description: string;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface SimpleGoal {
  id: string;
  title: string;
  target: number;
  current: number;
}

export interface AgendaNote {
  id: string;
  date: string; // YYYY-MM-DD
  text: string;
}

// Forma de `content` según `template` — union discriminada a mano (no hay un campo `type` dentro
// del propio JSON: quien discrimina es el `template` de la página que lo contiene).
export interface CustomPageContentMap {
  nota: { html: string };
  // `fieldDefs` es opcional (páginas creadas antes de esta función no lo tienen) — tratar como
  // `?? []` al leerlo, ver KanbanTemplate.
  kanban: { columns: KanbanColumn[]; fieldDefs?: CustomFieldDef[] };
  galeria: { items: GalleryEntry[] };
  finanzas: { entries: FinanceEntry[] };
  proyectos: { items: ChecklistItem[] };
  objetivos: { goals: SimpleGoal[] };
  agenda: { items: AgendaNote[] };
  hoy: { items: ChecklistItem[] };
}

export interface CustomPage extends CustomPageSummary {
  content: CustomPageContentMap[CustomPageTemplate];
}

// Horario con nombre propio (Agenda > Horario) — el usuario puede tener varios (uno por
// trimestre/semestre) y verlos apilados o de uno en uno con flechas (ver SchedulePage).
export interface Schedule {
  id: number;
  name: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

// Fila de un Schedule — sin fechas, texto libre (multilínea) por día.
export interface ScheduleRow {
  id: number;
  order: number;
  timeLabel: string;
  monday: string;
  tuesday: string;
  wednesday: string;
  thursday: string;
  friday: string;
}

// Colores disponibles para la leyenda del calendario anual — igual paleta que el resto de la
// app (ver CALENDAR_COLOR_CLASSES en el dashboard y CALENDAR_COLORS en el backend).
export type CalendarColor = "primary" | "secondary" | "habit" | "hobby" | "positive" | "negative" | "warning" | "muted";

// Categoría de la leyenda del calendario anual (Horario > vista anual) — compartida para toda la
// cuenta, no por horario/trimestre.
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
// eventos en vez de días del calendario anual.
export interface EventCategory {
  id: number;
  label: string;
  color: CalendarColor;
  order: number;
}
