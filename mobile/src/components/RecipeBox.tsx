import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, LayoutChangeEvent, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Crypto from "expo-crypto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Svg, { Circle, Path, SvgXml } from "react-native-svg";
import { Text, TextInput } from "./AppText";
import { Recipe, RecipeDifficulty, RecipesContent, RecipeTab } from "../api/customPages";
import {
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  emptyRecipe,
  linesToList,
  moveTab,
  normalizeRecipesContent,
  RECIPE_ILLUSTRATION,
  recipePatternTile,
  recipesInTab,
  removeTab,
} from "../utils/recipes";
import { fonts } from "../theme";

// Plantilla "recetas" de las páginas personalizadas — puerto de dashboard/src/components/RecipeBoxTemplate.tsx: una
// caja de tela roja con filete dorado; dentro, un archivador con una pestaña por categoría y, en la elegida, sus
// tarjetas de receta. Cada tarjeta se abre a pantalla completa como la ficha de papel, para leerla o editarla. Las
// pestañas se editan (nombre, orden, añadir, borrar) en una hoja aparte.
//
// Igual que StudyPlanner: el componente guarda en cada acción y mantiene su PROPIA copia (`dataRef`), para que dos
// guardados seguidos partan del último estado y no del que aún se está recargando en la pantalla padre.

// Es un objeto físico: la misma paleta en tema claro y oscuro (igual que en la web, ver .recipe-box en styles.css).
const RP = {
  paper: "#f6f0e5",
  paperShade: "#e9dfcf",
  ink: "#2b2420",
  inkSoft: "#6a5a50",
  red: "#8e1b25",
  redDeep: "#5e1017",
  gold: "#cdae6c",
  rule: "#cbb8a2",
};

const PATTERN_XML = recipePatternTile(RP.red, 150);
const PATTERN_TILE = 150;
const activeTabKey = (pageId: string) => `tidely.recipes.tab.${pageId}`;

type Sheet = { recipeId: string; editing: boolean } | { draft: Recipe } | null;

