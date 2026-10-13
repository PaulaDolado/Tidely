import jwt from "jsonwebtoken";
import { env } from "../../../src/config/environment";
import {
  getGoogleOAuthStateClient,
  signGoogleOAuthState,
  verifyGoogleOAuthState,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from "../../../src/utils/jwt";

describe("jwt utils", () => {
  const payload = { userId: 1, email: "test@example.com" };

  it("debería firmar y verificar un access token válido", () => {
    const token = signAccessToken(payload);
    const decoded = verifyAccessToken(token);
    expect(decoded.userId).toBe(payload.userId);
    expect(decoded.email).toBe(payload.email);
  });

  it("debería firmar y verificar un refresh token válido", () => {
    const { token, jti, expiresAt } = signRefreshToken(payload);
    const decoded = verifyRefreshToken(token);
    expect(decoded.userId).toBe(payload.userId);
    expect(decoded.jti).toBe(jti);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("verifyAccessToken debería lanzar con un token con firma inválida", () => {
    const token = signAccessToken(payload);
    const tampered = token.slice(0, -2) + "xx";
    expect(() => verifyAccessToken(tampered)).toThrow();
  });

  it("un refresh token no debería ser válido como access token (secretos distintos)", () => {
    const { token } = signRefreshToken(payload);
    expect(() => verifyAccessToken(token)).toThrow();
  });

  it("un access token no debería ser válido como refresh token (secretos distintos)", () => {
    const accessToken = signAccessToken(payload);
    expect(() => verifyRefreshToken(accessToken)).toThrow();
  });

  it("debería lanzar con un string que no es un JWT", () => {
    expect(() => verifyAccessToken("no-es-un-token")).toThrow();
  });

  it("dos refresh tokens del mismo payload deberían tener jti (y token) distintos", () => {
    const first = signRefreshToken(payload);
    const second = signRefreshToken(payload);
    expect(first.jti).not.toBe(second.jti);
    expect(first.token).not.toBe(second.token);
  });
});

describe("google oauth state", () => {
  it("un state de la web (por defecto) verifica y se interpreta como web", () => {
    const state = signGoogleOAuthState(7);
    expect(verifyGoogleOAuthState(state)).toBe(7);
    expect(getGoogleOAuthStateClient(state)).toBe("web");
  });

  it("un state firmado con client=mobile verifica igual y se interpreta como móvil", () => {
    const state = signGoogleOAuthState(7, "mobile");
    expect(verifyGoogleOAuthState(state)).toBe(7);
    expect(getGoogleOAuthStateClient(state)).toBe("mobile");
  });

  it("un state antiguo (sin el campo client) sigue verificando y significa web", () => {
    const legacy = jwt.sign({ userId: 9, purpose: "google-calendar-connect" }, env.jwt.secret, { expiresIn: "10m" });
    expect(verifyGoogleOAuthState(legacy)).toBe(9);
    expect(getGoogleOAuthStateClient(legacy)).toBe("web");
  });

  it("solo el literal 'mobile' cuenta como móvil (lista de permitidos)", () => {
    const odd = jwt.sign({ userId: 9, purpose: "google-calendar-connect", client: "https://evil.example" }, env.jwt.secret, {
      expiresIn: "10m",
    });
    expect(getGoogleOAuthStateClient(odd)).toBe("web");
  });

  it("un state ausente, manipulado, caducado o de otro propósito cae a web sin lanzar", () => {
    expect(getGoogleOAuthStateClient(undefined)).toBe("web");
    expect(getGoogleOAuthStateClient("no-es-un-token")).toBe("web");

    const tampered = signGoogleOAuthState(7, "mobile").slice(0, -2) + "xx";
    expect(getGoogleOAuthStateClient(tampered)).toBe("web");

    const expired = jwt.sign({ userId: 7, purpose: "google-calendar-connect", client: "mobile" }, env.jwt.secret, {
      expiresIn: -10,
    });
    expect(getGoogleOAuthStateClient(expired)).toBe("web");

    const otherPurpose = jwt.sign({ userId: 7, purpose: "otra-cosa", client: "mobile" }, env.jwt.secret, { expiresIn: "10m" });
    expect(getGoogleOAuthStateClient(otherPurpose)).toBe("web");
  });
});
