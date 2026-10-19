import { describe, expect, it } from "vitest";
import {
  buildRecipesExportHtml,
  DEFAULT_RECIPE_TABS,
  emptyRecipe,
  linesToList,
  moveTab,
  normalizeRecipesContent,
  recipeBookSections,
  recipeExportFilename,
  recipePatternTile,
  recipesInTab,
  removeTab,
} from "../recipes";
import { Recipe } from "../../api/customPages";

const recipe = (over: Partial<Recipe>): Recipe => ({ ...emptyRecipe("r", "entrantes"), ...over });

describe("normalizeRecipesContent", () => {
  it("sin contenido arranca con las cuatro pestañas de partida y sin recetas", () => {
    expect(normalizeRecipesContent(undefined)).toEqual({ tabs: DEFAULT_RECIPE_TABS, recipes: [] });
    expect(normalizeRecipesContent({}).tabs.map((t) => t.name)).toEqual(["Entrantes", "Verduras", "Carnes", "Repostería"]);
  });

  it("respeta una lista de pestañas vacía (el usuario las ha borrado todas)", () => {
    expect(normalizeRecipesContent({ tabs: [], recipes: [] }).tabs).toEqual([]);
  });

  it("descarta pestañas sin id o repetidas y da nombre a las que no lo tienen", () => {
    const { tabs } = normalizeRecipesContent({ tabs: [{ id: "a", name: "Sopas" }, { id: "a", name: "Otra" }, { name: "Sin id" }, { id: "b", name: "  " }] });
    expect(tabs).toEqual([
      { id: "a", name: "Sopas" },
      { id: "b", name: "Sin nombre" },
    ]);
  });

  it("completa los campos que faltan de una receta y limpia ingredientes y pasos vacíos", () => {
    const { recipes } = normalizeRecipesContent({
      tabs: [{ id: "t", name: "Postres" }],
      recipes: [{ id: "r1", tabId: "t", name: " Flan ", servings: 6, ingredients: ["Huevos", " ", "Leche "], steps: "Batir\n\nHornear", difficulty: "imposible" }],
    });
    expect(recipes).toEqual([
      { id: "r1", tabId: "t", name: "Flan", servings: "6", time: "", difficulty: null, ingredients: ["Huevos", "Leche"], steps: ["Batir", "Hornear"], tips: "" },
    ]);
  });

  it("una receta cuya pestaña ya no existe pasa a la primera pestaña", () => {
    const { recipes } = normalizeRecipesContent({ tabs: [{ id: "t", name: "Postres" }], recipes: [{ id: "r1", tabId: "borrada", name: "Flan" }] });
    expect(recipes[0].tabId).toBe("t");
  });
});

describe("linesToList", () => {
  it("parte por líneas (también \\r\\n), recorta y quita las vacías", () => {
    expect(linesToList("  200 g de harina \r\n\n2 huevos\n   ")).toEqual(["200 g de harina", "2 huevos"]);
  });
});

describe("recipesInTab", () => {
  it("devuelve solo las de esa pestaña, por orden alfabético sin distinguir mayúsculas ni acentos", () => {
    const recipes = [
      recipe({ id: "1", name: "tortilla" }),
      recipe({ id: "2", name: "Ánimo croquetas" }),
      recipe({ id: "3", name: "Bizcocho", tabId: "reposteria" }),
      recipe({ id: "4", name: "Albóndigas" }),
    ];
    expect(recipesInTab(recipes, "entrantes").map((r) => r.id)).toEqual(["4", "2", "1"]);
  });
});

