import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as Print from "expo-print";

// Equivalente móvil de "descargar un archivo": en el navegador (ver downloadCsv/downloadTextFile
// en dashboard/src/utils/{financeExport,agendaExport}.ts) basta un <a download> sintético — aquí
// no hay carpeta de descargas del navegador, así que el archivo se escribe en la caché de la app
// y se abre la hoja nativa de "compartir/guardar en..." (Drive, Archivos, Gmail...), que es lo
// más parecido a "descargar algo" que existe en Android/iOS sin pedir permisos de almacenamiento.
function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "-").trim() || "archivo";
}

export async function saveAndShareText(content: string, filename: string, mimeType: string): Promise<void> {
  const file = new File(Paths.cache, sanitizeFilename(filename));
  if (file.exists) file.delete();
  file.create();
  file.write(content);

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Este dispositivo no permite compartir/guardar archivos.");
  }
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: filename });
}

// PDF: expo-print renderiza el HTML con el mismo motor que `window.print()` en el navegador (ver
// exportPagesToPdf/exportEventsToPdf en dashboard/src/utils/{notebookExport,agendaExport}.ts) —
// aquí no hay diálogo "Guardar como PDF" del sistema operativo, así que el PDF ya generado se
// comparte igual que el resto de exports (CSV, .ics) en vez de abrir un visor previo.
export async function exportHtmlToPdf(html: string, filename: string): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  const file = new File(uri);
  const target = new File(Paths.cache, sanitizeFilename(filename));
  if (target.exists) target.delete();
  file.moveSync(target);

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Este dispositivo no permite compartir/guardar archivos.");
  }
  await Sharing.shareAsync(target.uri, { mimeType: "application/pdf", dialogTitle: filename, UTI: "com.adobe.pdf" });
}
