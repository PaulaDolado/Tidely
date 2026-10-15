import { describe, expect, it } from "vitest";
import { SavedPlace, TransportDetail, Trip } from "../../types";
import {
  attachmentChars,
  buildTransportChains,
  formatDuration,
  formatTransportSchedule,
  hostnameOf,
  isValidEmail,
  isValidPhone,
  layoverMinutes,
  normalizePlaceUrl,
  normalizeTravelContent,
  pickDefaultTrip,
  transferCandidates,
  transportMeta,
} from "../travel";

function trip(id: string, startDate: string, endDate: string, extra: Partial<Trip> = {}): Trip {
  return { id, destination: id, startDate, endDate, itinerary: [], ...extra };
}

function leg(id: string, date: string, extra: Partial<TransportDetail> = {}): TransportDetail {
  return { id, type: "train", date, ...extra };
}

function place(id: string): SavedPlace {
  return { id, name: `Lugar ${id}` };
}

const ids = (items: { id: string }[]) => items.map((i) => i.id);

describe("travel", () => {
  describe("pickDefaultTrip", () => {
    const pasado = trip("pasado", "2026-01-10", "2026-01-15");
    const enCurso = trip("enCurso", "2026-10-10", "2026-10-20");
    const proximo = trip("proximo", "2026-12-01", "2026-12-05");

    it("elige el viaje en curso o el próximo que antes empieza", () => {
      expect(pickDefaultTrip([proximo, pasado, enCurso], "2026-10-15")?.id).toBe("enCurso");
      expect(pickDefaultTrip([proximo, pasado], "2026-10-15")?.id).toBe("proximo");
    });

    it("un viaje que termina hoy todavía cuenta como pendiente", () => {
      expect(pickDefaultTrip([pasado, enCurso, proximo], "2026-10-20")?.id).toBe("enCurso");
    });

    it("si todos han terminado, el último en empezar", () => {
      expect(pickDefaultTrip([enCurso, pasado], "2027-01-01")?.id).toBe("enCurso");
    });

    it("sin viajes devuelve null", () => {
      expect(pickDefaultTrip([], "2026-10-15")).toBeNull();
    });

    it("no reordena la lista recibida", () => {
      const trips = [proximo, pasado, enCurso];
      pickDefaultTrip(trips, "2026-10-15");
      expect(ids(trips)).toEqual(["proximo", "pasado", "enCurso"]);
    });
  });

  describe("normalizeTravelContent", () => {
    const today = "2026-10-15";

    it("da a cada viaje su lista de lugares aunque no la tuviera", () => {
      const result = normalizeTravelContent({ trips: [trip("a", "2026-11-01", "2026-11-05")] }, today);
      expect(result.trips[0].places).toEqual([]);
      expect(result.places).toEqual([]);
    });

    it("migra los lugares sueltos (legado) al viaje por defecto, detrás de los que ya tenía, y vacía el campo", () => {
      const content = {
        trips: [
          trip("pasado", "2026-01-10", "2026-01-15", { places: [place("p0")] }),
          trip("proximo", "2026-11-01", "2026-11-05", { places: [place("p1")] }),
        ],
        places: [place("l1"), place("l2")],
      };
      const result = normalizeTravelContent(content, today);
      expect(result.places).toEqual([]);
      expect(ids(result.trips[0].places ?? [])).toEqual(["p0"]);
      expect(ids(result.trips[1].places ?? [])).toEqual(["p1", "l1", "l2"]);
    });

    it("sin viajes conserva los lugares sueltos hasta que se cree el primero", () => {
      const result = normalizeTravelContent({ trips: [], places: [place("l1")] }, today);
      expect(result.trips).toEqual([]);
      expect(ids(result.places)).toEqual(["l1"]);
    });

    it("es pura: no modifica el contenido recibido", () => {
      const original = trip("a", "2026-11-01", "2026-11-05");
      const content = { trips: [original], places: [place("l1")] };
      normalizeTravelContent(content, today);
      expect(original.places).toBeUndefined();
      expect(content.places).toHaveLength(1);
    });
  });

  describe("normalizePlaceUrl", () => {
    it("antepone https:// si no hay esquema", () => {
      expect(normalizePlaceUrl("ejemplo.com/ruta")).toBe("https://ejemplo.com/ruta");
      expect(normalizePlaceUrl("  www.ejemplo.com  ")).toBe("https://www.ejemplo.com/");
    });

    it("respeta http y https", () => {
      expect(normalizePlaceUrl("http://ejemplo.com")).toBe("http://ejemplo.com/");
      expect(normalizePlaceUrl("https://ejemplo.com/a?b=1")).toBe("https://ejemplo.com/a?b=1");
    });

    it("rechaza cadenas vacías, otros esquemas y URLs inválidas", () => {
      expect(normalizePlaceUrl("")).toBeNull();
      expect(normalizePlaceUrl("   ")).toBeNull();
      expect(normalizePlaceUrl("ftp://ejemplo.com")).toBeNull();
      expect(normalizePlaceUrl("javascript:alert(1)")).toBeNull();
      expect(normalizePlaceUrl("https://")).toBeNull();
    });
  });

  describe("hostnameOf", () => {
    it("quita el esquema, la ruta y el www.", () => {
      expect(hostnameOf("https://www.ejemplo.com/ruta")).toBe("ejemplo.com");
      expect(hostnameOf("http://blog.ejemplo.com")).toBe("blog.ejemplo.com");
    });

    it("si no es una URL la devuelve tal cual", () => {
      expect(hostnameOf("no es una url")).toBe("no es una url");
    });
  });

  describe("transportMeta", () => {
    it("devuelve la etiqueta del tipo y cae en Otro si no lo conoce", () => {
      expect(transportMeta("flight").label).toBe("Vuelo");
      expect(transportMeta("raro" as never).label).toBe("Otro");
    });
  });

  describe("formatTransportSchedule", () => {
    it("salida y llegada el mismo día", () => {
      expect(formatTransportSchedule(leg("a", "2026-11-30", { departureTime: "08:35", arrivalTime: "11:05" }))).toBe("30 nov · 08:35 → 11:05");
    });

    it("llega otro día", () => {
      expect(
        formatTransportSchedule(leg("a", "2026-11-30", { departureTime: "22:10", arrivalDate: "2026-12-01", arrivalTime: "06:40" }))
      ).toBe("30 nov 22:10 → 1 dic 06:40");
      expect(formatTransportSchedule(leg("a", "2026-11-30", { arrivalDate: "2026-12-01" }))).toBe("30 nov → 1 dic");
    });

    it("una fecha de llegada igual a la de salida no cuenta como otro día", () => {
      expect(formatTransportSchedule(leg("a", "2026-11-30", { departureTime: "08:35", arrivalDate: "2026-11-30", arrivalTime: "11:05" }))).toBe(
        "30 nov · 08:35 → 11:05"
      );
    });

    it("solo salida, solo llegada o ninguna hora", () => {
      expect(formatTransportSchedule(leg("a", "2026-11-30", { departureTime: "08:35" }))).toBe("30 nov · sale 08:35");
      expect(formatTransportSchedule(leg("a", "2026-11-30", { arrivalTime: "11:05" }))).toBe("30 nov · llega 11:05");
      expect(formatTransportSchedule(leg("a", "2026-11-30"))).toBe("30 nov");
    });
  });

  describe("layoverMinutes", () => {
    it("minutos entre la llegada de uno y la salida del siguiente", () => {
      const from = leg("a", "2026-11-30", { departureTime: "08:00", arrivalTime: "11:05" });
      const to = leg("b", "2026-11-30", { departureTime: "12:35" });
      expect(layoverMinutes(from, to)).toBe(90);
    });

    it("usa la fecha de llegada si el primero llega otro día", () => {
      const from = leg("a", "2026-11-30", { departureTime: "22:00", arrivalDate: "2026-12-01", arrivalTime: "06:00" });
      const to = leg("b", "2026-12-01", { departureTime: "07:30" });
      expect(layoverMinutes(from, to)).toBe(90);
    });

    it("negativo si la conexión no llega a tiempo", () => {
      const from = leg("a", "2026-11-30", { arrivalTime: "11:05" });
      const to = leg("b", "2026-11-30", { departureTime: "10:50" });
      expect(layoverMinutes(from, to)).toBe(-15);
    });

    it("null si falta alguna hora", () => {
      expect(layoverMinutes(leg("a", "2026-11-30"), leg("b", "2026-11-30", { departureTime: "12:00" }))).toBeNull();
      expect(layoverMinutes(leg("a", "2026-11-30", { arrivalTime: "11:00" }), leg("b", "2026-11-30"))).toBeNull();
    });
  });

  describe("formatDuration", () => {
    it("pasa minutos a horas y minutos", () => {
      expect(formatDuration(80)).toBe("1 h 20 min");
      expect(formatDuration(45)).toBe("45 min");
      expect(formatDuration(120)).toBe("2 h");
      expect(formatDuration(0)).toBe("0 min");
    });
  });

  describe("buildTransportChains", () => {
    it("une los trayectos enlazados y ordena las cadenas por la salida de su primer trayecto", () => {
      const items = [
        leg("lisboa", "2026-11-30", { departureTime: "14:00" }),
        leg("oporto", "2026-11-30", { departureTime: "08:00", nextId: "lisboa" }),
        leg("vuelta", "2026-12-05", { departureTime: "09:00" }),
        leg("ida", "2026-11-29", { departureTime: "18:00" }),
      ];
      expect(buildTransportChains(items).map(ids)).toEqual([["ida"], ["oporto", "lisboa"], ["vuelta"]]);
    });

    it("un nextId que apunta a un trayecto que ya no existe corta la cadena sin perder nada", () => {
      const items = [leg("a", "2026-11-30", { nextId: "borrado" }), leg("b", "2026-12-01")];
      expect(buildTransportChains(items).map(ids)).toEqual([["a"], ["b"]]);
    });

    it("guarda de ciclos: dos trayectos que se apuntan entre sí no cuelgan y salen una sola vez", () => {
      const items = [leg("y", "2026-12-01", { nextId: "x" }), leg("x", "2026-11-30", { nextId: "y" }), leg("z", "2026-12-10")];
      const chains = buildTransportChains(items);
      expect(chains.map(ids)).toEqual([["z"], ["x", "y"]]);
      expect(chains.flat()).toHaveLength(items.length);
    });

    it("un trayecto que se apunta a sí mismo sale solo, una vez", () => {
      expect(buildTransportChains([leg("a", "2026-11-30", { nextId: "a" })]).map(ids)).toEqual([["a"]]);
    });

    it("un ciclo al que llega otra cadena se recorre desde ese inicio", () => {
      const items = [leg("inicio", "2026-11-29", { nextId: "x" }), leg("x", "2026-11-30", { nextId: "y" }), leg("y", "2026-12-01", { nextId: "x" })];
      expect(buildTransportChains(items).map(ids)).toEqual([["inicio", "x", "y"]]);
    });

    it("sin trayectos no hay cadenas", () => {
      expect(buildTransportChains([])).toEqual([]);
    });
  });

  describe("transferCandidates", () => {
    // a → b → c, e → d
    const items = [
      leg("a", "2026-11-30", { nextId: "b" }),
      leg("b", "2026-11-30", { nextId: "c" }),
      leg("c", "2026-12-01"),
      leg("d", "2026-12-02"),
      leg("e", "2026-12-02", { nextId: "d" }),
    ];

    it("excluye el propio trayecto, los que lo preceden (ciclo) y los que ya continúan a otro", () => {
      expect(ids(transferCandidates(items, "c"))).toEqual(["e"]);
    });

    it("mantiene como candidato su continuación actual", () => {
      expect(ids(transferCandidates(items, "b"))).toEqual(["c", "e"]);
    });

    it("para un trayecto nuevo (sin id) solo excluye los ya enlazados", () => {
      expect(ids(transferCandidates(items, undefined))).toEqual(["a", "e"]);
    });

    it("no se cuelga con datos en ciclo", () => {
      const cyclic = [leg("x", "2026-11-30", { nextId: "y" }), leg("y", "2026-11-30", { nextId: "x" }), leg("z", "2026-12-01")];
      expect(ids(transferCandidates(cyclic, "x"))).toEqual(["z"]);
    });
  });

  describe("isValidEmail", () => {
    it("acepta correos normales", () => {
      expect(isValidEmail("ana@ejemplo.com")).toBe(true);
      expect(isValidEmail("a.b+c@sub.ejemplo.es")).toBe(true);
    });

    it("rechaza lo que no es un correo", () => {
      expect(isValidEmail("")).toBe(false);
      expect(isValidEmail("ana")).toBe(false);
      expect(isValidEmail("ana@ejemplo")).toBe(false);
      expect(isValidEmail("ana @ejemplo.com")).toBe(false);
      expect(isValidEmail("@ejemplo.com")).toBe(false);
    });
  });

  describe("isValidPhone", () => {
    it("acepta dígitos con espacios, +, guiones, paréntesis y puntos", () => {
      expect(isValidPhone("+34 600 123 456")).toBe(true);
      expect(isValidPhone("(91) 555-12.34")).toBe(true);
      expect(isValidPhone("12345")).toBe(true);
    });

    it("rechaza letras o menos de 5 dígitos", () => {
      expect(isValidPhone("1234")).toBe(false);
      expect(isValidPhone("+34 600 ABC")).toBe(false);
      expect(isValidPhone("")).toBe(false);
      expect(isValidPhone("+-() .")).toBe(false);
    });
  });

  describe("attachmentChars", () => {
    it("suma la longitud de las data URL de todos los adjuntos de todos los viajes", () => {
      const att = (dataUrl: string) => ({ id: dataUrl, name: "f", mime: "image/png", size: 1, dataUrl });
      const trips = [
        trip("a", "2026-11-01", "2026-11-05", {
          transport: [leg("t1", "2026-11-01", { attachments: [att("1234"), att("12")] }), leg("t2", "2026-11-02")],
        }),
        trip("b", "2026-12-01", "2026-12-05", { transport: [leg("t3", "2026-12-01", { attachments: [att("123456")] })] }),
        trip("c", "2027-01-01", "2027-01-05"),
      ];
      expect(attachmentChars(trips)).toBe(12);
      expect(attachmentChars([])).toBe(0);
    });
  });
});
