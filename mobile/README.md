# Tidely — Móvil (Fase 4: Agenda + Planificador offline; Horario, Objetivos, Finanzas y Ahorro online)

App Expo/React Native que replica localmente en SQLite el subconjunto de datos de uso diario
más valioso — eventos, tareas/subtareas, hábitos y notas — y sincroniza con el backend (Postgres,
sigue siendo la fuente de verdad) vía `GET /sync/pull` y `POST /sync/push` en cuanto hay conexión.
Ver la sección [Sincronización (Sync)](../API.md#sincronización-sync) de `API.md` para el contrato
completo, y `src/sync/` para cómo lo consume esta app.

## Alcance de esta fase

Siete pestañas planas tras iniciar sesión (`App.tsx`, `@react-navigation/bottom-tabs`) — ver más
abajo por qué planas y no anidadas como en el menú de escritorio de la web:

- **Hoy**: eventos de hoy (ya expandiendo recurrentes, ver más abajo), tareas con vencimiento hoy
  (toggle hecha/pendiente), hábitos (toggle marcado hoy) y notas rápidas (crear/marcar/borrar).
- **Agenda** (`src/screens/AgendaScreen.tsx`): franja semanal + lista cronológica del día
  seleccionado. CRUD completo de eventos (título, descripción, tipo, horario, ubicación,
  recurrencia, avisos, invitados) — crear/editar/borrar funcionan sin conexión.
- **Planificador** (`src/screens/PlanificadorScreen.tsx`): con paridad completa con la web —
  el usuario puede tener varios tableros con nombre propio (`src/api/planner.ts`, contra
  `/planner/boards`; los tableros en sí no pasan por SQLite, igual que Horario), cada uno con sus
  3 secciones fijas (Por hacer / En progreso / Hecho). Los dos modos de vista de tableros
  ("Flechas" — uno a la vez — y "Apilado" — todos uno debajo de otro, cada uno como un Kanban
  simple), persistido con `expo-secure-store` igual que el resto de preferencias del móvil. CRUD
  completo de tareas (título, descripción, prioridad, fecha límite, tags, estado) y subtareas —
  las tareas sí pasan por SQLite (offline-first) y ya llevan su `plannerId`. Cambiar de sección es
  un botón, no arrastrar — más natural en pantalla de teléfono; el `order` fraccionario se calcula
  igual que `moveTask` en `dashboard/src/pages/PlanificadorPage.tsx`, así que no rompe el orden con
  lo creado desde la web. Mover una tarea a OTRO tablero no existe todavía, ni aquí ni en la web
  (el campo es inmutable tras crear la tarea).
- **Horario** (`src/screens/HorarioScreen.tsx`): puerto directo de
  `dashboard/src/pages/SchedulePage.tsx` — varios horarios con nombre propio (uno por trimestre,
  p.ej.), cada uno una tabla lunes-viernes de celdas de texto libre (sin fechas ni recurrencia,
  a diferencia de Agenda). CRUD completo de horarios (crear/renombrar/reordenar/borrar) y de sus
  franjas (añadir/editar celda/reordenar/borrar).
- **Objetivos** (`src/screens/ObjetivosScreen.tsx`): puerto directo de
  `dashboard/src/pages/MetasPage.tsx` — objetivos semanales/mensuales con progreso acumulable y
  bonificación por completar. Pestañas Activos/Completados/Vencidos/Todos, panel de progreso con
  el mismo cálculo de "ritmo" (verde/ámbar) que la web, crear objetivo, registrar progreso, borrar.
- **Finanzas** (`src/screens/FinanzasScreen.tsx`): puerto de `dashboard/src/pages/FinanzasPage.tsx`
  — tarjetas de resumen del mes (Ingresos/Gastos/Balance/Ahorro/Inversión), gráfico de barras de
  tendencia de los últimos 6 meses, panel sólido "Resumen del mes", panel sólido "Top categorías
  de gasto", proyección anual, y movimientos recientes (crear/borrar), con los mismos estilos de
  tarjeta que la web (card-soft, paneles sólidos bg-primary/bg-secondary). Sin exportar a CSV
  (descargar/compartir ficheros añade permisos y UI que no compensan aquí).
- **Ahorro** (`src/screens/MetasAhorroScreen.tsx`): puerto de
  `dashboard/src/pages/MetasAhorroPage.tsx` + `dashboard/src/components/SavingsGoals.tsx` — mismo
  "grid de casillas" (cada casilla = una porción de `stepAmount`; tocarla aporta o retira dinero de
  verdad, creando una Transaction real en esa categoría — el progreso nunca se guarda, se
  recalcula siempre desde el balance de esas Transactions). Pestañas Todas/Ahorro/Inversión, panel
  de progreso, crear meta (la categoría interna se auto-genera con un slug del nombre, igual que
  en la web — el usuario nunca la ve ni la escribe), borrar.

**Horario, Objetivos, Finanzas y Ahorro NO pasan por SQLite** — a diferencia de las tres pestañas
anteriores, `Schedule`/`ScheduleRow`, `Goal`/`GoalProgress` y `Transaction`/`SavingsGoal` no forman
parte del contrato de sync offline del backend (`API.md` los lista explícitamente entre lo que "no
sincroniza, solo web, por ahora" — ni siquiera se contempló en el diseño de
`/sync/pull`/`/sync/push`, ver `src/services/syncService.ts` en el backend). En vez de inventar
sync para módulos que la propia web tampoco cachea, estas cuatro pantallas pegan directo contra la
API (`src/api/schedule.ts`, `src/api/goals.ts`, `src/api/finance.ts`, mismo `src/api/client.ts` ya
usado por login) — necesitan conexión, igual que la web. Si en el futuro se decide llevar alguna
offline, el patrón a seguir es el mismo que ya generalizó Agenda/Planificador (id local +
`synced`/`pendingOp`, ver Fase 2 más abajo), pero requeriría extender también el contrato de sync
del backend, no solo el móvil.

**Por qué pestañas planas y no anidadas**: el propio menú de escritorio de la web anida
Planificador+Horario bajo Agenda y Metas de ahorro bajo Finanzas (`NAV` en
`dashboard/src/components/AppShell.tsx`), pero la propia web los aplana en una lista para su menú
móvil (`FLAT_NAV`, con el comentario "donde anidar no tiene mucho sitio") — aquí se sigue el mismo
criterio en vez de inventar uno nuevo. Con 7 pestañas la barra ya queda ajustada (el texto de
"Planificador" se trunca); si se añaden más (Proyectos, Hobbies) probablemente convenga cambiar a
una barra de pestañas con scroll horizontal en vez de seguir apretando iconos.

La pantalla de login incluye también el registro (mismo toggle que
`dashboard/src/pages/LoginPage.tsx`).

**Explícitamente fuera de alcance** (quedan solo en web por ahora):
notificaciones locales programadas para los avisos de evento (`expo-notifications` — los minutos
se guardan/sincronizan como dato, pero no se programa ninguna notificación nativa); excepciones
por-ocurrencia de un evento recurrente (mover/cancelar solo una vez — se leen y se aplican al
expandir, pero no se crean desde el móvil); import/export ICS; integración Google Calendar; panel
de tiempo libre; vistas mes/año de Agenda; campos personalizados del Planificador (`PlannerField`
— el selector de tableros en sí ya está, ver arriba); mover una tarea a otro tablero (el campo es
inmutable tras crearla, ni aquí ni en la web); imagen y seguimiento de tiempo (`estimatedMinutes`/
`actualMinutes`) de una tarea; vincular una tarea a un proyecto; reordenar tareas por arrastre
dentro de una columna (se puede añadir después con `react-native-draggable-flatlist` sin tocar el
backend); exportación CSV de Finanzas; edición de un movimiento ya creado (la web tampoco lo
expone, solo crear/borrar). Proyectos y Hobbies siguen sin pantalla propia.

Horario ya tiene paridad completa con la web: los dos modos de vista ("Flechas" y "Apilado",
persistido con `expo-secure-store` igual que el resto de preferencias del móvil — ver
`HorarioScreen.tsx`) y el calendario anual con leyenda (`components/AnnualCalendarLegend.tsx`).
Simplificaciones deliberadas frente a la web: pintar un día es un toque (toggle), no arrastrar
—no hay `mousemove` continuo en táctil—, y los borrados (horario/franja/categoría) son de un solo
toque, sin el "¿Confirmar?" de doble clic que depende de un hover que tampoco existe aquí.

## Cómo funciona el offline

- **Todas las escrituras del usuario van primero a SQLite local** (`src/db/`), nunca directas a
  la red — la UI se actualiza al instante, esté o no haya conexión.
- **`src/sync/index.ts` → `runSync()`** sube los cambios pendientes (`push`) y luego baja lo
  nuevo del servidor (`pull`), en ese orden — así el pull de cada ronda ya refleja los cambios
  que el propio push acaba de confirmar. Se dispara al abrir la app y al entrar en cada pestaña,
  al recuperar conexión (`@react-native-community/netinfo`), y cada 60s en primer plano mientras
  la pestaña "Hoy" está montada (React Navigation no desmonta las pestañas inactivas, así que su
  intervalo sigue corriendo aunque estés en Agenda o Planificador).
- **Conflictos**: last-write-wins, resuelto por el servidor (ver `API.md`) — si una edición local
  se descarta por ser más antigua que la del servidor, el siguiente pull trae la versión
  autoritativa sin que el móvil tenga que hacer nada especial.
- **`events`, `tasks` y `subtasks` pueden crearse offline** con el mismo patrón que `notes` ya
  usaba en Fase 1: `id` es un uuid (`expo-crypto`) mientras la fila no existe en el servidor,
  sustituido por el id de servidor (como texto) en cuanto se sincroniza; `synced`/`pendingOp`
  llevan la cuenta de qué falta subir. Ver los comentarios en `src/db/eventsRepo.ts`,
  `src/db/tasksRepo.ts`, `src/db/subtasksRepo.ts` y `src/types.ts`.
- **Una subtarea de una tarea creada offline no puede subirse hasta que esa tarea ya tenga id de
  servidor** (el backend exige un `taskId` numérico) — se queda pendiente y se reasigna sola
  (`subtasksRepo.reparentSubtasks`) en cuanto la tarea padre sincroniza; en la práctica tarda como
  mucho un ciclo de sync (≤60s con conexión).
- **Recurrencia**: `src/utils/recurrence.ts` es un puerto directo de la lógica de expansión del
  backend (`src/utils/recurrence.ts` ahí) — el pull solo trae la fila "plantilla" de un evento
  recurrente (nunca ocurrencias ya expandidas, igual que hace el propio backend al sincronizar),
  así que expandirlas para la semana visible es responsabilidad del cliente. Simplificación
  deliberada: usa fronteras de día en UTC (mismo criterio que `todayKey()`), no el timezone real
  del usuario como sí hace el backend para sus vistas `/agenda/*`.

## Estilo

Mismos tokens de diseño que el dashboard web — `dashboard/src/styles.css` (bloque `:root`, en
OKLCH) portado a hex/rgba en `src/theme.ts`: fondo "paper" `#F7F4F1`, tarjetas blancas, texto
`#2D2926`, acento sage `#5F7161`, más los tonos por tipo de evento/prioridad (`warning`, `hobby`,
`habit`, `cover`) que la web usa para las badges. Tipografía también igual: **Outfit** (texto/UI,
vía `@expo-google-fonts/outfit`) e **Instrument Serif** (títulos, vía
`@expo-google-fonts/instrument-serif`), cargadas en `App.tsx` con `expo-font` + `expo-splash-screen`
(la splash nativa se mantiene visible hasta que las fuentes terminan de cargar). Radios/sombra
también calcados de `.card-soft`/`btn-primary` de la web — ver comentarios en `src/theme.ts` para
el porqué de cada valor. La web no tiene modo oscuro, así que tampoco se ha previsto uno aquí.

## Setup

```bash
cd mobile
npm install
```

Configura la URL del backend en un `.env` (no versionado) — Expo incrusta automáticamente
cualquier variable con el prefijo `EXPO_PUBLIC_`:

```bash
# .env
EXPO_PUBLIC_API_URL=http://localhost:3000       # iOS Simulator
# EXPO_PUBLIC_API_URL=http://10.0.2.2:3000      # Emulador Android
# EXPO_PUBLIC_API_URL=http://192.168.1.X:3000   # Dispositivo físico — IP de tu máquina en la LAN
```

```bash
npx expo start
```

Escanea el QR con Expo Go, o pulsa `a`/`i` para abrir en un emulador Android/iOS ya configurado.
Inicia sesión con una cuenta ya creada en el dashboard web (o la demo: `demo@lifeorganizer.dev` /
`Password123`, si corriste `npm run prisma:seed` en el backend).

> Si ya tenías la Fase 1 instalada: el esquema de SQLite cambió (`events`/`tasks` pasan a usar un
> id de texto para poder crearse offline) y la app abre un fichero de base de datos nuevo
> (`life-organizer-v2.db`) — no hace falta ninguna migración manual, simplemente empieza con una
> caché local vacía que el primer `runSync()` rellena de nuevo.

## Verificado desde este entorno / lo que falta probar en un dispositivo real

Verificado en un emulador Android real (API 37, `google_apis/x86_64`) contra el backend local:
login, las tres pestañas, y el ciclo completo crear→editar→borrar tanto en Agenda (evento
recurrente y suelto, con confirmación directa contra `GET /agenda/day/:date`) como en Planificador
(tarea + subtarea, cambio de estado y prioridad, con confirmación contra `GET /planner/tasks`) —
todo confirmado sincronizado en Postgres, no solo en el estado local optimista. También se
verificó lo que no requiere nativo: `npx tsc --noEmit` sin errores, y que Metro compila el bundle
completo para plataforma nativa sin fallos de resolución de módulos ni de sintaxis.

**Dos bugs de Fase 1 encontrados y arreglados en esta primera prueba real** (ninguno introducido
por Agenda/Planificador — ambos ya rompían la app antes de que existieran, solo que Fase 1 nunca
se había probado en un dispositivo/emulador real):
- Las claves de `expo-secure-store` en `src/auth/storage.ts` usaban `:` (p.ej.
  `"life-organizer:token"`), un carácter que `SecureStore` no admite — la app se quedaba colgada
  en el spinner de carga para siempre, sin ningún error visible (la promesa rechazada de
  `loadStoredAuth()` no tenía `.catch()`). Cambiadas a `.` (`"life-organizer.token"`).
- `HoyScreen` dispara `sync()` tanto al montar como en cuanto `useNetInfo` resuelve la conectividad
  por primera vez — casi simultáneos, lo que abría dos `runSync()` en paralelo sobre la misma
  conexión SQLite y expo-sqlite respondía "cannot rollback - no transaction is active". Arreglado
  con un guard de reentrancia en `src/sync/index.ts` (`runSync()` reutiliza la promesa en curso en
  vez de arrancar una segunda).

De paso, también se corrigieron dos avisos de deprecación que aparecían en cuanto se tocaba un
selector de fecha/hora o se montaba `HoyScreen` (el segundo llegaba a tapar la barra de pestañas
en el emulador): `SafeAreaView` ahora se importa de `react-native-safe-area-context` en las tres
pantallas (no de `"react-native"`), y `DateTimePicker` usa `onValueChange`/`onDismiss` en vez del
`onChange` deprecado.

**Lo que sigue sin probarse en dispositivo real**: el selector nativo de fecha/hora en un Android
real fuera de emulador (su UI difiere de iOS — abre un diálogo modal por cada `mode`, nunca
"inline"), la expansión de recurrencia con datos de varios años, y el reparto de subtareas al
sincronizar una tarea recién creada offline (`subtasksRepo.reparentSubtasks`) — probado por
código pero no con una tarea+subtarea creadas ambas sin conexión.

**Gotcha de Metro al añadir las fuentes** (`@expo-google-fonts/*`): con el bundler ya arrancado
antes de instalar estos paquetes, Metro fallaba resolviendo los `.ttf` de las fuentes
("Unable to resolve module .../Outfit_200ExtraLight.ttf") aunque el fichero existía en disco —
caché de resolución de módulos obsoleta. Se arregla reiniciando con `npx expo start -c` (limpia la
caché) después de instalar cualquier paquete nuevo con assets nativos (fuentes, imágenes) mientras
el dev server sigue corriendo.

**Nota sobre probar en Expo Go**: la propia app de Expo Go superpone una burbuja flotante (el
lanzador del menú de desarrollador) que se ancla a una esquina de la pantalla — en este proyecto
cae justo encima de los botones de cabecera ("Sincronizar", "+ Nuevo"...), así que un toque ahí a
veces abre el menú de Expo Go en vez del botón de la app. No es un bug de la app (no existe en un
build standalone/producción); si estorba al probar, se puede arrastrar a otra zona de la pantalla
(vuelve a anclarse a la esquina en cuanto se suelta) o simplemente evitar tocar justo esa esquina.

Verificado en el emulador para esta fase: login, las 7 pestañas navegando, y Horario/Objetivos/
Finanzas mostrando datos reales del backend (un horario de universidad con franjas ya rellenas,
tabla con scroll horizontal correcto; tarjetas de balance y gráfico de tendencia con la cuenta demo
vacía). El flujo completo de creación (crear horario/objetivo/movimiento desde el formulario) no
se pudo verificar de punta a punta en esta sesión por la burbuja de Expo Go interceptando el botón
"+ Nuevo" — el código sigue el mismo patrón ya probado en Agenda/Planificador (mismo componente
`Modal`, mismas llamadas a la API), pero queda pendiente de una comprobación manual en un
dispositivo real o con la burbuja movida.

**Ahorro sí se verificó de punta a punta**, botón "+ Nueva" incluido al no caer bajo la burbuja de
Expo Go en ese caso: se tocó una casilla de una meta real ("coche", 8.000 €) para aportar 100 €,
confirmado que creó una `Transaction` real en el servidor (`GET /finance/transactions`, categoría
`ahorro-coche`, descripción "Aporte a meta de ahorro: coche") y que el progreso (0%→1%) se
recalculó y repintó correctamente tanto en la tarjeta como en el panel de resumen; se deshizo
tocando la misma casilla otra vez (crea la `Transaction` de signo contrario) para dejar la cuenta
demo como estaba.
