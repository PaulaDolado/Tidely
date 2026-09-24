import { prisma } from "../config/database";

// Registro de qué refresh tokens se han emitido de verdad (ver el comentario del modelo
// RefreshToken en schema.prisma) — el JWT en sí sigue siendo lo que autentica (firma + expiración
// normales), esta tabla es solo la lista de "cuáles siguen vivos", consultada en cada
// POST /auth/refresh antes de fiarse de una firma válida.

export async function storeRefreshToken(userId: number, jti: string, expiresAt: Date): Promise<void> {
  await prisma.refreshToken.create({ data: { userId, jti, expiresAt } });
}

export type RefreshTokenStatus = "valid" | "revoked" | "unknown";

// "unknown" (nunca se guardó ese jti) se trata igual de mal que "revoked" en refresh() — un JWT
// con firma válida pero sin fila aquí no debería poder canjearse por unos tokens nuevos, tanto si
// es de antes de que existiera esta tabla (no debería quedar ninguno tan viejo, el refresh dura
// 7 días) como si es un intento de manipular el jti a mano.
export async function checkRefreshTokenStatus(jti: string): Promise<RefreshTokenStatus> {
  const row = await prisma.refreshToken.findUnique({ where: { jti } });
  if (!row) return "unknown";
  return row.revokedAt ? "revoked" : "valid";
}

export async function revokeRefreshToken(jti: string): Promise<void> {
  await prisma.refreshToken.updateMany({ where: { jti, revokedAt: null }, data: { revokedAt: new Date() } });
}

// Todos los refresh tokens vivos de un usuario de golpe — cambiar la contraseña (por si se
// cambió porque se sospecha que se filtró) y la detección de reuso en refresh() (ver authService)
// usan esto para cerrar TODAS las sesiones activas, no solo la que disparó la acción.
export async function revokeAllRefreshTokensForUser(userId: number): Promise<void> {
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}
