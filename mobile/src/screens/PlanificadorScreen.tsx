import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  View,
  Pressable,
  ScrollView,
  StyleSheet,
  Modal,
  Platform,
  ActivityIndicator,
  KeyboardAvoidingView,
  Animated,
  PanResponder,
  GestureResponderEvent,
  PanResponderGestureState,
  LayoutChangeEvent,
  Image,
} from "react-native";
import { Text, TextInput } from "../components/AppText";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import * as SecureStore from "expo-secure-store";
import * as ImagePicker from "expo-image-picker";
import DateTimePicker, { DateTimePickerChangeEvent } from "@react-native-community/datetimepicker";
import { useFocusEffect } from "@react-navigation/native";
import { ApiError } from "../api/client";
import {createPlanner,createPlannerField,deletePlanner,deletePlannerField,listPlannerFields,listPlanners,listPlannerTasksLive,logTaskTime,movePlanner,movePlannerField,Planner,PlannerField,renamePlanner,renamePlannerField,updateTaskCustomFields,} from "../api/planner";
import { CustomFieldType, CustomFieldValue } from "../api/customPages";
import { runSync } from "../sync";
import { listTasksByPlanner, createTaskLocal, updateTaskLocal, moveTask, deleteTaskLocal, parseTaskTags, addActualMinutesLocal } from "../db/tasksRepo";
import { listForTask, createSubtaskLocal, toggleSubtask, deleteSubtaskLocal } from "../db/subtasksRepo";
import { LocalSubtask, LocalTask, TASK_PRIORITIES, TASK_PRIORITY_LABELS, TASK_STATUSES, TASK_STATUS_LABELS, TaskPriority, TaskStatus } from "../types";
import { colors, dueDateStyle, fonts, priorityStyle, radius, shadow, withAlpha } from "../theme";
import { useSidebar, SIDEBAR_CLIP_CLEARANCE } from "../navigation/SidebarContext";

// Puerto de dashboard/src/pages/PlanificadorPage.tsx: el usuario puede tener varios tableros de
// Planificador con nombre propio (uno por área de vida — "Trabajo", "Personal"...), cada uno con
// sus 3 columnas fijas (Por hacer/En progreso/Hecho) — mismo modelo `Planner` que ya usa la web
// (ver src/api/planner.ts) y mismo patrón "lista con nombre + Flechas/Apilado" que ya tenía
// HorarioScreen.tsx para "Horario" (persistencia con expo-secure-store incluida). A diferencia de
// los tableros en sí (que no pasan por SQLite, igual que Horario — necesitan conexión para crear/
// renombrar/borrar/reordenar), las TAREAS de cada tablero siguen siendo offline-first como hasta
// ahora (ver db/tasksRepo.ts: la tabla `tasks` ya traía una columna `plannerId`, hasta ahora sin
// usar porque solo existía un tablero implícito — el "planner por defecto" del fallback del
// backend, ver getOrCreateDefaultPlanner en plannerService.ts).
//
// En modo "Flechas" (un tablero a la vez) se ve exactamente la misma pantalla de siempre (Kanban/
// Lista + su propio Flechas/Apilado de columnas), solo que las tareas ahora están filtradas por
// `plannerId`. En modo "Apilado" (todos los tableros a la vez) cada uno se pinta como un Kanban
// simple y completo (las 3 columnas siempre visibles, sin el Flechas/Apilado de columnas ni el
// modo Lista — igual de simplificado que cada ScheduleTableCard de HorarioScreen.tsx en su propio
// Apilado), para que "ver un kanban debajo de otro" no arrastre además una segunda capa de
// paginación dentro de cada uno.

const VIEW_MODES = ["kanban", "tabla"] as const;
type ViewMode = (typeof VIEW_MODES)[number];

// Mismo límite que el resto de imágenes embebidas de la app — ver MAX_IMAGE_BYTES en
// PaginaDetailScreen.tsx.
const TASK_MAX_IMAGE_BYTES = 3 * 1024 * 1024;

// Vista de las COLUMNAS (Por hacer/En progreso/Hecho) dentro de UN tablero — a propósito con
// nombre distinto de `PlannerViewMode` de abajo (esa es la vista de TABLEROS): antes se llamaba
// `BoardViewMode`/`boardView`, un nombre que habría colisionado en significado con el nuevo
// selector de tableros.
const COLUMN_VIEWS = ["flechas", "apilado"] as const;
type ColumnViewMode = (typeof COLUMN_VIEWS)[number];

// Vista de TABLEROS (varios Planner) — mismo patrón/persistencia que VIEW_MODE_KEY en
// HorarioScreen.tsx.
const PLANNER_VIEW_MODE_KEY = "life-organizer.planificador-tableros-view-mode";
type PlannerViewMode = "flechas" | "apilado";

// Estilos de columnas por estado (igual que web)
const COLUMN_BG_COLORS: Record<TaskStatus, string> = {
  todo: colors.card,
  in_progress: withAlpha(colors.warning, 0.1),
  done: withAlpha(colors.positive, 0.1),
};

const COLUMN_BORDER_COLORS: Record<TaskStatus, string> = {
  todo: colors.border,
  in_progress: withAlpha(colors.warning, 0.3),
  done: withAlpha(colors.positive, 0.3),
};

const COLUMN_HEADERS: Record<TaskStatus, string> = {
  todo: "Por hacer",
  in_progress: "En progreso",
  done: "Hecho",
};

// Mismas etiquetas que FIELD_TYPE_LABELS en dashboard/src/pages/PlanificadorPage.tsx.
const FIELD_TYPE_LABELS: Record<CustomFieldType, string> = { text: "Texto", number: "Número", date: "Fecha", select: "Selección" };
const FIELD_TYPES: CustomFieldType[] = ["text", "number", "date", "select"];

function nextPriority(p: TaskPriority): TaskPriority {
  const idx = TASK_PRIORITIES.indexOf(p);
  return TASK_PRIORITIES[(idx + 1) % TASK_PRIORITIES.length];
}

function dueBadge(dueDate: string | null, done: boolean): { label: string; bg: string; text: string } | null {
  if (!dueDate) return null;
  const due = new Date(dueDate);
  const today = new Date();
  const dueDay = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const todayDay = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const daysDiff = Math.round((dueDay - todayDay) / 86_400_000);
  const label = daysDiff < 0 ? `Venció ${due.toLocaleDateString("es-ES")}` : daysDiff === 0 ? "Hoy" : due.toLocaleDateString("es-ES");
  return { label, ...dueDateStyle(daysDiff, done) };
}

interface TaskForm {
  id: string;
  title: string;
  description: string;
  image: string | null;
  notes: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate: Date | null;
  estimatedMinutesText: string;
  actualMinutes: number;
  tagsText: string;
}

function toForm(task: LocalTask): TaskForm {
  return {
    id: task.id,
    title: task.title,
    description: task.description ?? "",
    image: task.image,
    notes: task.notes ?? "",
    priority: task.priority,
    status: task.status,
    dueDate: task.dueDate ? new Date(task.dueDate) : null,
    estimatedMinutesText: task.estimatedMinutes != null ? String(task.estimatedMinutes) : "",
    actualMinutes: task.actualMinutes,
    tagsText: parseTaskTags(task).join(", "),
  };
}

