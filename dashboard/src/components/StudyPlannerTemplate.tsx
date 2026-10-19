import { FormEvent, useEffect, useId, useMemo, useState } from "react";
import { DeleteButton, DialogShell } from "./DialogShell";
import { newId } from "../utils/id";
import { emptyStudyContent, formatClock, formatDuration, parseDuration, spentOnSubject, spentOnTopic, topicNameOf } from "../utils/study";
import { StudyContent, StudyExam, StudyKind, StudyPlanRow, StudySubject } from "../types";

// Plantilla "estudio" de las páginas personalizadas (ver CustomPagePage): una tabla con el plan (asignatura, tema,
// tiempo asignado y tiempo real) con un temporizador circular a su lado, debajo del temporizador la lista de
// exámenes próximos y, más abajo, una tabla por asignatura con todos los temas de su temario. Todo vive en `content`
// ({ subjects, plan, exams }); este componente es "controlado": recibe su parte del contenido y devuelve el objeto
// completo actualizado vía `onChange`.

const KIND_LABELS: Record<StudyKind, string> = { study: "Estudio", exercises: "Ejercicios" };
const fieldLabel = "flex flex-col gap-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground";
const plusButton =
  "flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full bg-foreground text-sm leading-none text-background transition-opacity hover:opacity-80";
const sectionTitle = "text-xs font-medium uppercase tracking-widest text-muted-foreground";

// Estado del temporizador, aparte del contenido: solo dice QUÉ fila está cargada y desde cuándo corre (marca de
// tiempo), así recargar la página con el reloj en marcha no pierde nada. El tiempo ya acumulado vive en la propia
// fila (spentSeconds), que se actualiza al pausar.
interface TimerState {
  rowId: string | null;
  runningSince: number | null;
}

function readTimer(key: string): TimerState {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "null") as Partial<TimerState> | null;
    if (raw && (typeof raw.rowId === "string" || raw.rowId === null) && (typeof raw.runningSince === "number" || raw.runningSince === null)) {
      return { rowId: raw.rowId ?? null, runningSince: raw.runningSince ?? null };
    }
  } catch {
    // localStorage no disponible o valor corrupto: se empieza sin nada cargado
  }
  return { rowId: null, runningSince: null };
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysUntil(dateKey: string): number {
  return Math.round((Date.parse(`${dateKey}T00:00:00Z`) - Date.parse(`${todayKey()}T00:00:00Z`)) / 86_400_000);
}

