import request from "supertest";
import { app } from "../../src/app";
import { prisma } from "../../src/config/database";

describe("Budget (presupuesto) Endpoints", () => {
  let token: string;
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  beforeEach(async () => {
    await prisma.transaction.deleteMany({});
    await prisma.savingsGoal.deleteMany({});
    await prisma.user.deleteMany({});

    const response = await request(app).post("/auth/register").send({
      username: "budget",
      email: "budget@example.com",
      password: "Password123",
      name: "Budget User",
    });
    token = response.body.token;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function authed() {
    return { Authorization: `Bearer ${token}` };
  }

  async function categories() {
    const response = await request(app).get("/finance/budget-categories").set(authed());
    return response.body.categories as { id: number; name: string; color: string; percent: number }[];
  }

  async function addTransaction(type: "income" | "expense", amount: number, category: string) {
    await request(app).post("/finance/transactions").set(authed()).send({ type, amount, category, description: "x" });
  }

  describe("categorías por defecto", () => {
    it("una cuenta nueva arranca con Casa, Comida, Transporte, Compras, Entretenimiento y Otro", async () => {
      const list = await categories();

      expect(list.map((c) => c.name)).toEqual(["Casa", "Comida", "Transporte", "Compras", "Entretenimiento", "Otro"]);
      expect(list.find((c) => c.name === "Casa")).toMatchObject({ percent: 30, color: "habit" });
      // Colores distintos entre sí, para poder distinguir las porciones del donut.
      expect(new Set(list.map((c) => c.color)).size).toBe(list.length);
    });
  });

  describe("POST /finance/budget-categories", () => {
    it("crea una categoría con nombre, color y porcentaje", async () => {
      const response = await request(app).post("/finance/budget-categories").set(authed()).send({ name: "Salud", color: "positive", percent: 10 });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ name: "Salud", color: "positive", percent: 10 });
    });

    it("rechaza un color fuera de la paleta", async () => {
      const response = await request(app).post("/finance/budget-categories").set(authed()).send({ name: "Salud", color: "fucsia", percent: 5 });
      expect(response.status).toBe(400);
    });

    it("rechaza un porcentaje fuera de 0-100", async () => {
      const response = await request(app).post("/finance/budget-categories").set(authed()).send({ name: "Salud", color: "positive", percent: 120 });
      expect(response.status).toBe(400);
    });

    it("rechaza un nombre repetido, sin distinguir mayúsculas", async () => {
      const response = await request(app).post("/finance/budget-categories").set(authed()).send({ name: "casa", color: "positive", percent: 1 });
      expect(response.status).toBe(409);
    });

    it("rechaza que todas las categorías sumen más del 100% (por defecto suman 65%)", async () => {
      const response = await request(app).post("/finance/budget-categories").set(authed()).send({ name: "Salud", color: "positive", percent: 40 });

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/35%/); // te quedan 35% por asignar
    });

    it("permite llegar exactamente al 100%", async () => {
      const response = await request(app).post("/finance/budget-categories").set(authed()).send({ name: "Salud", color: "positive", percent: 35 });
      expect(response.status).toBe(201);
    });
  });

  describe("PUT /finance/budget-categories/:id", () => {
    it("edita color y porcentaje", async () => {
      const casa = (await categories()).find((c) => c.name === "Casa")!;

      const response = await request(app).put(`/finance/budget-categories/${casa.id}`).set(authed()).send({ color: "negative", percent: 40 });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ name: "Casa", color: "negative", percent: 40 });
    });

    it("rechaza subir un porcentaje si el total pasaría del 100%", async () => {
      const casa = (await categories()).find((c) => c.name === "Casa")!;
      const response = await request(app).put(`/finance/budget-categories/${casa.id}`).set(authed()).send({ percent: 70 });
      expect(response.status).toBe(400); // 65 - 30 + 70 = 105
    });

    it("al renombrar, reetiqueta los movimientos que ya tenía la categoría", async () => {
      await addTransaction("expense", 100, "Casa");
      const casa = (await categories()).find((c) => c.name === "Casa")!;

      await request(app).put(`/finance/budget-categories/${casa.id}`).set(authed()).send({ name: "Hogar" });

      const summary = await request(app).get(`/finance/budget/${month}/${year}`).set(authed());
      expect(summary.body.categories.find((c: { name: string }) => c.name === "Hogar").spent).toBe(100);
    });

    it("no permite editar la categoría de otro usuario", async () => {
      const casa = (await categories()).find((c) => c.name === "Casa")!;
      const other = await request(app).post("/auth/register").send({ username: "otro_budget", email: "otro-budget@example.com", password: "Password123", name: "Otro" });

      const response = await request(app)
        .put(`/finance/budget-categories/${casa.id}`)
        .set({ Authorization: `Bearer ${other.body.token}` })
        .send({ percent: 1 });

      expect(response.status).toBe(403);
    });
  });

  describe("DELETE /finance/budget-categories/:id", () => {
    it("elimina la categoría y libera su porcentaje", async () => {
      const casa = (await categories()).find((c) => c.name === "Casa")!;

      const response = await request(app).delete(`/finance/budget-categories/${casa.id}`).set(authed());

      expect(response.status).toBe(200);
      expect((await categories()).map((c) => c.name)).not.toContain("Casa");
    });
  });

  describe("GET /finance/budget/:month/:year", () => {
    it("reparte los gastos por categoría y calcula el presupuesto como % de los ingresos", async () => {
      await addTransaction("income", 2000, "salary");
      await addTransaction("expense", 500, "Casa");
      await addTransaction("expense", 120, "comida"); // sin distinguir mayúsculas
      await addTransaction("expense", 30, "Transporte");

      const response = await request(app).get(`/finance/budget/${month}/${year}`).set(authed());

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ income: 2000, totalSpent: 650, assignedPercent: 65, unassignedPercent: 35 });
      const byName = Object.fromEntries(response.body.categories.map((c: { name: string }) => [c.name, c]));
      expect(byName.Casa).toMatchObject({ percent: 30, budget: 600, spent: 500 });
      expect(byName.Comida).toMatchObject({ percent: 10, budget: 200, spent: 120 });
      expect(byName.Transporte).toMatchObject({ budget: 100, spent: 30 });
    });

    it("los gastos con una categoría desconocida cuentan en Otro", async () => {
      await addTransaction("income", 1000, "salary");
      await addTransaction("expense", 40, "gimnasio");

      const response = await request(app).get(`/finance/budget/${month}/${year}`).set(authed());

      expect(response.body.categories.find((c: { name: string }) => c.name === "Otro").spent).toBe(40);
      expect(response.body.uncategorizedSpent).toBe(0);
    });

    it("sin categoría Otro, lo suelto se devuelve aparte en uncategorizedSpent", async () => {
      const otro = (await categories()).find((c) => c.name === "Otro")!;
      await request(app).delete(`/finance/budget-categories/${otro.id}`).set(authed());
      await addTransaction("expense", 40, "gimnasio");

      const response = await request(app).get(`/finance/budget/${month}/${year}`).set(authed());

      expect(response.body.uncategorizedSpent).toBe(40);
    });

    it("no cuenta como gasto lo aportado a una meta de ahorro", async () => {
      await addTransaction("income", 1000, "salary");
      await request(app).post("/finance/savings-goals").set(authed()).send({ name: "Viaje", type: "ahorro", targetAmount: 500, category: "Viaje" });
      await addTransaction("expense", 50, "Viaje"); // retirada/corrección de la meta, no un gasto real
      await addTransaction("expense", 20, "Casa");

      const response = await request(app).get(`/finance/budget/${month}/${year}`).set(authed());

      expect(response.body.totalSpent).toBe(20);
      expect(response.body.categories.reduce((sum: number, c: { spent: number }) => sum + c.spent, 0)).toBe(20);
    });

    it("rechaza un mes inválido", async () => {
      const response = await request(app).get(`/finance/budget/13/${year}`).set(authed());
      expect(response.status).toBe(400);
    });
  });
});
