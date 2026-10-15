import { describe, expect, it } from "vitest";
import { StudyExam, StudyPlanRow, StudySubject } from "../../api/customPages";
import {
  formatClock,
  formatDuration,
  normalizeStudyContent,
  parseDuration,
  sameName,
  sortExams,
  spentOnSubject,
  spentOnTopic,
  timerArcs,
  topicNameOf,
} from "../study";

function row(partial: Partial<StudyPlanRow> & { id: string }): StudyPlanRow {
  return { subjectId: "mates", topicName: "", kind: "study", plannedMinutes: 0, spentSeconds: 0, ...partial };
}

describe("study (móvil)", () => {
  describe("parseDuration", () => {
    it("entiende los mismos formatos que la web", () => {
      expect(parseDuration("")).toBe(0);
      expect(parseDuration("2")).toBe(120);
      expect(parseDuration("1,5")).toBe(90);
      expect(parseDuration("2:30")).toBe(150);
      expect(parseDuration("2h")).toBe(120);
      expect(parseDuration("2h30")).toBe(150);
      expect(parseDuration("2h 30min")).toBe(150);
      expect(parseDuration("90m")).toBe(90);
      expect(parseDuration("45 min")).toBe(45);
    });

    it("devuelve null si no lo entiende", () => {
      expect(parseDuration("abc")).toBeNull();
      expect(parseDuration("2:75")).toBeNull();
      expect(parseDuration("-1")).toBeNull();
    });
  });

  describe("formatDuration / formatClock", () => {
    it("formatean segundos como h:mm y h:mm:ss", () => {
      expect(formatDuration(5400)).toBe("1:30");
      expect(formatDuration(-10)).toBe("0:00");
      expect(formatClock(3725)).toBe("1:02:05");
      expect(formatClock(-1)).toBe("0:00:00");
    });
  });

  describe("normalizeStudyContent", () => {
    it("una página recién creada o un valor raro da el contenido vacío", () => {
      const vacio = { subjects: [], plan: [], exams: [] };
      expect(normalizeStudyContent({})).toEqual(vacio);
      expect(normalizeStudyContent(null)).toEqual(vacio);
      expect(normalizeStudyContent("texto")).toEqual(vacio);
      expect(normalizeStudyContent({ subjects: "no es una lista" })).toEqual(vacio);
    });

    it("descarta entradas sin id y rellena lo que falte", () => {
      const result = normalizeStudyContent({
        subjects: [{ id: "s1", topics: [{ id: "t1", name: "Derivadas", done: 1 }, { name: "sin id" }] }, { name: "sin id" }, null],
        plan: [{ id: "r1", subjectId: "s1" }],
        exams: [{ id: "e1", title: "Parcial", date: "2026-11-02" }, 42],
      });
      expect(result.subjects).toEqual([{ id: "s1", name: "", topics: [{ id: "t1", name: "Derivadas", done: true }] }]);
      expect(result.plan).toEqual([{ id: "r1", subjectId: "s1", topicName: "", kind: "study", plannedMinutes: 0, spentSeconds: 0 }]);
      expect(result.exams).toEqual([{ id: "e1", title: "Parcial", date: "2026-11-02" }]);
    });

    it("sanea los números del plan y solo acepta los tipos conocidos", () => {
      const [a, b] = normalizeStudyContent({
        plan: [
          { id: "a", subjectId: "s1", topicId: "t1", topicName: "X", kind: "exercises", plannedMinutes: 29.6, spentSeconds: 100.4 },
          { id: "b", subjectId: "s1", topicId: "", kind: "otro", plannedMinutes: -5, spentSeconds: Number.NaN },
        ],
      }).plan;
      expect(a).toEqual({ id: "a", subjectId: "s1", topicId: "t1", topicName: "X", kind: "exercises", plannedMinutes: 30, spentSeconds: 100 });
      expect(b).toEqual({ id: "b", subjectId: "s1", topicName: "", kind: "study", plannedMinutes: 0, spentSeconds: 0 });
    });

    it("conserva los campos opcionales de los exámenes solo si tienen valor", () => {
      const [con, sin] = normalizeStudyContent({
        exams: [
          { id: "e1", title: "Final", subjectId: "s1", date: "2026-12-10", time: "09:00", done: true },
          { id: "e2", title: "Otro", subjectId: "", date: "2026-12-11", time: "", done: false },
        ],
      }).exams;
      expect(con).toEqual({ id: "e1", title: "Final", subjectId: "s1", date: "2026-12-10", time: "09:00", done: true });
      expect(sin).toEqual({ id: "e2", title: "Otro", date: "2026-12-11" });
    });
  });

  describe("topicNameOf / spentOnTopic / spentOnSubject", () => {
    const subjects: StudySubject[] = [{ id: "mates", name: "Mates", topics: [{ id: "t1", name: "Derivadas (renombrado)" }] }];
    const plan = [
      row({ id: "r1", topicId: "t1", topicName: "Derivadas", spentSeconds: 600 }),
      row({ id: "r2", topicId: "t1", spentSeconds: 300 }),
      row({ id: "r3", topicName: "Repaso", spentSeconds: 60 }),
      row({ id: "r4", subjectId: "fisica", spentSeconds: 1000 }),
    ];

    it("usa el nombre vivo del tema y si no, el guardado", () => {
      expect(topicNameOf(plan[0], subjects)).toBe("Derivadas (renombrado)");
      expect(topicNameOf(plan[2], subjects)).toBe("Repaso");
    });

    it("suma el tiempo real por tema y por asignatura", () => {
      expect(spentOnTopic(plan, "t1")).toBe(900);
      expect(spentOnSubject(plan, "mates")).toBe(960);
      expect(spentOnSubject(plan, "quimica")).toBe(0);
    });
  });

  describe("sameName", () => {
    it("compara sin mayúsculas ni espacios sobrantes", () => {
      expect(sameName("  Matemáticas ", "matemáticas")).toBe(true);
      expect(sameName("Mates", "Matemáticas")).toBe(false);
    });
  });

  describe("sortExams", () => {
    it("ordena por fecha y hora, y sin hora va a primera hora del día", () => {
      const exams: StudyExam[] = [
        { id: "tarde", title: "", date: "2026-11-02", time: "16:00" },
        { id: "sinHora", title: "", date: "2026-11-02" },
        { id: "antes", title: "", date: "2026-11-01", time: "20:00" },
        { id: "manana", title: "", date: "2026-11-02", time: "09:00" },
      ];
      expect(sortExams(exams).map((e) => e.id)).toEqual(["antes", "sinHora", "manana", "tarde"]);
      // No modifica la lista recibida.
      expect(exams[0].id).toBe("tarde");
    });
  });

  describe("timerArcs", () => {
    it("con tiempo asignado, el arco base se llena hasta el objetivo", () => {
      expect(timerArcs(0, 60)).toEqual({ base: 0, over: 0, overtimeSeconds: 0 });
      expect(timerArcs(1800, 60)).toEqual({ base: 0.5, over: 0, overtimeSeconds: 0 });
    });

    it("pasado el objetivo, el arco verde cuenta el sobretiempo vuelta tras vuelta", () => {
      expect(timerArcs(3600, 60)).toEqual({ base: 1, over: 0, overtimeSeconds: 0 });
      expect(timerArcs(3600 + 900, 60)).toEqual({ base: 1, over: 0.25, overtimeSeconds: 900 });
      expect(timerArcs(3600 + 3600 + 1800, 60)).toEqual({ base: 1, over: 0.5, overtimeSeconds: 5400 });
    });

    it("justo en una vuelta completa de sobretiempo el arco verde está lleno, no vacío", () => {
      expect(timerArcs(7200, 60)).toEqual({ base: 1, over: 1, overtimeSeconds: 3600 });
    });

    it("sin tiempo asignado, un único arco que da una vuelta por hora", () => {
      expect(timerArcs(900, 0)).toEqual({ base: 0.25, over: 0, overtimeSeconds: 0 });
      expect(timerArcs(3600 + 1800, 0)).toEqual({ base: 0.5, over: 0, overtimeSeconds: 0 });
    });
  });
});
