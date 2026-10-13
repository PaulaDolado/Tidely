import { File, Paths } from "expo-file-system";
import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import * as Crypto from "expo-crypto";
import { Trip, TripAttachment } from "../api/customPages";

// Archivos adjuntos de "Detalles del transporte" (tarjetas de embarque, billetes…). Igual que en la
// web viven DENTRO del JSON de `content` como data URL, así que el backend (límite de 8.000.000
// caracteres por página, ver CONTENT_BYTE_LIMIT en src/validators/customPagesValidators.ts) obliga a
// poner topes: uno por archivo y un presupuesto global para todos los adjuntos de la página.

export const MAX_ATTACHMENT_BYTES = 1.5 * 1024 * 1024; // 1,5 MB por archivo (bytes reales)
export const MAX_ATTACHMENTS_CHARS = 4_000_000; // suma de dataUrl.length de TODOS los viajes

export const FILE_TOO_BIG_MESSAGE = "El archivo supera 1,5 MB. Prueba con uno más pequeño.";
export const ATTACHMENTS_LIMIT_MESSAGE = "Has llegado al límite de archivos adjuntos de esta página. Elimina alguno para poder añadir más.";

const EXTENSION_MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
};

/** Caracteres que ocupa un adjunto dentro del JSON (lo que cuenta para el presupuesto global). */
export function attachmentChars(attachments: TripAttachment[] | undefined): number {
  return (attachments ?? []).reduce((sum, a) => sum + a.dataUrl.length, 0);
}

/** Total de caracteres de adjuntos de transporte en TODOS los viajes de la página. */
export function totalAttachmentChars(trips: Trip[]): number {
  return trips.reduce((sum, t) => sum + (t.transport ?? []).reduce((s, d) => s + attachmentChars(d.attachments), 0), 0);
}

function guessMime(name: string, picked?: string): string {
  if (picked && picked !== "application/octet-stream") return picked;
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return EXTENSION_MIME[ext] ?? picked ?? "application/octet-stream";
}

export type PickAttachmentResult = { attachment: TripAttachment } | { error: string } | null;

/**
 * Abre el selector de documentos (PDF e imágenes) y devuelve el archivo como data URL.
 * `usedChars` = caracteres ya gastados por el resto de adjuntos (los de otros viajes/entradas y los
 * que el formulario aún no ha guardado). Devuelve null si se cancela y {error} si no cabe.
 */
export async function pickAttachment(usedChars: number): Promise<PickAttachmentResult> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["application/pdf", "image/*"],
    copyToCacheDirectory: true, // para poder leerlo enseguida con expo-file-system
    multiple: false,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  const mime = guessMime(asset.name, asset.mimeType);
  if (mime !== "application/pdf" && !mime.startsWith("image/")) return { error: "Solo se pueden adjuntar PDF o imágenes." };

  const file = new File(asset.uri);
  // Se mira el tamaño ANTES de leerlo para no cargar en memoria un archivo enorme.
  const size = asset.size ?? file.size;
  if (size > MAX_ATTACHMENT_BYTES) return { error: FILE_TOO_BIG_MESSAGE };

  const prefix = `data:${mime};base64,`;
  // base64 ocupa 4 caracteres por cada 3 bytes (con relleno).
  if (usedChars + prefix.length + Math.ceil(size / 3) * 4 > MAX_ATTACHMENTS_CHARS) return { error: ATTACHMENTS_LIMIT_MESSAGE };

  const base64 = await file.base64();
  const dataUrl = `${prefix}${base64}`;
  // Comprobación definitiva con el tamaño real por si `asset.size` no venía o no era exacto.
  if (base64.length * 0.75 > MAX_ATTACHMENT_BYTES) return { error: FILE_TOO_BIG_MESSAGE };
  if (usedChars + dataUrl.length > MAX_ATTACHMENTS_CHARS) return { error: ATTACHMENTS_LIMIT_MESSAGE };

  return { attachment: { id: Crypto.randomUUID(), name: asset.name || "archivo", mime, size, dataUrl } };
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "-").trim() || "archivo";
}

/** Escribe el adjunto en la caché y abre la hoja nativa de compartir/abrir (como utils/fileExport.ts). */
export async function openAttachment(att: TripAttachment): Promise<void> {
  const comma = att.dataUrl.indexOf(",");
  if (!att.dataUrl.startsWith("data:") || comma < 0) throw new Error("El archivo adjunto está dañado.");
  const base64 = att.dataUrl.slice(comma + 1);

  // El prefijo con el id evita pisar el archivo de otro adjunto con el mismo nombre.
  const file = new File(Paths.cache, `${att.id.slice(0, 8)}-${sanitizeFilename(att.name)}`);
  if (file.exists) file.delete();
  file.create();
  file.write(base64, { encoding: "base64" });

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Este dispositivo no permite compartir/abrir archivos.");
  }
  await Sharing.shareAsync(file.uri, {
    mimeType: att.mime,
    dialogTitle: att.name,
    UTI: att.mime === "application/pdf" ? "com.adobe.pdf" : att.mime.startsWith("image/") ? "public.image" : undefined,
  });
}
