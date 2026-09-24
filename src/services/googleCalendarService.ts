import { google } from "googleapis";
import { prisma } from "../config/database";
import { env } from "../config/environment";
import { logger } from "../utils/logger";
import { NotFoundError, ValidationError } from "../utils/errorHandler";
import { signGoogleOAuthState, verifyGoogleOAuthState } from "../utils/jwt";
import { decrypt, encrypt } from "../utils/encryption";
import { getUserTimezone } from "./agendaService";
import { recordTombstone } from "./tombstoneService";

// Solo lectura: si algún día se necesitara crear/editar eventos en Google desde Tidely, este
// scope tendría que ampliarse a "calendar" (lectura+escritura) — de momento nunca escribimos.
const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

// Ventana de sincronización: pasado reciente (por si se editó algo hace poco) + futuro razonable
// para planificar. Traer años de historial en cada sync no aporta nada a una agenda personal.
const SYNC_PAST_DAYS = 30;
const SYNC_FUTURE_DAYS = 180;

function assertConfigured(): void {
  if (!env.google.clientId || !env.google.clientSecret) {
    throw new ValidationError(
      "La integración con Google Calendar no está configurada en el servidor (faltan GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET)"
    );
  }
  if (!env.encryptionKey) {
    throw new ValidationError("La integración con Google Calendar no está configurada en el servidor (falta ENCRYPTION_KEY)");
  }
}

function createOAuthClient() {
  return new google.auth.OAuth2(env.google.clientId, env.google.clientSecret, env.google.redirectUri);
}

/** URL de consentimiento de Google a la que redirigir el navegador completo (no un fetch). */
export function getAuthUrl(userId: number): string {
  assertConfigured();
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline", // imprescindible para recibir refresh_token, no solo access_token
    prompt: "consent", // fuerza a reemitir refresh_token aunque el usuario ya hubiera autorizado antes
    scope: CALENDAR_SCOPES,
    state: signGoogleOAuthState(userId),
  });
}

/**
 * Procesa el `code`+`state` que Google añade al redirigir de vuelta al `redirectUri` — intercambia
 * el código por tokens, identifica la cuenta de Google (email) y guarda/actualiza la conexión.
 * Lo llama el controlador del callback, que es una ruta PÚBLICA (sin authMiddleware): el navegador
 * llega aquí redirigido por Google, sin nuestra cabecera Authorization — `state` es lo único que
 * dice de qué usuario de Tidely se trata (ver signGoogleOAuthState).
 */
export async function handleOAuthCallback(code: string, state: string): Promise<void> {
  assertConfigured();
  const userId = verifyGoogleOAuthState(state);

  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    // No debería pasar (forzamos prompt=consent arriba), salvo que el usuario revocara el acceso
    // desde su cuenta de Google en vez de desde "Desconectar" aquí.
    throw new ValidationError(
      "Google no ha devuelto un refresh token — revoca el acceso a Tidely desde tu cuenta de Google e inténtalo de nuevo"
    );
  }
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data: userInfo } = await oauth2.userinfo.get();
  if (!userInfo.email) {
    throw new ValidationError("Google no ha devuelto el email de la cuenta");
  }

  const encryptedAccessToken = encrypt(tokens.access_token ?? "");
  const encryptedRefreshToken = encrypt(tokens.refresh_token);
  await prisma.googleCalendarConnection.upsert({
    where: { userId },
    create: {
      userId,
      googleEmail: userInfo.email,
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      expiryDate: new Date(tokens.expiry_date ?? Date.now()),
    },
    update: {
      googleEmail: userInfo.email,
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      expiryDate: new Date(tokens.expiry_date ?? Date.now()),
    },
  });
}

interface ConnectionStatus {
  connected: boolean;
  email?: string;
  lastSyncedAt?: Date | null;
}

export async function getStatus(userId: number): Promise<ConnectionStatus> {
  const connection = await prisma.googleCalendarConnection.findUnique({ where: { userId } });
  if (!connection) return { connected: false };
  return { connected: true, email: connection.googleEmail, lastSyncedAt: connection.lastSyncedAt };
}

/** Elimina la conexión y todos los eventos que se habían importado de ella — idempotente. */
export async function disconnect(userId: number): Promise<void> {
  const connection = await prisma.googleCalendarConnection.findUnique({ where: { userId } });
  if (!connection) return;

  // Revocar en Google es un best-effort: si falla (token ya revocado, sin red...) igualmente
  // seguimos con la desconexión local, que es lo que de verdad le importa al usuario en Tidely.
  try {
    await createOAuthClient().revokeToken(decrypt(connection.accessToken));
  } catch (error) {
    logger.warn("googleCalendarService.disconnect: no se pudo revocar el token en Google", { error });
  }

  const imported = await prisma.event.findMany({ where: { userId, source: "google" }, select: { id: true } });

  await prisma.$transaction([
    ...imported.flatMap((e) => [prisma.event.delete({ where: { id: e.id } }), recordTombstone(prisma, userId, "event", e.id)]),
    prisma.googleCalendarConnection.delete({ where: { userId } }),
  ]);
}

