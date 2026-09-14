# Referencia de la API

Documentación interactiva (Swagger/OpenAPI) disponible en `/api-docs` con el servidor corriendo. Esto es la referencia estática, para leer sin levantar nada.

Todas las rutas salvo `/auth/register`, `/auth/login`, `/auth/refresh` y `/auth/verify-email` requieren `Authorization: Bearer <token>`. Todas devuelven 401 sin token válido, y los endpoints de edición/borrado devuelven 403 si el recurso no pertenece al usuario autenticado.

## Paginación

Todos los listados (`/goals`, `/projects`, `/agenda/day`, `/agenda/week`, `/finance/transactions`, `/notifications`) aceptan `?page=` (default 1) y `?limit=` (default 20, excepto agenda que usa 50 — el tamaño natural de "eventos en un día/semana"). La respuesta siempre incluye:

```json
{ "pagination": { "page": 1, "limit": 20, "total": 42, "pages": 3 } }
```

## Auth

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/auth/register` | - | Registro. Body: `username` (3-30, minúsculas/números/`_`/`.`), `email`, `password` (min 8), `name`, `timezone?` (zona IANA, default `Europe/Madrid`). Manda un email de verificación (409 si el email o el username ya existen) |
| POST | `/auth/login` | - | Login. Body: `identifier` (username **o** email, indistintamente), `password`. No exige el email verificado — retorna `token` + `refreshToken` igualmente |
| POST | `/auth/refresh` | - | Nuevo `token`+`refreshToken` a partir de un `refreshToken` válido |
| POST | `/auth/verify-email` | - | Body: `token` (el de la URL del email). Marca el email como verificado; 400 si el token no existe o caducó (24h) |
| POST | `/auth/resend-verification` | JWT | Manda un email de verificación nuevo; no-op silencioso si ya estaba verificado |
| GET | `/auth/me` | JWT | Perfil: `{ id, email, username, name, lastName, timezone, emailVerified, nextUsernameChangeAllowedAt, enabledSections, onboardingCompleted }` |
| PUT | `/auth/me` | JWT | Actualiza `name`, `lastName` (`null` para vaciarlo), `username` (409 si ya lo usa otra cuenta, **429** si ya se cambió hace menos de 15 días), `email` (409 si ya lo usa otra cuenta; sin cooldown propio, pero resetea `emailVerified` a `false` y manda un email de verificación nuevo) y/o `timezone` |
| PUT | `/auth/me/password` | JWT | Cambia la contraseña. Body: `currentPassword`, `newPassword` (min 8) |
| PUT | `/auth/me/onboarding` | JWT | Guarda los apartados elegidos en el asistente de bienvenida y pone `onboardingCompleted=true`. Body: `enabledSections` (array, puede ir vacío o repetir todos los valores de `planificador`\|`horario`\|`objetivos`\|`galeria`\|`finanzas`\|`metasAhorro`\|`proyectos`, sin duplicados) — `onboardingCompleted` empieza en `false` solo para cuentas nuevas (`POST /auth/register`); las ya existentes lo tienen en `true` |

`nextUsernameChangeAllowedAt` (`User.usernameChangedAt` + 15 días) viene en `null` si el usuario nunca cambió el username o si el cooldown ya pasó — el frontend lo usa para deshabilitar el campo y mostrar cuándo podrá volver a cambiarlo, sin tener que duplicar los "15 días" en el cliente. El cooldown solo aplica al `username`, no al `email` (que en cambio exige reverificación cada vez que cambia). Ni cambiar el username ni el email invalidan los tokens ya emitidos (el JWT solo se valida por `userId`).

El "envío" de emails de verificación (`src/utils/mailer.ts`) es solo un `logger.info` con el enlace por ahora — no hay proveedor SMTP configurado. Cuando se conecte uno de verdad, es la única función que hace falta cambiar.

## Agenda

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/agenda/day/:date` | JWT | Eventos del día (`YYYY-MM-DD`), en la timezone del usuario. `?type=`, `?page=`, `?limit=` |
| GET | `/agenda/week/:date` | JWT | Eventos de la semana que contiene esa fecha (lunes-domingo). Mismos filtros |
| GET | `/agenda/month/:date` | JWT | Eventos del mes que contiene esa fecha. Mismos filtros (`?limit=` por defecto 200) |
| GET | `/agenda/year/:date` | JWT | Recuento de eventos por día (`{ year, timezone, counts: {"YYYY-MM-DD": n} }`) del año que contiene esa fecha, incluidas ocurrencias recurrentes expandidas — para la vista anual (12 mini-meses), sin el detalle completo de cada evento |
| GET | `/agenda/free-time/:date` | JWT | Huecos libres del día (08:00–22:00 local) + sugerencias de tareas del Planificador que encajan (ver más abajo) |
| POST | `/agenda/events` | JWT | Crea evento. `isRecurring`+`recurringPattern` (`daily`\|`weekly`\|`biweekly`\|`monthly`) para series recurrentes. `reminderMinutesBefore` (minutos, default `[30]`) y `guests` (nombres/emails, default `[]`) opcionales |
| PUT | `/agenda/events/:id` | JWT | Edita — afecta a **toda la serie** si es recurrente |
| DELETE | `/agenda/events/:id` | JWT | Elimina — **toda la serie** si es recurrente |
| POST | `/agenda/events/:id/exceptions` | JWT | Mueve (`action: "moved"` + `newStartTime`/`newEndTime`) o cancela (`action: "cancelled"`) **una sola ocurrencia** de un evento recurrente, sin tocar el resto de la serie. `originalStartTime` identifica la ocurrencia (400 si el evento no es recurrente) |
| DELETE | `/agenda/events/:id/exceptions/:originalStartTime` | JWT | Revierte la excepción: la ocurrencia vuelve a su horario natural |
| GET | `/agenda/ics` | JWT | Exporta todos los eventos como `.ics` (`Content-Type: text/calendar`) — para Google Calendar/Outlook |
| POST | `/agenda/ics/import` | JWT | Importa eventos desde un `.ics` (`{ ics: "<texto>" }` en el body). Devuelve `{ created, skippedUnparsable, importedAsSingleOccurrence }` |

