// Forma del fichero `prisma/fixtures/demoUser.json` — el "snapshot" completo del usuario demo,
// generado por `exportDemoUser.ts` y consumido por `seed.ts` para recrear esa misma cuenta en
// cualquier máquina (ver comentario de cabecera en ambos ficheros).
//
// Interfaces a mano, NO `import demoUser from "./fixtures/demoUser.json"` con `resolveJsonModule`:
// TypeScript infiere el tipo de un JSON importado a partir del CONTENIDO actual del fichero — si
// ahora mismo, por ejemplo, no hay ninguna SavingsGoal, el array se infiere como `never[]` y el
// build se rompe (no por un cambio de código, sino porque los datos de hoy están vacíos). Con
// interfaces fijas más `JSON.parse` a mano, el fichero puede tener cualquier contenido (incluidos
// arrays vacíos) sin afectar a la compilación.
//
// Todas las fechas van como string ISO (lo que produce `JSON.stringify` sobre un `Date`) y todos
// los `Decimal` de Prisma (Transaction/SavingsGoal) como string (su propio `toJSON`) — ambos se
// pasan tal cual a los `create` de Prisma, que aceptan los dos formatos.

export interface DemoUserProfile {
  email: string;
  username: string;
  name: string;
  lastName: string | null;
  timezone: string;
}

export interface DemoEvent {
  id: number;
  title: string;
  description: string | null;
  type: string;
  startTime: string;
  endTime: string;
  location: string | null;
  isRecurring: boolean;
  recurringPattern: string | null;
  recurringWeekdayStart: number | null;
  recurringWeekdayEnd: number | null;
  reminderMinutesBefore: number[];
  guests: string[];
  source: string;
}

export interface DemoEventException {
  eventId: number;
  originalStartTime: string;
  status: string;
  newStartTime: string | null;
  newEndTime: string | null;
}

export interface DemoGoal {
  id: number;
  title: string;
  description: string | null;
  period: string;
  targetValue: number;
  currentValue: number;
  completed: boolean;
  bonusPoints: number;
  periodStart: string;
  periodEnd: string;
  expired: boolean;
  autoRenew: boolean;
}

export interface DemoGoalProgress {
  goalId: number;
  value: number;
  date: string;
  note: string | null;
}

export interface DemoTransaction {
  type: string;
  amount: string;
  category: string;
  description: string | null;
  date: string;
}

export interface DemoSavingsGoal {
  name: string;
  type: string;
  targetAmount: string;
  currentAmount: string;
  category: string;
  stepAmount: string;
  deadline: string | null;
}

export interface DemoProject {
  id: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  deadline: string | null;
}

export interface DemoProjectPage {
  projectId: number;
  title: string;
  content: string;
  order: number;
}

export interface DemoProjectTask {
  projectId: number;
  title: string;
  completed: boolean;
  completedAt: string | null;
}

export interface DemoPlanner {
  id: number;
  name: string;
  order: number;
}

export interface DemoPlannerField {
  id: number;
  plannerId: number;
  name: string;
  type: string;
  options: string[];
  order: number;
}

export interface DemoTask {
  id: number;
  plannerId: number;
  projectId: number | null;
  title: string;
  description: string | null;
  image: string | null;
  notes: string | null;
  status: string;
  priority: string;
  order: number;
  dueDate: string | null;
  tags: string[];
  estimatedMinutes: number | null;
  actualMinutes: number;
  // Objeto plano { [plannerFieldId]: valor } — las claves son ids de PlannerField y hay que
  // remapearlas igual que `plannerId`/`projectId` (ver seed.ts).
  customFields: Record<string, string | number | null>;
}

export interface DemoSubtask {
  taskId: number;
  title: string;
  completed: boolean;
}

export interface DemoNote {
  content: string;
  checked: boolean;
}

export interface DemoHabit {
  id: number;
  title: string;
  active: boolean;
}

export interface DemoHabitLog {
  habitId: number;
  date: string;
}

export interface DemoCustomPage {
  title: string;
  subtitle: string | null;
  template: string;
  order: number;
  // Blob de cliente (columnas/tarjetas del kanban, entradas de finanzas...) — los ids que lleve
  // dentro son strings generados en el cliente (uuid), no ids de esta base de datos, así que no
  // necesitan remapeo al importar.
  content: Record<string, unknown>;
}

export interface DemoSchedule {
  id: number;
  name: string;
  order: number;
}

export interface DemoScheduleRow {
  scheduleId: number;
  order: number;
  timeLabel: string;
  monday: string;
  tuesday: string;
  wednesday: string;
  thursday: string;
  friday: string;
}

export interface DemoCalendarLegendCategory {
  id: number;
  label: string;
  color: string;
  order: number;
}

export interface DemoCalendarDayMark {
  categoryId: number;
  date: string;
}

export interface DemoUserFixture {
  // Cuándo se generó este snapshot — solo informativo (se muestra en el log del seed).
  exportedAt: string;
  user: DemoUserProfile;
  events: DemoEvent[];
  eventExceptions: DemoEventException[];
  goals: DemoGoal[];
  goalProgress: DemoGoalProgress[];
  transactions: DemoTransaction[];
  savingsGoals: DemoSavingsGoal[];
  projects: DemoProject[];
  projectPages: DemoProjectPage[];
  projectTasks: DemoProjectTask[];
  planners: DemoPlanner[];
  plannerFields: DemoPlannerField[];
  tasks: DemoTask[];
  subtasks: DemoSubtask[];
  notes: DemoNote[];
  habits: DemoHabit[];
  habitLogs: DemoHabitLog[];
  customPages: DemoCustomPage[];
  schedules: DemoSchedule[];
  scheduleRows: DemoScheduleRow[];
  calendarLegendCategories: DemoCalendarLegendCategory[];
  calendarDayMarks: DemoCalendarDayMark[];
}
