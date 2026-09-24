// Mockeamos el mailer para no depender de un proveedor real y, sobre todo, para poder capturar
// el token de verificación que se "envía" (solo así los tests pueden llamar a POST
// /auth/verify-email con un token real sin tener que leer un log).
jest.mock("../../src/utils/mailer", () => ({
  sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
}));

import request from "supertest";
import { app } from "../../src/app";
import { prisma } from "../../src/config/database";
import { sendVerificationEmail } from "../../src/utils/mailer";

const sendVerificationEmailMock = sendVerificationEmail as jest.Mock;

// Extrae el token del último email "enviado" a `to` (el mock guarda `(to, token)` por llamada).
function lastTokenSentTo(to: string): string {
  const call = [...sendVerificationEmailMock.mock.calls].reverse().find(([sentTo]) => sentTo === to);
  if (!call) throw new Error(`No se mandó ningún email de verificación a ${to}`);
  return call[1];
}

describe("Auth Endpoints", () => {
  beforeEach(async () => {
    await prisma.user.deleteMany({});
    sendVerificationEmailMock.mockClear();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("POST /auth/register", () => {
    it("debería crear un usuario y retornar token", async () => {
      const response = await request(app).post("/auth/register").send({
        username: "test_user",
        email: "test@example.com",
        password: "Password123",
        name: "Test User",
      });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty("token");
      expect(response.body).toHaveProperty("refreshToken");
      expect(response.body.user.email).toBe("test@example.com");
      expect(response.body.user.username).toBe("test_user");
      expect(response.body.user.emailVerified).toBe(false);
      expect(response.body.user).not.toHaveProperty("password");
    });

    it("debería mandar un email de verificación al registrarse", async () => {
      await request(app).post("/auth/register").send({
        username: "test_user",
        email: "test@example.com",
        password: "Password123",
        name: "Test User",
      });

      expect(sendVerificationEmailMock).toHaveBeenCalledWith("test@example.com", expect.any(String));
    });

    it("debería retornar error si el email ya existe", async () => {
      await request(app).post("/auth/register").send({
        username: "primero",
        email: "test@example.com",
        password: "Password123",
        name: "Test User",
      });

      const response = await request(app).post("/auth/register").send({
        username: "segundo",
        email: "test@example.com",
        password: "Password456",
        name: "Another User",
      });

      expect(response.status).toBe(409);
      expect(response.body.error).toMatch(/Email ya existe/);
    });

    it("debería retornar error si el nombre de usuario ya existe (aunque el email sea distinto)", async () => {
      await request(app).post("/auth/register").send({
        username: "mismo_user",
        email: "primero@example.com",
        password: "Password123",
        name: "Test User",
      });

      const response = await request(app).post("/auth/register").send({
        username: "mismo_user",
        email: "segundo@example.com",
        password: "Password456",
        name: "Another User",
      });

      expect(response.status).toBe(409);
    });

    it("debería retornar error de validación con email inválido", async () => {
      const response = await request(app).post("/auth/register").send({
        username: "test_user",
        email: "no-es-un-email",
        password: "Password123",
        name: "Test User",
      });

      expect(response.status).toBe(400);
    });

    it("debería retornar error de validación con un username de formato inválido", async () => {
      const response = await request(app).post("/auth/register").send({
        username: "Con Espacios",
        email: "test@example.com",
        password: "Password123",
        name: "Test User",
      });

      expect(response.status).toBe(400);
    });

    it("debería retornar error de validación si falta el username", async () => {
      const response = await request(app).post("/auth/register").send({
        email: "test@example.com",
        password: "Password123",
        name: "Test User",
      });

      expect(response.status).toBe(400);
    });
  });

  describe("POST /auth/login", () => {
    it("debería hacer login con el email y retornar token", async () => {
      await request(app).post("/auth/register").send({
        username: "test_user",
        email: "test@example.com",
        password: "Password123",
        name: "Test User",
      });

      const response = await request(app).post("/auth/login").send({
        identifier: "test@example.com",
        password: "Password123",
      });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("token");
    });

    it("debería hacer login con el nombre de usuario y retornar token", async () => {
      await request(app).post("/auth/register").send({
        username: "test_user",
        email: "test@example.com",
        password: "Password123",
        name: "Test User",
      });

      const response = await request(app).post("/auth/login").send({
        identifier: "test_user",
        password: "Password123",
      });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("token");
    });

    it("debería permitir el login aunque el email no esté verificado", async () => {
      await request(app).post("/auth/register").send({
        username: "test_user",
        email: "test@example.com",
        password: "Password123",
        name: "Test User",
      });

      const response = await request(app).post("/auth/login").send({
        identifier: "test_user",
        password: "Password123",
      });

      expect(response.status).toBe(200);
      expect(response.body.user.emailVerified).toBe(false);
    });

    it("debería retornar error con credenciales inválidas", async () => {
      const response = await request(app).post("/auth/login").send({
        identifier: "nonexistent@example.com",
        password: "Password123",
      });

      expect(response.status).toBe(401);
    });
  });

  describe("POST /auth/refresh", () => {
    it("debería retornar un nuevo token a partir de un refresh token válido", async () => {
      const registerResponse = await request(app).post("/auth/register").send({
        username: "test_user",
        email: "test@example.com",
        password: "Password123",
        name: "Test User",
      });

      const response = await request(app)
        .post("/auth/refresh")
        .send({ refreshToken: registerResponse.body.refreshToken });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("token");
    });

    it("debería retornar error con un refresh token inválido", async () => {
      const response = await request(app).post("/auth/refresh").send({ refreshToken: "token-invalido" });

      expect(response.status).toBe(401);
    });

    it("rota el refresh token — el usado para refrescar deja de servir", async () => {
      const registerResponse = await request(app).post("/auth/register").send({
        username: "test_user",
        email: "test@example.com",
        password: "Password123",
        name: "Test User",
      });
      const originalRefreshToken = registerResponse.body.refreshToken;

      const first = await request(app).post("/auth/refresh").send({ refreshToken: originalRefreshToken });
      expect(first.status).toBe(200);

      // Reutilizar el MISMO refresh token una segunda vez no debería funcionar — ya se canjeó.
      const reused = await request(app).post("/auth/refresh").send({ refreshToken: originalRefreshToken });
      expect(reused.status).toBe(401);
    });

    it("reutilizar un refresh token ya rotado revoca también el token nuevo (detección de robo)", async () => {
      const registerResponse = await request(app).post("/auth/register").send({
        username: "test_user",
        email: "test@example.com",
        password: "Password123",
        name: "Test User",
      });
      const originalRefreshToken = registerResponse.body.refreshToken;

      const first = await request(app).post("/auth/refresh").send({ refreshToken: originalRefreshToken });
      const rotatedRefreshToken = first.body.refreshToken;

      // Reutilizar el token viejo (ya rotado) debe fallar Y además invalidar el nuevo —
      // reutilizar uno ya rotado es la señal de que se filtró, así que se cierra toda la sesión.
      await request(app).post("/auth/refresh").send({ refreshToken: originalRefreshToken });

      const afterReuse = await request(app).post("/auth/refresh").send({ refreshToken: rotatedRefreshToken });
      expect(afterReuse.status).toBe(401);
    });
  });

  describe("POST /auth/logout", () => {
    it("revoca el refresh token indicado — deja de poder usarse para refrescar", async () => {
      const registerResponse = await request(app).post("/auth/register").send({
        username: "test_user",
        email: "test@example.com",
        password: "Password123",
        name: "Test User",
      });
      const refreshToken = registerResponse.body.refreshToken;

      const logoutResponse = await request(app).post("/auth/logout").send({ refreshToken });
      expect(logoutResponse.status).toBe(200);

      const afterLogout = await request(app).post("/auth/refresh").send({ refreshToken });
      expect(afterLogout.status).toBe(401);
    });

    it("no falla aunque el refresh token ya no sea válido (best-effort)", async () => {
      const response = await request(app).post("/auth/logout").send({ refreshToken: "token-invalido" });
      expect(response.status).toBe(200);
    });
  });

  describe("GET/PUT /auth/me", () => {
    it("debería registrar con una timezone custom y devolverla en /auth/me", async () => {
      const register = await request(app).post("/auth/register").send({
        username: "test_user",
        email: "test@example.com",
        password: "Password123",
        name: "Test User",
        timezone: "America/New_York",
      });

      const profile = await request(app)
        .get("/auth/me")
        .set({ Authorization: `Bearer ${register.body.token}` });

      expect(profile.status).toBe(200);
      expect(profile.body.timezone).toBe("America/New_York");
      expect(profile.body).not.toHaveProperty("password");
    });

    it("debería usar Europe/Madrid por defecto si no se indica timezone al registrar", async () => {
      const register = await request(app).post("/auth/register").send({
        username: "test_user",
        email: "test@example.com",
        password: "Password123",
        name: "Test User",
      });

      expect(register.body.user.timezone).toBe("Europe/Madrid");
    });

    it("debería actualizar la timezone vía PUT /auth/me", async () => {
      const register = await request(app).post("/auth/register").send({
        username: "test_user",
        email: "test@example.com",
        password: "Password123",
        name: "Test User",
      });
      const auth = { Authorization: `Bearer ${register.body.token}` };

      const updated = await request(app).put("/auth/me").set(auth).send({ timezone: "Asia/Tokyo" });
      expect(updated.status).toBe(200);
      expect(updated.body.timezone).toBe("Asia/Tokyo");

      const profile = await request(app).get("/auth/me").set(auth);
      expect(profile.body.timezone).toBe("Asia/Tokyo");
    });

    it("debería rechazar un timezone que no es una zona IANA real", async () => {
      const register = await request(app).post("/auth/register").send({
        username: "test_user",
        email: "test@example.com",
        password: "Password123",
        name: "Test User",
      });

      const response = await request(app)
        .put("/auth/me")
        .set({ Authorization: `Bearer ${register.body.token}` })
        .send({ timezone: "no-existe" });

      expect(response.status).toBe(400);
    });

    it("debería actualizar el apellido vía PUT /auth/me", async () => {
      const register = await request(app).post("/auth/register").send({
        username: "test_user",
        email: "test@example.com",
        password: "Password123",
        name: "Test User",
      });
      const auth = { Authorization: `Bearer ${register.body.token}` };

      const updated = await request(app).put("/auth/me").set(auth).send({ lastName: "Dolado" });
      expect(updated.status).toBe(200);
      expect(updated.body.lastName).toBe("Dolado");

      const profile = await request(app).get("/auth/me").set(auth);
      expect(profile.body.lastName).toBe("Dolado");
    });

    it("debería cambiar el nombre de usuario vía PUT /auth/me y permitir login con el nuevo", async () => {
      const register = await request(app).post("/auth/register").send({
        username: "viejo_user",
        email: "test@example.com",
        password: "Password123",
        name: "Test User",
      });
      const auth = { Authorization: `Bearer ${register.body.token}` };

      const updated = await request(app).put("/auth/me").set(auth).send({ username: "nuevo_user" });
      expect(updated.status).toBe(200);
      expect(updated.body.username).toBe("nuevo_user");

      const loginConNuevo = await request(app).post("/auth/login").send({ identifier: "nuevo_user", password: "Password123" });
      expect(loginConNuevo.status).toBe(200);

      const loginConViejo = await request(app).post("/auth/login").send({ identifier: "viejo_user", password: "Password123" });
      expect(loginConViejo.status).toBe(401);
    });

    it("debería rechazar un segundo cambio de username antes de que pasen 15 días (429), y permitirlo tras esperar", async () => {
      const register = await request(app).post("/auth/register").send({
        username: "primero",
        email: "test@example.com",
        password: "Password123",
        name: "Test User",
      });
      const auth = { Authorization: `Bearer ${register.body.token}` };

      const primerCambio = await request(app).put("/auth/me").set(auth).send({ username: "segundo" });
      expect(primerCambio.status).toBe(200);
      // nextUsernameChangeAllowedAt viene poblado justo después de cambiarlo.
      expect(primerCambio.body.nextUsernameChangeAllowedAt).not.toBeNull();

      const segundoCambioMuyPronto = await request(app).put("/auth/me").set(auth).send({ username: "tercero" });
      expect(segundoCambioMuyPronto.status).toBe(429);

      // El username no cambió: el intento rechazado no dejó rastro.
      const perfilTrasRechazo = await request(app).get("/auth/me").set(auth);
      expect(perfilTrasRechazo.body.username).toBe("segundo");

      // Simula que ya pasaron los 15 días retrocediendo `usernameChangedAt` directamente en BD
      // (no hay forma de "esperar 15 días de verdad" en un test de integración).
      await prisma.user.update({
        where: { id: register.body.user.id },
        data: { usernameChangedAt: new Date(Date.now() - 16 * 24 * 60 * 60 * 1000) },
      });

      const segundoCambioTrasEsperar = await request(app).put("/auth/me").set(auth).send({ username: "tercero" });
      expect(segundoCambioTrasEsperar.status).toBe(200);
      expect(segundoCambioTrasEsperar.body.username).toBe("tercero");
    });

    it("debería rechazar un username ya usado por otra cuenta", async () => {
      await request(app).post("/auth/register").send({
        username: "primero",
        email: "primero@example.com",
        password: "Password123",
        name: "Primero",
      });
      const second = await request(app).post("/auth/register").send({
        username: "segundo",
        email: "segundo@example.com",
        password: "Password123",
        name: "Segundo",
      });

      const response = await request(app)
        .put("/auth/me")
        .set({ Authorization: `Bearer ${second.body.token}` })
        .send({ username: "primero" });

      expect(response.status).toBe(409);
    });

    it("debería rechazar un username con formato inválido", async () => {
      const register = await request(app).post("/auth/register").send({
        username: "test_user",
        email: "test@example.com",
        password: "Password123",
        name: "Test User",
      });

      const response = await request(app)
        .put("/auth/me")
        .set({ Authorization: `Bearer ${register.body.token}` })
        .send({ username: "Con Espacios" });

      expect(response.status).toBe(400);
    });

    it("debería cambiar el email vía PUT /auth/me sin cooldown, y resetear la verificación", async () => {
      const register = await request(app).post("/auth/register").send({
        username: "test_user",
        email: "viejo@example.com",
        password: "Password123",
        name: "Test User",
      });
      const auth = { Authorization: `Bearer ${register.body.token}` };
      sendVerificationEmailMock.mockClear();

      const updated = await request(app).put("/auth/me").set(auth).send({ email: "nuevo@example.com" });
      expect(updated.status).toBe(200);
      expect(updated.body.email).toBe("nuevo@example.com");
      expect(updated.body.emailVerified).toBe(false);
      expect(sendVerificationEmailMock).toHaveBeenCalledWith("nuevo@example.com", expect.any(String));

      // Se puede seguir entrando con el username, y con el nuevo email.
      const loginConEmail = await request(app).post("/auth/login").send({ identifier: "nuevo@example.com", password: "Password123" });
      expect(loginConEmail.status).toBe(200);
    });

    it("cambiar el email varias veces seguidas NO dispara el cooldown de 15 días (solo aplica al username)", async () => {
      const register = await request(app).post("/auth/register").send({
        username: "test_user",
        email: "uno@example.com",
        password: "Password123",
        name: "Test User",
      });
      const auth = { Authorization: `Bearer ${register.body.token}` };

      const primero = await request(app).put("/auth/me").set(auth).send({ email: "dos@example.com" });
      expect(primero.status).toBe(200);

      const segundo = await request(app).put("/auth/me").set(auth).send({ email: "tres@example.com" });
      expect(segundo.status).toBe(200);
      expect(segundo.body.email).toBe("tres@example.com");
    });

    it("debería rechazar un email ya usado por otra cuenta", async () => {
      await request(app).post("/auth/register").send({
        username: "primero",
        email: "primero@example.com",
        password: "Password123",
        name: "Primero",
      });
      const second = await request(app).post("/auth/register").send({
        username: "segundo",
        email: "segundo@example.com",
        password: "Password123",
        name: "Segundo",
      });

      const response = await request(app)
        .put("/auth/me")
        .set({ Authorization: `Bearer ${second.body.token}` })
        .send({ email: "primero@example.com" });

      expect(response.status).toBe(409);
    });

    it("debería rechazar un email con formato inválido", async () => {
      const register = await request(app).post("/auth/register").send({
        username: "test_user",
        email: "test@example.com",
        password: "Password123",
        name: "Test User",
      });

      const response = await request(app)
        .put("/auth/me")
        .set({ Authorization: `Bearer ${register.body.token}` })
        .send({ email: "no-es-un-email" });

      expect(response.status).toBe(400);
    });

    it("debería rechazar la petición sin token", async () => {
      const response = await request(app).get("/auth/me");
      expect(response.status).toBe(401);
    });
  });

  describe("PUT /auth/me/onboarding", () => {
    it("una cuenta recién registrada empieza con onboardingCompleted=false y los 7 apartados activados", async () => {
      const register = await request(app).post("/auth/register").send({
        username: "test_user",
        email: "test@example.com",
        password: "Password123",
        name: "Test User",
      });

      expect(register.body.user.onboardingCompleted).toBe(false);
      expect(register.body.user.enabledSections.sort()).toEqual(
        ["finanzas", "galeria", "horario", "metasAhorro", "objetivos", "planificador", "proyectos"].sort()
      );
    });

    it("guarda la selección elegida y marca onboardingCompleted=true", async () => {
      const register = await request(app).post("/auth/register").send({
        username: "test_user",
        email: "test@example.com",
        password: "Password123",
        name: "Test User",
      });
      const auth = { Authorization: `Bearer ${register.body.token}` };

      const response = await request(app)
        .put("/auth/me/onboarding")
        .set(auth)
        .send({ enabledSections: ["planificador", "finanzas"] });

      expect(response.status).toBe(200);
      expect(response.body.onboardingCompleted).toBe(true);
      expect(response.body.enabledSections).toEqual(["planificador", "finanzas"]);

      const profile = await request(app).get("/auth/me").set(auth);
      expect(profile.body.onboardingCompleted).toBe(true);
      expect(profile.body.enabledSections).toEqual(["planificador", "finanzas"]);
    });

    it("acepta una lista vacía (el usuario no quiere ningún apartado opcional)", async () => {
      const register = await request(app).post("/auth/register").send({
        username: "test_user",
        email: "test@example.com",
        password: "Password123",
        name: "Test User",
      });

      const response = await request(app)
        .put("/auth/me/onboarding")
        .set({ Authorization: `Bearer ${register.body.token}` })
        .send({ enabledSections: [] });

      expect(response.status).toBe(200);
      expect(response.body.enabledSections).toEqual([]);
    });

    it("debería rechazar un apartado que no existe", async () => {
      const register = await request(app).post("/auth/register").send({
        username: "test_user",
        email: "test@example.com",
        password: "Password123",
        name: "Test User",
      });

      const response = await request(app)
        .put("/auth/me/onboarding")
        .set({ Authorization: `Bearer ${register.body.token}` })
        .send({ enabledSections: ["inventado"] });

      expect(response.status).toBe(400);
    });

    it("debería rechazar la petición sin enabledSections", async () => {
      const register = await request(app).post("/auth/register").send({
        username: "test_user",
        email: "test@example.com",
        password: "Password123",
        name: "Test User",
      });

      const response = await request(app)
        .put("/auth/me/onboarding")
        .set({ Authorization: `Bearer ${register.body.token}` })
        .send({});

      expect(response.status).toBe(400);
    });

    it("debería rechazar la petición sin token", async () => {
      const response = await request(app).put("/auth/me/onboarding").send({ enabledSections: [] });
      expect(response.status).toBe(401);
    });
  });

  describe("POST /auth/verify-email", () => {
    it("debería verificar el email con el token recibido al registrarse", async () => {
      const register = await request(app).post("/auth/register").send({
        username: "test_user",
        email: "test@example.com",
        password: "Password123",
        name: "Test User",
      });

      const token = lastTokenSentTo("test@example.com");
      const response = await request(app).post("/auth/verify-email").send({ token });

      expect(response.status).toBe(200);
      expect(response.body.emailVerified).toBe(true);

      const profile = await request(app)
        .get("/auth/me")
        .set({ Authorization: `Bearer ${register.body.token}` });
      expect(profile.body.emailVerified).toBe(true);
    });

    it("no debería poder reutilizarse el mismo token dos veces", async () => {
      await request(app).post("/auth/register").send({
        username: "test_user",
        email: "test@example.com",
        password: "Password123",
        name: "Test User",
      });
      const token = lastTokenSentTo("test@example.com");

      const primero = await request(app).post("/auth/verify-email").send({ token });
      expect(primero.status).toBe(200);

      const segundo = await request(app).post("/auth/verify-email").send({ token });
      expect(segundo.status).toBe(400);
    });

    it("debería rechazar un token inválido", async () => {
      const response = await request(app).post("/auth/verify-email").send({ token: "token-inventado" });
      expect(response.status).toBe(400);
    });

    it("debería rechazar la petición sin token", async () => {
      const response = await request(app).post("/auth/verify-email").send({});
      expect(response.status).toBe(400);
    });
  });

  describe("POST /auth/resend-verification", () => {
    it("debería mandar un token nuevo si el email aún no está verificado", async () => {
      const register = await request(app).post("/auth/register").send({
        username: "test_user",
        email: "test@example.com",
        password: "Password123",
        name: "Test User",
      });
      const auth = { Authorization: `Bearer ${register.body.token}` };
      const primerToken = lastTokenSentTo("test@example.com");
      sendVerificationEmailMock.mockClear();

      const response = await request(app).post("/auth/resend-verification").set(auth);
      expect(response.status).toBe(200);
      expect(sendVerificationEmailMock).toHaveBeenCalledWith("test@example.com", expect.any(String));

      const nuevoToken = lastTokenSentTo("test@example.com");
      expect(nuevoToken).not.toBe(primerToken);

      // El token nuevo verifica correctamente.
      const verify = await request(app).post("/auth/verify-email").send({ token: nuevoToken });
      expect(verify.status).toBe(200);
    });

    it("no debería mandar nada si el email ya está verificado", async () => {
      const register = await request(app).post("/auth/register").send({
        username: "test_user",
        email: "test@example.com",
        password: "Password123",
        name: "Test User",
      });
      const auth = { Authorization: `Bearer ${register.body.token}` };
      const token = lastTokenSentTo("test@example.com");
      await request(app).post("/auth/verify-email").send({ token });
      sendVerificationEmailMock.mockClear();

      const response = await request(app).post("/auth/resend-verification").set(auth);
      expect(response.status).toBe(200);
      expect(sendVerificationEmailMock).not.toHaveBeenCalled();
    });

    it("debería rechazar la petición sin token", async () => {
      const response = await request(app).post("/auth/resend-verification");
      expect(response.status).toBe(401);
    });
  });

  describe("PUT /auth/me/password", () => {
    async function registerAndAuth() {
      const register = await request(app).post("/auth/register").send({
        username: "test_user",
        email: "test@example.com",
        password: "Password123",
        name: "Test User",
      });
      return { Authorization: `Bearer ${register.body.token}`, refreshToken: register.body.refreshToken as string };
    }

    it("debería cambiar la contraseña y permitir hacer login con la nueva", async () => {
      const auth = await registerAndAuth();

      const changed = await request(app)
        .put("/auth/me/password")
        .set(auth)
        .send({ currentPassword: "Password123", newPassword: "NuevaPassword456" });
      expect(changed.status).toBe(200);

      const loginConNueva = await request(app)
        .post("/auth/login")
        .send({ identifier: "test@example.com", password: "NuevaPassword456" });
      expect(loginConNueva.status).toBe(200);

      const loginConVieja = await request(app)
        .post("/auth/login")
        .send({ identifier: "test@example.com", password: "Password123" });
      expect(loginConVieja.status).toBe(401);
    });

    it("debería rechazar el cambio si currentPassword no coincide", async () => {
      const auth = await registerAndAuth();

      const response = await request(app)
        .put("/auth/me/password")
        .set(auth)
        .send({ currentPassword: "PasswordIncorrecta", newPassword: "NuevaPassword456" });

      expect(response.status).toBe(401);
    });

    it("debería rechazar una newPassword menor a 8 caracteres", async () => {
      const auth = await registerAndAuth();

      const response = await request(app)
        .put("/auth/me/password")
        .set(auth)
        .send({ currentPassword: "Password123", newPassword: "corta" });

      expect(response.status).toBe(400);
    });

    it("debería rechazar la petición sin token", async () => {
      const response = await request(app)
        .put("/auth/me/password")
        .send({ currentPassword: "Password123", newPassword: "NuevaPassword456" });

      expect(response.status).toBe(401);
    });

    it("cambiar la contraseña revoca los refresh tokens existentes (cierra las demás sesiones)", async () => {
      const auth = await registerAndAuth();

      const changed = await request(app)
        .put("/auth/me/password")
        .set("Authorization", auth.Authorization)
        .send({ currentPassword: "Password123", newPassword: "NuevaPassword456" });
      expect(changed.status).toBe(200);

      const afterChange = await request(app).post("/auth/refresh").send({ refreshToken: auth.refreshToken });
      expect(afterChange.status).toBe(401);
    });
  });
});
