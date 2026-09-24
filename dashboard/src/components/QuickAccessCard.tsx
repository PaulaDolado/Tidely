import { FormEvent, useState } from "react";
import {
  QUICK_ACCESS_APPS,
  QuickAccessApp,
  openQuickAccessApp,
  CustomQuickAccessLink,
  loadCustomLinks,
  addCustomLink,
  editCustomLink,
  removeCustomLink,
  customLinkToApp,
  fetchFaviconFor,
  normalizeQuickAccessUrl,
} from "../utils/quickAccessApps";

// Solo local: qué apps mostrar es una preferencia de ESTE dispositivo (abrir la app de
// escritorio solo tiene sentido en el ordenador donde se hace clic), igual que el resto de
// preferencias de interfaz que ya viven en localStorage (sidebar colapsado, modo de vista del
// horario — ver AppShell/SchedulePage). Nada de esto se manda al backend.
const STORAGE_KEY = "life-organizer:quick-access";
const DEFAULT_IDS = ["whatsapp", "spotify", "github", "gitlab", "gmail", "teams"];

function loadSelectedIds(): string[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_IDS;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : DEFAULT_IDS;
  } catch {
    return DEFAULT_IDS;
  }
}

export function QuickAccessCard() {
  const [selectedIds, setSelectedIds] = useState<string[]>(loadSelectedIds);
  const [customLinks, setCustomLinks] = useState<CustomQuickAccessLink[]>(loadCustomLinks);
  const [editing, setEditing] = useState(false);

  const toggle = (id: string) => {
    const next = selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id];
    setSelectedIds(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  // Los enlaces personalizados no pasan por `selectedIds` (eso es solo para mostrar/ocultar del
  // catálogo fijo) — se añaden ya visibles, y se quitan borrándolos del todo en vez de ocultarlos.
  const handleAddCustomLink = (input: { label: string; url: string; emoji: string; faviconUrl?: string }) => {
    const link = addCustomLink(input);
    if (link) setCustomLinks((prev) => [...prev, link]);
    return link;
  };

  const handleEditCustomLink = (id: string, input: { label: string; url: string; emoji: string; faviconUrl: string }) => {
    const link = editCustomLink(id, input);
    if (link) setCustomLinks((prev) => prev.map((l) => (l.id === id ? link : l)));
    return link;
  };

  const handleRemoveCustomLink = (id: string) => {
    removeCustomLink(id);
    setCustomLinks((prev) => prev.filter((link) => link.id !== id));
  };

  const selectedApps = [
    ...QUICK_ACCESS_APPS.filter((app) => selectedIds.includes(app.id)),
    ...customLinks.map(customLinkToApp),
  ];

  return (
    <div className="rounded-3xl border border-primary/30 bg-primary/10 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-widest text-primary">🔗 Acceso rápido</h2>
        <button onClick={() => setEditing(true)} className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          Editar
        </button>
      </div>

      {selectedApps.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin apps seleccionadas todavía.</p>
      ) : (
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-5">
          {selectedApps.map((app) => (
            <button
              key={app.id}
              onClick={() => openQuickAccessApp(app)}
              title={app.appUrl ? `Abrir ${app.label} (app o web)` : `Abrir ${app.label} (web)`}
              className="flex cursor-pointer flex-col items-center gap-1.5 rounded-xl p-1.5 text-center transition-colors hover:bg-background/60"
            >
              <AppLogo app={app} size={11} />
              <span className="w-full truncate text-[10px] text-muted-foreground">{app.label}</span>
            </button>
          ))}
        </div>
      )}

      {editing && (
        <QuickAccessEditDialog
          selectedIds={selectedIds}
          onToggle={toggle}
          customLinks={customLinks}
          onAddCustomLink={handleAddCustomLink}
          onEditCustomLink={handleEditCustomLink}
          onRemoveCustomLink={handleRemoveCustomLink}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

// Logo oficial de la marca (ver quickAccessApps.ts) sobre una casilla de su color, en blanco —
// mismo tratamiento que un icono de acceso directo del sistema operativo. `size` en unidades de
// Tailwind (size-11 = 2.75rem, size-8 = 2rem), reutilizado en la tarjeta y en el diálogo de
// selección con dos tamaños distintos. Prioridad: `icon` (path de logo de marca del catálogo
// fijo) > `faviconUrl` (icono real sacado de la web al añadir/editar un enlace propio, ver
// fetchFaviconFor) > `emoji` (reserva si no hay ninguno de los dos, o si el favicon no carga —
// `imgFailed` se pone a true en el onError de la propia imagen, así que un dominio caído o sin
// favicon de verdad pese al 200 de /favicon.ico no deja la casilla en blanco).
function AppLogo({ app, size }: { app: QuickAccessApp; size: 8 | 11 }) {
  const [imgFailed, setImgFailed] = useState(false);
  const boxClass = size === 11 ? "size-11 rounded-2xl p-2" : "size-8 rounded-lg p-1.5";
  const showFavicon = !!app.faviconUrl && !imgFailed;

  return (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden ${boxClass}`} style={{ backgroundColor: app.color }}>
      {app.icon ? (
        <svg viewBox="0 0 24 24" fill="#fff" role="img" aria-label={app.label}>
          <path d={app.icon} />
        </svg>
      ) : showFavicon ? (
        <img
          src={app.faviconUrl}
          alt=""
          className="size-full rounded object-contain"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <span className={size === 11 ? "text-lg leading-none" : "text-sm leading-none"} role="img" aria-label={app.label}>
          {app.emoji}
        </span>
      )}
    </span>
  );
}

// Diálogo de selección — simple lista de checkboxes sobre el catálogo fijo (ver
// quickAccessApps.ts), mismo estilo de diálogo modal que el resto de la app (fixed inset-0 +
// panel rounded-3xl).
function QuickAccessEditDialog({
  selectedIds,
  onToggle,
  customLinks,
  onAddCustomLink,
  onEditCustomLink,
  onRemoveCustomLink,
  onClose,
}: {
  selectedIds: string[];
  onToggle: (id: string) => void;
  customLinks: CustomQuickAccessLink[];
  onAddCustomLink: (input: { label: string; url: string; emoji: string; faviconUrl?: string }) => CustomQuickAccessLink | null;
  onEditCustomLink: (
    id: string,
    input: { label: string; url: string; emoji: string; faviconUrl: string }
  ) => CustomQuickAccessLink | null;
  onRemoveCustomLink: (id: string) => void;
  onClose: () => void;
}) {
  // Qué enlace se está editando ahora mismo (o null): el mismo AddCustomLinkForm de abajo hace de
  // formulario de edición cuando no es null, precargado con sus datos — así no hace falta
  // duplicar el formulario entero por cada fila de la lista.
  const [editingLink, setEditingLink] = useState<CustomQuickAccessLink | null>(null);

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-3xl bg-card p-6 shadow-[var(--shadow-soft)]">
        <div className="mb-1 flex items-center justify-between gap-4">
          <h3 className="font-serif text-xl">Acceso rápido</h3>
          <button type="button" onClick={onClose} className="shrink-0 cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            ✕ Cerrar
          </button>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">Elige qué apps quieres ver como accesos directos en "Hoy".</p>

        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {QUICK_ACCESS_APPS.map((app) => (
            <li key={app.id}>
              <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-muted">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(app.id)}
                  onChange={() => onToggle(app.id)}
                  className="size-4 shrink-0 cursor-pointer accent-primary"
                />
                <AppLogo app={app} size={8} />
                <span className="min-w-0 flex-1 truncate text-sm">{app.label}</span>
              </label>
            </li>
          ))}
        </ul>

        <div className="my-4 border-t border-border" />

        <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Tus enlaces</p>

        {customLinks.length > 0 && (
          <ul className="mb-3 max-h-40 space-y-1 overflow-y-auto">
            {customLinks.map((link) => (
              <li
                key={link.id}
                className={`flex items-center gap-3 rounded-xl px-2 py-2 ${editingLink?.id === link.id ? "bg-primary/10" : ""}`}
              >
                <AppLogo app={customLinkToApp(link)} size={8} />
                <span className="min-w-0 flex-1 truncate text-sm">{link.label}</span>
                <button
                  type="button"
                  title="Editar enlace"
                  onClick={() => setEditingLink(link)}
                  className="shrink-0 cursor-pointer rounded p-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  ✎
                </button>
                <button
                  type="button"
                  title="Eliminar enlace"
                  onClick={() => {
                    onRemoveCustomLink(link.id);
                    if (editingLink?.id === link.id) setEditingLink(null);
                  }}
                  className="shrink-0 cursor-pointer rounded p-1 text-xs text-muted-foreground hover:text-destructive"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        <AddCustomLinkForm
          key={editingLink?.id ?? "new"}
          editingLink={editingLink}
          onAdd={onAddCustomLink}
          onEdit={onEditCustomLink}
          onCancelEdit={() => setEditingLink(null)}
        />
      </div>
    </div>
  );
}

// Formulario para añadir un enlace propio (o editar uno ya guardado, si `editingLink` viene
// relleno — ver QuickAccessEditDialog, que remonta este componente con `key` distinta al cambiar
// de objetivo, así que las líneas de abajo solo necesitan precargar sus valores INICIALES, sin
// sincronizarlos aparte): nombre, URL (se normaliza en normalizeQuickAccessUrl — admite que el
// usuario no ponga "https://") y un emoji opcional. Al guardar, se pide el favicon real del sitio
// a GET /link-preview (fetchFaviconFor) ANTES de llamar a onAdd/onEdit — nunca en cada tecla
// escrita, solo una vez al enviar — y si no se consigue ninguno (sitio caído, sin favicon,
// timeout...) se guarda igual, sin icono real, con el emoji de reserva de siempre.
function AddCustomLinkForm({
  editingLink,
  onAdd,
  onEdit,
  onCancelEdit,
}: {
  editingLink: CustomQuickAccessLink | null;
  onAdd: (input: { label: string; url: string; emoji: string; faviconUrl?: string }) => CustomQuickAccessLink | null;
  onEdit: (id: string, input: { label: string; url: string; emoji: string; faviconUrl: string }) => CustomQuickAccessLink | null;
  onCancelEdit: () => void;
}) {
  const [label, setLabel] = useState(editingLink?.label ?? "");
  const [url, setUrl] = useState(editingLink?.url ?? "");
  const [emoji, setEmoji] = useState(editingLink?.emoji ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    // Se normaliza ANTES de pedir el favicon: el placeholder del campo anima a escribir la URL
    // sin esquema ("notion.so/mi-pagina"), y GET /link-preview exige una URL completa (http/https)
    // — sin esto, fetchFaviconFor recibía "notion.so/mi-pagina" tal cual, el backend la rechazaba
    // con 400 y el favicon nunca se sacaba en el caso más común.
    const normalizedUrl = normalizeQuickAccessUrl(url);
    if (!label.trim() || !normalizedUrl) {
      setError("Pon un nombre y una URL válida (p. ej. notion.so/mi-pagina).");
      return;
    }

    setSaving(true);
    // Solo se vuelve a pedir el favicon si la URL cambió de verdad — si se está editando un
    // enlace y la URL es la misma de antes, no tiene sentido repetir la búsqueda (el favicon
    // guardado ya sigue siendo válido).
    const faviconUrl =
      editingLink && editingLink.url === normalizedUrl ? editingLink.faviconUrl ?? "" : await fetchFaviconFor(normalizedUrl);

    const link = editingLink
      ? onEdit(editingLink.id, { label, url, emoji, faviconUrl })
      : onAdd({ label, url, emoji, ...(faviconUrl ? { faviconUrl } : {}) });

    setSaving(false);
    if (!link) {
      setError("Pon un nombre y una URL válida (p. ej. notion.so/mi-pagina).");
      return;
    }
    if (editingLink) {
      onCancelEdit();
    } else {
      setLabel("");
      setUrl("");
      setEmoji("");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2 rounded-xl border border-dashed border-primary/30 bg-primary/5 p-3">
      {editingLink && (
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-primary">Editando "{editingLink.label}"</p>
          <button type="button" onClick={onCancelEdit} className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            Cancelar
          </button>
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={emoji}
          onChange={(e) => setEmoji(e.target.value)}
          placeholder="🔗"
          maxLength={4}
          title="Icono (emoji) de reserva — opcional, se usa si no se encuentra el icono real del sitio"
          aria-label="Icono (emoji) de reserva, opcional"
          className="w-12 shrink-0 rounded-lg border border-border bg-background px-2 py-2 text-center text-sm outline-none focus:border-primary"
        />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Nombre"
          aria-label="Nombre del enlace"
          className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
      </div>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="URL (p. ej. notion.so/mi-pagina)"
        aria-label="URL del enlace"
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <button
        type="submit"
        disabled={saving}
        className="w-full cursor-pointer rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {saving ? "Buscando icono…" : editingLink ? "Guardar cambios" : "+ Añadir enlace"}
      </button>
    </form>
  );
}
