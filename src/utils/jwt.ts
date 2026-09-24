import crypto from "crypto";
import jwt, { SignOptions } from "jsonwebtoken";
import { env } from "../config/environment";

export interface JwtPayload {
  userId: number;
  email: string;
}

export interface RefreshTokenPayload extends JwtPayload {
  jti: string;
}

export interface SignedRefreshToken {
  token: string;
  jti: string;
  expiresAt: Date;
}

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.jwt.secret, {
    expiresIn: env.jwt.expiresIn,
  } as SignOptions);
}

// Devuelve, además del JWT en sí, su `jti` (identificador único de ESTA emisión, no del usuario)
// y su fecha de caducidad ya calculada — refreshTokenService.ts los usa para guardar un registro
// de "este refresh token existe y sigue vivo" en la tabla RefreshToken (ver el comentario en
// schema.prisma sobre por qué: sin esto, un refresh token robado seguiría siendo válido hasta que
// caduque por sí solo, sin forma de matarlo antes con un logout o un cambio de contraseña).
// `jti` es aleatorio (crypto.randomUUID, no derivado del payload) a propósito: dos tokens
// emitidos para el mismo usuario en el mismo segundo firman igual byte a byte si el payload es
// idéntico (HS256 es determinista), así que sin un `jti` propio podrían colisionar como clave de
// base de datos.
export function signRefreshToken(payload: JwtPayload): SignedRefreshToken {
  const jti = crypto.randomUUID();
  const token = jwt.sign({ ...payload, jti }, env.jwt.refreshSecret, {
    expiresIn: env.jwt.refreshExpiresIn,
  } as SignOptions);
  const decoded = jwt.decode(token) as { exp: number };
  return { token, jti, expiresAt: new Date(decoded.exp * 1000) };
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, env.jwt.secret) as JwtPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, env.jwt.refreshSecret) as RefreshTokenPayload;
}

// El callback de Google Calendar (ver googleCalendarService/googleCalendar.routes) lo abre el
// propio navegador redirigido por Google, SIN nuestra cabecera Authorization — así que no hay
// forma de saber qué usuario iba conectando su cuenta salvo llevándolo ida y vuelta en el
// parámetro `state` del flujo OAuth. Un JWT de corta duración (10 min, tiempo de sobra para
// completar el consentimiento) sirve de "carnet" firmado: si alguien lo manipulara, la firma no
// cuadraría. `purpose` evita que un access/refresh token cualquiera (firmados con el mismo
// secreto) se pudiera colar aquí como `state` válido.
interface GoogleOAuthStatePayload {
  userId: number;
  purpose: "google-calendar-connect";
}

export function signGoogleOAuthState(userId: number): string {
  const payload: GoogleOAuthStatePayload = { userId, purpose: "google-calendar-connect" };
  return jwt.sign(payload, env.jwt.secret, { expiresIn: "10m" });
}

export function verifyGoogleOAuthState(token: string): number {
  const payload = jwt.verify(token, env.jwt.secret) as GoogleOAuthStatePayload;
  if (payload.purpose !== "google-calendar-connect") {
    throw new Error("Token de estado inválido");
  }
  return payload.userId;
}
