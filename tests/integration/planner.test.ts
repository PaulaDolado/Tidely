import request from "supertest";
import { app } from "../../src/app";
import { prisma } from "../../src/config/database";

describe("Planner Endpoints", () => {
  let token: string;

  beforeEach(async () => {
    await prisma.subtask.deleteMany({});
    await prisma.task.deleteMany({});
    await prisma.projectTask.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.user.deleteMany({});

    const response = await request(app).post("/auth/register").send({
      username: "planner",
      email: "planner@example.com",
      password: "Password123",
      name: "Planner User",
    });
    token = response.body.token;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function authed(t: string = token) {
    return { Authorization: `Bearer ${t}` };
  }

  describe("POST /planner/tasks", () => {
    it("crea una tarea con valores por defecto", async () => {
      const response = await request(app).post("/planner/tasks").set(authed()).send({ title: "Redactar informe" });

      expect(response.status).toBe(201);
      expect(response.body.status).toBe("todo");
      expect(response.body.priority).toBe("medium");
      expect(response.body.tags).toEqual([]);
      expect(response.body.actualMinutes).toBe(0);
      expect(response.body.subtasks).toEqual([]);
    });

    it("acepta fecha límite, etiquetas y estimación al crear", async () => {
      const response = await request(app).post("/planner/tasks").set(authed()).send({
        title: "Preparar presentación",
        dueDate: "2026-09-01T00:00:00.000Z",
        tags: ["trabajo", "urgente"],
        estimatedMinutes: 90,
      });

      expect(response.status).toBe(201);
      expect(response.body.dueDate).toBe("2026-09-01T00:00:00.000Z");
      expect(response.body.tags).toEqual(["trabajo", "urgente"]);
      expect(response.body.estimatedMinutes).toBe(90);
    });
  });

  describe("Vínculo con proyectos", () => {
    it("vincula la tarea a un proyecto propio", async () => {
      const project = await request(app).post("/projects").set(authed()).send({ title: "Mudanza" });

      const task = await request(app)
        .post("/planner/tasks")
        .set(authed())
        .send({ title: "Reservar furgoneta", projectId: project.body.id });

      expect(task.status).toBe(201);
      expect(task.body.projectId).toBe(project.body.id);
    });

    it("rechaza vincular un proyecto que no existe (404)", async () => {
      const response = await request(app).post("/planner/tasks").set(authed()).send({ title: "X", projectId: 999999 });
      expect(response.status).toBe(404);
    });

    it("rechaza vincular un proyecto de otro usuario (403)", async () => {
      const otherUser = await request(app).post("/auth/register").send({
        username: "otro",
        email: "otro@example.com",
        password: "Password123",
        name: "Otro",
      });
      const otherProject = await request(app)
        .post("/projects")
        .set(authed(otherUser.body.token))
        .send({ title: "Proyecto ajeno" });

      const response = await request(app)
        .post("/planner/tasks")
        .set(authed())
        .send({ title: "X", projectId: otherProject.body.id });

      expect(response.status).toBe(403);
    });

    it("filtra tareas por projectId", async () => {
      const project = await request(app).post("/projects").set(authed()).send({ title: "Mudanza" });
      await request(app).post("/planner/tasks").set(authed()).send({ title: "Con proyecto", projectId: project.body.id });
      await request(app).post("/planner/tasks").set(authed()).send({ title: "Sin proyecto" });

      const response = await request(app).get(`/planner/tasks?projectId=${project.body.id}`).set(authed());

      expect(response.body.tasks).toHaveLength(1);
      expect(response.body.tasks[0].title).toBe("Con proyecto");
    });
  });

  describe("Etiquetas", () => {
    it("filtra tareas por etiqueta", async () => {
      await request(app).post("/planner/tasks").set(authed()).send({ title: "A", tags: ["casa"] });
      await request(app).post("/planner/tasks").set(authed()).send({ title: "B", tags: ["trabajo"] });

      const response = await request(app).get("/planner/tasks?tag=casa").set(authed());

      expect(response.body.tasks).toHaveLength(1);
      expect(response.body.tasks[0].title).toBe("A");
    });
  });

  describe("PUT /planner/tasks/:id", () => {
    it("actualiza fecha límite, etiquetas, estimación y proyecto", async () => {
      const task = await request(app).post("/planner/tasks").set(authed()).send({ title: "Tarea" });

      const response = await request(app)
        .put(`/planner/tasks/${task.body.id}`)
        .set(authed())
        .send({ dueDate: "2026-09-15T00:00:00.000Z", tags: ["personal"], estimatedMinutes: 45 });

      expect(response.status).toBe(200);
      expect(response.body.dueDate).toBe("2026-09-15T00:00:00.000Z");
      expect(response.body.tags).toEqual(["personal"]);
      expect(response.body.estimatedMinutes).toBe(45);
    });

    it("quita la fecha límite al enviar null", async () => {
      const task = await request(app)
        .post("/planner/tasks")
        .set(authed())
        .send({ title: "Tarea", dueDate: "2026-09-15T00:00:00.000Z" });

      const response = await request(app).put(`/planner/tasks/${task.body.id}`).set(authed()).send({ dueDate: null });

      expect(response.status).toBe(200);
      expect(response.body.dueDate).toBeNull();
    });

    it("crea con compact=false por defecto y permite activar la vista compacta", async () => {
      const task = await request(app).post("/planner/tasks").set(authed()).send({ title: "Tarea" });
      expect(task.body.compact).toBe(false);

      const response = await request(app).put(`/planner/tasks/${task.body.id}`).set(authed()).send({ compact: true });

      expect(response.status).toBe(200);
      expect(response.body.compact).toBe(true);
    });
  });

  describe("POST /planner/tasks/:id/time", () => {
    it("suma minutos al tiempo real acumulado en varias llamadas", async () => {
      const task = await request(app).post("/planner/tasks").set(authed()).send({ title: "Tarea" });

      await request(app).post(`/planner/tasks/${task.body.id}/time`).set(authed()).send({ minutes: 25 });
      const second = await request(app).post(`/planner/tasks/${task.body.id}/time`).set(authed()).send({ minutes: 15 });

      expect(second.status).toBe(200);
      expect(second.body.actualMinutes).toBe(40);
    });

    it("rechaza minutos no positivos", async () => {
      const task = await request(app).post("/planner/tasks").set(authed()).send({ title: "Tarea" });
      const response = await request(app).post(`/planner/tasks/${task.body.id}/time`).set(authed()).send({ minutes: 0 });
      expect(response.status).toBe(400);
    });
  });

  describe("Subtareas", () => {
    it("añade, marca y elimina subtareas", async () => {
      const task = await request(app).post("/planner/tasks").set(authed()).send({ title: "Tarea con pasos" });

      const subtask = await request(app)
        .post(`/planner/tasks/${task.body.id}/subtasks`)
        .set(authed())
        .send({ title: "Primer paso" });
      expect(subtask.status).toBe(201);
      expect(subtask.body.completed).toBe(false);

      const toggled = await request(app)
        .put(`/planner/tasks/${task.body.id}/subtasks/${subtask.body.id}`)
        .set(authed())
        .send({ completed: true });
      expect(toggled.status).toBe(200);
      expect(toggled.body.completed).toBe(true);

      const listed = await request(app).get("/planner/tasks").set(authed());
      expect(listed.body.tasks[0].subtasks).toHaveLength(1);
      expect(listed.body.tasks[0].subtasks[0].completed).toBe(true);

      const deleted = await request(app)
        .delete(`/planner/tasks/${task.body.id}/subtasks/${subtask.body.id}`)
        .set(authed());
      expect(deleted.status).toBe(200);

      const listedAfter = await request(app).get("/planner/tasks").set(authed());
      expect(listedAfter.body.tasks[0].subtasks).toHaveLength(0);
    });

    it("elimina en cascada las subtareas al borrar la tarea", async () => {
      const task = await request(app).post("/planner/tasks").set(authed()).send({ title: "Tarea con pasos" });
      await request(app).post(`/planner/tasks/${task.body.id}/subtasks`).set(authed()).send({ title: "Paso" });

      await request(app).delete(`/planner/tasks/${task.body.id}`).set(authed());

      const remaining = await prisma.subtask.findMany({ where: { taskId: task.body.id } });
      expect(remaining).toHaveLength(0);
    });

    it("rechaza una subtarea de otra tarea del mismo usuario (404)", async () => {
      const taskA = await request(app).post("/planner/tasks").set(authed()).send({ title: "A" });
      const taskB = await request(app).post("/planner/tasks").set(authed()).send({ title: "B" });
      const subtaskA = await request(app).post(`/planner/tasks/${taskA.body.id}/subtasks`).set(authed()).send({ title: "Paso" });

      const response = await request(app)
        .put(`/planner/tasks/${taskB.body.id}/subtasks/${subtaskA.body.id}`)
        .set(authed())
        .send({ completed: true });

      expect(response.status).toBe(404);
    });
  });
});
