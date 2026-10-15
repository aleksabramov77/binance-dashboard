import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ASSET_GROUP_DESCRIPTION, ASSET_GROUPS } from "@/entities/experiment";
import { parseGlossary } from "@/shared/lib";
import glossary from "./glossary.json";

describe("glossary.json", () => {
  it("совпадает с docs/ai/glossary.md (иначе — запусти pnpm glossary)", () => {
    const md = readFileSync(
      path.join(process.cwd(), "docs/ai/glossary.md"),
      "utf8",
    );
    expect(glossary, "JSON отстал от markdown: запусти pnpm glossary").toEqual(
      parseGlossary(md),
    );
  });

  it("содержит обязательные термины", () => {
    const codes = glossary.sections.flatMap((s) => s.terms.map((t) => t.code));
    const abbrs = glossary.sections.flatMap((s) => s.terms.map((t) => t.abbr));
    expect(codes).toEqual(
      expect.arrayContaining([
        "SPOT",
        "FT:USDM",
        "FT:COINM",
        "rejected",
        "skipped",
      ]),
    );
    expect(abbrs).toEqual(
      expect.arrayContaining(["AG", "Paper", "Demo", "Real", "PF", "Max DD"]),
    );
  });

  it("описание AG и коды групп совпадают с entities/experiment", () => {
    const ag = glossary.sections
      .flatMap((s) => s.terms)
      .find((t) => t.abbr === "AG");
    expect(ag?.description).toBe(ASSET_GROUP_DESCRIPTION);
    const codes = glossary.sections.flatMap((s) => s.terms.map((t) => t.code));
    for (const g of Object.values(ASSET_GROUPS))
      expect(codes).toContain(g.code);
  });
});
