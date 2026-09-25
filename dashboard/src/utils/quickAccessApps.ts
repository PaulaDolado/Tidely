import { api } from "../api/client";

// Catálogo fijo de apps para "Acceso rápido" (ver HoyPage + QuickAccessCard). `icon` es el path
// (atributo `d`) del logo oficial de cada marca, viewBox 0 0 24 24 — mismos trazados que usa
// Simple Icons (simpleicons.org, MIT), incrustados aquí en vez de cargarlos de un CDN externo
// para que la app siga siendo autocontenida (sin dependencias de red en tiempo de uso, mismo
// criterio que el resto del proyecto: no hay ninguna librería de iconos en package.json). `color`
// es el color de marca oficial de cada una, usado como fondo de la casilla (el logo se pinta en
// blanco encima).
export interface QuickAccessApp {
  id: string;
  label: string;
  color: string;
  // Esquema de URI que abre la app de escritorio si está instalada (ver openQuickAccessApp). Las
  // apps que no tienen un esquema general de "abrir la app" (GitHub, GitLab, Gmail, YouTube,
  // Calendar, Drive son solo web o no documentan uno) se quedan sin `appUrl` y van directas a la web.
  appUrl?: string;
  webUrl: string;
  // Mutuamente excluyentes: las apps del catálogo fijo traen `icon` (path de un logo de marca);
  // los enlaces personalizados del usuario (ver más abajo) traen `emoji` en su lugar, porque no
  // hay logo de marca conocido para una URL cualquiera — salvo que se haya podido sacar un
  // favicon de verdad (ver `faviconUrl`), que entonces se pinta encima del emoji.
  icon?: string;
  emoji?: string;
  // Icono real del sitio, sacado de GET /link-preview al añadir/editar el enlace (ver
  // fetchFaviconFor más abajo) — solo lo traen los enlaces personalizados. Es una URL externa
  // (no un path SVG como `icon`), así que AppLogo la pinta como <img>, con `emoji` de reserva si
  // esa imagen no llega a cargar (dominio caído, sin favicon de verdad pese al 200 de /favicon.ico...).
  faviconUrl?: string;
}

