import { describe, expect, it } from "vitest";
import { EventExceptionLike, expandRecurringEvent, RecurringEventLike } from "../recurrence";

const d = (iso: string) => new Date(iso);

function event(pattern: string | null, start: string, end: string, extra: Partial<RecurringEventLike> = {}): RecurringEventLike {
  return { id: "ev-1", isRecurring: pattern !== null, recurringPattern: pattern, startTime: d(start), endTime: d(end), ...extra };
}

const starts = (occ: { startTime: Date }[]) => occ.map((o) => o.startTime.toISOString());

describe("recurrence (móvil)", () => {
  describe("expandRecurringEvent", () => {
    it("un evento no recurrente no se expande (lo añade quien llama)", () => {
      const ev = event(null, "2026-10-12T09:00:00.000Z", "2026-10-12T10:00:00.000Z");
      expect(expandRecurringEvent(ev, d("2026-10-01T00:00:00.000Z"), d("2026-10-31T00:00:00.000Z"))).toEqual([]);
      expect(expandRecurringEvent({ ...ev, isRecurring: true }, d("2026-10-01T00:00:00.000Z"), d("2026-10-31T00:00:00.000Z"))).toEqual([]);
    });

    it("daily: una ocurrencia por día dentro del rango, con la duración del original", () => {
      const ev = event("daily", "2026-10-12T09:00:00.000Z", "2026-10-12T10:30:00.000Z");
      const occ = expandRecurringEvent(ev, d("2026-10-12T00:00:00.000Z"), d("2026-10-15T00:00:00.000Z"));
      expect(starts(occ)).toEqual(["2026-10-12T09:00:00.000Z", "2026-10-13T09:00:00.000Z", "2026-10-14T09:00:00.000Z"]);
      expect(occ[1].endTime.toISOString()).toBe("2026-10-13T10:30:00.000Z");
      expect(occ[1]).toMatchObject({ event: ev, seriesId: "ev-1", isRecurringInstance: true });
      expect(occ[1].originalStartTime?.toISOString()).toBe("2026-10-13T09:00:00.000Z");
      expect(occ[1].isException).toBeUndefined();
    });

    it("solo incluye ocurrencias que caben enteras en el rango", () => {
      const ev = event("daily", "2026-10-12T23:00:00.000Z", "2026-10-13T01:00:00.000Z");
      // La del 12 empieza antes del rango y la del 14 acaba después: solo cabe la del 13.
      const occ = expandRecurringEvent(ev, d("2026-10-13T00:00:00.000Z"), d("2026-10-15T00:00:00.000Z"));
      expect(starts(occ)).toEqual(["2026-10-13T23:00:00.000Z"]);
    });

    it("weekly y biweekly avanzan de 7 en 7 y de 14 en 14 días", () => {
      const range = [d("2026-10-01T00:00:00.000Z"), d("2026-10-31T00:00:00.000Z")] as const;
      expect(starts(expandRecurringEvent(event("weekly", "2026-10-05T08:00:00.000Z", "2026-10-05T09:00:00.000Z"), ...range))).toEqual([
        "2026-10-05T08:00:00.000Z",
        "2026-10-12T08:00:00.000Z",
        "2026-10-19T08:00:00.000Z",
        "2026-10-26T08:00:00.000Z",
      ]);
      expect(starts(expandRecurringEvent(event("biweekly", "2026-10-05T08:00:00.000Z", "2026-10-05T09:00:00.000Z"), ...range))).toEqual([
        "2026-10-05T08:00:00.000Z",
        "2026-10-19T08:00:00.000Z",
      ]);
    });

    it("un patrón desconocido se trata como semanal", () => {
      const occ = expandRecurringEvent(event("raro", "2026-10-05T08:00:00.000Z", "2026-10-05T09:00:00.000Z"), d("2026-10-01T00:00:00.000Z"), d("2026-10-20T00:00:00.000Z"));
      expect(starts(occ)).toEqual(["2026-10-05T08:00:00.000Z", "2026-10-12T08:00:00.000Z", "2026-10-19T08:00:00.000Z"]);
    });

    it("monthly: un evento del día 31 se recorta en los meses cortos pero vuelve al 31 (sin deriva)", () => {
      const ev = event("monthly", "2026-01-31T10:00:00.000Z", "2026-01-31T11:00:00.000Z");
      const occ = expandRecurringEvent(ev, d("2026-01-01T00:00:00.000Z"), d("2026-05-31T23:59:59.000Z"));
      expect(starts(occ)).toEqual([
        "2026-01-31T10:00:00.000Z",
        "2026-02-28T10:00:00.000Z",
        "2026-03-31T10:00:00.000Z",
        "2026-04-30T10:00:00.000Z",
        "2026-05-31T10:00:00.000Z",
      ]);
    });

    it("monthly: en año bisiesto febrero llega al 29", () => {
      const ev = event("monthly", "2028-01-31T10:00:00.000Z", "2028-01-31T11:00:00.000Z");
      const occ = expandRecurringEvent(ev, d("2028-02-01T00:00:00.000Z"), d("2028-02-29T23:59:59.000Z"));
      expect(starts(occ)).toEqual(["2028-02-29T10:00:00.000Z"]);
    });

    it("weekday_range: solo los días de la semana del rango (por defecto, de lunes a viernes)", () => {
      // 2026-10-12 es lunes.
      const range = [d("2026-10-12T00:00:00.000Z"), d("2026-10-19T00:00:00.000Z")] as const;
      const laborables = expandRecurringEvent(event("weekday_range", "2026-10-12T07:00:00.000Z", "2026-10-12T08:00:00.000Z"), ...range);
      expect(starts(laborables)).toEqual([
        "2026-10-12T07:00:00.000Z",
        "2026-10-13T07:00:00.000Z",
        "2026-10-14T07:00:00.000Z",
        "2026-10-15T07:00:00.000Z",
        "2026-10-16T07:00:00.000Z",
      ]);

      const findeSemana = expandRecurringEvent(
        event("weekday_range", "2026-10-12T07:00:00.000Z", "2026-10-12T08:00:00.000Z", { recurringWeekdayStart: 6, recurringWeekdayEnd: 7 }),
        ...range
      );
      expect(starts(findeSemana)).toEqual(["2026-10-17T07:00:00.000Z", "2026-10-18T07:00:00.000Z"]);
    });

    it("weekday_range: un rango que da la vuelta a la semana (de viernes a lunes)", () => {
      const occ = expandRecurringEvent(
        event("weekday_range", "2026-10-12T07:00:00.000Z", "2026-10-12T08:00:00.000Z", { recurringWeekdayStart: 5, recurringWeekdayEnd: 1 }),
        d("2026-10-12T00:00:00.000Z"),
        d("2026-10-20T00:00:00.000Z")
      );
      expect(starts(occ)).toEqual([
        "2026-10-12T07:00:00.000Z", // lunes
        "2026-10-16T07:00:00.000Z", // viernes
        "2026-10-17T07:00:00.000Z",
        "2026-10-18T07:00:00.000Z",
        "2026-10-19T07:00:00.000Z", // lunes
      ]);
    });

    describe("con excepciones", () => {
      const ev = event("daily", "2026-10-12T09:00:00.000Z", "2026-10-12T10:00:00.000Z");
      const range = [d("2026-10-12T00:00:00.000Z"), d("2026-10-15T00:00:00.000Z")] as const;

      it("una ocurrencia cancelada desaparece", () => {
        const exceptions: EventExceptionLike[] = [{ originalStartTime: d("2026-10-13T09:00:00.000Z"), status: "cancelled" }];
        expect(starts(expandRecurringEvent(ev, ...range, exceptions))).toEqual(["2026-10-12T09:00:00.000Z", "2026-10-14T09:00:00.000Z"]);
      });

      it("una ocurrencia movida sale con su nuevo horario, marcada como excepción y con su inicio original", () => {
        const exceptions: EventExceptionLike[] = [
          {
            originalStartTime: d("2026-10-13T09:00:00.000Z"),
            status: "moved",
            newStartTime: d("2026-10-13T16:00:00.000Z"),
            newEndTime: d("2026-10-13T18:00:00.000Z"),
          },
        ];
        const occ = expandRecurringEvent(ev, ...range, exceptions);
        expect(starts(occ)).toEqual(["2026-10-12T09:00:00.000Z", "2026-10-13T16:00:00.000Z", "2026-10-14T09:00:00.000Z"]);
        expect(occ[1]).toMatchObject({ isException: true, exceptionStatus: "moved", seriesId: "ev-1" });
        expect(occ[1].endTime.toISOString()).toBe("2026-10-13T18:00:00.000Z");
        expect(occ[1].originalStartTime?.toISOString()).toBe("2026-10-13T09:00:00.000Z");
      });

      it("una movida sin horario nuevo conserva el natural", () => {
        const exceptions: EventExceptionLike[] = [{ originalStartTime: d("2026-10-13T09:00:00.000Z"), status: "moved", newStartTime: null, newEndTime: null }];
        const occ = expandRecurringEvent(ev, ...range, exceptions);
        expect(occ[1].startTime.toISOString()).toBe("2026-10-13T09:00:00.000Z");
        expect(occ[1].endTime.toISOString()).toBe("2026-10-13T10:00:00.000Z");
        expect(occ[1].isException).toBe(true);
      });

      it("una ocurrencia movida fuera del rango no se enseña", () => {
        const exceptions: EventExceptionLike[] = [
          {
            originalStartTime: d("2026-10-13T09:00:00.000Z"),
            status: "moved",
            newStartTime: d("2026-10-20T09:00:00.000Z"),
            newEndTime: d("2026-10-20T10:00:00.000Z"),
          },
        ];
        expect(starts(expandRecurringEvent(ev, ...range, exceptions))).toEqual(["2026-10-12T09:00:00.000Z", "2026-10-14T09:00:00.000Z"]);
      });

      it("una excepción que no coincide con ninguna ocurrencia no cambia nada", () => {
        const exceptions: EventExceptionLike[] = [{ originalStartTime: d("2026-10-13T09:30:00.000Z"), status: "cancelled" }];
        expect(expandRecurringEvent(ev, ...range, exceptions)).toHaveLength(3);
      });
    });

    it("se detiene en el límite de seguridad de ocurrencias aunque el rango sea enorme", () => {
      const ev = event("daily", "2026-01-01T09:00:00.000Z", "2026-01-01T10:00:00.000Z");
      const occ = expandRecurringEvent(ev, d("2026-01-01T00:00:00.000Z"), d("2056-01-01T00:00:00.000Z"));
      expect(occ).toHaveLength(3660);
    });

    it("un rango que empieza después de la serie no devuelve las ocurrencias anteriores", () => {
      const ev = event("weekly", "2026-01-05T08:00:00.000Z", "2026-01-05T09:00:00.000Z");
      const occ = expandRecurringEvent(ev, d("2026-10-12T00:00:00.000Z"), d("2026-10-18T23:59:59.000Z"));
      expect(starts(occ)).toEqual(["2026-10-12T08:00:00.000Z"]);
    });
  });
});
