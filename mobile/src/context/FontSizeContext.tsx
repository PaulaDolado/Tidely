import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Tamaño del texto (Ajustes → Apariencia) — puerto de dashboard/src/context/FontSizeContext.tsx.
// La web escala <html> en rem y toda la interfaz sigue proporcionalmente; React Native no tiene
// un equivalente de "font-size del documento" que arrastre unidades relativas, así que aquí el
// `scale` se aplica por-Text vía el componente AppText (ver ../components/AppText.tsx) — cada
// `<Text>`/`<TextInput>` de la app importa ESE wrapper en vez del de "react-native" directamente
// (mismo nombre, `import { Text } from "../components/AppText"`, así no hace falta tocar el JSX
// de cada pantalla) y multiplica su `fontSize` ya calculado por este `scale`.
export type FontSize = "normal" | "grande" | "xl";

export const FONT_SIZE_OPTIONS: { value: FontSize; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "grande", label: "Grande" },
  { value: "xl", label: "Muy grande" },
];

// Mismos ratios que styles.css (112.5% / 125%) — ver el comentario de FONT_SIZE_OPTIONS.
export const FONT_SIZE_SCALE: Record<FontSize, number> = { normal: 1, grande: 1.125, xl: 1.25 };

const STORAGE_KEY = "tidely:fontSize";

function isValidFontSize(value: string | null): value is FontSize {
  return !!value && FONT_SIZE_OPTIONS.some((o) => o.value === value);
}

interface FontSizeContextValue {
  fontSize: FontSize;
  setFontSize: (fontSize: FontSize) => void;
  scale: number;
}

const FontSizeContext = createContext<FontSizeContextValue | undefined>(undefined);

export function FontSizeProvider({ children }: { children: ReactNode }) {
  const [fontSize, setFontSizeState] = useState<FontSize>("normal");

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (isValidFontSize(stored)) setFontSizeState(stored);
    });
    // Solo al montar, igual que ThemeContext — cambios posteriores pasan por setFontSize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setFontSize = (next: FontSize) => {
    setFontSizeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {
      // Sin persistencia se sigue aplicando el resto de esta sesión, solo no sobrevive a reabrir.
    });
  };

  return <FontSizeContext.Provider value={{ fontSize, setFontSize, scale: FONT_SIZE_SCALE[fontSize] }}>{children}</FontSizeContext.Provider>;
}

export function useFontSize(): FontSizeContextValue {
  const ctx = useContext(FontSizeContext);
  if (!ctx) throw new Error("useFontSize debe usarse dentro de <FontSizeProvider>");
  return ctx;
}
