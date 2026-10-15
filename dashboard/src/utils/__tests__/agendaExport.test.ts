import { describe, expect, it } from "vitest";
import { dateKeyToIsoWeekString, isoWeekStringToMondayKey } from "../agendaExport";

// Solo la conversión de semanas ISO (valor de <input type="week">); la generación de .ics/PDF toca el DOM.
describe("agendaExport", () => {
  describe("isoWeekStringToMondayKey", () => {
    it("devuelve el lunes de la semana ISO", () => {
      expect(isoWeekStringToMondayKey("2026-W42")).toBe("2026-10-12");
    });

    it("la semana 1 puede empezar en el año anterior", () => {
      // El 4 de enero de 2026 es domingo: la semana 1 empieza el lunes 29 de diciembre de 2025.
      expect(isoWeekStringToMondayKey("2026-W01")).toBe("2025-12-29");
    });

    it("null si el valor no tiene la forma YYYY-Www", () => {
      expect(isoWeekStringToMondayKey("2026-42")).toBeNull();
      expect(isoWeekStringToMondayKey("")).toBeNull();
    });
  });

  describe("dateKeyToIsoWeekString", () => {
    it("devuelve la semana ISO que contiene la fecha", () => {
      expect(dateKeyToIsoWeekString("2026-10-15")).toBe("2026-W42");
      expect(dateKeyToIsoWeekString("2026-10-12")).toBe("2026-W42");
      expect(dateKeyToIsoWeekString("2026-10-18")).toBe("2026-W42");
    });

    it("en el cambio de año usa el año de la semana ISO, no el del calendario", () => {
      expect(dateKeyToIsoWeekString("2027-01-01")).toBe("2026-W53");
      expect(dateKeyToIsoWeekString("2024-12-30")).toBe("2025-W01");
    });

    it("es el inverso de isoWeekStringToMondayKey", () => {
      for (const week of ["2025-W01", "2026-W01", "2026-W42", "2026-W53"]) {
        const monday = isoWeekStringToMondayKey(week) as string;
        expect(dateKeyToIsoWeekString(monday)).toBe(week);
      }
    });
  });
});
