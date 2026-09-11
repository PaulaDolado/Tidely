jest.mock("../../../src/config/database", () => ({
  prisma: {
    user: { create: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    // register() crea las categorías de evento por defecto de la cuenta nueva (ver
    // eventCategoryService.seedDefaultCategories) — createMany no se usa en ninguna aserción de
    // este archivo, solo hace falta que exista para no romper esa llamada.
    eventCategory: { createMany: jest.fn() },
  },
}));

jest.mock("../../../src/utils/mailer", () => ({
  sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
}));

import { prisma } from "../../../src/config/database";
import * as authService from "../../../src/services/authService";
import { hashPassword } from "../../../src/utils/password";
import { hashToken } from "../../../src/utils/verificationToken";
import { sendVerificationEmail } from "../../../src/utils/mailer";
import { ConflictError, TooManyRequestsError, UnauthorizedError, ValidationError } from "../../../src/utils/errorHandler";

const prismaMock = prisma as unknown as {
  user: { create: jest.Mock; findUnique: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
};
const sendVerificationEmailMock = sendVerificationEmail as jest.Mock;

describe("authService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("register", () => {
    it("guarda el timezone indicado si se pasa uno, y manda el email de verificación", async () => {
      prismaMock.user.findUnique.mockResolvedValue(null); // email y username libres
      prismaMock.user.create.mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data }));
      prismaMock.user.update.mockResolvedValue({});

      await authService.register({
        username: "test_user",
        email: "test@example.com",
        password: "Password123",
        name: "Test",
        timezone: "America/New_York",
      });

      expect(prismaMock.user.create.mock.calls[0][0].data.timezone).toBe("America/New_York");
      expect(prismaMock.user.create.mock.calls[0][0].data.username).toBe("test_user");
      expect(sendVerificationEmailMock).toHaveBeenCalledWith("test@example.com", expect.any(String));
    });

    it("no pasa timezone a Prisma si no se indica (Prisma aplica su @default)", async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.user.create.mockImplementation(({ data }) => Promise.resolve({ id: 1, timezone: "Europe/Madrid", ...data }));
      prismaMock.user.update.mockResolvedValue({});

      await authService.register({ username: "test_user", email: "test@example.com", password: "Password123", name: "Test" });

      expect(prismaMock.user.create.mock.calls[0][0].data.timezone).toBeUndefined();
    });

    it("lanza ConflictError si el email ya existe", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({ id: 1 }); // email ocupado

      await expect(
        authService.register({ username: "test_user", email: "test@example.com", password: "Password123", name: "Test" })
      ).rejects.toThrow(ConflictError);
      expect(prismaMock.user.create).not.toHaveBeenCalled();
    });

    it("lanza ConflictError si el username ya existe (aunque el email esté libre)", async () => {
      prismaMock.user.findUnique
        .mockResolvedValueOnce(null) // email libre
        .mockResolvedValueOnce({ id: 1 }); // username ocupado

      await expect(
        authService.register({ username: "ocupado", email: "test@example.com", password: "Password123", name: "Test" })
      ).rejects.toThrow(ConflictError);
      expect(prismaMock.user.create).not.toHaveBeenCalled();
    });
  });

  describe("login", () => {
    it("permite iniciar sesión con el email", async () => {
      const storedHash = await hashPassword("Password123");
      prismaMock.user.findFirst.mockResolvedValue({ id: 1, email: "test@example.com", password: storedHash });

      const result = await authService.login({ identifier: "test@example.com", password: "Password123" });

      expect(result.user.id).toBe(1);
      expect(prismaMock.user.findFirst.mock.calls[0][0].where.OR).toEqual([
        { email: "test@example.com" },
        { username: "test@example.com" },
      ]);
    });

    it("permite iniciar sesión con el username", async () => {
      const storedHash = await hashPassword("Password123");
      prismaMock.user.findFirst.mockResolvedValue({ id: 1, username: "paula", email: "test@example.com", password: storedHash });

      const result = await authService.login({ identifier: "paula", password: "Password123" });

      expect(result.user.id).toBe(1);
    });

    it("lanza UnauthorizedError si no existe ni como email ni como username", async () => {
      prismaMock.user.findFirst.mockResolvedValue(null);
      await expect(authService.login({ identifier: "quien-sea", password: "x" })).rejects.toThrow(UnauthorizedError);
    });

    it("lanza UnauthorizedError si la contraseña no coincide", async () => {
      const storedHash = await hashPassword("Password123");
      prismaMock.user.findFirst.mockResolvedValue({ id: 1, email: "test@example.com", password: storedHash });
      await expect(authService.login({ identifier: "test@example.com", password: "Otra" })).rejects.toThrow(UnauthorizedError);
    });
  });

  describe("getProfile / updateProfile", () => {
    it("getProfile lanza UnauthorizedError si el usuario ya no existe", async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      await expect(authService.getProfile(999)).rejects.toThrow(UnauthorizedError);
    });

    it("getProfile retorna el perfil sin el hash de password ni el hash del token de verificación", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 1,
        email: "test@example.com",
        username: "test_user",
        name: "Test",
        timezone: "UTC",
        password: "hash-secreto",
        emailVerifiedAt: null,
        emailVerificationTokenHash: "hash-token-secreto",
      });

      const profile = await authService.getProfile(1);

      expect(profile).toEqual({
        id: 1,
        email: "test@example.com",
        username: "test_user",
        name: "Test",
        lastName: undefined,
        timezone: "UTC",
        emailVerified: false,
        nextUsernameChangeAllowedAt: null,
      });
      expect(profile).not.toHaveProperty("password");
      expect(profile).not.toHaveProperty("emailVerificationTokenHash");
    });

    it("emailVerified es true si emailVerifiedAt está puesto", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 1,
        email: "test@example.com",
        username: "test_user",
        name: "Test",
        timezone: "UTC",
        emailVerifiedAt: new Date(),
      });
      const profile = await authService.getProfile(1);
      expect(profile.emailVerified).toBe(true);
    });

    // updateProfile SIEMPRE busca primero al usuario actual (para saber si `username`/`email`
    // cambian de verdad) — de ahí el primer `findUnique.mockResolvedValueOnce(current)` en cada
    // test de aquí en adelante, antes de encadenar la respuesta de la comprobación de unicidad.
    it("updateProfile solo actualiza los campos indicados", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({ id: 1, username: "test_user", email: "test@example.com", usernameChangedAt: null });
      prismaMock.user.update.mockImplementation(({ data }) =>
        Promise.resolve({ id: 1, username: "test_user", email: "test@example.com", name: "Nuevo", timezone: "Asia/Tokyo", ...data })
      );

      await authService.updateProfile(1, { timezone: "Asia/Tokyo" });

      expect(prismaMock.user.update.mock.calls[0][0].data).toEqual({ timezone: "Asia/Tokyo" });
      expect(sendVerificationEmailMock).not.toHaveBeenCalled();
    });

    it("updateProfile acepta lastName libre", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({ id: 1, username: "test_user", email: "test@example.com", usernameChangedAt: null });
      prismaMock.user.update.mockImplementation(({ data }) => Promise.resolve({ id: 1, username: "test_user", email: "test@example.com", ...data }));

      const profile = await authService.updateProfile(1, { lastName: "Dolado" });

      expect(prismaMock.user.update.mock.calls[0][0].data).toEqual({ lastName: "Dolado" });
      expect(profile.lastName).toBe("Dolado");
    });

    it("updateProfile acepta un cambio de username libre y aplica el cooldown", async () => {
      prismaMock.user.findUnique
        .mockResolvedValueOnce({ id: 1, username: "viejo", email: "test@example.com", usernameChangedAt: null }) // actual
        .mockResolvedValueOnce(null); // username libre
      prismaMock.user.update.mockImplementation(({ data }) => Promise.resolve({ id: 1, email: "test@example.com", ...data }));

      const profile = await authService.updateProfile(1, { username: "nuevo" });

      expect(prismaMock.user.update.mock.calls[0][0].data).toMatchObject({ username: "nuevo" });
      expect(prismaMock.user.update.mock.calls[0][0].data.usernameChangedAt).toBeInstanceOf(Date);
      expect(profile.username).toBe("nuevo");
    });

    it("updateProfile lanza ConflictError si el username ya lo tiene OTRO usuario", async () => {
      prismaMock.user.findUnique
        .mockResolvedValueOnce({ id: 1, username: "viejo", email: "test@example.com", usernameChangedAt: null })
        .mockResolvedValueOnce({ id: 999, username: "ocupado" });

      await expect(authService.updateProfile(1, { username: "ocupado" })).rejects.toThrow(ConflictError);
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it("updateProfile permite guardar el mismo username que ya tenía (no es un cambio de verdad, no consume el cooldown)", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({ id: 1, username: "mio", email: "test@example.com", usernameChangedAt: null });
      prismaMock.user.update.mockImplementation(({ data }) => Promise.resolve({ id: 1, email: "test@example.com", ...data }));

      await expect(authService.updateProfile(1, { username: "mio" })).resolves.toBeDefined();
      expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
      // No hace falta comprobar unicidad de un valor que no cambia: un solo findUnique.
      expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);
    });

    it("updateProfile lanza TooManyRequestsError si el username ya se cambió hace menos de 15 días", async () => {
      const hace5Dias = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      prismaMock.user.findUnique.mockResolvedValueOnce({ id: 1, username: "viejo", email: "test@example.com", usernameChangedAt: hace5Dias });

      await expect(authService.updateProfile(1, { username: "nuevo" })).rejects.toThrow(TooManyRequestsError);
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it("updateProfile permite cambiar el username si ya pasaron los 15 días", async () => {
      const hace16Dias = new Date(Date.now() - 16 * 24 * 60 * 60 * 1000);
      prismaMock.user.findUnique
        .mockResolvedValueOnce({ id: 1, username: "viejo", email: "test@example.com", usernameChangedAt: hace16Dias })
        .mockResolvedValueOnce(null);
      prismaMock.user.update.mockImplementation(({ data }) => Promise.resolve({ id: 1, email: "test@example.com", ...data }));

      await expect(authService.updateProfile(1, { username: "nuevo" })).resolves.toBeDefined();
    });

    it("updateProfile, al cambiar el email, resetea emailVerifiedAt a null y manda una nueva verificación", async () => {
      prismaMock.user.findUnique
        .mockResolvedValueOnce({ id: 1, username: "test_user", email: "viejo@example.com", usernameChangedAt: null }) // actual
        .mockResolvedValueOnce(null); // email libre
      prismaMock.user.update.mockImplementation(({ data }) =>
        Promise.resolve({ id: 1, username: "test_user", email: "viejo@example.com", ...data })
      );

      await authService.updateProfile(1, { email: "nuevo@example.com" });

      // Dos updates: uno con los campos del perfil (incluye emailVerifiedAt: null) y otro,
      // dentro de issueAndSendVerification, guardando el hash del nuevo token.
      const profileUpdateCall = prismaMock.user.update.mock.calls.find((c) => c[0].data.email !== undefined);
      expect(profileUpdateCall[0].data).toMatchObject({ email: "nuevo@example.com", emailVerifiedAt: null });
      expect(sendVerificationEmailMock).toHaveBeenCalledWith("nuevo@example.com", expect.any(String));
    });

    it("updateProfile NO cambia el cooldown de username al cambiar solo el email", async () => {
      prismaMock.user.findUnique
        .mockResolvedValueOnce({ id: 1, username: "test_user", email: "viejo@example.com", usernameChangedAt: null })
        .mockResolvedValueOnce(null);
      prismaMock.user.update.mockImplementation(({ data }) =>
        Promise.resolve({ id: 1, username: "test_user", email: "viejo@example.com", ...data })
      );

      await authService.updateProfile(1, { email: "nuevo@example.com" });

      const profileUpdateCall = prismaMock.user.update.mock.calls.find((c) => c[0].data.email !== undefined);
      expect(profileUpdateCall[0].data).not.toHaveProperty("usernameChangedAt");
    });

    it("nextUsernameChangeAllowedAt viene en null si nunca se cambió el username", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 1,
        email: "test@example.com",
        username: "test_user",
        name: "Test",
        lastName: null,
        usernameChangedAt: null,
        timezone: "UTC",
      });
      const profile = await authService.getProfile(1);
      expect(profile.nextUsernameChangeAllowedAt).toBeNull();
    });

    it("nextUsernameChangeAllowedAt refleja la fecha en la que se podrá volver a cambiar", async () => {
      const hace5Dias = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 1,
        email: "test@example.com",
        username: "test_user",
        name: "Test",
        lastName: null,
        usernameChangedAt: hace5Dias,
        timezone: "UTC",
      });
      const profile = await authService.getProfile(1);
      expect(profile.nextUsernameChangeAllowedAt).not.toBeNull();
      expect(new Date(profile.nextUsernameChangeAllowedAt as string).getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe("verifyEmail", () => {
    it("verifica el email con un token válido y lo consume (lo deja en null)", async () => {
      const token = "un-token-cualquiera";
      prismaMock.user.findFirst.mockResolvedValue({
        id: 1,
        email: "test@example.com",
        username: "test_user",
        emailVerificationTokenHash: hashToken(token),
        emailVerificationExpiresAt: new Date(Date.now() + 60_000),
      });
      prismaMock.user.update.mockImplementation(({ data }) =>
        Promise.resolve({ id: 1, email: "test@example.com", username: "test_user", ...data })
      );

      const profile = await authService.verifyEmail(token);

      expect(profile.emailVerified).toBe(true);
      expect(prismaMock.user.update.mock.calls[0][0].data).toMatchObject({
        emailVerificationTokenHash: null,
        emailVerificationExpiresAt: null,
      });
    });

    it("lanza ValidationError si el token no coincide con ningún usuario", async () => {
      prismaMock.user.findFirst.mockResolvedValue(null);
      await expect(authService.verifyEmail("token-inventado")).rejects.toThrow(ValidationError);
    });

    it("lanza ValidationError si el token ya caducó", async () => {
      const token = "token-caducado";
      prismaMock.user.findFirst.mockResolvedValue({
        id: 1,
        emailVerificationTokenHash: hashToken(token),
        emailVerificationExpiresAt: new Date(Date.now() - 60_000), // ya pasó
      });
      await expect(authService.verifyEmail(token)).rejects.toThrow(ValidationError);
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });
  });

  describe("resendVerification", () => {
    it("no hace nada si el email ya está verificado", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 1, email: "test@example.com", emailVerifiedAt: new Date() });
      await authService.resendVerification(1);
      expect(sendVerificationEmailMock).not.toHaveBeenCalled();
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it("genera y manda un token nuevo si aún no está verificado", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 1, email: "test@example.com", emailVerifiedAt: null });
      prismaMock.user.update.mockResolvedValue({});

      await authService.resendVerification(1);

      expect(sendVerificationEmailMock).toHaveBeenCalledWith("test@example.com", expect.any(String));
    });

    it("lanza UnauthorizedError si el usuario ya no existe", async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      await expect(authService.resendVerification(999)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe("changePassword", () => {
    it("lanza UnauthorizedError si el usuario ya no existe", async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      await expect(authService.changePassword(999, "actual", "nuevaPassword123")).rejects.toThrow(UnauthorizedError);
    });

    it("lanza UnauthorizedError si la contraseña actual no coincide, sin tocar la BD", async () => {
      const storedHash = await hashPassword("LaDeVerdad123");
      prismaMock.user.findUnique.mockResolvedValue({ id: 1, password: storedHash });

      await expect(authService.changePassword(1, "OtraCosa", "nuevaPassword123")).rejects.toThrow(UnauthorizedError);
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it("con la contraseña actual correcta, guarda un hash nuevo (no la nueva contraseña en claro)", async () => {
      const storedHash = await hashPassword("LaDeVerdad123");
      prismaMock.user.findUnique.mockResolvedValue({ id: 1, password: storedHash });
      prismaMock.user.update.mockResolvedValue({ id: 1 });

      await authService.changePassword(1, "LaDeVerdad123", "nuevaPassword123");

      expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
      const { where, data } = prismaMock.user.update.mock.calls[0][0];
      expect(where).toEqual({ id: 1 });
      expect(data.password).not.toBe("nuevaPassword123");
      expect(data.password).not.toBe(storedHash);
    });
  });
});
