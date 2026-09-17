import request from "supertest";
import { app } from "../../src/app";
import { prisma } from "../../src/config/database";

describe("Sync Endpoints", () => {
  let token: string;
  // Ver el mismo comentario en tests/integration/agenda.test.ts.
  let categoryIds: Record<string, number>;

  beforeEach(async () => {
    await prisma.syncTombstone.deleteMany({});
    await prisma.habitLog.deleteMany({});
    await prisma.habit.deleteMany({});
    await prisma.note.deleteMany({});
    await prisma.subtask.deleteMany({});
    await prisma.task.deleteMany({});
    await prisma.eventException.deleteMany({});
    await prisma.event.deleteMany({});
    await prisma.calendarDayMark.deleteMany({});
    await prisma.calendarLegendCategory.deleteMany({});
    await prisma.customPage.deleteMany({});
    await prisma.scheduleRow.deleteMany({});
    await prisma.schedule.deleteMany({});
    await prisma.projectPage.deleteMany({});
    await prisma.projectTask.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.goalProgress.deleteMany({});
    await prisma.goal.deleteMany({});
    await prisma.transaction.deleteMany({});
    await prisma.savingsGoal.deleteMany({});
    await prisma.user.deleteMany({});

    const response = await request(app).post("/auth/register").send({
      username: "sync",
      email: "sync@example.com",
      password: "Password123",
      name: "Sync User",
      timezone: "UTC",
    });
    token = response.body.token;

    const categories = await request(app).get("/event-categories").set({ Authorization: `Bearer ${token}` });
    categoryIds = Object.fromEntries(categories.body.categories.map((c: { id: number; label: string }) => [c.label, c.id]));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function authed() {
    return { Authorization: `Bearer ${token}` };
  }

  describe("GET /sync/pull", () => {
    it("sin `since`, devuelve todo lo del usuario (bootstrap) junto con un cursor serverTime", async () => {
      await request(app)
        .post("/agenda/events")
        .set(authed())
        .send({ title: "Reunión", categoryId: categoryIds["Trabajo"], startTime: "2026-09-01T10:00:00.000Z", endTime: "2026-09-01T11:00:00.000Z" });
      await request(app).post("/planner/tasks").set(authed()).send({ title: "Informe" });
      await request(app).post("/notes").set(authed()).send({ content: "Comprar leche" });
      await request(app).post("/habits").set(authed()).send({ title: "Leer" });

      const response = await request(app).get("/sync/pull").set(authed());

      expect(response.status).toBe(200);
      expect(response.body.serverTime).toBeDefined();
      expect(response.body.events).toHaveLength(1);
      expect(response.body.tasks).toHaveLength(1);
      expect(response.body.notes).toHaveLength(1);
      expect(response.body.habits).toHaveLength(1);
      expect(response.body.tombstones).toEqual([]);
    });

    it("con `since`, solo devuelve lo cambiado después de ese cursor", async () => {
      const first = await request(app).get("/sync/pull").set(authed());
      const cursor = first.body.serverTime;

      await request(app).post("/notes").set(authed()).send({ content: "Nota nueva" });

      const second = await request(app).get("/sync/pull").set(authed()).query({ since: cursor });

      expect(second.body.notes).toHaveLength(1);
      expect(second.body.notes[0].content).toBe("Nota nueva");
    });

    it("borrar una tarea existente aparece como tombstone en el siguiente pull", async () => {
      const task = await request(app).post("/planner/tasks").set(authed()).send({ title: "Borrar luego" });
      const cursor = (await request(app).get("/sync/pull").set(authed())).body.serverTime;

      await request(app).delete(`/planner/tasks/${task.body.id}`).set(authed());

      const response = await request(app).get("/sync/pull").set(authed()).query({ since: cursor });

      expect(response.body.tombstones).toHaveLength(1);
      expect(response.body.tombstones[0]).toMatchObject({ entityType: "task", entityId: task.body.id });
    });
  });

  describe("POST /sync/push", () => {
    it("crea un evento, tarea, nota y hábito enviados con localId, y devuelve el mapeo de ids", async () => {
      const response = await request(app)
        .post("/sync/push")
        .set(authed())
        .send({
          events: {
            create: [
              {
                localId: "11111111-1111-1111-1111-111111111111",
                title: "Creado offline",
                categoryId: categoryIds["Trabajo"],
                startTime: "2026-09-05T09:00:00.000Z",
                endTime: "2026-09-05T10:00:00.000Z",
              },
            ],
          },
          tasks: {
            create: [{ localId: "22222222-2222-2222-2222-222222222222", title: "Tarea offline" }],
          },
          notes: {
            create: [{ localId: "33333333-3333-3333-3333-333333333333", content: "Nota offline", checked: true }],
          },
          habits: {
            create: [{ localId: "44444444-4444-4444-4444-444444444444", title: "Hábito offline" }],
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.idMappings).toHaveLength(4);
      expect(response.body.conflicts).toEqual([]);

      const noteMapping = response.body.idMappings.find((m: { entityType: string }) => m.entityType === "note");
      const note = await prisma.note.findUnique({ where: { id: noteMapping.id } });
      expect(note?.checked).toBe(true); // el "completed en creación" offline se aplicó

      const pull = await request(app).get("/sync/pull").set(authed());
      expect(pull.body.events).toHaveLength(1);
      expect(pull.body.tasks).toHaveLength(1);
    });

    it("aplica una edición offline más reciente que la del servidor", async () => {
      const task = await request(app).post("/planner/tasks").set(authed()).send({ title: "Original" });

      const response = await request(app)
        .post("/sync/push")
        .set(authed())
        .send({
          tasks: {
            update: [{ id: task.body.id, clientUpdatedAt: new Date(Date.now() + 60_000).toISOString(), title: "Editado offline" }],
          },
        });

      expect(response.body.conflicts).toEqual([]);
      const updated = await prisma.task.findUnique({ where: { id: task.body.id } });
      expect(updated?.title).toBe("Editado offline");
    });

    it("descarta una edición offline más antigua que la del servidor y la reporta como conflicto", async () => {
      const task = await request(app).post("/planner/tasks").set(authed()).send({ title: "Original" });
      await request(app).put(`/planner/tasks/${task.body.id}`).set(authed()).send({ title: "Editado desde la web" });

      const response = await request(app)
        .post("/sync/push")
        .set(authed())
        .send({
          tasks: {
            update: [{ id: task.body.id, clientUpdatedAt: new Date(Date.now() - 60_000).toISOString(), title: "Editado offline viejo" }],
          },
        });

      expect(response.body.conflicts).toEqual([{ entityType: "task", id: task.body.id }]);
      const current = await prisma.task.findUnique({ where: { id: task.body.id } });
      expect(current?.title).toBe("Editado desde la web");
    });

    it("borrar algo que ya no existe (ya sincronizado desde otro dispositivo) es idempotente, no un error", async () => {
      const note = await request(app).post("/notes").set(authed()).send({ content: "Efímera" });
      await request(app).delete(`/notes/${note.body.id}`).set(authed());

      const response = await request(app)
        .post("/sync/push")
        .set(authed())
        .send({ deletes: [{ entityType: "note", id: note.body.id }] });

      expect(response.status).toBe(200);
    });

    it("crear un registro de hábito repetido para el mismo día no duplica ni falla (alta idempotente)", async () => {
      const habit = await request(app).post("/habits").set(authed()).send({ title: "Meditar" });
      const payload = { habitLogs: { create: [{ habitId: habit.body.id, date: "2026-09-10" }] } };

      await request(app).post("/sync/push").set(authed()).send(payload);
      const second = await request(app).post("/sync/push").set(authed()).send(payload);

      expect(second.status).toBe(200);
      const logs = await prisma.habitLog.findMany({ where: { habitId: habit.body.id } });
      expect(logs).toHaveLength(1);
    });

    it("borrar un habitLog vía sync desmarca el día", async () => {
      const habit = await request(app).post("/habits").set(authed()).send({ title: "Meditar" });
      await request(app)
        .post("/sync/push")
        .set(authed())
        .send({ habitLogs: { create: [{ habitId: habit.body.id, date: "2026-09-11" }] } });

      const response = await request(app)
        .post("/sync/push")
        .set(authed())
        .send({ deletes: [{ entityType: "habitLog", habitId: habit.body.id, date: "2026-09-11" }] });

      expect(response.status).toBe(200);
      const logs = await prisma.habitLog.findMany({ where: { habitId: habit.body.id } });
      expect(logs).toHaveLength(0);
    });

    it("rechaza un push mal formado (falta un campo requerido)", async () => {
      const response = await request(app)
        .post("/sync/push")
        .set(authed())
        .send({ tasks: { create: [{ localId: "not-a-uuid", title: "x" }] } });

      expect(response.status).toBe(400);
    });
  });

  describe("Fase 2: Finanzas, Objetivos, Proyectos, Horario, Páginas", () => {
    it("el bootstrap de pull también trae transacciones, metas, proyectos, horarios y páginas", async () => {
      await request(app).post("/finance/transactions").set(authed()).send({ type: "expense", amount: 10, category: "comida" });
      await request(app).post("/goals").set(authed()).send({ title: "Leer", period: "weekly", targetValue: 3 });
      await request(app).post("/projects").set(authed()).send({ title: "Reforma" });
      await request(app).post("/schedule").set(authed()).send({ name: "1r trimestre" });
      await request(app).post("/custom-pages").set(authed()).send({ title: "Mi nota", template: "nota" });

      const response = await request(app).get("/sync/pull").set(authed());

      expect(response.body.transactions).toHaveLength(1);
      expect(response.body.goals).toHaveLength(1);
      expect(response.body.projects).toHaveLength(1);
      expect(response.body.schedules).toHaveLength(1);
      expect(response.body.customPages).toHaveLength(1);
    });

    it("crea una transacción offline y aparece en el siguiente pull", async () => {
      const response = await request(app)
        .post("/sync/push")
        .set(authed())
        .send({
          transactions: {
            create: [{ localId: "11111111-1111-1111-1111-111111111111", type: "income", amount: 50, category: "salario" }],
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.idMappings[0]).toMatchObject({ entityType: "transaction" });

      const pull = await request(app).get("/sync/pull").set(authed());
      expect(pull.body.transactions).toHaveLength(1);
      expect(pull.body.transactions[0].category).toBe("salario");
    });

    it("descarta una edición offline de una meta de ahorro más antigua que la del servidor (conflicto)", async () => {
      const goal = await request(app)
        .post("/finance/savings-goals")
        .set(authed())
        .send({ name: "Kyoto", targetAmount: 500, category: "ahorro-kyoto" });
      await request(app).put(`/finance/savings-goals/${goal.body.id}`).set(authed()).send({ name: "Editado desde la web" });

      const response = await request(app)
        .post("/sync/push")
        .set(authed())
        .send({
          savingsGoals: {
            update: [{ id: goal.body.id, clientUpdatedAt: new Date(Date.now() - 60_000).toISOString(), name: "Offline viejo" }],
          },
        });

      expect(response.body.conflicts).toEqual([{ entityType: "savingsGoal", id: goal.body.id }]);
      const current = await prisma.savingsGoal.findUnique({ where: { id: goal.body.id } });
      expect(current?.name).toBe("Editado desde la web");
    });

    it("crear, editar y borrar un registro de progreso offline reajusta currentValue/completed de la meta en cada paso", async () => {
      const goal = await request(app).post("/goals").set(authed()).send({ title: "Ejercicio", period: "weekly", targetValue: 10 });

      const created = await request(app)
        .post("/sync/push")
        .set(authed())
        .send({
          goalProgress: {
            create: [{ localId: "22222222-2222-2222-2222-222222222222", goalId: goal.body.id, value: 4 }],
          },
        });
      const progressId = created.body.idMappings[0].id;
      expect((await prisma.goal.findUnique({ where: { id: goal.body.id } }))?.currentValue).toBe(4);

      await request(app)
        .post("/sync/push")
        .set(authed())
        .send({
          goalProgress: {
            update: [
              {
                id: progressId,
                goalId: goal.body.id,
                clientUpdatedAt: new Date(Date.now() + 60_000).toISOString(),
                value: 9,
              },
            ],
          },
        });
      // 4 -> 9 es delta +5 sobre currentValue: 4 + 5 = 9, no 4 + 9.
      expect((await prisma.goal.findUnique({ where: { id: goal.body.id } }))?.currentValue).toBe(9);

      await request(app)
        .post("/sync/push")
        .set(authed())
        .send({ deletes: [{ entityType: "goalProgress", id: progressId, goalId: goal.body.id }] });

      const finalGoal = await prisma.goal.findUnique({ where: { id: goal.body.id } });
      expect(finalGoal?.currentValue).toBe(0);
      expect(finalGoal?.completed).toBe(false);
    });

    it("crea una tarea de proyecto offline ya marcada como completada (dos pasos: addTask + setTaskCompleted)", async () => {
      const project = await request(app).post("/projects").set(authed()).send({ title: "Reforma" });

      const response = await request(app)
        .post("/sync/push")
        .set(authed())
        .send({
          projectTasks: {
            create: [
              { localId: "33333333-3333-3333-3333-333333333333", projectId: project.body.id, title: "Comprar pintura", completed: true },
            ],
          },
        });

      const taskId = response.body.idMappings[0].id;
      const task = await prisma.projectTask.findUnique({ where: { id: taskId } });
      expect(task?.completed).toBe(true);
    });

    it("reordenar un horario offline (order fraccionario) persiste sin pasar por el endpoint de swap", async () => {
      const schedule = await request(app).post("/schedule").set(authed()).send({ name: "1r trimestre" });

      const response = await request(app)
        .post("/sync/push")
        .set(authed())
        .send({
          schedules: {
            update: [{ id: schedule.body.id, clientUpdatedAt: new Date(Date.now() + 60_000).toISOString(), order: 2.5 }],
          },
        });

      expect(response.body.conflicts).toEqual([]);
      const updated = await prisma.schedule.findUnique({ where: { id: schedule.body.id } });
      expect(updated?.order).toBe(2.5);
    });

    it("una marca de día se sube como upsert y, al borrarla, deja tombstone por su id real (no por date)", async () => {
      const category = await request(app).post("/calendar-legend").set(authed()).send({ label: "Exámenes", color: "warning" });

      await request(app)
        .post("/sync/push")
        .set(authed())
        .send({ calendarDayMarks: { upsert: [{ date: "2026-09-20", categoryId: category.body.id }] } });

      const afterUpsert = await request(app).get("/sync/pull").set(authed());
      expect(afterUpsert.body.calendarDayMarks).toHaveLength(1);
      const cursor = afterUpsert.body.serverTime;

      const deleteResponse = await request(app)
        .post("/sync/push")
        .set(authed())
        .send({ deletes: [{ entityType: "calendarDayMark", date: "2026-09-20" }] });
      expect(deleteResponse.status).toBe(200);

      const afterDelete = await request(app).get("/sync/pull").set(authed()).query({ since: cursor });
      expect(afterDelete.body.tombstones).toHaveLength(1);
      expect(afterDelete.body.tombstones[0]).toMatchObject({ entityType: "calendarDayMark" });

      const bootstrap = await request(app).get("/sync/pull").set(authed());
      expect(bootstrap.body.calendarDayMarks).toEqual([]);
    });

    it("borrar una CalendarLegendCategory no deja tombstone individual por cada día en cascada (mismo criterio que Habit/HabitLog)", async () => {
      const category = await request(app).post("/calendar-legend").set(authed()).send({ label: "Exámenes", color: "warning" });
      const cursor = (await request(app).get("/sync/pull").set(authed())).body.serverTime;
      await request(app)
        .post("/sync/push")
        .set(authed())
        .send({ calendarDayMarks: { upsert: [{ date: "2026-09-21", categoryId: category.body.id }] } });

      await request(app).delete(`/calendar-legend/${category.body.id}`).set(authed());

      const pull = await request(app).get("/sync/pull").set(authed()).query({ since: cursor });
      expect(pull.body.tombstones).toHaveLength(1);
      expect(pull.body.tombstones[0]).toMatchObject({ entityType: "calendarLegendCategory", entityId: category.body.id });
    });

    it("crea una página personalizada offline y edita su content (blob JSON) con last-write-wins", async () => {
      const created = await request(app)
        .post("/sync/push")
        .set(authed())
        .send({
          customPages: {
            create: [{ localId: "44444444-4444-4444-4444-444444444444", title: "Mi kanban", template: "kanban" }],
          },
        });
      const pageId = created.body.idMappings[0].id;

      const response = await request(app)
        .post("/sync/push")
        .set(authed())
        .send({
          customPages: {
            update: [
              {
                id: pageId,
                clientUpdatedAt: new Date(Date.now() + 60_000).toISOString(),
                content: { columns: [{ id: "c1", title: "Hecho", cards: [] }] },
              },
            ],
          },
        });

      expect(response.body.conflicts).toEqual([]);
      const page = await prisma.customPage.findUnique({ where: { id: pageId } });
      expect(page?.content).toEqual({ columns: [{ id: "c1", title: "Hecho", cards: [] }] });
    });
  });
});
