import { describe, expect, it } from "vitest";
import type { Glossary } from "@/shared/lib";
import { filterGlossary } from "./filterGlossary";

const g: Glossary = {
  sections: [
    {
      title: "Группы активов",
      terms: [
        {
          term: "Группа активов",
          abbr: "AG",
          code: "",
          description: "Asset Group.",
        },
        {
          term: "USDⓈ-M фьючерсы",
          abbr: "USDⓈ-M",
          code: "FT:USDM",
          description: "Маржа в USDT.",
        },
      ],
    },
    {
      title: "Метрики",
      terms: [
        {
          term: "Profit factor",
          abbr: "PF",
          code: "profitFactor",
          description: "Σ прибылей / Σ убытков.",
        },
      ],
    },
  ],
};

describe("filterGlossary", () => {
  it("пустой запрос (и пробелы) — всё целиком", () => {
    expect(filterGlossary(g, "")).toEqual(g);
    expect(filterGlossary(g, "   ")).toEqual(g);
  });
  it("ищет без учёта регистра по термину, сокращению, коду и описанию; секции без совпадений исчезают", () => {
    expect(filterGlossary(g, "ft:usdm").sections).toEqual([
      { title: "Группы активов", terms: [g.sections[0].terms[1]] },
    ]);
    expect(filterGlossary(g, "прибыл").sections.map((s) => s.title)).toEqual([
      "Метрики",
    ]);
    expect(
      filterGlossary(g, "ag").sections[0].terms.map((t) => t.abbr),
    ).toEqual(["AG"]);
  });
  it("нет совпадений — пустой список секций", () => {
    expect(filterGlossary(g, "xyz")).toEqual({ sections: [] });
  });
});
