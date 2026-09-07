import {
  createGoalSchema,
  updateGoalSchema,
  registerProgressSchema,
  listGoalsQuerySchema,
} from "../../../src/validators/goalsValidators";

describe("goalsValidators", () => {
  describe("createGoalSchema", () => {
    it("acepta una meta válida sin periodStart/periodEnd (se calculan después)", () => {
      const { error } = createGoalSchema.validate({
        title: "Ejercicio",
        period: "weekly",
        targetValue: 5,
      });
      expect(error).toBeUndefined();
    });

    it("aplica bonusPoints=10 por defecto", () => {
      const { value } = createGoalSchema.validate({
        title: "Ejercicio",
        period: "weekly",
        targetValue: 5,
      });
      expect(value.bonusPoints).toBe(10);
    });

    it("acepta period=annual", () => {
      const { error } = createGoalSchema.validate({
        title: "Leer 12 libros",
        period: "annual",
        targetValue: 12,
      });
      expect(error).toBeUndefined();
    });

    it("rechaza un period no soportado", () => {
      const { error } = createGoalSchema.validate({
        title: "Ejercicio",
        period: "daily",
        targetValue: 5,
      });
      expect(error).toBeDefined();
    });

    it("rechaza targetValue no positivo", () => {
      const { error } = createGoalSchema.validate({
        title: "Ejercicio",
        period: "weekly",
        targetValue: 0,
      });
      expect(error).toBeDefined();
    });

    it("rechaza periodEnd anterior o igual a periodStart", () => {
      const { error } = createGoalSchema.validate({
        title: "Ejercicio",
        period: "weekly",
        targetValue: 5,
        periodStart: "2026-08-24",
        periodEnd: "2026-08-20",
      });
      expect(error).toBeDefined();
    });

    it("aplica autoRenew=true por defecto", () => {
      const { value } = createGoalSchema.validate({ title: "Ejercicio", period: "weekly", targetValue: 5 });
      expect(value.autoRenew).toBe(true);
    });

    it("acepta autoRenew=false explícito", () => {
      const { value, error } = createGoalSchema.validate({
        title: "Meta puntual",
        period: "monthly",
        targetValue: 5,
        autoRenew: false,
      });
      expect(error).toBeUndefined();
      expect(value.autoRenew).toBe(false);
    });
  });

  describe("updateGoalSchema", () => {
    it("rechaza un objeto vacío", () => {
      const { error } = updateGoalSchema.validate({});
      expect(error).toBeDefined();
    });

    it("no permite cambiar el period (no está en el schema)", () => {
      const { value } = updateGoalSchema.validate(
        { title: "Nuevo título", period: "monthly" },
        { stripUnknown: true }
      );
      expect(value.period).toBeUndefined();
    });
  });

  describe("registerProgressSchema", () => {
    it("acepta un valor entero (positivo o negativo, para correcciones)", () => {
      expect(registerProgressSchema.validate({ value: 1 }).error).toBeUndefined();
      expect(registerProgressSchema.validate({ value: -1 }).error).toBeUndefined();
    });

    it("rechaza un valor no entero", () => {
      const { error } = registerProgressSchema.validate({ value: 1.5 });
      expect(error).toBeDefined();
    });

    it("requiere el campo value", () => {
      const { error } = registerProgressSchema.validate({ note: "sin value" });
      expect(error).toBeDefined();
    });
  });

  describe("listGoalsQuerySchema", () => {
    it("acepta status=expired", () => {
      const { error } = listGoalsQuerySchema.validate({ status: "expired" });
      expect(error).toBeUndefined();
    });

    it("rechaza un status no soportado", () => {
      const { error } = listGoalsQuerySchema.validate({ status: "archivadas" });
      expect(error).toBeDefined();
    });
  });
});
