import { StudyContent, StudyExam, StudyKind, StudyPlanRow, StudySubject, StudyTopic } from "../api/customPages";

// Lógica de datos de la plantilla "estudio" (ver components/StudyPlanner.tsx), separada del componente:
// parseo/formato de duraciones, normalización del JSON y cuentas del plan. Mismo criterio que
// dashboard/src/utils/study.ts.

/**
 * "2", "2h", "2:30", "2h30", "90m", "1,5" (horas, con coma o punto decimal) → minutos enteros; `null` si no se
 * entiende. Cadena vacía = 0 (sin tiempo asignado).
 */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase().replace(",", ".");
  if (t === "") return 0;
  let m = /^(\d+):([0-5]?\d)$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d+)\s*h(?:\s*(\d+)\s*(?:m|min)?)?$/.exec(t);
  if (m) return Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0);
  m = /^(\d+)\s*(?:m|min)$/.exec(t);
  if (m) return Number(m[1]);
  m = /^(\d+(?:\.\d+)?)$/.exec(t);
  if (m) return Math.round(Number(m[1]) * 60);
  return null;
}

/** 5400 s → "1:30" (minutos redondeados hacia abajo); 0 → "0:00". */
export function formatDuration(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** 3725 s → "1:02:05". */
export function formatClock(seconds: number): string {
  const s = Math.floor(Math.max(0, seconds));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export const KIND_LABELS: Record<StudyKind, string> = { study: "Estudio", exercises: "Ejercicios" };

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function nonNegative(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * El `content` llega de un JSON que también escribe la web (o una página recién creada, `{}`): se rellena lo
 * que falte y se descartan entradas sin id para que el resto de la pantalla pueda asumir la forma completa.
 */
export function normalizeStudyContent(raw: unknown): StudyContent {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const arr = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && typeof (x as { id?: unknown }).id === "string") : [];

  const subjects: StudySubject[] = arr(c.subjects).map((s) => ({
    id: s.id as string,
    name: str(s.name),
    topics: arr(s.topics).map(
      (t): StudyTopic => ({ id: t.id as string, name: str(t.name), ...(t.done ? { done: true } : {}) })
    ),
  }));
  const plan: StudyPlanRow[] = arr(c.plan).map((r) => ({
    id: r.id as string,
    subjectId: str(r.subjectId),
    ...(typeof r.topicId === "string" && r.topicId ? { topicId: r.topicId } : {}),
    topicName: str(r.topicName),
    kind: r.kind === "exercises" ? "exercises" : "study",
    plannedMinutes: Math.round(nonNegative(r.plannedMinutes)),
    spentSeconds: Math.round(nonNegative(r.spentSeconds)),
  }));
  const exams: StudyExam[] = arr(c.exams).map((e) => ({
    id: e.id as string,
    title: str(e.title),
    ...(typeof e.subjectId === "string" && e.subjectId ? { subjectId: e.subjectId } : {}),
    date: str(e.date),
    ...(typeof e.time === "string" && e.time ? { time: e.time } : {}),
    ...(e.done ? { done: true } : {}),
  }));
  return { subjects, plan, exams };
}

/** Nombre vivo del tema de una fila (si el tema sigue en el temario) o el texto con el que se creó. */
export function topicNameOf(row: StudyPlanRow, subjects: StudySubject[]): string {
  const subject = subjects.find((s) => s.id === row.subjectId);
  return subject?.topics.find((t) => t.id === row.topicId)?.name ?? row.topicName;
}

/** Segundos reales dedicados a un tema (suma de las filas del plan que apuntan a él). */
export function spentOnTopic(plan: StudyPlanRow[], topicId: string): number {
  return plan.filter((r) => r.topicId === topicId).reduce((sum, r) => sum + r.spentSeconds, 0);
}

/** Segundos reales dedicados a una asignatura (todas sus filas del plan). */
export function spentOnSubject(plan: StudyPlanRow[], subjectId: string): number {
  return plan.filter((r) => r.subjectId === subjectId).reduce((sum, r) => sum + r.spentSeconds, 0);
}

/** Comparación de nombres sin distinguir mayúsculas ni espacios sobrantes (para reutilizar asignaturas/temas ya creados). */
export function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Orden cronológico de los exámenes: fecha y hora (sin hora = a primera hora del día). */
export function sortExams(exams: StudyExam[]): StudyExam[] {
  return [...exams].sort((a, b) => `${a.date} ${a.time ?? "00:00"}`.localeCompare(`${b.date} ${b.time ?? "00:00"}`));
}

/**
 * Fracciones (0..1) de los dos arcos del temporizador a partir del TOTAL acumulado. Con tiempo asignado: rojo
 * hasta llenar el objetivo y, pasado éste, verde por encima (vuelta tras vuelta) con el sobretiempo; sin
 * asignado: un único arco neutro que da una vuelta por hora.
 */
export function timerArcs(totalSeconds: number, plannedMinutes: number): { base: number; over: number; overtimeSeconds: number } {
  if (plannedMinutes > 0) {
    const target = plannedMinutes * 60;
    if (totalSeconds < target) return { base: totalSeconds / target, over: 0, overtimeSeconds: 0 };
    const overtime = totalSeconds - target;
    const laps = overtime / target;
    // Justo en una vuelta completa de sobretiempo se pinta el anillo verde entero (no vacío).
    const over = laps > 0 && laps % 1 === 0 ? 1 : laps % 1;
    return { base: 1, over, overtimeSeconds: overtime };
  }
  return { base: (totalSeconds % 3600) / 3600, over: 0, overtimeSeconds: 0 };
}