export function RecipeBox({ pageId, content, onChange }: { pageId: string; content: unknown; onChange: (next: RecipesContent) => Promise<void> }) {
  const [data, setData] = useState<RecipesContent>(() => normalizeRecipesContent(content));
  const dataRef = useRef(data);
  const pendingRef = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (pendingRef.current > 0) return;
    const next = normalizeRecipesContent(content);
    dataRef.current = next;
    setData(next);
  }, [content]);

  const commit = useCallback((next: RecipesContent) => {
    dataRef.current = next;
    setData(next);
    pendingRef.current += 1;
    onChangeRef.current(next)
      .catch(() => undefined)
      .finally(() => {
        pendingRef.current -= 1;
      });
  }, []);

  const [storedTab, setStoredTab] = useState<string | null>(null);
  useEffect(() => {
    AsyncStorage.getItem(activeTabKey(pageId))
      .then((id) => id && setStoredTab(id))
      .catch(() => undefined);
  }, [pageId]);
  const selectTab = (id: string) => {
    setStoredTab(id);
    AsyncStorage.setItem(activeTabKey(pageId), id).catch(() => undefined);
  };

  const [sheet, setSheet] = useState<Sheet>(null);
  const [tabEditorOpen, setTabEditorOpen] = useState(false);

  const { tabs, recipes } = data;
  const activeTab = tabs.find((t) => t.id === storedTab) ?? tabs[0] ?? null;
  const visible = activeTab ? recipesInTab(recipes, activeTab.id) : [];

  const openRecipe = sheet && "recipeId" in sheet ? (recipes.find((r) => r.id === sheet.recipeId) ?? null) : null;
  const draft = sheet && "draft" in sheet ? sheet.draft : null;

  const saveRecipe = (recipe: Recipe) => {
    const current = dataRef.current;
    const exists = current.recipes.some((r) => r.id === recipe.id);
    commit({ ...current, recipes: exists ? current.recipes.map((r) => (r.id === recipe.id ? recipe : r)) : [...current.recipes, recipe] });
    if (recipe.tabId !== activeTab?.id) selectTab(recipe.tabId);
    setSheet({ recipeId: recipe.id, editing: false });
  };

  const deleteRecipe = (recipe: Recipe) => {
    Alert.alert("Eliminar receta", `¿Eliminar "${recipe.name || "Sin nombre"}"? No se puede deshacer.`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: () => {
          const current = dataRef.current;
          commit({ ...current, recipes: current.recipes.filter((r) => r.id !== recipe.id) });
          setSheet(null);
        },
      },
    ]);
  };

  return (
    <View style={styles.box}>
      <View pointerEvents="none" style={[styles.goldRule, { top: 6, left: 6, right: 6, bottom: 6, opacity: 0.7, borderRadius: 6 }]} />
      <View pointerEvents="none" style={[styles.goldRule, { top: 10, left: 10, right: 10, bottom: 10, opacity: 0.35, borderRadius: 4 }]} />

      <View style={styles.tabRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll} contentContainerStyle={styles.tabScrollContent}>
          {tabs.map((tab) => {
            const active = tab.id === activeTab?.id;
            const count = recipes.filter((r) => r.tabId === tab.id).length;
            return (
              <Pressable
                key={tab.id}
                onPress={() => selectTab(tab.id)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={[styles.tab, active ? styles.tabActive : styles.tabInactive]}
              >
                <Text style={styles.tabLabel} numberOfLines={1}>
                  {tab.name.toUpperCase()}
                </Text>
                <Text style={styles.tabCount}>{count}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Pressable onPress={() => setTabEditorOpen(true)} accessibilityLabel="Editar pestañas" hitSlop={8} style={styles.editTabsButton}>
          <Svg width={16} height={16} viewBox="0 0 16 16">
            <Path d="M10.5 2.5 L13.5 5.5 L5.5 13.5 L2.5 13.5 L2.5 10.5 Z M8.5 4.5 L11.5 7.5" stroke={RP.gold} strokeWidth={1.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Pressable>
      </View>

      <PatternPanel>
        {activeTab ? (
          <>
            <Paper style={styles.panelHeader}>
              <View style={styles.panelHeaderTitle}>
                <Text style={styles.panelTitle} numberOfLines={1}>
                  {activeTab.name}
                </Text>
                <Text style={styles.panelCount}>{visible.length === 1 ? "1 receta" : `${visible.length} recetas`}</Text>
              </View>
              <Pressable onPress={() => setSheet({ draft: emptyRecipe(Crypto.randomUUID(), activeTab.id) })} style={({ pressed }) => [styles.redButton, pressed && styles.redButtonPressed]}>
                <PlusIcon color={RP.paper} />
                <Text style={styles.redButtonText}>Nueva receta</Text>
              </Pressable>
            </Paper>

            {visible.length === 0 ? (
              <Paper style={styles.empty}>
                <PotIllustration width={150} />
                <Text style={styles.emptyTitle}>Aún no hay recetas en {activeTab.name}.</Text>
                <Text style={styles.emptyText}>Apunta la primera: raciones, tiempo, ingredientes y cómo se hace.</Text>
              </Paper>
            ) : (
              visible.map((recipe) => <RecipeTile key={recipe.id} recipe={recipe} onOpen={() => setSheet({ recipeId: recipe.id, editing: false })} />)
            )}
          </>
        ) : (
          <Paper style={styles.empty}>
            <Text style={styles.emptyTitle}>El archivador está vacío.</Text>
            <Pressable onPress={() => setTabEditorOpen(true)}>
              <Text style={styles.link}>Añade una pestaña para empezar</Text>
            </Pressable>
          </Paper>
        )}
      </PatternPanel>

      {(openRecipe || draft) && (
        <RecipeSheet
          key={openRecipe?.id ?? draft?.id}
          recipe={openRecipe ?? draft!}
          isNew={!openRecipe}
          startEditing={!openRecipe || (sheet !== null && "editing" in sheet && sheet.editing)}
          tabs={tabs}
          onSave={saveRecipe}
          onDelete={deleteRecipe}
          onClose={() => setSheet(null)}
        />
      )}

      <TabEditor
        visible={tabEditorOpen}
        data={data}
        onClose={() => setTabEditorOpen(false)}
        onChange={(next) => {
          commit(next);
          if (activeTab && !next.tabs.some((t) => t.id === activeTab.id)) setStoredTab(null);
        }}
        getCurrent={() => dataRef.current}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Piezas de papel
// ---------------------------------------------------------------------------------------------------------------

/** Papel crema con doble filete: el borde y, 6 px más adentro, una segunda línea. */
function Paper({ children, style }: { children: ReactNode; style?: object }) {
  return (
    <View style={[styles.paper, style]}>
      <View pointerEvents="none" style={styles.paperInnerRule} />
      {children}
    </View>
  );
}

/** Separador del archivador: papel con el patrón de especias, repetido en baldosas. */
function PatternPanel({ children }: { children: ReactNode }) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (Math.abs(width - size.width) > 1 || Math.abs(height - size.height) > 1) setSize({ width, height });
  };
  const cols = Math.ceil(size.width / PATTERN_TILE);
  const rows = Math.ceil(size.height / PATTERN_TILE);
  return (
    <View style={styles.panel} onLayout={onLayout}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {Array.from({ length: rows }, (_, r) => (
          <View key={r} style={styles.patternRow}>
            {Array.from({ length: cols }, (_, c) => (
              <SvgXml key={c} xml={PATTERN_XML} width={PATTERN_TILE} height={PATTERN_TILE} />
            ))}
          </View>
        ))}
      </View>
      {children}
    </View>
  );
}

function RecipeTile({ recipe, onOpen }: { recipe: Recipe; onOpen: () => void }) {
  const preview = recipe.ingredients.slice(0, 4).join(" · ");
  return (
    <Pressable onPress={onOpen} style={({ pressed }) => [styles.tileWrap, pressed && { transform: [{ translateY: 1 }], opacity: 0.94 }]}>
      <Paper style={styles.tile}>
        <Label>Receta</Label>
        <Text style={[styles.tileName, !recipe.name && styles.placeholderText]}>{recipe.name || "Sin nombre"}</Text>
        <View style={styles.tileMeta}>
          <MetaCell label="Raciones" value={recipe.servings} />
          <MetaCell label="Tiempo" value={recipe.time} />
          <View style={styles.metaCell}>
            <Label small>Dificultad</Label>
            <DifficultyMarks difficulty={recipe.difficulty} />
          </View>
        </View>
        <Text style={styles.tilePreview} numberOfLines={2}>
          {preview || "Sin ingredientes apuntados"}
          {recipe.ingredients.length > 4 ? ` · y ${recipe.ingredients.length - 4} más` : ""}
        </Text>
      </Paper>
    </Pressable>
  );
}

function Label({ children, small = false }: { children: string; small?: boolean }) {
  return <Text style={[styles.label, small && styles.labelSmall]}>{children.toUpperCase()}</Text>;
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaCell}>
      <Label small>{label}</Label>
      <Text style={[styles.metaValue, !value && styles.placeholderText]} numberOfLines={1}>
        {value || "—"}
      </Text>
    </View>
  );
}

function DifficultyMarks({ difficulty, large = false }: { difficulty: RecipeDifficulty | null; large?: boolean }) {
  const level = difficulty ? DIFFICULTIES.indexOf(difficulty) + 1 : 0;
  const size = large ? 12 : 10;
  return (
    <View style={styles.marks}>
      {[1, 2, 3].map((n) => (
        <Svg key={n} width={size} height={size} viewBox="0 0 10 10">
          <Circle cx={5} cy={5} r={4} fill={n <= level ? RP.red : "none"} stroke={RP.red} strokeWidth={1.2} />
        </Svg>
      ))}
      <Text style={[large ? styles.marksLabelLarge : styles.marksLabel, !difficulty && styles.placeholderText]}>
        {difficulty ? DIFFICULTY_LABELS[difficulty] : "—"}
      </Text>
    </View>
  );
}

function PotIllustration({ width }: { width: number }) {
  return (
    <Svg width={width} height={(width * 92) / 160} viewBox="0 0 160 92">
      {RECIPE_ILLUSTRATION.map((p, i) => (
        <Path key={i} d={p.d} stroke={RP.ink} strokeWidth={p.width ?? 1.1} opacity={p.opacity ?? 1} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </Svg>
  );
}

function PlusIcon({ color }: { color: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 16 16">
      <Path d="M8 3 V13 M3 8 H13" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
    </Svg>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Ficha a pantalla completa: lectura y edición
// ---------------------------------------------------------------------------------------------------------------
function RecipeSheet({
  recipe,
  isNew,
  startEditing,
  tabs,
  onSave,
  onDelete,
  onClose,
}: {
  recipe: Recipe;
  isNew: boolean;
  startEditing: boolean;
  tabs: RecipeTab[];
  onSave: (recipe: Recipe) => void;
  onDelete: (recipe: Recipe) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState(startEditing);
  const tabName = tabs.find((t) => t.id === recipe.tabId)?.name ?? "";

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.sheetBackdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={[styles.sheetScroll, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
          <Paper style={styles.sheetCard}>
            <View style={styles.sheetTop}>
              <PotIllustration width={118} />
              <Pressable onPress={onClose} accessibilityLabel="Cerrar" hitSlop={10} style={styles.closeButton}>
                <Svg width={16} height={16} viewBox="0 0 16 16">
                  <Path d="M3.5 3.5 L12.5 12.5 M12.5 3.5 L3.5 12.5" stroke={RP.inkSoft} strokeWidth={1.5} strokeLinecap="round" />
                </Svg>
              </Pressable>
            </View>

            {editing ? (
              <RecipeForm recipe={recipe} isNew={isNew} tabs={tabs} onSave={onSave} onCancel={() => (isNew ? onClose() : setEditing(false))} />
            ) : (
              <>
                <Text style={styles.label}>
                  RECETA{tabName ? <Text style={styles.labelSoft}>{`  ·  ${tabName.toUpperCase()}`}</Text> : null}
                </Text>
                <Text style={styles.sheetTitle}>{recipe.name || "Sin nombre"}</Text>

                <View style={styles.sheetMeta}>
                  <MetaCell label="Raciones" value={recipe.servings} />
                  <MetaCell label="Tiempo" value={recipe.time} />
                  <View style={styles.metaCell}>
                    <Label small>Dificultad</Label>
                    <DifficultyMarks difficulty={recipe.difficulty} large />
                  </View>
                </View>

                <SheetSection title="Ingredientes">
                  {recipe.ingredients.length > 0 ? (
                    recipe.ingredients.map((item, i) => (
                      <Text key={i} style={styles.ruledLine}>
                        {item}
                      </Text>
                    ))
                  ) : (
                    <Text style={[styles.ruledLine, styles.placeholderText]}>Sin ingredientes apuntados.</Text>
                  )}
                </SheetSection>

                <SheetSection title="Elaboración">
                  {recipe.steps.length > 0 ? (
                    recipe.steps.map((step, i) => (
                      <View key={i} style={styles.stepRow}>
                        <Text style={styles.stepNumber}>{i + 1}</Text>
                        <Text style={styles.stepText}>{step}</Text>
                      </View>
                    ))
                  ) : (
                    <Text style={[styles.ruledLine, styles.placeholderText]}>Sin pasos apuntados.</Text>
                  )}
                </SheetSection>

                <SheetSection title="Consejos">
                  <Text style={[styles.tips, !recipe.tips && styles.placeholderText]}>{recipe.tips || "Sin consejos todavía."}</Text>
                </SheetSection>

                <View style={styles.sheetFooter}>
                  <Pressable onPress={() => setEditing(true)} style={({ pressed }) => [styles.redButton, pressed && styles.redButtonPressed]}>
                    <Text style={styles.redButtonText}>Editar receta</Text>
                  </Pressable>
                  <Pressable onPress={() => onDelete(recipe)} style={styles.ghostButton}>
                    <Text style={styles.ghostButtonText}>Eliminar receta</Text>
                  </Pressable>
                </View>
              </>
            )}
          </Paper>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SheetSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.label, styles.sectionLabel]}>{title.toUpperCase()}</Text>
      {children}
    </View>
  );
}

function RecipeForm({
  recipe,
  isNew,
  tabs,
  onSave,
  onCancel,
}: {
  recipe: Recipe;
  isNew: boolean;
  tabs: RecipeTab[];
  onSave: (recipe: Recipe) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(recipe.name);
  const [tabId, setTabId] = useState(recipe.tabId);
  const [servings, setServings] = useState(recipe.servings);
  const [time, setTime] = useState(recipe.time);
  const [difficulty, setDifficulty] = useState<RecipeDifficulty | null>(recipe.difficulty);
  const [ingredients, setIngredients] = useState(recipe.ingredients.join("\n"));
  const [steps, setSteps] = useState(recipe.steps.join("\n"));
  const [tips, setTips] = useState(recipe.tips);
  const canSave = name.trim().length > 0;

  const save = () => {
    if (!canSave) return;
    onSave({
      ...recipe,
      name: name.trim(),
      tabId,
      servings: servings.trim(),
      time: time.trim(),
      difficulty,
      ingredients: linesToList(ingredients),
      steps: linesToList(steps),
      tips: tips.trim(),
    });
  };

  return (
    <View>
      <Text style={styles.label}>{isNew ? "NUEVA RECETA" : "RECETA"}</Text>
      <TextInput
        value={name}
        onChangeText={(t) => setName(t.replace(/\n/g, " "))}
        placeholder="Nombre del plato"
        placeholderTextColor={RP.inkSoft}
        maxLength={120}
        multiline
        autoFocus={isNew}
        blurOnSubmit
        style={[styles.field, styles.nameField]}
      />

      <View style={styles.formMeta}>
        <View style={styles.formMetaCell}>
          <Label small>Raciones</Label>
          <TextInput value={servings} onChangeText={setServings} placeholder="4" placeholderTextColor={RP.inkSoft} maxLength={30} style={[styles.field, styles.metaField]} />
        </View>
        <View style={styles.formMetaCell}>
          <Label small>Tiempo</Label>
          <TextInput value={time} onChangeText={setTime} placeholder="45 min" placeholderTextColor={RP.inkSoft} maxLength={30} style={[styles.field, styles.metaField]} />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.label, styles.sectionLabel]}>DIFICULTAD</Text>
        <View style={styles.chips}>
          {DIFFICULTIES.map((d) => (
            <Pressable
              key={d}
              onPress={() => setDifficulty(difficulty === d ? null : d)}
              accessibilityState={{ selected: difficulty === d }}
              style={[styles.chip, difficulty === d && styles.chipSelected]}
            >
              <Text style={[styles.chipText, difficulty === d && styles.chipTextSelected]}>{DIFFICULTY_LABELS[d]}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <FormArea label="Ingredientes" hint="Uno por línea" value={ingredients} onChange={setIngredients} minLines={5} placeholder={"300 g de garbanzos cocidos\n2 dientes de ajo"} />
      <FormArea label="Elaboración" hint="Un paso por línea" value={steps} onChange={setSteps} minLines={6} placeholder={"Tritura los garbanzos con el ajo.\nAñade el limón poco a poco."} />
      <FormArea label="Consejos" value={tips} onChange={setTips} minLines={3} placeholder="Lo que conviene recordar la próxima vez." serif />

      {tabs.length > 1 && (
        <View style={styles.section}>
          <Text style={[styles.label, styles.sectionLabel]}>PESTAÑA</Text>
          <View style={styles.chips}>
            {tabs.map((t) => (
              <Pressable key={t.id} onPress={() => setTabId(t.id)} accessibilityState={{ selected: tabId === t.id }} style={[styles.chip, tabId === t.id && styles.chipSelected]}>
                <Text style={[styles.chipText, tabId === t.id && styles.chipTextSelected]}>{t.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      <View style={styles.sheetFooter}>
        <Pressable onPress={save} disabled={!canSave} style={({ pressed }) => [styles.redButton, !canSave && styles.disabled, pressed && styles.redButtonPressed]}>
          <Text style={styles.redButtonText}>{isNew ? "Guardar receta" : "Guardar cambios"}</Text>
        </Pressable>
        <Pressable onPress={onCancel} style={styles.ghostButton}>
          <Text style={styles.ghostButtonText}>Cancelar</Text>
        </Pressable>
      </View>
      {!canSave && <Text style={styles.hint}>Ponle nombre al plato para guardarla.</Text>}
    </View>
  );
}

const LINE = 30;

function FormArea({
  label,
  hint,
  value,
  onChange,
  minLines,
  placeholder,
  serif = false,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  minLines: number;
  placeholder: string;
  serif?: boolean;
}) {
  const [height, setHeight] = useState(minLines * LINE);
  const lines = Math.max(minLines, Math.ceil(height / LINE));
  return (
    <View style={styles.section}>
      <View style={styles.areaLabelRow}>
        <Text style={[styles.label, styles.sectionLabel]}>{label.toUpperCase()}</Text>
        {hint ? <Text style={styles.areaHint}>{hint}</Text> : null}
      </View>
      <View>
        {/* papel pautado: una línea punteada por renglón, detrás del texto */}
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {Array.from({ length: lines }, (_, i) => (
            <View key={i} style={[styles.paperLine, { top: (i + 1) * LINE - 1 }]} />
          ))}
        </View>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={RP.inkSoft}
          multiline
          scrollEnabled={false}
          textAlignVertical="top"
          onContentSizeChange={(e) => setHeight(e.nativeEvent.contentSize.height)}
          style={[styles.area, { minHeight: lines * LINE }, serif && styles.areaSerif]}
        />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Editor de pestañas
// ---------------------------------------------------------------------------------------------------------------
function TabEditor({
  visible,
  data,
  onClose,
  onChange,
  getCurrent,
}: {
  visible: boolean;
  data: RecipesContent;
  onClose: () => void;
  onChange: (next: RecipesContent) => void;
  getCurrent: () => RecipesContent;
}) {
  const insets = useSafeAreaInsets();
  const [names, setNames] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");

  // Los nombres se editan en local y se guardan al salir del campo (no en cada letra).
  useEffect(() => {
    if (visible) setNames(Object.fromEntries(data.tabs.map((t) => [t.id, t.name])));
  }, [visible, data.tabs]);

  const commitName = (id: string) => {
    const current = getCurrent();
    const name = (names[id] ?? "").trim() || "Sin nombre";
    if (current.tabs.find((t) => t.id === id)?.name === name) return;
    onChange({ ...current, tabs: current.tabs.map((t) => (t.id === id ? { ...t, name } : t)) });
  };

  const remove = (tab: RecipeTab) => {
    const count = getCurrent().recipes.filter((r) => r.tabId === tab.id).length;
    const doRemove = () => onChange(removeTab(getCurrent(), tab.id));
    if (count === 0) return doRemove();
    Alert.alert("Borrar pestaña", `Se borrarán también ${count === 1 ? "su receta" : `sus ${count} recetas`}. ¿Continuar?`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Borrar", style: "destructive", onPress: doRemove },
    ]);
  };

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    const current = getCurrent();
    onChange({ ...current, tabs: [...current.tabs, { id: Crypto.randomUUID(), name }] });
    setNewName("");
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.editorBackdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Cerrar" />
        <View style={[styles.editorSheet, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.editorHeader}>
            <Text style={styles.editorTitle}>Pestañas del archivador</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={styles.editorDone}>Listo</Text>
            </Pressable>
          </View>
          <Text style={styles.editorHint}>Cámbiales el nombre, ordénalas o añade otras. Borrar una pestaña borra también sus recetas.</Text>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.editorList}>
            {data.tabs.map((tab, i) => {
              const count = data.recipes.filter((r) => r.tabId === tab.id).length;
              return (
                <View key={tab.id} style={styles.editorRow}>
                  <View style={styles.editorNameCol}>
                    <TextInput
                      value={names[tab.id] ?? tab.name}
                      onChangeText={(t) => setNames((n) => ({ ...n, [tab.id]: t }))}
                      onEndEditing={() => commitName(tab.id)}
                      onBlur={() => commitName(tab.id)}
                      maxLength={40}
                      style={[styles.field, styles.editorName]}
                    />
                    <Text style={styles.editorCount}>{count === 1 ? "1 receta" : `${count} recetas`}</Text>
                  </View>
                  <ArrowButton label="Mover a la izquierda" disabled={i === 0} d="M10 3.5 L5.5 8 L10 12.5" onPress={() => onChange({ ...getCurrent(), tabs: moveTab(getCurrent().tabs, tab.id, -1) })} />
                  <ArrowButton label="Mover a la derecha" disabled={i === data.tabs.length - 1} d="M6 3.5 L10.5 8 L6 12.5" onPress={() => onChange({ ...getCurrent(), tabs: moveTab(getCurrent().tabs, tab.id, 1) })} />
                  <Pressable onPress={() => remove(tab)} hitSlop={6} style={styles.editorDelete}>
                    <Text style={styles.editorDeleteText}>Borrar</Text>
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
          <View style={styles.editorAddRow}>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              onSubmitEditing={add}
              placeholder="Nueva pestaña (p. ej. Pescados)"
              placeholderTextColor={RP.inkSoft}
              maxLength={40}
              returnKeyType="done"
              style={[styles.field, styles.editorName, { flex: 1 }]}
            />
            <Pressable onPress={add} disabled={!newName.trim()} style={[styles.redButton, !newName.trim() && styles.disabled]}>
              <PlusIcon color={RP.paper} />
              <Text style={styles.redButtonText}>Añadir</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ArrowButton({ label, disabled, d, onPress }: { label: string; disabled: boolean; d: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityLabel={label} hitSlop={4} style={[styles.arrowButton, disabled && { opacity: 0.3 }]}>
      <Svg width={16} height={16} viewBox="0 0 16 16">
        <Path d={d} stroke={RP.ink} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </Pressable>
  );
}

const serif = fonts.serif;

const styles = StyleSheet.create({
  box: {
    backgroundColor: RP.red,
    borderRadius: 10,
    padding: 10,
    shadowColor: "#3c0a0f",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 5,
  },
  goldRule: { position: "absolute", borderWidth: 1, borderColor: RP.gold },
  tabRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 4, paddingTop: 4 },
  tabScroll: { flex: 1, marginBottom: -1 },
  tabScrollContent: { alignItems: "flex-end", gap: 4, paddingTop: 6 },
  tab: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    paddingHorizontal: 14,
    paddingTop: 9,
    paddingBottom: 8,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: RP.rule,
  },
  tabActive: { backgroundColor: RP.paper, zIndex: 2 },
  tabInactive: { backgroundColor: RP.paperShade, marginBottom: -6, paddingBottom: 14 },
  tabLabel: { fontFamily: serif, fontSize: 12, letterSpacing: 2, color: RP.red, maxWidth: 160 },
  tabCount: { fontFamily: serif, fontSize: 12, color: RP.inkSoft },
  editTabsButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: RP.gold,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  panel: {
    backgroundColor: RP.paper,
    borderWidth: 1,
    borderColor: RP.rule,
    borderRadius: 10,
    borderTopLeftRadius: 0,
    padding: 12,
    gap: 12,
    overflow: "hidden",
  },
  patternRow: { flexDirection: "row" },
  paper: { backgroundColor: RP.paper, borderWidth: 1, borderColor: RP.rule, borderRadius: 4 },
  paperInnerRule: { position: "absolute", top: 5, left: 5, right: 5, bottom: 5, borderWidth: 1, borderColor: RP.rule, borderRadius: 2 },
  panelHeader: { padding: 18, gap: 12 },
  panelHeaderTitle: { flexDirection: "row", alignItems: "baseline", gap: 10 },
  panelTitle: { fontFamily: serif, fontSize: 30, color: RP.ink, flexShrink: 1 },
  panelCount: { fontFamily: serif, fontSize: 15, color: RP.inkSoft },
  redButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 8,
    backgroundColor: RP.red,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  redButtonPressed: { backgroundColor: RP.redDeep },
  redButtonText: { color: RP.paper, fontFamily: fonts.sansMedium, fontSize: 14 },
  ghostButton: { borderRadius: 999, borderWidth: 1, borderColor: RP.rule, paddingHorizontal: 16, paddingVertical: 10 },
  ghostButtonText: { color: RP.inkSoft, fontFamily: fonts.sans, fontSize: 14 },
  disabled: { opacity: 0.45 },
  empty: { alignItems: "center", gap: 10, paddingHorizontal: 22, paddingVertical: 28 },
  emptyTitle: { fontFamily: serif, fontSize: 21, color: RP.ink, textAlign: "center" },
  emptyText: { fontFamily: fonts.sans, fontSize: 14, color: RP.inkSoft, textAlign: "center", lineHeight: 20 },
  link: { fontFamily: fonts.sans, fontSize: 14, color: RP.red, textDecorationLine: "underline" },
  tileWrap: {
    shadowColor: "#2b2420",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    elevation: 2,
  },
  tile: { padding: 18, gap: 10 },
  tileName: { fontFamily: serif, fontSize: 25, lineHeight: 29, color: RP.ink },
  tileMeta: {
    flexDirection: "row",
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderStyle: "dotted",
    borderColor: RP.rule,
  },
  tilePreview: { fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 19, color: RP.inkSoft },
  metaCell: { flex: 1, gap: 5, minWidth: 0 },
  metaValue: { fontFamily: serif, fontSize: 19, color: RP.ink },
  label: { fontFamily: serif, fontSize: 11.5, letterSpacing: 2.2, color: RP.red },
  labelSmall: { fontSize: 10, letterSpacing: 1.6 },
  labelSoft: { color: RP.inkSoft },
  placeholderText: { color: RP.inkSoft },
  marks: { flexDirection: "row", alignItems: "center", gap: 4 },
  marksLabel: { fontFamily: serif, fontSize: 14, color: RP.ink, marginLeft: 3 },
  marksLabelLarge: { fontFamily: serif, fontSize: 18, color: RP.ink, marginLeft: 4 },
  sheetBackdrop: { flex: 1, backgroundColor: "#1c1210" },
  sheetScroll: { paddingHorizontal: 10 },
  sheetCard: { paddingHorizontal: 22, paddingTop: 18, paddingBottom: 26 },
  sheetTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 },
  closeButton: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: RP.paperShade },
  sheetTitle: { fontFamily: serif, fontSize: 38, lineHeight: 41, color: RP.ink, marginTop: 6 },
  sheetMeta: {
    flexDirection: "row",
    gap: 12,
    marginTop: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderStyle: "dotted",
    borderColor: RP.rule,
  },
  section: { marginTop: 24, gap: 6 },
  sectionLabel: { fontSize: 12.5, marginBottom: 2 },
  ruledLine: {
    fontFamily: fonts.sans,
    fontSize: 15.5,
    lineHeight: 22,
    color: RP.ink,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderStyle: "dotted",
    borderColor: RP.rule,
  },
  stepRow: { flexDirection: "row", gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderStyle: "dotted", borderColor: RP.rule },
  stepNumber: { width: 20, textAlign: "right", fontFamily: serif, fontSize: 20, lineHeight: 22, color: RP.red },
  stepText: { flex: 1, fontFamily: fonts.sans, fontSize: 15.5, lineHeight: 22, color: RP.ink },
  tips: { fontFamily: serif, fontSize: 20, lineHeight: 26, color: RP.ink },
  sheetFooter: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 28, paddingTop: 18, borderTopWidth: 1, borderColor: RP.rule },
  hint: { marginTop: 8, fontFamily: fonts.sans, fontSize: 12.5, color: RP.inkSoft },
  field: {
    color: RP.ink,
    borderBottomWidth: 1,
    borderStyle: "dotted",
    borderColor: RP.inkSoft,
    paddingVertical: 4,
    paddingHorizontal: 0,
  },
  nameField: { fontFamily: serif, fontSize: 34, lineHeight: 38, marginTop: 6 },
  formMeta: { flexDirection: "row", gap: 16, marginTop: 18 },
  formMetaCell: { flex: 1, gap: 4 },
  metaField: { fontFamily: serif, fontSize: 22 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: RP.rule, paddingHorizontal: 14, paddingVertical: 7 },
  chipSelected: { backgroundColor: RP.red, borderColor: RP.red },
  chipText: { fontFamily: serif, fontSize: 16, color: RP.inkSoft },
  chipTextSelected: { color: RP.paper },
  areaLabelRow: { flexDirection: "row", alignItems: "baseline", gap: 10 },
  areaHint: { fontFamily: serif, fontSize: 14, color: RP.inkSoft },
  paperLine: { position: "absolute", left: 0, right: 0, borderBottomWidth: 1, borderStyle: "dotted", borderColor: RP.rule },
  area: {
    fontFamily: fonts.sans,
    fontSize: 15.5,
    lineHeight: LINE,
    color: RP.ink,
    paddingTop: Platform.OS === "ios" ? 4 : 2,
    paddingBottom: 0,
    paddingHorizontal: 0,
  },
  areaSerif: { fontFamily: serif, fontSize: 19 },
  editorBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(28,18,16,0.55)" },
  editorSheet: {
    backgroundColor: RP.paper,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 20,
    paddingTop: 18,
    maxHeight: "85%",
  },
  editorHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  editorTitle: { fontFamily: serif, fontSize: 26, color: RP.ink },
  editorDone: { fontFamily: fonts.sansMedium, fontSize: 15, color: RP.red },
  editorHint: { fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 19, color: RP.inkSoft, marginTop: 6, marginBottom: 8 },
  editorList: { flexGrow: 0 },
  editorRow: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6 },
  editorNameCol: { flex: 1, minWidth: 0 },
  editorName: { fontFamily: serif, fontSize: 21 },
  editorCount: { fontFamily: serif, fontSize: 13, color: RP.inkSoft, marginTop: 2 },
  arrowButton: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  editorDelete: { paddingHorizontal: 10, paddingVertical: 8 },
  editorDeleteText: { fontFamily: fonts.sans, fontSize: 13, color: RP.red },
  editorAddRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 14 },
});
