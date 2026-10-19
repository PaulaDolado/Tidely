import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { newId } from "../utils/id";
import {
  buildRecipesExportHtml,
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  emptyRecipe,
  linesToList,
  moveTab,
  normalizeRecipesContent,
  RECIPE_ILLUSTRATION,
  recipeBookSections,
  RecipeExportFormat,
  RecipeExportSection,
  recipeExportFilename,
  recipePatternTile,
  recipesInTab,
  removeTab,
} from "../utils/recipes";
import { downloadWordDocument, printHtmlDocument } from "../utils/notebookExport";
import { Recipe, RecipeDifficulty, RecipesContent } from "../types";

// Plantilla "recetas" de las páginas personalizadas (ver CustomPagePage): una caja de recetas de tela roja con filete
// dorado; dentro, un archivador con una pestaña por categoría (editables: renombrar, ordenar, añadir y borrar) y, en la
// pestaña elegida, sus tarjetas de receta. Cada tarjeta se abre en grande, como la ficha de papel, para leerla o
// editarla. Todo vive en `content` ({ tabs, recipes }); el componente es controlado y devuelve el contenido entero.

const PATTERN_URL = `url("data:image/svg+xml,${encodeURIComponent(recipePatternTile("#8e1b25"))}")`;

type Sheet = { recipeId: string; editing: boolean } | { draft: Recipe } | null;

