import { createContext, useContext, useEffect, useState, ReactNode } from "react";

// Tamaño del texto (Ajustes → General → Apariencia, ver SettingsDialog.tsx) — mismo criterio que
// ThemeContext: este contexto solo decide CUÁL aplicar y lo persiste, el valor real vive en
// styles.css (`html[data-font-size="..."]`) como un `font-size` distinto en <html>. Como el resto
// del sistema de diseño usa unidades `rem` (los `text-*`/`p-*`/`gap-*`... de Tailwind), escalar el
// tamaño base de <html> escala con él TODA la interfaz de forma proporcional — texto, iconos,
// espaciados — en vez de solo agrandar las letras dejando el resto de la maquetación igual, que es
// el mismo criterio que sigue el zoom de texto del propio navegador o del sistema operativo.
export type FontSize = "normal" | "grande" | "xl";

export const FONT_SIZE_OPTIONS: { value: FontSize; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "grande", label: "Grande" },
  { value: "xl", label: "Muy grande" },
];

const STORAGE_KEY = "life-organizer:font-size";

function readStoredFontSize(): FontSize {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw && FONT_SIZE_OPTIONS.some((f) => f.value === raw) ? (raw as FontSize) : "normal";
  } catch {
    // Ver el mismo catch en ThemeContext: si localStorage falla, el tamaño por defecto no rompe
    // el arranque de la app.
    return "normal";
  }
}

interface FontSizeContextValue {
  fontSize: FontSize;
  setFontSize: (fontSize: FontSize) => void;
}

const FontSizeContext = createContext<FontSizeContextValue | undefined>(undefined);

export function FontSizeProvider({ children }: { children: ReactNode }) {
  const [fontSize, setFontSizeState] = useState<FontSize>(readStoredFontSize);

  // "normal" no pone `data-font-size` en <html> a propósito (igual que "sistema" en ThemeContext
  // no pone `data-theme`) — sin el atributo, styles.css no toca el `font-size` heredado del
  // navegador, así que "Normal" es siempre exactamente el tamaño de antes de que existiera este
  // ajuste.
  useEffect(() => {
    if (fontSize === "normal") {
      document.documentElement.removeAttribute("data-font-size");
    } else {
      document.documentElement.setAttribute("data-font-size", fontSize);
    }
  }, [fontSize]);

  const setFontSize = (next: FontSize) => {
    setFontSizeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ver readStoredFontSize: se sigue aplicando en esta sesión, solo no sobrevive a recargar.
    }
  };

  return <FontSizeContext.Provider value={{ fontSize, setFontSize }}>{children}</FontSizeContext.Provider>;
}

export function useFontSize(): FontSizeContextValue {
  const ctx = useContext(FontSizeContext);
  if (!ctx) throw new Error("useFontSize debe usarse dentro de <FontSizeProvider>");
  return ctx;
}
