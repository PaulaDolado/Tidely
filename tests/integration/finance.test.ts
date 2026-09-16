import request from "supertest";
import { app } from "../../src/app";
import { prisma } from "../../src/config/database";

describe("Finance Endpoints", () => {
  let token: string;
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  beforeEach(async () => {
    await prisma.transaction.deleteMany({});
    await prisma.savingsGoal.deleteMany({});
    await prisma.user.deleteMany({});

    const response = await request(app).post("/auth/register").send({
      username: "finance",
      email: "finance@example.com",
      password: "Password123",
      name: "Finance User",
    });
    token = response.body.token;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function authed() {
    return { Authorization: `Bearer ${token}` };
  }

  describe("POST /finance/transactions", () => {
    it("debería registrar un ingreso", async () => {
      const response = await request(app).post("/finance/transactions").set(authed()).send({
        type: "income",
        amount: 1500,
        category: "salary",
        description: "Nómina",
      });

      expect(response.status).toBe(201);
      expect(Number(response.body.amount)).toBe(1500);
    });

    it("debería rechazar un monto negativo", async () => {
      const response = await request(app).post("/finance/transactions").set(authed()).send({
        type: "expense",
        amount: -50,
        category: "food",
      });

      expect(response.status).toBe(400);
    });
  });

  describe("GET /finance/balance/:month/:year", () => {
    it("debería calcular el balance del mes correctamente", async () => {
      await request(app).post("/finance/transactions").set(authed()).send({
        type: "income",
        amount: 1000,
        category: "salary",
      });
      await request(app).post("/finance/transactions").set(authed()).send({
        type: "expense",
        amount: 300,
        category: "food",
      });

      const response = await request(app).get(`/finance/balance/${month}/${year}`).set(authed());

      expect(response.status).toBe(200);
      expect(response.body.income).toBe(1000);
      expect(response.body.expense).toBe(300);
      expect(response.body.balance).toBe(700);
    });

    it("resta de Ingresos/Balance lo aportado a una meta ese mes, aunque haya nómina", async () => {
      await request(app).post("/finance/savings-goals").set(authed()).send({
        name: "Vacaciones",
        targetAmount: 1000,
        category: "savings-vacation",
      });
      await request(app).post("/finance/transactions").set(authed()).send({
        type: "income",
        amount: 1000,
        category: "salary",
      });

      const goals = await request(app).get("/finance/savings-goals").set(authed());
      await request(app)
        .post(`/finance/savings-goals/${goals.body.savingsGoals[0].id}/contribute`)
        .set(authed())
        .send({ amount: 200 });

      const response = await request(app).get(`/finance/balance/${month}/${year}`).set(authed());

      expect(response.status).toBe(200);
      expect(response.body.income).toBe(800); // 1000 de nómina - 200 aportados a la meta
      expect(response.body.balance).toBe(800);

      const savingsResponse = await request(app).get("/finance/savings-goals").set(authed());
      expect(savingsResponse.body.savingsGoals[0].currentAmount).toBe(200); // sí cuenta en Ahorro
    });
  });

  describe("GET /finance/transactions", () => {
    it("debería filtrar por categoría", async () => {
      await request(app).post("/finance/transactions").set(authed()).send({
        type: "expense",
        amount: 20,
        category: "transport",
      });
      await request(app).post("/finance/transactions").set(authed()).send({
        type: "expense",
        amount: 50,
        category: "food",
      });

      const response = await request(app)
        .get("/finance/transactions")
        .query({ category: "food" })
        .set(authed());

      expect(response.status).toBe(200);
      expect(response.body.transactions).toHaveLength(1);
      expect(response.body.transactions[0].category).toBe("food");
    });
  });

  describe("Savings goals", () => {
    it("debería calcular el progreso de ahorro a partir de las transacciones de la categoría", async () => {
      await request(app).post("/finance/savings-goals").set(authed()).send({
        name: "Vacaciones",
        targetAmount: 200,
        category: "savings-vacation",
      });

      await request(app).post("/finance/transactions").set(authed()).send({
        type: "income",
        amount: 150,
        category: "savings-vacation",
      });

      const response = await request(app).get("/finance/savings-goals").set(authed());

      expect(response.status).toBe(200);
      expect(response.body.savingsGoals[0].currentAmount).toBe(150);
      expect(response.body.savingsGoals[0].progressPercent).toBe(75);
    });
  });

  describe("Ownership", () => {
    it("no debería permitir eliminar una transacción de otro usuario", async () => {
      const created = await request(app).post("/finance/transactions").set(authed()).send({
        type: "expense",
        amount: 10,
        category: "food",
      });

      const otherUser = await request(app).post("/auth/register").send({
        username: "otro_finance",
        email: "otro-finance@example.com",
        password: "Password123",
        name: "Otro",
      });

      const response = await request(app)
        .delete(`/finance/transactions/${created.body.id}`)
        .set({ Authorization: `Bearer ${otherUser.body.token}` });

      expect(response.status).toBe(403);
    });
  });
});
