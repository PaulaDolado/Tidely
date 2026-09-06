// Base URL configurable por variable de entorno `EXPO_PUBLIC_API_URL` (Expo la incrusta en el
// build automáticamente por llevar el prefijo `EXPO_PUBLIC_`, igual que Vite hace con
// `VITE_API_URL` en el dashboard — ver dashboard/src/api/client.ts). El valor por defecto solo
// sirve para iOS Simulator; un emulador Android necesita `http://10.0.2.2:3000` y un dispositivo
// físico la IP de tu máquina en la red local (ver mobile/README.md).
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

// Tokens en memoria para no depender de I/O async (SecureStore) en cada petición — se cargan al
// arrancar la app y se mantienen al día vía `setTokens`/`clearTokens` (ver auth/AuthContext.tsx).
let accessToken: string | null = null;
let refreshToken: string | null = null;
// Evita refrescar en paralelo si varias peticiones reciben 401 a la vez — todas esperan al
// mismo refresh en curso en vez de disparar uno cada una.
let refreshPromise: Promise<boolean> | null = null;

export function setTokens(token: string | null, newRefreshToken: string | null): void {
  accessToken = token;
  refreshToken = newRefreshToken;
}

// Se rellena desde AuthContext para no crear un ciclo de imports (client → storage → client).
let onRefreshed: ((token: string, refreshToken: string) => void) | null = null;
let onAuthExpired: (() => void) | null = null;
export function setAuthCallbacks(handlers: {
  onRefreshed: (token: string, refreshToken: string) => void;
  onAuthExpired: () => void;
}): void {
  onRefreshed = handlers.onRefreshed;
  onAuthExpired = handlers.onAuthExpired;
}

async function tryRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const response = await fetch(`${API_URL}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
        if (!response.ok) return false;
        const body = (await response.json()) as { token: string; refreshToken: string };
        accessToken = body.token;
        refreshToken = body.refreshToken;
        onRefreshed?.(body.token, body.refreshToken);
        return true;
      } catch {
        return false;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

async function request<T>(path: string, options: RequestInit = {}, isRetry = false): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...options, headers });
  } catch {
    throw new ApiError(`No se pudo conectar con la API en ${API_URL}`, 0);
  }

  if (response.status === 401 && !isRetry && path !== "/auth/refresh") {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, options, true);
    onAuthExpired?.();
    throw new ApiError("Sesión expirada", 401);
  }

  let body: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : `Error ${response.status}`;
    // `detail` solo viene del backend fuera de producción (ver errorHandler.ts) — un 500 genérico
    // ("Error interno del servidor") por sí solo no dice nada útil; con esto se ve la causa real
    // sin tener que mirar los logs del servidor.
    const detail = body && typeof body === "object" && "detail" in body ? String((body as { detail: unknown }).detail) : null;
    throw new ApiError(detail && detail !== message ? `${message}: ${detail}` : message, response.status);
  }

  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, data?: unknown) => request<T>(path, { method: "POST", body: data !== undefined ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) => request<T>(path, { method: "PUT", body: data !== undefined ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
