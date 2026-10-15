import { describe, expect, it } from "vitest";
import { CustomPageTemplate } from "../../types";
import { CUSTOM_PAGE_TEMPLATE_META, CUSTOM_PAGE_TEMPLATES, primarySectionPage } from "../customPageTemplates";

function page(id: number, order: number, template: CustomPageTemplate) {
  return { id, order, template };
}

describe("customPageTemplates", () => {
  describe("primarySectionPage", () => {
    it("elige la primera página de esa plantilla por orden", () => {
      const pages = [page(1, 5, "viajes"), page(2, 0, "galeria"), page(3, 2, "viajes"), page(4, 1, "nota")];
      expect(primarySectionPage(pages, "viajes")?.id).toBe(3);
      expect(primarySectionPage(pages, "galeria")?.id).toBe(2);
    });

    it("si empatan en orden, la de menor id", () => {
      const pages = [page(9, 1, "estudio"), page(4, 1, "estudio"), page(7, 3, "estudio")];
      expect(primarySectionPage(pages, "estudio")?.id).toBe(4);
    });

    it("null si no hay ninguna página de esa plantilla", () => {
      expect(primarySectionPage([page(1, 0, "nota")], "viajes")).toBeNull();
      expect(primarySectionPage([], "galeria")).toBeNull();
    });

    it("no reordena la lista recibida", () => {
      const pages = [page(2, 1, "viajes"), page(1, 0, "viajes")];
      primarySectionPage(pages, "viajes");
      expect(pages.map((p) => p.id)).toEqual([2, 1]);
    });
  });

  describe("CUSTOM_PAGE_TEMPLATE_META", () => {
    it("tiene una entrada por plantilla, indexada por su clave", () => {
      for (const t of CUSTOM_PAGE_TEMPLATES) expect(CUSTOM_PAGE_TEMPLATE_META[t.key]).toBe(t);
      expect(Object.keys(CUSTOM_PAGE_TEMPLATE_META)).toHaveLength(CUSTOM_PAGE_TEMPLATES.length);
    });
  });
});
