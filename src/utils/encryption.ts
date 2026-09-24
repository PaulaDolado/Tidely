import crypto from "crypto";
import { env } from "../config/environment";

// Los access/refresh token de Google Calendar (ver GoogleCalendarConnection en schema.prisma) son
// credenciales de verdad — con el refresh token guardado en la base de datos, cualquiera con
// acceso de lectura a un volcado/leak de la BD podría leer el calendario de Google de cualquier
// usuario que hubiera conectado la integración indefinidamente (el refresh token no caduca por sí
// solo). AES-256-GCM (autenticado: si alguien manipula el ciphertext, decrypt() lo detecta y
// lanza, en vez de devolver basura silenciosamente) con una clave que vive SOLO en la variable de
// entorno ENCRYPTION_KEY, nunca en la base de datos — un leak de la BD sola ya no basta para leer
// estos tokens.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recomendado para GCM (96 bits)
// Prefijo que distingue un valor ya cifrado por esta versión de uno en texto plano de antes de
// que existiera esto — ningún token real de Google empieza así, así que sirve para una migración
// perezosa sin script aparte: decrypt() devuelve tal cual cualquier valor SIN este prefijo (un
// token viejo en claro), y el siguiente sitio que reescriba ese campo (login, refresco periódico
// del access token) lo vuelve a guardar ya cifrado, sin downtime ni tocar la base de datos a mano.
const PREFIX = "enc:v1:";

function getKey(): Buffer {
  const raw = env.encryptionKey;
  if (!raw) {
    throw new Error(
      "Falta ENCRYPTION_KEY — hace falta para leer/guardar credenciales de Google Calendar cifradas (ver .env.example)"
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY debe decodificar a 32 bytes en base64 (AES-256) — genera una con crypto.randomBytes(32).toString('base64')");
  }
  return key;
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return PREFIX + [iv, authTag, ciphertext].map((b) => b.toString("base64")).join(":");
}

// Devuelve `value` tal cual si no lleva el prefijo (ver PREFIX) — dato en claro de antes de que
// existiera el cifrado, no un valor corrupto: dejarlo pasar es justo lo que permite la migración
// perezosa sin script aparte.
export function decrypt(value: string): string {
  if (!value.startsWith(PREFIX)) return value;
  const [ivB64, authTagB64, ciphertextB64] = value.slice(PREFIX.length).split(":");
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error("Valor cifrado con formato inválido");
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, "base64")), decipher.final()]);
  return plaintext.toString("utf8");
}
