// `||`, no `??`: si VITE_API_URL llega como string VACÍO en tiempo de build (p.ej. una variable
// de repo de GitHub Actions que todavía no existía cuando corrió el workflow, ver
// .github/workflows/deploy-pages.yml) queda "" congelado en el bundle — `??` solo cae al default
// con `null`/`undefined`, así que "" se habría quedado tal cual, convirtiendo cada petición en
// relativa contra el propio origen del sitio estático (`fetch("/auth/login")` en vez de contra la
// API real) y fallando con 405 en vez de con un error de red claro.
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

// Tokens en memoria (ver setTokens, llamado desde AuthContext al cargar la sesión guardada, al
// hacer login/registro y al cerrar sesión). Antes solo se guardaba `authToken` — el refreshToken
// se persistía en localStorage pero nunca llegaba aquí, así que en cuanto el access token (1h)
// caducaba, CADA petición de CADA tarjeta/página independiente fallaba con 401 y mostraba su
// propio "⚠️ Token inválido o expirado" (ver ErrorMessage/useFetch) — de ahí que saltara "cada
// dos por tres" en sesiones largas. Mismo patrón que ya tenía mobile/src/api/client.ts.
let authToken: string | null = null;
let refreshToken: string | null = null;
// Evita refrescar en paralelo si varias peticiones reciben 401 a la vez (p.ej. varias tarjetas de
// la página "Hoy" cargando a la vez) — todas esperan al mismo refresh en curso en vez de disparar
// uno cada una.
let refreshPromise: Promise<boolean> | null = null;

export function setTokens(token: string | null, newRefreshToken: string | null): void {
  authToken = token;
  refreshToken = newRefreshToken;
}

// Se rellena desde AuthContext (no al revés, para no crear un ciclo de imports client → context).
let onRefreshed: ((token: string, refreshToken: string) => void) | null = null;
let onAuthExpired: (() => void) | null = null;
export function setAuthCallbacks(handlers: { onRefreshed: (token: string, refreshToken: string) => void; onAuthExpired: () => void }): void {
  onRefreshed = handlers.onRefreshed;
  onAuthExpired = handlers.onAuthExpired;
}

// Endpoints de auth que NO requieren sesión previa — un 401 aquí es "credenciales inválidas" (o
// el token de verificación no vale), no "mi sesión caducó": nunca hay que intentar refrescar ni
// disparar onAuthExpired para estos, o un intento de login con contraseña equivocada acabaría
// mostrando "Sesión expirada" en vez del mensaje real del backend.
const UNAUTHENTICATED_AUTH_PATHS = ["/auth/login", "/auth/register", "/auth/refresh", "/auth/verify-email"];

async function tryRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        // fetchWithRetry, no fetch directo: un refresh que choca con el arranque en frío del
        // backend (ver comentario junto a fetchWithRetry, más abajo en este fichero) no debe
        // desloguear a nadie por un simple error de red transitorio.
        const response = await fetchWithRetry(`${API_URL}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
        if (!response.ok) return false;
        const body = (await response.json()) as { token: string; refreshToken: string };
        authToken = body.token;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// El backend (Render, plan free) se "duerme" tras ~15 min sin tráfico — hay un workflow
// (.github/workflows/keep-alive.yml) haciéndole ping cada 10 min para que casi nunca llegue a
// pasar, pero sigue habiendo una ventana (justo tras un deploy, o si ese workflow se retrasa)
// donde la primera petición choca con el contenedor arrancando y `fetch` falla con un error de
// red (no es un simple "está tardando": eso lo tolera fetch solo, sin timeout propio). En vez de
// enseñar directamente "¿Está corriendo el servidor?" por ese primer fallo transitorio,
// reintentamos un par de veces con una pausa corta — si de verdad está caído, el error se sigue
// mostrando igual, solo que unos segundos más tarde.
const NETWORK_RETRY_DELAYS_MS = [1000, 2500];

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      if (attempt >= NETWORK_RETRY_DELAYS_MS.length) throw err;
      await sleep(NETWORK_RETRY_DELAYS_MS[attempt]);
    }
  }
}

async function request<T>(path: string, options: RequestInit = {}, isRetry = false): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  let response: Response;
  try {
    response = await fetchWithRetry(`${API_URL}${path}`, { ...options, headers });
  } catch {
    throw new ApiError(`No se pudo conectar con la API en ${API_URL}. ¿Está corriendo el servidor?`, 0);
  }

  if (response.status === 401 && !isRetry && !UNAUTHENTICATED_AUTH_PATHS.includes(path)) {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, options, true);
    // El refresh token también caducó/es inválido (p.ej. tras varios días sin abrir la app): esta
    // vez sí es una sesión expirada de verdad — un único aviso limpio (ver onAuthExpired en
    // AuthContext, que desloguea) en vez de dejar que cada widget muestre la suya por su cuenta.
    authToken = null;
    refreshToken = null;
    onAuthExpired?.();
    throw new ApiError("Sesión expirada, inicia sesión de nuevo.", 401);
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
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `Error ${response.status}`;
    throw new ApiError(message, response.status);
  }

  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "POST", body: data !== undefined ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "PUT", body: data !== undefined ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
