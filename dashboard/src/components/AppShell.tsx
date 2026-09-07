import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useFetch } from "../hooks/useFetch";
import { api, ApiError } from "../api/client";
import { ProfileDialog } from "./ProfileDialog";
import { AgendaResponse, CustomPageSummary, CustomPageTemplate, Notification, SearchResults } from "../types";
import { CUSTOM_PAGE_TEMPLATES } from "../utils/customPageTemplates";
import clipClosedUrl from "../assets/clipClosed.png";
import clipOpenUrl from "../assets/clipOpen.png";

export type StaticTab =
  | "hoy"
  | "agenda"
  | "planificador"
  | "horario"
  | "metas"
  | "finanzas"
  | "finanzas-ahorro"
  | "proyectos";
// Pestaña de una página personalizada ("+ Nueva página", ver CreatePageModal más abajo) —
// codifica el id directamente en el string en vez de llevar un id de pestaña + un id de página
// por separado, así activeTab (un simple useState en DashboardPage) sigue siendo la única fuente
// de verdad de "qué se ve ahora mismo", igual que con las pestañas estáticas.
export type CustomTabId = `custom-${number}`;
export type Tab = StaticTab | CustomTabId;

export function customPageTab(id: number): CustomTabId {
  return `custom-${id}`;
}

export function parseCustomPageTab(tab: Tab): number | null {
  const match = /^custom-(\d+)$/.exec(tab);
  return match ? Number(match[1]) : null;
}

// A dónde navegar y qué destacar al hacer clic en un resultado de búsqueda global — cada página
// destino decide qué hacer con `id` (abrir el diálogo, expandir la tarjeta, etc.) y llama a
// `onFocusHandled` cuando ya lo ha consumido, para no repetirlo en cada re-render.
export interface SearchFocus {
  type: "event" | "task" | "note" | "project";
  id: number;
  startTime?: string; // solo eventos: para saltar a la semana correcta antes de abrir el diálogo
  plannerId?: number; // solo tareas: a qué tablero saltar antes de poder centrar la tarjeta (ver Planner)
}

interface NavItem {
  key: Tab;
  label: string;
  children?: NavItem[];
}

const NAV: NavItem[] = [
  { key: "hoy", label: "Hoy" },
  {
    key: "agenda",
    label: "Agenda",
    children: [
      { key: "planificador", label: "Planificador" },
      { key: "horario", label: "Horario" },
    ],
  },
  { key: "metas", label: "Objetivos" },
  {
    key: "finanzas",
    label: "Finanzas",
    children: [{ key: "finanzas-ahorro", label: "Metas de ahorro" }],
  },
  { key: "proyectos", label: "Proyectos" },
];

// Nav aplanado — para el menú horizontal en móvil, donde anidar no tiene mucho sitio.
const FLAT_NAV: NavItem[] = NAV.flatMap((item) => [item, ...(item.children ?? [])]);

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

interface AppShellProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  onSearchNavigate: (tab: Tab, focus: SearchFocus) => void;
  // Páginas personalizadas del usuario y sus acciones — ver DashboardPage, que es quien las
  // carga (una sola vez, GET /custom-pages) y las mantiene en sync tanto para el menú de aquí
  // como para saber qué plantilla renderizar cuando activeTab es una de ellas.
  customPages: CustomPageSummary[];
  onCreateCustomPage: (title: string, template: CustomPageTemplate) => Promise<void>;
  onRenameCustomPage: (id: number, title: string) => Promise<void>;
  onDeleteCustomPage: (id: number) => Promise<void>;
  // "Galería" es un apartado del menú principal (como Hoy/Agenda/...), pero por debajo sigue
  // siendo una página personalizada de plantilla "galeria" — este callback busca la del usuario
  // (o la crea si es la primera vez) y navega a ella; nunca hay más de una, así que a diferencia
  // de onCreateCustomPage no hace falta pedir título/plantilla (ver DashboardPage.openGallery).
  onOpenGallery: () => Promise<void>;
  children: ReactNode;
}

