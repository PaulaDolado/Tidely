import * as SecureStore from "expo-secure-store";
import { AuthResponse, User } from "../types";

// Persistencia de sesión en el almacén seguro del dispositivo (Keychain en iOS, Keystore en
// Android) — nunca en AsyncStorage ni en SQLite, que no están cifrados. Equivalente móvil de
// `dashboard/src/context/AuthContext.tsx`, que usa `localStorage` (aceptable ahí porque es un
// navegador de escritorio, no el caso aquí).
// `SecureStore` solo admite claves alfanuméricas más ".", "-" y "_" (nada de ":") — con ":" lanza
// "Invalid key provided to SecureStore" en cuanto se llama, y como `loadStoredAuth()` se invoca
// sin `.catch()` en el `useEffect` de arranque de `AuthContext`, la promesa rechazada deja
// `ready` en `false` para siempre: la app se queda colgada en el spinner de carga. Encontrado al
// probar por primera vez en un emulador Android real (Fase 1 nunca se había probado end-to-end).
const TOKEN_KEY = "life-organizer.token";
const REFRESH_TOKEN_KEY = "life-organizer.refreshToken";
const USER_KEY = "life-organizer.user";

export interface StoredAuth {
  token: string;
  refreshToken: string;
  user: User;
}

export async function loadStoredAuth(): Promise<StoredAuth | null> {
  const [token, refreshToken, userRaw] = await Promise.all([
    SecureStore.getItemAsync(TOKEN_KEY),
    SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
    SecureStore.getItemAsync(USER_KEY),
  ]);
  if (!token || !refreshToken || !userRaw) return null;
  try {
    return { token, refreshToken, user: JSON.parse(userRaw) as User };
  } catch {
    return null;
  }
}

export async function persistAuth(auth: AuthResponse): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(TOKEN_KEY, auth.token),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, auth.refreshToken),
    SecureStore.setItemAsync(USER_KEY, JSON.stringify(auth.user)),
  ]);
}

/** Solo actualiza los tokens (tras un refresh) — el usuario no cambia. */
export async function persistTokens(token: string, refreshToken: string): Promise<void> {
  await Promise.all([SecureStore.setItemAsync(TOKEN_KEY, token), SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken)]);
}

/** Solo actualiza el usuario guardado (tras updateUser) — los tokens no cambian. Sin esto, un
 * parche aplicado en memoria (onboarding, diseño del menú...) se perdería al reabrir la app: el
 * siguiente `loadStoredAuth()` devolvería la versión vieja guardada en el login/registro. */
export async function persistUser(user: User): Promise<void> {
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
}

export async function clearAuth(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    SecureStore.deleteItemAsync(USER_KEY),
  ]);
}
