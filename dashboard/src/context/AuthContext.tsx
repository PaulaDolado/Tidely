import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import { api, setAuthCallbacks, setTokens } from "../api/client";
import { AuthResponse, User } from "../types";

const STORAGE_KEY = "life-organizer:auth";

interface StoredAuth {
  token: string;
  refreshToken: string;
  user: User;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  error: string | null;
  login: (identifier: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string, name: string, timezone?: string) => Promise<void>;
  logout: () => void;
  // No llama a la API — solo sincroniza React state + localStorage con un perfil ya guardado en
  // el backend (ver ProfileDialog: hace el PUT /auth/me ella misma y luego llama a esto). Deja
  // token/refreshToken intactos, a diferencia de `persist` (que se usa solo en login/register).
  // El resto de la app (p.ej. el pie de la barra lateral, ver AppShell) lee siempre `user` de
  // este contexto, así que cualquier llamada a `updateUser` se refleja ahí al instante.
  updateUser: (patch: Partial<User>) => void;
  resendVerification: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function loadStoredAuth(): StoredAuth | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredAuth;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Conecta el cliente HTTP con este contexto (setTokens/setAuthCallbacks viven en api/client.ts,
  // no al revés, para no crear un ciclo de imports) — antes de cualquier petición, así que ya
  // está listo cuando el efecto de abajo hace su primer `api.get`. Sin esto, el cliente nunca
  // sabía el refreshToken (solo se guardaba en localStorage, nunca se leía de vuelta): en cuanto
  // el access token de 1h caducaba, CADA petición de CADA tarjeta/página fallaba con su propio
  // 401 y su propio "⚠️ Token inválido o expirado" en vez de refrescarse en silencio — de ahí que
  // saltara "cada dos por tres" en sesiones largas.
  useEffect(() => {
    setAuthCallbacks({
      onRefreshed: (token, newRefreshToken) => {
        const stored = loadStoredAuth();
        if (stored) localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...stored, token, refreshToken: newRefreshToken }));
      },
      // Solo llega hasta aquí si el REFRESH token también falló (p.ej. varios días sin abrir la
      // app) — ahí sí toca cerrar sesión de verdad, una sola vez y con un aviso claro en vez de
      // los N banners sueltos de antes.
      onAuthExpired: () => {
        localStorage.removeItem(STORAGE_KEY);
        setUser(null);
        setError("Tu sesión ha expirado. Inicia sesión de nuevo.");
      },
    });
  }, []);

  useEffect(() => {
    const stored = loadStoredAuth();
    if (!stored) return;
    setTokens(stored.token, stored.refreshToken);
    setUser(stored.user); // primero la caché, para pintar algo sin esperar a la red

    // localStorage es solo una caché de arranque rápido, NO la fuente de verdad: si el perfil
    // se editó desde otra sesión/dispositivo (o si un `updateUser()` de aquí se quedó
    // desincronizado del backend por lo que sea), sin este refresco esa copia vieja se queda
    // pegada indefinidamente — nunca se corrige sola con un simple recargar la página. Best
    // effort: si falla (sin red...) no pasa nada; si falla por un 401, el cliente ya intenta
    // refrescar solo (ver api/client.ts) y solo dispara onAuthExpired si el refresh también falla.
    api
      .get<User>("/auth/me")
      .then((freshUser) => {
        setUser(freshUser);
        // OJO: NO reusar el `stored` de arriba aquí — si esta misma petición disparó un refresh
        // (401 → onRefreshed ya escribió el token nuevo en localStorage), `stored` sigue siendo
        // la instantánea de ANTES de esa petición, con el token/refreshToken viejos. Volver a leer
        // ahora evita pisar ese token nuevo con uno caducado (justo lo que causaba que, tras
        // refrescar en silencio, el siguiente `reload()` de la página siguiera leyendo el token
        // corrupto/caducado de localStorage y disparara otro 401 de inmediato).
        const current = loadStoredAuth() ?? stored;
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, user: freshUser }));
      })
      .catch(() => {});
  }, []);

  const persist = (auth: AuthResponse) => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ token: auth.token, refreshToken: auth.refreshToken, user: auth.user })
    );
    setTokens(auth.token, auth.refreshToken);
    setUser(auth.user);
  };

  const login = useCallback(async (identifier: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.post<AuthResponse>("/auth/login", { identifier, password });
      persist(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al iniciar sesión");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const register = useCallback(async (username: string, email: string, password: string, name: string, timezone?: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.post<AuthResponse>("/auth/register", { username, email, password, name, timezone });
      persist(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al registrarse");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setTokens(null, null);
    setUser(null);
  }, []);

  const updateUser = useCallback((patch: Partial<User>) => {
    const stored = loadStoredAuth();
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      if (stored) localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...stored, user: next }));
      return next;
    });
  }, []);

  const resendVerification = useCallback(async () => {
    await api.post("/auth/resend-verification", {});
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, error, login, register, logout, updateUser, resendVerification }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}
