// Recrea la cuenta demo (demo@lifeorganizer.dev / Password123) a partir de
// `prisma/fixtures/demoUser.json` — un snapshot completo generado con `npm run prisma:export-demo`
// (ver ese script). Este seed YA NO crea un par de eventos de ejemplo sueltos: reinicia TODO lo
// que cuelga del usuario demo y lo recrea tal cual estaba en la máquina donde se generó el
// fixture, para que la cuenta demo se vea igual en cualquier sitio donde se corra este seed (otro
// ordenador, el backend de producción — ver DEPLOYMENT.md#seed-de-datos-demo).
//
// Idempotente a propósito: correrlo dos veces seguidas da el mismo resultado (borra y recrea),
// así que actualizar el fixture y volver a correr `npm run prisma:seed` en cualquier máquina deja
// la cuenta demo al día sin arrastrar datos antiguos.
//
// Los ids del fixture son los que tenía en la base de datos de ORIGEN — la de destino les asigna
// los suyos propios (autoincrement), así que cualquier relación entre tablas (a qué planner
// pertenece una tarea, a qué campo personalizado corresponde un valor de `customFields`, a qué
// tarea pertenece una subtarea...) se remapea a mano con un `Map<idAntiguo, idNuevo>` por tabla,
// exactamente igual que hace `syncService` al mapear ids locales del móvil a ids de servidor.
import { PrismaClient, Prisma } from "@prisma/client";
import fs from "fs";
import path from "path";
import { hashPassword } from "../src/utils/password";
import { DemoUserFixture } from "./demoUserFixture";

const prisma = new PrismaClient();
const DEMO_EMAIL = "demo@lifeorganizer.dev";
const DEMO_PASSWORD = "Password123";
const FIXTURE_PATH = path.join(__dirname, "fixtures", "demoUser.json");

const toDate = (value: string | null | undefined): Date | null => (value ? new Date(value) : null);

function loadFixture(): DemoUserFixture {
  const raw = fs.readFileSync(FIXTURE_PATH, "utf-8");
  return JSON.parse(raw) as DemoUserFixture;
}

