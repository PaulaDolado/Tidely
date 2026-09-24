import {
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
