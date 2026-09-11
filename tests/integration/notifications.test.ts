import request from "supertest";
import { app } from "../../src/app";
import { prisma } from "../../src/config/database";
import { createEventReminders, createGoalRiskAlerts } from "../../src/services/notificationService";

describe("Notifications Endpoints", () => {
  let token: string;
  let userId: number;
  // Ver el mismo comentario en tests/integration/agenda.test.ts.
  let categoryIds: Record<string, number>;

  beforeEach(async () => {
    await prisma.notification.deleteMany({});
    await prisma.event.deleteMany({});
    await prisma.goal.deleteMany({});
    await prisma.user.deleteMany({});

    const response = await request(app).post("/auth/register").send({
      username: "notifications",
      email: "notifications@example.com",
      password: "Password123",
      name: "Notif User",
    });
    token = response.body.token;
    userId = response.body.user.id;

    const categories = await request(app).get("/event-categories").set({ Authorization: `Bearer ${token}` });
    categoryIds = Object.fromEntries(categories.body.categories.map((c: { id: number; label: string }) => [c.label, c.id]));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function authed() {
    return { Authorization: `Bearer ${token}` };
  }

  describe("GET /notifications", () => {
    it("empieza vacío para un usuario nuevo", async () => {
      const response = await request(app).get("/notifications").set(authed());
      expect(response.status).toBe(200);
      expect(response.body.notifications).toEqual([]);
    });
  });

  describe("Recordatorios de eventos (vía createEventReminders)", () => {
    it("genera una notificación cuando un evento empieza en ~30 minutos", async () => {
      const now = new Date();
      const startTime = new Date(now.getTime() + 30 * 60 * 1000);
      const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);

      await request(app).post("/agenda/events").set(authed()).send({
        title: "Reunión importante",
        categoryId: categoryIds["Reunión"],
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
      });

      const created = await createEventReminders(now);
      expect(created).toBe(1);

      const response = await request(app).get("/notifications").set(authed());
      expect(response.body.notifications).toHaveLength(1);
      expect(response.body.notifications[0].type).toBe("event_reminder");

      const unread = await request(app).get("/notifications/unread-count").set(authed());
      expect(unread.body.unreadCount).toBe(1);
    });

    it("no duplica el recordatorio si el scheduler corre dos veces seguidas", async () => {
      const now = new Date();
      const startTime = new Date(now.getTime() + 30 * 60 * 1000);
      const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);

      await request(app).post("/agenda/events").set(authed()).send({
        title: "Reunión importante",
        categoryId: categoryIds["Reunión"],
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
      });

      await createEventReminders(now);
      const secondRun = await createEventReminders(new Date(now.getTime() + 60 * 1000)); // 1 min después

      expect(secondRun).toBe(0);
      const response = await request(app).get("/notifications").set(authed());
      expect(response.body.notifications).toHaveLength(1);
    });
  });

  describe("Alertas de metas en riesgo (vía createGoalRiskAlerts)", () => {
    it("genera una alerta para una meta muy por detrás del ritmo esperado", async () => {
      const periodStart = new Date();
      periodStart.setDate(periodStart.getDate() - 15);
      const periodEnd = new Date();
      periodEnd.setDate(periodEnd.getDate() + 15);

      await request(app)
        .post("/goals")
        .set(authed())
        .send({
          title: "Meta en riesgo",
          period: "monthly",
          targetValue: 30,
          periodStart: periodStart.toISOString(),
          periodEnd: periodEnd.toISOString(),
        });
      // currentValue queda en 0 (por defecto) — a mitad de periodo, eso es "en riesgo".

      const created = await createGoalRiskAlerts();
      expect(created).toBe(1);

      const response = await request(app).get("/notifications").set(authed());
      expect(response.body.notifications.some((n: { type: string }) => n.type === "goal_at_risk")).toBe(true);
    });
  });

  describe("PUT /notifications/:id/read y ownership", () => {
    it("marca una notificación propia como leída", async () => {
      await prisma.notification.create({
        data: { userId, type: "event_reminder", title: "t", message: "m" },
      });
      const list = await request(app).get("/notifications").set(authed());
      const id = list.body.notifications[0].id;

      const response = await request(app).put(`/notifications/${id}/read`).set(authed());
      expect(response.status).toBe(200);
      expect(response.body.read).toBe(true);
    });

    it("no permite marcar como leída una notificación de otro usuario", async () => {
      await prisma.notification.create({
        data: { userId, type: "event_reminder", title: "t", message: "m" },
      });
      const list = await request(app).get("/notifications").set(authed());
      const id = list.body.notifications[0].id;

      const otherUser = await request(app).post("/auth/register").send({
        username: "otro_notif",
        email: "otro-notif@example.com",
        password: "Password123",
        name: "Otro",
      });

      const response = await request(app)
        .put(`/notifications/${id}/read`)
        .set({ Authorization: `Bearer ${otherUser.body.token}` });

      expect(response.status).toBe(403);
    });

    it("PUT /notifications/read-all marca todas como leídas", async () => {
      await prisma.notification.createMany({
        data: [
          { userId, type: "event_reminder", title: "a", message: "a" },
          { userId, type: "event_reminder", title: "b", message: "b" },
        ],
      });

      const response = await request(app).put("/notifications/read-all").set(authed());
      expect(response.body.updated).toBe(2);

      const unread = await request(app).get("/notifications/unread-count").set(authed());
      expect(unread.body.unreadCount).toBe(0);
    });
  });
});
