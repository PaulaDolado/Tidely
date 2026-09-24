import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";
import { ForbiddenError, NotFoundError } from "../utils/errorHandler";
import { recordTombstone } from "./tombstoneService";
import { sanitizeJsonHtmlStrings } from "../utils/sanitizeHtml";

/**
 * Contenido inicial de una página nueva, según el modelo elegido en "+ Nueva página" (ver
 * AppShell/CreatePageModal en el dashboard). Cada plantilla tiene su propia forma de JSON — el
 * dashboard es quien sabe renderizarla y quien manda el JSON completo de vuelta en cada guardado
 * (igual que ProjectPage.content), así que aquí solo hace falta el estado "vacío" de cada una.
 */
function defaultContent(template: string): Prisma.InputJsonValue {
  switch (template) {
    case "kanban":
      return {
        columns: [
          { id: crypto.randomUUID(), title: "Por hacer", cards: [] },
          { id: crypto.randomUUID(), title: "En curso", cards: [] },
          { id: crypto.randomUUID(), title: "Hecho", cards: [] },
        ],
      };
    case "galeria":
      return { items: [] };
    case "finanzas":
      return { entries: [] };
    case "proyectos":
      return { items: [] };
    case "objetivos":
      return { goals: [] };
    case "agenda":
      return { items: [] };
    case "hoy":
      return { items: [] };
    case "nota":
    default:
      return { html: "" };
  }
}

export async function listCustomPages(userId: number) {
  const pages = await prisma.customPage.findMany({
    where: { userId },
    orderBy: { order: "asc" },
    select: { id: true, title: true, subtitle: true, icon: true, template: true, order: true, createdAt: true, updatedAt: true },
  });
  return { pages };
}

export async function createCustomPage(userId: number, title: string, template: string) {
  const last = await prisma.customPage.findFirst({ where: { userId }, orderBy: { order: "desc" } });
  return prisma.customPage.create({
    data: {
      userId,
      title: title.trim(),
      template,
      order: (last?.order ?? -1) + 1,
      content: defaultContent(template),
    },
  });
}

async function findOwnedPage(userId: number, pageId: number) {
  const page = await prisma.customPage.findUnique({ where: { id: pageId } });
  if (!page) throw new NotFoundError("Página no encontrada");
  if (page.userId !== userId) throw new ForbiddenError("No autorizado");
  return page;
}

export async function getCustomPage(userId: number, pageId: number) {
  return findOwnedPage(userId, pageId);
}

interface UpdateCustomPageInput {
  title?: string;
  // Cadena vacía se guarda como null (borra el subtítulo escrito por el usuario y vuelve al
  // icono+nombre de la plantilla por defecto, ver CustomPagePage) — no como "" literal.
  subtitle?: string | null;
  // Mismo criterio que `subtitle`: cadena vacía se guarda como null (quita el icono propio y
  // vuelve al de la plantilla por defecto).
  icon?: string | null;
  content?: Prisma.InputJsonValue;
  order?: number;
}

export async function updateCustomPage(userId: number, pageId: number, input: UpdateCustomPageInput) {
  await findOwnedPage(userId, pageId);
  return prisma.customPage.update({
    where: { id: pageId },
    data: {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.subtitle !== undefined ? { subtitle: input.subtitle?.trim() || null } : {}),
      ...(input.icon !== undefined ? { icon: input.icon?.trim() || null } : {}),
      ...(input.content !== undefined ? { content: sanitizeJsonHtmlStrings(input.content) } : {}),
      ...(input.order !== undefined ? { order: input.order } : {}),
    },
  });
}

export async function deleteCustomPage(userId: number, pageId: number) {
  await findOwnedPage(userId, pageId);
  await prisma.$transaction([
    prisma.customPage.delete({ where: { id: pageId } }),
    recordTombstone(prisma, userId, "customPage", pageId),
  ]);
}

// Intercambia el `order` con la página inmediatamente anterior/siguiente del usuario — igual
// patrón que scheduleService.moveRow, para reordenar el menú sin renumerar todas las páginas.
export async function moveCustomPage(userId: number, pageId: number, direction: "up" | "down") {
  const page = await findOwnedPage(userId, pageId);
  const neighbor = await prisma.customPage.findFirst({
    where: {
      userId,
      order: direction === "up" ? { lt: page.order } : { gt: page.order },
    },
    orderBy: { order: direction === "up" ? "desc" : "asc" },
  });
  if (!neighbor) return; // ya está en el extremo — no hay nada que intercambiar

  await prisma.$transaction([
    prisma.customPage.update({ where: { id: page.id }, data: { order: neighbor.order } }),
    prisma.customPage.update({ where: { id: neighbor.id }, data: { order: page.order } }),
  ]);
}
