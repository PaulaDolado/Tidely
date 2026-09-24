import { prisma } from "../config/database";
import { addDays } from "date-fns/addDays";
import { hashPassword, comparePassword } from "../utils/password";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../utils/jwt";
import { generateVerificationToken, hashToken } from "../utils/verificationToken";
import { sendVerificationEmail } from "../utils/mailer";
import { ConflictError, TooManyRequestsError, UnauthorizedError, ValidationError } from "../utils/errorHandler";
import { seedDefaultCategories } from "./eventCategoryService";
import {
  checkRefreshTokenStatus,
  revokeAllRefreshTokensForUser,
  revokeRefreshToken,
  storeRefreshToken,
} from "./refreshTokenService";

// El username solo se puede cambiar una vez cada N días — evita que alguien lo use como
// picadero para "reservar" varios handles o para dar esquinazo a quien lo busca. El email NO
// tiene este cooldown: cambiarlo ya exige verificar la dirección nueva, que es un freno
// distinto (y más fuerte, porque hace falta acceso real a esa bandeja de entrada).
const USERNAME_CHANGE_COOLDOWN_DAYS = 15;

interface RegisterInput {
  username: string;
  email: string;
  password: string;
  name: string;
  timezone?: string;
}

// Login por email O por username — `identifier` es el texto tal cual lo escribió el usuario,
// sin que el cliente tenga que decidir de antemano cuál de los dos es.
interface LoginInput {
  identifier: string;
  password: string;
}

// Guarda cada refresh token que se emite (ver refreshTokenService.ts) — así login/register/
// refresh dejan siempre un registro que después permite matarlo antes de que caduque por sí solo
// (logout, cambio de contraseña, o detección de reuso si alguien presenta uno ya rotado).
async function buildTokens(user: { id: number; email: string }) {
  const payload = { userId: user.id, email: user.email };
  const refresh = signRefreshToken(payload);
  await storeRefreshToken(user.id, refresh.jti, refresh.expiresAt);
  return {
    token: signAccessToken(payload),
    refreshToken: refresh.token,
  };
}

// Proyección pública del usuario — nunca incluye `password` ni el hash del token de
// verificación. Centralizada aquí para no repetir los mismos campos en
// register/login/getProfile/updateProfile cada vez que se añade uno nuevo.
function toProfile(user: {
  id: number;
  email: string;
  username: string;
  name: string;
  lastName: string | null;
  usernameChangedAt: Date | null;
  emailVerifiedAt: Date | null;
  timezone: string;
  enabledSections: string[];
  onboardingCompleted: boolean;
  menuLayout: string;
  menuOrder: string[];
}) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    enabledSections: user.enabledSections,
    // El frontend lo usa para decidir si mostrar el asistente de bienvenida al entrar (ver
    // dashboard/src/pages/DashboardPage.tsx) — una vez completado (o si la cuenta ya existía
    // antes de este campo, ver default en schema.prisma) no se vuelve a mostrar solo.
    onboardingCompleted: user.onboardingCompleted,
    // "default" | "compact" — ver Ajustes → General → Apariencia (SettingsDialog) y el render del
    // menú lateral (AppShell.tsx).
    menuLayout: user.menuLayout,
    // Orden manual de los apartados del menú (arrastrar manteniendo pulsado en AppShell.tsx).
    menuOrder: user.menuOrder,
    name: user.name,
    lastName: user.lastName,
    timezone: user.timezone,
    emailVerified: user.emailVerifiedAt !== null,
    // Precalculado aquí (no se manda solo `usernameChangedAt` en crudo) para que el frontend no
    // tenga que conocer ni duplicar los "15 días" de cooldown — null = puede cambiarlo ya.
    nextUsernameChangeAllowedAt: user.usernameChangedAt ? nextAllowedIfInCooldown(user.usernameChangedAt) : null,
  };
}

function nextAllowedIfInCooldown(lastChangedAt: Date): string | null {
  const nextAllowed = addDays(lastChangedAt, USERNAME_CHANGE_COOLDOWN_DAYS);
  return nextAllowed > new Date() ? nextAllowed.toISOString() : null;
}

// Genera un token nuevo, lo guarda (hasheado) en el usuario y manda el email — usado tanto en
// el registro como al cambiar de email o al pedir un reenvío, para no repetir las 3 mismas
// líneas en cada sitio.
async function issueAndSendVerification(userId: number, email: string): Promise<void> {
  const { token, tokenHash, expiresAt } = generateVerificationToken();
  await prisma.user.update({
    where: { id: userId },
    data: { emailVerificationTokenHash: tokenHash, emailVerificationExpiresAt: expiresAt },
  });
  await sendVerificationEmail(email, token);
}

