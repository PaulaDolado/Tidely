import request from "supertest";
import { app } from "../../src/app";
import { prisma } from "../../src/config/database";

describe("Search Endpoint", () => {
  let token: string;
  // Ver el mismo comentario en tests/integration/agenda.test.ts.
  let categoryIds: Record<string, number>;

  beforeEach(async () => {
    await prisma.note.deleteMany({});
    await prisma.task.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.event.deleteMany({});
    await prisma.user.deleteMany({});

    const response = await request(app).post("/auth/register").send({
      username: "search",
      email: "search@example.com",
      password: "Password123",
      name: "Search User",
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

  it("rechaza sin query", async () => {
    const response = await request(app).get("/search").set(authed());
    expect(response.status).toBe(400);
  });

  it("busca por título en eventos, tareas, notas y proyectos, insensible a mayúsculas", async () => {
    await request(app)
      .post("/agenda/events")
      .set(authed())
      .send({ title: "Reunión Presupuesto", categoryId: categoryIds["Reunión"], startTime: "2026-08-24T10:00:00.000Z", endTime: "2026-08-24T11:00:00.000Z" });
    await request(app).post("/planner/tasks").set(authed()).send({ title: "Revisar presupuesto anual" });
    await request(app).post("/notes").set(authed()).send({ content: "Idea: recortar presupuesto de marketing" });
    await request(app).post("/projects").set(authed()).send({ title: "Presupuesto 2027" });
    await request(app).post("/planner/tasks").set(authed()).send({ title: "Comprar pan" }); // no coincide

    const response = await request(app).get("/search").query({ q: "PRESUPUESTO" }).set(authed());

    expect(response.status).toBe(200);
    expect(response.body.events).toHaveLength(1);
    expect(response.body.tasks).toHaveLength(1);
    expect(response.body.notes).toHaveLength(1);
    expect(response.body.projects).toHaveLength(1);
  });

  it("busca por descripción, no solo por título", async () => {
    await request(app)
      .post("/planner/tasks")
      .set(authed())
      .send({ title: "Tarea genérica", description: "contiene la palabra clave secreta" });

    const response = await request(app).get("/search").query({ q: "secreta" }).set(authed());

    expect(response.body.tasks).toHaveLength(1);
  });

  it("no devuelve resultados de otro usuario", async () => {
    await request(app).post("/notes").set(authed()).send({ content: "nota compartible palabra-unica-xyz" });

    const otherUser = await request(app).post("/auth/register").send({
      username: "otro_search",
      email: "otro-search@example.com",
      password: "Password123",
      name: "Otro",
    });

    const response = await request(app)
      .get("/search")
      .query({ q: "palabra-unica-xyz" })
      .set({ Authorization: `Bearer ${otherUser.body.token}` });

    expect(response.body.notes).toHaveLength(0);
  });
});
