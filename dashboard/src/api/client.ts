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

let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...options, headers });
  } catch {
    throw new ApiError(`No se pudo conectar con la API en ${API_URL}. ¿Está corriendo el servidor?`, 0);
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
