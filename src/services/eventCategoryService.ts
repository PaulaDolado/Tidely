import { prisma } from "../config/database";
import { ForbiddenError, NotFoundError } from "../utils/errorHandler";

// Las 9 categorías con las que arranca una cuenta nueva (ver authService.register) — mismo
// nombre/color con el que antes venía la lista fija de "tipo" de evento (ver TYPE_LABELS en
// dashboard/src/pages/AgendaPage.tsx), pero ahora son filas normales: el usuario puede
// renombrarlas, cambiarles el color o borrarlas igual que cualquier categoría creada a mano. Las
// cuentas que ya existían cuando se introdujo esta tabla las recibieron en la migración
// 20260911120000_add_event_categories (mismo mapeo, ver ese migration.sql).
export const DEFAULT_EVENT_CATEGORIES: { label: string; color: string }[] = [
  { label: "Trabajo", color: "primary" },
  { label: "Estudio", color: "secondary" },
  { label: "Gimnasio", color: "hobby" },
  { label: "Reunión", color: "warning" },
  { label: "Evento", color: "positive" },
  { label: "Cita", color: "habit" },
  { label: "Cumpleaños", color: "negative" },
  { label: "Libre", color: "muted" },
  { label: "Otro", color: "muted" },
];

export async function seedDefaultCategories(userId: number) {
  await prisma.eventCategory.createMany({
    data: DEFAULT_EVENT_CATEGORIES.map((c, i) => ({ userId, label: c.label, color: c.color, order: i })),
  });
}

export async function listCategories(userId: number) {
  const categories = await prisma.eventCategory.findMany({
    where: { userId },
    orderBy: { order: "asc" },
  });
  return { categories };
}

export async function createCategory(userId: number, label: string, color: string) {
  const last = await prisma.eventCategory.findFirst({ where: { userId }, orderBy: { order: "desc" } });
  return prisma.eventCategory.create({
    data: { userId, label: label.trim(), color, order: (last?.order ?? -1) + 1 },
  });
}

// Exportada: la reutiliza agendaService para comprobar que el categoryId de un evento (al crearlo
// o editarlo) pertenece de verdad a quien hace la petición, antes de asignárselo.
export async function findOwnedCategory(userId: number, categoryId: number) {
  const category = await prisma.eventCategory.findUnique({ where: { id: categoryId } });
  if (!category) throw new NotFoundError("Categoría no encontrada");
  if (category.userId !== userId) throw new ForbiddenError("No autorizado");
  return category;
}

interface UpdateCategoryInput {
  label?: string;
  color?: string;
  order?: number;
}

export async function updateCategory(userId: number, categoryId: number, input: UpdateCategoryInput) {
  await findOwnedCategory(userId, categoryId);
  return prisma.eventCategory.update({
    where: { id: categoryId },
    data: {
      ...(input.label !== undefined ? { label: input.label.trim() } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.order !== undefined ? { order: input.order } : {}),
    },
  });
}

// Borrar una categoría NO borra los eventos que la usaban (ver Event.categoryId: onDelete
// SetNull en schema.prisma) — se quedan sin categoría, no desaparecen.
export async function deleteCategory(userId: number, categoryId: number) {
  await findOwnedCategory(userId, categoryId);
  await prisma.eventCategory.delete({ where: { id: categoryId } });
}
