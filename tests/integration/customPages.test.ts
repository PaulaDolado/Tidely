import request from "supertest";
import { app } from "../../src/app";
import { prisma } from "../../src/config/database";

describe("Custom Pages Endpoints", () => {
  let token: string;
  let token2: string;

  beforeEach(async () => {
    await prisma.customPage.deleteMany({});
    await prisma.user.deleteMany({});

    const response = await request(app).post("/auth/register").send({
      username: "custompages",
      email: "custompages@example.com",
      password: "Password123",
      name: "Custom Pages User",
    });
    token = response.body.token;

    const response2 = await request(app).post("/auth/register").send({
      username: "otro",
      email: "otro@example.com",
      password: "Password123",
      name: "Otro User",
    });
    token2 = response2.body.token;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function authed() {
    return { Authorization: `Bearer ${token}` };
  }

  describe("GET /custom-pages", () => {
    it("empieza vacío", async () => {
      const response = await request(app).get("/custom-pages").set(authed());
      expect(response.status).toBe(200);
      expect(response.body.pages).toEqual([]);
    });

    it("rechaza la petición sin token", async () => {
      const response = await request(app).get("/custom-pages");
      expect(response.status).toBe(401);
    });
  });

  describe("POST /custom-pages", () => {
    it("crea una página de tipo nota con contenido inicial vacío", async () => {
      const response = await request(app).post("/custom-pages").set(authed()).send({ title: "Mis apuntes", template: "nota" });

      expect(response.status).toBe(201);
      expect(response.body.title).toBe("Mis apuntes");
      expect(response.body.template).toBe("nota");
      expect(response.body.content).toEqual({ html: "" });
    });

    it("crea una página de tipo kanban con tres columnas por defecto", async () => {
      const response = await request(app).post("/custom-pages").set(authed()).send({ title: "Tablero", template: "kanban" });

      expect(response.status).toBe(201);
      expect(response.body.content.columns).toHaveLength(3);
      expect(response.body.content.columns.map((c: { title: string }) => c.title)).toEqual(["Por hacer", "En curso", "Hecho"]);
      expect(response.body.content.columns[0].cards).toEqual([]);
    });

    it("crea una página de tipo galeria con lista de entradas vacía", async () => {
      const response = await request(app).post("/custom-pages").set(authed()).send({ title: "Fotos", template: "galeria" });

      expect(response.status).toBe(201);
      expect(response.body.content).toEqual({ items: [] });
    });

    it("rechaza un modelo desconocido", async () => {
      const response = await request(app).post("/custom-pages").set(authed()).send({ title: "X", template: "no-existe" });
      expect(response.status).toBe(400);
    });

    it("rechaza un título vacío", async () => {
      const response = await request(app).post("/custom-pages").set(authed()).send({ title: "", template: "nota" });
      expect(response.status).toBe(400);
    });

    it("varias páginas quedan ordenadas por orden de creación", async () => {
      await request(app).post("/custom-pages").set(authed()).send({ title: "Uno", template: "nota" });
      await request(app).post("/custom-pages").set(authed()).send({ title: "Dos", template: "nota" });

      const list = await request(app).get("/custom-pages").set(authed());
      expect(list.body.pages.map((p: { title: string }) => p.title)).toEqual(["Uno", "Dos"]);
    });

    it("la lista no incluye el contenido (solo el detalle)", async () => {
      await request(app).post("/custom-pages").set(authed()).send({ title: "Uno", template: "finanzas" });

      const list = await request(app).get("/custom-pages").set(authed());
      expect(list.body.pages[0].content).toBeUndefined();
    });
  });

  describe("GET /custom-pages/:id", () => {
    it("devuelve el detalle con contenido", async () => {
      const created = await request(app).post("/custom-pages").set(authed()).send({ title: "Ideas", template: "objetivos" });

      const response = await request(app).get(`/custom-pages/${created.body.id}`).set(authed());
      expect(response.status).toBe(200);
      expect(response.body.content).toEqual({ goals: [] });
    });

    it("no permite ver una página de otro usuario", async () => {
      const created = await request(app).post("/custom-pages").set(authed()).send({ title: "Privada", template: "nota" });

      const response = await request(app).get(`/custom-pages/${created.body.id}`).set({ Authorization: `Bearer ${token2}` });
      expect(response.status).toBe(403);
    });

    it("devuelve 404 sobre una página inexistente", async () => {
      const response = await request(app).get("/custom-pages/999999").set(authed());
      expect(response.status).toBe(404);
    });
  });

  describe("PUT /custom-pages/:id", () => {
    it("cambia el nombre de la página", async () => {
      const created = await request(app).post("/custom-pages").set(authed()).send({ title: "Original", template: "nota" });

      const updated = await request(app).put(`/custom-pages/${created.body.id}`).set(authed()).send({ title: "Renombrada" });
      expect(updated.status).toBe(200);
      expect(updated.body.title).toBe("Renombrada");
    });

    it("sobrescribe el contenido completo (checklist de la plantilla 'hoy')", async () => {
      const created = await request(app).post("/custom-pages").set(authed()).send({ title: "Hoy", template: "hoy" });

      const newContent = { items: [{ id: "a1", text: "Regar las plantas", done: false }] };
      const updated = await request(app).put(`/custom-pages/${created.body.id}`).set(authed()).send({ content: newContent });

      expect(updated.status).toBe(200);
      expect(updated.body.content).toEqual(newContent);
    });

    it("permite elegir un icono propio y quitarlo (vuelve a null)", async () => {
      const created = await request(app).post("/custom-pages").set(authed()).send({ title: "Original", template: "nota" });
      expect(created.body.icon).toBeNull();

      const withIcon = await request(app).put(`/custom-pages/${created.body.id}`).set(authed()).send({ icon: "⭐" });
      expect(withIcon.status).toBe(200);
      expect(withIcon.body.icon).toBe("⭐");

      const removed = await request(app).put(`/custom-pages/${created.body.id}`).set(authed()).send({ icon: null });
      expect(removed.status).toBe(200);
      expect(removed.body.icon).toBeNull();
    });

    it("no permite editar una página de otro usuario", async () => {
      const created = await request(app).post("/custom-pages").set(authed()).send({ title: "Original", template: "nota" });

      const response = await request(app)
        .put(`/custom-pages/${created.body.id}`)
        .set({ Authorization: `Bearer ${token2}` })
        .send({ title: "Intrusión" });
      expect(response.status).toBe(403);
    });
  });

  describe("PUT /custom-pages/:id/move", () => {
    it("sube una página y el orden se refleja en el siguiente GET", async () => {
      const first = await request(app).post("/custom-pages").set(authed()).send({ title: "Primera", template: "nota" });
      const second = await request(app).post("/custom-pages").set(authed()).send({ title: "Segunda", template: "nota" });

      const moved = await request(app).put(`/custom-pages/${second.body.id}/move`).set(authed()).send({ direction: "up" });
      expect(moved.status).toBe(200);

      const list = await request(app).get("/custom-pages").set(authed());
      expect(list.body.pages.map((p: { id: number }) => p.id)).toEqual([second.body.id, first.body.id]);
    });
  });

  describe("DELETE /custom-pages/:id", () => {
    it("elimina una página", async () => {
      const created = await request(app).post("/custom-pages").set(authed()).send({ title: "A borrar", template: "nota" });

      const deleted = await request(app).delete(`/custom-pages/${created.body.id}`).set(authed());
      expect(deleted.status).toBe(200);

      const list = await request(app).get("/custom-pages").set(authed());
      expect(list.body.pages).toHaveLength(0);
    });

    it("no permite eliminar una página de otro usuario", async () => {
      const created = await request(app).post("/custom-pages").set(authed()).send({ title: "Ajena", template: "nota" });

      const response = await request(app).delete(`/custom-pages/${created.body.id}`).set({ Authorization: `Bearer ${token2}` });
      expect(response.status).toBe(403);
    });
  });
});
