import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Pressable, ScrollView, Modal, Alert, Platform, KeyboardAvoidingView } from "react-native";
import { Text, TextInput } from "./AppText";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Crypto from "expo-crypto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import DateTimePicker, { DateTimePickerChangeEvent } from "@react-native-community/datetimepicker";
import Svg, { Circle } from "react-native-svg";
import { StudyContent, StudyExam, StudyKind, StudyPlanRow, StudySubject } from "../api/customPages";
import {
  formatClock,
  formatDuration,
  KIND_LABELS,
  normalizeStudyContent,
  parseDuration,
  sameName,
  sortExams,
  spentOnSubject,
  spentOnTopic,
  timerArcs,
  topicNameOf,
} from "../utils/study";
import { colors, fonts, radius, shadow, withAlpha, themedStyles } from "../theme";

// Plantilla "estudio" de las páginas personalizadas — puerto de dashboard/src/components/StudyPlannerTemplate.tsx:
// plan de estudio, temporizador, exámenes próximos y una tarjeta por asignatura, apilados en una sola columna.
// Todo vive dentro del JSON de `content` (ver StudyContent en api/customPages.ts); cada acción guarda el
// contenido entero, igual que el resto de plantillas.
//
// El contenido se guarda en cada acción y el temporizador también escribe en él (al pausar), así que el
// componente mantiene su PROPIA copia (`dataRef`) y la actualiza al instante: dos guardados seguidos parten
// siempre del último estado y no del que aún está recargándose desde SQLite en la pantalla padre.

const DEFAULT_EXAM_TIME = "09:00";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
// Fechas de calendario (YYYY-MM-DD) sin zona horaria: se convierten a un Date LOCAL a mediodía solo para el
// selector nativo (así ningún cambio de hora las desplaza de día) y se leen con los getters locales.
function keyToDate(key: string): Date {
  return new Date(`${key}T12:00:00`);
}
function dateToKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function fmtDate(key: string): string {
  return keyToDate(key).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}
function timeToDate(time: string): Date {
  const [h, m] = time.split(":").map(Number);
  const d = new Date();
  d.setHours(Number.isFinite(h) ? h : 9, Number.isFinite(m) ? m : 0, 0, 0);
  return d;
}

// Estado persistido del temporizador (AsyncStorage, `tidely.study.timer.<pageId>`): solo qué fila está elegida y
// desde cuándo corre (marca de tiempo). El tiempo ya acumulado vive en la propia fila (spentSeconds), así que
// segundo plano o reinicio de la app no pierden nada: el cronómetro se calcula siempre con Date.now().
interface TimerState {
  rowId: string | null;
  runningSince: number | null;
}
const IDLE_TIMER: TimerState = { rowId: null, runningSince: null };

