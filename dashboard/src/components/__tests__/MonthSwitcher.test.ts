import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentPeriod, isCurrentPeriod, monthName, periodLabel } from "../MonthSwitcher";

// Solo los helpers puros del selector de mes; el componente no se renderiza.
describe("MonthSwitcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Hora local a mediodía: así no cambia de día/mes con la zona horaria de quien ejecute los tests.
    vi.setSystemTime(new Date(2026, 9, 15, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("currentPeriod", () => {
    it("devuelve el mes (1-12) y el año de hoy", () => {
      expect(currentPeriod()).toEqual({ month: 10, year: 2026 });
    });

    it("enero es el mes 1, no el 0", () => {
      vi.setSystemTime(new Date(2027, 0, 1, 12, 0, 0));
      expect(currentPeriod()).toEqual({ month: 1, year: 2027 });
    });
  });

  describe("isCurrentPeriod", () => {
    it("solo es el periodo actual si coinciden mes y año", () => {
      expect(isCurrentPeriod({ month: 10, year: 2026 })).toBe(true);
      expect(isCurrentPeriod({ month: 9, year: 2026 })).toBe(false);
      expect(isCurrentPeriod({ month: 10, year: 2025 })).toBe(false);
    });
  });

  describe("periodLabel", () => {
    it("mes y año en español con la primera letra en mayúscula", () => {
      expect(periodLabel({ month: 10, year: 2026 })).toBe("Octubre de 2026");
      expect(periodLabel({ month: 1, year: 2027 })).toBe("Enero de 2027");
    });
  });

  describe("monthName", () => {
    it("solo el nombre del mes, en minúsculas", () => {
      expect(monthName({ month: 10, year: 2026 })).toBe("octubre");
      expect(monthName({ month: 12, year: 2026 })).toBe("diciembre");
    });
  });
});