export async function register(input: RegisterInput) {
  const [existingEmail, existingUsername] = await Promise.all([
    prisma.user.findUnique({ where: { email: input.email } }),
    prisma.user.findUnique({ where: { username: input.username } }),
  ]);
  if (existingEmail) {
    throw new ConflictError("Email ya existe");
  }
  if (existingUsername) {
    throw new ConflictError("Ese nombre de usuario ya está en uso");
  }

  const hashedPassword = await hashPassword(input.password);
  const user = await prisma.user.create({
    data: {
      email: input.email,
      username: input.username,
      password: hashedPassword,
      name: input.name,
      ...(input.timezone ? { timezone: input.timezone } : {}),
      // El default de la columna es `true` (para no afectar a cuentas ya existentes, ver
      // schema.prisma) — una cuenta que se acaba de crear aquí sí debe ver el asistente de
      // bienvenida, así que se pisa explícitamente a `false` solo en este alta.
      onboardingCompleted: false,
    },
  });

  // Categorías de evento con las que arranca toda cuenta nueva (ver eventCategoryService) —
  // "Trabajo", "Estudio"... el usuario puede renombrarlas, cambiarles el color o borrarlas desde
  // Agenda > + Nuevo evento igual que cualquier categoría creada a mano.
  await seedDefaultCategories(user.id);

  // El registro NO espera a que el email "salga" para completarse (ver mailer.ts: hoy es solo
  // un log, pero incluso con un proveedor real no tiene sentido que un email lento bloquee la
  // creación de la cuenta) — se dispara y, si falla, el usuario siempre puede pedir un reenvío
  // ya logueado (login no exige tener el email verificado, ver decisión en PUT /auth/me).
  await issueAndSendVerification(user.id, user.email);

  const tokens = await buildTokens(user);
  return { ...tokens, user: toProfile(user) };
}

export async function login(input: LoginInput) {
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: input.identifier }, { username: input.identifier }] },
  });
  if (!user) {
    throw new UnauthorizedError("Credenciales inválidas");
  }

  const valid = await comparePassword(input.password, user.password);
  if (!valid) {
    throw new UnauthorizedError("Credenciales inválidas");
  }

  const tokens = await buildTokens(user);
  return { ...tokens, user: toProfile(user) };
}

export async function getProfile(userId: number) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new UnauthorizedError("Usuario no encontrado");
  }
  return toProfile(user);
}

interface UpdateProfileInput {
  name?: string;
  lastName?: string | null;
  username?: string;
  email?: string;
  timezone?: string;
}

export async function updateProfile(userId: number, input: UpdateProfileInput) {
  // Hace falta el usuario actual (no solo el userId) para saber si `username`/`email` son de
  // verdad un CAMBIO (si mandan el mismo valor que ya tenían, no cuenta como cambio: no
  // consume el cooldown del username ni resetea la verificación del email) y, en el caso del
  // username, para comprobar cuándo se cambió la última vez.
  const current = await prisma.user.findUnique({ where: { id: userId } });
  if (!current) {
    throw new UnauthorizedError("Usuario no encontrado");
  }

  const isChangingUsername = input.username !== undefined && input.username !== current.username;
  if (isChangingUsername) {
    if (current.usernameChangedAt) {
      const nextAllowed = addDays(current.usernameChangedAt, USERNAME_CHANGE_COOLDOWN_DAYS);
      if (nextAllowed > new Date()) {
        throw new TooManyRequestsError(
          `Solo puedes cambiar el nombre de usuario una vez cada ${USERNAME_CHANGE_COOLDOWN_DAYS} días. Podrás cambiarlo de nuevo el ${nextAllowed.toISOString().slice(0, 10)}.`
        );
      }
    }
    const existing = await prisma.user.findUnique({ where: { username: input.username } });
    if (existing && existing.id !== userId) {
      throw new ConflictError("Ese nombre de usuario ya está en uso");
    }
  }

  const isChangingEmail = input.email !== undefined && input.email !== current.email;
  if (isChangingEmail) {
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing && existing.id !== userId) {
      throw new ConflictError("Ese email ya está en uso por otra cuenta");
    }
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      // lastName admite explícitamente `null` para poder BORRARLO (a diferencia de `undefined`,
      // que significa "no tocar este campo") — por eso se compara contra undefined y no con un
      // simple `if (input.lastName)`.
      ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
      ...(input.username !== undefined ? { username: input.username } : {}),
      ...(isChangingUsername ? { usernameChangedAt: new Date() } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      // Un email nuevo empieza sin verificar — aunque coincidiera con uno que ya se verificó en
      // el pasado con esta cuenta, hay que volver a confirmarlo (no nos fiamos de un estado
      // viejo asociado a otra dirección).
      ...(isChangingEmail ? { emailVerifiedAt: null } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
    },
  });

  if (isChangingEmail) {
    await issueAndSendVerification(user.id, user.email);
  }

  return toProfile(user);
}