export function StudyPlannerEditor({
  pageId,
  content,
  onChange,
}: {
  pageId: string;
  content: unknown;
  onChange: (next: StudyContent) => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<StudyContent>(() => normalizeStudyContent(content));
  const dataRef = useRef(data);
  // Guardados en vuelo: mientras haya alguno, lo que llegue de la pantalla padre es una recarga anterior a
  // nuestro último cambio y no debe pisarlo.
  const pendingRef = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (pendingRef.current > 0) return;
    const next = normalizeStudyContent(content);
    dataRef.current = next;
    setData(next);
  }, [content]);

  const commit = useCallback((next: StudyContent) => {
    dataRef.current = next;
    setData(next);
    pendingRef.current += 1;
    onChangeRef.current(next)
      .catch(() => undefined)
      .finally(() => {
        pendingRef.current -= 1;
      });
  }, []);

  // --- Temporizador -------------------------------------------------------------------------------------
  const timerKey = `tidely.study.timer.${pageId}`;
  const [timer, setTimerState] = useState<TimerState>(IDLE_TIMER);
  const timerRef = useRef<TimerState>(IDLE_TIMER);

  const setTimer = useCallback(
    (next: TimerState) => {
      timerRef.current = next;
      setTimerState(next);
      AsyncStorage.setItem(timerKey, JSON.stringify(next)).catch(() => undefined);
    },
    [timerKey]
  );

  // Recupera el cronómetro tras reiniciar la app (si seguía corriendo, sigue contando con el reloj real).
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(timerKey)
      .then((raw) => {
        if (cancelled || !raw || timerRef.current.rowId !== null) return;
        const parsed = JSON.parse(raw) as Partial<TimerState>;
        if (typeof parsed.rowId !== "string" || !dataRef.current.plan.some((r) => r.id === parsed.rowId)) return;
        const restored: TimerState = {
          rowId: parsed.rowId,
          runningSince: typeof parsed.runningSince === "number" && Number.isFinite(parsed.runningSince) ? parsed.runningSince : null,
        };
        timerRef.current = restored;
        setTimerState(restored);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [timerKey]);

  const addSpent = useCallback(
    (rowId: string, seconds: number) => {
      if (seconds <= 0) return;
      const current = dataRef.current;
      if (!current.plan.some((r) => r.id === rowId)) return;
      commit({ ...current, plan: current.plan.map((r) => (r.id === rowId ? { ...r, spentSeconds: r.spentSeconds + seconds } : r)) });
    },
    [commit]
  );

  /** Pasa a la fila lo que lleva corriendo el cronómetro (si corre). No cambia el estado del temporizador. */
  const flushRun = useCallback(() => {
    const t = timerRef.current;
    if (t.rowId && t.runningSince !== null) addSpent(t.rowId, Math.max(0, Math.round((Date.now() - t.runningSince) / 1000)));
  }, [addSpent]);

  // Al salir de la pantalla con el cronómetro en marcha se guarda lo corrido y se deja pausado.
  useEffect(
    () => () => {
      const t = timerRef.current;
      if (t.rowId && t.runningSince !== null) {
        flushRun();
        AsyncStorage.setItem(timerKey, JSON.stringify({ rowId: t.rowId, runningSince: null })).catch(() => undefined);
      }
    },
    [flushRun, timerKey]
  );

  // Si la fila elegida desaparece (borrada aquí o desde la web), el temporizador se queda sin selección.
  useEffect(() => {
    const t = timerRef.current;
    if (t.rowId && !data.plan.some((r) => r.id === t.rowId)) setTimer(IDLE_TIMER);
  }, [data.plan, setTimer]);

  const selectRow = (rowId: string) => {
    if (timerRef.current.rowId === rowId) return;
    flushRun(); // nunca se pierde el tiempo de la fila que se deja
    setTimer({ rowId, runningSince: null });
  };
  const startTimer = () => {
    const t = timerRef.current;
    if (t.rowId && t.runningSince === null) setTimer({ rowId: t.rowId, runningSince: Date.now() });
  };
  const pauseTimer = () => {
    const t = timerRef.current;
    if (!t.rowId || t.runningSince === null) return;
    flushRun();
    setTimer({ rowId: t.rowId, runningSince: null });
  };
  const resetTimer = () => {
    const t = timerRef.current;
    const rowId = t.rowId;
    if (!rowId) return;
    Alert.alert("Reiniciar tiempo", "El tiempo real de este tema volverá a 0:00. ¿Continuar?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Reiniciar",
        style: "destructive",
        onPress: () => {
          const current = dataRef.current;
          commit({ ...current, plan: current.plan.map((r) => (r.id === rowId ? { ...r, spentSeconds: 0 } : r)) });
          setTimer({ rowId, runningSince: null });
        },
      },
    ]);
  };

  // --- Plan ---------------------------------------------------------------------------------------------
  const [planFormOpen, setPlanFormOpen] = useState(false);
  const [quick, setQuick] = useState<{ rowId: string; field: "planned" | "spent" } | null>(null);

  const addPlanRow = (values: { subjectName: string; topicName: string; kind: StudyKind; plannedMinutes: number }) => {
    const current = dataRef.current;
    let subjects = current.subjects;
    let subject = subjects.find((s) => sameName(s.name, values.subjectName));
    if (!subject) {
      subject = { id: Crypto.randomUUID(), name: values.subjectName.trim(), topics: [] };
      subjects = [...subjects, subject];
    }
    const subjectId = subject.id;
    let topic = subject.topics.find((t) => sameName(t.name, values.topicName));
    if (!topic) {
      topic = { id: Crypto.randomUUID(), name: values.topicName.trim() };
      const topicToAdd = topic;
      subjects = subjects.map((s) => (s.id === subjectId ? { ...s, topics: [...s.topics, topicToAdd] } : s));
    }
    const row: StudyPlanRow = {
      id: Crypto.randomUUID(),
      subjectId,
      topicId: topic.id,
      topicName: topic.name,
      kind: values.kind,
      plannedMinutes: values.plannedMinutes,
      spentSeconds: 0,
    };
    setPlanFormOpen(false);
    commit({ ...current, subjects, plan: [...current.plan, row] });
  };

  const removeRow = (row: StudyPlanRow) => {
    const name = topicNameOf(row, dataRef.current.subjects);
    Alert.alert("Eliminar del plan", `¿Quitar "${name}" del plan? Se perderá el tiempo registrado en esta fila.`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: () => {
          const current = dataRef.current;
          commit({ ...current, plan: current.plan.filter((r) => r.id !== row.id) });
        },
      },
    ]);
  };

  const saveQuick = (rowId: string, field: "planned" | "spent", minutes: number | null) => {
    setQuick(null);
    const current = dataRef.current;
    commit({
      ...current,
      plan: current.plan.map((r) => {
        if (r.id !== rowId) return r;
        // `null` en "Real" = el texto no cambió: se conservan los segundos exactos.
        if (field === "planned") return { ...r, plannedMinutes: minutes ?? r.plannedMinutes };
        return minutes === null ? r : { ...r, spentSeconds: minutes * 60 };
      }),
    });
  };

  // --- Exámenes -----------------------------------------------------------------------------------------
  const [examFormOpen, setExamFormOpen] = useState(false);

  const addExam = (values: Omit<StudyExam, "id">) => {
    setExamFormOpen(false);
    const current = dataRef.current;
    commit({ ...current, exams: [...current.exams, { id: Crypto.randomUUID(), ...values }] });
  };
  const toggleExam = (id: string) => {
    const current = dataRef.current;
    commit({ ...current, exams: current.exams.map((e) => (e.id === id ? { ...e, done: !e.done } : e)) });
  };
  const removeExam = (id: string) => {
    const current = dataRef.current;
    commit({ ...current, exams: current.exams.filter((e) => e.id !== id) });
  };

  // --- Asignaturas y temas --------------------------------------------------------------------------------
  const renameSubject = (id: string, name: string) => {
    const current = dataRef.current;
    commit({ ...current, subjects: current.subjects.map((s) => (s.id === id ? { ...s, name } : s)) });
  };
  const removeSubject = (subject: StudySubject) => {
    Alert.alert("Eliminar asignatura", `¿Eliminar "${subject.name}"? También se quitarán sus filas del plan de estudio.`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: () => {
          const current = dataRef.current;
          commit({
            subjects: current.subjects.filter((s) => s.id !== subject.id),
            plan: current.plan.filter((r) => r.subjectId !== subject.id),
            // Un examen sigue existiendo aunque desaparezca su asignatura: solo pierde la etiqueta.
            exams: current.exams.map((e) => {
              if (e.subjectId !== subject.id) return e;
              const next = { ...e };
              delete next.subjectId;
              return next;
            }),
          });
        },
      },
    ]);
  };
  const addTopic = (subjectId: string, name: string) => {
    const trimmed = name.trim();
    const current = dataRef.current;
    const subject = current.subjects.find((s) => s.id === subjectId);
    if (!trimmed || !subject || subject.topics.some((t) => sameName(t.name, trimmed))) return;
    commit({
      ...current,
      subjects: current.subjects.map((s) => (s.id === subjectId ? { ...s, topics: [...s.topics, { id: Crypto.randomUUID(), name: trimmed }] } : s)),
    });
  };
  const toggleTopic = (subjectId: string, topicId: string) => {
    const current = dataRef.current;
    commit({
      ...current,
      subjects: current.subjects.map((s) =>
        s.id === subjectId ? { ...s, topics: s.topics.map((t) => (t.id === topicId ? { ...t, done: !t.done } : t)) } : s
      ),
    });
  };
  const removeTopic = (subjectId: string, topicId: string) => {
    const subject = dataRef.current.subjects.find((s) => s.id === subjectId);
    const topic = subject?.topics.find((t) => t.id === topicId);
    if (!topic) return;
    Alert.alert("Quitar tema", `¿Quitar "${topic.name}" del temario? Las filas del plan conservarán su texto.`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Quitar",
        style: "destructive",
        onPress: () => {
          const current = dataRef.current;
          commit({
            ...current,
            subjects: current.subjects.map((s) => (s.id === subjectId ? { ...s, topics: s.topics.filter((t) => t.id !== topicId) } : s)),
            // La fila deja de apuntar al tema pero se queda con su nombre.
            plan: current.plan.map((r) => {
              if (r.topicId !== topicId) return r;
              const next = { ...r, topicName: topic.name };
              delete next.topicId;
              return next;
            }),
          });
        },
      },
    ]);
  };

  // --- Derivados ----------------------------------------------------------------------------------------
  const subjectName = (id: string | undefined) => data.subjects.find((s) => s.id === id)?.name ?? "";
  const totalPlanned = data.plan.reduce((sum, r) => sum + r.plannedMinutes, 0);
  const totalSpent = data.plan.reduce((sum, r) => sum + r.spentSeconds, 0);
  const exams = useMemo(() => sortExams(data.exams), [data.exams]);
  const timerRow = data.plan.find((r) => r.id === timer.rowId) ?? null;
  const quickRow = quick ? data.plan.find((r) => r.id === quick.rowId) ?? null : null;

  return (
    <View style={{ gap: 16 }}>
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Plan de estudio</Text>
          <Pressable style={styles.plusButton} onPress={() => setPlanFormOpen(true)} hitSlop={8} accessibilityLabel="Añadir al plan de estudio">
            <Text style={styles.plusButtonText}>+</Text>
          </Pressable>
        </View>
        {data.plan.length === 0 ? (
          <Text style={styles.emptyText}>Todavía no hay nada en el plan. Con el + añade un tema con su asignatura y el tiempo que quieres dedicarle.</Text>
        ) : (
          <>
            <Text style={styles.mutedSmall}>
              Asignado {totalPlanned > 0 ? formatDuration(totalPlanned * 60) : "—"} · Real {formatDuration(totalSpent)}
            </Text>
            <View style={{ gap: 10 }}>
              {data.plan.map((row) => {
                const selected = row.id === timer.rowId;
                const name = topicNameOf(row, data.subjects);
                return (
                  <View key={row.id} style={[styles.planRow, selected && styles.planRowSelected]}>
                    <Pressable
                      style={[styles.playButton, selected && styles.playButtonOn]}
                      onPress={() => selectRow(row.id)}
                      hitSlop={6}
                      accessibilityLabel={`Elegir ${name} en el temporizador`}
                    >
                      <Text style={[styles.playButtonText, selected && styles.playButtonTextOn]}>▶</Text>
                    </Pressable>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <Text style={styles.rowTopic} numberOfLines={2}>
                        {name || "Sin tema"}
                      </Text>
                      <Text style={styles.mutedSmall} numberOfLines={1}>
                        {subjectName(row.subjectId) || "Sin asignatura"} · {KIND_LABELS[row.kind]}
                      </Text>
                      <View style={styles.timesRow}>
                        <Pressable style={styles.timeBox} onPress={() => setQuick({ rowId: row.id, field: "planned" })} accessibilityLabel="Editar tiempo asignado">
                          <Text style={styles.timeLabel}>Asignado</Text>
                          <Text style={styles.timeValue}>{row.plannedMinutes > 0 ? formatDuration(row.plannedMinutes * 60) : "—"}</Text>
                        </Pressable>
                        <Pressable style={styles.timeBox} onPress={() => setQuick({ rowId: row.id, field: "spent" })} accessibilityLabel="Editar tiempo real">
                          <Text style={styles.timeLabel}>Real</Text>
                          <Text style={styles.timeValue}>{formatDuration(row.spentSeconds)}</Text>
                        </Pressable>
                      </View>
                    </View>
                    <Pressable onPress={() => removeRow(row)} hitSlop={8} accessibilityLabel={`Eliminar ${name} del plan`}>
                      <Text style={styles.deleteX}>✕</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </>
        )}
      </View>

      <TimerCard
        row={timerRow}
        topicName={timerRow ? topicNameOf(timerRow, data.subjects) : ""}
        subjectName={timerRow ? subjectName(timerRow.subjectId) : ""}
        runningSince={timer.runningSince}
        onStart={startTimer}
        onPause={pauseTimer}
        onReset={resetTimer}
      />

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Exámenes próximos</Text>
          <Pressable style={styles.plusButton} onPress={() => setExamFormOpen(true)} hitSlop={8} accessibilityLabel="Añadir examen">
            <Text style={styles.plusButtonText}>+</Text>
          </Pressable>
        </View>
        {exams.length === 0 ? (
          <Text style={styles.emptyText}>No hay exámenes apuntados. Con el + añade el próximo.</Text>
        ) : (
          <View style={{ gap: 4 }}>
            {exams.map((exam) => (
              <View key={exam.id} style={styles.checkRow}>
                <Pressable
                  style={styles.checkMain}
                  onPress={() => toggleExam(exam.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: !!exam.done }}
                >
                  <View style={[styles.checkbox, exam.done && styles.checkboxOn]}>{exam.done ? <Text style={styles.checkboxTick}>✓</Text> : null}</View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.examTitle, exam.done && styles.doneText]}>{exam.title}</Text>
                    <Text style={[styles.mutedSmall, exam.done && styles.doneText]}>
                      {[subjectName(exam.subjectId), fmtDate(exam.date), exam.time].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                </Pressable>
                <Pressable onPress={() => removeExam(exam.id)} hitSlop={8} accessibilityLabel={`Quitar ${exam.title}`}>
                  <Text style={styles.deleteX}>✕</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </View>

      {data.subjects.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Asignaturas</Text>
          <Text style={styles.emptyText}>Las asignaturas y sus temas aparecen aquí: se crean solas al añadir filas al plan de estudio.</Text>
        </View>
      ) : (
        data.subjects.map((subject) => (
          <SubjectCard
            key={subject.id}
            subject={subject}
            plan={data.plan}
            onRename={(name) => renameSubject(subject.id, name)}
            onRemove={() => removeSubject(subject)}
            onAddTopic={(name) => addTopic(subject.id, name)}
            onToggleTopic={(topicId) => toggleTopic(subject.id, topicId)}
            onRemoveTopic={(topicId) => removeTopic(subject.id, topicId)}
          />
        ))
      )}

      <Sheet visible={planFormOpen} onClose={() => setPlanFormOpen(false)} bottomInset={insets.bottom}>
        {planFormOpen && <PlanRowForm subjects={data.subjects} onSave={addPlanRow} onClose={() => setPlanFormOpen(false)} />}
      </Sheet>
      <Sheet visible={quick !== null && quickRow !== null} onClose={() => setQuick(null)} bottomInset={insets.bottom}>
        {quick && quickRow && (
          <DurationForm
            key={`${quick.rowId}-${quick.field}`}
            title={quick.field === "planned" ? "Tiempo asignado" : "Tiempo real"}
            subtitle={topicNameOf(quickRow, data.subjects)}
            initial={quick.field === "planned" ? (quickRow.plannedMinutes > 0 ? formatDuration(quickRow.plannedMinutes * 60) : "") : formatDuration(quickRow.spentSeconds)}
            hint={quick.field === "planned" ? "Vacío = sin tiempo asignado." : "Corrige a mano el tiempo ya estudiado."}
            onSave={(minutes, changed) => saveQuick(quick.rowId, quick.field, changed ? minutes : null)}
            onClose={() => setQuick(null)}
          />
        )}
      </Sheet>
      <Sheet visible={examFormOpen} onClose={() => setExamFormOpen(false)} bottomInset={insets.bottom}>
        {examFormOpen && <ExamForm subjects={data.subjects} onSave={addExam} onClose={() => setExamFormOpen(false)} />}
      </Sheet>
    </View>
  );
}

// Hoja inferior de los formularios (mismo patrón que los diálogos de TravelPlanner.tsx).
function Sheet({ visible, onClose, bottomInset, children }: { visible: boolean; onClose: () => void; bottomInset: number; children: ReactNode }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalBackdrop} behavior="padding">
        <View style={[styles.modalSheet, { paddingBottom: bottomInset + 20 }]}>{children}</View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// --- Temporizador ---------------------------------------------------------------------------------------

const RING_SIZE = 220;
const RING_STROKE = 14;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

function Arc({ fraction, color }: { fraction: number; color: string }) {
  if (fraction <= 0) return null;
  const f = Math.min(1, fraction);
  return (
    <Circle
      cx={RING_SIZE / 2}
      cy={RING_SIZE / 2}
      r={RING_RADIUS}
      stroke={color}
      strokeWidth={RING_STROKE}
      strokeLinecap="round"
      fill="none"
      strokeDasharray={`${RING_LENGTH} ${RING_LENGTH}`}
      strokeDashoffset={RING_LENGTH * (1 - f)}
      // El arco nace arriba (las 12) en vez de a la derecha.
      rotation={-90}
      origin={`${RING_SIZE / 2}, ${RING_SIZE / 2}`}
    />
  );
}

// El cronómetro lleva su propio "ahora" para que solo se repinte esta tarjeta cada 250 ms y no toda la
// plantilla; el tiempo mostrado es el TOTAL de la fila: lo ya guardado (spentSeconds) más lo que lleva corriendo.
function TimerCard({
  row,
  topicName,
  subjectName,
  runningSince,
  onStart,
  onPause,
  onReset,
}: {
  row: StudyPlanRow | null;
  topicName: string;
  subjectName: string;
  runningSince: number | null;
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
}) {
  const running = row !== null && runningSince !== null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [running]);

  const liveSeconds = running && runningSince !== null ? Math.max(0, now - runningSince) / 1000 : 0;
  const total = row ? row.spentSeconds + liveSeconds : 0;
  const planned = row?.plannedMinutes ?? 0;
  const { base, over, overtimeSeconds } = timerArcs(total, planned);
  const overtime = planned > 0 && overtimeSeconds > 0;
  const baseColor = planned > 0 ? colors.destructive : colors.primary;

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Temporizador</Text>
      {row ? (
        <View style={{ alignItems: "center", gap: 2 }}>
          <Text style={styles.timerTopic} numberOfLines={2}>
            {topicName || "Sin tema"}
          </Text>
          <Text style={styles.mutedSmall} numberOfLines={1}>
            {subjectName || "Sin asignatura"}
          </Text>
        </View>
      ) : null}
      <View style={styles.ringWrap}>
        <Svg width={RING_SIZE} height={RING_SIZE}>
          <Circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS} stroke={colors.muted} strokeWidth={RING_STROKE} fill="none" />
          {row ? <Arc fraction={base} color={baseColor} /> : null}
          {row && over > 0 ? <Arc fraction={over} color={colors.positive} /> : null}
        </Svg>
        <View style={styles.ringCenter} pointerEvents="none">
          {row ? (
            <>
              <Text style={[styles.timerDigits, overtime && { color: colors.positive }]}>{formatClock(total)}</Text>
              {overtime ? <Text style={[styles.timerSub, { color: colors.positive, fontFamily: fonts.sansBold }]}>{`+${formatClock(overtimeSeconds)}`}</Text> : null}
              <Text style={styles.timerSub}>{planned > 0 ? `de ${formatDuration(planned * 60)}` : "sin tiempo asignado"}</Text>
            </>
          ) : (
            <Text style={styles.timerHint}>Elige un tema del plan con ▶</Text>
          )}
        </View>
      </View>
      <View style={styles.timerButtons}>
        <Pressable
          style={[styles.primaryButton, !row && styles.disabled]}
          onPress={running ? onPause : onStart}
          disabled={!row}
          accessibilityLabel={running ? "Pausar" : "Iniciar"}
        >
          <Text style={styles.primaryButtonText}>{running ? "❚❚ Pausar" : "▶ Iniciar"}</Text>
        </Pressable>
        <Pressable style={[styles.outlineButton, !row && styles.disabled]} onPress={onReset} disabled={!row} accessibilityLabel="Reiniciar">
          <Text style={styles.outlineButtonText}>Reiniciar</Text>
        </Pressable>
      </View>
    </View>
  );
}

// --- Asignatura -----------------------------------------------------------------------------------------

function SubjectCard({
  subject,
  plan,
  onRename,
  onRemove,
  onAddTopic,
  onToggleTopic,
  onRemoveTopic,
}: {
  subject: StudySubject;
  plan: StudyPlanRow[];
  onRename: (name: string) => void;
  onRemove: () => void;
  onAddTopic: (name: string) => void;
  onToggleTopic: (topicId: string) => void;
  onRemoveTopic: (topicId: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(subject.name);
  const [topicDraft, setTopicDraft] = useState("");

  const finishRename = () => {
    setRenaming(false);
    const next = nameDraft.trim();
    // Un nombre vacío no se guarda: se queda el anterior.
    if (next && next !== subject.name) onRename(next);
    else setNameDraft(subject.name);
  };
  const submitTopic = () => {
    onAddTopic(topicDraft);
    setTopicDraft("");
  };

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        {renaming ? (
          <TextInput
            style={[styles.input, { flex: 1, marginRight: 10 }]}
            value={nameDraft}
            onChangeText={setNameDraft}
            onBlur={finishRename}
            onSubmitEditing={finishRename}
            returnKeyType="done"
            autoFocus
            maxLength={80}
          />
        ) : (
          <Pressable
            style={{ flex: 1, minWidth: 0 }}
            onPress={() => {
              setNameDraft(subject.name);
              setRenaming(true);
            }}
            accessibilityLabel={`Renombrar ${subject.name}`}
          >
            <Text style={styles.cardTitleSerif}>{subject.name || "Sin nombre"}</Text>
          </Pressable>
        )}
        <Pressable onPress={onRemove} hitSlop={8} accessibilityLabel={`Eliminar ${subject.name}`}>
          <Text style={styles.removeText}>Eliminar</Text>
        </Pressable>
      </View>
      <Text style={styles.mutedSmall}>Dedicado en total: {formatDuration(spentOnSubject(plan, subject.id))}</Text>

      {subject.topics.length === 0 ? (
        <Text style={styles.emptyText}>Sin temas todavía. Añade el primero abajo.</Text>
      ) : (
        <View style={{ gap: 2 }}>
          {subject.topics.map((topic) => (
            <View key={topic.id} style={styles.checkRow}>
              <Pressable
                style={styles.checkMain}
                onPress={() => onToggleTopic(topic.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: !!topic.done }}
              >
                <View style={[styles.checkbox, topic.done && styles.checkboxOn]}>{topic.done ? <Text style={styles.checkboxTick}>✓</Text> : null}</View>
                <Text style={[styles.topicName, topic.done && styles.doneText]}>{topic.name}</Text>
              </Pressable>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.timeLabel}>Dedicado</Text>
                <Text style={styles.timeValue}>{formatDuration(spentOnTopic(plan, topic.id))}</Text>
              </View>
              <Pressable onPress={() => onRemoveTopic(topic.id)} hitSlop={8} accessibilityLabel={`Quitar ${topic.name}`}>
                <Text style={styles.deleteX}>✕</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      <View style={styles.addRow}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          placeholder="Nuevo tema…"
          value={topicDraft}
          onChangeText={setTopicDraft}
          onSubmitEditing={submitTopic}
          submitBehavior="submit"
          returnKeyType="done"
          maxLength={120}
        />
        <Pressable style={styles.addButton} onPress={submitTopic} accessibilityLabel="Añadir tema">
          <Text style={styles.addButtonText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

// --- Formularios ----------------------------------------------------------------------------------------

function Chips({ options, isSelected, onPick }: { options: { key: string; label: string }[]; isSelected: (key: string) => boolean; onPick: (key: string) => void }) {
  return (
    <View style={styles.chipRow}>
      {options.map((o) => (
        <Pressable key={o.key} style={[styles.chip, isSelected(o.key) && styles.chipSelected]} onPress={() => onPick(o.key)}>
          <Text style={[styles.chipText, isSelected(o.key) && styles.chipTextSelected]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function PlanRowForm({
  subjects,
  onSave,
  onClose,
}: {
  subjects: StudySubject[];
  onSave: (values: { subjectName: string; topicName: string; kind: StudyKind; plannedMinutes: number }) => void;
  onClose: () => void;
}) {
  const [subjectText, setSubjectText] = useState("");
  const [topicText, setTopicText] = useState("");
  const [kind, setKind] = useState<StudyKind>("study");
  const [durationText, setDurationText] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Si lo escrito coincide con una asignatura existente, se ofrecen sus temas; si no, se creará nueva.
  const matched = subjects.find((s) => sameName(s.name, subjectText));

  const save = () => {
    if (!subjectText.trim()) return setError("Escribe o elige una asignatura.");
    if (!topicText.trim()) return setError("Escribe o elige un tema.");
    const minutes = parseDuration(durationText);
    if (minutes === null) return setError('Tiempo no válido. Prueba con "2", "2h", "2:30", "90m" o "1,5".');
    onSave({ subjectName: subjectText, topicName: topicText, kind, plannedMinutes: minutes });
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <Text style={styles.modalTitle}>Añadir al plan</Text>

      <Text style={styles.fieldLabel}>Asignatura</Text>
      <TextInput style={styles.input} placeholder="Ej. Matemáticas" value={subjectText} onChangeText={setSubjectText} maxLength={80} />
      {subjects.length > 0 && (
        <Chips
          options={subjects.map((s) => ({ key: s.id, label: s.name }))}
          isSelected={(key) => sameName(subjects.find((s) => s.id === key)?.name ?? "", subjectText)}
          onPick={(key) => setSubjectText(subjects.find((s) => s.id === key)?.name ?? "")}
        />
      )}

      <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Tema</Text>
      <TextInput style={styles.input} placeholder="Ej. Derivadas" value={topicText} onChangeText={setTopicText} maxLength={120} />
      {matched && matched.topics.length > 0 && (
        <Chips
          options={matched.topics.map((t) => ({ key: t.id, label: t.name }))}
          isSelected={(key) => sameName(matched.topics.find((t) => t.id === key)?.name ?? "", topicText)}
          onPick={(key) => setTopicText(matched.topics.find((t) => t.id === key)?.name ?? "")}
        />
      )}

      <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Tipo</Text>
      <Chips
        options={(Object.keys(KIND_LABELS) as StudyKind[]).map((k) => ({ key: k, label: KIND_LABELS[k] }))}
        isSelected={(key) => key === kind}
        onPick={(key) => setKind(key as StudyKind)}
      />

      <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Tiempo asignado</Text>
      <TextInput
        style={styles.input}
        placeholder="Ej. 2h30 (vacío = sin tiempo asignado)"
        value={durationText}
        onChangeText={setDurationText}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <Pressable style={[styles.primaryButton, { marginTop: 12 }]} onPress={save}>
        <Text style={styles.primaryButtonText}>Añadir al plan</Text>
      </Pressable>
      <Pressable style={styles.cancelButton} onPress={onClose}>
        <Text style={styles.cancelButtonText}>Cancelar</Text>
      </Pressable>
    </ScrollView>
  );
}

// Editor pequeño de una duración (asignado o real de una fila). `changed` = el texto se tocó: si no, quien
// llama conserva los segundos exactos (el campo "Real" solo enseña minutos).
function DurationForm({
  title,
  subtitle,
  initial,
  hint,
  onSave,
  onClose,
}: {
  title: string;
  subtitle: string;
  initial: string;
  hint: string;
  onSave: (minutes: number, changed: boolean) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const minutes = parseDuration(text);
    if (minutes === null) return setError('Tiempo no válido. Prueba con "2", "2h", "2:30", "90m" o "1,5".');
    onSave(minutes, text.trim() !== initial);
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <Text style={styles.modalTitle}>{title}</Text>
      {subtitle ? <Text style={[styles.mutedSmall, { marginTop: -10, marginBottom: 12 }]}>{subtitle}</Text> : null}
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder="Ej. 1:30"
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        onSubmitEditing={save}
        returnKeyType="done"
      />
      <Text style={[styles.mutedSmall, { marginTop: 6 }]}>{hint} Acepta 2, 2h, 2:30, 2h30, 90m o 1,5 (horas).</Text>
      {error ? <Text style={[styles.errorText, { marginTop: 8 }]}>{error}</Text> : null}
      <Pressable style={[styles.primaryButton, { marginTop: 12 }]} onPress={save}>
        <Text style={styles.primaryButtonText}>Guardar</Text>
      </Pressable>
      <Pressable style={styles.cancelButton} onPress={onClose}>
        <Text style={styles.cancelButtonText}>Cancelar</Text>
      </Pressable>
    </ScrollView>
  );
}

function ExamForm({ subjects, onSave, onClose }: { subjects: StudySubject[]; onSave: (values: Omit<StudyExam, "id">) => void; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [date, setDate] = useState(() => dateToKey(new Date()));
  const [time, setTime] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const trimmed = title.trim();
    if (!trimmed) return setError("Escribe el título del examen.");
    onSave({ title: trimmed, ...(subjectId ? { subjectId } : {}), date, ...(time ? { time } : {}) });
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <Text style={styles.modalTitle}>Añadir examen</Text>

      <Text style={styles.fieldLabel}>Título</Text>
      <TextInput style={styles.input} placeholder="Ej. Examen de Matemáticas" value={title} onChangeText={setTitle} maxLength={120} autoFocus />

      {subjects.length > 0 && (
        <>
          <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Asignatura (opcional)</Text>
          <Chips
            options={subjects.map((s) => ({ key: s.id, label: s.name }))}
            isSelected={(key) => key === subjectId}
            onPick={(key) => setSubjectId((cur) => (cur === key ? null : key))}
          />
        </>
      )}

      <View style={[styles.dateRow, { marginTop: 14 }]}>
        <DateField label="Fecha" value={date} onChange={setDate} />
        <TimeField label="Hora (opcional)" value={time} onChange={setTime} defaultTime={DEFAULT_EXAM_TIME} />
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <Pressable style={[styles.primaryButton, { marginTop: 12 }]} onPress={save}>
        <Text style={styles.primaryButtonText}>Añadir examen</Text>
      </Pressable>
      <Pressable style={styles.cancelButton} onPress={onClose}>
        <Text style={styles.cancelButtonText}>Cancelar</Text>
      </Pressable>
    </ScrollView>
  );
}

/** Botón con la fecha que abre el selector nativo al tocarlo. */
function DateField({ label, value, onChange }: { label: string; value: string; onChange: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable style={styles.dateButton} onPress={() => setOpen(true)}>
        <Text style={styles.dateButtonText}>{fmtDate(value)}</Text>
      </Pressable>
      {open && (
        <DateTimePicker
          value={keyToDate(value)}
          mode="date"
          display={Platform.OS === "ios" ? "inline" : "default"}
          onValueChange={(_event: DateTimePickerChangeEvent, selected: Date) => {
            setOpen(false);
            if (selected) onChange(dateToKey(selected));
          }}
          onDismiss={() => setOpen(false)}
        />
      )}
    </View>
  );
}

/** Botón con la hora (HH:MM) que abre el selector nativo; con hora puesta, "Quitar hora" la vacía. */
function TimeField({ label, value, onChange, defaultTime }: { label: string; value: string; onChange: (time: string) => void; defaultTime: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable style={styles.dateButton} onPress={() => setOpen(true)}>
        <Text style={styles.dateButtonText}>{value || "Sin hora"}</Text>
      </Pressable>
      {value ? (
        <Pressable onPress={() => onChange("")} hitSlop={6}>
          <Text style={styles.removeText}>Quitar hora</Text>
        </Pressable>
      ) : null}
      {open && (
        <DateTimePicker
          value={timeToDate(value || defaultTime)}
          mode="time"
          display="default"
          is24Hour
          onValueChange={(_event: DateTimePickerChangeEvent, selected: Date) => {
            setOpen(false);
            if (selected) onChange(`${pad2(selected.getHours())}:${pad2(selected.getMinutes())}`);
          }}
          onDismiss={() => setOpen(false)}
        />
      )}
    </View>
  );
}

const styles = themedStyles(() => ({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    gap: 10,
    ...shadow,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardTitle: { fontFamily: fonts.sansBold, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6, color: colors.mutedForeground },
  cardTitleSerif: { fontFamily: fonts.serif, fontSize: 22, color: colors.foreground },
  fieldLabel: { fontFamily: fonts.sansBold, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.8, color: colors.mutedForeground, marginBottom: 4 },
  mutedSmall: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground },
  emptyText: { fontFamily: fonts.sans, fontSize: 13, color: colors.mutedForeground, fontStyle: "italic" },
  errorText: { fontFamily: fonts.sans, fontSize: 12, color: colors.destructive, marginTop: 8 },
  input: {
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.input,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.foreground,
    backgroundColor: colors.background,
  },
  plusButton: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.foreground, alignItems: "center", justifyContent: "center" },
  plusButtonText: { fontFamily: fonts.sansBold, fontSize: 16, lineHeight: 18, color: colors.background },
  deleteX: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground, paddingHorizontal: 4 },
  removeText: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.destructive },
  disabled: { opacity: 0.4 },

  planRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 10,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
  },
  planRowSelected: { borderColor: colors.primary, backgroundColor: withAlpha(colors.primary, 0.06) },
  playButton: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.inputBorder, alignItems: "center", justifyContent: "center" },
  playButtonOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  playButtonText: { fontSize: 12, color: colors.foreground },
  playButtonTextOn: { color: colors.primaryForeground },
  rowTopic: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.foreground },
  timesRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  timeBox: { backgroundColor: colors.muted, borderRadius: radius.input, paddingHorizontal: 10, paddingVertical: 6, minWidth: 74 },
  timeLabel: { fontFamily: fonts.sansBold, fontSize: 9, textTransform: "uppercase", letterSpacing: 0.6, color: colors.mutedForeground },
  timeValue: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.foreground },

  timerTopic: { fontFamily: fonts.serif, fontSize: 24, color: colors.foreground, textAlign: "center" },
  ringWrap: { width: RING_SIZE, height: RING_SIZE, alignSelf: "center", marginVertical: 8 },
  ringCenter: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", paddingHorizontal: 28, gap: 2 },
  timerDigits: { fontFamily: fonts.sansBold, fontSize: 34, color: colors.foreground, fontVariant: ["tabular-nums"] },
  timerSub: { fontFamily: fonts.sans, fontSize: 13, color: colors.mutedForeground, fontVariant: ["tabular-nums"] },
  timerHint: { fontFamily: fonts.sans, fontSize: 13, color: colors.mutedForeground, textAlign: "center" },
  timerButtons: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },

  primaryButton: { backgroundColor: colors.foreground, borderRadius: radius.full, paddingVertical: 13, paddingHorizontal: 22, alignItems: "center" },
  primaryButtonText: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.background },
  outlineButton: { borderWidth: 1, borderColor: withAlpha(colors.primary, 0.4), borderRadius: radius.full, paddingHorizontal: 18, paddingVertical: 12 },
  outlineButtonText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.primary },

  checkRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  checkMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.inputBorder, alignItems: "center", justifyContent: "center" },
  checkboxOn: { backgroundColor: colors.foreground, borderColor: colors.foreground },
  checkboxTick: { fontFamily: fonts.sansBold, fontSize: 13, lineHeight: 15, color: colors.background },
  examTitle: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.foreground },
  topicName: { flex: 1, fontFamily: fonts.sans, fontSize: 14, color: colors.foreground },
  doneText: { textDecorationLine: "line-through", opacity: 0.45 },

  addRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  addButton: { backgroundColor: colors.foreground, borderRadius: radius.input, width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  addButtonText: { fontFamily: fonts.sansBold, fontSize: 20, color: colors.background },

  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border },
  chipSelected: { backgroundColor: colors.foreground, borderColor: colors.foreground },
  chipText: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground },
  chipTextSelected: { color: colors.background },

  dateRow: { flexDirection: "row", gap: 10 },
  dateButton: {
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.input,
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: colors.background,
    marginBottom: 4,
  },
  dateButtonText: { fontFamily: fonts.sans, fontSize: 13, color: colors.foreground },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(45,41,38,0.4)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card, padding: 20, maxHeight: "90%" },
  modalTitle: { fontFamily: fonts.serif, fontSize: 24, color: colors.foreground, marginBottom: 16 },
  cancelButton: { alignItems: "center", padding: 10 },
  cancelButtonText: { fontFamily: fonts.sans, fontSize: 14, color: colors.mutedForeground },
}));
