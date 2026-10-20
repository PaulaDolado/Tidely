import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { applyPalette, ColorPalette, PALETTES, Theme, THEME_OPTIONS } from "../theme";

export { THEME_OPTIONS };
export type { Theme };

// Cómo llega el tema a cada pantalla. React Native no tiene variables CSS como la web (donde cambiar
// `--color-primary` repinta toda la app), así que hay dos piezas:
// - Los estilos y tablas de color de nivel de módulo se crean con `themedStyles`/`themed` (theme.ts): se
//   recalculan solos la primera vez que se leen tras un cambio de paleta. Antes eran `StyleSheet.create` normales,
//   calculados una vez al importar el fichero con la paleta "sistema" clara, y con otro tema o en modo oscuro
//   quedaban colores mezclados.
// - App.tsx vuelve a montar las pantallas (con `paletteKey` como `key`) cuando cambia la paleta efectiva, para que
//   todas se pinten de nuevo, conservando la pantalla en la que estabas.
// Quien necesite reaccionar al tema dentro de un componente puede usar además `useTheme()`.
const STORAGE_KEY = "tidely:theme";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  colors: ColorPalette;
  // Para decidir cosas que no son un color de la paleta (p.ej. el estilo de la StatusBar nativa,
  // ver App.tsx): true en "oscuro"/"espresso", o en "sistema" cuando el dispositivo está en
  // oscuro — mismo criterio que decide qué paleta se aplica, un par de líneas más abajo.
  isDark: boolean;
  // Nombre de la paleta que se está viendo de verdad ("sistema" con el móvil en oscuro es "oscuro"). App.tsx lo usa
  // como `key` para volver a montar las pantallas cuando cambia, y que todas lean los colores nuevos.
  paletteKey: Theme;
  // ¿Elegir este tema cambiaría la paleta efectiva (y, por tanto, volvería a montar la app)?
  changesPalette: (next: Theme) => boolean;
}

// Únicos dos temas de fondo oscuro — "sistema" no está en esta lista porque su propio "modo
// oscuro" depende del sistema operativo (ver `isDark` más abajo), no es un valor fijo.
const DARK_THEMES: ReadonlySet<Theme> = new Set(["oscuro", "espresso"]);

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function effectivePalette(theme: Theme, systemScheme: string | null | undefined): Theme {
  return theme === "sistema" ? (systemScheme === "dark" ? "oscuro" : "sistema") : theme;
}

// Lo que una pantalla quiere recuperar después de que un cambio de tema vuelva a montar la app (ver App.tsx): que
// Ajustes siga abierto en Apariencia, o que el alta siga en el paso en el que estaba. Se guarda justo antes de cambiar
// el tema y se recoge (una sola vez) al montar de nuevo.
const keptAcrossThemeChange = new Map<string, unknown>();

export function keepAcrossThemeChange(key: string, value: unknown): void {
  keptAcrossThemeChange.set(key, value);
}

export function takeKeptAcrossThemeChange<T>(key: string): T | undefined {
  const value = keptAcrossThemeChange.get(key) as T | undefined;
  keptAcrossThemeChange.delete(key);
  return value;
}

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
  const paletteKey = effectivePalette(theme, systemScheme);
  const changesPalette = (next: Theme) => effectivePalette(next, systemScheme) !== paletteKey;

  const setTheme = (next: Theme) => {
    setThemeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {
      // Sin persistencia el tema se sigue aplicando el resto de esta sesión, solo no sobrevive a
      // cerrar y reabrir la app.
    });
  };

  return <ThemeContext.Provider value={{ theme, setTheme, colors, isDark, paletteKey, changesPalette }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme debe usarse dentro de <ThemeProvider>");
  return ctx;
}
