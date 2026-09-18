import request from "supertest";
import { app } from "../../src/app";
import { prisma } from "../../src/config/database";

describe("Event Invitations (compartir eventos entre usuarios)", () => {
  let ownerToken: string;
  let ownerUsername: string;
  let inviteeToken: string;
  let inviteeUsername: string;
  let categoryId: number;

  beforeEach(async () => {
    await prisma.eventInvitation.deleteMany({});
    await prisma.eventException.deleteMany({});
    await prisma.event.deleteMany({});
    await prisma.notification.deleteMany({});
    await prisma.user.deleteMany({});

    ownerUsername = "owner_user";
    const ownerRes = await request(app).post("/auth/register").send({
      username: ownerUsername,
      email: "owner@example.com",
      password: "Password123",
      name: "Owner User",
    });
    ownerToken = ownerRes.body.token;

    inviteeUsername = "invitee_user";
    const inviteeRes = await request(app).post("/auth/register").send({
      username: inviteeUsername,
      email: "invitee@example.com",
      password: "Password123",
      name: "Invitee User",
    });
    inviteeToken = inviteeRes.body.token;

    const categories = await request(app).get("/event-categories").set(ownerAuth());
    categoryId = categories.body.categories[0].id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function ownerAuth() {
    return { Authorization: `Bearer ${ownerToken}` };
  }
  function inviteeAuth() {
    return { Authorization: `Bearer ${inviteeToken}` };
  }

  async function createEvent(overrides: Partial<Record<string, unknown>> = {}) {
    const response = await request(app)
      .post("/agenda/events")
      .set(ownerAuth())
      .send({
        title: "Cena de cumpleaños",
        categoryId,
        startTime: "2026-10-10T19:00:00.000Z",
        endTime: "2026-10-10T21:00:00.000Z",
        ...overrides,
      });
    return response.body.id as number;
  }

  describe("POST /agenda/events/:id/invitations", () => {
    it("invita por username y crea una notificación para el invitado", async () => {
      const eventId = await createEvent();

      const response = await request(app)
        .post(`/agenda/events/${eventId}/invitations`)
        .set(ownerAuth())
        .send({ identifier: inviteeUsername });

      expect(response.status).toBe(201);
      expect(response.body.status).toBe("pending");
      expect(response.body.invitee.username).toBe(inviteeUsername);

      const notifications = await request(app).get("/notifications").set(inviteeAuth());
      expect(notifications.body.notifications.some((n: { type: string }) => n.type === "event_invitation")).toBe(true);
    });

    it("invita por email igual que por username", async () => {
      const eventId = await createEvent();
      const response = await request(app)
        .post(`/agenda/events/${eventId}/invitations`)
        .set(ownerAuth())
        .send({ identifier: "invitee@example.com" });
      expect(response.status).toBe(201);
    });

    it("rechaza invitar si no eres quien creó el evento", async () => {
      const eventId = await createEvent();
      const response = await request(app)
        .post(`/agenda/events/${eventId}/invitations`)
        .set(inviteeAuth())
        .send({ identifier: ownerUsername });
      expect(response.status).toBe(403);
    });

    it("rechaza invitar a un usuario que no existe", async () => {
      const eventId = await createEvent();
      const response = await request(app)
        .post(`/agenda/events/${eventId}/invitations`)
        .set(ownerAuth())
        .send({ identifier: "no_existe_este_usuario" });
      expect(response.status).toBe(404);
    });

    it("rechaza invitarse a uno mismo", async () => {
      const eventId = await createEvent();
      const response = await request(app)
        .post(`/agenda/events/${eventId}/invitations`)
        .set(ownerAuth())
        .send({ identifier: ownerUsername });
      expect(response.status).toBe(400);
    });

    it("rechaza una segunda invitación mientras la primera sigue pendiente", async () => {
      const eventId = await createEvent();
      await request(app).post(`/agenda/events/${eventId}/invitations`).set(ownerAuth()).send({ identifier: inviteeUsername });
      const response = await request(app)
        .post(`/agenda/events/${eventId}/invitations`)
        .set(ownerAuth())
        .send({ identifier: inviteeUsername });
      expect(response.status).toBe(409);
    });

    it("reactiva a pending una invitación que se había rechazado, en vez de fallar", async () => {
      const eventId = await createEvent();
      const first = await request(app)
        .post(`/agenda/events/${eventId}/invitations`)
        .set(ownerAuth())
        .send({ identifier: inviteeUsername });
      await request(app).put(`/agenda/invitations/${first.body.id}`).set(inviteeAuth()).send({ status: "declined" });

      const second = await request(app)
        .post(`/agenda/events/${eventId}/invitations`)
        .set(ownerAuth())
        .send({ identifier: inviteeUsername });
      expect(second.status).toBe(201);
      expect(second.body.id).toBe(first.body.id); // misma fila reactivada, no una nueva
      expect(second.body.status).toBe("pending");
    });
  });

  describe("Visibilidad en el calendario", () => {
    it("el evento NO aparece en el calendario del invitado mientras la invitación esté pending", async () => {
      const eventId = await createEvent();
      await request(app).post(`/agenda/events/${eventId}/invitations`).set(ownerAuth()).send({ identifier: inviteeUsername });

      const day = await request(app).get("/agenda/day/2026-10-10").set(inviteeAuth());
      expect(day.body.events).toHaveLength(0);
    });

    it("el evento aparece con sharing.role=invitee tras aceptar, y sharing.role=owner para quien lo creó", async () => {
      const eventId = await createEvent();
      const invitation = await request(app)
        .post(`/agenda/events/${eventId}/invitations`)
        .set(ownerAuth())
        .send({ identifier: inviteeUsername });
      await request(app).put(`/agenda/invitations/${invitation.body.id}`).set(inviteeAuth()).send({ status: "accepted" });

      const inviteeDay = await request(app).get("/agenda/day/2026-10-10").set(inviteeAuth());
      expect(inviteeDay.body.events).toHaveLength(1);
      expect(inviteeDay.body.events[0].sharing).toEqual({
        role: "invitee",
        owner: expect.objectContaining({ username: ownerUsername }),
        invitationId: invitation.body.id,
      });

      const ownerDay = await request(app).get("/agenda/day/2026-10-10").set(ownerAuth());
      expect(ownerDay.body.events[0].sharing).toEqual({
        role: "owner",
        with: [expect.objectContaining({ username: inviteeUsername })],
      });
    });

    it("un evento sin invitaciones aceptadas tiene sharing=null", async () => {
      await createEvent();
      const day = await request(app).get("/agenda/day/2026-10-10").set(ownerAuth());
      expect(day.body.events[0].sharing).toBeNull();
    });

    it("el evento deja de aparecer si el invitado lo rechaza", async () => {
      const eventId = await createEvent();
      const invitation = await request(app)
        .post(`/agenda/events/${eventId}/invitations`)
        .set(ownerAuth())
        .send({ identifier: inviteeUsername });
      await request(app).put(`/agenda/invitations/${invitation.body.id}`).set(inviteeAuth()).send({ status: "declined" });

      const day = await request(app).get("/agenda/day/2026-10-10").set(inviteeAuth());
      expect(day.body.events).toHaveLength(0);
    });

    it("una serie recurrente compartida se ve en todas sus ocurrencias, con el mismo distintivo", async () => {
      const eventId = await createEvent({
        startTime: "2026-10-05T19:00:00.000Z",
        endTime: "2026-10-05T21:00:00.000Z",
        isRecurring: true,
        recurringPattern: "weekly",
      });
      const invitation = await request(app)
        .post(`/agenda/events/${eventId}/invitations`)
        .set(ownerAuth())
        .send({ identifier: inviteeUsername });
      await request(app).put(`/agenda/invitations/${invitation.body.id}`).set(inviteeAuth()).send({ status: "accepted" });

      const week1 = await request(app).get("/agenda/day/2026-10-05").set(inviteeAuth());
      const week2 = await request(app).get("/agenda/day/2026-10-12").set(inviteeAuth());
      expect(week1.body.events).toHaveLength(1);
      expect(week2.body.events).toHaveLength(1);
      expect(week1.body.events[0].sharing.role).toBe("invitee");
      expect(week2.body.events[0].sharing.role).toBe("invitee");
    });
  });

  // El móvil no llama a /agenda/day — se sincroniza offline vía /sync/pull (ver
  // syncService.pull), que tiene su propio criterio de visibilidad (ownWhere/sharedEventsWhere)
  // que debe coincidir con el de la Agenda web para que ambas plataformas vean lo mismo.
  describe("Sincronización móvil (/sync/pull)", () => {
    it("el invitado recibe el evento compartido en su próximo pull tras aceptar, con sharing.role=invitee", async () => {
      const eventId = await createEvent();
      const invitation = await request(app)
        .post(`/agenda/events/${eventId}/invitations`)
        .set(ownerAuth())
        .send({ identifier: inviteeUsername });
      await request(app).put(`/agenda/invitations/${invitation.body.id}`).set(inviteeAuth()).send({ status: "accepted" });

      const pull = await request(app).get("/sync/pull").set(inviteeAuth());
      expect(pull.body.events).toHaveLength(1);
      expect(pull.body.events[0]).toMatchObject({
        id: eventId,
        sharing: { role: "invitee", owner: expect.objectContaining({ username: ownerUsername }), invitationId: invitation.body.id },
      });
    });

    it("aceptar toca el updatedAt del evento para que un pull incremental (cursor ya avanzado) también lo recoja", async () => {
      const eventId = await createEvent();
      // El invitado ya venía sincronizando ANTES de que le invitaran — su cursor queda por
      // delante del updatedAt original del evento, creado antes de esta llamada.
      const inviteeCursor = (await request(app).get("/sync/pull").set(inviteeAuth())).body.serverTime;

      const invitation = await request(app)
        .post(`/agenda/events/${eventId}/invitations`)
        .set(ownerAuth())
        .send({ identifier: inviteeUsername });
      await request(app).put(`/agenda/invitations/${invitation.body.id}`).set(inviteeAuth()).send({ status: "accepted" });

      // Sin tocar `updatedAt` al aceptar, este pull incremental (since=cursor posterior a la
      // creación del evento) no vería el evento — sigue sin haber cambiado desde su punto de vista.
      const incrementalPull = await request(app).get("/sync/pull").set(inviteeAuth()).query({ since: inviteeCursor });
      expect(incrementalPull.body.events).toHaveLength(1);
      expect(incrementalPull.body.events[0].id).toBe(eventId);
    });

    it("quitarse un evento del calendario (DELETE /agenda/invitations/:id) deja tombstone para el invitado, no para el dueño", async () => {
      const eventId = await createEvent();
      const invitation = await request(app)
        .post(`/agenda/events/${eventId}/invitations`)
        .set(ownerAuth())
        .send({ identifier: inviteeUsername });
      await request(app).put(`/agenda/invitations/${invitation.body.id}`).set(inviteeAuth()).send({ status: "accepted" });

      const inviteeCursor = (await request(app).get("/sync/pull").set(inviteeAuth())).body.serverTime;
      const ownerCursor = (await request(app).get("/sync/pull").set(ownerAuth())).body.serverTime;

      await request(app).delete(`/agenda/invitations/${invitation.body.id}`).set(inviteeAuth());

      const inviteePull = await request(app).get("/sync/pull").set(inviteeAuth()).query({ since: inviteeCursor });
      expect(inviteePull.body.tombstones).toHaveLength(1);
      expect(inviteePull.body.tombstones[0]).toMatchObject({ entityType: "event", entityId: eventId });

      // El dueño no pierde nada: el evento sigue siendo suyo, solo dejó de estar compartido.
      const ownerPull = await request(app).get("/sync/pull").set(ownerAuth()).query({ since: ownerCursor });
      expect(ownerPull.body.tombstones).toHaveLength(0);
    });

    it("borrar el evento entero deja tombstone tanto para el dueño como para cada invitado con invitación aceptada", async () => {
      const eventId = await createEvent();
      const invitation = await request(app)
        .post(`/agenda/events/${eventId}/invitations`)
        .set(ownerAuth())
        .send({ identifier: inviteeUsername });
      await request(app).put(`/agenda/invitations/${invitation.body.id}`).set(inviteeAuth()).send({ status: "accepted" });

      const inviteeCursor = (await request(app).get("/sync/pull").set(inviteeAuth())).body.serverTime;

      await request(app).delete(`/agenda/events/${eventId}`).set(ownerAuth());

      const inviteePull = await request(app).get("/sync/pull").set(inviteeAuth()).query({ since: inviteeCursor });
      expect(inviteePull.body.tombstones).toHaveLength(1);
      expect(inviteePull.body.tombstones[0]).toMatchObject({ entityType: "event", entityId: eventId });
    });
  });

  describe("PUT /agenda/invitations/:id", () => {
    it("solo el propio invitado puede responder, no quien invitó ni un tercero", async () => {
      const eventId = await createEvent();
      const invitation = await request(app)
        .post(`/agenda/events/${eventId}/invitations`)
        .set(ownerAuth())
        .send({ identifier: inviteeUsername });

      const response = await request(app)
        .put(`/agenda/invitations/${invitation.body.id}`)
        .set(ownerAuth())
        .send({ status: "accepted" });
      expect(response.status).toBe(403);
    });

    it("rechaza un status que no sea accepted/declined", async () => {
      const eventId = await createEvent();
      const invitation = await request(app)
        .post(`/agenda/events/${eventId}/invitations`)
        .set(ownerAuth())
        .send({ identifier: inviteeUsername });

      const response = await request(app)
        .put(`/agenda/invitations/${invitation.body.id}`)
        .set(inviteeAuth())
        .send({ status: "maybe" });
      expect(response.status).toBe(400);
    });
  });

  describe("DELETE /agenda/invitations/:id", () => {
    it("el invitado puede quitarse el evento de su calendario del todo", async () => {
      const eventId = await createEvent();
      const invitation = await request(app)
        .post(`/agenda/events/${eventId}/invitations`)
        .set(ownerAuth())
        .send({ identifier: inviteeUsername });
      await request(app).put(`/agenda/invitations/${invitation.body.id}`).set(inviteeAuth()).send({ status: "accepted" });

      const remove = await request(app).delete(`/agenda/invitations/${invitation.body.id}`).set(inviteeAuth());
      expect(remove.status).toBe(200);

      const day = await request(app).get("/agenda/day/2026-10-10").set(inviteeAuth());
      expect(day.body.events).toHaveLength(0);
    });

    it("quien creó el evento puede revocar una invitación", async () => {
      const eventId = await createEvent();
      const invitation = await request(app)
        .post(`/agenda/events/${eventId}/invitations`)
        .set(ownerAuth())
        .send({ identifier: inviteeUsername });

      const remove = await request(app).delete(`/agenda/invitations/${invitation.body.id}`).set(ownerAuth());
      expect(remove.status).toBe(200);
    });

    it("rechaza que un tercero ajeno borre la invitación", async () => {
      const eventId = await createEvent();
      const invitation = await request(app)
        .post(`/agenda/events/${eventId}/invitations`)
        .set(ownerAuth())
        .send({ identifier: inviteeUsername });

      const thirdParty = await request(app).post("/auth/register").send({
        username: "third_party",
        email: "third@example.com",
        password: "Password123",
        name: "Third Party",
      });

      const remove = await request(app)
        .delete(`/agenda/invitations/${invitation.body.id}`)
        .set({ Authorization: `Bearer ${thirdParty.body.token}` });
      expect(remove.status).toBe(403);
    });
  });

  describe("Listados", () => {
    it("GET /agenda/events/:id/invitations solo lo puede ver quien creó el evento", async () => {
      const eventId = await createEvent();
      await request(app).post(`/agenda/events/${eventId}/invitations`).set(ownerAuth()).send({ identifier: inviteeUsername });

      const asOwner = await request(app).get(`/agenda/events/${eventId}/invitations`).set(ownerAuth());
      expect(asOwner.status).toBe(200);
      expect(asOwner.body.invitations).toHaveLength(1);

      const asInvitee = await request(app).get(`/agenda/events/${eventId}/invitations`).set(inviteeAuth());
      expect(asInvitee.status).toBe(403);
    });

    it("GET /agenda/invitations lista las invitaciones recibidas, con el evento y quien invitó", async () => {
      const eventId = await createEvent();
      await request(app).post(`/agenda/events/${eventId}/invitations`).set(ownerAuth()).send({ identifier: inviteeUsername });

      const response = await request(app).get("/agenda/invitations").set(inviteeAuth());
      expect(response.status).toBe(200);
      expect(response.body.invitations).toHaveLength(1);
      expect(response.body.invitations[0].event.title).toBe("Cena de cumpleaños");
      expect(response.body.invitations[0].inviter.username).toBe(ownerUsername);
      expect(response.body.invitations[0].status).toBe("pending");
    });

    it("GET /agenda/invitations?status=accepted filtra por estado", async () => {
      const eventId = await createEvent();
      const invitation = await request(app)
        .post(`/agenda/events/${eventId}/invitations`)
        .set(ownerAuth())
        .send({ identifier: inviteeUsername });
      await request(app).put(`/agenda/invitations/${invitation.body.id}`).set(inviteeAuth()).send({ status: "accepted" });

      const pending = await request(app).get("/agenda/invitations?status=pending").set(inviteeAuth());
      const accepted = await request(app).get("/agenda/invitations?status=accepted").set(inviteeAuth());
      expect(pending.body.invitations).toHaveLength(0);
      expect(accepted.body.invitations).toHaveLength(1);
    });
  });
});
