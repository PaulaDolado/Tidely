import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Modal, ActivityIndicator, Image, Alert, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import DateTimePicker, { DateTimePickerChangeEvent } from "@react-native-community/datetimepicker";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ApiError } from "../api/client";
import {
  AgendaContent,
  AgendaNote,
  ChecklistContent,
  ChecklistItem,
  CustomPage,
  deleteCustomPage,
  FinanceContent,
  FinanceEntry,
  GalleryContent,
  GalleryEntry,
  getCustomPage,
  GoalsContent,
  KanbanCard,
  KanbanColumn,
  KanbanContent,
  NotaContent,
  SimpleGoal,
  TEMPLATE_LABELS,
  updateCustomPage,
} from "../api/customPages";
import { htmlToPlainText, plainTextToHtml } from "../utils/htmlText";
import { colors, fonts, radius, shadow } from "../theme";
import { PaginasStackParamList } from "./PaginasScreen";

// Detalle de una página personalizada — puerto de dashboard/src/pages/CustomPagePage.tsx. Título/
// subtítulo se editan igual para cualquier plantilla (PUT /custom-pages/:id); las 8 plantillas ya
// tienen editor propio ("hoy" reutiliza el mismo componente que "proyectos", igual que en la
// propia web — mismo tipo ChecklistContent). Simplificación deliberada
// frente a la web: guardado explícito con un botón (o al perder el foco de un campo) en vez de
// autoguardado a los 600ms de cada pulsación, mismo criterio que el resto de editores del móvil
// (ver ProyectoDetailScreen.tsx) — salvo las acciones discretas (añadir/marcar/mover/borrar de
// kanban, galería, finanzas, checklist, objetivos), que guardan de inmediato como ya hacía kanban/
// galería, no al perder el foco de un campo de texto libre. "Nota" se edita como texto plano, no
// con el editor enriquecido de la web (ver utils/htmlText.ts): no hay ninguna librería de rich
// text en package.json. "Kanban" no tiene ni imagen por tarjeta ni gestión de propiedades
// personalizadas (`fieldDefs`/`fields`) — se preservan tal cual si ya existían (creadas desde la
// web) pero no se pueden crear/editar desde aquí; mover una tarjeta es tocarla y elegir columna en
// el diálogo, no arrastrar (no hay gesture-handler/reanimated instalado). "Finanzas"/"Objetivos"
// (plantilla) son independientes de las secciones Finanzas/Objetivos de la app: solo tocan el
// `content` JSON de esta página, no Transaction/Goal reales.

const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // igual límite que CustomPagePage.tsx (MAX_IMAGE_BYTES)

type Props = NativeStackScreenProps<PaginasStackParamList, "Detalle">;

