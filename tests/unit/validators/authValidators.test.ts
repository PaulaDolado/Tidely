import {
  registerSchema,
  loginSchema,
  refreshSchema,
  updateProfileSchema,
  changePasswordSchema,
  verifyEmailSchema,
  completeOnboardingSchema,
} from "../../../src/validators/authValidators";

describe("authValidators", () => {
  describe("registerSchema", () => {
    it("acepta un registro válido", () => {
      const { error } = registerSchema.validate({
        username: "test_user",
        email: "test@example.com",
        password: "Password123",
        name: "Test User",
      });
      expect(error).toBeUndefined();
    });

    it("rechaza si falta el username", () => {
      const { error } = registerSchema.validate({
        email: "test@example.com",
        password: "Password123",
        name: "Test User",
      });
      expect(error).toBeDefined();
    });

    it("rechaza un username con formato inválido (mayúsculas, espacios, demasiado corto)", () => {
      expect(
        registerSchema.validate({ username: "AB", email: "test@example.com", password: "Password123", name: "Test User" })
          .error
      ).toBeDefined();
      expect(
        registerSchema.validate({
          username: "con espacios",
          email: "test@example.com",
          password: "Password123",
          name: "Test User",
        }).error
      ).toBeDefined();
    });

    it("rechaza un email inválido", () => {
      const { error } = registerSchema.validate({
        username: "test_user",
        email: "no-es-un-email",
        password: "Password123",
        name: "Test User",
      });
      expect(error).toBeDefined();
    });

    it("rechaza un password menor a 8 caracteres", () => {
      const { error } = registerSchema.validate({
        username: "test_user",
        email: "test@example.com",
        password: "short",
        name: "Test User",
      });
      expect(error).toBeDefined();
    });

    it("rechaza si falta el nombre", () => {
      const { error } = registerSchema.validate({
        username: "test_user",
        email: "test@example.com",
        password: "Password123",
      });
      expect(error).toBeDefined();
    });

    it("acepta un timezone IANA válido", () => {
      const { error } = registerSchema.validate({
        username: "test_user",
        email: "test@example.com",
        password: "Password123",
        name: "Test User",
        timezone: "America/New_York",
      });
      expect(error).toBeUndefined();
    });

    it("rechaza un timezone que no es una zona IANA real", () => {
      const { error } = registerSchema.validate({
        username: "test_user",
        email: "test@example.com",
        password: "Password123",
        name: "Test User",
        timezone: "no-es-una-timezone",
      });
      expect(error).toBeDefined();
    });
  });

  describe("loginSchema", () => {
    it("acepta un identifier (email o username) + password", () => {
      expect(loginSchema.validate({ identifier: "test@example.com", password: "cualquiera" }).error).toBeUndefined();
      expect(loginSchema.validate({ identifier: "test_user", password: "cualquiera" }).error).toBeUndefined();
    });

    it("rechaza si falta el password", () => {
      const { error } = loginSchema.validate({ identifier: "test@example.com" });
      expect(error).toBeDefined();
    });

    it("rechaza si falta identifier", () => {
      const { error } = loginSchema.validate({ password: "cualquiera" });
      expect(error).toBeDefined();
    });
  });

  describe("refreshSchema", () => {
    it("rechaza si falta refreshToken", () => {
      const { error } = refreshSchema.validate({});
      expect(error).toBeDefined();
    });

    it("acepta un refreshToken presente", () => {
      const { error } = refreshSchema.validate({ refreshToken: "algun-token" });
      expect(error).toBeUndefined();
    });
  });

  describe("updateProfileSchema", () => {
    it("rechaza un objeto vacío", () => {
      expect(updateProfileSchema.validate({}).error).toBeDefined();
    });

    it("acepta actualizar solo el timezone", () => {
      expect(updateProfileSchema.validate({ timezone: "Asia/Tokyo" }).error).toBeUndefined();
    });

    it("rechaza un timezone inválido", () => {
      expect(updateProfileSchema.validate({ timezone: "inventada" }).error).toBeDefined();
    });

    it("acepta un lastName válido", () => {
      const { error } = updateProfileSchema.validate({ lastName: "Dolado" });
      expect(error).toBeUndefined();
    });

    it("acepta lastName en null (para borrarlo)", () => {
      const { error } = updateProfileSchema.validate({ lastName: null });
      expect(error).toBeUndefined();
    });

    it("acepta un username con formato válido", () => {
      expect(updateProfileSchema.validate({ username: "paula.dolado" }).error).toBeUndefined();
    });

    it("rechaza un username con mayúsculas o espacios", () => {
      expect(updateProfileSchema.validate({ username: "Paula Dolado" }).error).toBeDefined();
    });

    it("acepta un email válido", () => {
      const { error } = updateProfileSchema.validate({ email: "nuevo@example.com" });
      expect(error).toBeUndefined();
    });

    it("rechaza un email con formato inválido", () => {
      expect(updateProfileSchema.validate({ email: "no-es-un-email" }).error).toBeDefined();
    });
  });

  describe("changePasswordSchema", () => {
    it("acepta currentPassword + newPassword válidos", () => {
      const { error } = changePasswordSchema.validate({ currentPassword: "loQueSea", newPassword: "Password123" });
      expect(error).toBeUndefined();
    });

    it("rechaza si falta currentPassword", () => {
      expect(changePasswordSchema.validate({ newPassword: "Password123" }).error).toBeDefined();
    });

    it("rechaza si falta newPassword", () => {
      expect(changePasswordSchema.validate({ currentPassword: "loQueSea" }).error).toBeDefined();
    });

    it("rechaza newPassword menor a 8 caracteres", () => {
      const { error } = changePasswordSchema.validate({ currentPassword: "loQueSea", newPassword: "corta" });
      expect(error).toBeDefined();
    });
  });

  describe("verifyEmailSchema", () => {
    it("acepta un token presente", () => {
      expect(verifyEmailSchema.validate({ token: "abc123" }).error).toBeUndefined();
    });

    it("rechaza si falta el token", () => {
      expect(verifyEmailSchema.validate({}).error).toBeDefined();
    });
  });

  describe("completeOnboardingSchema", () => {
    it("acepta la lista completa de apartados", () => {
      const { error } = completeOnboardingSchema.validate({
        enabledSections: ["planificador", "horario", "objetivos", "galeria", "finanzas", "metasAhorro", "proyectos"],
      });
      expect(error).toBeUndefined();
    });

    it("acepta una lista vacía (ningún apartado opcional)", () => {
      expect(completeOnboardingSchema.validate({ enabledSections: [] }).error).toBeUndefined();
    });

    it("rechaza un apartado que no existe", () => {
      const { error } = completeOnboardingSchema.validate({ enabledSections: ["inventado"] });
      expect(error).toBeDefined();
    });

    it("rechaza apartados repetidos", () => {
      const { error } = completeOnboardingSchema.validate({ enabledSections: ["finanzas", "finanzas"] });
      expect(error).toBeDefined();
    });

    it("rechaza si falta enabledSections", () => {
      expect(completeOnboardingSchema.validate({}).error).toBeDefined();
    });
  });
});
