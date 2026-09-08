import { lazy, Suspense, useState } from "react";
import { AppShell, parseCustomPageTab, customPageTab, SearchFocus, Tab } from "../components/AppShell";
import { api } from "../api/client";
import { useFetch } from "../hooks/useFetch";
import { Loading } from "../components/Feedback";
import { HoyPage } from "./HoyPage";
import { CustomPageSummary, CustomPageTemplate } from "../types";

// "Hoy" (la pestaña por defecto) se importa arriba de forma normal — es lo primero que ve
// cualquiera al entrar, así que cargarla de forma perezosa solo añadiría una petición de red de
// más sin ahorrar nada. El resto de pestañas SÍ son `lazy`: antes se importaban todas de forma
// estática (aunque solo se RENDERIZASE la activa, ver el JSX de abajo), así que su código —
// incluido RichTextEditor y KaTeX (~varios cientos de KB), que arrastran Proyectos/Páginas
// personalizadas/Planificador/Horario — viajaba entero en el bundle inicial aunque el usuario
// jamás abriera esas pestañas en la sesión. Con `lazy`, ese código solo se descarga la primera vez
// que se navega a cada una.
const AgendaPage = lazy(() => import("./AgendaPage").then((m) => ({ default: m.AgendaPage })));
const PlanificadorPage = lazy(() => import("./PlanificadorPage").then((m) => ({ default: m.PlanificadorPage })));
const SchedulePage = lazy(() => import("./SchedulePage").then((m) => ({ default: m.SchedulePage })));
const MetasPage = lazy(() => import("./MetasPage").then((m) => ({ default: m.MetasPage })));
const FinanzasPage = lazy(() => import("./FinanzasPage").then((m) => ({ default: m.FinanzasPage })));
const MetasAhorroPage = lazy(() => import("./MetasAhorroPage").then((m) => ({ default: m.MetasAhorroPage })));
const ProyectosPage = lazy(() => import("./ProyectosPage").then((m) => ({ default: m.ProyectosPage })));
const CustomPagePage = lazy(() => import("./CustomPagePage").then((m) => ({ default: m.CustomPagePage })));

// Tras conectar Google Calendar (ver GoogleCalendarMenu en AgendaPage), Google redirige el
// navegador completo de vuelta a la raíz con `?google=connected|error` en la URL — como no hay
// router real (ver App.tsx), sin este chequeo el usuario aterrizaría en "Hoy" sin ver el aviso.
function initialTab(): Tab {
  return new URLSearchParams(window.location.search).has("google") ? "agenda" : "hoy";
}