export function PaginaDetailScreen({ route, navigation }: Props) {
  const { id } = route.params;
  const [page, setPage] = useState<CustomPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [editingEntry, setEditingEntry] = useState<GalleryEntry | null>(null);
  const [notaText, setNotaText] = useState("");
  const [notaDirty, setNotaDirty] = useState(false);
  const [savingNota, setSavingNota] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await getCustomPage(id);
      setPage(loaded);
      setTitle(loaded.title);
      setSubtitle(loaded.subtitle ?? "");
      if (loaded.template === "nota") {
        setNotaText(htmlToPlainText((loaded.content as NotaContent).html ?? ""));
        setNotaDirty(false);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar la página");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    reload();
  }, [reload]);

  const galleryItems: GalleryEntry[] = page?.template === "galeria" ? ((page.content as GalleryContent).items ?? []) : [];
  // Masonry de verdad (no un reparto por índice par/impar): cada entrada va a la columna más baja
  // hasta ahora, acumulando la altura de marco que le toca por id (ver frameHeightFor) — mismo
  // efecto "pared de marcos" que el `columns-2 ... columns-4` de la web, sin depender del propio
  // motor de columnas CSS (que RN no tiene). 2 columnas fijas: la web ya sube a 3-4 en pantallas
  // más anchas que un teléfono, así que 2 es lo que le corresponde aquí.
  const galleryColumns = useMemo(() => distributeIntoColumns(galleryItems, 2), [galleryItems]);

  const saveTitleAndSubtitle = async () => {
    if (!page) return;
    if (title.trim() === page.title && subtitle === (page.subtitle ?? "")) return;
    const updated = await updateCustomPage(id, { title: title.trim() || page.title, subtitle: subtitle.trim() || null });
    setPage(updated);
    navigation.setParams({ title: updated.title });
  };

  const saveGalleryItems = async (items: GalleryEntry[]) => {
    if (!page) return;
    const updated = await updateCustomPage(id, { content: { items } });
    setPage(updated);
  };

  const saveNota = async () => {
    if (!page) return;
    setSavingNota(true);
    try {
      const html = plainTextToHtml(notaText);
      const updated = await updateCustomPage(id, { content: { html } });
      setPage(updated);
      setNotaDirty(false);
    } finally {
      setSavingNota(false);
    }
  };

  // Kanban guarda de inmediato en cada acción (añadir/mover/borrar tarjeta o columna), como la
  // galería — solo el texto/descripción/notas DENTRO del diálogo de una tarjeta esperan a "Guardar"
  // (ver KanbanCardForm). `content` completo, no un patch: el PUT sustituye el JSON entero (ver
  // src/services/customPagesService.ts), así que hay que mandar siempre columns+fieldDefs juntos
  // para no perder fieldDefs/fields que ya existieran desde la web.
  const saveKanbanContent = async (content: KanbanContent) => {
    if (!page) return;
    const updated = await updateCustomPage(id, { content });
    setPage(updated);
  };

  // Mismo criterio que saveKanbanContent/saveGalleryItems: guardado inmediato en cada acción
  // (añadir/marcar/borrar movimiento, tarea u objetivo), no un botón "Guardar" aparte.
  const saveFinanceEntries = async (entries: FinanceEntry[]) => {
    if (!page) return;
    const updated = await updateCustomPage(id, { content: { entries } });
    setPage(updated);
  };

  const saveChecklistItems = async (items: ChecklistItem[]) => {
    if (!page) return;
    const updated = await updateCustomPage(id, { content: { items } });
    setPage(updated);
  };

  const saveGoals = async (goals: SimpleGoal[]) => {
    if (!page) return;
    const updated = await updateCustomPage(id, { content: { goals } });
    setPage(updated);
  };

  const saveAgendaItems = async (items: AgendaNote[]) => {
    if (!page) return;
    const updated = await updateCustomPage(id, { content: { items } });
    setPage(updated);
  };

  const handleAddEntry = async () => {
    const entry: GalleryEntry = { id: Crypto.randomUUID() };
    await saveGalleryItems([entry, ...galleryItems]);
    setEditingEntry(entry);
  };

  const handleSaveEntry = async (entry: GalleryEntry) => {
    const next = galleryItems.map((e) => (e.id === entry.id ? entry : e));
    await saveGalleryItems(next);
    setEditingEntry(null);
  };

  const handleRemoveEntry = async (entryId: string) => {
    await saveGalleryItems(galleryItems.filter((e) => e.id !== entryId));
    setEditingEntry(null);
  };

  // Mismo patrón que "Eliminar página" en dashboard/src/pages/CustomPagePage.tsx:56-199
  // (`confirmingDelete`) — el propio botón pide confirmar cambiando su texto/color en vez de un
  // diálogo aparte; sin blur en táctil para cancelarlo solo, así que se cancela solo a los 3s
  // (ver el efecto de abajo) si no se toca una segunda vez.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (!confirmingDelete) return;
    const timer = setTimeout(() => setConfirmingDelete(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmingDelete]);

  const handleDeletePage = async () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    await deleteCustomPage(id);
    navigation.goBack();
  };

  if (loading && !page) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  if (error && !page) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.errorBanner}>{error}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <TextInput style={styles.titleInput} value={title} onChangeText={setTitle} onBlur={saveTitleAndSubtitle} placeholder="Título" />
        <TextInput
          style={styles.subtitleInput}
          value={subtitle}
          onChangeText={setSubtitle}
          onBlur={saveTitleAndSubtitle}
          placeholder={page ? TEMPLATE_LABELS[page.template] : ""}
        />

        {page?.template === "galeria" ? (
          <>
            <Pressable style={styles.addButton} onPress={handleAddEntry}>
              <Text style={styles.addButtonText}>+ Nueva entrada</Text>
            </Pressable>
            {galleryItems.length === 0 ? (
              <Text style={styles.emptyText}>Todavía no hay nada en esta galería. Añade tu primera entrada.</Text>
            ) : (
              <View style={styles.masonry}>
                {galleryColumns.map((column, i) => (
                  <View key={i} style={styles.masonryColumn}>
                    {column.map((entry) => (
                      <GalleryTile key={entry.id} entry={entry} onPress={() => setEditingEntry(entry)} />
                    ))}
                  </View>
                ))}
              </View>
            )}
          </>
        ) : page?.template === "nota" ? (
          <>
            <TextInput
              style={styles.notaInput}
              value={notaText}
              onChangeText={(t) => {
                setNotaText(t);
                setNotaDirty(true);
              }}
              placeholder="Escribe aquí…"
              placeholderTextColor={colors.mutedForeground}
              multiline
              textAlignVertical="top"
            />
            <Pressable style={styles.saveContentButton} onPress={saveNota} disabled={savingNota || !notaDirty}>
              <Text style={styles.saveContentButtonText}>{savingNota ? "Guardando…" : notaDirty ? "Guardar" : "Guardado"}</Text>
            </Pressable>
          </>
        ) : page?.template === "kanban" ? (
          <KanbanBoard content={(page.content as KanbanContent) ?? { columns: [] }} onChange={saveKanbanContent} />
        ) : page?.template === "finanzas" ? (
          <FinanceTemplateEditor entries={(page.content as FinanceContent)?.entries ?? []} onChange={saveFinanceEntries} />
        ) : page?.template === "proyectos" ? (
          <ChecklistTemplateEditor
            items={(page.content as ChecklistContent)?.items ?? []}
            onChange={saveChecklistItems}
            emptyLabel="Añade tareas para seguir el progreso."
          />
        ) : page?.template === "objetivos" ? (
          <GoalsTemplateEditor goals={(page.content as GoalsContent)?.goals ?? []} onChange={saveGoals} />
        ) : page?.template === "agenda" ? (
          <AgendaNotesTemplateEditor items={(page.content as AgendaContent)?.items ?? []} onChange={saveAgendaItems} />
        ) : page?.template === "hoy" ? (
          <ChecklistTemplateEditor
            items={(page.content as ChecklistContent)?.items ?? []}
            onChange={saveChecklistItems}
            emptyLabel="Añade lo que tengas que hacer hoy."
          />
        ) : page ? (
          <View style={styles.fallbackCard}>
            <Text style={styles.fallbackText}>
              La plantilla "{TEMPLATE_LABELS[page.template]}" todavía no tiene editor en el móvil — ábrela desde el dashboard web para
              ver o cambiar su contenido. El título y el subtítulo sí se guardan desde aquí.
            </Text>
          </View>
        ) : null}

        <Pressable
          style={[styles.deletePageButton, confirmingDelete && styles.deletePageButtonConfirming]}
          onPress={handleDeletePage}
        >
          <Text style={[styles.deletePageText, confirmingDelete && styles.deletePageTextConfirming]}>
            {confirmingDelete ? "¿Confirmar eliminar?" : "Eliminar página"}
          </Text>
        </Pressable>
      </ScrollView>

      <Modal visible={editingEntry !== null} animationType="slide" transparent onRequestClose={() => setEditingEntry(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            {editingEntry && (
              <GalleryItemForm
                entry={editingEntry}
                onSave={handleSaveEntry}
                onRemove={() => handleRemoveEntry(editingEntry.id)}
                onClose={() => setEditingEntry(null)}
              />
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// Puerto exacto de dashboard/src/utils/galleryPalette.ts — mismo hash determinista por id (dos
// sufijos distintos para color y altura, "para que el color y la altura no varíen siempre a la
// vez") y los mismos 7 tonos del tema, traducidos a rgba porque RN no tiene el `bg-x/10` de
// Tailwind. Determinista por id (no por posición): el aspecto de una entrada no cambia al añadir
// o borrar otra.
const PLACEHOLDER_COLORS = [
  "rgba(95, 113, 97, 0.1)", // bg-primary/10
  "rgba(251, 146, 60, 0.15)", // bg-hobby/15
  "rgba(200, 123, 0, 0.1)", // bg-warning/10
  "rgba(95, 113, 97, 0.1)", // bg-positive/10 (positive = primary, mismo tono en la propia web)
  "rgba(51, 131, 173, 0.1)", // bg-habit/10
  "rgba(222, 208, 182, 0.5)", // bg-secondary/50
  "rgba(77, 63, 53, 0.1)", // bg-cover/10
];
// h-40, h-64, h-52, h-72, h-44, h-60, h-48, h-56 de Tailwind, en px.
const FRAME_HEIGHTS = [160, 256, 208, 288, 176, 240, 192, 224];

function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return hash;
}
function placeholderColorFor(id: string): string {
  return PLACEHOLDER_COLORS[hashString(`${id}-color`) % PLACEHOLDER_COLORS.length];
}
function frameHeightFor(id: string): number {
  return FRAME_HEIGHTS[hashString(`${id}-height`) % FRAME_HEIGHTS.length];
}

// Masonry real: cada entrada va a la columna con menos altura acumulada hasta ahora — mismo
// resultado visual que el `columns-*` de CSS (que reparte por columna más corta), calculado a
// mano porque RN no tiene un equivalente a `columns-*`.
const TILE_GAP = 10;
function distributeIntoColumns(items: GalleryEntry[], columnCount: number): GalleryEntry[][] {
  const columns: GalleryEntry[][] = Array.from({ length: columnCount }, () => []);
  const heights = new Array(columnCount).fill(0);
  for (const item of items) {
    const shortest = heights.indexOf(Math.min(...heights));
    columns[shortest].push(item);
    heights[shortest] += frameHeightFor(item.id) + TILE_GAP;
  }
  return columns;
}

function GalleryTile({ entry, onPress }: { entry: GalleryEntry; onPress: () => void }) {
  const height = frameHeightFor(entry.id);
  const hasText = Boolean(entry.title || entry.text);

  return (
    <Pressable style={[styles.tile, { height }]} onPress={onPress}>
      {entry.imageData ? (
        <>
          <Image source={{ uri: entry.imageData }} style={styles.tileImage} resizeMode="cover" />
          {/* Sin hover en táctil: el título va siempre visible sobre la foto (la web solo lo
              muestra al pasar el ratón por encima), no oculto detrás de un gesto que aquí no
              existe. Franja sólida semitransparente en vez del degradado de la web — RN no tiene
              gradientes CSS sin una librería aparte, y esto ya da suficiente contraste. */}
          {entry.title && (
            <View style={styles.tileImageCaption}>
              <Text numberOfLines={1} style={styles.tileImageCaptionText}>
                {entry.title}
              </Text>
            </View>
          )}
        </>
      ) : (
        // Título/texto DENTRO del bloque de color, no aparte debajo — mismo layout que
        // GalleryTile en la web (`flex size-full flex-col justify-end`).
        <View style={[styles.tilePlaceholder, { backgroundColor: placeholderColorFor(entry.id) }]}>
          {hasText ? (
            <>
              {entry.title ? (
                <Text numberOfLines={1} style={styles.tilePlaceholderTitle}>
                  {entry.title}
                </Text>
              ) : null}
              {entry.text ? (
                <Text numberOfLines={4} style={styles.tilePlaceholderText}>
                  {entry.text}
                </Text>
              ) : null}
            </>
          ) : (
            <Text style={styles.tilePlaceholderIcon}>🖼️</Text>
          )}
        </View>
      )}
    </Pressable>
  );
}

function GalleryItemForm({
  entry,
  onSave,
  onRemove,
  onClose,
}: {
  entry: GalleryEntry;
  onSave: (entry: GalleryEntry) => Promise<void>;
  onRemove: () => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(entry.title ?? "");
  const [text, setText] = useState(entry.text ?? "");
  const [imageData, setImageData] = useState<string | null | undefined>(entry.imageData);
  const [saving, setSaving] = useState(false);

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permiso necesario", "Activa el acceso a tus fotos para añadir una imagen.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], base64: true, quality: 0.7 });
    if (result.canceled || !result.assets[0]?.base64) return;
    const base64 = result.assets[0].base64;
    if (base64.length * 0.75 > MAX_IMAGE_BYTES) {
      Alert.alert("Imagen demasiado grande", "El límite es de 3 MB por imagen.");
      return;
    }
    setImageData(`data:image/jpeg;base64,${base64}`);
  };

  const submit = async () => {
    setSaving(true);
    await onSave({ ...entry, title: title.trim() || undefined, text: text.trim() || undefined, imageData });
    setSaving(false);
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <Text style={styles.modalTitle}>Entrada de galería</Text>

      {imageData ? (
        <View style={styles.imageWrapper}>
          <Image source={{ uri: imageData }} style={styles.imagePreview} resizeMode="cover" />
          {/* Mismo par de botones superpuestos que dashboard/src/pages/CustomPagePage.tsx
              (GalleryItemDialog: "Cambiar"/"Quitar" en la esquina) — antes solo había "Quitar
              imagen" como enlace debajo, sin nada equivalente a "Cambiar" (aunque tocar la propia
              imagen ya reabría el selector, no era visible que se pudiera). */}
          <View style={styles.imageOverlayActions}>
            <Pressable style={styles.imageOverlayButton} onPress={pickImage}>
              <Text style={styles.imageOverlayButtonText}>Cambiar</Text>
            </Pressable>
            <Pressable style={styles.imageOverlayButton} onPress={() => setImageData(null)}>
              <Text style={[styles.imageOverlayButtonText, styles.imageOverlayButtonTextDestructive]}>Quitar</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable style={styles.imagePicker} onPress={pickImage}>
          <Text style={styles.imagePickerIcon}>🖼️</Text>
          <Text style={styles.imagePickerText}>Añadir foto</Text>
        </Pressable>
      )}

      <TextInput style={styles.input} placeholder="Título (opcional)" value={title} onChangeText={setTitle} />
      <TextInput
        style={[styles.input, styles.inputMultiline]}
        placeholder="Texto (opcional)"
        value={text}
        onChangeText={setText}
        multiline
      />

      <Pressable style={styles.saveButton} onPress={submit} disabled={saving}>
        <Text style={styles.saveButtonText}>{saving ? "Guardando…" : "Guardar"}</Text>
      </Pressable>
      <Pressable style={styles.deleteButton} onPress={onRemove}>
        <Text style={styles.deleteButtonText}>Eliminar entrada</Text>
      </Pressable>
      <Pressable style={styles.cancelButton} onPress={onClose}>
        <Text style={styles.cancelButtonText}>Cerrar</Text>
      </Pressable>
    </ScrollView>
  );
}

