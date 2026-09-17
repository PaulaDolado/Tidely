import { api } from "../api/client";
import { getCursor, setCursor } from "../db/syncMeta";
import { upsertEvents, deleteEvent } from "../db/eventsRepo";
import { upsertEventExceptions, deleteEventExceptionByServerId } from "../db/eventExceptionsRepo";
import { upsertTasks, deleteTask } from "../db/tasksRepo";
import { upsertSubtasks, deleteSubtask } from "../db/subtasksRepo";
import { upsertNotes, deleteNoteByServerId } from "../db/notesRepo";
import { upsertHabits, upsertHabitLogs, deleteHabit, deleteHabitLogByServerId } from "../db/habitsRepo";
import { upsertTransactions, deleteTransaction } from "../db/transactionsRepo";
import { upsertSavingsGoals, deleteSavingsGoal } from "../db/savingsGoalsRepo";
import { upsertGoals, deleteGoal } from "../db/goalsRepo";
import { upsertGoalProgress, deleteGoalProgress } from "../db/goalProgressRepo";
import { upsertProjects, deleteProject } from "../db/projectsRepo";
import { upsertProjectTasks, deleteProjectTask } from "../db/projectTasksRepo";
import { upsertProjectPages, deleteProjectPage } from "../db/projectPagesRepo";
import { upsertSchedules, deleteSchedule } from "../db/scheduleRepo";
import { upsertScheduleRows, deleteScheduleRow } from "../db/scheduleRowsRepo";
import { upsertCategories, deleteCategory, upsertDayMarks, deleteDayMarkByServerId } from "../db/calendarLegendRepo";
import { upsertCustomPages, deleteCustomPage } from "../db/customPagesRepo";
import { PullResponse } from "../types";

/** Descarga lo cambiado desde el último cursor guardado (o bootstrap completo la primera vez) y
 * lo aplica a SQLite: upsert de lo creado/editado, borrado de lo que trae tombstone. El cursor
 * nuevo (`serverTime`) solo se guarda al final, si todo lo anterior tuvo éxito — si algo falla a
 * mitad, el próximo intento vuelve a pedir desde el mismo punto (idempotente: un upsert/delete
 * repetido no hace daño). */
export async function pullFromServer(): Promise<void> {
  const since = await getCursor();
  const query = since ? `?since=${encodeURIComponent(since)}` : "";
  const response = await api.get<PullResponse>(`/sync/pull${query}`);

  await upsertEvents(response.events);
  await upsertEventExceptions(response.eventExceptions);
  await upsertTasks(response.tasks);
  await upsertSubtasks(response.subtasks);
  await upsertNotes(response.notes);
  await upsertHabits(response.habits);
  await upsertHabitLogs(response.habitLogs);
  await upsertTransactions(response.transactions);
  await upsertSavingsGoals(response.savingsGoals);
  await upsertGoals(response.goals);
  await upsertGoalProgress(response.goalProgress);
  await upsertProjects(response.projects);
  await upsertProjectTasks(response.projectTasks);
  await upsertProjectPages(response.projectPages);
  await upsertSchedules(response.schedules);
  await upsertScheduleRows(response.scheduleRows);
  await upsertCategories(response.calendarLegendCategories);
  await upsertDayMarks(response.calendarDayMarks);
  await upsertCustomPages(response.customPages);

  for (const tombstone of response.tombstones) {
    switch (tombstone.entityType) {
      case "event":
        await deleteEvent(tombstone.entityId);
        break;
      case "eventException":
        await deleteEventExceptionByServerId(tombstone.entityId);
        break;
      case "task":
        await deleteTask(tombstone.entityId);
        break;
      case "subtask":
        await deleteSubtask(tombstone.entityId);
        break;
      case "note":
        await deleteNoteByServerId(tombstone.entityId);
        break;
      case "habit":
        await deleteHabit(tombstone.entityId);
        break;
      case "habitLog":
        await deleteHabitLogByServerId(tombstone.entityId);
        break;
      case "transaction":
        await deleteTransaction(tombstone.entityId);
        break;
      case "savingsGoal":
        await deleteSavingsGoal(tombstone.entityId);
        break;
      case "goal":
        await deleteGoal(tombstone.entityId);
        break;
      case "goalProgress":
        await deleteGoalProgress(tombstone.entityId);
        break;
      case "project":
        await deleteProject(tombstone.entityId);
        break;
      case "projectTask":
        await deleteProjectTask(tombstone.entityId);
        break;
      case "projectPage":
        await deleteProjectPage(tombstone.entityId);
        break;
      case "schedule":
        await deleteSchedule(tombstone.entityId);
        break;
      case "scheduleRow":
        await deleteScheduleRow(tombstone.entityId);
        break;
      case "calendarLegendCategory":
        await deleteCategory(tombstone.entityId);
        break;
      case "calendarDayMark":
        await deleteDayMarkByServerId(tombstone.entityId);
        break;
      case "customPage":
        await deleteCustomPage(tombstone.entityId);
        break;
    }
  }

  await setCursor(response.serverTime);
}