export function DashboardPage() {
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);

  // Páginas personalizadas ("+ Nueva página", ver AppShell): una única carga aquí arriba, tanto
  // para pintar el menú lateral como para saber qué plantilla renderizar cuando activeTab
  // apunta a una de ellas (ver customPageTab/parseCustomPageTab).
  const { data: customPagesData, reload: reloadCustomPages } = useFetch(
    () => api.get<{ pages: CustomPageSummary[] }>("/custom-pages"),
    []
  );
  const customPages = customPagesData?.pages ?? [];
  const activeCustomPageId = parseCustomPageTab(activeTab);

  const createCustomPage = async (title: string, template: CustomPageTemplate) => {
    const created = await api.post<CustomPageSummary>("/custom-pages", { title, template });
    // Esperar a que la lista esté actualizada ANTES de cambiar de pestaña — si no, "Tus páginas"
    // en la barra lateral podía tardar un instante en mostrar la nueva página (la propia vista sí
    // aparecía, pero el menú se quedaba con la lista vieja hasta el siguiente re-render).
    await reloadCustomPages();
    setActiveTab(customPageTab(created.id));
  };

  // "Galería" del menú principal (ver AppShell): busca la página "galeria" del usuario (nunca hay
  // más de una — CreatePageModal ya no la ofrece como opción, ver AppShell) o la crea la primera
  // vez, y navega a ella. Mismo patrón que createCustomPage, sin pedir título/plantilla.
  const openGallery = async () => {
    const existing = customPages.find((p) => p.template === "galeria");
    if (existing) {
      setActiveTab(customPageTab(existing.id));
      return;
    }
    const created = await api.post<CustomPageSummary>("/custom-pages", { title: "Galería", template: "galeria" });
    await reloadCustomPages();
    setActiveTab(customPageTab(created.id));
  };

  const renameCustomPage = async (id: number, title: string) => {
    await api.put(`/custom-pages/${id}`, { title });
    reloadCustomPages();
  };

  // Para el ✕ del menú lateral (ver AppShell): borra de verdad en el servidor.
  const deleteCustomPage = async (id: number) => {
    await api.delete(`/custom-pages/${id}`);
    reloadCustomPages();
    if (parseCustomPageTab(activeTab) === id) setActiveTab("hoy");
  };

  // Para el botón "Eliminar página" dentro de la propia página (ver CustomPagePage): ese
  // componente ya hace el DELETE él mismo antes de avisar, así que aquí solo hay que refrescar
  // el menú y volver a "Hoy" — sin repetir la llamada (evitaría un 404 al borrar dos veces).
  const handleCustomPageDeleted = () => {
    reloadCustomPages();
    setActiveTab("hoy");
  };

  // Destino de un resultado de búsqueda global (ver AppShell.GlobalSearch): qué página debe
  // "recibirlo" al montar/cargar sus datos. Cada página consume el que le corresponde y avisa
  // con `onFocusHandled` para limpiarlo — así no se re-dispara en cada re-render, ni queda
  // pegado si el usuario cambia de pestaña a mano después.
  const [focus, setFocus] = useState<SearchFocus | null>(null);

  const navigate = (tab: Tab, nextFocus: SearchFocus | null = null) => {
    setFocus(nextFocus);
    setActiveTab(tab);
  };

  const clearFocus = () => setFocus(null);

  return (
    <AppShell
      activeTab={activeTab}
      onTabChange={(tab) => navigate(tab)}
      onSearchNavigate={navigate}
      customPages={customPages}
      onCreateCustomPage={createCustomPage}
      onRenameCustomPage={renameCustomPage}
      onDeleteCustomPage={deleteCustomPage}
      onOpenGallery={openGallery}
    >
      {activeTab === "hoy" && <HoyPage onNavigate={navigate} />}

      {/* Todo lo que no sea "Hoy" es `lazy` (ver los imports de arriba) — el Suspense solo
          envuelve esto, no "Hoy", para que la pestaña por defecto nunca dependa de una carga
          asíncrona de más. El fallback solo se ve la primera vez que se visita cada pestaña en la
          sesión (Vite ya cachea el chunk descargado para las siguientes). */}
      <Suspense fallback={<Loading label="Cargando..." />}>
        {activeCustomPageId !== null && (
          // `key`: sin esto, pasar de una página personalizada a OTRA (p.ej. justo tras crear una
          // nueva mientras ya se estaba viendo otra) no desmonta el componente — React lo reutiliza
          // con un `pageId` distinto, y hasta que su useEffect (keyed en `page`, no en `pageId`) no
          // termina de resincronizar título/subtítulo/contenido puede verse en blanco. Con `key` sí
          // se desmonta y se vuelve a montar desde cero por cada página, sin ese hueco intermedio.
          <CustomPagePage
            key={activeCustomPageId}
            pageId={activeCustomPageId}
            onRenamed={reloadCustomPages}
            onDeleted={handleCustomPageDeleted}
          />
        )}
        {activeTab === "agenda" && (
          <AgendaPage
            focusEventId={focus?.type === "event" ? focus.id : undefined}
            focusEventStartTime={focus?.type === "event" ? focus.startTime : undefined}
            onFocusHandled={clearFocus}
            onNavigate={navigate}
          />
        )}
        {activeTab === "planificador" && (
          <PlanificadorPage
            focusTaskId={focus?.type === "task" ? focus.id : undefined}
            focusPlannerId={focus?.type === "task" ? focus.plannerId : undefined}
            onFocusHandled={clearFocus}
          />
        )}
        {activeTab === "horario" && <SchedulePage />}
        {activeTab === "metas" && <MetasPage />}
        {activeTab === "finanzas" && <FinanzasPage />}
        {activeTab === "finanzas-ahorro" && <MetasAhorroPage />}
        {activeTab === "proyectos" && (
          <ProyectosPage focusProjectId={focus?.type === "project" ? focus.id : undefined} onFocusHandled={clearFocus} />
        )}
      </Suspense>
    </AppShell>
  );
}