// Guarda la elección del asistente de bienvenida (ver PUT /auth/me/onboarding) y marca la cuenta
// como ya pasada por él — de un solo golpe, a diferencia de `updateProfile`, porque aquí no hay
// campos opcionales sueltos: el asistente siempre manda la lista completa de apartados elegidos
// (incluso si es la lista entera, "seleccionar todos" es una elección válida como otra
// cualquiera, no un "no tocar nada").
export async function completeOnboarding(userId: number, enabledSections: string[]) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { enabledSections, onboardingCompleted: true },
  });
  return toProfile(user);
}

// Guarda el diseño del menú (por defecto/compacto, ver Ajustes → General → Apariencia) y/o el
// orden manual de sus apartados (arrastrar manteniendo pulsado en AppShell.tsx) — ambos campos
// opcionales, a diferencia de completeOnboarding: aquí SÍ puede llegar solo uno de los dos (p.ej.
// reordenar un apartado no toca menuLayout, y cambiar de compacto a por defecto no toca el orden).
export async function updateMenuPreferences(
  userId: number,
  patch: { menuLayout?: string; menuOrder?: string[] }
) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: patch,
  });
  return toProfile(user);
}

export async function verifyEmail(token: string) {
  const user = await prisma.user.findFirst({ where: { emailVerificationTokenHash: hashToken(token) } });
  if (!user || !user.emailVerificationExpiresAt || user.emailVerificationExpiresAt < new Date()) {
    throw new ValidationError("El enlace de verificación no es válido o ha caducado. Pide que te reenvíen uno.");
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { emailVerifiedAt: new Date(), emailVerificationTokenHash: null, emailVerificationExpiresAt: null },
  });
  return toProfile(updated);
}

export async function resendVerification(userId: number) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new UnauthorizedError("Usuario no encontrado");
  }
  if (user.emailVerifiedAt) {
    return; // ya verificado — no hay nada que reenviar, la llamada es un no-op silencioso
  }
  await issueAndSendVerification(user.id, user.email);
}

export async function changePassword(userId: number, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new UnauthorizedError("Usuario no encontrado");
  }

  const valid = await comparePassword(currentPassword, user.password);
  if (!valid) {
    throw new UnauthorizedError("La contraseña actual no es correcta");
  }

  const hashedPassword = await hashPassword(newPassword);
  await prisma.user.update({ where: { id: userId }, data: { password: hashedPassword } });

  // Si la contraseña se cambió porque se sospechaba que se había filtrado, un refresh token ya
  // robado antes del cambio seguiría siendo válido y podría seguir canjeándose por tokens nuevos
  // indefinidamente sin esto — cierra TODAS las sesiones activas (todos los dispositivos vuelven
  // a pedir login), no solo la que disparó el cambio.
  await revokeAllRefreshTokensForUser(userId);
}

export async function refresh(refreshToken: string) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new UnauthorizedError("Refresh token inválido o expirado");
  }

  const status = await checkRefreshTokenStatus(payload.jti);
  if (status === "revoked") {
    // Un refresh token ya revocado (porque este mismo flujo ya lo rotó antes, o porque hubo un
    // logout/cambio de contraseña de por medio) que se vuelve a presentar como válido es la señal
    // clásica de que se filtró: el cliente legítimo ya avanzó a un token más nuevo, así que quien
    // presenta ESTE es, casi con toda seguridad, otra parte con una copia robada. La respuesta no
    // es solo rechazar ESTE token — es cerrar TODA la sesión del usuario (mismo patrón que usan
    // Auth0/Okta, "refresh token reuse detection"), para no dejar la copia robada más nueva (si
    // el atacante ya rotó una vez) siguiendo viva.
    await revokeAllRefreshTokensForUser(payload.userId);
    throw new UnauthorizedError("Refresh token inválido o expirado");
  }
  if (status === "unknown") {
    throw new UnauthorizedError("Refresh token inválido o expirado");
  }

  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user) {
    throw new UnauthorizedError("Usuario no encontrado");
  }

  // Rotación: este token queda inservible en cuanto se canjea, aunque su firma siga siendo
  // válida hasta que caduque por sí solo — el cliente ya tiene el par nuevo, así que no hay
  // motivo legítimo para volver a presentar este.
  await revokeRefreshToken(payload.jti);
  return buildTokens(user);
}

// Cierra la sesión asociada a ESTE refresh token (no todas las del usuario, a diferencia de un
// cambio de contraseña) — best-effort a propósito: si el token ya no es válido/reconocible, el
// resultado que le importa a quien llama (que ese token deje de servir) ya se cumple igual, así
// que no hace falta distinguir "ya estaba revocado" de "no se encontró" con un error.
export async function logout(refreshToken: string): Promise<void> {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    return;
  }
  await revokeRefreshToken(payload.jti);
}