async function getAuthorizedClient(userId: number) {
  const connection = await prisma.googleCalendarConnection.findUnique({ where: { userId } });
  if (!connection) throw new NotFoundError("No hay ninguna cuenta de Google Calendar conectada");

  const client = createOAuthClient();
  client.setCredentials({
    access_token: decrypt(connection.accessToken),
    refresh_token: decrypt(connection.refreshToken),
    expiry_date: connection.expiryDate.getTime(),
  });

  // La librería refresca el access token sola cuando hace falta, pero solo en memoria — sin este
  // listener, el token nuevo se perdería al terminar la petición y la siguiente sincronización
  // tendría que refrescar otra vez (funciona, pero desperdicia una llamada a Google en cada sync).
  // De paso, esto es lo que va re-cifrando con la versión nueva cualquier conexión que se hubiera
  // guardado en claro antes de que existiera el cifrado (ver PREFIX en utils/encryption.ts).
  client.on("tokens", (tokens) => {
    if (!tokens.access_token) return;
    prisma.googleCalendarConnection
      .update({
        where: { userId },
        data: {
          accessToken: encrypt(tokens.access_token),
          ...(tokens.expiry_date ? { expiryDate: new Date(tokens.expiry_date) } : {}),
        },
      })
      .catch((error) => logger.error("googleCalendarService: no se pudo persistir el token refrescado", { error }));
  });

  return client;
}

interface FetchedGoogleEvent {
  googleEventId: string;
  title: string;
  description: string | null;
  startTime: Date;
  endTime: Date;
  location: string | null;
}

async function fetchGoogleEvents(client: ReturnType<typeof createOAuthClient>, timezone: string): Promise<FetchedGoogleEvent[]> {
  const calendar = google.calendar({ version: "v3", auth: client });
  const timeMin = new Date(Date.now() - SYNC_PAST_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(Date.now() + SYNC_FUTURE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const fetched: FetchedGoogleEvent[] = [];
  let pageToken: string | undefined;
  do {
    const { data } = await calendar.events.list({
      calendarId: "primary",
      timeMin,
      timeMax,
      // Expande las series recurrentes en ocurrencias sueltas, cada una con su propio id — evita
      // tener que interpretar RRULE/EXDATE de Google con nuestro propio motor de recurrencia.
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
      pageToken,
      timeZone: timezone,
    });

    for (const item of data.items ?? []) {
      if (!item.id || item.status === "cancelled") continue;
      // `dateTime` en eventos con hora, `date` (solo YYYY-MM-DD) en eventos "todo el día".
      const start = item.start?.dateTime ?? item.start?.date;
      const end = item.end?.dateTime ?? item.end?.date;
      if (!start || !end) continue;
      fetched.push({
        googleEventId: item.id,
        title: item.summary || "(Sin título)",
        description: item.description ?? null,
        startTime: new Date(start),
        endTime: new Date(end),
        location: item.location ?? null,
      });
    }
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);

  return fetched;
}

export interface SyncResult {
  imported: number;
  updated: number;
  removed: number;
}

/**
 * Trae los eventos de Google Calendar (calendario "primary") de la ventana ±SYNC_*_DAYS y los
 * refleja como `Event` con `source: "google"` — crea los nuevos, actualiza los que ya existían
 * (por si cambiaron en Google) y borra (con tombstone) los que ya no aparecen en esa ventana
 * porque se eliminaron o se movieron fuera de rango. Es solo importación: nunca escribe en
 * Google, así que si el usuario edita uno de estos eventos desde Tidely, la próxima
 * sincronización lo sobrescribirá con la versión de Google — se avisa de esto en el dashboard.
 */
export async function syncEvents(userId: number): Promise<SyncResult> {
  const client = await getAuthorizedClient(userId);
  const timezone = await getUserTimezone(userId);
  const fetched = await fetchGoogleEvents(client, timezone);

  const existing = await prisma.event.findMany({
    where: { userId, source: "google" },
    select: { id: true, googleEventId: true },
  });
  const existingByGoogleId = new Map(existing.map((e) => [e.googleEventId, e.id]));
  const fetchedIds = new Set(fetched.map((f) => f.googleEventId));

  let imported = 0;
  let updated = 0;
  for (const item of fetched) {
    const existingId = existingByGoogleId.get(item.googleEventId);
    if (existingId) {
      await prisma.event.update({
        where: { id: existingId },
        data: {
          title: item.title,
          description: item.description,
          startTime: item.startTime,
          endTime: item.endTime,
          location: item.location,
        },
      });
      updated++;
    } else {
      await prisma.event.create({
        data: {
          userId,
          title: item.title,
          description: item.description,
          type: "free",
          startTime: item.startTime,
          endTime: item.endTime,
          location: item.location,
          source: "google",
          googleEventId: item.googleEventId,
        },
      });
      imported++;
    }
  }

  const toRemove = existing.filter((e) => e.googleEventId && !fetchedIds.has(e.googleEventId));
  if (toRemove.length > 0) {
    await prisma.$transaction(
      toRemove.flatMap((e) => [prisma.event.delete({ where: { id: e.id } }), recordTombstone(prisma, userId, "event", e.id)])
    );
  }

  await prisma.googleCalendarConnection.update({ where: { userId }, data: { lastSyncedAt: new Date() } });

  return { imported, updated, removed: toRemove.length };
}

/** Sincroniza a TODOS los usuarios con conexión activa — lo usa el cron (ver googleCalendarSyncScheduler). */
export async function syncAllConnectedUsers(): Promise<void> {
  const connections = await prisma.googleCalendarConnection.findMany({ select: { userId: true } });
  for (const { userId } of connections) {
    try {
      await syncEvents(userId);
    } catch (error) {
      // Un fallo en una cuenta (token revocado, cuota de la API...) no debe frenar el resto.
      logger.error("googleCalendarService.syncAllConnectedUsers: fallo sincronizando un usuario", { userId, error });
    }
  }
}
