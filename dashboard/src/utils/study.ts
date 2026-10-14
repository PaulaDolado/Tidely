import { StudyContent, StudyPlanRow, StudySubject } from "../types";

// Lógica de datos de la plantilla "estudio" (ver StudyPlannerTemplate), separada del componente: parseo y formato de
// duraciones y cuentas del plan.

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

export function emptyStudyContent(content: Partial<StudyContent> | undefined): StudyContent {
  return { subjects: content?.subjects ?? [], plan: content?.plan ?? [], exams: content?.exams ?? [] };
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
