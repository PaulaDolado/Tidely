// Vuelca TODOS los datos del usuario demo (demo@lifeorganizer.dev) de la base de datos a la que
// apunte DATABASE_URL/DIRECT_URL ahora mismo, a `prisma/fixtures/demoUser.json`.
//
// Para qué sirve: `seed.ts` ya no crea solo un par de eventos de ejemplo — recrea la cuenta demo
// COMPLETA a partir de ese fichero. Este script es el paso previo: "congela" lo que hay ahora
// mismo en tu base de datos local para que, en cualquier otra máquina (otro ordenador, el
// backend de producción...), `npm run prisma:seed` deje la cuenta demo exactamente igual —
// mismos eventos, planificador (con sus propiedades personalizadas), páginas personalizadas,
// proyectos, objetivos, finanzas, horario, hábitos, notas y leyenda del calendario anual.
//
// Uso: `npm run prisma:export-demo` (con DATABASE_URL apuntando a la base de datos de la que
// quieres tomar el snapshot — normalmente tu Postgres local). El fichero resultante se versiona
// en git, así que basta con hacer commit/pull para que "otro ordenador" tenga el mismo fixture.
//
// Qué NO se exporta (a propósito):
//   - GoogleCalendarConnection: son credenciales OAuth de una cuenta de Google real — no son
//     portables ni deben copiarse a otra máquina.
//   - Notification: se regeneran solas (ver src/jobs/notificationScheduler.ts), no son "datos"
//     del usuario en el sentido de este fixture.
//   - SyncTombstone: rastro interno para el sync del móvil, no tiene sentido en otra base de
//     datos con sus propios ids.
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { DemoUserFixture } from "./demoUserFixture";

const prisma = new PrismaClient();
const DEMO_EMAIL = "demo@lifeorganizer.dev";
const OUT_PATH = path.join(__dirname, "fixtures", "demoUser.json");

