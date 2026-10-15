import { syncPushSchema, validateSyncPushItems } from "../../../src/validators/syncValidators";

const UUID = "11111111-1111-1111-1111-111111111111";

function envelope(body: unknown) {
  const { error, value } = syncPushSchema.validate(body, { abortEarly: false, stripUnknown: true });
  if (error) throw error;
  return value as Record<string, unknown>;
}

describe("syncValidators", () => {
  describe("syncPushSchema (forma del sobre)", () => {
    it("rellena con listas vacías las secciones que faltan", () => {
      const value = envelope({});
      expect(value.notes).toEqual({ create: [], update: [] });
      expect(value.eventExceptions).toEqual({ upsert: [] });
      expect(value.deletes).toEqual([]);
    });

    it("deja pasar los elementos tal cual, con todos sus campos, para validarlos después uno a uno", () => {
      const value = envelope({ notes: { create: [{ localId: "no-es-uuid", content: "x", otro: 1 }] } });
      expect(value.notes).toEqual({ create: [{ localId: "no-es-uuid", content: "x", otro: 1 }], update: [] });
    });

    it("partialFailures es false salvo que el cliente lo pida, y validateSyncPushItems lo conserva", () => {
      expect(validateSyncPushItems(envelope({})).body.partialFailures).toBe(false);
      expect(validateSyncPushItems(envelope({ partialFailures: true })).body.partialFailures).toBe(true);
    });

    it("rechaza un sobre mal formado (una sección que no es una lista)", () => {
      expect(syncPushSchema.validate({ notes: { create: "x" } }).error).toBeDefined();
      expect(syncPushSchema.validate({ deletes: [1] }).error).toBeDefined();
    });
  });

  describe("validateSyncPushItems", () => {
    it("sustituye por null solo el elemento inválido, conservando el índice de los demás, y anota su fallo", () => {
      const { body, failures } = validateSyncPushItems(
        envelope({
          notes: {
            create: [
              { localId: UUID, content: "Válida" },
              { localId: "no-es-uuid", content: "Inválida" },
            ],
          },
        })
      );

      expect((body.notes as { create: unknown[] }).create).toEqual([{ localId: UUID, content: "Válida" }, null]);
      expect(failures).toEqual([
        expect.objectContaining({ section: "notes", op: "create", index: 1, entityType: "note", status: 400, retryable: false }),
      ]);
      expect(failures[0].message).toMatch(/localId/);
    });

    it("normaliza los elementos válidos igual que el middleware (fechas a Date, campos desconocidos fuera)", () => {
      const { body, failures } = validateSyncPushItems(
        envelope({ tasks: { update: [{ id: 3, clientUpdatedAt: "2026-08-02T00:00:00.000Z", title: "X", sobra: true }] } })
      );

      expect(failures).toEqual([]);
      const [task] = (body.tasks as { update: Record<string, unknown>[] }).update;
      expect(task.clientUpdatedAt).toBeInstanceOf(Date);
      expect(task).not.toHaveProperty("sobra");
    });

    it("valida cada borrado por separado y nombra su tipo en el fallo", () => {
      const { body, failures } = validateSyncPushItems(
        envelope({
          deletes: [
            { entityType: "note", id: 4 },
            { entityType: "subtask", id: 5 }, // le falta taskId
            { entityType: "nave", id: 6 },
          ],
        })
      );

      expect(body.deletes).toEqual([{ entityType: "note", id: 4 }, null, null]);
      expect(failures.map((f) => [f.index, f.entityType])).toEqual([
        [1, "subtask"],
        [2, "nave"],
      ]);
    });
  });
});
