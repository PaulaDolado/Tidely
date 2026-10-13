import { api } from "./client";

// Mismo shape que GoogleCalendarStatus / GoogleCalendarSyncResult en dashboard/src/types.ts
// (backend: src/services/googleCalendarService.ts). Integración de SOLO lectura: trae eventos de
// Google a la agenda de Tidely, nunca escribe en Google.
export interface GoogleCalendarStatus {
  connected: boolean;
  email?: string;
  lastSyncedAt?: string | null;
}

export interface GoogleCalendarSyncResult {
  imported: number;
  updated: number;
  removed: number;
}

export function getGoogleStatus(): Promise<GoogleCalendarStatus> {
  return api.get<GoogleCalendarStatus>("/integrations/google/status");
}

/**
 * URL de consentimiento de Google. `client=mobile` queda firmado dentro del `state` de OAuth, y
 * el callback del backend (público) redirige entonces al deep link de la app en vez de al
 * dashboard web — ver `parseGoogleDeepLink` para el contrato de ese enlace.
 */
export async function getGoogleConnectUrl(): Promise<string> {
  const res = await api.get<{ url: string }>("/integrations/google/connect?client=mobile");
  return res.url;
}

export function syncGoogleNow(): Promise<GoogleCalendarSyncResult> {
  return api.post<GoogleCalendarSyncResult>("/integrations/google/sync");
}

export function disconnectGoogle(): Promise<unknown> {
  return api.delete("/integrations/google/disconnect");
}

/**
 * Contrato del deep link con el que el backend devuelve al usuario a la app tras el consentimiento
 * (scheme "tidely" en app.json; ver handleCallback en googleCalendarController del backend):
 *   tidely://google?status=connected   — conexión guardada
 *   tidely://google?status=error       — denegó el permiso o falló el intercambio de código
 * Devuelve null para cualquier otra URL (otro host, sin `status`, o un `status` desconocido), de
 * modo que un enlace ajeno que abra la app no dispare ningún aviso. Se parsea a mano en vez de con
 * `new URL(...)`: la implementación de URL de Hermes no es fiable con esquemas personalizados.
 */
export function parseGoogleDeepLink(url: string): "connected" | "error" | null {
  const match = /^tidely:\/\/google\/?\?([^#]*)/i.exec(url);
  if (!match) return null;
  for (const pair of match[1].split("&")) {
    const [key, value] = pair.split("=");
    if (key === "status" && (value === "connected" || value === "error")) return value;
  }
  return null;
}
