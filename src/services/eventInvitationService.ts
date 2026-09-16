import { prisma } from "../config/database";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../utils/errorHandler";

// Igual selección que en las respuestas de agendaService (ver `sharing` en findEventsInRange):
// solo lo mínimo para mostrar un nombre/usuario, nunca el email ni nada más de la cuenta ajena.
const PUBLIC_USER_SELECT = { id: true, name: true, username: true } as const;

async function findOwnedEvent(userId: number, eventId: number) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw new NotFoundError("Evento no encontrado");
  if (event.userId !== userId) throw new ForbiddenError("No autorizado");
  return event;
}

/**
 * Invita a OTRO usuario de Tidely (buscado por username o email, igual que el `identifier` de
 * login) a un evento — solo puede invitar quien lo creó. Queda en "pending" hasta que el
 * invitado responda (ver respondToInvitation); mientras tanto no aparece en su calendario (ver
 * agendaService.findEventsInRange, que solo cuenta las "accepted").
 */
export async function inviteToEvent(inviterId: number, eventId: number, identifier: string) {
  const event = await findOwnedEvent(inviterId, eventId);

  const invitee = await prisma.user.findFirst({
    where: { OR: [{ email: identifier }, { username: identifier }] },
  });
  if (!invitee) throw new NotFoundError("No existe ningún usuario con ese nombre de usuario o email");
  if (invitee.id === inviterId) throw new ValidationError("No puedes invitarte a ti mismo");

  const existing = await prisma.eventInvitation.findUnique({
    where: { eventId_inviteeId: { eventId, inviteeId: invitee.id } },
  });

  let invitation;
  if (existing) {
    // "declined" se reactiva a "pending" en vez de fallar — si no, quien invita no tendría forma
    // de volver a intentarlo tras un rechazo (el único otro camino sería borrar la fila a mano).
    // "pending"/"accepted" sí bloquean: ya hay una invitación en curso, invitar de nuevo no pinta
    // nada nuevo.
    if (existing.status !== "declined") {
      throw new ConflictError("Ese usuario ya tiene una invitación a este evento");
    }
    invitation = await prisma.eventInvitation.update({
      where: { id: existing.id },
      data: { status: "pending" },
    });
  } else {
    invitation = await prisma.eventInvitation.create({
      data: { eventId, inviterId, inviteeId: invitee.id, status: "pending" },
    });
  }

  // Aviso inmediato, no un scheduler periódico (a diferencia de event_reminder/goal_at_risk/
  // task_due, ver notificationService.ts) — invitar a alguien es un hecho puntual disparado por
  // una acción del usuario, no algo que haya que ir comprobando cada pocos minutos.
  const inviter = await prisma.user.findUnique({ where: { id: inviterId }, select: PUBLIC_USER_SELECT });
  await prisma.notification.create({
    data: {
      userId: invitee.id,
      type: "event_invitation",
      title: `${inviter?.name ?? "Alguien"} te ha invitado a un evento`,
      message: event.title,
      relatedId: invitation.id,
    },
  });

  return { ...invitation, invitee };
}

/** Todas las invitaciones de UN evento (cualquier estado) — solo para quien lo creó, para poder
 * ver quién está pendiente/ha aceptado/ha rechazado. */
export async function listEventInvitations(userId: number, eventId: number) {
  await findOwnedEvent(userId, eventId);
  const invitations = await prisma.eventInvitation.findMany({
    where: { eventId },
    include: { invitee: { select: PUBLIC_USER_SELECT } },
    orderBy: { createdAt: "asc" },
  });
  return { invitations };
}

/** Invitaciones que ha RECIBIDO el usuario — por defecto solo las pendientes (lo que de verdad
 * necesita decidir), pero admite pedir cualquier estado para, p.ej., un histórico. */
export async function listReceivedInvitations(userId: number, status?: string) {
  const invitations = await prisma.eventInvitation.findMany({
    where: { inviteeId: userId, ...(status ? { status } : {}) },
    include: {
      inviter: { select: PUBLIC_USER_SELECT },
      event: { select: { id: true, title: true, startTime: true, endTime: true, location: true, isRecurring: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return { invitations };
}

async function findOwnInvitation(userId: number, invitationId: number) {
  const invitation = await prisma.eventInvitation.findUnique({ where: { id: invitationId } });
  if (!invitation) throw new NotFoundError("Invitación no encontrada");
  if (invitation.inviteeId !== userId && invitation.inviterId !== userId) throw new ForbiddenError("No autorizado");
  return invitation;
}

/** Aceptar o rechazar — solo el propio invitado, nunca quien invitó. Se puede llamar más de una
 * vez (p.ej. rechazar y luego aceptar si cambia de idea): no hay una máquina de estados estricta,
 * cualquier transición vale mientras la pida el invitado. */
export async function respondToInvitation(userId: number, invitationId: number, status: "accepted" | "declined") {
  const invitation = await findOwnInvitation(userId, invitationId);
  if (invitation.inviteeId !== userId) {
    throw new ForbiddenError("Solo el invitado puede responder a esta invitación");
  }
  return prisma.eventInvitation.update({ where: { id: invitationId }, data: { status } });
}

/** Borra la invitación entera — el INVITADO la usa para quitarse el evento de su calendario del
 * todo (a diferencia de "declined", que conserva la fila); quien CREÓ el evento la usa para
 * revocar una invitación que ya no quiere mantener, esté en el estado que esté. */
export async function removeInvitation(userId: number, invitationId: number) {
  await findOwnInvitation(userId, invitationId); // ya comprueba que sea invitado o invitador
  await prisma.eventInvitation.delete({ where: { id: invitationId } });
}
