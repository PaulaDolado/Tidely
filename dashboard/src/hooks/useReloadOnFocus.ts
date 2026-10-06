import { useEffect, useRef } from "react";

// Mínimo entre dos recargas: al volver a la ventana pueden dispararse `visibilitychange` y `focus`
// casi a la vez, y no hace falta pedir lo mismo dos veces.
const MIN_INTERVAL_MS = 2000;

/**
 * Vuelve a cargar los datos de una pantalla cuando el usuario regresa a ella (cambia de pestaña del
 * navegador o de ventana y vuelve). Sin esto, una pantalla que se queda abierta (Hoy, Agenda)
 * muestra lo que había al abrirla hasta que se recarga a mano — p. ej. no verías en "Entradas
 * recientes" lo que acabas de escribir en una libreta desde otra pestaña o desde el móvil.
 * Equivalente web de `useFocusEffect` en el móvil.
 */
export function useReloadOnFocus(reload: () => void | Promise<void>): void {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const lastRunRef = useRef(Date.now());

  useEffect(() => {
    const run = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRunRef.current < MIN_INTERVAL_MS) return;
      lastRunRef.current = now;
      void reloadRef.current();
    };
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", run);
    return () => {
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", run);
    };
  }, []);
}