export function StudyPlannerTemplate({ pageId, content, onChange }: { pageId: number; content: Partial<StudyContent>; onChange: (content: StudyContent) => void }) {
  const { subjects, plan, exams } = emptyStudyContent(content);
  const timerKey = `tidely.study.timer.${pageId}`;

  const [timer, setTimer] = useState<TimerState>(() => readTimer(timerKey));
  const [now, setNow] = useState(() => Date.now());
  const [planDialog, setPlanDialog] = useState<{ rowId: string | null } | null>(null);
  const [examDialog, setExamDialog] = useState<{ examId: string | null } | null>(null);

  const update = (patch: Partial<StudyContent>) => onChange({ subjects, plan, exams, ...patch });

  useEffect(() => {
    try {
      localStorage.setItem(timerKey, JSON.stringify(timer));
    } catch {
      // sin localStorage el reloj funciona igual, solo que no sobrevive a una recarga
    }
  }, [timer, timerKey]);

  // Mientras corre, repinta cada 250 ms para que los segundos avancen y el círculo se mueva.
  useEffect(() => {
    if (timer.runningSince === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [timer.runningSince]);

  const selectedRow = plan.find((r) => r.id === timer.rowId) ?? null;

  // Si la fila cargada se borró, el temporizador se descarga (y se suelta el reloj si corría).
  useEffect(() => {
    if (timer.rowId !== null && !selectedRow) setTimer({ rowId: null, runningSince: null });
  }, [timer.rowId, selectedRow]);

  const runningSeconds = timer.runningSince !== null ? Math.max(0, (now - timer.runningSince) / 1000) : 0;

  // Suma al tiempo real de una fila lo que lleva corriendo el reloj (al pausar, cambiar de fila o ajustar a mano).
  const withSpent = (rowId: string, seconds: number): StudyPlanRow[] =>
    plan.map((r) => (r.id === rowId ? { ...r, spentSeconds: Math.max(0, r.spentSeconds + Math.round(seconds)) } : r));

  const startTimer = () => {
    if (selectedRow) setTimer({ rowId: selectedRow.id, runningSince: Date.now() });
  };

  const pauseTimer = () => {
    if (!selectedRow || timer.runningSince === null) return;
    update({ plan: withSpent(selectedRow.id, (Date.now() - timer.runningSince) / 1000) });
    setTimer({ rowId: selectedRow.id, runningSince: null });
  };

  const selectRow = (rowId: string) => {
    if (rowId === timer.rowId) return;
    // Si el reloj corría en otra fila, se guarda lo que llevaba antes de cambiar.
    if (selectedRow && timer.runningSince !== null) update({ plan: withSpent(selectedRow.id, (Date.now() - timer.runningSince) / 1000) });
    setTimer({ rowId, runningSince: null });
  };

  const resetTimer = () => {
    if (!selectedRow) return;
    update({ plan: plan.map((r) => (r.id === selectedRow.id ? { ...r, spentSeconds: 0 } : r)) });
    setTimer({ rowId: selectedRow.id, runningSince: null });
  };

  const savePlanRow = (rowId: string | null, values: { subjectName: string; topicName: string; kind: StudyKind; plannedMinutes: number; spentSeconds: number | null }) => {
    let nextSubjects = subjects;
    // La asignatura y el tema nuevos pasan a formar parte del temario (se crean si no existían).
    let subject = nextSubjects.find((s) => s.name.trim().toLowerCase() === values.subjectName.trim().toLowerCase());
    if (!subject) {
      subject = { id: newId(), name: values.subjectName.trim(), topics: [] };
      nextSubjects = [...nextSubjects, subject];
    }
    let topic = subject.topics.find((t) => t.name.trim().toLowerCase() === values.topicName.trim().toLowerCase());
    if (!topic) {
      topic = { id: newId(), name: values.topicName.trim() };
      const withTopic: StudySubject = { ...subject, topics: [...subject.topics, topic] };
      nextSubjects = nextSubjects.map((s) => (s.id === subject?.id ? withTopic : s));
    }
    const existing = rowId ? plan.find((r) => r.id === rowId) : undefined;
    const row: StudyPlanRow = {
      id: existing?.id ?? newId(),
      subjectId: subject.id,
      topicId: topic.id,
      topicName: topic.name,
      kind: values.kind,
      plannedMinutes: values.plannedMinutes,
      spentSeconds: values.spentSeconds ?? existing?.spentSeconds ?? 0,
    };
    update({ subjects: nextSubjects, plan: existing ? plan.map((r) => (r.id === existing.id ? row : r)) : [...plan, row] });
    setPlanDialog(null);
  };

  const removePlanRow = (rowId: string) => {
    update({ plan: plan.filter((r) => r.id !== rowId) });
    setPlanDialog(null);
  };

  const saveExam = (examId: string | null, values: Omit<StudyExam, "id">) => {
    update({ exams: examId === null ? [...exams, { id: newId(), ...values }] : exams.map((e) => (e.id === examId ? { ...e, ...values } : e)) });
    setExamDialog(null);
  };

  const subjectOf = (id: string | undefined) => subjects.find((s) => s.id === id);
  const editingRow = planDialog?.rowId ? plan.find((r) => r.id === planDialog.rowId) : undefined;
  const editingExam = examDialog?.examId ? exams.find((e) => e.id === examDialog.examId) : undefined;
  const totalPlanned = plan.reduce((sum, r) => sum + r.plannedMinutes * 60, 0);
  const totalSpent = plan.reduce((sum, r) => sum + r.spentSeconds, 0);

  return (
    <div>
      {/* En pantalla ancha: a la izquierda el plan y, justo debajo, el temario; a la derecha el temporizador y los
          exámenes, ocupando las dos filas. La primera fila es `auto` y la del lateral no la estira (los elementos que
          abarcan una pista flexible no cuentan para las `auto`), así que el plan mide lo que sus filas y el temario
          empieza nada más acabar, tenga 1 asignatura o 10. En una sola columna el orden es plan, lateral, temario. */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] xl:grid-rows-[auto_1fr] xl:items-start">
        {/* Plan de estudio: asignatura, tema, tipo, tiempo asignado y tiempo real */}
        <section className="card-soft min-w-0 xl:col-start-1 xl:row-start-1">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className={sectionTitle}>Plan de estudio</h2>
            <button type="button" onClick={() => setPlanDialog({ rowId: null })} aria-label="Añadir al plan" title="Añadir un tema al plan" className={plusButton}>
              +
            </button>
          </div>

          {plan.length === 0 ? (
            <p className="text-sm text-muted-foreground">Añade con el + la asignatura, el tema y el tiempo que quieres dedicarle al estudio o a los ejercicios.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[28rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Asignatura</th>
                    <th className="py-2 pr-3 font-medium">Tema</th>
                    <th className="py-2 pr-3 font-medium">Tipo</th>
                    <th className="py-2 pr-3 text-right font-medium">Asignado</th>
                    <th className="py-2 pr-3 text-right font-medium">Real</th>
                    <th className="w-24 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {plan.map((row) => {
                    const selected = row.id === timer.rowId;
                    const liveSpent = row.spentSeconds + (selected ? runningSeconds : 0);
                    const over = row.plannedMinutes > 0 && liveSpent > row.plannedMinutes * 60;
                    return (
                      <tr key={row.id} className={`group border-b border-border last:border-b-0 ${selected ? "bg-primary/5" : ""}`}>
                        <td className="py-2.5 pr-3 font-medium [overflow-wrap:anywhere]">{subjectOf(row.subjectId)?.name ?? "—"}</td>
                        <td className="py-2.5 pr-3 [overflow-wrap:anywhere]">{topicNameOf(row, subjects)}</td>
                        <td className="py-2.5 pr-3 text-muted-foreground">{KIND_LABELS[row.kind]}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{row.plannedMinutes > 0 ? formatDuration(row.plannedMinutes * 60) : "—"}</td>
                        <td className={`py-2.5 pr-3 text-right tabular-nums ${over ? "font-medium text-positive" : ""}`}>{formatDuration(liveSpent)}</td>
                        <td className="py-2.5 text-right">
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => selectRow(row.id)}
                              aria-label={`Cargar ${topicNameOf(row, subjects)} en el temporizador`}
                              title="Cargar en el temporizador"
                              className={`cursor-pointer rounded-full px-2 py-1 text-xs ${selected ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                            >
                              ▶
                            </button>
                            <button
                              type="button"
                              onClick={() => setPlanDialog({ rowId: row.id })}
                              aria-label={`Editar ${topicNameOf(row, subjects)}`}
                              title="Editar"
                              className="cursor-pointer rounded px-1.5 py-1 text-xs text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                            >
                              ✎
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="text-xs text-muted-foreground">
                    <td colSpan={3} className="pt-3 font-medium uppercase tracking-widest">
                      Total
                    </td>
                    <td className="pt-3 pr-3 text-right tabular-nums">{formatDuration(totalPlanned)}</td>
                    <td className="pt-3 pr-3 text-right tabular-nums">{formatDuration(totalSpent + runningSeconds)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

        {/* Lateral: temporizador y, debajo, los exámenes próximos */}
        <div className="space-y-6 xl:col-start-2 xl:row-span-2 xl:row-start-1">
          <StudyTimer
            topic={selectedRow ? topicNameOf(selectedRow, subjects) : null}
            subject={selectedRow ? (subjectOf(selectedRow.subjectId)?.name ?? "") : ""}
            spentSeconds={selectedRow?.spentSeconds ?? 0}
            runningSeconds={runningSeconds}
            running={timer.runningSince !== null}
            targetSeconds={(selectedRow?.plannedMinutes ?? 0) * 60}
            onStart={startTimer}
            onPause={pauseTimer}
            onReset={resetTimer}
          />

          <section className="card-soft">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className={sectionTitle}>Exámenes próximos</h2>
              <button type="button" onClick={() => setExamDialog({ examId: null })} aria-label="Añadir examen" title="Añadir un examen" className={plusButton}>
                +
              </button>
            </div>
            <ExamList
              exams={exams}
              subjects={subjects}
              onToggle={(id) => update({ exams: exams.map((e) => (e.id === id ? { ...e, done: !e.done } : e)) })}
              onRemove={(id) => update({ exams: exams.filter((e) => e.id !== id) })}
              onEdit={(id) => setExamDialog({ examId: id })}
            />
          </section>
        </div>

        {/* Temario: una tabla por asignatura con todos sus temas, justo debajo del plan */}
        {subjects.length > 0 && (
          <div className="grid min-w-0 gap-6 md:grid-cols-2 xl:col-start-1 xl:row-start-2 2xl:grid-cols-3">
            {subjects.map((subject) => (
              <SubjectCard
                key={subject.id}
                subject={subject}
                plan={plan}
                onChange={(next) => update({ subjects: subjects.map((s) => (s.id === next.id ? next : s)), plan: plan.map((r) => (r.topicId && !next.topics.some((t) => t.id === r.topicId) && r.subjectId === next.id ? { ...r, topicId: undefined } : r)) })}
                onRemove={() =>
                  update({
                    subjects: subjects.filter((s) => s.id !== subject.id),
                    plan: plan.filter((r) => r.subjectId !== subject.id),
                    exams: exams.map((e) => (e.subjectId === subject.id ? { ...e, subjectId: undefined } : e)),
                  })
                }
              />
            ))}
          </div>
        )}
      </div>

      {planDialog && (
        <PlanDialog
          key={planDialog.rowId ?? "new"}
          row={editingRow}
          subjects={subjects}
          onSave={(values) => savePlanRow(planDialog.rowId, values)}
          onRemove={editingRow ? () => removePlanRow(editingRow.id) : undefined}
          onClose={() => setPlanDialog(null)}
        />
      )}
      {examDialog && (
        <ExamDialog key={examDialog.examId ?? "new"} exam={editingExam} subjects={subjects} onSave={(values) => saveExam(examDialog.examId, values)} onClose={() => setExamDialog(null)} />
      )}
    </div>
  );
}

const RING_SIZE = 200;
const RING_RADIUS = 84;
const RING_STROKE = 12;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

// Círculo del temporizador: con tiempo asignado se llena en ROJO hasta cumplirlo y, al pasarlo, sigue avanzando en
// VERDE sobre el círculo rojo ya completo (una vuelta por cada "asignado" de más); sin tiempo asignado, un círculo
// neutro que se llena cada hora y marca lo acumulado.
function TimerRing({ totalSeconds, targetSeconds }: { totalSeconds: number; targetSeconds: number }) {
  const hasTarget = targetSeconds > 0;
  const overtime = hasTarget ? Math.max(0, totalSeconds - targetSeconds) : 0;
  const base = hasTarget ? Math.min(1, totalSeconds / targetSeconds) : (totalSeconds % 3600) / 3600;
  const lap = overtime > 0 ? (overtime / targetSeconds) % 1 || 1 : 0;
  const arc = (fraction: number) => `${fraction * RING_LENGTH} ${RING_LENGTH}`;
  const common = { cx: RING_SIZE / 2, cy: RING_SIZE / 2, r: RING_RADIUS, fill: "none", strokeWidth: RING_STROKE, strokeLinecap: "round" as const };

  return (
    <svg viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} className="size-full -rotate-90" aria-hidden="true">
      <circle {...common} stroke="var(--muted)" />
      {base > 0 && <circle {...common} stroke={hasTarget ? "var(--destructive)" : "var(--primary)"} strokeDasharray={arc(base)} />}
      {lap > 0 && <circle {...common} stroke="var(--positive)" strokeDasharray={arc(lap)} />}
    </svg>
  );
}

function ConfirmButton({ label, confirmLabel, onConfirm, disabled }: { label: string; confirmLabel: string; onConfirm: () => void; disabled?: boolean }) {
  // Confirmación "clic otra vez" (no window.confirm), igual que DeleteButton.
  const [confirming, setConfirming] = useState(false);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => (confirming ? (setConfirming(false), onConfirm()) : setConfirming(true))}
      onBlur={() => setConfirming(false)}
      className={`cursor-pointer rounded-full px-4 py-2 text-xs transition-colors disabled:cursor-default disabled:opacity-40 ${
        confirming ? "bg-destructive text-destructive-foreground" : "border border-border text-muted-foreground hover:text-destructive"
      }`}
    >
      {confirming ? confirmLabel : label}
    </button>
  );
}

function StudyTimer({
  topic,
  subject,
  spentSeconds,
  runningSeconds,
  running,
  targetSeconds,
  onStart,
  onPause,
  onReset,
}: {
  topic: string | null;
  subject: string;
  spentSeconds: number; // tiempo real ya guardado del tema
  runningSeconds: number; // lo que lleva corriendo el reloj desde que se pulsó Iniciar
  running: boolean;
  targetSeconds: number; // tiempo asignado, en segundos (0 = sin asignar)
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
}) {
  const total = spentSeconds + runningSeconds;
  const overtime = targetSeconds > 0 ? Math.max(0, total - targetSeconds) : 0;

  return (
    <section className="card-soft flex flex-col items-center text-center">
      <h2 className={`${sectionTitle} mb-1 self-start`}>Temporizador</h2>
      <p className="mt-2 min-h-[1.5rem] w-full truncate font-serif text-xl" title={topic ?? undefined}>
        {topic ?? "Sin tema cargado"}
      </p>
      <p className="min-h-[1rem] w-full truncate text-xs text-muted-foreground">{topic ? subject : "Pulsa ▶ en una fila del plan"}</p>

      <div className="relative my-5 size-52 max-w-full">
        <TimerRing totalSeconds={total} targetSeconds={targetSeconds} />
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`font-serif text-3xl tabular-nums ${overtime > 0 ? "text-positive" : ""}`} aria-live="off">
            {formatClock(total)}
          </span>
          {targetSeconds > 0 ? (
            <span className="mt-1 text-xs text-muted-foreground">de {formatDuration(targetSeconds)}</span>
          ) : (
            <span className="mt-1 text-xs text-muted-foreground">{topic ? "sin tiempo asignado" : ""}</span>
          )}
          {overtime > 0 && <span className="mt-0.5 text-xs font-medium text-positive">+{formatClock(overtime)}</span>}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {running ? (
          <button type="button" onClick={onPause} className="btn-dark">
            ❚❚ Pausar
          </button>
        ) : (
          <button type="button" onClick={onStart} disabled={!topic} className="btn-dark disabled:opacity-40">
            ▶ {spentSeconds > 0 ? "Reanudar" : "Iniciar"}
          </button>
        )}
        <ConfirmButton label="Reiniciar" confirmLabel="¿Poner el tiempo real a 0?" onConfirm={onReset} disabled={!topic || (spentSeconds === 0 && !running)} />
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">El tiempo se guarda en «Real» al pausar.</p>
    </section>
  );
}

function ExamList({
  exams,
  subjects,
  onToggle,
  onRemove,
  onEdit,
}: {
  exams: StudyExam[];
  subjects: StudySubject[];
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onEdit: (id: string) => void;
}) {
  const sorted = useMemo(() => [...exams].sort((a, b) => `${a.date} ${a.time ?? ""}`.localeCompare(`${b.date} ${b.time ?? ""}`)), [exams]);
  if (sorted.length === 0) return <p className="text-sm text-muted-foreground">Apunta aquí la fecha y la hora de tus próximos exámenes.</p>;

  return (
    <ul className="space-y-1">
      {sorted.map((exam) => {
        const days = daysUntil(exam.date);
        const when = days === 0 ? "hoy" : days === 1 ? "mañana" : days > 1 ? `en ${days} días` : `hace ${-days} días`;
        const day = new Date(`${exam.date}T00:00:00`).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
        const subject = subjects.find((s) => s.id === exam.subjectId)?.name;
        return (
          <li key={exam.id} className="group flex items-start gap-3 rounded-xl px-1.5 py-1.5 hover:bg-muted/60">
            <input
              type="checkbox"
              checked={!!exam.done}
              onChange={() => onToggle(exam.id)}
              aria-label={`Marcar ${exam.title} como hecho`}
              className="mt-1 size-4 shrink-0 cursor-pointer accent-[var(--primary)]"
            />
            <button type="button" onClick={() => onEdit(exam.id)} className="min-w-0 flex-1 cursor-pointer text-left">
              <span className={`block text-sm font-medium [overflow-wrap:anywhere] ${exam.done ? "text-muted-foreground line-through" : ""}`}>{exam.title}</span>
              <span className={`block text-xs text-muted-foreground ${exam.done ? "line-through" : ""}`}>
                {subject ? `${subject} · ` : ""}
                {day}
                {exam.time ? ` · ${exam.time}` : ""} · {when}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onRemove(exam.id)}
              aria-label={`Eliminar ${exam.title}`}
              title="Eliminar"
              className="shrink-0 cursor-pointer text-xs text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus:opacity-100 group-hover:opacity-100"
            >
              ✕
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// Una asignatura con su temario: tabla de temas con el tiempo real dedicado a cada uno y una casilla de "hecho".
function SubjectCard({ subject, plan, onChange, onRemove }: { subject: StudySubject; plan: StudyPlanRow[]; onChange: (next: StudySubject) => void; onRemove: () => void }) {
  const [name, setName] = useState(subject.name);
  const [newTopic, setNewTopic] = useState("");
  useEffect(() => setName(subject.name), [subject.name]);

  const addTopic = (e: FormEvent) => {
    e.preventDefault();
    const value = newTopic.trim();
    if (!value) return;
    onChange({ ...subject, topics: [...subject.topics, { id: newId(), name: value }] });
    setNewTopic("");
  };

  const done = subject.topics.filter((t) => t.done).length;

  return (
    <section className="card-soft flex min-w-0 flex-col">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name.trim() !== subject.name && onChange({ ...subject, name: name.trim() })}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            aria-label="Nombre de la asignatura"
            className="w-full min-w-0 border-b border-transparent bg-transparent font-serif text-xl outline-none focus:border-primary"
          />
          <p className="mt-0.5 text-xs text-muted-foreground">
            {subject.topics.length > 0 ? `${done}/${subject.topics.length} temas · ` : ""}
            {formatDuration(spentOnSubject(plan, subject.id))} dedicadas
          </p>
        </div>
        <ConfirmButton label="Eliminar" confirmLabel="¿Eliminar?" onConfirm={onRemove} />
      </div>

      {subject.topics.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground">
              <th className="py-1.5 pr-2 font-medium">Tema</th>
              <th className="py-1.5 pr-2 text-right font-medium">Dedicado</th>
              <th className="w-14 py-1.5 text-center font-medium">Hecho</th>
              <th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {subject.topics.map((topic) => (
              <tr key={topic.id} className="group border-b border-border last:border-b-0">
                <td className={`py-2 pr-2 [overflow-wrap:anywhere] ${topic.done ? "text-muted-foreground line-through" : ""}`}>{topic.name}</td>
                <td className="py-2 pr-2 text-right tabular-nums text-muted-foreground">{formatDuration(spentOnTopic(plan, topic.id))}</td>
                <td className="py-2 text-center">
                  <input
                    type="checkbox"
                    checked={!!topic.done}
                    onChange={() => onChange({ ...subject, topics: subject.topics.map((t) => (t.id === topic.id ? { ...t, done: !t.done } : t)) })}
                    aria-label={`Marcar ${topic.name} como hecho`}
                    className="size-4 cursor-pointer accent-[var(--primary)]"
                  />
                </td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    onClick={() => onChange({ ...subject, topics: subject.topics.filter((t) => t.id !== topic.id) })}
                    aria-label={`Quitar ${topic.name}`}
                    title="Quitar tema"
                    className="cursor-pointer text-xs text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus:opacity-100 group-hover:opacity-100"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form onSubmit={addTopic} className="mt-3 flex gap-2">
        <input value={newTopic} onChange={(e) => setNewTopic(e.target.value)} placeholder="Nuevo tema…" maxLength={120} className="field-input min-w-0 flex-1 px-3 py-2 text-sm" />
        <button type="submit" className="btn-dark px-4 py-2 text-sm" aria-label="Añadir tema">
          +
        </button>
      </form>
    </section>
  );
}

// Alta/edición de una fila del plan. Asignatura y tema se escriben (con sugerencias de los que ya existen): los
// nuevos pasan a formar parte del temario. "Tiempo real" solo se pide al editar, para corregirlo a mano.
function PlanDialog({
  row,
  subjects,
  onSave,
  onRemove,
  onClose,
}: {
  row?: StudyPlanRow; // undefined = fila nueva
  subjects: StudySubject[];
  onSave: (values: { subjectName: string; topicName: string; kind: StudyKind; plannedMinutes: number; spentSeconds: number | null }) => void;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const subjectsId = useId();
  const topicsId = useId();
  const initialSubject = subjects.find((s) => s.id === row?.subjectId)?.name ?? "";
  const [subjectName, setSubjectName] = useState(initialSubject);
  const [topicName, setTopicName] = useState(row ? (subjects.find((s) => s.id === row.subjectId)?.topics.find((t) => t.id === row.topicId)?.name ?? row.topicName) : "");
  const [kind, setKind] = useState<StudyKind>(row?.kind ?? "study");
  const [planned, setPlanned] = useState(row && row.plannedMinutes > 0 ? formatDuration(row.plannedMinutes * 60) : "");
  const initialSpent = row ? formatDuration(row.spentSeconds) : "";
  const [spent, setSpent] = useState(initialSpent);
  const [error, setError] = useState<string | null>(null);

  const topicSuggestions = subjects.find((s) => s.name.trim().toLowerCase() === subjectName.trim().toLowerCase())?.topics ?? [];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!subjectName.trim() || !topicName.trim()) {
      setError("Indica la asignatura y el tema.");
      return;
    }
    const plannedMinutes = parseDuration(planned);
    if (plannedMinutes === null) {
      setError("El tiempo asignado no se entiende. Prueba con 2, 1:30, 2h o 90m.");
      return;
    }
    let spentSeconds: number | null = null; // null = no tocar
    if (row && spent.trim() !== initialSpent) {
      const minutes = parseDuration(spent);
      if (minutes === null) {
        setError("El tiempo real no se entiende. Prueba con 1:30, 2h o 90m.");
        return;
      }
      spentSeconds = minutes * 60;
    }
    onSave({ subjectName, topicName, kind, plannedMinutes, spentSeconds });
  };

  return (
    <DialogShell title={row ? "Editar tema del plan" : "Añadir al plan"} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className={fieldLabel}>
          Asignatura
          <input
            autoFocus
            list={subjectsId}
            value={subjectName}
            onChange={(e) => setSubjectName(e.target.value)}
            placeholder="Matemáticas"
            maxLength={80}
            className="field-input normal-case tracking-normal text-foreground"
          />
          <datalist id={subjectsId}>
            {subjects.map((s) => (
              <option key={s.id} value={s.name} />
            ))}
          </datalist>
        </label>
        <label className={fieldLabel}>
          Tema
          <input
            list={topicsId}
            value={topicName}
            onChange={(e) => setTopicName(e.target.value)}
            placeholder="Integrales definidas"
            maxLength={120}
            className="field-input normal-case tracking-normal text-foreground"
          />
          <datalist id={topicsId}>
            {topicSuggestions.map((t) => (
              <option key={t.id} value={t.name} />
            ))}
          </datalist>
        </label>

        <div className="flex gap-2" role="group" aria-label="Tipo">
          {(Object.keys(KIND_LABELS) as StudyKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              aria-pressed={kind === k}
              className={`cursor-pointer rounded-full border px-4 py-1.5 text-xs transition-colors ${
                kind === k ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {KIND_LABELS[k]}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className={fieldLabel}>
            Tiempo asignado
            <input value={planned} onChange={(e) => setPlanned(e.target.value)} placeholder="2:00 (vacío = sin tiempo)" className="field-input normal-case tracking-normal text-foreground" />
          </label>
          {row && (
            <label className={fieldLabel}>
              Tiempo real
              <input value={spent} onChange={(e) => setSpent(e.target.value)} placeholder="0:00" className="field-input normal-case tracking-normal text-foreground" />
            </label>
          )}
        </div>
        <p className="-mt-2 text-[11px] text-muted-foreground">Horas y minutos: 2, 1:30, 2h, 90m. Sin tiempo asignado, el temporizador solo va sumando lo que dedicas.</p>

        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex items-center gap-3">
          <button type="submit" className="btn-dark">
            Guardar
          </button>
          <button type="button" onClick={onClose} className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            Cancelar
          </button>
          {onRemove && (
            <span className="ml-auto">
              <DeleteButton label="Quitar del plan" onConfirm={onRemove} />
            </span>
          )}
        </div>
      </form>
    </DialogShell>
  );
}

function ExamDialog({
  exam,
  subjects,
  onSave,
  onClose,
}: {
  exam?: StudyExam; // undefined = examen nuevo
  subjects: StudySubject[];
  onSave: (values: Omit<StudyExam, "id">) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(exam?.title ?? "");
  const [subjectId, setSubjectId] = useState(exam?.subjectId ?? "");
  const [date, setDate] = useState(exam?.date ?? todayKey());
  const [time, setTime] = useState(exam?.time ?? "");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Ponle un título al examen.");
      return;
    }
    if (!date) {
      setError("Elige la fecha.");
      return;
    }
    onSave({ title: title.trim(), subjectId: subjectId || undefined, date, time: time || undefined, done: exam?.done });
  };

  return (
    <DialogShell title={exam ? "Editar examen" : "Añadir examen"} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Examen de Matemáticas" maxLength={120} className="field-input font-serif text-lg" />
        {subjects.length > 0 && (
          <label className={fieldLabel}>
            Asignatura (opcional)
            <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="field-input normal-case tracking-normal text-foreground">
              <option value="">— Ninguna —</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className={fieldLabel}>
            Fecha
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="field-input normal-case tracking-normal text-foreground" />
          </label>
          <label className={fieldLabel}>
            Hora
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="field-input normal-case tracking-normal text-foreground" />
          </label>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex items-center gap-3">
          <button type="submit" className="btn-dark">
            Guardar
          </button>
          <button type="button" onClick={onClose} className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            Cancelar
          </button>
        </div>
      </form>
    </DialogShell>
  );
}