describe("removeTab y moveTab", () => {
  const content = normalizeRecipesContent({
    tabs: DEFAULT_RECIPE_TABS,
    recipes: [recipe({ id: "1", tabId: "carnes" }), recipe({ id: "2", tabId: "verduras" })],
  });

  it("borrar una pestaña borra también sus recetas", () => {
    const next = removeTab(content, "carnes");
    expect(next.tabs.map((t) => t.id)).toEqual(["entrantes", "verduras", "reposteria"]);
    expect(next.recipes.map((r) => r.id)).toEqual(["2"]);
  });

  it("mueve una pestaña a izquierda y derecha, y en los extremos no hace nada", () => {
    expect(moveTab(content.tabs, "carnes", -1).map((t) => t.id)).toEqual(["entrantes", "carnes", "verduras", "reposteria"]);
    expect(moveTab(content.tabs, "carnes", 1).map((t) => t.id)).toEqual(["entrantes", "verduras", "reposteria", "carnes"]);
    expect(moveTab(content.tabs, "entrantes", -1)).toBe(content.tabs);
    expect(moveTab(content.tabs, "reposteria", 1)).toBe(content.tabs);
    expect(moveTab(content.tabs, "no-existe", 1)).toBe(content.tabs);
  });
});

describe("exportar", () => {
  const flan = recipe({ id: "f", tabId: "reposteria", name: "Flan <casero>", servings: "6", difficulty: "media", ingredients: ["Huevos", "Leche", "Azúcar"], steps: ["Caramelizar", "Hornear al baño maría"], tips: "Mejor de un día para otro" });
  const sopa = recipe({ id: "s", tabId: "entrantes", name: "Sopa" });
  const content = normalizeRecipesContent({ tabs: DEFAULT_RECIPE_TABS, recipes: [flan, sopa] });

  it("el recetario entero agrupa por pestaña, en el orden de las pestañas, y salta las vacías", () => {
    expect(recipeBookSections(content).map((s) => [s.tabName, s.recipes.map((r) => r.id)])).toEqual([
      ["Entrantes", ["s"]],
      ["Repostería", ["f"]],
    ]);
  });

  it("con portada lleva el índice, cada receta en su página y escapa el texto", () => {
    const html = buildRecipesExportHtml({ title: "Mis recetas", sections: recipeBookSections(content), format: "pdf", cover: true });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("2 recetas");
    expect(html).toContain("Flan &lt;casero&gt;");
    expect(html).not.toContain("Flan <casero>");
    expect(html).toContain("Hornear al baño maría");
    expect(html).toContain("●●○</span> Media");
    expect(html.match(/class="card[^"]*break/g)).toHaveLength(2); // las dos fichas empiezan página tras la portada
    expect(html).toContain('class="illus"');
  });

  it("una sola receta sin portada no fuerza salto de página; en Word va sin ilustración ni tipografías externas", () => {
    const html = buildRecipesExportHtml({ title: "Flan", sections: [{ tabName: "Repostería", recipes: [flan] }], format: "word", cover: false });
    expect(html).toContain("urn:schemas-microsoft-com:office:word");
    expect(html).not.toContain("Recetario");
    expect(html).not.toMatch(/class="card[^"]*break/);
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("fonts.googleapis.com");
  });

  it("los campos vacíos se exportan con su texto de vacío, no en blanco", () => {
    const html = buildRecipesExportHtml({ title: "Sopa", sections: [{ tabName: "Entrantes", recipes: [sopa] }], format: "pdf", cover: false });
    expect(html).toContain("Sin ingredientes apuntados.");
    expect(html).toContain("Sin pasos apuntados.");
    expect(html).toContain("Sin consejos todavía.");
  });

  it("nombre de archivo sin caracteres prohibidos y con su extensión", () => {
    expect(recipeExportFilename('Tarta: "la buena"', "pdf")).toBe("Tarta- -la buena-.pdf");
    expect(recipeExportFilename("  ", "word")).toBe("Recetas.doc");
  });
});

describe("recipePatternTile", () => {
  it("genera una baldosa SVG en el color pedido", () => {
    const svg = recipePatternTile("#8e1b25");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('viewBox="0 0 180 180"');
    expect(svg).toContain("#8e1b25");
    expect(svg).not.toContain("NaN");
  });
});
