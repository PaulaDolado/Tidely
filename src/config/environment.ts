import dotenv from "dotenv";

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const nodeEnv = process.env.NODE_ENV ?? "development";
const isProduction = nodeEnv === "production";

// `CORS_ORIGIN` sin definir cae a "*" en desarrollo/test (cómodo, y hoy inofensivo porque no hay
// `credentials: true` en app.ts) — pero en producción NO: un despliegue real que se le olvide
// poner esta variable serviría con CORS abierto a cualquier origen sin que nadie se diera cuenta,
// y basta con activar `credentials: true` el día de mañana (p.ej. al pasar a cookies de sesión)
// para que ese "*" combinado con credenciales se vuelva explotable de verdad. Mismo criterio que
// JWT_SECRET/DATABASE_URL: si falta en producción, mejor que la app no arranque a que arranque
// insegura en silencio.
const corsOrigin = isProduction ? required("CORS_ORIGIN") : process.env.CORS_ORIGIN ?? "*";

export const env = {
  nodeEnv,
  port: parseInt(process.env.PORT ?? "3000", 10),
  databaseUrl: required("DATABASE_URL"),
  jwt: {
    secret: required("JWT_SECRET"),
    expiresIn: process.env.JWT_EXPIRES_IN ?? "1h",
    refreshSecret: required("JWT_REFRESH_SECRET"),
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? "7d",
  },
  cors: {
    origin: corsOrigin,
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "900000", 10),
    max: parseInt(process.env.RATE_LIMIT_MAX ?? "100", 10),
    // Límite propio (más estricto) para /auth, antes fijo en el código a 20/15min. Configurable
    // para poder relajarlo en desarrollo sin tocar la protección real de producción.
    authWindowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS ?? "900000", 10),
    authMax: parseInt(process.env.AUTH_RATE_LIMIT_MAX ?? "20", 10),
  },
  // Integración de solo lectura con Google Calendar (ver googleCalendarService) — a diferencia
  // del resto de variables, NO son obligatorias: sin ellas la app funciona igual, simplemente
  // esa integración responde "no configurada" en vez de tumbar el arranque entero (a diferencia
  // de JWT_SECRET/DATABASE_URL, que si faltan no hay app que levantar).
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    // URL del propio backend a la que Google redirige tras el consentimiento — debe coincidir
    // EXACTAMENTE con un "Authorized redirect URI" del cliente OAuth en Google Cloud Console.
    redirectUri: process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3000/integrations/google/callback",
  },
  // Clave para cifrar en reposo los access/refresh token de Google Calendar (ver utils/
  // encryption.ts) — igual de opcional que google.clientId/clientSecret arriba: sin ninguna de
  // las tres no hay app rota, solo esa integración "no configurada". Si SÍ están las de Google
  // pero falta esta, assertConfigured() en googleCalendarService también la exige — no tendría
  // sentido guardar el token de alguien sin poder cifrarlo.
  encryptionKey: process.env.ENCRYPTION_KEY ?? "",
  isProduction,
  isTest: nodeEnv === "test",
};