const SIDEBAR_COLLAPSED_KEY = "life-organizer:sidebar-collapsed";
const SIDEBAR_WIDTH_KEY = "life-organizer:sidebar-width";
// Igual criterio que NAV_COLLAPSED_SECTIONS_KEY más abajo, pero para la única cajita "Próximo
// evento" — no vive en `collapsedSections` (eso es un Set de `Tab`, y esto no es una pestaña del
// menú) sino en su propio booleano persistido aparte.
const NEXT_EVENT_COLLAPSED_KEY = "life-organizer:sidebar-next-event-collapsed";
// Qué apartados con subapartados (Agenda, Finanzas) tiene el usuario plegados — independiente de
// SIDEBAR_COLLAPSED_KEY, que esconde el menú entero: esto solo oculta los hijos de un apartado
// concreto, para poder ver la lista sin que "Planificador"/"Horario"/"Metas de ahorro" ocupen
// sitio si no se usan. Se guarda como array de `Tab` (JSON) — solo los que tienen `children`
// llegan a estar aquí, ver toggleSection.
const NAV_COLLAPSED_SECTIONS_KEY = "life-organizer:nav-collapsed-sections";
const DEFAULT_SIDEBAR_WIDTH = 288; // w-72, el ancho original
const MAX_SIDEBAR_WIDTH = 480;
// Padding horizontal del <aside> (p-8 = 2rem por lado) que hay que sumar al ancho del texto.
const SIDEBAR_PADDING_X = 64;

// Foto real del clip (ver botón de esconder/mostrar el menú) — clipClosed.png cuando el menú
// está desplegado (el clip "sujeta" la barra lateral, ver comentario junto al botón), clipOpen.png
// cuando está colapsado (no hay "papel" que sujetar). Ancho de render fijo; el alto sale solo de
// mantener la proporción real de cada imagen (293x197 y 264x131 respectivamente).
const CLIP_CLOSED_WIDTH = 72;

