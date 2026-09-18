// Cliente REST directo para compartir eventos con otro usuario de Tidely (ver EventInvitation en
// el backend) — mismo criterio que api/calendarLegend.ts: no pasa por SQLite ni por src/sync/, ya
// que gestionar QUIÉN tiene acceso a un evento es una acción puntual online, no algo que tenga
// sentido hacer offline. El propio EVENTO compartido (una vez aceptado) sí llega por sync
// normal (ver ServerEvent.sharing en types.ts) — esto solo cubre invitar/listar/responder/quitar.
import { api } from "./client";
import { EventInvitation } from "../types";

/** Todas las invitaciones de UN evento (cualquier estado) — solo tiene sentido si eres quien lo
 * creó (ver EventInvitationsEditor equivalente en el dashboard web). */
export async function listEventInvitations(eventId: number): Promise<EventInvitation[]> {
  const res = await api.get<{ invitations: EventInvitation[] }>(`/agenda/events/${eventId}/invitations`);
  return res.invitations;
}

/** Invita por username o email de Tidely (mismo `identifier` que el login) a un evento propio. */
export const inviteToEvent = (eventId: number, identifier: string) =>
  api.post<EventInvitation>(`/agenda/events/${eventId}/invitations`, { identifier });

/** Invitaciones RECIBIDAS — por defecto las pendientes de responder (ver PendingInvitationsBanner
 * en AgendaScreen.tsx), pero admite pedir cualquier estado para un histórico. */
export async function listReceivedInvitations(status?: "pending" | "accepted" | "declined"): Promise<EventInvitation[]> {
  const query = status ? `?status=${status}` : "";
  const res = await api.get<{ invitations: EventInvitation[] }>(`/agenda/invitations${query}`);
  return res.invitations;
}

/** Aceptar o rechazar una invitación recibida — solo el propio invitado. */
export const respondToInvitation = (invitationId: number, status: "accepted" | "declined") =>
  api.put<EventInvitation>(`/agenda/invitations/${invitationId}`, { status });

/** Borra la invitación entera: el invitado la usa para quitarse el evento del calendario del
 * todo, quien lo creó para revocarla. */
export const removeInvitation = (invitationId: number) => api.delete<{ message: string }>(`/agenda/invitations/${invitationId}`);
