import { describe, expect, it } from "vitest";
import { parseGlossary } from "./glossary";

const md = `# Глоссарий

Вводный абзац.

## Счета

| Термин | Сокращение | Код | Описание |
|---|---|---|---|
| Paper-счёт | Paper | \`paper\` | Симуляция. |
| Real-счёт | — | — | Настоящий аккаунт. |

## Группы активов

| Термин | Сокращение | Код | Описание |
|---|---|---|---|
| USDⓈ-M фьючерсы | USDⓈ-M | \`FT:USDM\` | Маржа в USDT. |
`;

describe("parseGlossary", () => {
  it("секции и строки таблиц; прочерк — пустая строка; обратные кавычки кода снимаются", () => {
    expect(parseGlossary(md)).toEqual({
      sections: [
        {
          title: "Счета",
          terms: [
            {
              term: "Paper-счёт",
              abbr: "Paper",
              code: "paper",
              description: "Симуляция.",
            },
            {
              term: "Real-счёт",
              abbr: "",
              code: "",
              description: "Настоящий аккаунт.",
            },
          ],
        },
        {
          title: "Группы активов",
          terms: [
            {
              term: "USDⓈ-M фьючерсы",
              abbr: "USDⓈ-M",
              code: "FT:USDM",
              description: "Маржа в USDT.",
            },
          ],
        },
      ],
    });
  });

  it("строка с другим числом колонок — ошибка с номером строки", () => {
    const bad = `## Счета\n\n| Термин | Сокращение | Код | Описание |\n|---|---|---|---|\n| A | B |\n`;
    expect(() => parseGlossary(bad)).toThrow(/строка 5/);
  });

  it("секция без таблицы и пустой документ — без терминов", () => {
    expect(parseGlossary("## Пусто\n\nТекст.\n")).toEqual({
      sections: [{ title: "Пусто", terms: [] }],
    });
    expect(parseGlossary("")).toEqual({ sections: [] });
  });
});
