import {
  dateParamSchema,
  createEventSchema,
  updateEventSchema,
} from "../../../src/validators/agendaValidators";

describe("agendaValidators", () => {
  describe("dateParamSchema", () => {
    it("acepta una fecha YYYY-MM-DD", () => {
      const { error } = dateParamSchema.validate({ date: "2026-08-24" });
      expect(error).toBeUndefined();
    });

    it("rechaza una fecha con formato incorrecto", () => {
      const { error } = dateParamSchema.validate({ date: "24/08/2026" });
      expect(error).toBeDefined();
    });
  });

  describe("createEventSchema", () => {
    const base = {
      title: "Gimnasio",
      categoryId: 1,
      startTime: "2026-08-24T18:00:00.000Z",
      endTime: "2026-08-24T19:00:00.000Z",
    };

    it("acepta un evento válido", () => {
      const { error } = createEventSchema.validate(base);
      expect(error).toBeUndefined();
    });

    it("rechaza un categoryId que no sea un entero positivo", () => {
      const { error } = createEventSchema.validate({ ...base, categoryId: "inventado" });
      expect(error).toBeDefined();
    });

    it("rechaza endTime anterior o igual a startTime", () => {
      const { error } = createEventSchema.validate({
        ...base,
        endTime: "2026-08-24T18:00:00.000Z",
      });
      expect(error).toBeDefined();
    });

    it("requiere recurringPattern cuando isRecurring es true", () => {
      const { error } = createEventSchema.validate({ ...base, isRecurring: true });
      expect(error).toBeDefined();
    });

    it("acepta isRecurring true con un recurringPattern válido", () => {
      const { error } = createEventSchema.validate({
        ...base,
        isRecurring: true,
        recurringPattern: "weekly",
      });
      expect(error).toBeUndefined();
    });

    it("acepta recurringPattern daily", () => {
      const { error } = createEventSchema.validate({
        ...base,
        isRecurring: true,
        recurringPattern: "daily",
      });
      expect(error).toBeUndefined();
    });

    it("rechaza un recurringPattern no soportado", () => {
      const { error } = createEventSchema.validate({
        ...base,
        isRecurring: true,
        recurringPattern: "yearly",
      });
      expect(error).toBeDefined();
    });

    it("requiere recurringWeekdayStart/End cuando recurringPattern es weekday_range", () => {
      const { error } = createEventSchema.validate({
        ...base,
        isRecurring: true,
        recurringPattern: "weekday_range",
        recurringWeekdayStart: 1,
      });
      expect(error).toBeDefined();
    });

    it("acepta weekday_range con recurringWeekdayStart/End válidos (lunes a viernes)", () => {
      const { value, error } = createEventSchema.validate({
        ...base,
        isRecurring: true,
        recurringPattern: "weekday_range",
        recurringWeekdayStart: 1,
        recurringWeekdayEnd: 5,
      });
      expect(error).toBeUndefined();
      expect(value.recurringWeekdayStart).toBe(1);
      expect(value.recurringWeekdayEnd).toBe(5);
    });

    it("rechaza recurringWeekdayStart fuera de 1-7", () => {
      const { error } = createEventSchema.validate({
        ...base,
        isRecurring: true,
        recurringPattern: "weekday_range",
        recurringWeekdayStart: 0,
        recurringWeekdayEnd: 5,
      });
      expect(error).toBeDefined();
    });
  });

  describe("updateEventSchema", () => {
    it("rechaza un objeto vacío (min 1 campo)", () => {
      const { error } = updateEventSchema.validate({});
      expect(error).toBeDefined();
    });

    it("rechaza endTime anterior a startTime cuando ambos se editan", () => {
      const { error } = updateEventSchema.validate({
        startTime: "2026-08-24T18:00:00.000Z",
        endTime: "2026-08-24T17:00:00.000Z",
      });
      expect(error).toBeDefined();
    });

    it("acepta editar solo el título", () => {
      const { error } = updateEventSchema.validate({ title: "Nuevo título" });
      expect(error).toBeUndefined();
    });
  });
});