async function main() {
  const demoData = loadFixture();
  const password = await hashPassword(DEMO_PASSWORD);

  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {
      name: demoData.user.name,
      lastName: demoData.user.lastName,
      timezone: demoData.user.timezone,
    },
    create: {
      email: DEMO_EMAIL,
      username: demoData.user.username || "demo",
      password,
      name: demoData.user.name,
      lastName: demoData.user.lastName,
      timezone: demoData.user.timezone,
    },
  });

  // --- Reinicia todo lo que cuelga del usuario demo antes de recrearlo desde el fixture ---
  // El borrado en cascada del propio esquema (`onDelete: Cascade`) se encarga de los hijos de
  // cada uno de estos: Planner -> Task -> Subtask, Goal -> GoalProgress, Project -> ProjectPage/
  // ProjectTask, Habit -> HabitLog, CalendarLegendCategory -> CalendarDayMark, Schedule ->
  // ScheduleRow. `Task.projectId` es `SetNull` (no cascade) al borrar un Project, pero da igual:
  // las tareas ya se borran solas al borrar su Planner.
  await prisma.event.deleteMany({ where: { userId: user.id } });
  await prisma.goal.deleteMany({ where: { userId: user.id } });
  await prisma.transaction.deleteMany({ where: { userId: user.id } });
  await prisma.savingsGoal.deleteMany({ where: { userId: user.id } });
  await prisma.planner.deleteMany({ where: { userId: user.id } });
  await prisma.project.deleteMany({ where: { userId: user.id } });
  await prisma.note.deleteMany({ where: { userId: user.id } });
  await prisma.habit.deleteMany({ where: { userId: user.id } });
  await prisma.customPage.deleteMany({ where: { userId: user.id } });
  await prisma.schedule.deleteMany({ where: { userId: user.id } });
  await prisma.calendarLegendCategory.deleteMany({ where: { userId: user.id } });

  // --- Agenda: eventos + sus excepciones ---
  const eventIdMap = new Map<number, number>();
  for (const e of demoData.events) {
    const created = await prisma.event.create({
      data: {
        userId: user.id,
        title: e.title,
        description: e.description,
        type: e.type,
        startTime: toDate(e.startTime)!,
        endTime: toDate(e.endTime)!,
        location: e.location,
        isRecurring: e.isRecurring,
        recurringPattern: e.recurringPattern,
        recurringWeekdayStart: e.recurringWeekdayStart,
        recurringWeekdayEnd: e.recurringWeekdayEnd,
        reminderMinutesBefore: e.reminderMinutesBefore,
        guests: e.guests,
        // Se fuerza "tidely"/sin googleEventId: la conexión de Google (GoogleCalendarConnection)
        // no se exporta —no son credenciales portables—, así que ningún evento importado puede
        // seguir señalado como importado de una integración que no existe en esta máquina.
        source: "tidely",
        googleEventId: null,
      },
    });
    eventIdMap.set(e.id, created.id);
  }
  for (const ex of demoData.eventExceptions) {
    const eventId = eventIdMap.get(ex.eventId);
    if (!eventId) continue;
    await prisma.eventException.create({
      data: {
        eventId,
        originalStartTime: toDate(ex.originalStartTime)!,
        status: ex.status,
        newStartTime: toDate(ex.newStartTime),
        newEndTime: toDate(ex.newEndTime),
      },
    });
  }

  // --- Objetivos + su progreso ---
  const goalIdMap = new Map<number, number>();
  for (const g of demoData.goals) {
    const created = await prisma.goal.create({
      data: {
        userId: user.id,
        title: g.title,
        description: g.description,
        period: g.period,
        targetValue: g.targetValue,
        currentValue: g.currentValue,
        completed: g.completed,
        bonusPoints: g.bonusPoints,
        periodStart: toDate(g.periodStart)!,
        periodEnd: toDate(g.periodEnd)!,
        expired: g.expired,
        autoRenew: g.autoRenew,
      },
    });
    goalIdMap.set(g.id, created.id);
  }
  for (const gp of demoData.goalProgress) {
    const goalId = goalIdMap.get(gp.goalId);
    if (!goalId) continue;
    await prisma.goalProgress.create({
      data: { goalId, userId: user.id, value: gp.value, date: toDate(gp.date)!, note: gp.note },
    });
  }

  // --- Finanzas: transacciones + metas de ahorro (sin relación entre sí, ambas planas) ---
  for (const t of demoData.transactions) {
    await prisma.transaction.create({
      data: {
        userId: user.id,
        type: t.type,
        amount: t.amount,
        category: t.category,
        description: t.description,
        date: toDate(t.date)!,
      },
    });
  }
  for (const s of demoData.savingsGoals) {
    await prisma.savingsGoal.create({
      data: {
        userId: user.id,
        name: s.name,
        type: s.type,
        targetAmount: s.targetAmount,
        currentAmount: s.currentAmount,
        category: s.category,
        stepAmount: s.stepAmount,
        deadline: toDate(s.deadline),
      },
    });
  }

  // --- Proyectos + su libreta (páginas) y checklist ---
  const projectIdMap = new Map<number, number>();
  for (const p of demoData.projects) {
    const created = await prisma.project.create({
      data: {
        userId: user.id,
        title: p.title,
        description: p.description,
        status: p.status,
        priority: p.priority,
        deadline: toDate(p.deadline),
      },
    });
    projectIdMap.set(p.id, created.id);
  }
  for (const pp of demoData.projectPages) {
    const projectId = projectIdMap.get(pp.projectId);
    if (!projectId) continue;
    await prisma.projectPage.create({ data: { projectId, title: pp.title, content: pp.content, order: pp.order } });
  }
  for (const pt of demoData.projectTasks) {
    const projectId = projectIdMap.get(pt.projectId);
    if (!projectId) continue;
    await prisma.projectTask.create({
      data: { projectId, title: pt.title, completed: pt.completed, completedAt: toDate(pt.completedAt) },
    });
  }

  // --- Planificador: tableros, sus propiedades personalizadas, tareas y subtareas ---
  const plannerIdMap = new Map<number, number>();
  for (const pl of demoData.planners) {
    const created = await prisma.planner.create({ data: { userId: user.id, name: pl.name, order: pl.order } });
    plannerIdMap.set(pl.id, created.id);
  }
  // id de PlannerField antiguo -> nuevo: hace falta para remapear las CLAVES de Task.customFields
  // más abajo (cada clave es el id de un PlannerField, ver demoUserFixture.ts).
  const fieldIdMap = new Map<number, number>();
  for (const f of demoData.plannerFields) {
    const plannerId = plannerIdMap.get(f.plannerId);
    if (!plannerId) continue;
    const created = await prisma.plannerField.create({
      data: { plannerId, name: f.name, type: f.type, options: f.options, order: f.order },
    });
    fieldIdMap.set(f.id, created.id);
  }
  const taskIdMap = new Map<number, number>();
  for (const t of demoData.tasks) {
    const plannerId = plannerIdMap.get(t.plannerId);
    if (!plannerId) continue; // no debería pasar: toda tarea exportada tiene un planner
    const projectId = t.projectId != null ? projectIdMap.get(t.projectId) ?? null : null;
    const remappedCustomFields: Record<string, string | number | null> = {};
    for (const [oldFieldId, value] of Object.entries(t.customFields ?? {})) {
      const newFieldId = fieldIdMap.get(Number(oldFieldId));
      if (newFieldId !== undefined) remappedCustomFields[String(newFieldId)] = value;
    }
    const created = await prisma.task.create({
      data: {
        userId: user.id,
        plannerId,
        projectId,
        title: t.title,
        description: t.description,
        image: t.image,
        notes: t.notes,
        status: t.status,
        priority: t.priority,
        order: t.order,
        dueDate: toDate(t.dueDate),
        tags: t.tags,
        estimatedMinutes: t.estimatedMinutes,
        actualMinutes: t.actualMinutes,
        customFields: remappedCustomFields as Prisma.InputJsonValue,
      },
    });
    taskIdMap.set(t.id, created.id);
  }
  for (const st of demoData.subtasks) {
    const taskId = taskIdMap.get(st.taskId);
    if (!taskId) continue;
    await prisma.subtask.create({ data: { taskId, title: st.title, completed: st.completed } });
  }

  // --- Notas sueltas de la Agenda ---
  for (const n of demoData.notes) {
    await prisma.note.create({ data: { userId: user.id, content: n.content, checked: n.checked } });
  }

  // --- Hábitos + su historial de racha ---
  const habitIdMap = new Map<number, number>();
  for (const h of demoData.habits) {
    const created = await prisma.habit.create({ data: { userId: user.id, title: h.title, active: h.active } });
    habitIdMap.set(h.id, created.id);
  }
  for (const hl of demoData.habitLogs) {
    const habitId = habitIdMap.get(hl.habitId);
    if (!habitId) continue;
    await prisma.habitLog.create({ data: { habitId, userId: user.id, date: toDate(hl.date)! } });
  }

  // --- Páginas personalizadas (el `content` es un blob de cliente, se copia tal cual) ---
  for (const cp of demoData.customPages) {
    await prisma.customPage.create({
      data: {
        userId: user.id,
        title: cp.title,
        subtitle: cp.subtitle,
        template: cp.template,
        order: cp.order,
        content: cp.content as Prisma.InputJsonValue,
      },
    });
  }

  // --- Horario: horarios con nombre propio + sus filas ---
  const scheduleIdMap = new Map<number, number>();
  for (const s of demoData.schedules) {
    const created = await prisma.schedule.create({ data: { userId: user.id, name: s.name, order: s.order } });
    scheduleIdMap.set(s.id, created.id);
  }
  for (const row of demoData.scheduleRows) {
    const scheduleId = scheduleIdMap.get(row.scheduleId);
    if (!scheduleId) continue;
    await prisma.scheduleRow.create({
      data: {
        scheduleId,
        order: row.order,
        timeLabel: row.timeLabel,
        monday: row.monday,
        tuesday: row.tuesday,
        wednesday: row.wednesday,
        thursday: row.thursday,
        friday: row.friday,
      },
    });
  }

  // --- Leyenda del calendario anual + días pintados ---
  const categoryIdMap = new Map<number, number>();
  for (const c of demoData.calendarLegendCategories) {
    const created = await prisma.calendarLegendCategory.create({
      data: { userId: user.id, label: c.label, color: c.color, order: c.order },
    });
    categoryIdMap.set(c.id, created.id);
  }
  for (const mark of demoData.calendarDayMarks) {
    const categoryId = categoryIdMap.get(mark.categoryId);
    if (!categoryId) continue;
    await prisma.calendarDayMark.create({ data: { userId: user.id, categoryId, date: toDate(mark.date)! } });
  }

  console.log(`✅ Seed completado. Usuario demo: ${user.email} / ${DEMO_PASSWORD}`);
  console.log(`   Snapshot exportado el: ${demoData.exportedAt}`);
  console.log(
    `   Eventos: ${demoData.events.length} · Objetivos: ${demoData.goals.length} · ` +
      `Transacciones: ${demoData.transactions.length} · Proyectos: ${demoData.projects.length} · ` +
      `Planners: ${demoData.planners.length} (propiedades: ${demoData.plannerFields.length}) · ` +
      `Tareas: ${demoData.tasks.length} (subtareas: ${demoData.subtasks.length}) · ` +
      `Notas: ${demoData.notes.length} · Hábitos: ${demoData.habits.length} · ` +
      `Páginas: ${demoData.customPages.length} · Horarios: ${demoData.schedules.length}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
