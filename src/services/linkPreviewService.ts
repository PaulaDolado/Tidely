import dns from "dns/promises";
import net from "net";
import { ValidationError } from "../utils/errorHandler";

// Genera la "miniatura web" (bookmark card) del editor de páginas: el navegador del usuario no
// puede leer el <head> de una web ajena por CORS, así que la petición la hace el servidor y le
// devuelve al dashboard solo lo que necesita (título, descripción, imagen).
//
// Como esto es "el backend hace una petición HTTP a una URL que manda el usuario", hay que
// blindarlo contra SSRF: nada de localhost/IPs privadas (ni por IP literal ni por DNS que
// resuelva a una), tamaño de respuesta acotado y timeout corto.

const FETCH_TIMEOUT_MS = 6000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2MB de HTML es de sobra para leer <head>
const USER_AGENT = "Mozilla/5.0 (compatible; TidelyBot/1.0; +link-preview)";

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string;
}

function isPrivateIp(ip: string): boolean {
  if (net.isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // link-local / metadata (169.254.169.254 en clouds)
    if (a === 0) return true;
    return false;
  }
  if (net.isIP(ip) === 6) {
    const normalized = ip.toLowerCase();
    if (normalized === "::1") return true; // loopback
    if (normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // link-local / ULA
    if (normalized.startsWith("::ffff:")) return isPrivateIp(normalized.slice(7)); // IPv4-mapped
    return false;
  }
  return false;
}

async function assertPublicHost(hostname: string): Promise<void> {
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new ValidationError("No se puede previsualizar una URL local");
  }
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new ValidationError("No se puede previsualizar esa URL");
    return;
  }
  // Resolvemos el hostname nosotros y comprobamos la IP real: evita que un dominio público
  // apunte (DNS rebinding) a una IP interna en el momento de la petición.
  let addresses: { address: string }[];
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new ValidationError("No se pudo resolver esa URL");
  }
  if (addresses.some((a) => isPrivateIp(a.address))) {
    throw new ValidationError("No se puede previsualizar esa URL");
  }
}

function extractMeta(html: string, ...names: string[]): string | null {
  for (const name of names) {
    // Cubre tanto <meta property="og:title" content="..."> como el orden de atributos inverso.
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)["']`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${name}["']`, "i"),
    ];
    for (const re of patterns) {
      const match = html.match(re);
      if (match?.[1]) return decodeHtmlEntities(match[1]);
    }
  }
  return null;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

function resolveUrl(maybeRelative: string, base: string): string | null {
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return null;
  }
}

// Cuántas redirecciones seguimos como máximo antes de rendirnos — solo para no quedarnos
// atrapados en un bucle si una web ajena redirige a sí misma sin parar; 5 es de sobra para
// cualquier cadena de redirección legítima (acortadores de enlaces normalmente dan 1-2 saltos).
const MAX_REDIRECTS = 5;

// `redirect: "manual"` a propósito, NO "follow": con "follow", `fetch` seguiría la redirección
// él solo SIN volver a pasar por assertPublicHost — un servidor controlado por el atacante podría
// devolver una URL pública válida (pasa la validación de arriba) que a su vez redirige (302) a
// `http://169.254.169.254/...` (metadatos de la nube) o a un host interno, y el SSRF que
// assertPublicHost pretende evitar se colaría igualmente por esta puerta trasera. Aquí seguimos
// la cadena nosotros mismos, validando CADA salto como si fuera la URL original.
async function fetchWithLimits(startUrl: URL): Promise<string> {
  let url = startUrl;
  for (let hop = 0; ; hop++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url.toString(), {
        signal: controller.signal,
        redirect: "manual",
        headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new ValidationError("La web redirige sin indicar a dónde");
      if (hop >= MAX_REDIRECTS) throw new ValidationError("Demasiadas redirecciones al previsualizar esa URL");
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        throw new ValidationError("La web redirige a una URL inválida");
      }
      if (next.protocol !== "http:" && next.protocol !== "https:") {
        throw new ValidationError("Solo se admiten URLs http/https");
      }
      await assertPublicHost(next.hostname);
      url = next;
      continue;
    }

    if (!response.ok || !response.body) {
      throw new ValidationError(`La web respondió con un error (${response.status})`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      throw new ValidationError("Esa URL no es una página web (HTML)");
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf-8");
  }
}

export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreview> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ValidationError("URL inválida");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ValidationError("Solo se admiten URLs http/https");
  }
  await assertPublicHost(parsed.hostname);

  const html = await fetchWithLimits(parsed);

  const title = extractMeta(html, "og:title", "twitter:title") ?? (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? null);
  const description = extractMeta(html, "og:description", "twitter:description", "description");
  const rawImage = extractMeta(html, "og:image", "twitter:image");
  const image = rawImage ? resolveUrl(rawImage, parsed.toString()) : null;
  const siteName = extractMeta(html, "og:site_name") ?? parsed.hostname.replace(/^www\./, "");

  return {
    url: parsed.toString(),
    title: title ? decodeHtmlEntities(title).trim().slice(0, 300) : null,
    description: description ? description.trim().slice(0, 500) : null,
    image,
    siteName,
  };
}