export const QUICK_ACCESS_APPS: QuickAccessApp[] = [
  {
    id: "whatsapp",
    label: "WhatsApp",
    color: "#25D366",
    appUrl: "whatsapp://",
    webUrl: "https://web.whatsapp.com",
    icon: "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z",
  },
  {
    id: "spotify",
    label: "Spotify",
    color: "#1ED760",
    appUrl: "spotify:",
    webUrl: "https://open.spotify.com",
    icon: "M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z",
  },
  {
    id: "github",
    label: "GitHub",
    color: "#181717",
    webUrl: "https://github.com",
    icon: "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
  },
  {
    id: "gitlab",
    label: "GitLab",
    color: "#FC6D26",
    webUrl: "https://gitlab.com",
    icon: "m23.6004 9.5927-.0337-.0862L20.3.9814a.851.851 0 0 0-.3362-.405.8748.8748 0 0 0-.9997.0539.8748.8748 0 0 0-.29.4399l-2.2055 6.748H7.5375l-2.2057-6.748a.8573.8573 0 0 0-.29-.4412.8748.8748 0 0 0-.9997-.0537.8585.8585 0 0 0-.3362.4049L.4332 9.5015l-.0325.0862a6.0657 6.0657 0 0 0 2.0119 7.0105l.0113.0087.03.0213 4.976 3.7264 2.462 1.8633 1.4995 1.1321a1.0085 1.0085 0 0 0 1.2197 0l1.4995-1.1321 2.4619-1.8633 5.006-3.7489.0125-.01a6.0682 6.0682 0 0 0 2.0094-7.003z",
  },
  {
    id: "gmail",
    label: "Gmail",
    color: "#EA4335",
    webUrl: "https://mail.google.com/mail/u/0/",
    icon: "M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z",
  },
  {
    id: "teams",
    label: "Teams",
    color: "#6264A7",
    appUrl: "msteams:",
    webUrl: "https://teams.microsoft.com",
    icon: "M20.625 8.127q-.55 0-1.025-.205-.475-.205-.832-.563-.358-.357-.563-.832Q18 6.053 18 5.502q0-.54.205-1.02t.563-.837q.357-.358.832-.563.474-.205 1.025-.205.54 0 1.02.205t.837.563q.358.357.563.837.205.48.205 1.02 0 .55-.205 1.025-.205.475-.563.832-.357.358-.837.563-.48.205-1.02.205zm0-3.75q-.469 0-.797.328-.328.328-.328.797 0 .469.328.797.328.328.797.328.469 0 .797-.328.328-.328.328-.797 0-.469-.328-.797-.328-.328-.797-.328zM24 10.002v5.578q0 .774-.293 1.46-.293.685-.803 1.194-.51.51-1.195.803-.686.293-1.459.293-.445 0-.908-.105-.463-.106-.85-.329-.293.95-.855 1.729-.563.78-1.319 1.336-.756.557-1.67.861-.914.305-1.898.305-1.148 0-2.162-.398-1.014-.399-1.805-1.102-.79-.703-1.312-1.664t-.674-2.086h-5.8q-.411 0-.704-.293T0 16.881V6.873q0-.41.293-.703t.703-.293h8.59q-.34-.715-.34-1.5 0-.727.275-1.365.276-.639.75-1.114.475-.474 1.114-.75.638-.275 1.365-.275t1.365.275q.639.276 1.114.75.474.475.75 1.114.275.638.275 1.365t-.275 1.365q-.276.639-.75 1.113-.475.475-1.114.75-.638.276-1.365.276-.188 0-.375-.024-.188-.023-.375-.058v1.078h10.875q.469 0 .797.328.328.328.328.797zM12.75 2.373q-.41 0-.78.158-.368.158-.638.434-.27.275-.428.639-.158.363-.158.773 0 .41.158.78.159.368.428.638.27.27.639.428.369.158.779.158.41 0 .773-.158.364-.159.64-.428.274-.27.433-.639.158-.369.158-.779 0-.41-.158-.773-.159-.364-.434-.64-.275-.275-.639-.433-.363-.158-.773-.158zM6.937 9.814h2.25V7.94H2.814v1.875h2.25v6h1.875zm10.313 7.313v-6.75H12v6.504q0 .41-.293.703t-.703.293H8.309q.152.809.556 1.5.405.691.985 1.19.58.497 1.318.779.738.281 1.582.281.926 0 1.746-.352.82-.351 1.436-.966.615-.616.966-1.43.352-.815.352-1.752zm5.25-1.547v-5.203h-3.75v6.855q.305.305.691.452.387.146.809.146.469 0 .879-.176.41-.175.715-.48.304-.305.48-.715t.176-.879Z",
  },
  {
    id: "slack",
    label: "Slack",
    color: "#4A154B",
    appUrl: "slack://open",
    webUrl: "https://app.slack.com/client",
    icon: "M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z",
  },
  {
    id: "notion",
    label: "Notion",
    color: "#000000",
    appUrl: "notion://www.notion.so",
    webUrl: "https://www.notion.so",
    icon: "M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z",
  },
  {
    id: "zoom",
    label: "Zoom",
    color: "#0B5CFF",
    appUrl: "zoommtg://zoom.us/join",
    webUrl: "https://zoom.us",
    icon: "M5.033 14.649H.743a.74.74 0 0 1-.686-.458.74.74 0 0 1 .16-.808L3.19 10.41H1.06A1.06 1.06 0 0 1 0 9.35h3.957c.301 0 .57.18.686.458a.74.74 0 0 1-.161.808L1.51 13.59h2.464c.585 0 1.06.475 1.06 1.06zM24 11.338c0-1.14-.927-2.066-2.066-2.066-.61 0-1.158.265-1.537.686a2.061 2.061 0 0 0-1.536-.686c-1.14 0-2.066.926-2.066 2.066v3.311a1.06 1.06 0 0 0 1.06-1.06v-2.251a1.004 1.004 0 0 1 2.013 0v2.251c0 .586.474 1.06 1.06 1.06v-3.311a1.004 1.004 0 0 1 2.012 0v2.251c0 .586.475 1.06 1.06 1.06zM16.265 12a2.728 2.728 0 1 1-5.457 0 2.728 2.728 0 0 1 5.457 0zm-1.06 0a1.669 1.669 0 1 0-3.338 0 1.669 1.669 0 0 0 3.338 0zm-4.82 0a2.728 2.728 0 1 1-5.458 0 2.728 2.728 0 0 1 5.457 0zm-1.06 0a1.669 1.669 0 1 0-3.338 0 1.669 1.669 0 0 0 3.338 0z",
  },
  {
    id: "discord",
    label: "Discord",
    color: "#5865F2",
    appUrl: "discord://",
    webUrl: "https://discord.com/app",
    icon: "M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z",
  },
  {
    id: "calendar",
    label: "Google Calendar",
    color: "#4285F4",
    webUrl: "https://calendar.google.com",
    icon: "M18.316 5.684H24v12.632h-5.684V5.684zM5.684 24h12.632v-5.684H5.684V24zM18.316 5.684V0H1.895A1.894 1.894 0 0 0 0 1.895v16.421h5.684V5.684h12.632zm-7.207 6.25v-.065c.272-.144.5-.349.687-.617s.279-.595.279-.982c0-.379-.099-.72-.3-1.025a2.05 2.05 0 0 0-.832-.714 2.703 2.703 0 0 0-1.197-.257c-.6 0-1.094.156-1.481.467-.386.311-.65.671-.793 1.078l1.085.452c.086-.249.224-.461.413-.633.189-.172.445-.257.767-.257.33 0 .602.088.816.264a.86.86 0 0 1 .322.703c0 .33-.12.589-.36.778-.24.19-.535.284-.886.284h-.567v1.085h.633c.407 0 .748.109 1.02.327.272.218.407.499.407.843 0 .336-.129.614-.387.832s-.565.327-.924.327c-.351 0-.651-.103-.897-.311-.248-.208-.422-.502-.521-.881l-1.096.452c.178.616.505 1.082.977 1.401.472.319.984.478 1.538.477a2.84 2.84 0 0 0 1.293-.291c.382-.193.684-.458.902-.794.218-.336.327-.72.327-1.149 0-.429-.115-.797-.344-1.105a2.067 2.067 0 0 0-.881-.689zm2.093-1.931l.602.913L15 10.045v5.744h1.187V8.446h-.827l-2.158 1.557zM22.105 0h-3.289v5.184H24V1.895A1.894 1.894 0 0 0 22.105 0zm-3.289 23.5l4.684-4.684h-4.684V23.5zM0 22.105C0 23.152.848 24 1.895 24h3.289v-5.184H0v3.289z",
  },
  {
    id: "drive",
    label: "Google Drive",
    color: "#0F9D58",
    webUrl: "https://drive.google.com",
    icon: "M12.01 1.485c-2.082 0-3.754.02-3.743.047.01.02 1.708 3.001 3.774 6.62l3.76 6.574h3.76c2.081 0 3.753-.02 3.742-.047-.005-.02-1.708-3.001-3.775-6.62l-3.76-6.574zm-4.76 1.73a789.828 789.861 0 0 0-3.63 6.319L0 15.868l1.89 3.298 1.885 3.297 3.62-6.335 3.618-6.33-1.88-3.287C8.1 4.704 7.255 3.22 7.25 3.214zm2.259 12.653-.203.348c-.114.198-.96 1.672-1.88 3.287a423.93 423.948 0 0 1-1.698 2.97c-.01.026 3.24.042 7.222.042h7.244l1.796-3.157c.992-1.734 1.85-3.23 1.906-3.323l.104-.167h-7.249z",
  },
  {
    id: "youtube",
    label: "YouTube",
    color: "#FF0000",
    webUrl: "https://youtube.com",
    icon: "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z",
  },
];

