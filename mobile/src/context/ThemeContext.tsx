import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { applyPalette, ColorPalette, PALETTES, Theme, THEME_OPTIONS } from "../theme";

export { THEME_OPTIONS };
export type { Theme };

// Nota sobre alcance: React Native no tiene el equivalente de las variables CSS del dashboard
// (donde cambiar `--color-primary` en styles.css repinta TODA la app sin tocar componentes) — la
// mayoría de pantallas de mobile/ definen sus estilos con `StyleSheet.create({...})` a nivel de
// módulo, leyendo `colors.x` UNA sola vez cuando ese fichero se importa por primera vez, así que
// mutar el objeto `colors` de theme.ts no les llega. Este contexto SÍ es reactivo de verdad (usa
// React state, no solo mutación) para quien lo consuma con el hook `useTheme()` — de momento
// App.tsx (pantalla de carga + StatusBar) y AppSidebar.tsx (el menú, visible en toda la app). El
// resto de pantallas (Hoy, Agenda, Planificador...) siguen leyendo el `colors` estático de
// theme.ts hasta que se les aplique el mismo cambio (mover su `StyleSheet.create` dentro del
// componente y construirlo con `useTheme().colors` — mecánico, pendiente).
const STORAGE_KEY = "tidely:theme";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  colors: ColorPalette;
  // Para decidir cosas que no son un color de la paleta (p.ej. el estilo de la StatusBar nativa,
  // ver App.tsx): true en "oscuro"/"espresso", o en "sistema" cuando el dispositivo está en
  // oscuro — mismo criterio que decide qué paleta se aplica, un par de líneas más abajo.
  isDark: boolean;
}

// Únicos dos temas de fondo oscuro — "sistema" no está en esta lista porque su propio "modo
// oscuro" depende del sistema operativo (ver `isDark` más abajo), no es un valor fijo.
const DARK_THEMES: ReadonlySet<Theme> = new Set(["oscuro", "espresso"]);

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function isValidTheme(value: string | null): value is Theme {
  return !!value && THEME_OPTIONS.some((t) => t.value === value);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme(); // "light" | "dark" | null
  const [theme, setThemeState] = useState<Theme>("sistema");

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (isValidTheme(stored)) setThemeState(stored);
    });
    // Solo al montar: cargar la preferencia guardada una vez. Cambios posteriores pasan por
    // `setTheme`, que ya actualiza el estado directamente sin necesidad de releer storage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const colors = useMemo<ColorPalette>(() => {
    const palette = theme === "sistema" ? (systemScheme === "dark" ? PALETTES.oscuro : PALETTES.sistema) : PALETTES[theme];
    // `theme.ts` sigue exportando `colors` como objeto mutable para las pantallas que todavía no
    // usan este contexto (ver nota de cabecera) — se mantiene sincronizado con la paleta efectiva
    // aquí mismo, así que en cuanto una pantalla se convierta a `useTheme()` no hay que tocar nada
    // más en theme.ts.
    applyPalette(palette);
    return palette;
  }, [theme, systemScheme]);

  const isDark = theme === "sistema" ? systemScheme === "dark" : DARK_THEMES.has(theme);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {
      // Sin persistencia el tema se sigue aplicando el resto de esta sesión, solo no sobrevive a
      // cerrar y reabrir la app.
    });
  };

  return <ThemeContext.Provider value={{ theme, setTheme, colors, isDark }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme debe usarse dentro de <ThemeProvider>");
  return ctx;
}