// Mismos colores que el tablero del Planificador (ver COLUMN_STYLES/COLUMN_HEADER_STYLES en
// dashboard/src/pages/PlanificadorPage.tsx), ciclados por posición en vez de por un status fijo
// — igual criterio que KANBAN_COLUMN_STYLES en dashboard/src/pages/CustomPagePage.tsx: una página
// de kanban puede tener cualquier número de columnas con el nombre que el usuario quiera, así que
// no hay un "estado" al que atar cada color, solo su orden.
const KANBAN_COLUMN_STYLES: { box: { borderColor: string; backgroundColor: string }; header: string }[] = [
  { box: { borderColor: colors.border, backgroundColor: colors.card }, header: colors.foreground },
  { box: { borderColor: "rgba(200, 123, 0, 0.3)", backgroundColor: "rgba(200, 123, 0, 0.1)" }, header: colors.warning },
  { box: { borderColor: "rgba(95, 113, 97, 0.3)", backgroundColor: "rgba(95, 113, 97, 0.1)" }, header: colors.positive },
];

// Tablero kanban — puerto simplificado de la sección Kanban en dashboard/src/pages/
// CustomPagePage.tsx: columnas dinámicas con tarjetas, pero sin arrastrar (mover una tarjeta es
// abrirla y elegir columna en el diálogo, ver KanbanCardForm) y sin gestión de propiedades
// personalizadas (`fieldDefs`) — esas se preservan si ya existían, pero no se pueden crear/editar
// desde aquí.
function KanbanBoard({ content, onChange }: { content: KanbanContent; onChange: (next: KanbanContent) => Promise<void> }) {
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnTitle, setNewColumnTitle] = useState("");
  const [editingCard, setEditingCard] = useState<{ columnId: string; card: KanbanCard } | null>(null);

  const addColumn = async () => {
    const title = newColumnTitle.trim();
    if (!title) return;
    const column: KanbanColumn = { id: Crypto.randomUUID(), title, cards: [] };
    await onChange({ ...content, columns: [...content.columns, column] });
    setNewColumnTitle("");
    setAddingColumn(false);
  };

  // Sin confirmación de por medio, aunque tenga tarjetas — mismo criterio ya establecido en el
  // resto de borrados del móvil (Horario, calendario anual): un solo toque, sin el "¿Confirmar?"
  // de doble clic de la web, que depende de un hover que no existe en táctil.
  const deleteColumn = async (columnId: string) => {
    await onChange({ ...content, columns: content.columns.filter((c) => c.id !== columnId) });
  };

  const renameColumn = async (columnId: string, columnTitle: string) => {
    await onChange({ ...content, columns: content.columns.map((c) => (c.id === columnId ? { ...c, title: columnTitle } : c)) });
  };

  const addCard = async (columnId: string, text: string) => {
    const card: KanbanCard = { id: Crypto.randomUUID(), text };
    await onChange({
      ...content,
      columns: content.columns.map((c) => (c.id === columnId ? { ...c, cards: [...c.cards, card] } : c)),
    });
  };

  const updateCard = async (columnId: string, cardId: string, patch: Partial<KanbanCard>) => {
    await onChange({
      ...content,
      columns: content.columns.map((c) =>
        c.id !== columnId ? c : { ...c, cards: c.cards.map((card) => (card.id === cardId ? { ...card, ...patch } : card)) }
      ),
    });
  };

  const removeCard = async (columnId: string, cardId: string) => {
    await onChange({
      ...content,
      columns: content.columns.map((c) => (c.id === columnId ? { ...c, cards: c.cards.filter((card) => card.id !== cardId) } : c)),
    });
  };

  const moveCard = async (fromColumnId: string, cardId: string, toColumnId: string) => {
    if (fromColumnId === toColumnId) return;
    const fromColumn = content.columns.find((c) => c.id === fromColumnId);
    const card = fromColumn?.cards.find((c) => c.id === cardId);
    if (!card) return;
    await onChange({
      ...content,
      columns: content.columns.map((c) => {
        if (c.id === fromColumnId) return { ...c, cards: c.cards.filter((cc) => cc.id !== cardId) };
        if (c.id === toColumnId) return { ...c, cards: [...c.cards, card] };
        return c;
      }),
    });
  };

  return (
    <View style={{ gap: 16 }}>
      {content.columns.length === 0 && <Text style={styles.emptyText}>Sin columnas todavía.</Text>}

      {content.columns.map((column, index) => (
        <KanbanColumnView
          key={column.id}
          column={column}
          tone={KANBAN_COLUMN_STYLES[index % KANBAN_COLUMN_STYLES.length]}
          onRename={(t) => renameColumn(column.id, t)}
          onDelete={() => deleteColumn(column.id)}
          onAddCard={(text) => addCard(column.id, text)}
          onOpenCard={(card) => setEditingCard({ columnId: column.id, card })}
        />
      ))}

      {addingColumn ? (
        <View style={styles.addColumnForm}>
          <TextInput
            autoFocus
            style={styles.input}
            placeholder="Nombre de la columna"
            value={newColumnTitle}
            onChangeText={setNewColumnTitle}
            onSubmitEditing={addColumn}
          />
          <View style={styles.addColumnActions}>
            <Pressable style={styles.saveButtonSmall} onPress={addColumn}>
              <Text style={styles.saveButtonSmallText}>Añadir</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setAddingColumn(false);
                setNewColumnTitle("");
              }}
            >
              <Text style={styles.cancelButtonText}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable style={styles.addColumnButton} onPress={() => setAddingColumn(true)}>
          <Text style={styles.addColumnButtonText}>+ Columna</Text>
        </Pressable>
      )}

      <Modal visible={editingCard !== null} animationType="slide" transparent onRequestClose={() => setEditingCard(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            {editingCard && (
              <KanbanCardForm
                card={editingCard.card}
                columns={content.columns}
                currentColumnId={editingCard.columnId}
                onSave={async (patch) => {
                  await updateCard(editingCard.columnId, editingCard.card.id, patch);
                  setEditingCard(null);
                }}
                onMove={async (toColumnId) => {
                  await moveCard(editingCard.columnId, editingCard.card.id, toColumnId);
                  setEditingCard(null);
                }}
                onDelete={async () => {
                  await removeCard(editingCard.columnId, editingCard.card.id);
                  setEditingCard(null);
                }}
                onClose={() => setEditingCard(null)}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function KanbanColumnView({
  column,
  tone,
  onRename,
  onDelete,
  onAddCard,
  onOpenCard,
}: {
  column: KanbanColumn;
  tone: { box: { borderColor: string; backgroundColor: string }; header: string };
  onRename: (title: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onAddCard: (text: string) => Promise<void>;
  onOpenCard: (card: KanbanCard) => void;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(column.title);
  const [addingCard, setAddingCard] = useState(false);
  const [cardDraft, setCardDraft] = useState("");

  const commitTitle = () => {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== column.title) onRename(trimmed);
    else setTitleDraft(column.title);
  };

  const submitCard = () => {
    const text = cardDraft.trim();
    if (!text) return;
    onAddCard(text);
    setCardDraft("");
    setAddingCard(false);
  };

  return (
    <View style={[styles.kanbanColumn, tone.box]}>
      <View style={styles.kanbanColumnHeader}>
        {editingTitle ? (
          <TextInput
            autoFocus
            style={[styles.kanbanColumnTitleInput, { color: tone.header }]}
            value={titleDraft}
            onChangeText={setTitleDraft}
            onBlur={commitTitle}
            onSubmitEditing={commitTitle}
          />
        ) : (
          <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => setEditingTitle(true)}>
            <Text numberOfLines={1} style={[styles.kanbanColumnTitle, { color: tone.header }]}>
              {column.title}
            </Text>
          </Pressable>
        )}
        <Text style={styles.kanbanColumnCount}>{column.cards.length}</Text>
        <Pressable onPress={onDelete} hitSlop={8}>
          <Text style={styles.kanbanColumnDelete}>✕</Text>
        </Pressable>
      </View>

      {column.cards.map((card) => (
        <Pressable key={card.id} style={styles.kanbanCard} onPress={() => onOpenCard(card)}>
          <Text style={styles.kanbanCardText} numberOfLines={2}>
            {card.text}
          </Text>
          {card.description ? (
            <Text style={styles.kanbanCardDescription} numberOfLines={1}>
              {card.description}
            </Text>
          ) : null}
        </Pressable>
      ))}

      {addingCard ? (
        <View style={{ gap: 8 }}>
          <TextInput
            autoFocus
            style={styles.input}
            placeholder="Texto de la tarjeta"
            value={cardDraft}
            onChangeText={setCardDraft}
            onSubmitEditing={submitCard}
          />
          <View style={styles.addColumnActions}>
            <Pressable style={styles.saveButtonSmall} onPress={submitCard}>
              <Text style={styles.saveButtonSmallText}>Añadir</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setAddingCard(false);
                setCardDraft("");
              }}
            >
              <Text style={styles.cancelButtonText}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable onPress={() => setAddingCard(true)}>
          <Text style={styles.kanbanAddCardText}>+ Tarjeta</Text>
        </Pressable>
      )}
    </View>
  );
}

function KanbanCardForm({
  card,
  columns,
  currentColumnId,
  onSave,
  onMove,
  onDelete,
  onClose,
}: {
  card: KanbanCard;
  columns: KanbanColumn[];
  currentColumnId: string;
  onSave: (patch: Partial<KanbanCard>) => Promise<void>;
  onMove: (toColumnId: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState(card.text);
  const [description, setDescription] = useState(card.description ?? "");
  const [notes, setNotes] = useState(card.notes ?? "");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!text.trim()) return;
    setSaving(true);
    await onSave({ text: text.trim(), description: description.trim() || undefined, notes: notes.trim() || null });
    setSaving(false);
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <Text style={styles.modalTitle}>Tarjeta</Text>

      <TextInput style={styles.input} placeholder="Texto" value={text} onChangeText={setText} />
      <TextInput
        style={[styles.input, styles.inputMultiline]}
        placeholder="Descripción (opcional)"
        value={description}
        onChangeText={setDescription}
        multiline
      />
      <TextInput
        style={[styles.input, styles.inputMultiline]}
        placeholder="Notas (opcional)"
        value={notes}
        onChangeText={setNotes}
        multiline
      />

      {columns.length > 1 && (
        <>
          <Text style={styles.fieldLabel}>Mover a</Text>
          <View style={styles.chipRow}>
            {columns.map((col) => (
              <Pressable
                key={col.id}
                style={[styles.chip, col.id === currentColumnId && styles.chipSelected]}
                onPress={() => col.id !== currentColumnId && onMove(col.id)}
              >
                <Text style={[styles.chipText, col.id === currentColumnId && styles.chipTextSelected]}>{col.title}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}

      <Pressable style={styles.saveButton} onPress={submit} disabled={saving}>
        <Text style={styles.saveButtonText}>{saving ? "Guardando…" : "Guardar"}</Text>
      </Pressable>
      <Pressable style={styles.deleteButton} onPress={onDelete}>
        <Text style={styles.deleteButtonText}>Eliminar tarjeta</Text>
      </Pressable>
      <Pressable style={styles.cancelButton} onPress={onClose}>
        <Text style={styles.cancelButtonText}>Cerrar</Text>
      </Pressable>
    </ScrollView>
  );
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(amount);
}

// Puerto de FinanceTemplate en dashboard/src/pages/CustomPagePage.tsx — sin editar un movimiento
// ya creado (la web tampoco lo permite, solo añadir/borrar), formulario siempre visible en vez de
// detrás de un botón "+" (así en la web).
function FinanceTemplateEditor({ entries, onChange }: { entries: FinanceEntry[]; onChange: (entries: FinanceEntry[]) => Promise<void> }) {
  const [type, setType] = useState<"income" | "expense">("expense");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const balance = entries.reduce((sum, e) => sum + (e.type === "income" ? e.amount : -e.amount), 0);

  const add = async () => {
    const n = Number(amount);
    const trimmedCategory = category.trim();
    if (!Number.isFinite(n) || n <= 0 || !trimmedCategory) return;
    setSaving(true);
    await onChange([{ id: Crypto.randomUUID(), type, amount: n, category: trimmedCategory, description: description.trim() }, ...entries]);
    setAmount("");
    setCategory("");
    setDescription("");
    setSaving(false);
  };

  const remove = (entryId: string) => onChange(entries.filter((e) => e.id !== entryId));

  return (
    <View style={{ gap: 16 }}>
      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Balance</Text>
        <Text style={[styles.balanceValue, { color: balance >= 0 ? colors.positive : colors.destructive }]}>{formatMoney(balance)}</Text>
      </View>

      <View style={styles.formCard}>
        <View style={styles.chipRow}>
          <Pressable style={[styles.chip, type === "expense" && styles.chipSelected]} onPress={() => setType("expense")}>
            <Text style={[styles.chipText, type === "expense" && styles.chipTextSelected]}>Gasto</Text>
          </Pressable>
          <Pressable style={[styles.chip, type === "income" && styles.chipSelected]} onPress={() => setType("income")}>
            <Text style={[styles.chipText, type === "income" && styles.chipTextSelected]}>Ingreso</Text>
          </Pressable>
        </View>
        <TextInput style={styles.input} placeholder="Importe" value={amount} onChangeText={setAmount} keyboardType="numeric" />
        <TextInput style={styles.input} placeholder="Categoría" value={category} onChangeText={setCategory} />
        <TextInput style={styles.input} placeholder="Descripción (opcional)" value={description} onChangeText={setDescription} />
        <Pressable style={styles.saveButtonSmall} onPress={add} disabled={saving}>
          <Text style={styles.saveButtonSmallText}>{saving ? "Añadiendo…" : "+ Añadir"}</Text>
        </Pressable>
      </View>

      {entries.length === 0 ? (
        <Text style={styles.emptyText}>Todavía no has apuntado ningún movimiento.</Text>
      ) : (
        <View style={{ gap: 8 }}>
          {entries.map((entry) => (
            <View key={entry.id} style={styles.rowCard}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={styles.rowCardTitle}>
                  {entry.category}
                </Text>
                {entry.description ? (
                  <Text numberOfLines={1} style={styles.rowCardSubtitle}>
                    {entry.description}
                  </Text>
                ) : null}
              </View>
              <Text style={[styles.financeAmount, { color: entry.type === "income" ? colors.positive : colors.destructive }]}>
                {entry.type === "income" ? "+" : "-"}
                {formatMoney(entry.amount)}
              </Text>
              <Pressable onPress={() => remove(entry.id)} hitSlop={8}>
                <Text style={styles.rowCardDelete}>✕</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// Puerto de ChecklistTemplate en dashboard/src/pages/CustomPagePage.tsx — reutilizado por
// "proyectos" (y, si algún día se porta, "hoy": mismo tipo/componente en la propia web). Solo
// texto + hecho, sin fecha límite ni prioridad — eso es del Planificador real, no de esta
// plantilla suelta.
function ChecklistTemplateEditor({
  items,
  onChange,
  emptyLabel,
}: {
  items: ChecklistItem[];
  onChange: (items: ChecklistItem[]) => Promise<void>;
  emptyLabel: string;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const add = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSaving(true);
    await onChange([...items, { id: Crypto.randomUUID(), text: trimmed, done: false }]);
    setText("");
    setSaving(false);
  };

  const toggle = (itemId: string) => onChange(items.map((it) => (it.id === itemId ? { ...it, done: !it.done } : it)));
  const remove = (itemId: string) => onChange(items.filter((it) => it.id !== itemId));

  return (
    <View style={styles.formCard}>
      <View style={styles.checklistInputRow}>
        <TextInput
          style={[styles.input, styles.checklistInput]}
          placeholder="Añadir…"
          value={text}
          onChangeText={setText}
          onSubmitEditing={add}
        />
        <Pressable style={styles.saveButtonSmall} onPress={add} disabled={saving}>
          <Text style={styles.saveButtonSmallText}>+ Añadir</Text>
        </Pressable>
      </View>
      {items.length === 0 ? (
        <Text style={styles.emptyText}>{emptyLabel}</Text>
      ) : (
        <View style={{ gap: 8 }}>
          {items.map((it) => (
            <View key={it.id} style={styles.checklistRow}>
              <Pressable style={[styles.checklistCheckbox, it.done && styles.checklistCheckboxDone]} onPress={() => toggle(it.id)}>
                {it.done && <Text style={styles.checklistCheckboxMark}>✓</Text>}
              </Pressable>
              <Text numberOfLines={2} style={[styles.checklistText, it.done && styles.checklistTextDone]}>
                {it.text}
              </Text>
              <Pressable onPress={() => remove(it.id)} hitSlop={8}>
                <Text style={styles.rowCardDelete}>✕</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// Puerto de GoalsTemplate en dashboard/src/pages/CustomPagePage.tsx — sin unidad/periodo/
// bonificación (eso es del modelo Goal real de la sección Objetivos, no de esta plantilla suelta);
// el progreso solo avanza de uno en uno con "+1", sin poder saltar a un valor concreto.
function GoalsTemplateEditor({ goals, onChange }: { goals: SimpleGoal[]; onChange: (goals: SimpleGoal[]) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [saving, setSaving] = useState(false);

  const add = async () => {
    const trimmed = title.trim();
    const n = Number(target);
    if (!trimmed || !Number.isFinite(n) || n <= 0) return;
    setSaving(true);
    await onChange([...goals, { id: Crypto.randomUUID(), title: trimmed, target: n, current: 0 }]);
    setTitle("");
    setTarget("");
    setSaving(false);
  };

  const bump = (goalId: string) =>
    onChange(goals.map((g) => (g.id === goalId ? { ...g, current: Math.min(g.target, g.current + 1) } : g)));
  const remove = (goalId: string) => onChange(goals.filter((g) => g.id !== goalId));

  return (
    <View style={{ gap: 16 }}>
      <View style={styles.formCard}>
        <TextInput style={styles.input} placeholder="Nombre del objetivo" value={title} onChangeText={setTitle} />
        <TextInput style={styles.input} placeholder="Meta" value={target} onChangeText={setTarget} keyboardType="numeric" />
        <Pressable style={styles.saveButtonSmall} onPress={add} disabled={saving}>
          <Text style={styles.saveButtonSmallText}>{saving ? "Añadiendo…" : "+ Añadir"}</Text>
        </Pressable>
      </View>

      {goals.length === 0 ? (
        <Text style={styles.emptyText}>Todavía no tienes objetivos en esta página.</Text>
      ) : (
        <View style={{ gap: 12 }}>
          {goals.map((g) => {
            const pct = g.target > 0 ? Math.min(100, Math.round((g.current / g.target) * 100)) : 0;
            return (
              <View key={g.id} style={styles.goalCard}>
                <View style={styles.goalHeader}>
                  <Text numberOfLines={1} style={styles.goalTitle}>
                    {g.title}
                  </Text>
                  <Text style={styles.goalMeta}>
                    {g.current} / {g.target}
                  </Text>
                </View>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${pct}%` }]} />
                </View>
                <View style={styles.goalActions}>
                  <Pressable style={styles.goalBumpButton} onPress={() => bump(g.id)} disabled={g.current >= g.target}>
                    <Text style={styles.goalBumpButtonText}>+1</Text>
                  </Pressable>
                  <Pressable onPress={() => remove(g.id)}>
                    <Text style={styles.goalDeleteText}>Eliminar</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

// Formato local YYYY-MM-DD — a propósito NO usa `Date.toISOString()` (convierte a UTC antes de
// recortar, así que cerca de medianoche podría devolver el día de al lado según la zona horaria
// del dispositivo). Mismo criterio que dateKey() en AnnualCalendarLegend.tsx.
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Puerto de AgendaNotesTemplate en dashboard/src/pages/CustomPagePage.tsx — notas sueltas con
// fecha, propias de la página (no tocan Event/Note reales). El selector de fecha es el mismo
// DateTimePicker nativo que ya usa AgendaScreen.tsx para el formulario de eventos.
function AgendaNotesTemplateEditor({ items, onChange }: { items: AgendaNote[]; onChange: (items: AgendaNote[]) => Promise<void> }) {
  const [date, setDate] = useState(() => new Date());
  const [text, setText] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  const add = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSaving(true);
    await onChange([...items, { id: Crypto.randomUUID(), date: localDateKey(date), text: trimmed }]);
    setText("");
    setSaving(false);
  };

  const remove = (itemId: string) => onChange(items.filter((it) => it.id !== itemId));

  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));

  const onDateChange = (_event: DateTimePickerChangeEvent, selected: Date) => {
    setShowPicker(false);
    if (selected) setDate(selected);
  };

  return (
    <View style={{ gap: 16 }}>
      <View style={styles.formCard}>
        <Pressable style={styles.dateButton} onPress={() => setShowPicker(true)}>
          <Text style={styles.dateButtonText}>
            {date.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })}
          </Text>
        </Pressable>
        <TextInput style={styles.input} placeholder="¿Qué apuntas?" value={text} onChangeText={setText} onSubmitEditing={add} />
        <Pressable style={styles.saveButtonSmall} onPress={add} disabled={saving}>
          <Text style={styles.saveButtonSmallText}>{saving ? "Añadiendo…" : "+ Añadir"}</Text>
        </Pressable>
      </View>

      {sorted.length === 0 ? (
        <Text style={styles.emptyText}>Todavía no hay notas en esta agenda.</Text>
      ) : (
        <View style={{ gap: 8 }}>
          {sorted.map((it) => (
            <View key={it.id} style={styles.rowCard}>
              <View style={styles.agendaDatePill}>
                <Text style={styles.agendaDatePillText}>
                  {new Date(`${it.date}T00:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}
                </Text>
              </View>
              <Text numberOfLines={2} style={[styles.rowCardTitle, { flex: 1, minWidth: 0 }]}>
                {it.text}
              </Text>
              <Pressable onPress={() => remove(it.id)} hitSlop={8}>
                <Text style={styles.rowCardDelete}>✕</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {showPicker && (
        <DateTimePicker
          value={date}
          mode="date"
          display={Platform.OS === "ios" ? "inline" : "default"}
          onValueChange={onDateChange}
          onDismiss={() => setShowPicker(false)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 12, paddingBottom: 40 },
  errorBanner: { fontFamily: fonts.sans, fontSize: 13, color: colors.destructive, padding: 20 },
  emptyText: { fontFamily: fonts.sans, fontSize: 14, color: colors.mutedForeground, fontStyle: "italic" },

  titleInput: { fontFamily: fonts.serif, fontSize: 28, color: colors.foreground, padding: 0 },
  subtitleInput: { fontFamily: fonts.sans, fontSize: 14, color: colors.mutedForeground, padding: 0, marginBottom: 8 },

  addButton: { alignSelf: "flex-start", backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: 16, paddingVertical: 10 },
  addButtonText: { fontFamily: fonts.sansMedium, color: colors.primaryForeground, fontSize: 13 },

  masonry: { flexDirection: "row", gap: TILE_GAP },
  masonryColumn: { flex: 1, gap: TILE_GAP },
  // rounded-2xl shadow-soft de la web — la altura la pone frameHeightFor por tile, inline (ver
  // GalleryTile), así que aquí no hay height fija.
  tile: {
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: colors.card,
    ...shadow,
  },
  tileImage: { width: "100%", height: "100%" },
  // Franja sólida semitransparente al pie de la imagen (título) — ver el comentario de GalleryTile
  // sobre por qué no es un degradado como en la web.
  tileImageCaption: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(45, 41, 38, 0.65)",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tileImageCaptionText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.background },
  // flex size-full flex-col justify-end gap-1 p-4 de GalleryTile en la web: título/texto DENTRO
  // del bloque de color, pegados abajo, no en una tarjeta de pie de foto aparte.
  tilePlaceholder: { width: "100%", height: "100%", justifyContent: "flex-end", gap: 4, padding: 14 },
  tilePlaceholderTitle: { fontFamily: fonts.serif, fontSize: 17, color: colors.foreground },
  tilePlaceholderText: { fontFamily: fonts.sans, fontSize: 11, color: colors.mutedForeground },
  tilePlaceholderIcon: { alignSelf: "center", fontSize: 30, opacity: 0.3 },

  fallbackCard: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    ...shadow,
  },
  fallbackText: { fontFamily: fonts.sans, fontSize: 13, color: colors.mutedForeground, lineHeight: 19 },

  deletePageButton: { alignItems: "center", padding: 14, marginTop: 12, borderRadius: radius.full },
  // bg-destructive text-destructive-foreground de la web al confirmar (CustomPagePage.tsx) — antes
  // de tocarlo, texto suelto sin fondo (igual que ya era).
  deletePageButtonConfirming: { backgroundColor: colors.destructive },
  deletePageText: { fontFamily: fonts.sansMedium, color: colors.destructive, fontSize: 14 },
  deletePageTextConfirming: { color: colors.destructiveForeground, fontWeight: "700" },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(45,41,38,0.4)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    padding: 20,
    maxHeight: "88%",
  },
  modalTitle: { fontFamily: fonts.serif, fontSize: 24, color: colors.foreground, marginBottom: 16 },
  // Solo para el estado VACÍO (borde punteado, "Añadir foto") — border-2 border-dashed
  // border-primary/30 de la web.
  imagePicker: {
    height: 160,
    borderRadius: 16,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: "rgba(95, 113, 97, 0.3)",
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    overflow: "hidden",
    marginBottom: 12,
  },
  imagePickerIcon: { fontSize: 22 },
  // Con foto ya puesta: relative overflow-hidden rounded-2xl de la web, sin el borde punteado
  // (ese es solo del estado vacío).
  imageWrapper: { height: 160, borderRadius: 16, overflow: "hidden", marginBottom: 12 },
  imagePreview: { width: "100%", height: "100%" },
  imagePickerText: { fontFamily: fonts.sans, fontSize: 13, color: colors.mutedForeground },
  // absolute right-2 top-2 flex gap-1 de GalleryItemDialog en la web — "Cambiar"/"Quitar"
  // superpuestos en la esquina de la foto, en vez del enlace de texto suelto debajo que había.
  imageOverlayActions: { position: "absolute", top: 8, right: 8, flexDirection: "row", gap: 6 },
  imageOverlayButton: {
    backgroundColor: "rgba(247, 244, 241, 0.85)",
    borderRadius: radius.input,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  imageOverlayButtonText: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.foreground },
  imageOverlayButtonTextDestructive: { color: colors.destructive },
  input: {
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.input,
    padding: 12,
    marginBottom: 12,
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.foreground,
    backgroundColor: colors.card,
  },
  inputMultiline: { minHeight: 80, textAlignVertical: "top" },
  saveButton: { backgroundColor: colors.primary, borderRadius: radius.full, padding: 15, alignItems: "center", marginTop: 8 },
  saveButtonText: { fontFamily: fonts.sansMedium, color: colors.primaryForeground, fontSize: 15 },
  deleteButton: { alignItems: "center", padding: 14 },
  deleteButtonText: { fontFamily: fonts.sansMedium, color: colors.destructive, fontSize: 14 },
  cancelButton: { alignItems: "center", padding: 10 },
  cancelButtonText: { fontFamily: fonts.sans, color: colors.mutedForeground, fontSize: 14 },

  // ========== NOTA ==========
  notaInput: {
    minHeight: 300,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.input,
    backgroundColor: colors.card,
    padding: 12,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.foreground,
  },
  saveContentButton: { alignSelf: "flex-start", backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: 18, paddingVertical: 9 },
  saveContentButtonText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.primaryForeground },

  // ========== KANBAN ==========
  // Sin sombra a propósito, a diferencia de otras tarjetas del mismo fichero: el color de columna
  // (KANBAN_COLUMN_STYLES) tiñe el fondo con un color translúcido en 2 de cada 3 columnas, y en
  // Android `elevation` sobre un fondo con alpha pinta un halo grueso pegado al borde en vez de
  // una sombra suave (mismo criterio ya documentado en el estilo `section` de HoyScreen.tsx) — se
  // quita para las tres, no solo para las tintadas, así las columnas no varían de "profundidad"
  // entre sí según les toque el tono neutro o uno de color.
  kanbanColumn: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 8,
  },
  kanbanColumnHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  kanbanColumnTitle: { flex: 1, minWidth: 0, fontFamily: fonts.sansSemiBold, fontSize: 15, color: colors.foreground },
  kanbanColumnTitleInput: {
    flex: 1,
    minWidth: 0,
    fontFamily: fonts.sansSemiBold,
    fontSize: 15,
    color: colors.foreground,
    borderBottomWidth: 1,
    borderBottomColor: colors.primary,
    paddingVertical: 2,
  },
  kanbanColumnCount: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground },
  kanbanColumnDelete: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.mutedForeground, padding: 4 },
  kanbanCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.input,
    backgroundColor: colors.background,
    padding: 10,
    gap: 2,
  },
  kanbanCardText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.foreground },
  kanbanCardDescription: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground },
  kanbanAddCardText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.primary, paddingVertical: 4 },

  addColumnForm: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    borderRadius: radius.card,
    backgroundColor: colors.card,
    padding: 14,
    gap: 8,
  },
  addColumnActions: { flexDirection: "row", alignItems: "center", gap: 16 },
  addColumnButton: {
    alignItems: "center",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(95, 113, 97, 0.3)",
    backgroundColor: "rgba(95, 113, 97, 0.05)",
    borderRadius: radius.card,
    paddingVertical: 12,
  },
  addColumnButtonText: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.primary },
  saveButtonSmall: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: 16, paddingVertical: 8 },
  saveButtonSmallText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.primaryForeground },

  fieldLabel: {
    fontFamily: fonts.sansBold,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: colors.mutedForeground,
    marginBottom: 6,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.full,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.primaryTint, borderColor: colors.primary },
  chipText: { fontFamily: fonts.sans, fontSize: 13, color: colors.mutedForeground },
  chipTextSelected: { fontFamily: fonts.sansMedium, color: colors.primary },

  // ========== FINANZAS / PROYECTOS / OBJETIVOS (plantillas) ==========
  // card-soft flex items-center justify-between de la web (balance de la plantilla Finanzas).
  balanceCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    ...shadow,
  },
  balanceLabel: { fontFamily: fonts.sans, fontSize: 13, color: colors.mutedForeground },
  balanceValue: { fontFamily: fonts.serif, fontSize: 24 },
  // card-soft grid ... de los formularios de alta (Finanzas/Objetivos) y card-soft del checklist
  // (Proyectos) — misma tarjeta neutra que el resto, reutilizada para las tres.
  formCard: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    gap: 10,
    ...shadow,
  },
  // rounded-xl border-border bg-card de cada fila (Finanzas).
  rowCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: radius.input,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowCardTitle: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.foreground },
  rowCardSubtitle: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground },
  rowCardDelete: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.mutedForeground, padding: 4 },
  financeAmount: { fontFamily: fonts.sansMedium, fontSize: 14 },

  checklistInputRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  checklistInput: { flex: 1, marginBottom: 0 },
  checklistRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  // size-5 rounded-full border de la web.
  checklistCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  checklistCheckboxDone: { backgroundColor: colors.primaryTint, borderColor: colors.primary },
  checklistCheckboxMark: { color: colors.primary, fontSize: 12, fontFamily: fonts.sansBold },
  checklistText: { flex: 1, minWidth: 0, fontFamily: fonts.sans, fontSize: 14, color: colors.foreground },
  checklistTextDone: { textDecorationLine: "line-through", color: colors.mutedForeground },

  goalCard: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 8,
    ...shadow,
  },
  goalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  goalTitle: { flex: 1, minWidth: 0, fontFamily: fonts.sansMedium, fontSize: 15, color: colors.foreground },
  goalMeta: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground },
  // h-2.5 rounded-full bg-muted / bg-primary de la web — mismo criterio que ObjetivosScreen.tsx.
  progressTrack: { height: 10, borderRadius: radius.full, backgroundColor: colors.muted, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: radius.full, backgroundColor: colors.primary },
  goalActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  goalBumpButton: { backgroundColor: colors.primaryTint, borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 6 },
  goalBumpButtonText: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.primary },
  goalDeleteText: { fontFamily: fonts.sans, fontSize: 12, color: colors.mutedForeground },

  // ========== AGENDA (plantilla) ==========
  dateButton: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.input,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: colors.card,
  },
  dateButtonText: { fontFamily: fonts.sans, fontSize: 14, color: colors.foreground },
  // rounded-full bg-secondary px-3 py-1 text-xs de la web.
  agendaDatePill: { backgroundColor: colors.secondary, borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  agendaDatePillText: { fontFamily: fonts.sansMedium, fontSize: 11, color: colors.secondaryForeground },
});
