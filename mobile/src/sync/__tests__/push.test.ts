import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { clearNotePendingOp, deleteNoteRow, listNotesPendingDelete, listNotesPendingUpdate, listUnsyncedNotes, markNoteSynced } from "../../db/notesRepo";
import { deleteTaskRow, listTasksPendingDelete, markTaskSynced } from "../../db/tasksRepo";
import { confirmExceptionUpserted, listExceptionsPendingUpsert } from "../../db/eventExceptionsRepo";
import { confirmHabitLogCreated, listPendingHabitLogs } from "../../db/habitsRepo";
import { LocalEventException, LocalHabitLog, LocalNote, LocalTask, PushResult } from "../../types";
import { pushToServer } from "../push";

// pushToServer solo habla con SQLite (los *Repo) y con la API: todo eso se sustituye por dobles. Por defecto cada
// `list*` no devuelve nada pendiente y cada confirmación no hace nada; cada test rellena solo lo que necesita.
const { repo } = vi.hoisted(() => ({
  repo: (...names: string[]) =>
    Object.fromEntries(names.map((name) => [name, name.startsWith("list") ? vi.fn(async () => []) : vi.fn(async () => undefined)])),
}));

vi.mock("../../api/client", () => ({ api: { post: vi.fn() } }));
vi.mock("../../db/eventsRepo", () => ({
  ...repo("listUnsyncedEvents", "listEventsPendingUpdate", "listEventsPendingDelete", "markEventSynced", "clearEventPendingOp", "deleteEventRow"),
  parseEvent: vi.fn((e: unknown) => e),
}));
vi.mock("../../db/tasksRepo", () => ({
  ...repo("listUnsyncedTasks", "listTasksPendingUpdate", "listTasksPendingDelete", "markTaskSynced", "clearTaskPendingOp", "deleteTaskRow"),
  parseTaskTags: vi.fn(() => []),
}));
vi.mock("../../db/subtasksRepo", () =>
  repo(
    "listUnsyncedSubtasksReadyToPush",
    "listSubtasksPendingUpdate",
    "listSubtasksPendingDelete",
    "markSubtaskSynced",
    "clearSubtaskPendingOp",
    "deleteSubtaskRow"
  )
);
vi.mock("../../db/habitsRepo", () =>
  repo(
    "listPendingHabitLogs",
    "confirmHabitLogCreated",
    "confirmHabitLogDeleted",
    "listUnsyncedHabits",
    "listHabitsPendingUpdate",
    "listHabitsPendingDelete",
    "markHabitSynced",
    "clearHabitPendingOp",
    "deleteHabitRow"
  )
);
vi.mock("../../db/eventExceptionsRepo", () =>
  repo("listExceptionsPendingUpsert", "listExceptionsPendingDelete", "confirmExceptionUpserted", "confirmExceptionDeleted")
);
vi.mock("../../db/notesRepo", () =>
  repo("listUnsyncedNotes", "listNotesPendingUpdate", "listNotesPendingDelete", "markNoteSynced", "clearNotePendingOp", "deleteNoteRow")
);
vi.mock("../../db/transactionsRepo", () =>
  repo(
    "listUnsyncedTransactions",
    "listTransactionsPendingUpdate",
    "listTransactionsPendingDelete",
    "markTransactionSynced",
    "clearTransactionPendingOp",
    "deleteTransactionRow"
  )
);
vi.mock("../../db/savingsGoalsRepo", () =>
  repo(
    "listUnsyncedSavingsGoals",
    "listSavingsGoalsPendingUpdate",
    "listSavingsGoalsPendingDelete",
    "markSavingsGoalSynced",
    "clearSavingsGoalPendingOp",
    "deleteSavingsGoalRow"
  )
);
vi.mock("../../db/goalsRepo", () =>
  repo("listUnsyncedGoals", "listGoalsPendingUpdate", "listGoalsPendingDelete", "markGoalSynced", "clearGoalPendingOp", "deleteGoalRow")
);
vi.mock("../../db/goalProgressRepo", () =>
  repo(
    "listUnsyncedProgressReadyToPush",
    "listProgressPendingUpdate",
    "listProgressPendingDelete",
    "markProgressSynced",
    "clearProgressPendingOp",
    "deleteProgressRow"
  )
);
vi.mock("../../db/projectsRepo", () =>
  repo("listUnsyncedProjects", "listProjectsPendingUpdate", "listProjectsPendingDelete", "markProjectSynced", "clearProjectPendingOp", "deleteProjectRow")
);
vi.mock("../../db/projectTasksRepo", () =>
  repo(
    "listUnsyncedProjectTasksReadyToPush",
    "listProjectTasksPendingUpdate",
    "listProjectTasksPendingDelete",
    "markProjectTaskSynced",
    "clearProjectTaskPendingOp",
    "deleteProjectTaskRow"
  )
);
vi.mock("../../db/projectPagesRepo", () =>
  repo(
    "listUnsyncedProjectPagesReadyToPush",
    "listProjectPagesPendingUpdate",
    "listProjectPagesPendingDelete",
    "markProjectPageSynced",
    "clearProjectPagePendingOp",
    "deleteProjectPageRow"
  )
);
vi.mock("../../db/scheduleRepo", () =>
  repo("listUnsyncedSchedules", "listSchedulesPendingUpdate", "listSchedulesPendingDelete", "markScheduleSynced", "clearSchedulePendingOp", "deleteScheduleDbRow")
);
vi.mock("../../db/scheduleRowsRepo", () =>
  repo("listUnsyncedRowsReadyToPush", "listRowsPendingUpdate", "listRowsPendingDelete", "markRowSynced", "clearRowPendingOp", "deleteRowDbRow")
);
vi.mock("../../db/calendarLegendRepo", () =>
  repo(
    "listUnsyncedCategories",
    "listCategoriesPendingUpdate",
    "listCategoriesPendingDelete",
    "markCategorySynced",
    "clearCategoryPendingOp",
    "deleteCategoryRow",
    "listMarksPendingUpsert",
    "listMarksPendingDelete",
    "confirmMarkUpserted",
    "confirmMarkDeleted"
  )
);
vi.mock("../../db/customPagesRepo", () =>
  repo(
    "listUnsyncedCustomPages",
    "listCustomPagesPendingUpdate",
    "listCustomPagesPendingDelete",
    "markCustomPageSynced",
    "clearCustomPagePendingOp",
    "deleteCustomPageRow"
  )
);

