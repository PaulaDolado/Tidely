import request from "supertest";
import { app } from "../../src/app";
import { prisma } from "../../src/config/database";

describe("Today Endpoint", () => {
  let token: string;
  // Ver el mismo comentario en tests/integration/agenda.test.ts.
  let categoryIds: Record<string, number>;

  beforeEach(async () => {
    await prisma.habitLog.deleteMany({});
    await prisma.habit.deleteMany({});
    await prisma.note.deleteMany({});
    await prisma.task.deleteMany({});
    await prisma.eventException.deleteMany({});
    await prisma.event.deleteMany({});
    await prisma.projectPage.deleteMany({});
    await prisma.projectTask.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.user.deleteMany({});

    const response = await request(app).post("/auth/register").send({
      username: "today",
      email: "today@example.com",
      password: "Password123",
      name: "Today User",
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

  function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }

  it("combina eventos de hoy, tareas con vencimiento hoy, hábitos y notas en una sola respuesta", async () => {
    await request(app)
      .post("/agenda/events")
      .set(authed())
      .send({
        title: "Reunión",
        type: "meeting",
        startTime: `${todayIso()}T10:00:00.000Z`,
        endTime: `${todayIso()}T11:00:00.000Z`,
      });
    await request(app).post("/planner/tasks").set(authed()).send({ title: "Entregar informe", dueDate: `${todayIso()}T00:00:00.000Z` });
    await request(app).post("/planner/tasks").set(authed()).send({ title: "Sin fecha" }); // no debería aparecer
    await request(app).post("/habits").set(authed()).send({ title: "Beber agua" });
    await request(app).post("/notes").set(authed()).send({ content: "Comprar leche" });

    const response = await request(app).get("/today").set(authed());

    expect(response.status).toBe(200);
    expect(response.body.date).toBe(todayIso());
    expect(response.body.events).toHaveLength(1);
    expect(response.body.events[0].title).toBe("Reunión");
    expect(response.body.tasksDueToday).toHaveLength(1);
    expect(response.body.tasksDueToday[0].title).toBe("Entregar informe");
    expect(response.body.habits).toHaveLength(1);
    expect(response.body.habits[0].title).toBe("Beber agua");
    expect(response.body.notes).toHaveLength(1);
    expect(response.body.notes[0].content).toBe("Comprar leche");
    expect(response.body.combinedStreak).toBe(0); // nada marcado/completado todavía
    expect(response.body.recentProjectEntries).toEqual([]); // sin libretas tocadas
  });

  describe("recentProjectEntries", () => {
    it("incluye las páginas de libreta editadas recientemente, con proyecto y avance en texto plano", async () => {
      const project = await request(app).post("/projects").set(authed()).send({ title: "Vacaciones" });
      const page = await request(app).post(`/projects/${project.body.id}/pages`).set(authed()).send({ title: "Ideas" });
      await request(app)
        .put(`/projects/${project.body.id}/pages/${page.body.id}`)
        .set(authed())
        .send({ content: "<p>Reservar <strong>vuelos</strong></p>" });

      const response = await request(app).get("/today").set(authed());

      expect(response.body.recentProjectEntries).toHaveLength(1);
      expect(response.body.recentProjectEntries[0]).toMatchObject({
        projectId: project.body.id,
        projectTitle: "Vacaciones",
        pageTitle: "Ideas",
        preview: "Reservar vuelos",
      });
    });

    it("no incluye páginas de otro usuario", async () => {
      const otherUser = await request(app).post("/auth/register").send({
        username: "otro_today",
        email: "otro-today@example.com",
        password: "Password123",
        name: "Otro",
      });
      const otherProject = await request(app)
        .post("/projects")
        .set({ Authorization: `Bearer ${otherUser.body.token}` })
        .send({ title: "Ajeno" });
      await request(app)
        .post(`/projects/${otherProject.body.id}/pages`)
        .set({ Authorization: `Bearer ${otherUser.body.token}` })
        .send({ title: "Página ajena" });

      const response = await request(app).get("/today").set(authed());

      expect(response.body.recentProjectEntries).toEqual([]);
    });
  });

  it("la racha combinada sube cuando se marca el hábito y se completa la tarea de hoy", async () => {
    const habit = await request(app).post("/habits").set(authed()).send({ title: "Leer" });
    const task = await request(app)
      .post("/planner/tasks")
      .set(authed())
      .send({ title: "Revisar código", dueDate: `${todayIso()}T00:00:00.000Z` });

    await request(app).post(`/habits/${habit.body.id}/toggle`).set(authed()).send({});
    await request(app).put(`/planner/tasks/${task.body.id}`).set(authed()).send({ status: "done" });

    const response = await request(app).get("/today").set(authed());

    expect(response.body.combinedStreak).toBe(1);
  });

  it("no incluye tareas de otros días ni eventos de otros días", async () => {
    await request(app)
      .post("/agenda/events")
      .set(authed())
      .send({ title: "Mañana", categoryId: categoryIds["Trabajo"], startTime: "2099-01-01T10:00:00.000Z", endTime: "2099-01-01T11:00:00.000Z" });
    await request(app).post("/planner/tasks").set(authed()).send({ title: "Futuro", dueDate: "2099-01-01T00:00:00.000Z" });

    const response = await request(app).get("/today").set(authed());

    expect(response.body.events).toHaveLength(0);
    expect(response.body.tasksDueToday).toHaveLength(0);
  });
});