function readActiveTab(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** PDF: el diálogo de impresión del navegador ("Guardar como PDF"), que toma el nombre del <title>. Word: descarga un .doc. */
function exportDocument(format: RecipeExportFormat, title: string, sections: RecipeExportSection[], cover: boolean) {
  const html = buildRecipesExportHtml({ title, sections, format, cover });
  if (format === "pdf") printHtmlDocument(html);
  else downloadWordDocument(html, recipeExportFilename(title, "word"));
}

export function RecipeBoxTemplate({
  pageId,
  title,
  content,
  onChange,
}: {
  pageId: number;
  title: string;
  content: unknown;
  onChange: (content: RecipesContent) => void;
}) {
  const data = useMemo(() => normalizeRecipesContent(content), [content]);
  const { tabs, recipes } = data;
  const activeKey = `tidely.recipes.tab.${pageId}`;

  const [storedTab, setStoredTab] = useState<string | null>(() => readActiveTab(activeKey));
  const [editingTabs, setEditingTabs] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);

  const activeTab = tabs.find((t) => t.id === storedTab) ?? tabs[0] ?? null;
  const visible = activeTab ? recipesInTab(recipes, activeTab.id) : [];

  const selectTab = (id: string) => {
    setStoredTab(id);
    try {
      localStorage.setItem(activeKey, id);
    } catch {
      // sin localStorage solo se pierde recordar la pestaña al recargar
    }
  };

  const saveRecipe = (recipe: Recipe) => {
    const exists = recipes.some((r) => r.id === recipe.id);
    onChange({ tabs, recipes: exists ? recipes.map((r) => (r.id === recipe.id ? recipe : r)) : [...recipes, recipe] });
    if (recipe.tabId !== activeTab?.id) selectTab(recipe.tabId);
    setSheet({ recipeId: recipe.id, editing: false });
  };

  const deleteRecipe = (id: string) => {
    onChange({ tabs, recipes: recipes.filter((r) => r.id !== id) });
    setSheet(null);
  };

  const openRecipe = sheet && "recipeId" in sheet ? (recipes.find((r) => r.id === sheet.recipeId) ?? null) : null;
  const draft = sheet && "draft" in sheet ? sheet.draft : null;

  return (
    <section className="recipe-box">
      <div className="recipe-cloth relative rounded-[10px] p-3 shadow-[0_18px_40px_-18px_rgb(60_10_15/0.55)] sm:p-5">
        {/* doble filete dorado de la tapa */}
        <span aria-hidden className="pointer-events-none absolute inset-[7px] rounded-[6px] border border-[var(--rp-gold)]/70" />
        <span aria-hidden className="pointer-events-none absolute inset-[11px] rounded-[4px] border border-[var(--rp-gold)]/35" />

        <div className="relative flex flex-col">
          <div className="flex items-end gap-3 px-1 pt-1 sm:px-2">
            <div role="tablist" aria-label="Pestañas del recetario" className="recipe-scroll -mb-px flex min-w-0 flex-1 items-end gap-1 overflow-x-auto overflow-y-hidden pt-2">
              {tabs.map((tab) => {
                const active = tab.id === activeTab?.id;
                const count = recipes.filter((r) => r.tabId === tab.id).length;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-controls="recipe-panel"
                    onClick={(e) => {
                      selectTab(tab.id);
                      e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
                    }}
                    className={`group relative shrink-0 cursor-pointer rounded-t-[10px] border border-b-0 px-4 pb-2 pt-2.5 transition-[transform,background-color] duration-200 ease-out sm:px-5 ${
                      active
                        ? "z-10 border-[var(--rp-rule)] bg-[var(--rp-paper)]"
                        : "translate-y-1.5 border-[var(--rp-rule)]/70 bg-[var(--rp-paper-shade)] hover:translate-y-0.5"
                    }`}
                  >
                    <span className="recipe-label whitespace-nowrap">{tab.name}</span>
                    <span className={`ml-2 font-serif text-xs tabular-nums ${active ? "text-[var(--rp-ink-soft)]" : "text-[var(--rp-ink-soft)]/80"}`}>{count}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setEditingTabs((v) => !v)}
              aria-pressed={editingTabs}
              aria-label={editingTabs ? "Terminar de editar las pestañas" : "Editar pestañas"}
              className="mb-2 flex shrink-0 cursor-pointer items-center gap-2 rounded-full border border-[var(--rp-gold)]/60 px-2.5 py-1.5 font-serif text-sm text-[var(--rp-gold)] transition-colors hover:bg-[var(--rp-gold)]/15 sm:px-3.5"
            >
              {editingTabs ? (
                "Listo"
              ) : (
                <>
                  <svg viewBox="0 0 16 16" className="size-4 sm:hidden" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M10.5 2.5 L13.5 5.5 L5.5 13.5 L2.5 13.5 L2.5 10.5 Z M8.5 4.5 L11.5 7.5" />
                  </svg>
                  <span className="hidden sm:inline">Editar pestañas</span>
                </>
              )}
            </button>
            <ExportMenu
              variant="box"
              label="Exportar recetario"
              disabled={recipes.length === 0}
              disabledHint="Aún no hay recetas que exportar"
              onExport={(format) => exportDocument(format, title || "Recetas", recipeBookSections(data), true)}
            />
          </div>

          <div
            id="recipe-panel"
            role="tabpanel"
            className="relative rounded-[10px] rounded-tl-none border border-[var(--rp-rule)] p-4 sm:p-6"
            style={{ backgroundColor: "var(--rp-paper)", backgroundImage: PATTERN_URL, backgroundSize: "180px 180px" }}
          >
            {editingTabs ? (
              <TabEditor data={data} onChange={onChange} onDeleted={(id) => id === activeTab?.id && setStoredTab(null)} />
            ) : activeTab ? (
              <>
                <div className="recipe-paper mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[4px] px-6 py-4">
                  <div className="flex items-baseline gap-3">
                    <h3 className="font-serif text-3xl leading-none text-[var(--rp-ink)]">{activeTab.name}</h3>
                    <span className="font-serif text-sm italic text-[var(--rp-ink-soft)]">
                      {visible.length === 1 ? "1 receta" : `${visible.length} recetas`}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSheet({ draft: emptyRecipe(newId(), activeTab.id) })}
                    className="flex cursor-pointer items-center gap-2 rounded-full bg-[var(--rp-red)] px-4 py-2 text-sm text-[var(--rp-paper)] shadow-[0_6px_14px_-8px_rgb(94_16_23/0.8)] transition-colors hover:bg-[var(--rp-red-deep)]"
                  >
                    <PlusIcon />
                    Nueva receta
                  </button>
                </div>

                {visible.length === 0 ? (
                  <div className="recipe-paper mx-auto flex max-w-md flex-col items-center gap-3 rounded-[4px] px-8 py-10 text-center">
                    <PotIllustration className="w-40 text-[var(--rp-ink)]" />
                    <p className="font-serif text-xl">Aún no hay recetas en {activeTab.name}.</p>
                    <p className="text-sm text-[var(--rp-ink-soft)]">Apunta la primera: raciones, tiempo, ingredientes y cómo se hace.</p>
                  </div>
                ) : (
                  <ul className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                    {visible.map((recipe) => (
                      <li key={recipe.id}>
                        <RecipeTile recipe={recipe} onOpen={() => setSheet({ recipeId: recipe.id, editing: false })} />
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <div className="recipe-paper mx-auto flex max-w-md flex-col items-center gap-3 rounded-[4px] px-8 py-10 text-center">
                <p className="font-serif text-xl">El archivador está vacío.</p>
                <button type="button" onClick={() => setEditingTabs(true)} className="cursor-pointer text-sm text-[var(--rp-red)] underline underline-offset-4">
                  Añade una pestaña para empezar
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {(openRecipe || draft) && (
        <RecipeSheet
          key={openRecipe?.id ?? "nueva"}
          recipe={openRecipe ?? draft!}
          isNew={!openRecipe}
          startEditing={!openRecipe || (sheet !== null && "editing" in sheet && sheet.editing)}
          tabs={tabs}
          onSave={saveRecipe}
          onDelete={deleteRecipe}
          onClose={() => setSheet(null)}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Tarjeta de la rejilla
// ---------------------------------------------------------------------------------------------------------------
function RecipeTile({ recipe, onOpen }: { recipe: Recipe; onOpen: () => void }) {
  const preview = recipe.ingredients.slice(0, 4).join(" · ");
  return (
    <button
      type="button"
      onClick={onOpen}
      className="recipe-paper group flex h-full w-full cursor-pointer flex-col gap-3 rounded-[4px] p-6 text-left shadow-[0_8px_18px_-14px_rgb(43_36_32/0.6)] transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-1 hover:shadow-[0_18px_28px_-18px_rgb(43_36_32/0.7)]"
    >
      <span className="recipe-label">Receta</span>
      <span className={`font-serif text-2xl leading-tight ${recipe.name ? "" : "italic text-[var(--rp-ink-soft)]"}`}>{recipe.name || "Sin nombre"}</span>
      <span className="grid grid-cols-3 gap-3 border-y border-dotted border-[var(--rp-rule)] py-2.5">
        <Meta label="Raciones" value={recipe.servings} />
        <Meta label="Tiempo" value={recipe.time} />
        <span className="flex flex-col gap-1">
          <span className="recipe-label text-[0.62rem]">Dificultad</span>
          <DifficultyMarks difficulty={recipe.difficulty} />
        </span>
      </span>
      <span className="line-clamp-2 text-sm text-[var(--rp-ink-soft)]">
        {preview || <span className="italic">Sin ingredientes apuntados</span>}
        {recipe.ingredients.length > 4 && ` · y ${recipe.ingredients.length - 4} más`}
      </span>
    </button>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <span className="recipe-label text-[0.62rem]">{label}</span>
      <span className="truncate font-serif text-lg leading-none">{value || "—"}</span>
    </span>
  );
}

function DifficultyMarks({ difficulty, large = false }: { difficulty: RecipeDifficulty | null; large?: boolean }) {
  const level = difficulty ? DIFFICULTIES.indexOf(difficulty) + 1 : 0;
  return (
    <span className="flex items-center gap-1.5" title={difficulty ? DIFFICULTY_LABELS[difficulty] : "Sin indicar"}>
      <span className="flex gap-1" aria-hidden>
        {[1, 2, 3].map((n) => (
          <svg key={n} viewBox="0 0 10 10" className={large ? "size-3" : "size-2.5"}>
            <circle cx="5" cy="5" r="4" fill={n <= level ? "var(--rp-red)" : "none"} stroke="var(--rp-red)" strokeWidth="1.2" />
          </svg>
        ))}
      </span>
      <span className={`font-serif leading-none ${large ? "text-lg" : "text-sm"} ${difficulty ? "" : "text-[var(--rp-ink-soft)]"}`}>
        {difficulty ? DIFFICULTY_LABELS[difficulty] : "—"}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Ficha grande: lectura y edición
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
  tabs: RecipesContent["tabs"];
  onSave: (recipe: Recipe) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(startEditing);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Solo al abrir: Escape cierra, la página de detrás no hace scroll y, en lectura, el foco va al botón de cerrar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!startEditing) closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tabName = tabs.find((t) => t.id === recipe.tabId)?.name ?? "";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={recipe.name || "Nueva receta"}
      className="recipe-box fixed inset-0 z-50 overflow-y-auto bg-[rgb(28_18_16/0.62)] px-3 py-6 sm:px-6 sm:py-12"
      onClick={onClose}
    >
      <article
        onClick={(e) => e.stopPropagation()}
        className="recipe-paper recipe-sheet-in relative mx-auto w-full max-w-3xl rounded-[6px] px-6 pb-8 pt-9 shadow-[0_30px_60px_-24px_rgb(20_10_8/0.65)] sm:px-12 sm:pb-12 sm:pt-12"
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute right-4 top-4 flex size-9 cursor-pointer items-center justify-center rounded-full text-[var(--rp-ink-soft)] transition-colors hover:bg-[var(--rp-paper-shade)] hover:text-[var(--rp-ink)]"
        >
          <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M3.5 3.5 L12.5 12.5 M12.5 3.5 L3.5 12.5" />
          </svg>
        </button>
        <PotIllustration className="pointer-events-none absolute right-12 top-10 hidden w-44 text-[var(--rp-ink)] opacity-90 md:block" />

        {editing ? (
          <RecipeForm
            recipe={recipe}
            isNew={isNew}
            tabs={tabs}
            onSave={onSave}
            onCancel={() => (isNew ? onClose() : setEditing(false))}
          />
        ) : (
          <>
            <header className="flex flex-col gap-2 md:pr-52">
              <span className="recipe-label">Receta{tabName && <span className="text-[var(--rp-ink-soft)]"> · {tabName}</span>}</span>
              <h2 className="font-serif text-4xl leading-[1.05] text-balance sm:text-5xl">{recipe.name || "Sin nombre"}</h2>
            </header>

            <div className="mt-7 grid grid-cols-3 gap-4 border-y border-dotted border-[var(--rp-rule)] py-4 sm:gap-8">
              <SheetMeta label="Raciones" value={recipe.servings} />
              <SheetMeta label="Tiempo" value={recipe.time} />
              <div className="flex flex-col gap-2">
                <span className="recipe-label">Dificultad</span>
                <DifficultyMarks difficulty={recipe.difficulty} large />
              </div>
            </div>

            <SheetSection title="Ingredientes">
              {recipe.ingredients.length > 0 ? (
                <ul className="grid gap-x-10 sm:grid-cols-2">
                  {recipe.ingredients.map((item, i) => (
                    <li key={i} className="border-b border-dotted border-[var(--rp-rule)] py-1.5 leading-relaxed">
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <Blank>Sin ingredientes apuntados.</Blank>
              )}
            </SheetSection>

            <SheetSection title="Elaboración">
              {recipe.steps.length > 0 ? (
                <ol className="flex flex-col">
                  {recipe.steps.map((step, i) => (
                    <li key={i} className="flex gap-4 border-b border-dotted border-[var(--rp-rule)] py-2.5 leading-relaxed">
                      <span className="w-6 shrink-0 text-right font-serif text-xl leading-6 text-[var(--rp-red)] tabular-nums">{i + 1}</span>
                      <span className="min-w-0 max-w-[68ch]">{step}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <Blank>Sin pasos apuntados.</Blank>
              )}
            </SheetSection>

            <SheetSection title="Consejos">
              {recipe.tips ? (
                <p className="max-w-[68ch] whitespace-pre-line font-serif text-xl italic leading-snug">{recipe.tips}</p>
              ) : (
                <Blank>Sin consejos todavía.</Blank>
              )}
            </SheetSection>

            <footer className="mt-10 flex flex-wrap items-center gap-3 border-t border-[var(--rp-rule)] pt-6">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="cursor-pointer rounded-full bg-[var(--rp-red)] px-5 py-2 text-sm text-[var(--rp-paper)] transition-colors hover:bg-[var(--rp-red-deep)]"
              >
                Editar receta
              </button>
              <ExportMenu
                variant="paper"
                label="Exportar receta"
                onExport={(format) => exportDocument(format, recipe.name || "Receta", [{ tabName, recipes: [recipe] }], false)}
              />
              <button
                type="button"
                onClick={() => (confirmingDelete ? onDelete(recipe.id) : setConfirmingDelete(true))}
                onBlur={() => setConfirmingDelete(false)}
                className={`cursor-pointer rounded-full px-5 py-2 text-sm transition-colors ${
                  confirmingDelete
                    ? "bg-[var(--rp-red-deep)] text-[var(--rp-paper)]"
                    : "border border-[var(--rp-rule)] text-[var(--rp-ink-soft)] hover:border-[var(--rp-red)] hover:text-[var(--rp-red)]"
                }`}
              >
                {confirmingDelete ? "¿Seguro? Pulsa otra vez" : "Eliminar receta"}
              </button>
            </footer>
          </>
        )}
      </article>
    </div>
  );
}

function SheetMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="recipe-label">{label}</span>
      <span className={`truncate font-serif text-2xl leading-none ${value ? "" : "text-[var(--rp-ink-soft)]"}`}>{value || "—"}</span>
    </div>
  );
}

function SheetSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-9 flex flex-col gap-3">
      <h3 className="recipe-label text-[0.8rem]">{title}</h3>
      {children}
    </section>
  );
}

function Blank({ children }: { children: ReactNode }) {
  return <p className="border-b border-dotted border-[var(--rp-rule)] py-1.5 font-serif italic text-[var(--rp-ink-soft)]">{children}</p>;
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
  tabs: RecipesContent["tabs"];
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

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
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
    <form onSubmit={submit} className="flex flex-col">
      <label className="flex flex-col gap-2 md:pr-52">
        <span className="recipe-label">{isNew ? "Nueva receta" : "Receta"}</span>
        <textarea
          autoFocus
          rows={1}
          value={name}
          onChange={(e) => setName(e.target.value.replace(/\n/g, " "))}
          onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
          placeholder="Nombre del plato"
          maxLength={120}
          className="recipe-field recipe-grow w-full resize-none pb-1 font-serif text-4xl leading-[1.05] text-balance sm:text-5xl"
        />
      </label>

      <div className="mt-7 grid gap-5 border-y border-dotted border-[var(--rp-rule)] py-4 sm:grid-cols-[1fr_1fr_auto] sm:gap-8">
        <label className="flex flex-col gap-2">
          <span className="recipe-label">Raciones</span>
          <input value={servings} onChange={(e) => setServings(e.target.value)} placeholder="4" maxLength={30} className="recipe-field w-full pb-1 font-serif text-2xl" />
        </label>
        <label className="flex flex-col gap-2">
          <span className="recipe-label">Tiempo</span>
          <input value={time} onChange={(e) => setTime(e.target.value)} placeholder="45 min" maxLength={30} className="recipe-field w-full pb-1 font-serif text-2xl" />
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="recipe-label mb-2">Dificultad</legend>
          <div className="flex gap-1.5">
            {DIFFICULTIES.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={difficulty === d}
                onClick={() => setDifficulty(difficulty === d ? null : d)}
                className={`cursor-pointer rounded-full border px-3 py-1 font-serif text-base transition-colors ${
                  difficulty === d
                    ? "border-[var(--rp-red)] bg-[var(--rp-red)] text-[var(--rp-paper)]"
                    : "border-[var(--rp-rule)] text-[var(--rp-ink-soft)] hover:border-[var(--rp-red)] hover:text-[var(--rp-red)]"
                }`}
              >
                {DIFFICULTY_LABELS[d]}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <FormArea label="Ingredientes" hint="Uno por línea" value={ingredients} onChange={setIngredients} rows={6} placeholder={"300 g de garbanzos cocidos\n2 dientes de ajo\nZumo de medio limón"} />
      <FormArea label="Elaboración" hint="Un paso por línea" value={steps} onChange={setSteps} rows={7} placeholder={"Tritura los garbanzos con el ajo.\nAñade el limón y el aceite poco a poco."} />
      <FormArea label="Consejos" value={tips} onChange={setTips} rows={3} placeholder="Lo que conviene recordar la próxima vez." serif />

      <label className="mt-8 flex flex-wrap items-center gap-3">
        <span className="recipe-label">Pestaña</span>
        <select value={tabId} onChange={(e) => setTabId(e.target.value)} className="recipe-field cursor-pointer py-1 pr-6 font-serif text-lg">
          {tabs.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>

      <footer className="mt-10 flex flex-wrap items-center gap-3 border-t border-[var(--rp-rule)] pt-6">
        <button
          type="submit"
          disabled={!name.trim()}
          className="cursor-pointer rounded-full bg-[var(--rp-red)] px-5 py-2 text-sm text-[var(--rp-paper)] transition-colors hover:bg-[var(--rp-red-deep)] disabled:cursor-not-allowed disabled:opacity-45"
        >
          {isNew ? "Guardar receta" : "Guardar cambios"}
        </button>
        <button type="button" onClick={onCancel} className="cursor-pointer rounded-full px-4 py-2 text-sm text-[var(--rp-ink-soft)] hover:text-[var(--rp-ink)]">
          Cancelar
        </button>
        {!name.trim() && <span className="text-xs italic text-[var(--rp-ink-soft)]">Ponle nombre al plato para guardarla.</span>}
      </footer>
    </form>
  );
}

function FormArea({
  label,
  hint,
  value,
  onChange,
  rows,
  placeholder,
  serif = false,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
  placeholder: string;
  serif?: boolean;
}) {
  return (
    <label className="mt-9 flex flex-col gap-2">
      <span className="flex items-baseline gap-3">
        <span className="recipe-label text-[0.8rem]">{label}</span>
        {hint && <span className="font-serif text-sm italic text-[var(--rp-ink-soft)]">{hint}</span>}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        style={{ minHeight: `calc(${rows} * 2rem)` }}
        className={`recipe-lined recipe-field recipe-grow w-full border-b-0 placeholder:italic ${serif ? "font-serif text-xl" : "text-base"}`}
      />
    </label>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Editor de pestañas
// ---------------------------------------------------------------------------------------------------------------
function TabEditor({ data, onChange, onDeleted }: { data: RecipesContent; onChange: (c: RecipesContent) => void; onDeleted: (id: string) => void }) {
  const [newName, setNewName] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  const rename = (id: string, name: string) => onChange({ ...data, tabs: data.tabs.map((t) => (t.id === id ? { ...t, name } : t)) });
  const add = (e: FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    onChange({ ...data, tabs: [...data.tabs, { id: newId(), name }] });
    setNewName("");
  };

  return (
    <div className="recipe-paper mx-auto flex max-w-2xl flex-col gap-1 rounded-[4px] px-6 py-6 sm:px-8">
      <h3 className="font-serif text-2xl">Pestañas del archivador</h3>
      <p className="mb-3 text-sm text-[var(--rp-ink-soft)]">Cámbiales el nombre, ordénalas o añade otras. Borrar una pestaña borra también sus recetas.</p>
      <ul className="flex flex-col">
        {data.tabs.map((tab, i) => {
          const count = data.recipes.filter((r) => r.tabId === tab.id).length;
          return (
            <li key={tab.id} className="flex items-center gap-2 py-1.5">
              <input
                value={tab.name}
                onChange={(e) => rename(tab.id, e.target.value)}
                onBlur={(e) => !e.target.value.trim() && rename(tab.id, "Sin nombre")}
                maxLength={40}
                aria-label={`Nombre de la pestaña ${i + 1}`}
                className="recipe-field min-w-0 flex-1 border-transparent py-1 font-serif text-xl hover:border-[var(--rp-rule)]"
              />
              <span className="w-20 shrink-0 text-right font-serif text-sm italic text-[var(--rp-ink-soft)]">{count === 1 ? "1 receta" : `${count} recetas`}</span>
              <IconButton label="Mover a la izquierda" disabled={i === 0} onClick={() => onChange({ ...data, tabs: moveTab(data.tabs, tab.id, -1) })}>
                <path d="M10 3.5 L5.5 8 L10 12.5" />
              </IconButton>
              <IconButton label="Mover a la derecha" disabled={i === data.tabs.length - 1} onClick={() => onChange({ ...data, tabs: moveTab(data.tabs, tab.id, 1) })}>
                <path d="M6 3.5 L10.5 8 L6 12.5" />
              </IconButton>
              <button
                type="button"
                onClick={() => {
                  if (confirming !== tab.id && count > 0) return setConfirming(tab.id);
                  onChange(removeTab(data, tab.id));
                  onDeleted(tab.id);
                  setConfirming(null);
                }}
                onBlur={() => setConfirming(null)}
                className={`shrink-0 cursor-pointer rounded-full px-3 py-1 text-xs transition-colors ${
                  confirming === tab.id
                    ? "bg-[var(--rp-red-deep)] text-[var(--rp-paper)]"
                    : "text-[var(--rp-ink-soft)] hover:bg-[var(--rp-paper-shade)] hover:text-[var(--rp-red)]"
                }`}
              >
                {confirming === tab.id ? `Borrar con ${count === 1 ? "su receta" : `sus ${count} recetas`}` : "Borrar"}
              </button>
            </li>
          );
        })}
      </ul>
      <form onSubmit={add} className="mt-4 flex items-center gap-3">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Nueva pestaña (p. ej. Pescados)"
          maxLength={40}
          className="recipe-field min-w-0 flex-1 py-1 font-serif text-xl"
        />
        <button
          type="submit"
          disabled={!newName.trim()}
          className="flex shrink-0 cursor-pointer items-center gap-2 rounded-full bg-[var(--rp-red)] px-4 py-2 text-sm text-[var(--rp-paper)] transition-colors hover:bg-[var(--rp-red-deep)] disabled:cursor-not-allowed disabled:opacity-45"
        >
          <PlusIcon />
          Añadir
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Exportar: botón con un menú de dos formatos. En la caja (todo el recetario) va en dorado sobre la tela; dentro de
// la ficha (solo esa receta), como un botón más del papel.
// ---------------------------------------------------------------------------------------------------------------
function ExportMenu({
  variant,
  label,
  disabled = false,
  disabledHint,
  onExport,
}: {
  variant: "box" | "paper";
  label: string;
  disabled?: boolean;
  disabledHint?: string;
  onExport: (format: RecipeExportFormat) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const choose = (format: RecipeExportFormat) => {
    setOpen(false);
    onExport(format);
  };

  const trigger =
    variant === "box"
      ? "mb-2 flex shrink-0 cursor-pointer items-center gap-2 rounded-full border border-[var(--rp-gold)]/60 px-2.5 py-1.5 font-serif text-sm text-[var(--rp-gold)] transition-colors hover:bg-[var(--rp-gold)]/15 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent sm:px-3.5"
      : "flex cursor-pointer items-center gap-2 rounded-full border border-[var(--rp-rule)] px-5 py-2 text-sm text-[var(--rp-ink)] transition-colors hover:border-[var(--rp-red)] hover:text-[var(--rp-red)]";

  return (
    <div
      ref={ref}
      className="relative"
      onKeyDown={(e) => {
        // Escape cierra el menú, no la ficha que hay debajo.
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        disabled={disabled}
        title={disabled ? disabledHint : label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={trigger}
      >
        <svg viewBox="0 0 16 16" className={`size-4 ${variant === "box" ? "sm:hidden" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M8 2.5 V10 M4.8 7 L8 10.2 L11.2 7 M3 12.5 H13" />
        </svg>
        <span className={variant === "box" ? "hidden sm:inline" : ""}>Exportar</span>
      </button>
      {open && (
        <div
          role="menu"
          className={`recipe-paper absolute z-20 flex w-56 flex-col rounded-[4px] p-2 shadow-[0_14px_30px_-12px_rgb(20_10_8/0.55)] ${
            variant === "box" ? "right-0 top-full mt-1" : "bottom-full left-0 mb-2"
          }`}
        >
          <span className="recipe-label px-3 pb-1 pt-2">{variant === "box" ? "Todo el recetario" : "Solo esta receta"}</span>
          {(
            [
              ["pdf", "PDF", "Para imprimir o guardar"],
              ["word", "Word (.doc)", "Para editarlo"],
            ] as const
          ).map(([format, name, hint]) => (
            <button
              key={format}
              type="button"
              role="menuitem"
              autoFocus={format === "pdf"}
              onClick={() => choose(format)}
              className="flex cursor-pointer flex-col items-start rounded-[3px] px-3 py-2 text-left transition-colors hover:bg-[var(--rp-paper-shade)] focus-visible:bg-[var(--rp-paper-shade)]"
            >
              <span className="font-serif text-lg leading-tight text-[var(--rp-ink)]">{name}</span>
              <span className="text-xs text-[var(--rp-ink-soft)]">{hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-[var(--rp-ink-soft)] transition-colors hover:bg-[var(--rp-paper-shade)] hover:text-[var(--rp-ink)] disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
    >
      <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <path d="M8 3 V13 M3 8 H13" />
    </svg>
  );
}

function PotIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 92" className={className} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {RECIPE_ILLUSTRATION.map((p, i) => (
        <path key={i} d={p.d} strokeWidth={p.width ?? 1.1} opacity={p.opacity} />
      ))}
    </svg>
  );
}
