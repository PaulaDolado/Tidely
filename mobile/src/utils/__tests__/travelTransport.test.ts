import { describe, expect, it } from "vitest";
import { TransportDetail } from "../../api/customPages";
import { buildTransportChains, formatLayover, formatSchedule, layoverMinutes, linkCandidates, shortDay, validateTransportTimes } from "../travelTransport";

function leg(id: string, date: string, extra: Partial<TransportDetail> = {}): TransportDetail {
  return { id, type: "train", date, ...extra };
}

const ids = (items: { id: string }[]) => items.map((i) => i.id);

describe("travelTransport", () => {
  describe("shortDay", () => {
    it("pasa YYYY-MM-DD a día y mes corto sin depender de Intl", () => {
      expect(shortDay("2026-11-30")).toBe("30 nov");
      expect(shortDay("2026-01-05")).toBe("5 ene");
    });

    it("devuelve la clave tal cual si no es válida", () => {
      expect(shortDay("2026-13-01")).toBe("2026-13-01");
      expect(shortDay("mañana")).toBe("mañana");
    });
  });

  describe("buildTransportChains", () => {
    it("une los tramos enlazados y ordena las cadenas por la salida de su primer tramo", () => {
      const legs = [
        leg("lisboa", "2026-11-30", { departureTime: "14:00" }),
        leg("oporto", "2026-11-30", { departureTime: "08:00", nextId: "lisboa" }),
        leg("vuelta", "2026-12-05", { departureTime: "09:00" }),
        leg("ida", "2026-11-29", { departureTime: "18:00" }),
      ];
      expect(buildTransportChains(legs).map(ids)).toEqual([["ida"], ["oporto", "lisboa"], ["vuelta"]]);
    });

    it("un nextId a un tramo que no existe corta la cadena", () => {
      expect(buildTransportChains([leg("a", "2026-11-30", { nextId: "borrado" }), leg("b", "2026-12-01")]).map(ids)).toEqual([["a"], ["b"]]);
    });

    it("guarda de ciclos: dos tramos que se apuntan entre sí salen una vez y sin cadenas vacías", () => {
      const legs = [leg("y", "2026-12-01", { nextId: "x" }), leg("x", "2026-11-30", { nextId: "y" }), leg("z", "2026-12-10")];
      const chains = buildTransportChains(legs);
      expect(chains.map(ids)).toEqual([["z"], ["x", "y"]]);
      expect(chains.flat()).toHaveLength(legs.length);
    });

    it("un tramo que se apunta a sí mismo sigue siendo inicio de su cadena", () => {
      const legs = [leg("b", "2026-12-01"), leg("a", "2026-11-30", { nextId: "a" })];
      expect(buildTransportChains(legs).map(ids)).toEqual([["a"], ["b"]]);
    });

    it("sin tramos no hay cadenas", () => {
      expect(buildTransportChains([])).toEqual([]);
    });
  });

  describe("layoverMinutes", () => {
    it("minutos entre la llegada de uno y la salida del siguiente, también si llega otro día", () => {
      expect(layoverMinutes(leg("a", "2026-11-30", { arrivalTime: "11:05" }), leg("b", "2026-11-30", { departureTime: "12:35" }))).toBe(90);
      expect(
        layoverMinutes(leg("a", "2026-11-30", { arrivalDate: "2026-12-01", arrivalTime: "06:00" }), leg("b", "2026-12-01", { departureTime: "07:30" }))
      ).toBe(90);
    });

    it("negativo si la conexión no llega a tiempo y null si falta alguna hora", () => {
      expect(layoverMinutes(leg("a", "2026-11-30", { arrivalTime: "11:05" }), leg("b", "2026-11-30", { departureTime: "10:50" }))).toBe(-15);
      expect(layoverMinutes(leg("a", "2026-11-30"), leg("b", "2026-11-30", { departureTime: "10:50" }))).toBeNull();
      expect(layoverMinutes(leg("a", "2026-11-30", { arrivalTime: "11:05" }), leg("b", "2026-11-30"))).toBeNull();
    });

    it("null si la hora no es válida", () => {
      expect(layoverMinutes(leg("a", "2026-11-30", { arrivalTime: "a las once" }), leg("b", "2026-11-30", { departureTime: "12:00" }))).toBeNull();
    });
  });

  describe("formatLayover", () => {
    it("pasa minutos a horas y minutos, usando el valor absoluto", () => {
      expect(formatLayover(80)).toBe("1 h 20 min");
      expect(formatLayover(120)).toBe("2 h");
      expect(formatLayover(45)).toBe("45 min");
      expect(formatLayover(-15)).toBe("15 min");
    });
  });

  describe("formatSchedule", () => {
    it("cubre el mismo día, otro día, solo salida, solo llegada y sin horas", () => {
      expect(formatSchedule(leg("a", "2026-11-30", { departureTime: "08:35", arrivalTime: "11:05" }))).toBe("30 nov · 08:35 → 11:05");
      expect(formatSchedule(leg("a", "2026-11-30", { departureTime: "22:10", arrivalDate: "2026-12-01", arrivalTime: "06:40" }))).toBe(
        "30 nov 22:10 → 1 dic 06:40"
      );
      expect(formatSchedule(leg("a", "2026-11-30", { arrivalDate: "2026-12-01" }))).toBe("30 nov → 1 dic");
      expect(formatSchedule(leg("a", "2026-11-30", { departureTime: "08:35" }))).toBe("30 nov · sale 08:35");
      expect(formatSchedule(leg("a", "2026-11-30", { arrivalTime: "11:05" }))).toBe("30 nov · llega 11:05");
      expect(formatSchedule(leg("a", "2026-11-30"))).toBe("30 nov");
    });
  });

  describe("validateTransportTimes", () => {
    it("acepta horarios coherentes", () => {
      expect(validateTransportTimes({ date: "2026-11-30", departureTime: "08:00", arrivalTime: "11:00" })).toBeNull();
      expect(validateTransportTimes({ date: "2026-11-30", departureTime: "22:00", arrivalDate: "2026-12-01", arrivalTime: "06:00" })).toBeNull();
      expect(validateTransportTimes({ date: "2026-11-30" })).toBeNull();
    });

    it("rechaza una fecha de llegada anterior a la de salida", () => {
      expect(validateTransportTimes({ date: "2026-11-30", arrivalDate: "2026-11-29" })).toBe("La fecha de llegada no puede ser anterior a la de salida.");
    });

    it("el mismo día, rechaza una hora de llegada anterior a la de salida", () => {
      expect(validateTransportTimes({ date: "2026-11-30", departureTime: "11:00", arrivalTime: "08:00" })).toBe("La llegada no puede ser anterior a la salida.");
      expect(validateTransportTimes({ date: "2026-11-30", departureTime: "11:00", arrivalDate: "2026-11-30", arrivalTime: "08:00" })).toBe(
        "La llegada no puede ser anterior a la salida."
      );
    });
  });

  describe("linkCandidates", () => {
    // a → b → c, e → d
    const legs = [
      leg("e", "2026-12-02", { nextId: "d" }),
      leg("c", "2026-12-01"),
      leg("a", "2026-11-30", { departureTime: "08:00", nextId: "b" }),
      leg("d", "2026-12-03"),
      leg("b", "2026-11-30", { departureTime: "12:00", nextId: "c" }),
    ];

    it("excluye el propio tramo, los que lo preceden (ciclo) y los que ya continúan a otro", () => {
      expect(ids(linkCandidates(legs, "c"))).toEqual(["e"]);
    });

    it("mantiene como candidata su continuación actual y ordena por salida", () => {
      expect(ids(linkCandidates(legs, "b"))).toEqual(["c", "e"]);
    });

    it("para un tramo nuevo sin anterior solo excluye los ya enlazados", () => {
      expect(ids(linkCandidates(legs))).toEqual(["a", "e"]);
    });

    it("un tramo nuevo creado como conexión de otro no puede volver a él ni a sus anteriores", () => {
      // Nuevo tramo que continúa a `c`: c y todo lo que va antes (b, a) quedan fuera.
      expect(ids(linkCandidates(legs, undefined, "c"))).toEqual(["e"]);
    });

    it("no se cuelga con datos en ciclo", () => {
      const cyclic = [leg("x", "2026-11-30", { nextId: "y" }), leg("y", "2026-11-30", { nextId: "x" }), leg("z", "2026-12-01")];
      expect(ids(linkCandidates(cyclic, "x"))).toEqual(["z"]);
    });
  });
});