// --- Enlaces personalizados -------------------------------------------------------------------
// Además del catálogo fijo de arriba, el usuario puede añadir sus propios accesos directos con
// cualquier URL, nombre y (si se consigue sacar uno, ver fetchFaviconFor) el icono real del
// sitio, con un emoji como reserva. Se guardan en localStorage, igual que `selectedIds` en
// QuickAccessCard: es una preferencia de este dispositivo, no del backend — lo único que SÍ pasa
// por el backend es la búsqueda puntual del favicon (GET /link-preview, que ya hace de servidor
// intermedio para esto en el editor de texto enriquecido), el enlace en sí nunca se manda ni se
// guarda ahí.
const CUSTOM_LINKS_STORAGE_KEY = "life-organizer:quick-access-custom";

export interface CustomQuickAccessLink {
  id: string;
  label: string;
  url: string;
  emoji: string;
  faviconUrl?: string;
}

export function loadCustomLinks(): CustomQuickAccessLink[] {
  const raw = localStorage.getItem(CUSTOM_LINKS_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCustomLinks(links: CustomQuickAccessLink[]): void {
  localStorage.setItem(CUSTOM_LINKS_STORAGE_KEY, JSON.stringify(links));
}

// Colores fijos rotando por hash del id (no por posición en la lista) para que el color de cada
// enlace no cambie al borrar o añadir otros — mismo efecto visual que los colores de marca del
// catálogo fijo, sin tener que pedirle también un color al usuario además del icono.
const CUSTOM_LINK_COLORS = ["#6366F1", "#F59E0B", "#10B981", "#EC4899", "#0EA5E9", "#F97316", "#84CC16", "#A855F7"];

function colorForCustomLink(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return CUSTOM_LINK_COLORS[hash % CUSTOM_LINK_COLORS.length];
}

// Antepone https:// si el usuario no puso esquema (p.ej. escribe "notion.so/mi-pagina"), y
// rechaza cualquier esquema que no sea http/https (p.ej. "javascript:") ya que esto se abre
// directamente con window.open/location.href — ver openQuickAccessApp.
export function normalizeQuickAccessUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withProtocol = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

// Devuelve null si el nombre o la URL no son válidos (el formulario lo interpreta como "corrige
// los datos"), o el enlace ya guardado si todo fue bien.
export function addCustomLink(input: { label: string; url: string; emoji: string; faviconUrl?: string }): CustomQuickAccessLink | null {
  const label = input.label.trim();
  const url = normalizeQuickAccessUrl(input.url);
  if (!label || !url) return null;
  // Sin emoji ni favicon, AppLogo cae a un icono genérico (🔗) — no a la inicial del nombre.
  const emoji = input.emoji.trim();
  const link: CustomQuickAccessLink = {
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label,
    url,
    emoji,
    ...(input.faviconUrl ? { faviconUrl: input.faviconUrl } : {}),
  };
  saveCustomLinks([...loadCustomLinks(), link]);
  return link;
}

// Cambia nombre/URL/icono de un enlace YA guardado, conservando su id (y por tanto su color, que
// sale de un hash del id — ver colorForCustomLink) — a diferencia de addCustomLink, aquí si la URL
// cambia hay que volver a pedir el favicon (el viejo ya no pinta nada), así que `faviconUrl` no es
// opcional: quien llama (el formulario) siempre lo recalcula antes de guardar, aunque sea a `""`
// si no se consiguió sacar ninguno esta vez.
export function editCustomLink(
  id: string,
  input: { label: string; url: string; emoji: string; faviconUrl: string }
): CustomQuickAccessLink | null {
  const label = input.label.trim();
  const url = normalizeQuickAccessUrl(input.url);
  if (!label || !url) return null;
  const emoji = input.emoji.trim();
  let updated: CustomQuickAccessLink | null = null;
  const next = loadCustomLinks().map((link) => {
    if (link.id !== id) return link;
    updated = { id, label, url, emoji, ...(input.faviconUrl ? { faviconUrl: input.faviconUrl } : {}) };
    return updated;
  });
  if (!updated) return null;
  saveCustomLinks(next);
  return updated;
}

export function removeCustomLink(id: string): void {
  saveCustomLinks(loadCustomLinks().filter((link) => link.id !== id));
}

// Adapta un enlace personalizado a la misma forma que las apps del catálogo fijo, para poder
// reutilizar AppLogo y openQuickAccessApp sin duplicar nada (ver QuickAccessCard).
export function customLinkToApp(link: CustomQuickAccessLink): QuickAccessApp {
  return {
    id: link.id,
    label: link.label,
    color: colorForCustomLink(link.id),
    webUrl: link.url,
    emoji: link.emoji,
    ...(link.faviconUrl ? { faviconUrl: link.faviconUrl } : {}),
  };
}

// Pide el favicon del sitio al backend (mismo endpoint que la "miniatura web" del editor de texto
// enriquecido, ver RichTextEditor.tsx) — se llama al añadir o editar un enlace personalizado, NO
// en cada tecla escrita en el formulario (evita machacar la API mientras el usuario todavía está
// escribiendo la URL). Devuelve "" (no null) si falla o el sitio no tiene favicon: así el
// formulario puede guardar igual el enlace, solo que sin icono real — nunca bloquea el guardado.
export async function fetchFaviconFor(url: string): Promise<string> {
  try {
    const preview = await api.get<{ favicon: string | null }>(`/link-preview?url=${encodeURIComponent(url)}`);
    return preview.favicon ?? "";
  } catch {
    return "";
  }
}

// No existe una API de navegador para "¿esta app está instalada?" (por privacidad, ningún
// navegador la expone) — así que se usa el mismo truco indirecto que sitios como Slack o Spotify:
// se intenta navegar al esquema de la app y, si en un momento breve la pestaña NO ha perdido
// visibilidad (señal de que el SO ha cambiado de foco a otra app), se asume que no está instalada
// y se abre la web como alternativa. No es infalible — varía según navegador/SO — pero es lo
// mejor que se puede hacer sin salir del navegador.
const FALLBACK_DELAY_MS = 700;

export function openQuickAccessApp(app: QuickAccessApp): void {
  if (!app.appUrl) {
    window.open(app.webUrl, "_blank", "noopener,noreferrer");
    return;
  }

  // El fallback a la web llega tarde (dentro de un setTimeout, ver más abajo), y los navegadores
  // bloquean `window.open` fuera de una reacción SÍNCRONA a un gesto del usuario — así que abrir
  // la pestaña aquí (en el propio clic) y solo NAVEGARLA más tarde es lo que evita que el
  // bloqueador de pop-ups se coma el fallback. Sin `noopener`/`noreferrer`: los necesitamos
  // controlables desde aquí (con `noopener` la referencia devuelta puede venir nula).
  const fallbackTab = window.open("about:blank", "_blank");

  let handedOff = false;
  const onVisibilityChange = () => {
    if (document.hidden) handedOff = true;
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  window.location.href = app.appUrl;

  window.setTimeout(() => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    if (handedOff) {
      // El SO cambió de foco a la app — no hace falta la pestaña en blanco que se abrió "por si
      // acaso".
      fallbackTab?.close();
    } else if (fallbackTab) {
      fallbackTab.location.href = app.webUrl;
    } else {
      // El propio navegador bloqueó la pestaña en blanco (bloqueador de pop-ups estricto) —
      // última opción, en la pestaña actual.
      window.location.href = app.webUrl;
    }
  }, FALLBACK_DELAY_MS);
}