async function main() {
  const user = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!user) {
    throw new Error(
      `No existe ningún usuario ${DEMO_EMAIL} en la base de datos de DATABASE_URL — nada que exportar.`
    );
  }

  const [
    events,
    eventExceptions,
    goals,
    goalProgress,
    transactions,
    savingsGoals,
    projects,
    projectPages,
    projectTasks,
    planners,
    plannerFields,
    tasks,
    subtasks,
    notes,
    habits,
    habitLogs,
    customPages,
    schedules,
    scheduleRows,
    calendarLegendCategories,
    calendarDayMarks,
  ] = await Promise.all([
    prisma.event.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } }),
    prisma.eventException.findMany({ where: { event: { userId: user.id } }, orderBy: { id: "asc" } }),
    prisma.goal.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } }),
    prisma.goalProgress.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } }),
    prisma.transaction.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } }),
    prisma.savingsGoal.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } }),
    prisma.project.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } }),
    prisma.projectPage.findMany({ where: { project: { userId: user.id } }, orderBy: { id: "asc" } }),
    prisma.projectTask.findMany({ where: { project: { userId: user.id } }, orderBy: { id: "asc" } }),
    prisma.planner.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } }),
    prisma.plannerField.findMany({ where: { planner: { userId: user.id } }, orderBy: { id: "asc" } }),
    prisma.task.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } }),
    prisma.subtask.findMany({ where: { task: { userId: user.id } }, orderBy: { id: "asc" } }),
    prisma.note.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } }),
    prisma.habit.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } }),
    prisma.habitLog.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } }),
    prisma.customPage.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } }),
    prisma.schedule.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } }),
    prisma.scheduleRow.findMany({ where: { schedule: { userId: user.id } }, orderBy: { id: "asc" } }),
    prisma.calendarLegendCategory.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } }),
    prisma.calendarDayMark.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } }),
  ]);

  // JSON.stringify ya convierte Date -> ISO string y Decimal -> string (ambos implementan
  // toJSON()) — no hace falta tocar nada de tipos aquí, solo elegir qué columnas de cada fila
  // guardar (sin `id`/`userId`/`createdAt`/`updatedAt` salvo cuando el `id` hace falta para
  // remapear relaciones al importar, ver demoUserFixture.ts).
  const fixture: DemoUserFixture = {
    exportedAt: new Date().toISOString(),
    user: {
      email: user.email,
      username: user.username,
      name: user.name,
      lastName: user.lastName,
      timezone: user.timezone,
    },
    events: events.map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      type: e.type,
      startTime: e.startTime.toISOString(),
      endTime: e.endTime.toISOString(),
      location: e.location,
      isRecurring: e.isRecurring,
      recurringPattern: e.recurringPattern,
      recurringWeekdayStart: e.recurringWeekdayStart,
      recurringWeekdayEnd: e.recurringWeekdayEnd,
      reminderMinutesBefore: e.reminderMinutesBefore,
      guests: e.guests,
      // Se fuerza "tidely" al importar (ver seed.ts) porque la conexión de Google no se exporta
      // — se guarda el original solo para que quede constancia en el fixture.
      source: e.source,
    })),
    eventExceptions: eventExceptions.map((ex) => ({
      eventId: ex.eventId,
      originalStartTime: ex.originalStartTime.toISOString(),
      status: ex.status,
      newStartTime: ex.newStartTime?.toISOString() ?? null,
      newEndTime: ex.newEndTime?.toISOString() ?? null,
    })),
    goals: goals.map((g) => ({
      id: g.id,
      title: g.title,
      description: g.description,
      period: g.period,
      targetValue: g.targetValue,
      currentValue: g.currentValue,
      completed: g.completed,
      bonusPoints: g.bonusPoints,
      periodStart: g.periodStart.toISOString(),
      periodEnd: g.periodEnd.toISOString(),
      expired: g.expired,
      autoRenew: g.autoRenew,
    })),
    goalProgress: goalProgress.map((gp) => ({
      goalId: gp.goalId,
      value: gp.value,
      date: gp.date.toISOString(),
      note: gp.note,
    })),
    transactions: transactions.map((t) => ({
      type: t.type,
      amount: t.amount.toString(),
      category: t.category,
      description: t.description,
      date: t.date.toISOString(),
    })),
    savingsGoals: savingsGoals.map((s) => ({
      name: s.name,
      type: s.type,
      targetAmount: s.targetAmount.toString(),
      currentAmount: s.currentAmount.toString(),
      category: s.category,
      stepAmount: s.stepAmount.toString(),
      deadline: s.deadline?.toISOString() ?? null,
    })),
    projects: projects.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      status: p.status,
      priority: p.priority,
      deadline: p.deadline?.toISOString() ?? null,
    })),
    projectPages: projectPages.map((pp) => ({
      projectId: pp.projectId,
      title: pp.title,
      content: pp.content,
      order: pp.order,
    })),
    projectTasks: projectTasks.map((pt) => ({
      projectId: pt.projectId,
      title: pt.title,
      completed: pt.completed,
      completedAt: pt.completedAt?.toISOString() ?? null,
    })),
    planners: planners.map((pl) => ({ id: pl.id, name: pl.name, order: pl.order })),
    plannerFields: plannerFields.map((f) => ({
      id: f.id,
      plannerId: f.plannerId,
      name: f.name,
      type: f.type,
      options: f.options,
      order: f.order,
    })),
    tasks: tasks.map((t) => ({
      id: t.id,
      plannerId: t.plannerId,
      projectId: t.projectId,
      title: t.title,
      description: t.description,
      image: t.image,
      notes: t.notes,
      status: t.status,
      priority: t.priority,
      order: t.order,
      dueDate: t.dueDate?.toISOString() ?? null,
      tags: t.tags,
      estimatedMinutes: t.estimatedMinutes,
      actualMinutes: t.actualMinutes,
      customFields: (t.customFields ?? {}) as Record<string, string | number | null>,
    })),
    subtasks: subtasks.map((st) => ({ taskId: st.taskId, title: st.title, completed: st.completed })),
    notes: notes.map((n) => ({ content: n.content, checked: n.checked })),
    habits: habits.map((h) => ({ id: h.id, title: h.title, active: h.active })),
    habitLogs: habitLogs.map((hl) => ({ habitId: hl.habitId, date: hl.date.toISOString() })),
    customPages: customPages.map((cp) => ({
      title: cp.title,
      subtitle: cp.subtitle,
      template: cp.template,
      order: cp.order,
      content: (cp.content ?? {}) as Record<string, unknown>,
    })),
    schedules: schedules.map((s) => ({ id: s.id, name: s.name, order: s.order })),
    scheduleRows: scheduleRows.map((row) => ({
      scheduleId: row.scheduleId,
      order: row.order,
      timeLabel: row.timeLabel,
      monday: row.monday,
      tuesday: row.tuesday,
      wednesday: row.wednesday,
      thursday: row.thursday,
      friday: row.friday,
    })),
    calendarLegendCategories: calendarLegendCategories.map((c) => ({
      id: c.id,
      label: c.label,
      color: c.color,
      order: c.order,
    })),
    calendarDayMarks: calendarDayMarks.map((m) => ({ categoryId: m.categoryId, date: m.date.toISOString() })),
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(fixture, null, 2) + "\n");

  console.log(`✅ Exportados los datos de ${DEMO_EMAIL} a ${path.relative(process.cwd(), OUT_PATH)}`);
  console.log(
    `   Eventos: ${events.length} · Objetivos: ${goals.length} · Transacciones: ${transactions.length} · ` +
      `Ahorro: ${savingsGoals.length} · Proyectos: ${projects.length} · Planners: ${planners.length} ` +
      `(propiedades: ${plannerFields.length}) · Tareas: ${tasks.length} (subtareas: ${subtasks.length}) · ` +
      `Notas: ${notes.length} · Hábitos: ${habits.length} · Páginas: ${customPages.length} · ` +
      `Horarios: ${schedules.length} · Categorías de calendario: ${calendarLegendCategories.length}`
  );
  console.log("   Ejecuta `npm run prisma:seed` (con DATABASE_URL apuntando al destino) para aplicarlo allí.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
