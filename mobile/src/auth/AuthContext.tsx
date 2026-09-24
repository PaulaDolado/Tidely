import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from "react";
import { api, setTokens, setAuthCallbacks } from "../api/client";
import { loadStoredAuth, persistAuth, persistTokens, persistUser, clearAuth } from "./storage";
import { AuthResponse, User } from "../types";

interface AuthContextValue {
  user: User | null;
  ready: boolean; // true una vez se comprobó si había una sesión guardada (evita parpadeo Login→Hoy)
  loading: boolean;
  error: string | null;
  login: (identifier: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string, name: string, timezone?: string) => Promise<void>;
  logout: () => Promise<void>;
  // Parchea el usuario en memoria tras un PUT que ya confirmó el cambio en el backend (onboarding,
  // diseño/orden del menú...) — mismo criterio que dashboard/src/context/AuthContext.tsx: no relee
  // /auth/me entero, solo mezcla lo que ya se sabe que cambió.
  updateUser: (patch: Partial<User>) => void;
  resendVerification: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Evita el warning de React al hacer setUser desde un callback que puede seguir vivo tras
  // desmontar (poco probable en la raíz de la app, pero barato de evitar).
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);

  useEffect(() => {
    // Si el refresh automático del cliente HTTP consigue tokens nuevos, o si falla del todo
    // (refresh token también caducado), hay que reflejarlo aquí — es la única fuente de verdad
    // de "hay sesión o no" para el resto de la app.
    setAuthCallbacks({
      onRefreshed: (token, refreshToken) => {
        void persistTokens(token, refreshToken);
      },
      onAuthExpired: () => {
        void clearAuth();
        if (mounted.current) setUser(null);
      },
    });

    loadStoredAuth().then((stored) => {
      if (stored) {
        setTokens(stored.token, stored.refreshToken);
        if (mounted.current) setUser(stored.user);
      }
      if (mounted.current) setReady(true);
    });
  }, []);

  const applyAuth = (auth: AuthResponse) => {
    setTokens(auth.token, auth.refreshToken);
    setUser(auth.user);
  };

  const login = useCallback(async (identifier: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      // El backend espera `identifier` (busca por username O email, ver authService.login) — no
      // `email`. Con el nombre de campo equivocado, TODO intento de login desde el móvil fallaba
      // con 400 "identifier is required", encontrado al alinear esta pantalla con el dashboard
      // (que sí manda `identifier`, ver dashboard/src/context/AuthContext.tsx).
      const result = await api.post<AuthResponse>("/auth/login", { identifier, password });
      await persistAuth(result);
      applyAuth(result);
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
      await persistAuth(result);
      applyAuth(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al registrarse");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    // Avisa al backend para que revoque ESTE refresh token (ver POST /auth/logout) — sin esto
    // seguiría siendo válido hasta que caduque por sí solo (hasta 7 días). Best-effort: la sesión
    // local se limpia igual aunque la petición falle (sin red, backend caído...), lo importante
    // para quien cierra sesión es que ESTE dispositivo deja de estar logueado ya mismo.
    const stored = await loadStoredAuth();
    if (stored?.refreshToken) {
      api.post("/auth/logout", { refreshToken: stored.refreshToken }).catch(() => {});
    }
    await clearAuth();
    setTokens(null, null);
    setUser(null);
  }, []);

  const updateUser = useCallback((patch: Partial<User>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      void persistUser(next);
      return next;
    });
  }, []);

  // El propio email de verificación siempre apunta a la página web (dashboard/src/pages/
  // VerifyEmailPage.tsx) sin importar desde qué cliente se pidió reenviarlo — confirmar un email
  // es una acción sin estado que no necesita una pantalla propia en el móvil, solo este botón de
  // "reenviar" (ver AccountSettings.tsx). El siguiente /auth/me (o login) ya recoge
  // `emailVerified: true` una vez confirmado desde el navegador.
  const resendVerification = useCallback(async () => {
    await api.post("/auth/resend-verification", {});
  }, []);

  return (
    <AuthContext.Provider value={{ user, ready, loading, error, login, register, logout, updateUser, resendVerification }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}