export function AppShell({
  activeTab,
  onTabChange,
  onSearchNavigate,
  customPages,
  onCreateCustomPage,
  onRenameCustomPage,
  onDeleteCustomPage,
  onOpenGallery,
  children,
}: AppShellProps) {
  const { user, logout } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const [showCreatePage, setShowCreatePage] = useState(false);
  const [renamingPageId, setRenamingPageId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmingDeletePageId, setConfirmingDeletePageId] = useState<number | null>(null);
  const [nextEventCollapsed, setNextEventCollapsed] = useState(() => localStorage.getItem(NEXT_EVENT_COLLAPSED_KEY) === "true");
  const { data: week } = useFetch(() => api.get<AgendaResponse>(`/agenda/week/${todayIso()}`), []);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true");
  const [collapsedSections, setCollapsedSections] = useState<Set<Tab>>(() => {
    try {
      const raw = localStorage.getItem(NAV_COLLAPSED_SECTIONS_KEY);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    return stored > 0 ? stored : DEFAULT_SIDEBAR_WIDTH;
  });
  // Ancho mínimo = el que ocupa el apartado más largo sin cortarse, medido de verdad en el DOM
  // (ver measureRef más abajo) en vez de un número fijo — así si cambian las etiquetas del menú,
  // el mínimo se sigue ajustando solo.
  const [minWidth, setMinWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const measureRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef(false);

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      return next;
    });
  };

  const toggleNextEventCollapsed = () => {
    setNextEventCollapsed((v) => {
      const next = !v;
      localStorage.setItem(NEXT_EVENT_COLLAPSED_KEY, String(next));
      return next;
    });
  };

  // Pliega/despliega los subapartados de UN item del menú (Agenda, Finanzas) — el propio item
  // sigue siendo clicable para navegar a su página (ver el botón de abajo), esto solo afecta a
  // si sus `children` se ven o no.
  const toggleSection = (key: Tab) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      localStorage.setItem(NAV_COLLAPSED_SECTIONS_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  // Mide el ancho natural (sin cortar) del apartado más largo del menú.
  useEffect(() => {
    const measure = () => {
      if (!measureRef.current) return;
      const width = Math.ceil(measureRef.current.scrollWidth) + SIDEBAR_PADDING_X;
      setMinWidth(width);
      setSidebarWidth((w) => Math.max(w, width));
    };
    measure();
    // Las fuentes (Outfit, vía Google Fonts) pueden tardar en cargar; re-medir cuando estén
    // listas evita que el mínimo se calcule corto con la fuente de reserva del sistema.
    document.fonts?.ready?.then(measure).catch(() => {});
  }, []);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      setSidebarWidth(Math.min(MAX_SIDEBAR_WIDTH, Math.max(minWidth, e.clientX)));
    };
    const onMouseUp = () => {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setSidebarWidth((w) => {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(w));
        return w;
      });
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [minWidth]);

  const now = Date.now();
  const next = week?.events
    .filter((e) => new Date(e.startTime).getTime() >= now)
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())[0];

  // La galería del usuario nunca son varias — si ya existe una página "galeria" es siempre ESTA
  // (ver DashboardPage.openGallery, que reutiliza la primera que encuentra en vez de crear otra).
  // El resto de `customPages` ("Tus páginas" más abajo) la excluye explícitamente: ya tiene su
  // propio hueco en el menú principal, listarla también ahí sería un duplicado.
  const galleryPage = customPages.find((p) => p.template === "galeria") ?? null;
  const galleryTab = galleryPage ? customPageTab(galleryPage.id) : null;
  const otherPages = customPages.filter((p) => p.template !== "galeria");

  return (
    <div className="flex min-h-screen bg-background font-sans text-foreground">
      {/* Clon invisible del nav, sin ancho forzado, solo para medir cuánto ocupa el apartado
          más largo sin cortarse (measureRef.current.scrollWidth en el efecto de arriba). */}
      <div ref={measureRef} aria-hidden className="invisible fixed left-0 top-0 -z-10 flex w-max flex-col items-start gap-1">
        {NAV.map((item) => (
          <div key={item.key} className="flex w-full flex-col items-start gap-1">
            <span className="whitespace-nowrap rounded-lg px-3 py-2 text-left font-medium">{item.label}</span>
            {item.children && (
              <div className="ml-3 flex flex-col items-start gap-1 border-l border-border pl-3">
                {item.children.map((child) => (
                  <span key={child.key} className="whitespace-nowrap rounded-lg px-3 py-1.5 text-left text-sm font-medium">
                    {child.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="hidden shrink-0 lg:flex">
        {!collapsed && (
          <div className="relative shrink-0" style={{ width: sidebarWidth }}>
            {/* Antes esto era un único flex-col con gap-10 y p-8 uniforme, todo dentro del mismo
                `h-screen` sin scroll propio — con pocas páginas personalizadas nunca se notaba,
                pero según se van creando más, la lista de "Tus páginas" puede llegar a empujar
                "Próximo evento" y el usuario/logout por debajo del alto de pantalla (el `<aside>`
                no tiene scroll, así que quedarían cortados, no solo desplazados). Ahora son 3
                franjas apiladas: cabecera fija (Tidely + buscador), una franja central que es la
                ÚNICA con scroll propio (el menú + Tus páginas, lo que crece sin límite) y un pie
                fijo (Próximo evento + usuario/descargar) que ya no se mueve pase lo que pase en
                medio — mismo patrón que un header/footer fijos con contenido scrollable entre
                medias. */}
            <aside className="sticky top-0 flex h-screen w-full flex-col border-r border-border">
              <div className="shrink-0 space-y-10 p-8 pb-6">
                <div className="flex items-center gap-3">
                  <span className="truncate text-xl font-semibold tracking-tight">Tidely</span>
                </div>

                <GlobalSearch onNavigate={onSearchNavigate} />
              </div>

              <div className="min-h-0 flex-1 space-y-10 overflow-y-auto px-8 pb-6">
              <nav className="flex flex-col gap-1">
                {NAV.map((item) => {
                  const sectionCollapsed = collapsedSections.has(item.key);
                  return (
                    <div key={item.key}>
                      <div className="flex items-center">
                        <button
                          onClick={() => onTabChange(item.key)}
                          className={`w-full min-w-0 flex-1 truncate rounded-lg px-3 py-2 text-left transition-colors ${
                            activeTab === item.key
                              ? "bg-primary/10 font-medium text-primary"
                              : "text-muted-foreground hover:bg-foreground/5"
                          }`}
                        >
                          {item.label}
                        </button>
                        {/* Aparte del botón de arriba a propósito: ese navega a la página del
                            propio apartado (Agenda/Finanzas también son vistas en sí mismas), este
                            solo pliega/despliega sus subapartados — mezclar los dos gestos en un
                            único botón haría imposible hacer cada cosa por separado. */}
                        {item.children && (
                          <button
                            type="button"
                            onClick={() => toggleSection(item.key)}
                            title={sectionCollapsed ? `Mostrar subapartados de ${item.label}` : `Ocultar subapartados de ${item.label}`}
                            className="shrink-0 cursor-pointer rounded-lg p-2 text-xs text-muted-foreground transition-transform hover:bg-foreground/5"
                          >
                            <span className={`inline-block transition-transform ${sectionCollapsed ? "-rotate-90" : ""}`} aria-hidden="true">
                              ▾
                            </span>
                          </button>
                        )}
                      </div>
                      {item.children && !sectionCollapsed && (
                        <div className="ml-3 mt-1 flex flex-col gap-1 border-l border-border pl-3">
                          {item.children.map((child) => (
                            <button
                              key={child.key}
                              onClick={() => onTabChange(child.key)}
                              className={`w-full truncate rounded-lg px-3 py-1.5 text-left text-sm transition-colors ${
                                activeTab === child.key
                                  ? "bg-primary/10 font-medium text-primary"
                                  : "text-muted-foreground hover:bg-foreground/5"
                              }`}
                            >
                              {child.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Apartado del menú principal, no una página personalizada más de "Tus páginas"
                    — por debajo sigue siendo una (plantilla "galeria"), pero el usuario no ve ese
                    paso intermedio: onOpenGallery busca la existente o crea la primera. */}
                <button
                  onClick={onOpenGallery}
                  className={`w-full min-w-0 truncate rounded-lg px-3 py-2 text-left transition-colors ${
                    galleryTab && activeTab === galleryTab
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-foreground/5"
                  }`}
                >
                  Galería
                </button>
              </nav>

              <div className="flex flex-col gap-1">
                {otherPages.length > 0 && (
                  <p className="px-3 pb-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">Tus páginas</p>
                )}
                {otherPages.map((page) => {
                  const tab = customPageTab(page.id);
                  const isRenaming = renamingPageId === page.id;
                  return (
                    <div key={page.id} className="group relative">
                      {isRenaming ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={async () => {
                            const trimmed = renameValue.trim();
                            setRenamingPageId(null);
                            if (trimmed && trimmed !== page.title) await onRenameCustomPage(page.id, trimmed);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            if (e.key === "Escape") setRenamingPageId(null);
                          }}
                          className="w-full rounded-lg border border-primary bg-background px-3 py-2 text-left text-sm outline-none"
                        />
                      ) : (
                        <button
                          onClick={() => onTabChange(tab)}
                          className={`w-full truncate rounded-lg px-3 py-2 pr-14 text-left transition-colors ${
                            activeTab === tab ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-foreground/5"
                          }`}
                        >
                          {page.title}
                        </button>
                      )}
                      {!isRenaming && (
                        <span className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            type="button"
                            title="Renombrar página"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRenamingPageId(page.id);
                              setRenameValue(page.title);
                            }}
                            className="cursor-pointer rounded p-1.5 text-xs text-muted-foreground hover:text-foreground"
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            title={confirmingDeletePageId === page.id ? "Confirmar eliminar" : "Eliminar página"}
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (confirmingDeletePageId === page.id) {
                                setConfirmingDeletePageId(null);
                                await onDeleteCustomPage(page.id);
                              } else {
                                setConfirmingDeletePageId(page.id);
                              }
                            }}
                            onMouseLeave={() => setConfirmingDeletePageId((id) => (id === page.id ? null : id))}
                            className={`cursor-pointer rounded p-1.5 text-xs ${
                              confirmingDeletePageId === page.id ? "font-bold text-destructive" : "text-muted-foreground hover:text-destructive"
                            }`}
                          >
                            ✕
                          </button>
                        </span>
                      )}
                    </div>
                  );
                })}

                {/* Translúcido a propósito (border punteado + fondo primary/5) para distinguirlo
                    del resto del menú, que son botones sólidos u opacos — es una acción de "crear
                    algo nuevo", no una pestaña ya existente. */}
                <button
                  onClick={() => setShowCreatePage(true)}
                  className="w-full cursor-pointer truncate rounded-lg border border-dashed border-primary/30 bg-primary/5 px-3 py-2 text-left text-sm font-medium text-primary transition-colors hover:bg-primary/10"
                >
                  + Nueva página
                </button>
              </div>
              </div>

              <div className="shrink-0 space-y-4 border-t border-border p-8 pt-6">
                <div className="rounded-2xl border border-secondary bg-secondary/30 p-4">
                  <button
                    type="button"
                    onClick={toggleNextEventCollapsed}
                    className="flex w-full cursor-pointer items-center justify-between gap-2 text-left"
                  >
                    <p className={`text-xs font-bold uppercase tracking-widest text-muted-foreground ${nextEventCollapsed ? "" : "mb-2"}`}>
                      Próximo evento
                    </p>
                    <span
                      className={`inline-block shrink-0 text-xs text-muted-foreground transition-transform ${nextEventCollapsed ? "-rotate-90" : ""}`}
                      aria-hidden="true"
                    >
                      ▾
                    </span>
                  </button>
                  {!nextEventCollapsed &&
                    (next ? (
                      <>
                        <p className="truncate font-medium">{next.title}</p>
                        <p className="truncate text-sm text-muted-foreground">
                          {new Date(next.startTime).toLocaleDateString("es-ES", { weekday: "short", day: "numeric" })} —{" "}
                          {new Date(next.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">Nada pendiente. Respira.</p>
                    ))}
                </div>

                <div className="flex items-center justify-between rounded-2xl px-1 text-sm">
                  {/* El nombre sigue abriendo el editor de perfil al clicar — "Cerrar sesión" ya
                      no vive al lado como botón fijo, sino en un popover que aparece ARRIBA al
                      pasar el ratón por encima del nombre (mismo `group`/`group-hover` que el
                      popover de descarga de al lado). Vive dentro del mismo contenedor `group`
                      que el propio disparador (no como hermano suelto) para que mover el ratón
                      del nombre al popover no rompa el hover: un descendiente absolutamente
                      posicionado sigue contando como "dentro" del `group` a efectos de :hover
                      aunque se dibuje fuera de su caja en el layout normal. */}
                  <div className="group relative min-w-0 flex-1">
                    <button
                      onClick={() => setProfileOpen(true)}
                      title="Editar perfil"
                      className="min-w-0 w-full cursor-pointer text-left text-muted-foreground hover:text-foreground"
                    >
                      <span className="block truncate">{user?.name}</span>
                      {/* Refleja al instante cualquier cambio guardado en el diálogo de perfil,
                          porque ambos leen el mismo `user` del contexto (ver ProfileDialog). */}
                      {user?.username && (
                        <span className="block truncate text-xs opacity-70">
                          @{user.username}
                          {user.emailVerified === false && (
                            <span title="Email sin verificar — revisa tu perfil" className="ml-1">
                              ⚠️
                            </span>
                          )}
                        </span>
                      )}
                    </button>
                    {/* `pb-1` (padding), no `mb-1` (margin): un margen deja un hueco muerto entre
                        el botón y el popover que no pertenece a la caja de NINGÚN elemento — el
                        ratón "sale" de todo lo hoverable al cruzarlo y el popover se cierra antes
                        de llegar a él. El padding, en cambio, sigue formando parte de la caja de
                        este div (que ya está dentro del `group`), así que el hover no se corta. */}
                    <div className="invisible absolute bottom-full left-0 z-10 pb-1 opacity-0 transition-opacity group-hover:visible group-hover:opacity-100">
                      <button
                        onClick={logout}
                        className="cursor-pointer whitespace-nowrap rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-[var(--shadow-soft)] hover:text-destructive"
                      >
                        Cerrar sesión
                      </button>
                    </div>
                  </div>

                  {/* El antiguo botón "Salir" de aquí al lado pasa a ser este icono de descarga
                      — la app todavía no existe como descargable, así que de momento solo es un
                      menú informativo (móvil/escritorio) sin ningún enlace real; ver
                      DownloadAppMenu más abajo. */}
                  <DownloadAppMenu />
                </div>
              </div>
            </aside>

            {/* Asa para ajustar el ancho arrastrando — no puede bajar de minWidth (el ancho
                natural del apartado más largo), así el texto nunca se corta. */}
            <div
              onMouseDown={startResize}
              role="separator"
              aria-orientation="vertical"
              aria-label="Ajustar ancho del menú"
              className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-primary/30 active:bg-primary/40"
            />
          </div>
        )}

        {/* Botón siempre visible para esconder/mostrar el menú, aunque esté colapsado — la foto
            real de un clip de papel (no un dibujo propio: los intentos en SVG no acababan de
            parecerse). Con el menú desplegado se ve clipClosed.png centrado sobre el borde real
            de la barra lateral (como sujetándola); colapsado no hay "hoja" que sujetar, así que
            se ve clipOpen.png girado 90° (vertical, como si sujetara el borde izquierdo del
            contenido en vez del de la barra lateral que ya no está) pegado al borde izquierdo.
            En ambos casos `top` coincide con el alto real del título de la página (font-serif
            text-4xl dentro de `p-6 lg:p-12`, ver PageHeader) para que el clip quede a su altura,
            no pegado arriba del todo. `fixed` (no `sticky` con margen negativo) a propósito: un
            margen negativo tan grande sobre un elemento dentro del flex de la barra lateral
            encogía el ancho de toda la fila; al sacarlo del flujo con `fixed`, su posición no
            afecta al del resto. */}
        <button
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Mostrar menú" : "Ocultar menú"}
          title={collapsed ? "Mostrar menú" : "Ocultar menú"}
          style={{ left: collapsed ? 16 : sidebarWidth - 14, top: 68 }}
          className={`fixed z-20 -translate-y-1/2 cursor-pointer bg-transparent transition-transform hover:scale-105 ${
            collapsed ? "" : "-translate-x-1/2"
          }`}
        >
          {collapsed ? (
            <img src={clipOpenUrl} alt="" width={56} className="rotate-90 drop-shadow-md" />
          ) : (
            <img src={clipClosedUrl} alt="" width={CLIP_CLOSED_WIDTH} className="drop-shadow-md" />
          )}
        </button>
      </div>

      {/* min-w-0: por defecto un hijo flex no encoge por debajo del ancho intrínseco de su
          contenido ("min-width: auto"), así que sin esto cualquier página con contenido ancho
          (p.ej. el kanban de una página personalizada con varias columnas, ver CustomPagePage)
          empujaría TODO el layout en horizontal en vez de hacer scroll dentro de su propio
          overflow-x-auto — con min-w-0 el hijo sí puede encoger a su hueco asignado y el scroll
          horizontal queda contenido donde corresponde. */}
      <div className="min-w-0 flex-1">
        <nav className="flex gap-1 overflow-x-auto border-b border-border px-6 py-4 lg:hidden">
          {FLAT_NAV.map((item) => (
            <button
              key={item.key}
              onClick={() => onTabChange(item.key)}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm ${
                activeTab === item.key ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground"
              }`}
            >
              {item.label}
            </button>
          ))}
          <button
            onClick={onOpenGallery}
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm ${
              galleryTab && activeTab === galleryTab ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground"
            }`}
          >
            Galería
          </button>
          {otherPages.map((page) => {
            const tab = customPageTab(page.id);
            return (
              <button
                key={page.id}
                onClick={() => onTabChange(tab)}
                className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm ${
                  activeTab === tab ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground"
                }`}
              >
                {page.title}
              </button>
            );
          })}
          <button
            onClick={() => setShowCreatePage(true)}
            className="whitespace-nowrap rounded-lg border border-dashed border-primary/30 bg-primary/5 px-3 py-2 text-sm font-medium text-primary"
          >
            + Nueva página
          </button>
          <button onClick={logout} className="ml-auto whitespace-nowrap rounded-lg px-3 py-2 text-sm text-muted-foreground">
            Salir
          </button>
        </nav>
        {/* Con el menú colapsado el clip queda fijo sobre el borde izquierdo (ver el botón de
            arriba) y por defecto el título quedaba pegado a él (mismo padding que con el menú
            abierto) — con el menú colapsado se sube el padding izquierdo (lg:pl-24 en vez de
            lg:pl-12) para dejar aire entre el clip y el título de la página. Solo en `lg:` porque
            el clip solo existe en el layout de escritorio (ver "hidden shrink-0 lg:flex" arriba). */}
        <main className={`p-6 lg:pt-12 lg:pr-12 lg:pb-12 ${collapsed ? "lg:pl-24" : "lg:pl-12"}`}>{children}</main>
      </div>

      {/* Fija en la esquina inferior derecha, fuera del menú — así se ve en todas las páginas
          (y aunque el menú esté colapsado o en la barra plana de móvil), no solo cuando el menú
          lateral está desplegado. */}
      <div className="fixed bottom-6 right-6 z-30">
        <NotificationsWidget />
      </div>

      {profileOpen && <ProfileDialog onClose={() => setProfileOpen(false)} />}
      {showCreatePage && (
        <CreatePageModal
          onClose={() => setShowCreatePage(false)}
          onCreate={async (title, template) => {
            await onCreateCustomPage(title, template);
            setShowCreatePage(false);
          }}
        />
      )}
    </div>
  );
}

/**
 * Icono de descarga junto al nombre de usuario (donde antes vivía el botón "Salir"): al pasar el
 * ratón por encima despliega un popover con las dos variantes futuras de la app (móvil/
 * escritorio). Ninguna tiene todavía enlace real — la app nativa no existe aún — así que ambas
 * opciones están deshabilitadas y solo informan de que están "Próximamente"; cuando exista un
 * build descargable basta con quitar `disabled` y añadir el `href`/`onClick` real de cada una.
 */
function DownloadAppMenu() {
  return (
    <div className="group relative shrink-0">
      <button
        title="Descargar la aplicación"
        className="cursor-pointer rounded-full p-1.5 text-muted-foreground transition-colors hover:text-foreground"
      >
        {/* Icono clásico de descarga (bandeja + flecha), mismo trazo que el resto de iconos
            outline del proyecto — no hay librería de iconos instalada, así que va inline. */}
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="size-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
        </svg>
      </button>
      {/* A la derecha del icono (no arriba): el icono vive en la esquina de la barra lateral, con
          poco margen por encima, así que un popover hacia arriba quedaría muy pegado al borde. */}
      {/* `pl-1` (padding), no `ml-1` (margin) — mismo motivo que el popover de "Cerrar sesión":
          un margen deja un hueco muerto que rompe el hover al cruzarlo hacia el popover. */}
      <div className="invisible absolute bottom-0 left-full z-10 w-48 space-y-1 rounded-2xl border border-border bg-card py-2 pl-3 pr-2 opacity-0 shadow-[var(--shadow-soft)] transition-opacity group-hover:visible group-hover:opacity-100">
        <p className="px-2 pt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Descargar app</p>
        <button
          disabled
          title="Próximamente"
          className="flex w-full cursor-not-allowed items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground opacity-60"
        >
          📱 Aplicación móvil
        </button>
        <button
          disabled
          title="Próximamente"
          className="flex w-full cursor-not-allowed items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground opacity-60"
        >
          🖥️ Aplicación de escritorio
        </button>
        <p className="px-2 pb-1 text-[10px] text-muted-foreground">Próximamente — aún sin build descargable</p>
      </div>
    </div>
  );
}

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Búsqueda global entre eventos, tareas, notas y proyectos. Al elegir un resultado, navega a
 * la sección correspondiente y le pasa un `SearchFocus` — cada página destino decide qué hacer
 * con él (abrir el diálogo del evento, expandir la tarjeta de la tarea, abrir el cuaderno del
 * proyecto...), ver `DashboardPage`.
 */
function GlobalSearch({ onNavigate }: { onNavigate: (tab: Tab, focus: SearchFocus) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await api.get<SearchResults>(`/search?q=${encodeURIComponent(trimmed)}`);
        setResults(data);
      } finally {
        setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Cierra el desplegable al clicar fuera.
  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const pick = (tab: Tab, focus: SearchFocus) => {
    onNavigate(tab, focus);
    setOpen(false);
    setQuery("");
    setResults(null);
  };

  const hasResults =
    results && (results.events.length > 0 || results.tasks.length > 0 || results.notes.length > 0 || results.projects.length > 0);

  return (
    <div ref={containerRef} className="relative">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="🔎 Buscar en todo..."
        className="field-input w-full text-sm"
      />

      {open && query.trim().length >= 2 && (
        <div className="absolute left-0 top-full z-20 mt-2 max-h-96 w-full overflow-y-auto rounded-2xl border border-border bg-card p-2 shadow-[var(--shadow-soft)]">
          {loading ? (
            <p className="p-3 text-center text-xs text-muted-foreground">Buscando...</p>
          ) : !hasResults ? (
            <p className="p-3 text-center text-xs text-muted-foreground">Sin resultados para "{query.trim()}".</p>
          ) : (
            <div className="space-y-3">
              {results!.events.length > 0 && (
                <SearchGroup label="Eventos">
                  {results!.events.map((e) => (
                    <SearchResultRow
                      key={`event-${e.id}`}
                      title={e.title}
                      subtitle={`${new Date(e.startTime).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}${e.isRecurring ? " · recurrente" : ""}`}
                      onClick={() => pick("agenda", { type: "event", id: e.id, startTime: e.startTime })}
                    />
                  ))}
                </SearchGroup>
              )}
              {results!.tasks.length > 0 && (
                <SearchGroup label="Tareas">
                  {results!.tasks.map((t) => (
                    <SearchResultRow
                      key={`task-${t.id}`}
                      title={t.title}
                      onClick={() => pick("planificador", { type: "task", id: t.id, plannerId: t.plannerId })}
                    />
                  ))}
                </SearchGroup>
              )}
              {results!.notes.length > 0 && (
                <SearchGroup label="Notas">
                  {results!.notes.map((n) => (
                    <SearchResultRow key={`note-${n.id}`} title={n.content} onClick={() => pick("agenda", { type: "note", id: n.id })} />
                  ))}
                </SearchGroup>
              )}
              {results!.projects.length > 0 && (
                <SearchGroup label="Proyectos">
                  {results!.projects.map((p) => (
                    <SearchResultRow key={`project-${p.id}`} title={p.title} onClick={() => pick("proyectos", { type: "project", id: p.id })} />
                  ))}
                </SearchGroup>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SearchGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <ul>{children}</ul>
    </div>
  );
}

function SearchResultRow({ title, subtitle, onClick }: { title: string; subtitle?: string; onClick: () => void }) {
  return (
    <li>
      <button onClick={onClick} className="w-full cursor-pointer truncate rounded-xl px-2 py-1.5 text-left text-sm hover:bg-muted">
        {title}
        {subtitle && <span className="ml-2 text-xs text-muted-foreground">{subtitle}</span>}
      </button>
    </li>
  );
}

/**
 * Antes vivía dentro del menú lateral (solo visible con el menú desplegado, y ni siquiera existía
 * en la barra plana de móvil) — ahora es un botón flotante fijo en la esquina inferior derecha,
 * fuera del <aside>, así que se ve en cualquier página y da igual si el menú está colapsado.
 */
function NotificationsWidget() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { data, reload } = useFetch(
    () => api.get<{ notifications: Notification[] }>("/notifications?unreadOnly=true&limit=5"),
    []
  );
  const { data: countData, reload: reloadCount } = useFetch(
    () => api.get<{ unreadCount: number }>("/notifications/unread-count"),
    []
  );
  const unread = countData?.unreadCount ?? 0;

  // Al ser un botón flotante suelto (no parte de la fila del menú), cierra al hacer clic fuera —
  // igual patrón que GlobalSearch más abajo.
  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const markAllRead = async () => {
    await api.put("/notifications/read-all");
    reload();
    reloadCount();
  };

  return (
    <div ref={containerRef} className="relative">
      {open && (
        <div className="absolute bottom-full right-0 z-10 mb-3 w-80 max-w-[calc(100vw-3rem)] rounded-2xl border border-border bg-card p-3 shadow-[var(--shadow-soft)]">
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Notificaciones</p>
            <button onClick={() => setOpen(false)} className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              ✕
            </button>
          </div>
          {(data?.notifications.length ?? 0) === 0 ? (
            <p className="p-3 text-center text-xs text-muted-foreground">Sin notificaciones nuevas.</p>
          ) : (
            <>
              <ul className="max-h-64 space-y-2 overflow-y-auto">
                {data?.notifications.map((n) => (
                  <li key={n.id} className="rounded-xl bg-muted/60 p-3 text-xs">
                    <p className="font-medium">{n.title}</p>
                    <p className="mt-1 text-muted-foreground">{n.message}</p>
                  </li>
                ))}
              </ul>
              <button onClick={markAllRead} className="mt-2 w-full rounded-xl py-2 text-center text-xs text-primary hover:underline">
                Marcar todas como leídas
              </button>
            </>
          )}
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notificaciones"
        title="Notificaciones"
        className="relative flex size-14 cursor-pointer items-center justify-center rounded-full border border-border bg-card text-xl shadow-[var(--shadow-soft)] transition-colors hover:border-primary/30"
      >
        <span aria-hidden="true">🔔</span>
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground ring-2 ring-background">
            {unread}
          </span>
        )}
      </button>
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return (
    <header className="mb-12 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="mb-2 font-serif text-4xl">{title}</h1>
        <p className="text-muted-foreground">{subtitle}</p>
      </div>
      {action}
    </header>
  );
}

/**
 * Diálogo de "+ Nueva página": elegir un modelo (ver CUSTOM_PAGE_TEMPLATES) y ponerle nombre.
 * El nombre se autorrellena con la etiqueta del modelo elegido en cuanto se toca uno (y solo si
 * el usuario no ha escrito ya el suyo), pero sigue siendo editable — así "modificar el nombre de
 * la página a crear" no exige borrar nada si el modelo ya sugiere un buen nombre.
 */
function CreatePageModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (title: string, template: CustomPageTemplate) => Promise<void>;
}) {
  const [template, setTemplate] = useState<CustomPageTemplate | null>(null);
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickTemplate = (key: CustomPageTemplate, label: string) => {
    setTemplate(key);
    if (!titleTouched) setTitle(label);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!template || !trimmed) return;
    setCreating(true);
    setError(null);
    try {
      await onCreate(trimmed, template);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear la página.");
      setCreating(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-foreground/50 p-4"
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-3xl bg-card p-6 shadow-[var(--shadow-soft)] sm:p-8">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-serif text-xl">Nueva página</h2>
          <button type="button" onClick={onClose} className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            ✕ Cerrar
          </button>
        </div>

        <form onSubmit={submit}>
          <p className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Elige un modelo</p>
          <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {/* "galeria" no se ofrece aquí: ya es su propio apartado del menú principal (ver el
                botón "Galería" en AppShell), con una sola por cuenta — permitir crear otra desde
                este diálogo genérico rompería ese "siempre hay una sola". */}
            {CUSTOM_PAGE_TEMPLATES.filter((t) => t.key !== "galeria").map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => pickTemplate(t.key, t.label)}
                className={`cursor-pointer rounded-2xl border p-3 text-left transition-colors ${
                  template === t.key ? "border-primary bg-primary/10" : "border-border hover:border-primary/30"
                }`}
              >
                <span className="text-xl" aria-hidden="true">
                  {t.icon}
                </span>
                <p className="mt-1 text-sm font-medium">{t.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
              </button>
            ))}
          </div>

          <label className="mb-1 flex flex-col gap-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Nombre de la página
            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setTitleTouched(true);
              }}
              placeholder="Ponle un nombre..."
              maxLength={100}
              required
              className="field-input normal-case tracking-normal"
            />
          </label>

          {error && (
            <p className="mt-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">⚠️ {error}</p>
          )}

          <button type="submit" disabled={!template || !title.trim() || creating} className="btn-primary mt-4">
            {creating ? "Creando..." : "Crear página"}
          </button>
        </form>
      </div>
    </div>
  );
}