export function PlanificadorScreen() {
  const { collapsed } = useSidebar();
  const insets = useSafeAreaInsets();

  // TABLEROS
  const [planners, setPlanners] = useState<Planner[]>([]);
  const [plannerIndex, setPlannerIndex] = useState(0);
  const [plannerViewMode, setPlannerViewModeState] = useState<PlannerViewMode>("flechas");
  const [loadingPlanners, setLoadingPlanners] = useState(false);
  const [plannerError, setPlannerError] = useState<string | null>(null);
  const [showCreatePlanner, setShowCreatePlanner] = useState(false);
  const [newPlannerName, setNewPlannerName] = useState("");
  const [renamingPlanner, setRenamingPlanner] = useState(false);
  const [plannerNameDraft, setPlannerNameDraft] = useState("");
  const [pendingFocusPlannerId, setPendingFocusPlannerId] = useState<number | null>(null);
  // Se incrementa tras cualquier cambio que pueda afectar a una tarea de CUALQUIER tablero (el
  // modal de edición no sabe de qué tablero es la tarea que edita, y en modo Apilado hay varios
  // PlannerBoardCard montados a la vez) — cada uno reacciona a este número para recargar sus
  // propias tareas sin que el padre necesite saber a cuál pertenecen.
  const [refreshToken, setRefreshToken] = useState(0);

  const active = planners[plannerIndex] ?? null;

  // TAREAS del tablero activo (vista Flechas)
  const [tasks, setTasks] = useState<LocalTask[]>([]);
  const [drafts, setDrafts] = useState<Record<TaskStatus, string>>({ todo: "", in_progress: "", done: "" });
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [form, setForm] = useState<TaskForm | null>(null);
  const [subtasks, setSubtasks] = useState<LocalSubtask[]>([]);
  const [subtaskDraft, setSubtaskDraft] = useState("");
  const [showDuePicker, setShowDuePicker] = useState(false);

  // PROPIEDADES PERSONALIZADAS de la tarea abierta — a diferencia de `form`/`subtasks` (que
  // siguen viviendo en SQLite), esto SOLO existe en el servidor (ver comentario sobre
  // ServerTask/LocalTask en ../types.ts): se piden en paralelo al abrir la tarea, sin bloquear el
  // resto del modal, y si falla (sin conexión) simplemente no se muestran editables — ver
  // loadCustomFields más abajo. `plannerOfOpenTask` es el tablero al que pertenece la tarea
  // abierta (necesario para crear una propiedad nueva o listar las del tablero), independiente de
  // `active`/`plannerIndex` porque en modo Apilado la tarea abierta puede ser de cualquier tablero.
  const [plannerOfOpenTask, setPlannerOfOpenTask] = useState<number | null>(null);
  const [customFields, setCustomFields] = useState<PlannerField[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, CustomFieldValue>>({});
  const [customFieldsUnavailable, setCustomFieldsUnavailable] = useState(false);
  // Borrador de texto/número mientras se escribe — solo se manda al servidor al perder el foco
  // (ver commitCustomFieldDraft), igual criterio que título/descripción de la propia tarea: no
  // machacar la API en cada pulsación.
  const [customFieldDrafts, setCustomFieldDrafts] = useState<Record<string, string>>({});
  const [editingCustomDateFieldId, setEditingCustomDateFieldId] = useState<number | null>(null);
  // Renombrado inline del NOMBRE de una propiedad (no de su valor) — mismo patrón un-solo-a-la-vez
  // que renaming/nameDraft en PlannerBoardCard, pero como estado plano aquí porque las propiedades
  // se renderizan directo en este componente, no en uno propio por fila.
  const [renamingFieldId, setRenamingFieldId] = useState<number | null>(null);
  const [fieldNameDraft, setFieldNameDraft] = useState("");
  const [addingCustomField, setAddingCustomField] = useState(false);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<CustomFieldType>("text");
  const [newFieldOptionsText, setNewFieldOptionsText] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("kanban");
  const [columnViewMode, setColumnViewMode] = useState<ColumnViewMode>("apilado");
  const [activeStatusIndex, setActiveStatusIndex] = useState(0);

  // Preferencia persistida — equivalente móvil del `localStorage` que usa PlanificadorPage.tsx,
  // pero asíncrono (SecureStore): arranca en "flechas" y cambia en cuanto carga el valor guardado.
  useEffect(() => {
    SecureStore.getItemAsync(PLANNER_VIEW_MODE_KEY).then((stored) => {
      if (stored === "apilado" || stored === "flechas") setPlannerViewModeState(stored);
    });
  }, []);

  const changePlannerViewMode = (mode: PlannerViewMode) => {
    setPlannerViewModeState(mode);
    SecureStore.setItemAsync(PLANNER_VIEW_MODE_KEY, mode);
  };

  const reloadPlanners = useCallback(async () => {
    setLoadingPlanners(true);
    setPlannerError(null);
    try {
      let list = await listPlanners();
      // Siempre hay al menos un tablero por defecto — igual que ya garantizaba el propio backend
      // para las tareas sin plannerId (ver getOrCreateDefaultPlanner en plannerService.ts), pero
      // aquí explícito para que el usuario nunca aterrice en la pantalla vacía de "crea tu primer
      // tablero": ya tiene uno de fábrica ("Planificador"), y puede añadir más con "+ Nuevo".
      if (list.length === 0) {
        await createPlanner("Planificador");
        list = await listPlanners();
      }
      setPlanners(list);
    } catch (err) {
      setPlannerError(err instanceof ApiError ? err.message : "No se pudieron cargar los tableros");
    } finally {
      setLoadingPlanners(false);
    }
  }, []);

  // Si se borra el tablero activo (o cambia el total), el índice no debe quedar fuera de rango —
  // mismo efecto que HorarioScreen.tsx.
  useEffect(() => {
    if (plannerIndex > planners.length - 1) setPlannerIndex(Math.max(0, planners.length - 1));
  }, [planners.length, plannerIndex]);

  // En cuanto el tablero recién creado aparece en `planners`, salta a él.
  useEffect(() => {
    if (pendingFocusPlannerId === null) return;
    const index = planners.findIndex((p) => p.id === pendingFocusPlannerId);
    if (index !== -1) {
      setPlannerIndex(index);
      setPendingFocusPlannerId(null);
    }
  }, [planners, pendingFocusPlannerId]);

  const reload = useCallback(async () => {
    if (active) setTasks(await listTasksByPlanner(active.id));
    // También al resto de tableros visibles en Apilado, aunque la tarea que cambió no fuera la de
    // `active` — cada PlannerBoardCard se recarga solo al ver cambiar este número.
    setRefreshToken((n) => n + 1);
  }, [active]);

  // Al cambiar de tablero activo (flechas ‹ ›, o al terminar de cargar `planners`), recarga sus
  // tareas — mismo patrón que `reloadRows`/`active?.id` en HorarioScreen.tsx.
  useEffect(() => {
    if (active) reload();
    else setTasks([]);
    setRenamingPlanner(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  const sync = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    const result = await runSync();
    setSyncing(false);
    if (result.success) await reload();
    else setSyncError(result.error ?? "No se pudo sincronizar");
  }, [reload]);

  useFocusEffect(
    useCallback(() => {
      reloadPlanners();
      sync();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  // Con try/catch a propósito en las seis (a diferencia del equivalente en HorarioScreen.tsx,
  // que no lo tiene): un fallo del servidor aquí (sesión caducada, 500 puntual…) se quedaba sin
  // capturar y no pasaba nada visible — ni error ni reintento, solo un cuadro rojo de "unhandled
  // promise rejection" en desarrollo y un fallo silencioso en producción. Mismo `plannerError` que
  // ya usa `reloadPlanners`, así que el aviso sale en el mismo sitio.
  const handleCreatePlanner = async () => {
    const trimmed = newPlannerName.trim();
    if (!trimmed) return;
    try {
      const created = await createPlanner(trimmed);
      setNewPlannerName("");
      setShowCreatePlanner(false);
      setPendingFocusPlannerId(created.id);
      await reloadPlanners();
    } catch (err) {
      setPlannerError(err instanceof ApiError ? err.message : "No se pudo crear el tablero");
    }
  };

  const handleRenamePlanner = async () => {
    if (!active) return;
    const trimmed = plannerNameDraft.trim();
    setRenamingPlanner(false);
    if (!trimmed || trimmed === active.name) return;
    try {
      await renamePlanner(active.id, trimmed);
      await reloadPlanners();
    } catch (err) {
      setPlannerError(err instanceof ApiError ? err.message : "No se pudo renombrar el tablero");
    }
  };

  // Borrar un tablero se lleva por delante TODAS sus tareas (cascada, ver DELETE /planner/boards/:id
  // en plannerService.ts) — a diferencia del resto de acciones de esta pantalla (renombrar, mover),
  // esto sí pide confirmar, mismo patrón que confirmDeleteProject en ProyectoDetailScreen.tsx (que
  // también borra en cascada). El resto de borrados de un solo toque en el móvil (columnas de
  // kanban, horarios…) no arrastran nada tan grande como "todas las tareas de un tablero entero".
  const confirmDeletePlanner = (id: number, name: string, onDeleted: () => Promise<void>) => {
    Alert.alert("Eliminar tablero", `¿Seguro que quieres eliminar "${name}" y todas sus tareas?`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: async () => {
          try {
            await deletePlanner(id);
            await onDeleted();
          } catch (err) {
            setPlannerError(err instanceof ApiError ? err.message : "No se pudo eliminar el tablero");
          }
        },
      },
    ]);
  };

  const handleDeletePlanner = () => {
    if (!active) return;
    confirmDeletePlanner(active.id, active.name, async () => {
      await reloadPlanners();
      setRefreshToken((n) => n + 1);
    });
  };

  const handleMovePlanner = async (direction: "up" | "down") => {
    if (!active) return;
    try {
      await movePlanner(active.id, direction);
      await reloadPlanners();
    } catch (err) {
      setPlannerError(err instanceof ApiError ? err.message : "No se pudo mover el tablero");
    }
  };

  // Versiones "por id" de las acciones de arriba, para el modo Apilado — igual patrón que
  // renameScheduleById/deleteScheduleById/moveScheduleById en HorarioScreen.tsx.
  const renamePlannerById = async (id: number, name: string) => {
    try {
      await renamePlanner(id, name);
      await reloadPlanners();
    } catch (err) {
      setPlannerError(err instanceof ApiError ? err.message : "No se pudo renombrar el tablero");
    }
  };
  const deletePlannerById = (id: number, name: string) => {
    confirmDeletePlanner(id, name, async () => {
      await reloadPlanners();
      setRefreshToken((n) => n + 1);
    });
  };
  const movePlannerById = async (id: number, direction: "up" | "down") => {
    try {
      await movePlanner(id, direction);
      await reloadPlanners();
    } catch (err) {
      setPlannerError(err instanceof ApiError ? err.message : "No se pudo mover el tablero");
    }
  };

  const reloadSubtasks = useCallback(async (taskId: string) => {
    setSubtasks(await listForTask(taskId));
  }, []);

  // Fields+valores en vivo del tablero de la tarea — se piden en paralelo, SIN esperar a que
  // termine (openTask no la awaitea) para no retrasar la apertura del modal por una llamada que
  // puede tardar o fallar (sin conexión). Si falla, `customFieldsUnavailable` hace que la sección
  // muestre solo un aviso discreto en vez de campos editables. `openTaskIdRef` guarda qué tarea
  // sigue abierta cuando la petición termina — si el usuario cerró el modal o abrió OTRA tarea
  // mientras esta seguía en vuelo, el resultado llega tarde y se descarta en vez de pisar el
  // estado de la tarea que esté abierta ahora.
  const openTaskIdRef = useRef<string | null>(null);

  const loadCustomFields = useCallback(async (task: LocalTask) => {
    setCustomFields([]);
    setCustomFieldValues({});
    setCustomFieldDrafts({});
    setCustomFieldsUnavailable(false);
    setPlannerOfOpenTask(task.plannerId);
    if (task.plannerId == null) return;
    const taskServerId = Number(task.id);
    try {
      const [fields, liveTasks] = await Promise.all([listPlannerFields(task.plannerId), listPlannerTasksLive(task.plannerId)]);
      if (openTaskIdRef.current !== task.id) return;
      setCustomFields(fields);
      const live = Number.isFinite(taskServerId) ? liveTasks.find((t) => t.id === taskServerId) : undefined;
      const values = live?.customFields ?? {};
      setCustomFieldValues(values);
      // Los borradores de texto/número parten del valor ya guardado — el resto de tipos
      // (fecha/selección) no pasan por un borrador, se leen/escriben directo en customFieldValues.
      const drafts: Record<string, string> = {};
      for (const field of fields) {
        if (field.type !== "text" && field.type !== "number") continue;
        const v = values[String(field.id)];
        drafts[String(field.id)] = v === null || v === undefined ? "" : String(v);
      }
      setCustomFieldDrafts(drafts);
    } catch {
      if (openTaskIdRef.current === task.id) setCustomFieldsUnavailable(true);
    }
  }, []);

  const openTask = async (task: LocalTask) => {
    openTaskIdRef.current = task.id;
    setForm(toForm(task));
    await reloadSubtasks(task.id);
    loadCustomFields(task);
  };

  const closeTask = () => {
    openTaskIdRef.current = null;
    setForm(null);
    setSubtasks([]);
    setSubtaskDraft("");
    setShowDuePicker(false);
    setPlannerOfOpenTask(null);
    setCustomFields([]);
    setCustomFieldValues({});
    setCustomFieldsUnavailable(false);
    setCustomFieldDrafts({});
    setEditingCustomDateFieldId(null);
    setAddingCustomField(false);
    setNewFieldName("");
    setNewFieldType("text");
    setNewFieldOptionsText("");
    setMinutesToLogText("");
  };

  const handleQuickAdd = async (status: TaskStatus) => {
    if (!active) return;
    const title = drafts[status].trim();
    if (!title) return;
    setDrafts({ ...drafts, [status]: "" });
    await createTaskLocal({ plannerId: active.id, title, description: null, status, priority: "medium", dueDate: null, tags: [] });
    await reload();
    sync();
  };

  const handleCyclePriority = async (task: LocalTask) => {
    await updateTaskLocal(task.id, {
      title: task.title,
      description: task.description,
      image: task.image,
      notes: task.notes,
      priority: nextPriority(task.priority),
      dueDate: task.dueDate,
      estimatedMinutes: task.estimatedMinutes,
      tags: parseTaskTags(task),
    });
    await reload();
    sync();
  };

  const handleMoveStatus = async (status: TaskStatus) => {
    if (!form) return;
    await moveTask(form.id, status, null);
    setForm({ ...form, status });
    await reload();
    sync();
  };

  const handleSaveForm = async () => {
    if (!form || !form.title.trim()) return;
    const tags = form.tagsText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const estimatedMinutes = form.estimatedMinutesText.trim() ? Number(form.estimatedMinutesText.trim()) : null;
    await updateTaskLocal(form.id, {
      title: form.title.trim(),
      description: form.description.trim() || null,
      image: form.image,
      notes: form.notes.trim() || null,
      priority: form.priority,
      dueDate: form.dueDate ? form.dueDate.toISOString() : null,
      estimatedMinutes: estimatedMinutes != null && Number.isFinite(estimatedMinutes) ? estimatedMinutes : null,
      tags,
    });
    // Los campos de texto/número de propiedades personalizadas esperan a "Guardar" (o a perder el
    // foco) para no machacar la API en cada pulsación — si queda algún borrador sin confirmar
    // (el usuario tocó Guardar sin salir del campo), se manda aquí.
    customFields.filter((f) => f.type === "text" || f.type === "number").forEach(commitCustomFieldDraft);
    closeTask();
    await reload();
    sync();
  };

  // Mismo límite que el resto de imágenes embebidas de la app (galería, tarjetas kanban, editor
  // enriquecido) — ver MAX_IMAGE_BYTES en PaginaDetailScreen.tsx.
  const pickTaskImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permiso necesario", "Activa el acceso a tus fotos para añadir una imagen.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], base64: true, quality: 0.7 });
    if (result.canceled || !result.assets[0]?.base64) return;
    const base64 = result.assets[0].base64;
    if (base64.length * 0.75 > TASK_MAX_IMAGE_BYTES) {
      Alert.alert("Imagen demasiado grande", "El límite es de 3 MB por imagen.");
      return;
    }
    setForm((prev) => (prev ? { ...prev, image: `data:image/jpeg;base64,${base64}` } : prev));
  };

  // Registrar tiempo llama a la API directa (ver logTaskTime en api/planner.ts, mismo motivo que
  // persistCustomField: SUMA en el servidor, no un valor absoluto) y, si responde bien, refleja el
  // nuevo total tanto en `form` (para que se vea al momento sin cerrar el modal) como en SQLite
  // (ver addActualMinutesLocal) para que la tarjeta del tablero ya lo muestre actualizado sin
  // esperar al siguiente pull.
  const [minutesToLogText, setMinutesToLogText] = useState("");
  const [loggingTime, setLoggingTime] = useState(false);
  const handleLogTime = async () => {
    if (!form) return;
    const taskId = Number(form.id);
    if (!Number.isFinite(taskId)) return;
    const minutes = Number(minutesToLogText.trim());
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    setLoggingTime(true);
    try {
      const result = await logTaskTime(taskId, minutes);
      await addActualMinutesLocal(form.id, minutes);
      setForm((prev) => (prev ? { ...prev, actualMinutes: result.actualMinutes } : prev));
      setMinutesToLogText("");
      await reload();
    } catch {
      Alert.alert("No se pudo registrar", "Comprueba tu conexión e inténtalo de nuevo.");
    } finally {
      setLoggingTime(false);
    }
  };

  // Solo persiste si la tarea ya tiene id de servidor (Number(form.id) es finito) — una tarea
  // creada offline y aún no sincronizada no tiene a qué taskId de /planner/tasks/:id mandar el
  // PATCH todavía; se pierde silenciosamente en ese caso (mismo criterio que "no bloquear" del
  // resto de esta sección: sin banner de error por cada intento).
  const persistCustomField = (fieldId: number, value: CustomFieldValue) => {
    if (!form) return;
    const taskId = Number(form.id);
    if (!Number.isFinite(taskId)) return;
    updateTaskCustomFields(taskId, { [String(fieldId)]: value }).catch(() => {
      // Sin conexión: se queda el valor optimista ya puesto en customFieldValues, sin reintento
      // automático (igual que el resto de acciones fire-and-forget de esta pantalla).
    });
  };

  // Fecha y selección se confirman al momento (un toque = una elección), no al perder el foco.
  const handleCustomFieldChange = (fieldId: number, value: CustomFieldValue) => {
    setCustomFieldValues((prev) => ({ ...prev, [String(fieldId)]: value }));
    persistCustomField(fieldId, value);
  };

  // Texto y número solo se mandan al perder el foco (o al guardar la tarea, ver handleSaveForm) —
  // mientras tanto solo cambia el borrador local, sin llamar a la API en cada tecla.
  const commitCustomFieldDraft = (field: PlannerField) => {
    const raw = customFieldDrafts[String(field.id)] ?? "";
    const trimmed = raw.trim();
    let value: CustomFieldValue;
    if (field.type === "number") {
      const n = Number(trimmed);
      value = trimmed === "" || Number.isNaN(n) ? null : n;
    } else {
      value = trimmed === "" ? null : trimmed;
    }
    const previous = customFieldValues[String(field.id)] ?? null;
    if (value === previous) return;
    setCustomFieldValues((prev) => ({ ...prev, [String(field.id)]: value }));
    persistCustomField(field.id, value);
  };

  const handleAddCustomField = async () => {
    if (plannerOfOpenTask == null) return;
    const name = newFieldName.trim();
    if (!name) return;
    const options = newFieldType === "select" ? newFieldOptionsText.split(",").map((o) => o.trim()).filter(Boolean) : undefined;
    try {
      await createPlannerField(plannerOfOpenTask, name, newFieldType, options);
      setCustomFields(await listPlannerFields(plannerOfOpenTask));
      setNewFieldName("");
      setNewFieldOptionsText("");
      setNewFieldType("text");
      setAddingCustomField(false);
    } catch {
      // Sin conexión: se deja el formulario abierto (con lo ya escrito) para que el usuario
      // reintente, en vez de perder lo que llevaba tecleado.
    }
  };

  // Renombrar/mover/borrar una propiedad ya creada — gestión del TABLERO (afecta a todas las
  // tareas que usan esa propiedad), no de esta tarea en concreto, pero se hace desde aquí porque
  // no hay otra pantalla de "administrar propiedades" (igual criterio que el resto de esta
  // sección: no bloquear ni mostrar banner de error si falla por falta de conexión).
  const startRenameField = (field: PlannerField) => {
    setRenamingFieldId(field.id);
    setFieldNameDraft(field.name);
  };

  const commitRenameField = async (field: PlannerField) => {
    const trimmed = fieldNameDraft.trim();
    setRenamingFieldId(null);
    if (!trimmed || trimmed === field.name || plannerOfOpenTask == null) return;
    try {
      await renamePlannerField(plannerOfOpenTask, field.id, trimmed);
      setCustomFields(await listPlannerFields(plannerOfOpenTask));
    } catch {
      // Sin conexión: se descarta el renombrado.
    }
  };

  const handleMoveField = async (field: PlannerField, direction: "up" | "down") => {
    if (plannerOfOpenTask == null) return;
    try {
      await movePlannerField(plannerOfOpenTask, field.id, direction);
      setCustomFields(await listPlannerFields(plannerOfOpenTask));
    } catch {
      // Sin conexión: se queda el orden actual.
    }
  };

  // Borrado de un solo toque, sin confirmar — igual criterio que el resto de borrados "pequeños"
  // de esta pantalla (columnas de kanban, horarios…, ver comentario en confirmDeletePlanner):
  // borrar una propiedad no arrastra tareas enteras, solo dejan de referenciarse sus valores.
  const handleDeleteField = async (field: PlannerField) => {
    if (plannerOfOpenTask == null) return;
    try {
      await deletePlannerField(plannerOfOpenTask, field.id);
      setCustomFields(await listPlannerFields(plannerOfOpenTask));
      const key = String(field.id);
      setCustomFieldValues((prev) => {
        const { [key]: _omit, ...rest } = prev;
        return rest;
      });
      setCustomFieldDrafts((prev) => {
        const { [key]: _omit, ...rest } = prev;
        return rest;
      });
    } catch {
      // Sin conexión: la propiedad se queda.
    }
  };

  const handleDeleteTask = async () => {
    if (!form) return;
    await deleteTaskLocal(form.id);
    closeTask();
    await reload();
    sync();
  };

  const handleAddSubtask = async () => {
    if (!form || !subtaskDraft.trim()) return;
    const title = subtaskDraft.trim();
    setSubtaskDraft("");
    await createSubtaskLocal(form.id, title);
    await reloadSubtasks(form.id);
    sync();
  };

  const handleToggleSubtask = async (id: string) => {
    await toggleSubtask(id);
    if (form) await reloadSubtasks(form.id);
    sync();
  };

  const handleDeleteSubtask = async (id: string) => {
    await deleteSubtaskLocal(id);
    if (form) await reloadSubtasks(form.id);
    sync();
  };

  const onDuePickerChange = (_event: DateTimePickerChangeEvent, selected: Date) => {
    setShowDuePicker(false);
    if (!form) return;
    setForm({ ...form, dueDate: selected });
  };

  const visibleStatuses = columnViewMode === "flechas" ? [TASK_STATUSES[activeStatusIndex]] : TASK_STATUSES;

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.header, collapsed && { paddingLeft: SIDEBAR_CLIP_CLEARANCE }]}>
        <Text style={styles.title}>Planificador</Text>
        <Pressable style={styles.newButton} onPress={() => setShowCreatePlanner(true)}>
          <Text style={styles.newButtonText}>+ Nuevo</Text>
        </Pressable>
      </View>

      <View style={styles.viewModeRow}>
        <View style={styles.viewModePill}>
          <Pressable
            style={[styles.viewModeButton, plannerViewMode === "flechas" && styles.viewModeButtonActive]}
            onPress={() => changePlannerViewMode("flechas")}
          >
            <Text style={[styles.viewModeButtonText, plannerViewMode === "flechas" && styles.viewModeButtonTextActive]}>Flechas</Text>
          </Pressable>
          <Pressable
            style={[styles.viewModeButton, plannerViewMode === "apilado" && styles.viewModeButtonActive]}
            onPress={() => changePlannerViewMode("apilado")}
          >
            <Text style={[styles.viewModeButtonText, plannerViewMode === "apilado" && styles.viewModeButtonTextActive]}>Apilado</Text>
          </Pressable>
        </View>
      </View>

      {plannerError && <Text style={styles.errorBanner}>{plannerError}</Text>}
      {syncError && <Text style={styles.errorBanner}>{syncError} — se reintentará solo</Text>}

      {syncing && (
        <View style={styles.syncBar}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.syncText}>Sincronizando…</Text>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.content}>
        {loadingPlanners && planners.length === 0 ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
        ) : planners.length === 0 ? (
          <Text style={styles.emptyText}>Aún no tienes ningún tablero. Crea uno para empezar (p. ej. "Trabajo" o "Personal").</Text>
        ) : plannerViewMode === "flechas" ? (
          <>
            {/* NAVEGACIÓN DE TABLEROS */}
            <View style={styles.plannerNav}>
              <Pressable disabled={plannerIndex === 0} onPress={() => setPlannerIndex((i) => i - 1)}>
                <Text style={[styles.plannerNavArrow, plannerIndex === 0 && styles.plannerNavArrowDisabled]}>‹</Text>
              </Pressable>

              {renamingPlanner ? (
                <TextInput
                  style={styles.plannerNameInput}
                  value={plannerNameDraft}
                  onChangeText={setPlannerNameDraft}
                  onBlur={handleRenamePlanner}
                  onSubmitEditing={handleRenamePlanner}
                  autoFocus
                />
              ) : (
                <Pressable
                  style={styles.plannerNameButton}
                  onPress={() => {
                    setPlannerNameDraft(active?.name ?? "");
                    setRenamingPlanner(true);
                  }}
                >
                  <Text style={styles.plannerNavTitle} numberOfLines={1}>
                    {active?.name}
                  </Text>
                </Pressable>
              )}

              <Pressable disabled={plannerIndex >= planners.length - 1} onPress={() => setPlannerIndex((i) => i + 1)}>
                <Text style={[styles.plannerNavArrow, plannerIndex >= planners.length - 1 && styles.plannerNavArrowDisabled]}>›</Text>
              </Pressable>
            </View>

            <View style={styles.plannerToolbar}>
              <Text style={styles.plannerToolbarHint}>
                {plannerIndex + 1} de {planners.length}
              </Text>
              <View style={styles.plannerToolbarActions}>
                <Pressable onPress={() => handleMovePlanner("up")} disabled={plannerIndex === 0}>
                  <Text style={[styles.plannerToolbarAction, plannerIndex === 0 && styles.plannerNavArrowDisabled]}>↑</Text>
                </Pressable>
                <Pressable onPress={() => handleMovePlanner("down")} disabled={plannerIndex >= planners.length - 1}>
                  <Text style={[styles.plannerToolbarAction, plannerIndex >= planners.length - 1 && styles.plannerNavArrowDisabled]}>↓</Text>
                </Pressable>
                <Pressable onPress={handleDeletePlanner}>
                  <Text style={[styles.plannerToolbarAction, styles.plannerToolbarDelete]}>Eliminar tablero</Text>
                </Pressable>
              </View>
            </View>

            {/* VISTA Y NAVEGACIÓN DE COLUMNAS (dentro del tablero activo) */}
            <View style={styles.controlBar}>
              <View style={styles.viewToggle}>
                {VIEW_MODES.map((mode) => (
                  <Pressable
                    key={mode}
                    style={[styles.viewToggleButton, viewMode === mode && styles.viewToggleButtonActive]}
                    onPress={() => setViewMode(mode)}
                  >
                    <Text style={[styles.viewToggleText, viewMode === mode && styles.viewToggleTextActive]}>
                      {mode === "kanban" ? "Kanban" : "Lista"}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.columnToggle}>
                {COLUMN_VIEWS.map((mode) => (
                  <Pressable
                    key={mode}
                    style={[styles.columnToggleButton, columnViewMode === mode && styles.columnToggleButtonActive]}
                    onPress={() => setColumnViewMode(mode)}
                  >
                    <Text style={[styles.columnToggleText, columnViewMode === mode && styles.columnToggleTextActive]}>
                      {mode === "flechas" ? "Flechas" : "Apilado"}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {columnViewMode === "flechas" && (
              <View style={styles.navigationBar}>
                <Pressable
                  style={[styles.navButton, activeStatusIndex === 0 && styles.navButtonDisabled]}
                  onPress={() => setActiveStatusIndex(Math.max(0, activeStatusIndex - 1))}
                  disabled={activeStatusIndex === 0}
                >
                  <Text style={styles.navButtonText}>‹</Text>
                </Pressable>
                <Text style={styles.navLabel}>
                  {COLUMN_HEADERS[TASK_STATUSES[activeStatusIndex]]} ({activeStatusIndex + 1}/{TASK_STATUSES.length})
                </Text>
                <Pressable
                  style={[styles.navButton, activeStatusIndex === TASK_STATUSES.length - 1 && styles.navButtonDisabled]}
                  onPress={() => setActiveStatusIndex(Math.min(TASK_STATUSES.length - 1, activeStatusIndex + 1))}
                  disabled={activeStatusIndex === TASK_STATUSES.length - 1}
                >
                  <Text style={styles.navButtonText}>›</Text>
                </Pressable>
              </View>
            )}

            {viewMode === "kanban" ? (
              <TaskKanbanColumns
                statuses={visibleStatuses}
                tasks={tasks}
                drafts={drafts}
                onDraftChange={(status, t) => setDrafts({ ...drafts, [status]: t })}
                onQuickAdd={handleQuickAdd}
                onOpenTask={openTask}
                onMoveTask={async (taskId, status, beforeTaskId) => {
                  await moveTask(taskId, status, beforeTaskId);
                  await reload();
                  sync();
                }}
              />
            ) : (
              // VISTA LISTA
              <View style={styles.listContainer}>
                {TASK_STATUSES.map((status) => {
                  const columnTasks = tasks.filter((t) => t.status === status);
                  return (
                    <View key={status} style={styles.listSection}>
                      <Text style={styles.listSectionHeader}>{COLUMN_HEADERS[status]}</Text>

                      {columnTasks.length === 0 ? (
                        <Text style={styles.emptyText}>Sin tareas</Text>
                      ) : (
                        columnTasks.map((task) => {
                          const badge = dueBadge(task.dueDate, task.status === "done");
                          return (
                            <Pressable key={task.id} style={styles.listTaskRow} onPress={() => openTask(task)}>
                              <Pressable
                                style={[styles.listPriorityDot, { backgroundColor: priorityStyle(task.priority).text }]}
                                onPress={() => handleCyclePriority(task)}
                              />
                              <View style={styles.listTaskInfo}>
                                <Text style={[styles.listTaskTitle, task.status === "done" && styles.taskTitleDone]}>{task.title}</Text>
                                {badge && (
                                  <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                                    <Text style={[styles.badgeText, { color: badge.text }]}>{badge.label}</Text>
                                  </View>
                                )}
                              </View>
                              {(task.synced === 0 || task.pendingOp === "update") && (
                                <Text style={styles.pendingTag}>pendiente</Text>
                              )}
                            </Pressable>
                          );
                        })
                      )}
                    </View>
                  );
                })}
              </View>
            )}
          </>
        ) : (
          // APILADO DE TABLEROS: cada uno, un Kanban simple y completo
          <View style={styles.stackedList}>
            {planners.map((planner, index) => (
              <PlannerBoardCard
                key={planner.id}
                planner={planner}
                refreshToken={refreshToken}
                canMoveUp={index > 0}
                canMoveDown={index < planners.length - 1}
                onOpenTask={openTask}
                onSync={sync}
                onRename={(name) => renamePlannerById(planner.id, name)}
                onDelete={() => deletePlannerById(planner.id, planner.name)}
                onMoveUp={() => movePlannerById(planner.id, "up")}
                onMoveDown={() => movePlannerById(planner.id, "down")}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {/* MODAL DE EDICIÓN */}
      <Modal visible={form !== null} animationType="slide" onRequestClose={closeTask} transparent>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior="padding">
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 20 }]}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>Tarea</Text>

              <TextInput
                style={styles.input}
                placeholder="Título"
                value={form?.title ?? ""}
                onChangeText={(t) => form && setForm({ ...form, title: t })}
                placeholderTextColor={colors.mutedForeground}
              />
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                placeholder="Descripción (opcional)"
                value={form?.description ?? ""}
                onChangeText={(t) => form && setForm({ ...form, description: t })}
                multiline
                placeholderTextColor={colors.mutedForeground}
              />

              {form?.image ? <Image source={{ uri: form.image }} style={styles.taskFormImage} /> : null}
              <View style={styles.taskImageActions}>
                <Pressable onPress={pickTaskImage} hitSlop={6}>
                  <Text style={styles.taskImageActionText}>{form?.image ? "🖼 Cambiar imagen" : "🖼 Añadir imagen"}</Text>
                </Pressable>
                {form?.image ? (
                  <Pressable onPress={() => setForm((prev) => (prev ? { ...prev, image: null } : prev))} hitSlop={6}>
                    <Text style={[styles.taskImageActionText, styles.taskImageActionRemove]}>Quitar imagen</Text>
                  </Pressable>
                ) : null}
              </View>

              <Text style={styles.fieldLabel}>Notas</Text>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                placeholder="Notas libres (opcional)"
                value={form?.notes ?? ""}
                onChangeText={(t) => form && setForm({ ...form, notes: t })}
                multiline
                placeholderTextColor={colors.mutedForeground}
              />

              <Text style={styles.fieldLabel}>Estado</Text>
              <View style={styles.chipRow}>
                {TASK_STATUSES.map((status) => (
                  <Pressable
                    key={status}
                    style={[styles.chip, form?.status === status && styles.chipSelected]}
                    onPress={() => handleMoveStatus(status)}
                  >
                    <Text style={[styles.chipText, form?.status === status && styles.chipTextSelected]}>
                      {TASK_STATUS_LABELS[status]}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.fieldLabel}>Prioridad</Text>
              <View style={styles.chipRow}>
                {TASK_PRIORITIES.map((priority) => (
                  <Pressable
                    key={priority}
                    style={[styles.chip, form?.priority === priority && styles.chipSelected]}
                    onPress={() => form && setForm({ ...form, priority })}
                  >
                    <Text style={[styles.chipText, form?.priority === priority && styles.chipTextSelected]}>
                      {TASK_PRIORITY_LABELS[priority]}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.fieldLabel}>Fecha límite</Text>
              <View style={styles.dateRow}>
                <Pressable style={styles.dateButton} onPress={() => setShowDuePicker(true)}>
                  <Text style={styles.dateButtonText}>{form?.dueDate ? form.dueDate.toLocaleDateString("es-ES") : "Sin fecha"}</Text>
                </Pressable>
                {form?.dueDate && (
                  <Pressable style={styles.clearDateButton} onPress={() => form && setForm({ ...form, dueDate: null })}>
                    <Text style={styles.clearDateButtonText}>Quitar</Text>
                  </Pressable>
                )}
              </View>

              <TextInput
                style={styles.input}
                placeholder="Tags, separados por coma"
                value={form?.tagsText ?? ""}
                onChangeText={(t) => form && setForm({ ...form, tagsText: t })}
                placeholderTextColor={colors.mutedForeground}
              />

              <Text style={styles.fieldLabel}>Subtareas</Text>
              {subtasks.map((s) => (
                <View key={s.id} style={styles.subtaskRow}>
                  <Pressable style={styles.subtaskCheckRow} onPress={() => handleToggleSubtask(s.id)}>
                    <View style={[styles.checkbox, s.completed === 1 && styles.checkboxChecked]}>
                      {s.completed === 1 && <Text style={styles.checkboxMark}>✓</Text>}
                    </View>
                    <Text style={[styles.subtaskTitle, s.completed === 1 && styles.taskTitleDone]}>{s.title}</Text>
                  </Pressable>
                  <Pressable onPress={() => handleDeleteSubtask(s.id)}>
                    <Text style={styles.deleteText}>Borrar</Text>
                  </Pressable>
                </View>
              ))}
              <View style={styles.quickAddRow}>
                <TextInput
                  style={styles.quickAddInput}
                  placeholder="Nueva subtarea…"
                  value={subtaskDraft}
                  onChangeText={setSubtaskDraft}
                  onSubmitEditing={handleAddSubtask}
                  placeholderTextColor={colors.mutedForeground}
                />
                <Pressable style={styles.addButton} onPress={handleAddSubtask}>
                  <Text style={styles.addButtonText}>+</Text>
                </Pressable>
              </View>

              <Text style={styles.fieldLabel}>Tiempo</Text>
              <TextInput
                style={styles.input}
                placeholder="Tiempo estimado en minutos (opcional)"
                value={form?.estimatedMinutesText ?? ""}
                onChangeText={(t) => form && setForm({ ...form, estimatedMinutesText: t.replace(/[^0-9]/g, "") })}
                keyboardType="numeric"
                placeholderTextColor={colors.mutedForeground}
              />
              {/* Registrar tiempo solo tiene sentido con id de servidor real (logTaskTime golpea
                  /planner/tasks/:id/time) — mismo criterio que EventInvitationsEditor en
                  AgendaScreen.tsx para una tarea/evento aún sin sincronizar. */}
              {form?.id && /^\d+$/.test(form.id) && (
                <View style={styles.timeLogRow}>
                  <Text style={styles.timeLogTotal}>Tiempo registrado: {form.actualMinutes} min</Text>
                  <View style={styles.timeLogInputRow}>
                    <TextInput
                      style={[styles.input, styles.timeLogInput]}
                      placeholder="Minutos"
                      value={minutesToLogText}
                      onChangeText={(t) => setMinutesToLogText(t.replace(/[^0-9]/g, ""))}
                      keyboardType="numeric"
                      placeholderTextColor={colors.mutedForeground}
                    />
                    <Pressable style={styles.addButton} onPress={handleLogTime} disabled={loggingTime || !minutesToLogText.trim()}>
                      <Text style={styles.addButtonText}>{loggingTime ? "…" : "+"}</Text>
                    </Pressable>
                  </View>
                </View>
              )}

              {/* PROPIEDADES PERSONALIZADAS — solo si la tarea pertenece a un tablero (siempre
                  debería, ver LocalTask.plannerId) y se pudo llegar al servidor (ver
                  loadCustomFields); sin conexión se cambia por un aviso discreto, no un banner de
                  error sobre todo el modal. */}
              {plannerOfOpenTask !== null && (
                <>
                  <Text style={styles.fieldLabel}>Propiedades personalizadas</Text>
                  {customFieldsUnavailable ? (
                    <Text style={styles.customFieldsHint}>Propiedades personalizadas: requiere conexión</Text>
                  ) : (
                    <>
                      {customFields.map((field, index) => (
                        <View key={field.id} style={styles.customFieldBlock}>
                          <View style={styles.customFieldHeader}>
                            {renamingFieldId === field.id ? (
                              <TextInput
                                style={styles.customFieldNameInput}
                                value={fieldNameDraft}
                                onChangeText={setFieldNameDraft}
                                onBlur={() => commitRenameField(field)}
                                onSubmitEditing={() => commitRenameField(field)}
                                autoFocus
                                placeholderTextColor={colors.mutedForeground}
                              />
                            ) : (
                              <Pressable style={styles.customFieldLabelButton} onPress={() => startRenameField(field)}>
                                <Text style={styles.customFieldLabel}>{field.name}</Text>
                              </Pressable>
                            )}
                            <View style={styles.customFieldActions}>
                              <Pressable onPress={() => handleMoveField(field, "up")} disabled={index === 0}>
                                <Text style={[styles.customFieldAction, index === 0 && styles.plannerNavArrowDisabled]}>↑</Text>
                              </Pressable>
                              <Pressable onPress={() => handleMoveField(field, "down")} disabled={index === customFields.length - 1}>
                                <Text
                                  style={[
                                    styles.customFieldAction,
                                    index === customFields.length - 1 && styles.plannerNavArrowDisabled,
                                  ]}
                                >
                                  ↓
                                </Text>
                              </Pressable>
                              <Pressable onPress={() => handleDeleteField(field)}>
                                <Text style={[styles.customFieldAction, styles.plannerToolbarDelete]}>✕</Text>
                              </Pressable>
                            </View>
                          </View>
                          {field.type === "text" && (
                            <TextInput
                              style={styles.input}
                              value={customFieldDrafts[String(field.id)] ?? ""}
                              onChangeText={(t) => setCustomFieldDrafts((prev) => ({ ...prev, [String(field.id)]: t }))}
                              onBlur={() => commitCustomFieldDraft(field)}
                              placeholderTextColor={colors.mutedForeground}
                            />
                          )}
                          {field.type === "number" && (
                            <TextInput
                              style={styles.input}
                              keyboardType="numeric"
                              value={customFieldDrafts[String(field.id)] ?? ""}
                              onChangeText={(t) => setCustomFieldDrafts((prev) => ({ ...prev, [String(field.id)]: t }))}
                              onBlur={() => commitCustomFieldDraft(field)}
                              placeholderTextColor={colors.mutedForeground}
                            />
                          )}
                          {field.type === "date" && (
                            <View style={styles.dateRow}>
                              <Pressable style={styles.dateButton} onPress={() => setEditingCustomDateFieldId(field.id)}>
                                <Text style={styles.dateButtonText}>
                                  {customFieldValues[String(field.id)]
                                    ? new Date(String(customFieldValues[String(field.id)])).toLocaleDateString("es-ES")
                                    : "Sin fecha"}
                                </Text>
                              </Pressable>
                              {customFieldValues[String(field.id)] != null && (
                                <Pressable style={styles.clearDateButton} onPress={() => handleCustomFieldChange(field.id, null)}>
                                  <Text style={styles.clearDateButtonText}>Quitar</Text>
                                </Pressable>
                              )}
                            </View>
                          )}
                          {field.type === "select" && (
                            <View style={styles.chipRow}>
                              <Pressable
                                style={[styles.chip, (customFieldValues[String(field.id)] ?? null) === null && styles.chipSelected]}
                                onPress={() => handleCustomFieldChange(field.id, null)}
                              >
                                <Text
                                  style={[
                                    styles.chipText,
                                    (customFieldValues[String(field.id)] ?? null) === null && styles.chipTextSelected,
                                  ]}
                                >
                                  Sin elegir
                                </Text>
                              </Pressable>
                              {field.options.map((opt) => {
                                const selected = customFieldValues[String(field.id)] === opt;
                                return (
                                  <Pressable
                                    key={opt}
                                    style={[styles.chip, selected && styles.chipSelected]}
                                    onPress={() => handleCustomFieldChange(field.id, opt)}
                                  >
                                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{opt}</Text>
                                  </Pressable>
                                );
                              })}
                            </View>
                          )}
                        </View>
                      ))}

                      {addingCustomField ? (
                        <View style={styles.addFieldForm}>
                          <TextInput
                            autoFocus
                            style={styles.input}
                            placeholder="Nombre de la propiedad"
                            value={newFieldName}
                            onChangeText={setNewFieldName}
                            placeholderTextColor={colors.mutedForeground}
                          />
                          <View style={styles.chipRow}>
                            {FIELD_TYPES.map((t) => (
                              <Pressable
                                key={t}
                                style={[styles.chip, newFieldType === t && styles.chipSelected]}
                                onPress={() => setNewFieldType(t)}
                              >
                                <Text style={[styles.chipText, newFieldType === t && styles.chipTextSelected]}>
                                  {FIELD_TYPE_LABELS[t]}
                                </Text>
                              </Pressable>
                            ))}
                          </View>
                          {newFieldType === "select" && (
                            <TextInput
                              style={styles.input}
                              placeholder="Opciones separadas por coma"
                              value={newFieldOptionsText}
                              onChangeText={setNewFieldOptionsText}
                              placeholderTextColor={colors.mutedForeground}
                            />
                          )}
                          <View style={styles.addFieldActions}>
                            <Pressable style={styles.saveButtonSmall} onPress={handleAddCustomField}>
                              <Text style={styles.saveButtonSmallText}>+ Añadir propiedad</Text>
                            </Pressable>
                            <Pressable
                              onPress={() => {
                                setAddingCustomField(false);
                                setNewFieldName("");
                                setNewFieldOptionsText("");
                                setNewFieldType("text");
                              }}
                            >
                              <Text style={styles.cancelButtonText}>Cancelar</Text>
                            </Pressable>
                          </View>
                        </View>
                      ) : (
                        <Pressable onPress={() => setAddingCustomField(true)}>
                          <Text style={styles.addCustomFieldText}>+ Añadir propiedad</Text>
                        </Pressable>
                      )}
                    </>
                  )}
                </>
              )}

              <Pressable style={styles.saveButton} onPress={handleSaveForm}>
                <Text style={styles.saveButtonText}>Guardar</Text>
              </Pressable>
              <Pressable style={styles.deleteButton} onPress={handleDeleteTask}>
                <Text style={styles.deleteButtonText}>Borrar tarea</Text>
              </Pressable>
              <Pressable style={styles.cancelButton} onPress={closeTask}>
                <Text style={styles.cancelButtonText}>Cerrar</Text>
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* MODAL NUEVO TABLERO */}
      <Modal visible={showCreatePlanner} animationType="slide" transparent onRequestClose={() => setShowCreatePlanner(false)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior="padding">
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 20 }]}>
            <Text style={styles.modalTitle}>Nuevo tablero</Text>
            <TextInput
              style={styles.input}
              placeholder="Ej. Trabajo o Personal"
              value={newPlannerName}
              onChangeText={setNewPlannerName}
              autoFocus
            />
            <Pressable style={styles.saveButton} onPress={handleCreatePlanner}>
              <Text style={styles.saveButtonText}>Crear tablero</Text>
            </Pressable>
            <Pressable style={styles.cancelButton} onPress={() => setShowCreatePlanner(false)}>
              <Text style={styles.cancelButtonText}>Cancelar</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {showDuePicker && (
        <DateTimePicker
          value={form?.dueDate ?? new Date()}
          mode="date"
          display={Platform.OS === "ios" ? "inline" : "default"}
          onValueChange={onDuePickerChange}
          onDismiss={() => setShowDuePicker(false)}
        />
      )}

      {editingCustomDateFieldId !== null && (
        <DateTimePicker
          value={
            customFieldValues[String(editingCustomDateFieldId)]
              ? new Date(String(customFieldValues[String(editingCustomDateFieldId)]))
              : new Date()
          }
          mode="date"
          display={Platform.OS === "ios" ? "inline" : "default"}
          onValueChange={(_event: DateTimePickerChangeEvent, selected: Date) => {
            const fieldId = editingCustomDateFieldId;
            setEditingCustomDateFieldId(null);
            if (fieldId !== null && selected) handleCustomFieldChange(fieldId, selected.toISOString());
          }}
          onDismiss={() => setEditingCustomDateFieldId(null)}
        />
      )}
    </SafeAreaView>
  );
}

/** Columnas de un tablero (Por hacer/En progreso/Hecho, o solo una en modo "Flechas") con
 * arrastrar-para-reordenar-y-mover-de-columna — compartido entre la vista de un único tablero
 * (PlanificadorScreen) y cada tarjeta de tablero en el modo Apilado de tableros (PlannerBoardCard,
 * más abajo), que hasta ahora repetían la misma rejilla de columnas+tarjetas+alta rápida sin
 * arrastre (mover una tarjeta era abrir su formulario y tocar el estado). El arrastre calcula una
 * vista previa LOCAL (`liveTasks`) sin tocar SQLite en cada frame de movimiento — solo al soltar
 * se llama una vez a `onMoveTask` (que sí persiste, ver moveTask en db/tasksRepo.ts, con el mismo
 * `beforeTaskId` que ya usa la web para el orden fraccionario dentro de cada columna).
 *
 * La posición de destino se calcula con el `onLayout` REAL de cada tarjeta y columna (no una
 * altura media estimada): cada tarjeta reporta su propio alto exacto (una con descripción larga o
 * imagen mide más que una de una línea), así que soltar cae justo donde lo esperas incluso con
 * tarjetas de alturas muy distintas dentro del mismo tablero. */
function TaskKanbanColumns({
  statuses,
  tasks,
  drafts,
  onDraftChange,
  onQuickAdd,
  onOpenTask,
  onMoveTask,
}: {
  statuses: readonly TaskStatus[];
  tasks: LocalTask[];
  drafts: Record<TaskStatus, string>;
  onDraftChange: (status: TaskStatus, text: string) => void;
  onQuickAdd: (status: TaskStatus) => void;
  onOpenTask: (task: LocalTask) => void;
  onMoveTask: (taskId: string, status: TaskStatus, beforeTaskId: string | null) => Promise<void>;
}) {
  const [liveTasks, setLiveTasks] = useState<LocalTask[] | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);
  const columnLayoutRef = useRef<Record<string, { y: number; height: number }>>({});
  // Alto/posición REAL de cada tarjeta (relativa a SU columna, ver handleCardLayout) — a
  // diferencia de columnLayoutRef (solo 3 entradas, una por columna), esta se actualiza a menudo
  // mientras las tarjetas se reflowan en vivo durante el arrastre.
  const cardLayoutRef = useRef<Record<string, { y: number; height: number }>>({});
  const dragStartRef = useRef<{ taskId: string; fromStatus: TaskStatus; startAbsY: number } | null>(null);

  const displayTasks = liveTasks ?? tasks;

  const handleColumnLayout = (status: TaskStatus, e: LayoutChangeEvent) => {
    columnLayoutRef.current[status] = { y: e.nativeEvent.layout.y, height: e.nativeEvent.layout.height };
  };

  const handleCardLayout = (taskId: string, e: LayoutChangeEvent) => {
    cardLayoutRef.current[taskId] = { y: e.nativeEvent.layout.y, height: e.nativeEvent.layout.height };
  };

  const handleDragStart = (task: LocalTask) => {
    const fromLayout = columnLayoutRef.current[task.status];
    const cardLayout = cardLayoutRef.current[task.id];
    // Fallback si por lo que sea esta tarjeta en concreto no llegó a medirse (no debería pasar:
    // para arrastrarla, el usuario ya la ha visto renderizada, así que su onLayout ya disparó) —
    // 0 sitúa el cálculo en la parte de arriba de la columna, mejor que romper el arrastre.
    const startAbsY = (fromLayout?.y ?? 0) + (cardLayout?.y ?? 0);
    dragStartRef.current = { taskId: task.id, fromStatus: task.status as TaskStatus, startAbsY };
    setDraggingTaskId(task.id);
    setLiveTasks(tasks);
  };

  const handleDragMove = (dy: number) => {
    const start = dragStartRef.current;
    if (!start) return;
    const currentAbsY = start.startAbsY + dy;

    const entries = Object.entries(columnLayoutRef.current) as [TaskStatus, { y: number; height: number }][];
    let targetStatus = start.fromStatus;
    let bestDistance = Infinity;
    for (const [status, layout] of entries) {
      if (currentAbsY >= layout.y && currentAbsY <= layout.y + layout.height) {
        targetStatus = status;
        bestDistance = 0;
        break;
      }
      const distance = currentAbsY < layout.y ? layout.y - currentAbsY : currentAbsY - (layout.y + layout.height);
      if (distance < bestDistance) {
        bestDistance = distance;
        targetStatus = status;
      }
    }

    // "Antes de qué tarjeta cae el dedo": la primera cuyo punto medio (Y absoluta REAL, no
    // estimada) queda por debajo de currentAbsY — si ninguna, se añade al final. Las tarjetas
    // sin medir todavía (añadidas justo ahora, onLayout aún no disparado) se ignoran en vez de
    // romper el cálculo.
    const targetLayout = columnLayoutRef.current[targetStatus];
    const withoutDragged = (liveTasks ?? tasks).filter((t) => t.status === targetStatus && t.id !== start.taskId);
    let beforeTaskId: string | null = null;
    for (const t of withoutDragged) {
      const layout = cardLayoutRef.current[t.id];
      if (!layout) continue;
      const cardMidAbsY = (targetLayout?.y ?? 0) + layout.y + layout.height / 2;
      if (cardMidAbsY > currentAbsY) {
        beforeTaskId = t.id;
        break;
      }
    }

    setDragOverStatus(targetStatus);
    // Vista previa: quita la tarea de donde estaba y la reinserta en la posición calculada —
    // sobre `tasks` (el original, sin tocar por el arrastre en curso), igual criterio que
    // reorderKanbanColumns en PaginaDetailScreen.tsx: recalcular siempre desde el estado
    // inalterado evita que un cálculo intermedio se pierda al buscar la tarea en un sitio donde
    // ya no está.
    const without = tasks.filter((t) => t.id !== start.taskId);
    const draggedTask = tasks.find((t) => t.id === start.taskId);
    if (!draggedTask) return;
    const updatedTask = { ...draggedTask, status: targetStatus };
    const targetColumnTasks = without.filter((t) => t.status === targetStatus);
    const otherTasks = without.filter((t) => t.status !== targetStatus);
    const insertAt = beforeTaskId ? targetColumnTasks.findIndex((t) => t.id === beforeTaskId) : -1;
    const insertIndex = insertAt === -1 ? targetColumnTasks.length : insertAt;
    targetColumnTasks.splice(insertIndex, 0, updatedTask);
    setLiveTasks([...otherTasks, ...targetColumnTasks]);
  };

  const handleDragEnd = async () => {
    setDraggingTaskId(null);
    setDragOverStatus(null);
    const start = dragStartRef.current;
    dragStartRef.current = null;
    const finalTasks = liveTasks;
    setLiveTasks(null);
    if (!start || !finalTasks) return;
    const finalTask = finalTasks.find((t) => t.id === start.taskId);
    if (!finalTask) return;
    const columnTasks = finalTasks.filter((t) => t.status === finalTask.status);
    const index = columnTasks.findIndex((t) => t.id === start.taskId);
    const beforeTaskId = columnTasks[index + 1]?.id ?? null;
    await onMoveTask(start.taskId, finalTask.status as TaskStatus, beforeTaskId);
  };

  // El gesto se interrumpió (el ScrollView u otro responder se lo llevó a media faena, ver
  // onPanResponderTerminationRequest en DraggableTaskCard) — a diferencia de soltar de verdad
  // (handleDragEnd), aquí NO se confirma nada: se descarta la vista previa en vivo y se vuelve
  // a `tasks` tal cual estaba, mismo criterio que "cancelar". Sin esto, una interrupción movía la
  // tarea igual, a donde fuera que estuviera la vista previa en ese instante — no donde el
  // usuario quería soltarla.
  const handleDragCancel = () => {
    setDraggingTaskId(null);
    setDragOverStatus(null);
    dragStartRef.current = null;
    setLiveTasks(null);
  };

  return (
    <View style={styles.kanbanContainer}>
      {statuses.map((status) => {
        const columnTasks = displayTasks.filter((t) => t.status === status);
        return (
          <View
            key={status}
            style={[
              styles.kanbanColumn,
              { backgroundColor: COLUMN_BG_COLORS[status], borderColor: COLUMN_BORDER_COLORS[status] },
              dragOverStatus === status && styles.kanbanColumnDragOver,
            ]}
            onLayout={(e) => handleColumnLayout(status, e)}
          >
            <Text style={styles.columnHeader}>{COLUMN_HEADERS[status]}</Text>
            <Text style={styles.columnCount}>{columnTasks.length}</Text>

            {columnTasks.length === 0 ? (
              <Text style={styles.emptyText}>Sin tareas</Text>
            ) : (
              columnTasks.map((task) => (
                <DraggableTaskCard
                  key={task.id}
                  task={task}
                  isDragging={draggingTaskId === task.id}
                  onPress={() => onOpenTask(task)}
                  onLayout={(e) => handleCardLayout(task.id, e)}
                  onDragStart={() => handleDragStart(task)}
                  onDragMove={handleDragMove}
                  onDragEnd={handleDragEnd}
                  onDragCancel={handleDragCancel}
                />
              ))
            )}

            <View style={styles.quickAddRow}>
              <TextInput
                style={styles.quickAddInput}
                placeholder="Nueva tarea…"
                value={drafts[status]}
                onChangeText={(t) => onDraftChange(status, t)}
                onSubmitEditing={() => onQuickAdd(status)}
                placeholderTextColor={colors.mutedForeground}
              />
              <Pressable style={styles.addButton} onPress={() => onQuickAdd(status)}>
                <Text style={styles.addButtonText}>+</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// Tarjeta con mango de arrastre — mismo patrón que DraggableNavRow en AppSidebar.tsx y
// DraggableKanbanCard en PaginaDetailScreen.tsx.
function DraggableTaskCard({
  task,
  isDragging,
  onPress,
  onLayout,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
}: {
  task: LocalTask;
  isDragging: boolean;
  onPress: () => void;
  onLayout: (e: LayoutChangeEvent) => void;
  onDragStart: () => void;
  onDragMove: (dy: number) => void;
  onDragEnd: () => void;
  onDragCancel: () => void;
}) {
  const dragY = useRef(new Animated.Value(0)).current;
  const callbacksRef = useRef({ onDragStart, onDragMove, onDragEnd, onDragCancel });
  callbacksRef.current = { onDragStart, onDragMove, onDragEnd, onDragCancel };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Sin esto, el ScrollView que envuelve el tablero puede robarle el gesto al mango de
      // arrastre a media faena (típico conflicto de PanResponder anidado en un ScrollView
      // vertical) — decirle al sistema que NO ceda el responder reduce buena parte de esos
      // casos. Si aun así se interrumpiera (el propio SO puede forzarlo), onPanResponderTerminate
      // descarta el cambio en vez de confirmarlo (ver onDragCancel/handleDragCancel).
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        dragY.setValue(0);
        callbacksRef.current.onDragStart();
      },
      onPanResponderMove: (_evt: GestureResponderEvent, gesture: PanResponderGestureState) => {
        dragY.setValue(gesture.dy);
        callbacksRef.current.onDragMove(gesture.dy);
      },
      onPanResponderRelease: () => {
        dragY.setValue(0);
        callbacksRef.current.onDragEnd();
      },
      onPanResponderTerminate: () => {
        dragY.setValue(0);
        callbacksRef.current.onDragCancel();
      },
    })
  ).current;

  const badge = dueBadge(task.dueDate, task.status === "done");

  return (
    <Animated.View
      onLayout={onLayout}
      style={isDragging ? { transform: [{ translateY: dragY }], zIndex: 50, elevation: 8, opacity: 0.94 } : undefined}
    >
      <Pressable style={styles.taskCard} onPress={onPress}>
        {task.image ? <Image source={{ uri: task.image }} style={styles.taskCardImage} /> : null}
        <View style={[styles.priorityDot, { backgroundColor: priorityStyle(task.priority).text }]} />
        <View style={styles.taskCardContent}>
          <Text style={[styles.taskTitle, task.status === "done" && styles.taskTitleDone]}>{task.title}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {badge && (
              <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                <Text style={[styles.badgeText, { color: badge.text }]}>{badge.label}</Text>
              </View>
            )}
            {task.notes ? <Text style={styles.taskNotesIndicator}>📝</Text> : null}
          </View>
        </View>
        {(task.synced === 0 || task.pendingOp === "update") && <Text style={styles.pendingTag}>pendiente</Text>}
        <View {...panResponder.panHandlers} hitSlop={8} style={styles.kanbanCardDragHandle}>
          <Text style={styles.kanbanCardDragHandleIcon}>⠿</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

/** Un tablero completo (título propio + su Kanban de 3 columnas) del modo Apilado — puerto de
 * PlannerBoard en dashboard/src/pages/PlanificadorPage.tsx, simplificado como ScheduleTableCard en
 * HorarioScreen.tsx: carga y guarda sus propias tareas (no las del `tasks` de la vista Flechas de
 * arriba), porque en Apilado hay varios tableros visibles a la vez. Sin el Flechas/Apilado de
 * columnas ni el modo Lista — siempre las 3 columnas, siempre Kanban, para no duplicar una segunda
 * capa de paginación dentro de cada tablero ya apilado. Tocar una tarjeta abre el modal de edición
 * compartido de PlanificadorScreen (`onOpenTask`), no uno propio. Ahora con arrastrar-y-soltar
 * (ver TaskKanbanColumns), igual que la vista de un único tablero. */
function PlannerBoardCard({
  planner,
  refreshToken,
  canMoveUp,
  canMoveDown,
  onOpenTask,
  onSync,
  onRename,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  planner: Planner;
  refreshToken: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onOpenTask: (task: LocalTask) => void;
  onSync: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [tasks, setTasks] = useState<LocalTask[]>([]);
  const [drafts, setDrafts] = useState<Record<TaskStatus, string>>({ todo: "", in_progress: "", done: "" });
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(planner.name);

  const reload = useCallback(async () => {
    setTasks(await listTasksByPlanner(planner.id));
  }, [planner.id]);

  useEffect(() => {
    reload();
  }, [reload, refreshToken]);

  useEffect(() => {
    setNameDraft(planner.name);
  }, [planner.name]);

  const handleQuickAdd = async (status: TaskStatus) => {
    const title = drafts[status].trim();
    if (!title) return;
    setDrafts((prev) => ({ ...prev, [status]: "" }));
    await createTaskLocal({ plannerId: planner.id, title, description: null, status, priority: "medium", dueDate: null, tags: [] });
    await reload();
    onSync();
  };

  const handleRename = () => {
    const trimmed = nameDraft.trim();
    setRenaming(false);
    if (!trimmed || trimmed === planner.name) {
      setNameDraft(planner.name);
      return;
    }
    onRename(trimmed);
  };

  return (
    <View>
      <View style={styles.stackedHeader}>
        {renaming ? (
          <TextInput
            style={styles.stackedNameInput}
            value={nameDraft}
            onChangeText={setNameDraft}
            onBlur={handleRename}
            onSubmitEditing={handleRename}
            autoFocus
          />
        ) : (
          <Pressable
            style={styles.stackedTitleButton}
            onPress={() => {
              setNameDraft(planner.name);
              setRenaming(true);
            }}
          >
            <Text style={styles.stackedTitle} numberOfLines={1}>
              {planner.name}
            </Text>
          </Pressable>
        )}
        <View style={styles.plannerToolbarActions}>
          <Pressable onPress={onMoveUp} disabled={!canMoveUp}>
            <Text style={[styles.plannerToolbarAction, !canMoveUp && styles.plannerNavArrowDisabled]}>↑</Text>
          </Pressable>
          <Pressable onPress={onMoveDown} disabled={!canMoveDown}>
            <Text style={[styles.plannerToolbarAction, !canMoveDown && styles.plannerNavArrowDisabled]}>↓</Text>
          </Pressable>
          <Pressable onPress={onDelete}>
            <Text style={[styles.plannerToolbarAction, styles.plannerToolbarDelete]}>Eliminar tablero</Text>
          </Pressable>
        </View>
      </View>

      <TaskKanbanColumns
        statuses={TASK_STATUSES}
        tasks={tasks}
        drafts={drafts}
        onDraftChange={(status, t) => setDrafts((prev) => ({ ...prev, [status]: t }))}
        onQuickAdd={handleQuickAdd}
        onOpenTask={onOpenTask}
        onMoveTask={async (taskId, status, beforeTaskId) => {
          await moveTask(taskId, status, beforeTaskId);
          await reload();
          onSync();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, paddingBottom: 8 },
  title: { fontFamily: fonts.serif, fontSize: 30, color: colors.foreground },
  newButton: { backgroundColor: colors.foreground, borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 8 },
  newButtonText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.background },

  // Flechas/Apilado de TABLEROS — rounded-full border border-border p-1 de la web, mismo estilo
  // que HorarioScreen.tsx.
  viewModeRow: { paddingHorizontal: 20, paddingBottom: 8 },
  viewModePill: {
    flexDirection: "row",
    alignSelf: "flex-start",
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
    gap: 2,
  },
  viewModeButton: { borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 6 },
  viewModeButtonActive: { backgroundColor: colors.primary },
  viewModeButtonText: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.mutedForeground },
  viewModeButtonTextActive: { color: colors.primaryForeground },

  // NAVEGACIÓN DE TABLEROS (modo Flechas) — mismas medidas que `nav`/`toolbar` de HorarioScreen.tsx.
  plannerNav: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: 20 },
  plannerNavArrow: { fontFamily: fonts.sansBold, fontSize: 24, color: colors.mutedForeground },
  plannerNavArrowDisabled: { opacity: 0.3 },
  plannerNavTitle: { fontFamily: fonts.serif, fontSize: 24, color: colors.foreground, textAlign: "center" },
  plannerNameButton: { flex: 1, alignItems: "center" },
  plannerNameInput: {
    flex: 1,
    fontFamily: fonts.serif,
    fontSize: 24,
    color: colors.foreground,
    textAlign: "center",
    borderBottomWidth: 1,
    borderBottomColor: colors.primary,
    paddingVertical: 2,
  },
  plannerToolbar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 10 },
  plannerToolbarHint: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground },
  plannerToolbarActions: { flexDirection: "row", alignItems: "center", gap: 16 },
  plannerToolbarAction: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.mutedForeground },
  plannerToolbarDelete: { color: colors.destructive },

  // APILADO DE TABLEROS
  stackedList: { gap: 28 },
  stackedHeader: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 10, paddingBottom: 8 },
  stackedTitleButton: { flexShrink: 1, minWidth: 0 },
  stackedTitle: { fontFamily: fonts.serif, fontSize: 22, color: colors.foreground },
  stackedNameInput: {
    flex: 1,
    minWidth: 120,
    fontFamily: fonts.serif,
    fontSize: 22,
    color: colors.foreground,
    borderBottomWidth: 1,
    borderBottomColor: colors.primary,
    paddingVertical: 2,
  },

  // CONTROL BAR (Kanban/Lista + columnas Flechas/Apilado, dentro de UN tablero)
  controlBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
  },
  viewToggle: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    overflow: "hidden",
  },
  viewToggleButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.background,
  },
  viewToggleButtonActive: {
    backgroundColor: colors.foreground,
  },
  viewToggleText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: colors.mutedForeground,
    fontWeight: "600",
  },
  viewToggleTextActive: {
    color: colors.background,
  },
  // Antes `boardToggle*` — renombrado para no colisionar en significado con el nuevo selector de
  // TABLEROS (`viewModePill`/`plannerViewMode` de arriba): esto solo alterna las COLUMNAS.
  columnToggle: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    overflow: "hidden",
  },
  columnToggleButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.background,
  },
  columnToggleButtonActive: {
    backgroundColor: colors.primary,
  },
  columnToggleText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: colors.mutedForeground,
    fontWeight: "600",
  },
  columnToggleTextActive: {
    color: colors.primaryForeground,
  },

  // NAVIGATION BAR (flechas de columnas)
  navigationBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  navButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
  },
  navButtonDisabled: {
    opacity: 0.3,
  },
  navButtonText: {
    fontFamily: fonts.sansBold,
    fontSize: 18,
    color: colors.foreground,
  },
  navLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.mutedForeground,
    flex: 1,
    textAlign: "center",
  },

  // SYNC BAR
  syncBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  syncText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.mutedForeground,
  },
  errorBanner: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.destructive,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },

  // CONTENT
  content: { padding: 16, paddingBottom: 32, gap: 16 },

  // KANBAN VIEW
  kanbanContainer: { gap: 16 },
  kanbanColumn: {
    borderRadius: radius.card,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
  },
  // Resalta la columna sobre la que está ahora mismo el dedo mientras se arrastra una tarea (ver
  // dragOverStatus en TaskKanbanColumns) — mismo criterio que kanbanColumnDragOver en
  // PaginaDetailScreen.tsx.
  kanbanColumnDragOver: { borderColor: colors.primary, borderWidth: 2 },
  columnHeader: {
    fontFamily: fonts.sansBold,
    fontSize: 13,
    color: colors.foreground,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  columnCount: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.mutedForeground,
  },
  taskCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    ...shadow,
  },
  priorityDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  taskCardImage: { width: 36, height: 36, borderRadius: radius.input, flexShrink: 0 },
  taskNotesIndicator: { fontSize: 11 },
  taskCardContent: { flex: 1, gap: 4 },
  taskTitle: { fontFamily: fonts.sans, fontSize: 13, color: colors.foreground },
  taskTitleDone: { textDecorationLine: "line-through", color: colors.mutedForeground },
  badge: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.full },
  badgeText: { fontFamily: fonts.sansMedium, fontSize: 10 },
  pendingTag: { fontFamily: fonts.sansMedium, fontSize: 9, color: colors.warning },
  kanbanCardDragHandle: { paddingHorizontal: 4, paddingVertical: 2 },
  kanbanCardDragHandleIcon: { fontSize: 16, color: colors.mutedForeground },

  // LIST VIEW
  listContainer: { gap: 16 },
  listSection: { gap: 8 },
  listSectionHeader: {
    fontFamily: fonts.sansBold,
    fontSize: 11,
    color: colors.mutedForeground,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: 4,
  },
  listTaskRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    ...shadow,
  },
  listPriorityDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  listTaskInfo: { flex: 1, gap: 4 },
  listTaskTitle: { fontFamily: fonts.sans, fontSize: 13, color: colors.foreground },

  // QUICK ADD
  quickAddRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  quickAddInput: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.foreground,
  },
  addButton: {
    width: 40,
    backgroundColor: colors.primary,
    borderRadius: radius.input,
    alignItems: "center",
    justifyContent: "center",
  },
  addButtonText: { color: colors.primaryForeground, fontSize: 20, fontFamily: fonts.sansBold },

  // MODAL
  modalBackdrop: { flex: 1, backgroundColor: "rgba(45,41,38,0.4)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    padding: 20,
    maxHeight: "88%",
  },
  modalTitle: { fontFamily: fonts.serif, fontSize: 24, color: colors.foreground, marginBottom: 16 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.input,
    padding: 12,
    marginBottom: 12,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.foreground,
    backgroundColor: colors.card,
  },
  inputMultiline: { minHeight: 60, textAlignVertical: "top" },
  taskFormImage: { width: "100%", height: 160, borderRadius: radius.input, marginBottom: 8 },
  taskImageActions: { flexDirection: "row", gap: 16, marginBottom: 12 },
  taskImageActionText: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.mutedForeground },
  taskImageActionRemove: { color: colors.destructive },
  timeLogRow: { marginBottom: 12, gap: 6 },
  timeLogTotal: { fontFamily: fonts.sans, fontSize: 13, color: colors.foreground },
  timeLogInputRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  timeLogInput: { flex: 1, marginBottom: 0 },
  fieldLabel: {
    fontFamily: fonts.sansBold,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: colors.mutedForeground,
    marginBottom: 8,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.primaryTint, borderColor: colors.primary },
  chipText: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground },
  chipTextSelected: { fontFamily: fonts.sansMedium, color: colors.primary, fontWeight: "600" },
  dateRow: { flexDirection: "row", gap: 8, marginBottom: 12, alignItems: "center" },
  dateButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.input,
    padding: 12,
    backgroundColor: colors.card,
    alignItems: "center",
  },
  dateButtonText: { fontFamily: fonts.sans, fontSize: 13, color: colors.foreground },
  clearDateButton: { padding: 8 },
  clearDateButtonText: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.destructive, fontWeight: "600" },
  subtaskRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8 },
  subtaskCheckRow: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  subtaskTitle: { fontFamily: fonts.sans, fontSize: 13, color: colors.foreground, flexShrink: 1 },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkboxMark: { color: colors.primaryForeground, fontSize: 11, fontFamily: fonts.sansBold },
  deleteText: { fontFamily: fonts.sansMedium, fontSize: 11, color: colors.destructive, fontWeight: "600" },
  emptyText: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground, fontStyle: "italic", textAlign: "center", paddingVertical: 8 },
  saveButton: { backgroundColor: colors.primary, borderRadius: radius.full, padding: 14, alignItems: "center", marginTop: 12 },
  saveButtonText: { fontFamily: fonts.sansMedium, color: colors.primaryForeground, fontSize: 14, fontWeight: "600" },
  deleteButton: { alignItems: "center", padding: 12 },
  deleteButtonText: { fontFamily: fonts.sansMedium, color: colors.destructive, fontSize: 13, fontWeight: "600" },
  cancelButton: { alignItems: "center", padding: 10 },
  cancelButtonText: { fontFamily: fonts.sans, color: colors.mutedForeground, fontSize: 13 },

  // PROPIEDADES PERSONALIZADAS (Planificador) — mismo criterio en tono/color que syncError/
  // errorBanner del resto de la pantalla, pero sin fondo de banner (es una nota dentro del modal,
  // no un aviso sobre toda la pantalla).
  customFieldsHint: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground, fontStyle: "italic", marginBottom: 12 },
  customFieldBlock: { marginBottom: 12 },
  // Cabecera de cada propiedad: nombre (tocable para renombrar, igual patrón que
  // stackedTitleButton/stackedNameInput de PlannerBoardCard) + mover arriba/abajo/borrar, mismos
  // estilos plannerToolbarAction/plannerToolbarDelete/plannerNavArrowDisabled que ese toolbar.
  customFieldHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 4 },
  customFieldLabelButton: { flexShrink: 1, minWidth: 0 },
  customFieldLabel: {
    fontFamily: fonts.sansBold,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: colors.mutedForeground,
  },
  customFieldNameInput: {
    flexShrink: 1,
    minWidth: 0,
    fontFamily: fonts.sansBold,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: colors.foreground,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 2,
  },
  customFieldActions: { flexDirection: "row", alignItems: "center", gap: 12 },
  customFieldAction: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.mutedForeground },
  addFieldForm: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    borderRadius: radius.input,
    padding: 10,
    marginBottom: 12,
  },
  addFieldActions: { flexDirection: "row", alignItems: "center", gap: 16 },
  addCustomFieldText: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.mutedForeground, marginBottom: 12 },
  saveButtonSmall: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 8, alignSelf: "flex-start" },
  saveButtonSmallText: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.primaryForeground },
});