Los eventos recurrentes se expanden al vuelo: la respuesta mezcla eventos reales y ocurrencias virtuales (`isRecurringInstance: true`), todas con el mismo `id` de la plantilla. Una ocurrencia con excepción aplicada añade `originalStartTime`, `isException: true` y (si se movió) `exceptionStatus: "moved"`. Ver [ARCHITECTURE.md](ARCHITECTURE.md#eventos-recurrentes-expansión-virtual).

Los recordatorios de evento (`Notification` tipo `event_reminder`) usan `reminderMinutesBefore` de cada evento — un evento puede tener varias antelaciones configuradas (p.ej. `[15, 1440]`) y genera un aviso independiente por cada una.

`GET /agenda/free-time/:date` devuelve `{ freeBlocks: [{start, end, durationMinutes}], suggestions: [{block, task}] }`: los huecos ≥15 min entre eventos dentro de 08:00–22:00, y para cada uno (en orden cronológico) la tarea pendiente del Planificador de mayor prioridad con `estimatedMinutes` que quepa y no se haya sugerido ya en otro hueco.

El `.ics` exportado incluye RRULE (recurrencia), EXDATE (ocurrencias canceladas) y un VEVENT con RECURRENCE-ID por cada ocurrencia movida — ver `utils/ics.ts`. El import es best-effort: mapea `FREQ=DAILY`/`WEEKLY`/`WEEKLY;INTERVAL=2`/`MONTHLY` a `daily`/`weekly`/`biweekly`/`monthly` (otra recurrencia se importa como evento único) y no reconstruye excepciones (`RECURRENCE-ID` se ignora).

## Integraciones — Google Calendar

Solo importación (de lectura): trae los eventos del calendario `primary` de Google a `Event` (con `source: "google"`), nunca escribe en Google. Requiere `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI` configurados en el servidor (ver `.env.example`) — sin ellos, responde 400 "no configurada".

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/integrations/google/status` | JWT | `{ connected, email?, lastSyncedAt? }` |
| GET | `/integrations/google/connect` | JWT | `{ url }` — URL de consentimiento de Google a la que redirigir el **navegador completo** (no un fetch) |
| GET | `/integrations/google/callback` | Público | La abre el propio Google redirigiendo el navegador tras el consentimiento — nunca se llama a mano. Redirige de vuelta al dashboard con `?google=connected` o `?google=error` |
| POST | `/integrations/google/sync` | JWT | Sincroniza ahora. Devuelve `{ imported, updated, removed }` |
| DELETE | `/integrations/google/disconnect` | JWT | Revoca el token, borra la conexión y todos los eventos que se habían importado de ella |

La ventana sincronizada es de 30 días atrás a 180 días adelante desde "ahora". Además de la sincronización manual, un cron interno (`googleCalendarSyncScheduler`) sincroniza a todos los usuarios conectados cada 30 min. Las series recurrentes de Google llegan expandidas en ocurrencias sueltas (`singleEvents: true` en la API de Google) en vez de replicarse como `Event.isRecurring` — cada ocurrencia es su propio `Event` con `googleEventId`. Editar un evento `source: "google"` desde Tidely no se refleja en Google, y la siguiente sincronización lo sobrescribe con la versión de Google.

## Horario (Schedule)

Horario semanal fijo de texto libre (p.ej. de universidad) — Agenda > Horario, junto a Planificador. A diferencia de los eventos de Agenda, no tiene fechas: es la misma plantilla lunes-viernes semana tras semana, y cada celda es texto libre que el usuario rellena a mano (sin concepto de "asignatura" estructurado).

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/schedule` | JWT | `{ rows: [...] }`, ordenadas por `order` |
| POST | `/schedule` | JWT | Añade una fila (franja horaria) al final. Body: `timeLabel?` (texto libre, ej. `"08:00 - 10:00"`) |
| PUT | `/schedule/:id` | JWT | Edita `timeLabel` y/o cualquiera de `monday`/`tuesday`/`wednesday`/`thursday`/`friday` (texto libre, máx. 200 car. cada una) |
| DELETE | `/schedule/:id` | JWT | Elimina una fila |
| PUT | `/schedule/:id/move` | JWT | `{ direction: "up" \| "down" }` — intercambia el orden con la fila vecina (no-op si ya está en el extremo) |

## Hoy (Today)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/today` | JWT | Vista "Hoy" combinada — eventos de hoy, tareas con `dueDate` hoy, hábitos, notas, últimas entradas de libreta tocadas (última semana) y la racha combinada |

Un único viaje al backend en vez de entrar a Agenda + Planificador + Proyectos por separado (ver `todayService.ts`). Respuesta: `{ date, timezone, events, tasksDueToday, habits, notes, recentProjectEntries, combinedStreak }`.

`recentProjectEntries` son páginas de libreta (`ProjectPage`) editadas o creadas en los últimos 7 días, como mucho 5, con `{ id, projectId, projectTitle, pageTitle, preview (texto plano, 160 car.), updatedAt }` — vacío ([]) si no se ha tocado ninguna libreta recientemente (ver `projectsService.listRecentEntries`).

`combinedStreak` (ver `streakService.ts`): días consecutivos, empezando hoy hacia atrás, en los que se marcaron todos los hábitos activos Y se completaron todas las tareas con vencimiento ese día. Un día sin hábitos ni tareas vencidas ese día se salta (ni cuenta ni rompe la racha).

## Búsqueda (Search)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/search?q=` | JWT | Busca por texto en eventos, tareas, notas y proyectos del usuario (insensible a mayúsculas, `contains`). Máx. 8 resultados por categoría |

Respuesta: `{ query, events, tasks, notes, projects }`, cada uno un array de resultados resumidos (id + campos mínimos para mostrar y navegar).

## Sincronización (Sync)

Para la app móvil offline (SQLite local + estas rutas de sincronización). Postgres sigue
siendo la única fuente de verdad — el móvil replica un subconjunto y reconcilia al recuperar
conexión.

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/sync/pull?since=` | JWT | Todo lo creado/editado (y los borrados como tombstones) desde el cursor `since`. Sin `since`, bootstrap completo |
| POST | `/sync/push` | JWT | Sube un lote de cambios hechos offline: creaciones, ediciones y borrados |

**Alcance (Fase 1)**: `Event` + `EventException`, `Task` + `Subtask`, `Note`, `Habit` +
`HabitLog`. **No sincronizan** (solo web, por ahora): Metas (`Goal`/`GoalProgress`), Finanzas
(`Transaction`/`SavingsGoal`), Proyectos (`Project`/`ProjectTask`/`ProjectPage`), Páginas
personalizadas (`CustomPage`, incluida la plantilla "galeria"), Notificaciones.

**Pull** — respuesta `{ serverTime, events, eventExceptions, tasks, subtasks, notes, habits, habitLogs, tombstones }`.
`serverTime` es el instante en que se hizo la consulta (no el `updatedAt` máximo de las filas
devueltas) — el cliente debe guardarlo y enviarlo como `since` en el siguiente pull. Cada
tombstone es `{ id, entityType, entityId, deletedAt }` — el cliente borra localmente esa fila.

**Push** — body por tipo (`events`, `tasks`, `subtasks`, `notes`, `habits`): `{ create: [...],
update: [...] }`; `eventExceptions: { upsert: [...] }`; `habitLogs: { create: [...] }` (sin
`update` — un registro de hábito solo se crea o se borra, nunca se edita); y un array común
`deletes: [{ entityType, id, ... }]`.

- Cada elemento de `create` lleva un `localId` (UUID generado por el cliente); la respuesta
  incluye `idMappings: [{ entityType, localId, id }]` para que el móvil sustituya su id local
  por el real.
- Cada elemento de `update` lleva `id` (real, del servidor) y `clientUpdatedAt` (cuándo se
  editó en el dispositivo) — resolución de conflictos **last-write-wins**: si
  `clientUpdatedAt` es más reciente que el `updatedAt` actual del servidor, se aplica; si no,
  se descarta y se reporta en `conflicts: [{ entityType, id }]` (el cliente lo sobrescribe con
  la versión del servidor en el siguiente pull). Adecuado porque estos datos son de un único
  usuario sincronizando entre sus propios dispositivos, no colaborativos entre personas.
- Un `delete` sobre algo ya borrado (sincronizado desde otro dispositivo) es idempotente —
  éxito, no error.

## Metas (Goals)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/goals` | JWT | `?status=active\|completed\|expired\|all` (default `active` = ni completada ni expirada), `?page=`, `?limit=` |
| GET | `/goals/:id` | JWT | Detalle + histórico de `GoalProgress` |
| POST | `/goals` | JWT | Crea meta. `periodEnd` se calcula solo si no se indica. `autoRenew` (default `true`): al vencer, crea sola la del siguiente periodo |
| PUT | `/goals/:id` | JWT | Edita (no se puede cambiar `period`) |
| DELETE | `/goals/:id` | JWT | Elimina |
| POST | `/goals/:id/progress` | JWT | Registra progreso (`value` entero, puede ser negativo para correcciones). Devuelve `justCompleted`+`bonusPointsAwarded` |
| GET | `/goals/:id/analytics` | JWT | `percentComplete`, `streakDays`, `daysRemaining`, `requiredPacePerDay`, `atRisk` |

Una meta que pasa su `periodEnd` sin completarse queda `expired=true` automáticamente (scheduler cada hora) y deja de contar como `active`; si `autoRenew`, se crea la del siguiente periodo con progreso en cero.

## Finanzas (Finance)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/finance/balance/:month/:year` | JWT | Balance del mes (`income`, `expense`, `balance`) |
| GET | `/finance/balance/year/:year` | JWT | Balance anual + `monthlyBreakdown` (12 meses) |
| GET | `/finance/transactions` | JWT | Filtros: `type`, `category`, `from`, `to`, `page`, `limit` |
| POST | `/finance/transactions` | JWT | Registra ingreso/gasto |
| PUT | `/finance/transactions/:id` | JWT | Edita |
| DELETE | `/finance/transactions/:id` | JWT | Elimina |
| GET | `/finance/savings-goals` | JWT | `currentAmount`/`progressPercent` calculados dinámicamente (no guardados) |
| POST | `/finance/savings-goals` | JWT | Crea meta de ahorro (`stepAmount`: € por "casilla" en el dashboard, default 100) |
| DELETE | `/finance/savings-goals/:id` | JWT | Elimina meta de ahorro |
| POST | `/finance/savings-goals/:id/contribute` | JWT | Asigna (`amount` > 0) o retira (`amount` < 0) dinero — crea una transacción real (`income`/`expense`) en la categoría de la meta. Es lo que dispara cada clic de casilla en el dashboard |
| GET | `/finance/analytics` | JWT | Top 5 categorías del mes, tendencia de 6 meses, proyección anual |

## Proyectos (Projects)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/projects` | JWT | `?status=`, `?priority=`, `?page=`, `?limit=` |
| GET | `/projects/recent-entries` | JWT | Últimas páginas de libreta tocadas (creadas o editadas) en la última semana, de cualquier proyecto — `{ entries: [{ id, projectId, projectTitle, pageTitle, preview, updatedAt }] }`, máx. 5. Usado en Hoy y en Agenda |
| GET | `/projects/:id` | JWT | Detalle + tareas + `{ total, completed, percent }` |
| POST | `/projects` | JWT | `status` default `idea`, `priority` default `medium` |
| PUT | `/projects/:id` | JWT | Edita |
| DELETE | `/projects/:id` | JWT | Elimina |
| GET | `/projects/:id/progress` | JWT | Solo el `{ total, completed, percent }` |
| POST | `/projects/:id/tasks` | JWT | Agrega tarea |
| PUT | `/projects/:id/tasks/:taskId` | JWT | Edita el título |
| PUT | `/projects/:id/tasks/:taskId/complete` | JWT | `{ completed: boolean }` — marca o desmarca |
| DELETE | `\projects:id/tasks/:taskId` | JWT | Elimina un apunte rápido |

## Planificador (Planner)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/planner/tasks` | JWT | Tablero kanban. `?projectId=`, `?tag=` |
| POST | `/planner/tasks` | JWT | `status` default `todo`, `priority` default `medium`. Admite `dueDate`, `tags`, `estimatedMinutes`, `projectId` |
| PUT | `/planner/tasks/:id` | JWT | Edita cualquier campo (título, estado, prioridad, orden, `dueDate`, `tags`, `estimatedMinutes`, `projectId`) |
| DELETE | `/planner/tasks/:id` | JWT | Elimina (cascada sobre sus subtareas) |
| POST | `/planner/tasks/:id/time` | JWT | `{ minutes }` — suma al tiempo real acumulado (`actualMinutes`) |
| POST | `/planner/tasks/:id/subtasks` | JWT | Añade un paso al checklist de la tarea |
| PUT | `/planner/tasks/:id/subtasks/:subtaskId` | JWT | Edita título o `completed` de una subtarea |
| DELETE | `/planner/tasks/:id/subtasks/:subtaskId` | JWT | Elimina una subtarea |

`projectId` es opcional: vincula la tarea a un `Project` existente del mismo usuario (404/403 si no lo es). El recordatorio de `dueDate` lo genera el scheduler de notificaciones, no un endpoint (ver más abajo).

## Notificaciones (Notifications)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/notifications` | JWT | `?unreadOnly=true`, `?page=`, `?limit=` |
| GET | `/notifications/unread-count` | JWT | `{ unreadCount }` |
| PUT | `/notifications/:id/read` | JWT | Marca una como leída |
| PUT | `/notifications/read-all` | JWT | Marca todas como leídas |
| DELETE | `/notifications/:id` | JWT | Elimina |

Las crean solo los schedulers (`event_reminder`, `goal_at_risk`, `task_due`), nunca el usuario directamente — no hay `POST /notifications`.

## Otras rutas

| Ruta | Descripción |
|---|---|
| `GET /health` | Healthcheck simple (`{ status: "OK" }`) |
| `GET /api-docs` | Swagger UI |
