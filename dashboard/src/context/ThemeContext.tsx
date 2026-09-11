import { createContext, useContext, useEffect, useState, ReactNode } from "react";

// 5 temas (Ajustes > General > Apariencia, ver SettingsDialog.tsx): "sistema" es el look actual
// de la app sin cambios (sigue el claro/oscuro del sistema operativo, ver el bloque
// `prefers-color-scheme` en styles.css); el resto son elecciones explícitas que ignoran el
// sistema operativo. Los valores de cada paleta viven en styles.css (`[data-theme="..."]`), no
// aquí — este contexto solo decide CUÁL aplicar y lo persiste, la definición de colores en sí es
// CSS puro para que cualquier clase Tailwind que ya use estos tokens (bg-primary,
// text-muted-foreground...) cambie sola sin tocar componentes.
export type Theme = "sistema" | "basico" | "oscuro" | "salvia" | "espresso";

export const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: "sistema", label: "Sistema" },
  { value: "basico", label: "Básico" },
  { value: "oscuro", label: "Oscuro" },
  { value: "salvia", label: "Salvia" },
  { value: "espresso", label: "Espresso" },
];

const STORAGE_KEY = "life-organizer:theme";

function readStoredTheme(): Theme {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw && THEME_OPTIONS.some((t) => t.value === raw) ? (raw as Theme) : "sistema";
  } catch {
    // localStorage puede fallar (modo privado estricto, cuota agotada...) — cae al tema por
    // defecto en vez de romper el arranque de la app por un ajuste de apariencia.
    return "sistema";
  }
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);

  // "sistema" no pone `data-theme` en <html> a propósito: sin el atributo, styles.css cae en la
  // paleta de :root (el look actual) o, si el sistema operativo está en oscuro, en el bloque
  // `@media (prefers-color-scheme: dark) { :root:not([data-theme]) {...} }` — quitar el atributo
  // entero (no ponerlo a "sistema") es lo que deja pasar esa media query.
  useEffect(() => {
    if (theme === "sistema") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", theme);
    }
  }, [theme]);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ver readStoredTheme: si localStorage no está disponible, el tema se sigue aplicando en
      // esta sesión, solo no sobrevive a un recargar.
    }
  };

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme debe usarse dentro de <ThemeProvider>");
  return ctx;
}
