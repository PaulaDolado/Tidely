import { type SQLiteDatabase } from "expo-sqlite";

// Espejo local (SQLite) del subconjunto de datos que la app necesita offline. Ver el comentario
// de cada tabla en types.ts para el porqué de cada columna — en resumen:
// - events/tasks/subtasks: el móvil puede CREAR filas nuevas → mismo patrón que `notes` ya usaba
//   en Fase 1 (id TEXT = uuid hasta sincronizar, luego id de servidor; `synced` + `pendingOp`).
// - event_exceptions/habits: solo caché de lectura, se sobrescriben en cada pull, sin `dirty`.
// - habit_logs: clave compuesta (habitId, date) — igual que en el propio servidor, así que ni
//   siquiera hace falta un id local generado por el cliente (ver sync/push.ts).
export async function initSchema(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL,
      categoryId INTEGER,
      startTime TEXT NOT NULL,
      endTime TEXT NOT NULL,
      location TEXT,
      isRecurring INTEGER NOT NULL DEFAULT 0,
      recurringPattern TEXT,
      reminderMinutesBefore TEXT NOT NULL DEFAULT '[]',
      guests TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL DEFAULT 'tidely',
      googleEventId TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0,
      pendingOp TEXT,
      sharingRole TEXT,
      sharingOwnerName TEXT,
      sharingOwnerUsername TEXT,
      sharingInvitationId INTEGER
    );

    CREATE TABLE IF NOT EXISTS event_exceptions (
      eventId TEXT NOT NULL,
      originalStartTime TEXT NOT NULL,
      serverId INTEGER,
      status TEXT NOT NULL,
      newStartTime TEXT,
      newEndTime TEXT,
      updatedAt TEXT NOT NULL,
      PRIMARY KEY (eventId, originalStartTime)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      plannerId INTEGER,
      projectId INTEGER,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'todo',
      priority TEXT NOT NULL DEFAULT 'medium',
      "order" REAL NOT NULL DEFAULT 0,
      dueDate TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      estimatedMinutes INTEGER,
      actualMinutes INTEGER NOT NULL DEFAULT 0,
      updatedAt TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0,
      pendingOp TEXT
    );

    CREATE TABLE IF NOT EXISTS subtasks (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      title TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      updatedAt TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0,
      pendingOp TEXT
    );

    CREATE TABLE IF NOT EXISTS habits (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS habit_logs (
      habitId INTEGER NOT NULL,
      date TEXT NOT NULL,
      serverId INTEGER,
      pending TEXT,
      PRIMARY KEY (habitId, date)
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      checked INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0,
      pendingOp TEXT
    );

    -- Fase 2 de sync (Finanzas, Objetivos, Proyectos, Horario, Páginas personalizadas): mismo
    -- patrón id/synced/pendingOp que events/tasks/notes arriba, para todo lo que el móvil puede
    -- crear offline. currentAmount de una meta de ahorro NO se guarda aquí — se calcula sumando
    -- transactions locales de esa categoría, igual que hace el propio backend (ver
    -- financeService.listSavingsGoals / ServerSavingsGoal en types.ts).

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      date TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0,
      pendingOp TEXT
    );

    CREATE TABLE IF NOT EXISTS savings_goals (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'ahorro',
      targetAmount REAL NOT NULL,
      category TEXT NOT NULL,
      stepAmount REAL NOT NULL DEFAULT 100,
      deadline TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0,
      pendingOp TEXT
    );

    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      period TEXT NOT NULL,
      targetValue INTEGER NOT NULL,
      currentValue INTEGER NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      bonusPoints INTEGER NOT NULL DEFAULT 10,
      periodStart TEXT NOT NULL,
      periodEnd TEXT NOT NULL,
      expired INTEGER NOT NULL DEFAULT 0,
      autoRenew INTEGER NOT NULL DEFAULT 1,
      updatedAt TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0,
      pendingOp TEXT
    );

    -- A diferencia de habit_logs, SÍ se edita/borra offline (ver goalsService.updateProgress/
    -- deleteProgress en el backend) — por eso lleva el triple id/synced/pendingOp normal, no la
    -- clave compuesta de habit_logs.
    CREATE TABLE IF NOT EXISTS goal_progress (
      id TEXT PRIMARY KEY,
      goalId TEXT NOT NULL,
      value INTEGER NOT NULL,
      note TEXT,
      date TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0,
      pendingOp TEXT
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'idea',
      priority TEXT NOT NULL DEFAULT 'medium',
      deadline TEXT,
      color TEXT,
      updatedAt TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0,
      pendingOp TEXT
    );

    CREATE TABLE IF NOT EXISTS project_tasks (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL,
      title TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      updatedAt TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0,
      pendingOp TEXT
    );

    -- content es HTML enriquecido (blob opaco para el sync — se sobrescribe entero, nunca se
    -- fusiona campo a campo, ver ProjectPage.content en el backend).
    CREATE TABLE IF NOT EXISTS project_pages (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'Página sin título',
      content TEXT NOT NULL DEFAULT '',
      "order" REAL NOT NULL DEFAULT 0,
      updatedAt TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0,
      pendingOp TEXT
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      "order" REAL NOT NULL DEFAULT 0,
      updatedAt TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0,
      pendingOp TEXT
    );

    CREATE TABLE IF NOT EXISTS schedule_rows (
      id TEXT PRIMARY KEY,
      scheduleId TEXT NOT NULL,
      "order" REAL NOT NULL DEFAULT 0,
      timeLabel TEXT NOT NULL DEFAULT '',
      monday TEXT NOT NULL DEFAULT '',
      tuesday TEXT NOT NULL DEFAULT '',
      wednesday TEXT NOT NULL DEFAULT '',
      thursday TEXT NOT NULL DEFAULT '',
      friday TEXT NOT NULL DEFAULT '',
      updatedAt TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0,
      pendingOp TEXT
    );

    CREATE TABLE IF NOT EXISTS calendar_legend_categories (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      color TEXT NOT NULL,
      "order" INTEGER NOT NULL DEFAULT 0,
      updatedAt TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0,
      pendingOp TEXT
    );

    -- Clave natural (date), no un id local — igual criterio que event_exceptions, pero esta SÍ
    -- se escribe localmente (pintar/despintar un día), así que necesita su propio synced/
    -- pendingOp. serverId permite emparejar el tombstone de un borrado hecho en otro
    -- dispositivo (mismo motivo que habit_logs.serverId).
    CREATE TABLE IF NOT EXISTS calendar_day_marks (
      date TEXT PRIMARY KEY,
      categoryId TEXT NOT NULL,
      serverId INTEGER,
      updatedAt TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0,
      pendingOp TEXT
    );

    -- content es JSON por plantilla (blob opaco para el sync, igual que project_pages.content).
    CREATE TABLE IF NOT EXISTS custom_pages (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      subtitle TEXT,
      template TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '{}',
      "order" REAL NOT NULL DEFAULT 0,
      updatedAt TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0,
      pendingOp TEXT
    );
  `);

  // `categoryId` en `events` (categorías de evento gestionables por el usuario — ver
  // EventCategory en types.ts, sustituye a la lista fija que antes vivía en `type`) se añadió
  // DESPUÉS de que esta app ya estuviera instalada en dispositivos reales, a diferencia del
  // salto de v1 a v2 de schema (ver el comentario en db/index.ts): ahí no había instalaciones que
  // migrar y bastó con cambiar de nombre de fichero; aquí sí las hay, así que en vez de eso se
  // añade la columna en caliente. `CREATE TABLE IF NOT EXISTS` de arriba ya la incluye para una
  // base de datos nueva, así que esto es un no-op ahí (columna duplicada) — de ahí el try/catch:
  // SQLite no tiene `ADD COLUMN IF NOT EXISTS`.
  try {
    await db.execAsync(`ALTER TABLE events ADD COLUMN categoryId INTEGER;`);
  } catch {
    // Ya existía (o la tabla se acaba de crear con la columna incluida) — nada que hacer.
  }

  // Mismo criterio que categoryId arriba: columnas añadidas después de instalaciones reales
  // (compartir eventos entre usuarios, ver EventInvitation) — un ALTER TABLE por columna porque
  // SQLite no admite añadir varias en una sola sentencia.
  for (const column of ["sharingRole TEXT", "sharingOwnerName TEXT", "sharingOwnerUsername TEXT", "sharingInvitationId INTEGER"]) {
    try {
      await db.execAsync(`ALTER TABLE events ADD COLUMN ${column};`);
    } catch {
      // Ya existía — nada que hacer.
    }
  }
}
