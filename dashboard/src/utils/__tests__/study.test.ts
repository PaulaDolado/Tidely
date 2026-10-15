import { describe, expect, it } from "vitest";
import { StudyPlanRow, StudySubject } from "../../types";
import { emptyStudyContent, formatClock, formatDuration, parseDuration, spentOnSubject, spentOnTopic, topicNameOf } from "../study";

function row(partial: Partial<StudyPlanRow> & { id: string }): StudyPlanRow {
  return { subjectId: "mates", topicName: "", kind: "study", plannedMinutes: 0, spentSeconds: 0, ...partial };
}

describe("study", () => {
  describe("parseDuration", () => {
    it("cadena vacía (o solo espacios) = 0, sin tiempo asignado", () => {
      expect(parseDuration("")).toBe(0);
      expect(parseDuration("   ")).toBe(0);
    });

    it("entiende horas sueltas, con decimales y coma o punto", () => {
      expect(parseDuration("2")).toBe(120);
      expect(parseDuration("1,5")).toBe(90);
      expect(parseDuration("1.25")).toBe(75);
      expect(parseDuration("0.1")).toBe(6);
    });

    it("entiende h:mm", () => {
      expect(parseDuration("2:30")).toBe(150);
      expect(parseDuration("0:05")).toBe(5);
      expect(parseDuration("1:5")).toBe(65);
    });

    it("entiende 2h, 2h30, 2h 30min y mayúsculas", () => {
      expect(parseDuration("2h")).toBe(120);
      expect(parseDuration("2h30")).toBe(150);
      expect(parseDuration("2h 30min")).toBe(150);
      expect(parseDuration("2 h 30 m")).toBe(150);
      expect(parseDuration(" 2H ")).toBe(120);
    });

    it("entiende minutos con m o min", () => {
      expect(parseDuration("90m")).toBe(90);
      expect(parseDuration("45 min")).toBe(45);
    });

    it("devuelve null si no lo entiende", () => {
      expect(parseDuration("abc")).toBeNull();
      expect(parseDuration("2:75")).toBeNull();
      expect(parseDuration("-1")).toBeNull();
      expect(parseDuration("2h30x")).toBeNull();
      expect(parseDuration("1,5,5")).toBeNull();
    });
  });

  describe("formatDuration", () => {
    it("pasa segundos a h:mm redondeando los minutos hacia abajo", () => {
      expect(formatDuration(5400)).toBe("1:30");
      expect(formatDuration(0)).toBe("0:00");
      expect(formatDuration(59)).toBe("0:00");
      expect(formatDuration(61)).toBe("0:01");
      expect(formatDuration(36_000)).toBe("10:00");
    });

    it("trata los negativos como 0", () => {
      expect(formatDuration(-300)).toBe("0:00");
    });
  });

  describe("formatClock", () => {
    it("pasa segundos a h:mm:ss", () => {
      expect(formatClock(3725)).toBe("1:02:05");
      expect(formatClock(0)).toBe("0:00:00");
      expect(formatClock(59.9)).toBe("0:00:59");
      expect(formatClock(90_000)).toBe("25:00:00");
    });

    it("trata los negativos como 0", () => {
      expect(formatClock(-5)).toBe("0:00:00");
    });
  });

  describe("emptyStudyContent", () => {
    it("rellena con listas vacías lo que falte (página recién creada)", () => {
      expect(emptyStudyContent(undefined)).toEqual({ subjects: [], plan: [], exams: [] });
      expect(emptyStudyContent({})).toEqual({ subjects: [], plan: [], exams: [] });
    });

    it("conserva lo que ya hay", () => {
      const subjects: StudySubject[] = [{ id: "s1", name: "Mates", topics: [] }];
      const content = emptyStudyContent({ subjects });
      expect(content.subjects).toBe(subjects);
      expect(content.plan).toEqual([]);
      expect(content.exams).toEqual([]);
    });
  });

  describe("topicNameOf", () => {
    const subjects: StudySubject[] = [{ id: "mates", name: "Mates", topics: [{ id: "t1", name: "Derivadas (renombrado)" }] }];

    it("usa el nombre vivo del tema si sigue en el temario", () => {
      expect(topicNameOf(row({ id: "r1", topicId: "t1", topicName: "Derivadas" }), subjects)).toBe("Derivadas (renombrado)");
    });

    it("cae al texto guardado si el tema ya no existe o la fila no apunta a ninguno", () => {
      expect(topicNameOf(row({ id: "r1", topicId: "borrado", topicName: "Integrales" }), subjects)).toBe("Integrales");
      expect(topicNameOf(row({ id: "r2", topicName: "Repaso" }), subjects)).toBe("Repaso");
    });

    it("cae al texto guardado si la asignatura ya no existe", () => {
      expect(topicNameOf(row({ id: "r1", subjectId: "fisica", topicId: "t1", topicName: "Derivadas" }), subjects)).toBe("Derivadas");
    });
  });

  describe("spentOnTopic / spentOnSubject", () => {
    const plan = [
      row({ id: "r1", subjectId: "mates", topicId: "t1", spentSeconds: 600 }),
      row({ id: "r2", subjectId: "mates", topicId: "t1", spentSeconds: 300 }),
      row({ id: "r3", subjectId: "mates", topicId: "t2", spentSeconds: 120 }),
      row({ id: "r4", subjectId: "mates", spentSeconds: 60 }),
      row({ id: "r5", subjectId: "fisica", topicId: "t9", spentSeconds: 1000 }),
    ];

    it("suma el tiempo real de todas las filas de un tema", () => {
      expect(spentOnTopic(plan, "t1")).toBe(900);
      expect(spentOnTopic(plan, "t2")).toBe(120);
      expect(spentOnTopic(plan, "nada")).toBe(0);
    });

    it("suma el tiempo real de todas las filas de una asignatura, tengan tema o no", () => {
      expect(spentOnSubject(plan, "mates")).toBe(1080);
      expect(spentOnSubject(plan, "fisica")).toBe(1000);
      expect(spentOnSubject([], "mates")).toBe(0);
    });
  });
});
