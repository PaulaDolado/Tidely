import { ReactNode, useState } from "react";

// Diálogo modal y botón de borrado con confirmación, compartidos por las plantillas de las páginas
// personalizadas (hoy, el planificador de viajes y sus secciones). Mismo patrón que SettingsDialog:
// overlay fixed + tarjeta centrada.
export function DialogShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-foreground/50 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[90vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-3xl bg-card p-6 shadow-[var(--shadow-soft)] sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <h2 className="font-serif text-2xl">{title}</h2>
          <button type="button" onClick={onClose} title="Cerrar" className="cursor-pointer rounded-lg p-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function DeleteButton({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  // Confirmación "clic otra vez" (no window.confirm), igual que "Eliminar tarjeta"/"Eliminar página".
  const [confirming, setConfirming] = useState(false);
  return (
    <button
      type="button"
      onClick={() => (confirming ? onConfirm() : setConfirming(true))}
      onBlur={() => setConfirming(false)}
      className={`cursor-pointer self-start rounded-full px-4 py-2 text-xs transition-colors ${
        confirming ? "bg-destructive text-destructive-foreground" : "border border-border text-muted-foreground hover:text-destructive"
      }`}
    >
      {confirming ? "¿Confirmar eliminar?" : label}
    </button>
  );
}
