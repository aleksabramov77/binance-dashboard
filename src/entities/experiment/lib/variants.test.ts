import { describe, expect, it } from "vitest";
import {
  enabledVariantsOf,
  variantLetter,
  variantLetters,
  variantsByControl,
} from "./variants";

const list = [
  { id: "F96", parentId: null, enabled: true },
  { id: "PS99", parentId: "F96", enabled: true },
  { id: "F97", parentId: "F96", enabled: true },
  { id: "F98", parentId: "F96", enabled: false },
  // Вариант варианта и вариант неизвестного контрольного — не варианты.
  { id: "F99", parentId: "F97", enabled: true },
  { id: "PF99", parentId: "F95", enabled: true },
];

describe("варианты эксперимента", () => {
  it("буквы по порядку id среди вариантов одного контрольного", () => {
    expect(Object.fromEntries(variantLetters(list))).toEqual({
      F97: "A",
      F98: "B",
      PS99: "C",
    });
    expect([0, 1, 25, 26, 27].map(variantLetter)).toEqual([
      "A",
      "B",
      "Z",
      "AA",
      "AB",
    ]);
  });

  it("группы: только контрольные без родителя и известные родители", () => {
    expect(
      [...variantsByControl(list)].map(([id, v]) => [id, v.map((e) => e.id)]),
    ).toEqual([["F96", ["F97", "F98", "PS99"]]]);
  });

  it("включённые варианты контрольного", () => {
    expect(enabledVariantsOf(list, "F96")).toEqual(["F97", "PS99"]);
    expect(enabledVariantsOf(list, "F97")).toEqual([]);
  });
});