const post = vi.mocked(api.post);

function note(id: string, synced: 0 | 1 = 1): LocalNote {
  return { id, content: `nota ${id}`, checked: 0, createdAt: "2026-10-15T10:00:00.000Z", updatedAt: "2026-10-15T10:00:00.000Z", synced, pendingOp: null };
}

function task(id: string, synced: 0 | 1 = 1): LocalTask {
  return { id, synced } as LocalTask;
}

function exception(eventId: string, originalStartTime: string): LocalEventException {
  return { eventId, originalStartTime, serverId: null, status: "cancelled", newStartTime: null, newEndTime: null, updatedAt: "", synced: 1, pendingOp: "upsert" };
}

function response(partial: Partial<PushResult> = {}): PushResult {
  return { idMappings: [], conflicts: [], ...partial };
}

function failure(section: string, op: string, index: number) {
  return { section, op, index, entityType: section, status: 400, message: "rechazado", retryable: false };
}

/** Cuerpo de la n-ésima llamada a POST /sync/push. */
function sentBody(call = 0): Record<string, any> {
  return post.mock.calls[call][1] as Record<string, any>;
}

describe("pushToServer", () => {
  beforeEach(() => {
    // Vuelve cada doble a su implementación inicial (listas vacías) y descarta lo que haya quedado de otro test.
    vi.resetAllMocks();
  });

  it("sin nada pendiente devuelve 0 sin llamar a la API", async () => {
    await expect(pushToServer()).resolves.toBe(0);
    expect(post).not.toHaveBeenCalled();
  });

  it("pide el éxito parcial (partialFailures: true) y manda los cambios pendientes", async () => {
    vi.mocked(listNotesPendingUpdate).mockResolvedValueOnce([note("7")]);
    vi.mocked(listNotesPendingDelete).mockResolvedValueOnce([note("8"), note("uuid-sin-subir", 0)]);
    post.mockResolvedValueOnce(response());

    await pushToServer();

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe("/sync/push");
    const body = sentBody();
    expect(body.partialFailures).toBe(true);
    expect(body.notes.update).toEqual([{ id: 7, clientUpdatedAt: "2026-10-15T10:00:00.000Z", content: "nota 7", checked: false }]);
    // Una nota que nunca llegó al servidor (synced = 0) no se borra allí.
    expect(body.deletes).toEqual([{ entityType: "note", id: 8 }]);
  });

  it("no confirma las ediciones, upserts y borrados que el servidor rechaza, y sí el resto", async () => {
    vi.mocked(listNotesPendingUpdate).mockResolvedValueOnce([note("1"), note("2"), note("3")]);
    vi.mocked(listExceptionsPendingUpsert).mockResolvedValueOnce([exception("40", "2026-10-20T09:00:00.000Z"), exception("41", "2026-10-21T09:00:00.000Z")]);
    vi.mocked(listPendingHabitLogs).mockResolvedValueOnce([
      { habitId: 5, date: "2026-10-14", serverId: null, pending: "create" },
      { habitId: 5, date: "2026-10-15", serverId: null, pending: "create" },
    ] satisfies LocalHabitLog[]);
    // En `deletes` van primero las tareas y luego las notas: índice 0 = tarea 20, 1 = nota 10, 2 = nota 11.
    vi.mocked(listTasksPendingDelete).mockResolvedValueOnce([task("20")]);
    vi.mocked(listNotesPendingDelete).mockResolvedValueOnce([note("10"), note("11")]);
    post.mockResolvedValueOnce(
      response({
        failures: [failure("notes", "update", 1), failure("eventExceptions", "upsert", 0), failure("habitLogs", "create", 1), failure("deletes", "delete", 1)],
      })
    );

    await expect(pushToServer()).resolves.toBe(4);

    expect(sentBody().deletes).toEqual([
      { entityType: "task", id: 20 },
      { entityType: "note", id: 10 },
      { entityType: "note", id: 11 },
    ]);

    expect(vi.mocked(clearNotePendingOp).mock.calls).toEqual([["1"], ["3"]]);
    expect(vi.mocked(confirmExceptionUpserted).mock.calls).toEqual([["41", "2026-10-21T09:00:00.000Z"]]);
    expect(vi.mocked(confirmHabitLogCreated).mock.calls).toEqual([[5, "2026-10-14"]]);
    expect(vi.mocked(deleteTaskRow).mock.calls).toEqual([["20"]]);
    expect(vi.mocked(deleteNoteRow).mock.calls).toEqual([["11"]]);
  });

  it("con un servidor que no manda `failures` lo confirma todo", async () => {
    vi.mocked(listNotesPendingUpdate).mockResolvedValueOnce([note("1"), note("2")]);
    vi.mocked(listNotesPendingDelete).mockResolvedValueOnce([note("3")]);
    post.mockResolvedValueOnce(response());

    await expect(pushToServer()).resolves.toBe(0);

    expect(vi.mocked(clearNotePendingOp).mock.calls).toEqual([["1"], ["2"]]);
    expect(vi.mocked(deleteNoteRow).mock.calls).toEqual([["3"]]);
  });

  it("las altas solo se confirman a través de idMappings, cada una con su repo", async () => {
    vi.mocked(listUnsyncedNotes).mockResolvedValueOnce([note("local-a", 0), note("local-b", 0)]);
    post.mockResolvedValueOnce(
      response({
        idMappings: [
          { entityType: "note", localId: "local-a", id: 100 },
          { entityType: "task", localId: "local-t", id: 200 },
        ],
        failures: [failure("notes", "create", 1)],
      })
    );
    // Segunda pasada: ya no queda nada pendiente.

    await pushToServer();

    expect(sentBody().notes.create).toEqual([
      { localId: "local-a", content: "nota local-a", checked: false },
      { localId: "local-b", content: "nota local-b", checked: false },
    ]);
    expect(vi.mocked(markNoteSynced).mock.calls).toEqual([["local-a", 100]]);
    expect(vi.mocked(markTaskSynced).mock.calls).toEqual([["local-t", 200]]);
    // Una alta no se confirma con clearXPendingOp, aunque no haya fallado.
    expect(clearNotePendingOp).not.toHaveBeenCalled();
  });

  it("con idMappings hace una segunda pasada y devuelve el recuento de fallos de esa pasada", async () => {
    // Primera pasada: la nota b falla; la a se crea.
    vi.mocked(listUnsyncedNotes).mockResolvedValueOnce([note("local-a", 0), note("local-b", 0)]);
    post.mockResolvedValueOnce(response({ idMappings: [{ entityType: "note", localId: "local-a", id: 100 }], failures: [failure("notes", "create", 1)] }));
    // Segunda pasada: la b sigue con synced = 0, se reintenta y vuelve a fallar (junto con una edición).
    vi.mocked(listUnsyncedNotes).mockResolvedValueOnce([note("local-b", 0)]);
    vi.mocked(listNotesPendingUpdate).mockResolvedValueOnce([]).mockResolvedValueOnce([note("9")]);
    post.mockResolvedValueOnce(response({ failures: [failure("notes", "create", 0), failure("notes", "update", 0)] }));

    await expect(pushToServer()).resolves.toBe(2);

    expect(post).toHaveBeenCalledTimes(2);
    expect(sentBody(1).notes.create).toEqual([{ localId: "local-b", content: "nota local-b", checked: false }]);
    expect(clearNotePendingOp).not.toHaveBeenCalled();
  });

  it("la segunda pasada no encadena una tercera aunque también cree cosas", async () => {
    vi.mocked(listUnsyncedNotes).mockResolvedValueOnce([note("local-a", 0)]).mockResolvedValueOnce([note("local-b", 0)]);
    post
      .mockResolvedValueOnce(response({ idMappings: [{ entityType: "note", localId: "local-a", id: 100 }] }))
      .mockResolvedValueOnce(response({ idMappings: [{ entityType: "note", localId: "local-b", id: 101 }] }));
    // Si hubiera una tercera pasada, también tendría algo que subir.
    vi.mocked(listUnsyncedNotes).mockResolvedValueOnce([note("local-c", 0)]);

    await expect(pushToServer()).resolves.toBe(0);

    expect(post).toHaveBeenCalledTimes(2);
    expect(vi.mocked(markNoteSynced).mock.calls).toEqual([
      ["local-a", 100],
      ["local-b", 101],
    ]);
  });

  it("pushToServer(false) no hace segunda pasada y devuelve sus propios fallos", async () => {
    vi.mocked(listUnsyncedNotes).mockResolvedValueOnce([note("local-a", 0), note("local-b", 0)]);
    post.mockResolvedValueOnce(response({ idMappings: [{ entityType: "note", localId: "local-a", id: 100 }], failures: [failure("notes", "create", 1)] }));

    await expect(pushToServer(false)).resolves.toBe(1);
    expect(post).toHaveBeenCalledTimes(1);
  });
});
