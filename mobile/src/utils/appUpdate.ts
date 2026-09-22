import { Platform } from "react-native";
import appJson from "../../app.json";

// Android no deja que una app instalada "por fuera" de Play Store (nuestro caso: .apk publicado
// en GitHub Releases, ver DEPLOYMENT.md) se actualice sola en segundo plano — es una restricción
// del propio sistema operativo, no de esta app. Esto es lo más cerca de "automático" que se puede
// llegar sin publicar en Play Store: al abrir la app se comprueba si hay una versión más nueva
// publicada y, si la hay, se ofrece un botón que abre la descarga directa — el usuario solo tiene
// que confirmar la instalación cuando Android se lo pida, no ir a buscar el enlace a mano.
//
// La versión "de este build" es `expo.version` de app.json en el momento de compilar — el
// workflow de release (.github/workflows/release.yml) la sobrescribe con el tag `vX.Y.Z` justo
// antes de compilar el .apk, así que lo que se compara aquí siempre coincide con el tag publicado.
const REPO = "PaulaDolado/Tidely";
const APK_DOWNLOAD_URL = `https://github.com/${REPO}/releases/latest/download/Tidely.apk`;
const LOCAL_VERSION = appJson.expo.version;

export interface AvailableUpdate {
  version: string;
  downloadUrl: string;
}

function parseVersion(v: string): number[] {
  return v
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number(part) || 0);
}

// true si `remote` es estrictamente mayor que `local`, comparando por partes (mayor.menor.parche)
// en vez de comparar los strings tal cual — "1.10.0" sería (incorrectamente) "menor" que "1.9.0"
// comparado como texto.
function isNewer(remote: string, local: string): boolean {
  const r = parseVersion(remote);
  const l = parseVersion(local);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rv = r[i] ?? 0;
    const lv = l[i] ?? 0;
    if (rv !== lv) return rv > lv;
  }
  return false;
}

/**
 * Consulta el último Release de GitHub y, si trae una versión más nueva que este build, la
 * devuelve junto al enlace de descarga directa del .apk. `null` si ya está al día, si falla la
 * consulta (sin red, API caída…) o si no es Android — iOS/web/escritorio se actualizan por otras
 * vías (App Store, recargar la página, o no aplica).
 */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (Platform.OS !== "android") return null;
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
    if (!response.ok) return null;
    const data = await response.json();
    const remoteVersion: string | undefined = data?.tag_name;
    if (!remoteVersion || !isNewer(remoteVersion, LOCAL_VERSION)) return null;
    return { version: remoteVersion.replace(/^v/i, ""), downloadUrl: APK_DOWNLOAD_URL };
  } catch {
    return null;
  }
}
