import { describe, expect, it } from "vitest";
import { fitsWidth, pickTableFit, type TableFitMode } from "./table-fit";

describe("fitsWidth", () => {
  it("таблица не шире рамки — помещается, в том числе с дробным пикселем", () => {
    expect(fitsWidth(1374, 1374)).toBe(true);
    expect(fitsWidth(1374.4, 1374)).toBe(true);
  });

  it("таблица шире рамки — не помещается", () => {
    expect(fitsWidth(1376, 1374)).toBe(false);
  });
});

describe("pickTableFit", () => {
  const widths = (wide: number, wrap: number, frame: number) => {
    const tried: TableFitMode[] = [];
    const fit = pickTableFit((mode) => {
      tried.push(mode);
      return fitsWidth(mode === "wide" ? wide : wrap, frame);
    });
    return { fit, tried };
  };

  it("помещается с названиями в одну строку — wide, другие режимы не пробует", () => {
    expect(widths(1300, 1100, 1374)).toEqual({ fit: "wide", tried: ["wide"] });
  });

  it("помещается только с переносом названий — wrap", () => {
    expect(widths(1100, 900, 958)).toEqual({
      fit: "wrap",
      tried: ["wide", "wrap"],
    });
  });

  it("не помещается и с переносом — scroll", () => {
    expect(widths(1100, 900, 358).fit).toBe("scroll");
  });
});
