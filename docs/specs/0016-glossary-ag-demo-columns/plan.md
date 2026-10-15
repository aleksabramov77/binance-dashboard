# 0016 · Глоссарий и справка, AG, демо-метрики, переход к логам — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Один глоссарий (`docs/ai/glossary.md`) как источник истины для AI и страницы `/help`; колонка AG и демо-метрики (PF, Max DD, Equity) с выделением цветом в `/experiments`; отказы и пропуски зеркала в журнале с переходом по ссылке с URL-фильтрами; два текстовых бага.

**Architecture:** Markdown-глоссарий разбирается чистым парсером (`src/shared/lib/glossary.ts`) в JSON, который коммитится и рендерится клиентской страницей `src/pages/help`; тест держит JSON в синхроне с markdown. Группы активов — одна карта `ASSET_GROUPS` в `entities/experiment` (market → код/название), демо-метрики — чистая `computeDemoStats` на PnL закрытых демо-сделок из `mirrorSummaries`. Отказы/пропуски логируются в композиции `src/app/server/demoMirror.ts`; `readLogs` получает фильтры `events`, `experiment`, `days`, страница логов хранит их в URL (nuqs).

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript strict, Zod 4, TanStack Query, nuqs, Drizzle + PGlite (тесты через `createMemoryDb`), Tailwind 4 + shadcn/ui, Vitest, Biome, Steiger.

**Spec:** `docs/specs/0016-glossary-ag-demo-columns.md` (worktree `/Users/aleksandr/Projects/my/binance-dashboard_0016-glossary-ag-demo-columns`, ветка `feature/0016-glossary-ag-demo-columns`).

## Global Constraints

- Работать только в worktree `~/Projects/my/binance-dashboard_0016-glossary-ag-demo-columns`; коммиты `0016: что сделано` (по-русски), автор `Aleksandr Abramov <aleksabramov77@gmail.com>`; в main не пушить.
- Новых npm-зависимостей нет (AC3). Markdown-рендер общего вида не делаем — только структурированный глоссарий.
- Коды групп активов: `SPOT`, `FT:USDM`, `FT:COINM`; сокращение «Группа активов» — `AG`. Внутренние значения `market` остаются `spot` / `futures`.
- Demo Equity = `initial_budget` эксперимента + Σ PnL закрытых демо-сделок после демо-сброса; PF и Max DD — те же формулы, что paper (`computeStats`).
- FSD: импорт только вниз, слайсы одного слоя друг друга не импортируют, deep imports запрещены (Biome `noRestrictedImports`); `shared` не содержит доменных слов (глоссарий-парсер — generic, JSON лежит в `src/pages/help/config`).
- Страницы — `"use client"` + `Suspense` при использовании nuqs (как `LogsPage`); роут в корневом `app/<route>/page.tsx` только реэкспортирует страницу.
- Тесты — Vitest, `*.test.ts` рядом с кодом; БД-тесты через `createMemoryDb()` с таймаутом 30 000 мс.
- Перед каждым коммитом: `pnpm lint` (Biome) зелёный; перед отчётом — `pnpm check && pnpm build`.
- Цвет демо-колонок (Task 4) утверждает пользователь: показать 3 варианта скриншотами, итог записать в журнал spec.

## Review Focus

1. **Markdown-таблица с лишними или недостающими колонками** (строка `| A | B |` в секции глоссария) — парсер должен бросить понятную ошибку с номером строки, а не молча выдать `undefined`. Тест — Task 1.
2. **`experiment` в `/api/logs` с SQL-спецсимволами** (`F03' OR 1=1`) — фильтр через параметризованный `sql` Drizzle, записи других экспериментов не возвращаются. Тест — Task 5.
3. **`days` вне диапазона** (`0`, `99`, `abc`) — зажимается в 1…14, не 500. Тест — Task 5.
4. **Демо-сделка закрыта без цены выхода** (`exit_price` и paper `exit_price` оба null) — не попадает в PnL/PF/DD, `closed` всё равно растёт; `equity` = бюджет без NaN. Тест — Task 4.
5. **Поиск на `/help` по пустой строке и по коду с двоеточием** (`FT:USDM`) — показывает все термины / находит группу. Тест-функция `filterGlossary` — Task 2.

---

### Task 1: Глоссарий — markdown, парсер, генератор JSON, тест синхронизации

**Files:**
- Create: `docs/ai/glossary.md`
- Create: `src/shared/lib/glossary.ts`
- Create: `src/shared/lib/glossary.test.ts`
- Create: `scripts/glossary.ts`
- Create: `src/pages/help/config/glossary.json` (генерируется)
- Create: `src/pages/help/config/glossary.test.ts`
- Modify: `src/shared/lib/index.ts` (экспорт парсера)
- Modify: `package.json` (скрипт `glossary`)
- Modify: `docs/ai/README.md` (строка в таблице)

**Interfaces:**
- Produces: `parseGlossary(markdown: string): Glossary`, где
  `type GlossaryTerm = { term: string; abbr: string; code: string; description: string }`,
  `type GlossarySection = { title: string; terms: GlossaryTerm[] }`, `type Glossary = { sections: GlossarySection[] }`.
  JSON-файл `src/pages/help/config/glossary.json` имеет форму `Glossary`.

- [ ] **Step 1: Написать `docs/ai/glossary.md`**

Формат строгий: `# Глоссарий`, вводный абзац, затем секции `## <Раздел>` и в каждой одна таблица с шапкой `| Термин | Сокращение | Код | Описание |`. Пустое сокращение/код — `—`. Содержимое (дополнять, не сокращать):

```markdown
# Глоссарий

Источник истины для терминов и сокращений дашборда. Страница `/help` показывает этот файл: после правки
запусти `pnpm glossary` (тест `src/pages/help/config/glossary.test.ts` проверяет, что JSON не отстал).
Формат фиксирован: секции `##`, в каждой таблица «Термин · Сокращение · Код · Описание»; прочерк — «—».

## Счета

| Термин | Сокращение | Код | Описание |
|---|---|---|---|
| Paper-счёт | Paper | `paper` | Симуляция в движке лаборатории на реальных свечах Binance: ордера не отправляются, у каждого эксперимента свой бюджет ($10 000 по умолчанию), сделки по ~$50. |
| Demo-счёт | Demo | `demo` | Binance Demo Trading (demo.binance.com): виртуальные деньги, настоящая биржа, исполнение и минимальные объёмы. Один общий счёт на все эксперименты; стартовые наборы выдаёт Binance (Spot: 5 000 USDC + 5 000 USDT; USDⓈ-M: то же + 0,01 BTC; COIN-M: корзина монет). Сброс баланса — только кнопкой на demo.binance.com, API-метода нет. |
| Real-счёт | Real | `real` | Настоящий аккаунт Binance. Пока только чтение портфеля (read-only ключ); торговля с него не ведётся. |

## Группы активов

| Термин | Сокращение | Код | Описание |
|---|---|---|---|
| Группа активов | AG | — | Asset Group — кошелёк Binance со своим набором инструментов и своим балансом: Spot, USDⓈ-M, COIN-M. У каждого эксперимента одна группа; статистика, бюджеты и сбросы считаются по группам. |
| Спот | Spot | `SPOT` | Спотовый рынок: покупка и продажа монет за USDT, только лонг. В коде и БД — `market = spot`. |
| USDⓈ-M фьючерсы | USDⓈ-M | `FT:USDM` | Бессрочные фьючерсы с маржой в стейблкоинах (USDT/USDC): лонг и шорт, плечо 1 в лаборатории. В коде и БД — `market = futures`. |
| COIN-M фьючерсы | COIN-M | `FT:COINM` | Фьючерсы с маржой в самой монете (BTCUSD_PERP и т.п.), контракты по $100/$10. В лаборатории пока не торгуется — задача D. |

## Лаборатория

| Термин | Сокращение | Код | Описание |
|---|---|---|---|
| Эксперимент | — | `S01`…`S20`, `F01`…`F20` | Paper-стратегия с гипотезой, конфигом (вход, выход, юниверс, направления) и своим бюджетом. S — Spot, F — USDⓈ-M. |
| Стратегия | — | — | Правила входа и выхода эксперимента из торгового ядра `trading-core`. |
| Эпоха | run | `runs` | Период учёта Paper между сбросами «всех Paper»: у каждой эпохи свой id и дата старта; статистика по умолчанию — за текущую эпоху. |
| Сброс | — | — | Paper: закрыть открытые сделки по последней цене и начать учёт заново (все — новая эпоха; один эксперимент — `reset_at`). Demo: закрыть демо-позиции по рынку и начать демо-статистику заново (`demo_reset_at`); баланс на бирже сбрасывает пользователь. |
| Юниверс | — | — | Набор монет, из которых эксперимент выбирает входы: мажоры, топ-N по обороту, движущиеся, список. |
| Бюджет | — | `initial_budget` | Стартовый капитал эксперимента в эпохе, $. |
| Тик | — | — | Один прогон движка раз в минуту: закрытие свечей, проверка выходов, новые входы. |
| Движок | — | — | Серверный цикл лаборатории (`features/paper-engine`); тумблер «Автоторговля» в шапке. |

## Демо-зеркало

| Термин | Сокращение | Код | Описание |
|---|---|---|---|
| Демо-зеркало | зеркало | `demo_mirror` | Повтор входов отмеченных экспериментов на Demo-счёте с тем же объёмом, стопом и тейком; закрывается вместе с paper-сделкой. |
| Отказ | — | `rejected` | Биржа или предпроверка не приняли вход (монеты нет на демо-рынке, объём ниже минимума, стоп отклонён): позиция не открыта или сразу закрыта. |
| Пропуск | — | `skipped` | Зеркало само не повторяло вход: вход старше 10 минут, пара не к USDT, монета уже занята. Запроса на биржу не было. |
| Статус зеркала | — | `pending`, `protected`, `unprotected`, `closing`, `closed`, `close_failed` | Отправляется · открыта с TP/SL · открыта без защиты · закрывается · закрыта · не закрылась (повтор каждую минуту). |

## Метрики

| Термин | Сокращение | Код | Описание |
|---|---|---|---|
| PnL | PnL | `pnl` | Реализованная прибыль или убыток закрытых сделок, $. Paper — после комиссий; Demo — без комиссий, (выход − вход) × количество. |
| Доля прибыльных | Win rate | `winRate` | Доля сделок с PnL > 0 среди закрытых. |
| Profit factor | PF | `profitFactor` | Σ прибылей / Σ убытков закрытых сделок; больше 1 — стратегия зарабатывает; ∞ — убытков ещё не было. |
| Максимальная просадка | Max DD | `maxDrawdownPct` | Наибольшее падение equity от предыдущего пика, в % от пика. |
| Equity | — | `equity` | Капитал: стартовый бюджет + Σ PnL закрытых сделок. Demo: бюджет эксперимента + Σ PnL демо-сделок после демо-сброса. |
| R | R | `rMultiple` | Результат сделки в долях риска до стопа: +2 R — заработали два риска. |
| Комиссии | — | `fees` | Комиссии биржи: spot 0,1 %, фьючерсы 0,05 % (paper). |

## Сигналы

| Термин | Сокращение | Код | Описание |
|---|---|---|---|
| Сетап | — | — | Рыночная ситуация, которую ищет сканер: отскок после падения, перегрев после роста, продолжение тренда. |
| Сигнал | — | — | Конкретная монета с сетапом и статусом «можно входить» / «ждём разворота»; из карточки — сделка в 1 клик на Demo. |
```

- [ ] **Step 2: Написать падающий тест парсера `src/shared/lib/glossary.test.ts`**

```ts
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
            { term: "Paper-счёт", abbr: "Paper", code: "paper", description: "Симуляция." },
            { term: "Real-счёт", abbr: "", code: "", description: "Настоящий аккаунт." },
          ],
        },
        {
          title: "Группы активов",
          terms: [
            { term: "USDⓈ-M фьючерсы", abbr: "USDⓈ-M", code: "FT:USDM", description: "Маржа в USDT." },
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
```

- [ ] **Step 3: Запустить тест — должен упасть**

Run: `pnpm vitest run src/shared/lib/glossary.test.ts`
Expected: FAIL — `Cannot find module './glossary'`.

- [ ] **Step 4: Реализовать `src/shared/lib/glossary.ts`**

```ts
// Разбор глоссария из markdown (docs/ai/glossary.md): секции `##` и таблицы
// «Термин · Сокращение · Код · Описание». Чистая функция, без доменных знаний — её используют
// scripts/glossary.ts (генерация JSON для /help) и тест синхронизации.

export interface GlossaryTerm {
  term: string;
  abbr: string;
  code: string;
  description: string;
}

export interface GlossarySection {
  title: string;
  terms: GlossaryTerm[];
}

export interface Glossary {
  sections: GlossarySection[];
}

const HEADER = ["Термин", "Сокращение", "Код", "Описание"];

/** Ячейка таблицы: прочерк → "", обрамляющие обратные кавычки снимаются. */
function cell(raw: string): string {
  const v = raw.trim();
  if (v === "—" || v === "-") return "";
  return v.replace(/^`(.*)`$/, "$1");
}

/** `| a | b |` → ["a", "b"]; null, если строка — не строка таблицы. */
function splitRow(line: string): string[] | null {
  const t = line.trim();
  if (!t.startsWith("|")) return null;
  return t.slice(1, t.endsWith("|") ? -1 : undefined).split("|");
}

export function parseGlossary(markdown: string): Glossary {
  const sections: GlossarySection[] = [];
  let current: GlossarySection | null = null;
  let headerSeen = false;
  const lines = markdown.split("\n");
  lines.forEach((line, i) => {
    const no = i + 1;
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      current = { title: h[1], terms: [] };
      sections.push(current);
      headerSeen = false;
      return;
    }
    const cells = splitRow(line);
    if (!cells || !current) return;
    if (/^\s*\|?\s*-{3,}/.test(line)) return; // разделитель шапки
    const values = cells.map((c) => c.trim());
    if (!headerSeen) {
      if (values.join("|") !== HEADER.join("|"))
        throw new Error(`Глоссарий, строка ${no}: шапка должна быть «${HEADER.join(" · ")}»`);
      headerSeen = true;
      return;
    }
    if (cells.length !== HEADER.length)
      throw new Error(`Глоссарий, строка ${no}: ожидалось ${HEADER.length} колонки, получено ${cells.length}`);
    current.terms.push({
      term: cell(cells[0]),
      abbr: cell(cells[1]),
      code: cell(cells[2]),
      description: cell(cells[3]),
    });
  });
  return { sections };
}
```

Добавить в `src/shared/lib/index.ts`:

```ts
export {
  type Glossary,
  type GlossarySection,
  type GlossaryTerm,
  parseGlossary,
} from "./glossary";
```

- [ ] **Step 5: Запустить тест — должен пройти**

Run: `pnpm vitest run src/shared/lib/glossary.test.ts`
Expected: PASS (3 теста).

- [ ] **Step 6: Генератор `scripts/glossary.ts` и скрипт в `package.json`**

```ts
// `pnpm glossary` — пересобрать src/pages/help/config/glossary.json из docs/ai/glossary.md.
// Источник истины — markdown (его читает AI); JSON коммитится и рендерится страницей /help.
// Тест src/pages/help/config/glossary.test.ts падает, если JSON отстал.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseGlossary } from "@/shared/lib/glossary";

const root = process.cwd();
const source = path.join(root, "docs/ai/glossary.md");
const target = path.join(root, "src/pages/help/config/glossary.json");

const glossary = parseGlossary(readFileSync(source, "utf8"));
const terms = glossary.sections.reduce((n, s) => n + s.terms.length, 0);
writeFileSync(target, `${JSON.stringify(glossary, null, 2)}\n`);
console.log(`[glossary] ${terms} терминов в ${glossary.sections.length} секциях → ${path.relative(root, target)}`);
```

В `package.json` → `scripts`, после `"lab:apply"`: `"glossary": "tsx scripts/glossary.ts",`.

Run: `pnpm glossary` → файл `src/pages/help/config/glossary.json` создан. Повторный `pnpm glossary` → `git status` не показывает изменений (идемпотентность, AC2).

- [ ] **Step 7: Тест синхронизации `src/pages/help/config/glossary.test.ts`**

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseGlossary } from "@/shared/lib";
import glossary from "./glossary.json";

describe("glossary.json", () => {
  it("совпадает с docs/ai/glossary.md (иначе — запусти pnpm glossary)", () => {
    const md = readFileSync(path.join(process.cwd(), "docs/ai/glossary.md"), "utf8");
    expect(glossary, "JSON отстал от markdown: запусти pnpm glossary").toEqual(parseGlossary(md));
  });

  it("содержит обязательные термины", () => {
    const codes = glossary.sections.flatMap((s) => s.terms.map((t) => t.code));
    const abbrs = glossary.sections.flatMap((s) => s.terms.map((t) => t.abbr));
    expect(codes).toEqual(expect.arrayContaining(["SPOT", "FT:USDM", "FT:COINM", "rejected", "skipped"]));
    expect(abbrs).toEqual(expect.arrayContaining(["AG", "Paper", "Demo", "Real", "PF", "Max DD"]));
  });
});
```

Run: `pnpm vitest run src/pages/help/config/glossary.test.ts` → PASS. `resolveJsonModule` уже включён в tsconfig; импорт `import glossary from "./glossary.json"` допустим.

- [ ] **Step 8: Строка в `docs/ai/README.md`**

В таблицу файлов после строки `workflow.md` добавить:

```markdown
| [`glossary.md`](glossary.md) | Глоссарий терминов и сокращений (AG, Paper/Demo/Real, эпоха, PF…) — источник истины для `/help` (`pnpm glossary`) |
```

- [ ] **Step 9: Проверка и коммит**

Run: `pnpm lint && pnpm vitest run src/shared/lib/glossary.test.ts src/pages/help/config/glossary.test.ts`
Expected: PASS, Biome без ошибок.

```bash
git add docs/ai/glossary.md docs/ai/README.md src/shared/lib/glossary.ts src/shared/lib/glossary.test.ts src/shared/lib/index.ts scripts/glossary.ts src/pages/help/config/glossary.json src/pages/help/config/glossary.test.ts package.json
git commit -m "0016: глоссарий docs/ai/glossary.md, парсер и pnpm glossary → JSON для справки"
```

---

### Task 2: Страница `/help` — глоссарий с поиском и ссылки на документацию

**Files:**
- Create: `src/pages/help/lib/filterGlossary.ts`
- Create: `src/pages/help/lib/filterGlossary.test.ts`
- Create: `src/pages/help/ui/HelpPage.tsx`
- Create: `src/pages/help/index.ts`
- Create: `app/help/page.tsx`
- Create: `src/shared/config/repo.ts`
- Modify: `src/shared/config/index.ts`, `src/shared/config/navigation.ts`
- Modify: `docs/ai/architecture.md:45` (строка «Платформа»: добавить `pages/help`)

**Interfaces:**
- Consumes: `Glossary` из Task 1 (`@/shared/lib`), `src/pages/help/config/glossary.json`.
- Produces: `filterGlossary(glossary: Glossary, query: string): Glossary` (секции без совпадений выбрасываются); `REPO_URL`, `docUrl(relativePath: string): string` в `@/shared/config`.

- [ ] **Step 1: Тест `src/pages/help/lib/filterGlossary.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import type { Glossary } from "@/shared/lib";
import { filterGlossary } from "./filterGlossary";

const g: Glossary = {
  sections: [
    {
      title: "Группы активов",
      terms: [
        { term: "Группа активов", abbr: "AG", code: "", description: "Asset Group." },
        { term: "USDⓈ-M фьючерсы", abbr: "USDⓈ-M", code: "FT:USDM", description: "Маржа в USDT." },
      ],
    },
    { title: "Метрики", terms: [{ term: "Profit factor", abbr: "PF", code: "profitFactor", description: "Σ прибылей / Σ убытков." }] },
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
    expect(filterGlossary(g, "прибыл").sections.map((s) => s.title)).toEqual(["Метрики"]);
    expect(filterGlossary(g, "ag").sections[0].terms.map((t) => t.abbr)).toEqual(["AG"]);
  });
  it("нет совпадений — пустой список секций", () => {
    expect(filterGlossary(g, "xyz")).toEqual({ sections: [] });
  });
});
```

Run: `pnpm vitest run src/pages/help/lib/filterGlossary.test.ts` → FAIL (модуля нет).

- [ ] **Step 2: Реализовать `src/pages/help/lib/filterGlossary.ts`**

```ts
import type { Glossary } from "@/shared/lib";

/** Поиск по глоссарию: подстрока без учёта регистра в термине, сокращении, коде или описании. */
export function filterGlossary(glossary: Glossary, query: string): Glossary {
  const q = query.trim().toLocaleLowerCase("ru-RU");
  if (!q) return glossary;
  const hit = (s: string) => s.toLocaleLowerCase("ru-RU").includes(q);
  return {
    sections: glossary.sections
      .map((s) => ({
        title: s.title,
        terms: s.terms.filter((t) => hit(t.term) || hit(t.abbr) || hit(t.code) || hit(t.description)),
      }))
      .filter((s) => s.terms.length > 0),
  };
}
```

Run: `pnpm vitest run src/pages/help/lib/filterGlossary.test.ts` → PASS.

- [ ] **Step 3: `src/shared/config/repo.ts` и экспорт**

```ts
/** Репозиторий проекта на GitHub — ссылки на документацию со страницы /help. */
export const REPO_URL = "https://github.com/aleksabramov77/binance-dashboard";

/** Ссылка на файл репозитория в main: docUrl("docs/ai/glossary.md"). */
export const docUrl = (relativePath: string) => `${REPO_URL}/blob/main/${relativePath}`;
```

В `src/shared/config/index.ts` добавить: `export { docUrl, REPO_URL } from "./repo";`.

В `src/shared/config/navigation.ts` добавить последним пунктом: `{ href: "/help", label: "Справка" },`.

- [ ] **Step 4: Страница `src/pages/help/ui/HelpPage.tsx`**

```tsx
"use client";

import { useMemo, useState } from "react";
import { docUrl } from "@/shared/config";
import type { Glossary } from "@/shared/lib";
import { Input } from "@/shared/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import glossaryJson from "../config/glossary.json";
import { filterGlossary } from "../lib/filterGlossary";

const GLOSSARY = glossaryJson as Glossary;

const DOCS = [
  { path: "docs/ai/glossary.md", title: "Глоссарий", note: "источник истины этой страницы" },
  { path: "docs/ai/README.md", title: "Документация для AI", note: "архитектура, соглашения, процессы" },
  { path: "docs/PRD.md", title: "PRD", note: "требования, решения, журнал этапов" },
  { path: "docs/specs/", title: "ТЗ задач", note: "spec каждой фичи и бага" },
];

function Section({ title, terms }: Glossary["sections"][number]) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-48">Термин</TableHead>
              <TableHead className="w-28">Сокращение</TableHead>
              <TableHead className="w-40">Код</TableHead>
              <TableHead>Описание</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {terms.map((t) => (
              <TableRow key={`${title}-${t.term}`}>
                <TableCell className="font-medium whitespace-normal">{t.term}</TableCell>
                <TableCell>{t.abbr || <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="font-mono text-xs whitespace-normal">
                  {t.code || <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="whitespace-normal text-muted-foreground">{t.description}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

export function HelpPage() {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => filterGlossary(GLOSSARY, query), [query]);
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Справка</h1>
          <p className="text-sm text-muted-foreground">
            Термины и сокращения дашборда. Источник — <code>docs/ai/glossary.md</code> в репозитории.
          </p>
        </div>
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск: термин, сокращение, код…"
          className="w-72"
          aria-label="Поиск по глоссарию"
        />
      </header>
      {shown.sections.length === 0 && (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          Ничего не найдено по «{query}».
        </p>
      )}
      {shown.sections.map((s) => (
        <Section key={s.title} {...s} />
      ))}
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Документация</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {DOCS.map((d) => (
            <li key={d.path}>
              <a href={docUrl(d.path)} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                {d.title}
              </a>{" "}
              <span className="text-muted-foreground">— {d.note}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

`src/shared/ui/input.tsx` уже существует.

`src/pages/help/index.ts`: `export { HelpPage } from "./ui/HelpPage";`

`app/help/page.tsx`:

```tsx
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Справка" };

export { HelpPage as default } from "@/pages/help";
```

- [ ] **Step 5: Документация архитектуры**

В `docs/ai/architecture.md` строка «Платформа (не домен)» (строка 45): `pages/{logs,login}` → `pages/{logs,login,help}`; в колонку API-роутов добавить `страница /help (глоссарий из docs/ai/glossary.md через pnpm glossary)`.

- [ ] **Step 6: Проверка и коммит**

Run: `pnpm lint && pnpm lint:fsd && pnpm typecheck && pnpm vitest run src/pages/help`
Expected: всё зелёное. Steiger не должен ругаться на `pages/help` (сегменты `ui`, `lib`, `config`).

Запустить `pnpm wt serve`, открыть `/help`: видны 6 секций, поиск `FT:USDM` оставляет одну строку, «Справка» в навигации.

```bash
git add app/help src/pages/help src/shared/config docs/ai/architecture.md
git commit -m "0016: страница /help — глоссарий с поиском и ссылки на документацию"
```

---

### Task 3: Группы активов (AG) — карта в entities и колонка в таблице экспериментов

**Files:**
- Create: `src/entities/experiment/model/assetGroup.ts`
- Create: `src/entities/experiment/model/assetGroup.test.ts`
- Modify: `src/entities/experiment/index.ts`
- Modify: `src/entities/experiment/ui/MarketBudgets.tsx:7-10`
- Modify: `src/pages/experiments/model/useExperimentsView.ts` (SORT_KEYS: `ag`)
- Modify: `src/pages/experiments/lib/sortExperiments.ts` (+ `sortExperiments.test.ts`)
- Modify: `src/pages/experiments/ui/ExperimentsPage.tsx` (COLUMNS, MARKET_LABELS, ExperimentRow)
- Modify: `src/pages/settings/ui/PaperAccountsCard.tsx:39`, `src/pages/stats/ui/StatsPage.tsx:67`, `src/pages/experiment-detail/ui/ExperimentDetailPage.tsx:359` (метки из `ASSET_GROUPS`)
- Modify: `src/pages/help/config/glossary.test.ts` (связь описания AG с кодом)

**Interfaces:**
- Produces:
  ```ts
  export type Market = "spot" | "futures"; // = Experiment["market"]
  export interface AssetGroup { code: string; label: string; description: string }
  export const ASSET_GROUPS: Record<Market, AssetGroup>;
  export const ASSET_GROUP_DESCRIPTION: string; // текст термина «Группа активов» из глоссария
  export function assetGroupOf(market: Market): AssetGroup;
  ```

- [ ] **Step 1: Тест `src/entities/experiment/model/assetGroup.test.ts`**

```ts
import { MARKETS } from "@binance-dashboard/trading-core";
import { describe, expect, it } from "vitest";
import { ASSET_GROUPS, assetGroupOf } from "./assetGroup";

describe("ASSET_GROUPS", () => {
  it("каждому market движка соответствует группа с кодом из глоссария", () => {
    for (const m of MARKETS) expect(ASSET_GROUPS[m].code).toMatch(/^(SPOT|FT:USDM|FT:COINM)$/);
    expect(assetGroupOf("spot")).toMatchObject({ code: "SPOT", label: "Spot" });
    expect(assetGroupOf("futures")).toMatchObject({ code: "FT:USDM", label: "USDⓈ-M" });
  });
});
```

Run: `pnpm vitest run src/entities/experiment/model/assetGroup.test.ts` → FAIL.

- [ ] **Step 2: `src/entities/experiment/model/assetGroup.ts`**

```ts
import type { Experiment } from "@binance-dashboard/trading-core";

// Группы активов — AG (Asset Group), решение пользователя 2026-10-15 (spec 0016): кошельки Binance
// со своими инструментами. В коде и БД market остаётся spot/futures; COIN-M появится задачей D.

export type Market = Experiment["market"];

export interface AssetGroup {
  /** Код из глоссария: SPOT, FT:USDM, FT:COINM. */
  code: string;
  label: string;
  description: string;
}

export const ASSET_GROUPS: Record<Market, AssetGroup> = {
  spot: {
    code: "SPOT",
    label: "Spot",
    description: "Спотовый рынок: покупка и продажа монет за USDT, только лонг.",
  },
  futures: {
    code: "FT:USDM",
    label: "USDⓈ-M",
    description: "Бессрочные фьючерсы с маржой в стейблкоинах (USDT/USDC): лонг и шорт, плечо 1.",
  },
};

/** Описание термина «Группа активов» — то же, что в docs/ai/glossary.md (тест glossary.test.ts). */
export const ASSET_GROUP_DESCRIPTION =
  "Asset Group — кошелёк Binance со своим набором инструментов и своим балансом: Spot, USDⓈ-M, COIN-M. У каждого эксперимента одна группа; статистика, бюджеты и сбросы считаются по группам.";

export const assetGroupOf = (market: Market): AssetGroup => ASSET_GROUPS[market];
```

В `src/entities/experiment/index.ts` добавить блок:

```ts
// Группы активов (AG) — коды и названия для таблиц, фильтров и хедера (spec 0016).
export {
  ASSET_GROUP_DESCRIPTION,
  ASSET_GROUPS,
  type AssetGroup,
  assetGroupOf,
  type Market,
} from "./model/assetGroup";
```

Run тест → PASS.

- [ ] **Step 3: Связать описание с глоссарием** — в `src/pages/help/config/glossary.test.ts` добавить тест:

```ts
import { ASSET_GROUP_DESCRIPTION, ASSET_GROUPS } from "@/entities/experiment";
// …
it("описание AG и коды групп совпадают с entities/experiment", () => {
  const ag = glossary.sections.flatMap((s) => s.terms).find((t) => t.abbr === "AG");
  expect(ag?.description).toBe(ASSET_GROUP_DESCRIPTION);
  const codes = glossary.sections.flatMap((s) => s.terms.map((t) => t.code));
  for (const g of Object.values(ASSET_GROUPS)) expect(codes).toContain(g.code);
});
```

Run: `pnpm vitest run src/pages/help` → PASS (если текст расходится — поправить glossary.md и `pnpm glossary`).

- [ ] **Step 4: Сортировка — тест и ключ `ag`**

В `src/pages/experiments/model/useExperimentsView.ts` в `SORT_KEYS` после `"id"` добавить `"ag"`.

В `src/pages/experiments/lib/sortExperiments.test.ts` добавить:

```ts
it("ag: spot раньше futures по возрастанию, при равенстве — по id", () => {
  const list = [exp("F02", "futures"), exp("S03", "spot"), exp("F01", "futures")];
  expect(sortExperiments(list, "all", "ag", "asc").map((e) => e.id)).toEqual(["S03", "F01", "F02"]);
  expect(sortExperiments(list, "all", "ag", "desc").map((e) => e.id)).toEqual(["F01", "F02", "S03"]);
});
```

(`exp(id, market)` — фабрика из существующего теста; если её сигнатура иная, подстроить под неё.)

В `sortValue` добавить: `case "ag": return MARKETS.indexOf(e.market);` с `import { MARKETS } from "@binance-dashboard/trading-core";`.

Run: `pnpm vitest run src/pages/experiments` → PASS.

- [ ] **Step 5: Колонка AG в `ExperimentsPage.tsx`**

- Импортировать `ASSET_GROUP_DESCRIPTION, ASSET_GROUPS, assetGroupOf` из `@/entities/experiment`.
- `MARKET_LABELS` → `{ all: "Все", spot: ASSET_GROUPS.spot.code, futures: ASSET_GROUPS.futures.code }`.
- В `COLUMNS` после колонки `id` вставить:

```ts
{
  key: "ag",
  label: "AG",
  numeric: false,
  description: ASSET_GROUP_DESCRIPTION,
},
```

- В `ExperimentRow` убрать `<Badge …>{MARKET_LABELS[e.market]}</Badge>` из ячейки `id` и после неё добавить ячейку:

```tsx
<TableCell>
  <Badge variant="outline" className="font-mono text-[10px]" title={assetGroupOf(e.market).description}>
    {assetGroupOf(e.market).code}
  </Badge>
</TableCell>
```

- Описание колонки `id`: «Код, название и гипотеза эксперимента. Клик по строке — подробности, конфиг и сделки.»

- [ ] **Step 6: Остальные метки**

- `MarketBudgets.tsx`: `MARKET_LABEL` → `const MARKET_LABEL = (m: MarketBudget["market"]) => ASSET_GROUPS[m].label;` и заменить два использования (`import { ASSET_GROUPS } from "../model/assetGroup"`).
- `PaperAccountsCard.tsx:39`, `StatsPage.tsx:67`: `MARKET_LABELS` = `{ spot: ASSET_GROUPS.spot.label, futures: ASSET_GROUPS.futures.label }` через public API `@/entities/experiment`.
- `ExperimentDetailPage.tsx:359`: `assetGroupOf(data.experiment.market).label`.
- `DemoAccountsCard.tsx:144`: «Свободно Futures» → «Свободно USDⓈ-M».

- [ ] **Step 7: Проверка и коммит**

Run: `pnpm lint && pnpm typecheck && pnpm vitest run src/pages src/entities/experiment/model`
На `pnpm wt serve` → `/experiments`: колонка AG после названия, сортировка по ней, бейджа рынка в названии нет, табы фильтра `Все · SPOT · FT:USDM`.

```bash
git add src/entities/experiment src/pages
git commit -m "0016: группы активов (AG) — карта в entities/experiment, колонка AG в /experiments"
```

---

### Task 4: Демо-метрики — PF, Max DD, Equity в таблице экспериментов, цвет демо-колонок, подсказка Max DD

**Files:**
- Modify: `src/entities/experiment/lib/stats.ts` (+ `stats.test.ts`)
- Modify: `src/entities/experiment/api/mirrorDb.ts:230-321` (+ `mirrorDb.test.ts`)
- Modify: `src/entities/experiment/model/view.ts:39-49`
- Modify: `src/entities/experiment/api/readModel.ts:98,135`, `src/app/server/experimentSettings.ts:92`
- Modify: `src/entities/experiment/index.ts`
- Modify: `src/pages/experiments/model/useExperimentsView.ts`, `lib/sortExperiments.ts` (+ тест), `ui/ExperimentsPage.tsx`
- Modify: `src/pages/stats/ui/StatsPage.tsx:127-132, 656-658` (текст Max DD)

**Interfaces:**
- Consumes: `maxDrawdown(equities)` из `lib/stats.ts`.
- Produces:
  ```ts
  export interface DemoStats { grossProfit: number; profitFactor: number | null; maxDrawdownPct: number; equity: number }
  export function computeDemoStats(pnls: number[], initialBudget: number): DemoStats; // pnls — в порядке закрытия
  // MirrorSummary получает поле pnls: number[] (PnL закрытых сделок в порядке закрытия, без сделок без цены выхода)
  export function toDemoSummary(summary: MirrorSummary, initialBudget: number): DemoSummary;
  // demoSummarySchema расширена: grossProfit, profitFactor (nullable), maxDrawdownPct, equity
  ```

- [ ] **Step 1: Тест `computeDemoStats` в `src/entities/experiment/lib/stats.test.ts`**

```ts
import { computeDemoStats } from "./stats";

describe("computeDemoStats", () => {
  it("PF, просадка от пика и equity по PnL в порядке закрытия", () => {
    expect(computeDemoStats([10, -5, 20, -30], 1000)).toEqual({
      grossProfit: 30,
      profitFactor: 30 / 35,
      maxDrawdownPct: 30 / 1030,
      equity: 995,
    });
  });
  it("без убытков — PF null, без сделок — нули и equity = бюджет", () => {
    expect(computeDemoStats([5, 5], 100)).toMatchObject({ profitFactor: null, grossProfit: 10, maxDrawdownPct: 0, equity: 110 });
    expect(computeDemoStats([], 100)).toEqual({ grossProfit: 0, profitFactor: null, maxDrawdownPct: 0, equity: 100 });
  });
});
```

Run: `pnpm vitest run src/entities/experiment/lib/stats.test.ts` → FAIL.

- [ ] **Step 2: Реализация в `lib/stats.ts`** (после `computeStats`):

```ts
/** Метрики демо-сделок эксперимента (spec 0016): те же формулы, что у paper, по PnL в порядке закрытия. */
export interface DemoStats {
  grossProfit: number;
  profitFactor: number | null;
  /** Просадка от пика в долях (0,05 = 5 %). */
  maxDrawdownPct: number;
  /** Стартовый бюджет эксперимента + Σ PnL демо (отдельного демо-капитала у эксперимента нет). */
  equity: number;
}

export function computeDemoStats(pnls: number[], initialBudget: number): DemoStats {
  let grossProfit = 0;
  let grossLoss = 0;
  let equity = initialBudget;
  const equities = [equity];
  for (const pnl of pnls) {
    if (pnl > 0) grossProfit += pnl;
    else if (pnl < 0) grossLoss -= pnl;
    equity += pnl;
    equities.push(equity);
  }
  return {
    grossProfit,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    maxDrawdownPct: maxDrawdown(equities).pct,
    equity,
  };
}
```

Экспортировать `computeDemoStats, type DemoStats` в `index.ts` (блок `./lib/stats`). Run → PASS.

- [ ] **Step 3: `mirrorSummaries` отдаёт PnL в порядке закрытия — тест в `mirrorDb.test.ts`**

Рядом с существующим тестом `mirrorSummaries` добавить (фабрики `exp()`/`trade()` и `updateMirror` — из этого же файла; `closed: true` ставит `closed_at = now()`, поэтому для порядка выставить `closedAt` явно через `db.update(demoMirrorOrdersTable).set({ closedAt: … })`):

```ts
it("pnls — закрытые сделки в порядке закрытия; без цены выхода сделка в closed, но не в pnls", async () => {
  // три закрытые сделки F01: A (+5, закрыта позже), B (−2, закрыта раньше), C (без exit_price у обеих сторон)
  const s = (await mirrorSummaries(db)).get("F01");
  expect(s?.closed).toBe(3);
  expect(s?.pnls).toEqual([-2, 5]); // по времени закрытия
  expect(s?.pnl).toBe(3);
});
```

Run → FAIL (`pnls` undefined).

- [ ] **Step 4: Реализация в `mirrorDb.ts`**

- В `MirrorSummary` добавить `/** PnL закрытых сделок в порядке закрытия (для PF/DD/equity); без цены выхода — не входит. */ pnls: number[];`, в `emptyMirrorSummary` — `pnls: []`.
- В `select` добавить `closedAt: demoMirrorOrdersTable.closedAt`; перед циклом отсортировать: `rows.sort((a, b) => (a.closedAt ? Date.parse(String(a.closedAt)) : 0) - (b.closedAt ? Date.parse(String(b.closedAt)) : 0));`
- После `s.pnl += pnl;` добавить `s.pnls.push(pnl);`.
- Добавить функцию:

```ts
/** Сводка для API страниц: счётчики + PF/DD/equity по формулам paper (spec 0016). */
export function toDemoSummary(summary: MirrorSummary, initialBudget: number): DemoSummary {
  const { pnls, ...counts } = summary;
  return { ...counts, ...computeDemoStats(pnls, initialBudget) };
}
```

(`import { computeDemoStats } from "../lib/stats"; import type { DemoSummary } from "../model/view";`). Экспортировать `toDemoSummary` из `index.ts` в блоке mirrorDb.

- [ ] **Step 5: Схема и вызовы**

`model/view.ts` → в объект `demoSummarySchema` добавить:

```ts
grossProfit: z.number(),
profitFactor: z.number().nullable(),
maxDrawdownPct: z.number(),
equity: z.number(),
```

`readModel.ts:98` → `demo: toDemoSummary(demo.get(e.id) ?? emptyMirrorSummary(), e.initialBudget),`; `:135` → аналогично с `experiment.initialBudget`. `experimentSettings.ts:92` — найти, где собирается `demo: { ...summary, resetAt }`, и обернуть сводку в `toDemoSummary(summary, e.initialBudget)`.

Run: `pnpm typecheck && pnpm vitest run src/entities/experiment src/app/server` → PASS.

- [ ] **Step 6: Колонки и сортировка**

`useExperimentsView.ts` → `SORT_KEYS` добавить `"demoProfitFactor", "demoMaxDrawdown", "demoEquity"` после `"demoPnl"`.

`sortExperiments.ts` → `sortValue`:

```ts
case "demoProfitFactor":
  return e.demo.closed ? (e.demo.profitFactor ?? (e.demo.grossProfit > 0 ? Number.POSITIVE_INFINITY : null)) : null;
case "demoMaxDrawdown":
  return e.demo.closed ? e.demo.maxDrawdownPct : null;
case "demoEquity":
  return e.demo.closed ? e.demo.equity : null;
```

Тест в `sortExperiments.test.ts`: эксперимент без демо-сделок всегда в конце при сортировке по `demoEquity` в обе стороны.

`ExperimentsPage.tsx` → `COLUMNS` после `demoPnl`:

```ts
{ key: "demoProfitFactor", label: "Демо: Profit factor", numeric: true, description: "Σ прибылей / Σ убытков закрытых демо-сделок с последнего демо-сброса; ∞ — убытков не было." },
{ key: "demoMaxDrawdown", label: "Демо: Max DD", numeric: true, description: "Наибольшая просадка демо-equity от пика, % от пика." },
{ key: "demoEquity", label: "Демо: Equity", numeric: true, description: "Стартовый бюджет эксперимента + PnL демо-сделок с последнего демо-сброса (отдельного демо-капитала у эксперимента нет, демо-счёт общий)." },
```

`DemoCells` — три ячейки после PnL:

```tsx
<TableCell className={cn("text-right font-mono tabular-nums", DEMO_TONE)}>
  {d.closed ? formatProfitFactor(d.profitFactor, d.grossProfit) : "—"}
</TableCell>
<TableCell className={cn("text-right font-mono tabular-nums text-muted-foreground", DEMO_TONE)}>
  {d.closed ? formatRate(-d.maxDrawdownPct) : "—"}
</TableCell>
<TableCell className={cn("text-right font-mono tabular-nums", DEMO_TONE)}>
  {d.closed ? formatUsd(d.equity) : "—"}
</TableCell>
```

- [ ] **Step 7: Цвет демо-колонок**

В `ExperimentsPage.tsx`:

```ts
/** Оттенок всех колонок «Демо: …» — заголовки и ячейки (AC6; вариант утверждает пользователь). */
const DEMO_TONE = "bg-sky-500/[0.06]";
const isDemoColumn = (key: SortKey) => key.startsWith("demo");
```

В `ColumnHead` добавить в `className`: `isDemoColumn(column.key) && DEMO_TONE`. Все ячейки `DemoCells` (включая существующие 4) получают `DEMO_TONE`.

Сделать три скриншота `/experiments` с вариантами `bg-sky-500/[0.06]`, `bg-amber-500/[0.07]`, `bg-violet-500/[0.06]` (по очереди менять константу, снимать браузером в `docs/specs/0016-glossary-ag-demo-columns/screens/demo-tone-{sky,amber,violet}.png`) и **остановиться: вернуть скриншоты оркестратору с вопросом, какой вариант утвердить**. Выбранный вариант оставить в коде, запись «Цвет демо-колонок: <вариант>» — в журнал spec.

- [ ] **Step 8: Подсказка Max DD (AC11)**

- `ExperimentsPage.tsx` описание `maxDrawdown`: `"Наибольшая просадка equity от пика, в % от пика."`
- `StatsPage.tsx:131` описание: `"Наибольшая просадка накопленного PnL группы от пика, в $ (и в % от пика equity для экспериментов и рынков)."`; текст на строках 656–658 — то же («в % от пика equity» вместо «от капитала»).

- [ ] **Step 9: Проверка и коммит**

Run: `pnpm check`
Expected: зелёный.

```bash
git add src/entities/experiment src/app/server/experimentSettings.ts src/pages/experiments src/pages/stats docs/specs/0016-glossary-ag-demo-columns/screens
git commit -m "0016: демо-метрики PF, Max DD, Equity в /experiments, оттенок демо-колонок, подсказка Max DD"
```

---

### Task 5: Отказы и пропуски зеркала в журнале, фильтры `/logs` в URL, ссылка из «отказ · пропуск», текст диалога Demo-сброса

**Files:**
- Create: `src/features/demo-mirror/lib/mirrorLog.ts` (+ `mirrorLog.test.ts`)
- Modify: `src/features/demo-mirror/index.ts`
- Modify: `src/app/server/demoMirror.ts:39-58`
- Modify: `src/app/server/logs.ts:38-63` (+ `logs.test.ts`)
- Create: `src/entities/log-entry/model/filters.ts` (+ `filters.test.ts`)
- Modify: `src/entities/log-entry/api/useLogs.ts`, `src/entities/log-entry/index.ts`
- Modify: `app/api/logs/route.ts:7-17`
- Modify: `src/pages/logs/ui/LogsPage.tsx`
- Modify: `src/widgets/log-list/ui/LogList.tsx:72` (пустое состояние с кнопкой — через проп `onReset`)
- Modify: `src/entities/experiment/ui/DemoMisses.tsx`, `src/pages/experiments/ui/ExperimentsPage.tsx:174`, `src/pages/settings/ui/DemoAccountsCard.tsx:160-170, 248`

**Interfaces:**
- Produces:
  ```ts
  // entities/log-entry
  export interface LogFilters { level: LogLevel; events: string[]; experiment: string; days: number }
  export const LOG_DAYS_MAX = 14; export const LOG_DAYS_DEFAULT = 2;
  export function parseLogFilters(params: URLSearchParams): LogFilters; // level ∈ LOG_LEVELS иначе info; events — split(","), trim, без пустых; days — целое, зажато в 1…14
  export function logFiltersSearch(f: Partial<LogFilters>): string; // "?level=warn&event=a%2Cb&experiment=F03&days=14" без значений по умолчанию
  export function mirrorLogsHref(experimentId: string): string; // "/logs?..." для DemoMisses
  // src/app/server/logs.ts
  export async function readLogs(filters: LogFilters, limit: number): Promise<LogEntry[]>;
  // features/demo-mirror
  export function mirrorLogEntry(kind: "rejected" | "skipped", c: MirrorLogSubject, reason: string): { level: "warn" | "info"; event: "mirror.rejected" | "mirror.skipped"; message: string; data: Record<string, unknown> }
  ```

- [ ] **Step 1: `mirrorLogEntry` — тест и реализация**

`src/features/demo-mirror/lib/mirrorLog.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mirrorLogEntry } from "./mirrorLog";

const c = { tradeId: "t1", experimentId: "F03", symbol: "BTCUSDT", market: "futures" as const };

describe("mirrorLogEntry", () => {
  it("отказ — warn mirror.rejected с полями для фильтра журнала", () => {
    expect(mirrorLogEntry("rejected", c, "объём ниже минимума")).toEqual({
      level: "warn",
      event: "mirror.rejected",
      message: "F03 BTCUSDT: отказ — объём ниже минимума",
      data: { experimentId: "F03", tradeId: "t1", symbol: "BTCUSDT", market: "futures", reason: "объём ниже минимума" },
    });
  });
  it("пропуск — info mirror.skipped", () => {
    expect(mirrorLogEntry("skipped", c, "вход старше 10 минут")).toMatchObject({ level: "info", event: "mirror.skipped", message: "F03 BTCUSDT: пропуск — вход старше 10 минут" });
  });
});
```

`src/features/demo-mirror/lib/mirrorLog.ts`:

```ts
// Записи журнала об отказах и пропусках зеркала (spec 0016): по одной на сделку, с experimentId —
// страница /logs фильтрует по ним по ссылке из «N отказ · M пропуск». Пишет композиция src/app/server/demoMirror.ts.

export interface MirrorLogSubject {
  tradeId: string;
  experimentId: string;
  symbol: string;
  market: "spot" | "futures";
}

export const MIRROR_LOG_EVENTS = ["mirror.rejected", "mirror.skipped"] as const;

export function mirrorLogEntry(kind: "rejected" | "skipped", c: MirrorLogSubject, reason: string) {
  const rejected = kind === "rejected";
  return {
    level: rejected ? ("warn" as const) : ("info" as const),
    event: rejected ? ("mirror.rejected" as const) : ("mirror.skipped" as const),
    message: `${c.experimentId} ${c.symbol}: ${rejected ? "отказ" : "пропуск"} — ${reason}`,
    data: { experimentId: c.experimentId, tradeId: c.tradeId, symbol: c.symbol, market: c.market, reason },
  };
}
```

Экспорт из `src/features/demo-mirror/index.ts`: `export { MIRROR_LOG_EVENTS, type MirrorLogSubject, mirrorLogEntry } from "./lib/mirrorLog";`.

Run: `pnpm vitest run src/features/demo-mirror/lib/mirrorLog.test.ts` → PASS.

- [ ] **Step 2: Логирование в `src/app/server/demoMirror.ts`**

```ts
import { mirrorLogEntry, runMirror } from "@/features/demo-mirror";
// …
const write = (e: ReturnType<typeof mirrorLogEntry>) => log[e.level](e.event, e.message, e.data);
// markSkipped:
markSkipped: async (tradeId, reason) => {
  await updateMirror(db, tradeId, { status: "skipped", message: reason, steps: [] });
  const c = byId.get(tradeId);
  if (c) write(mirrorLogEntry("skipped", c, reason));
},
// saveOpen: после updateMirror(…)
saveOpen: async (tradeId, r) => {
  await updateMirror(db, tradeId, { /* как было */ });
  const c = byId.get(tradeId);
  if (c && r.status === "rejected") write(mirrorLogEntry("rejected", c, r.message));
},
```

Run: `pnpm typecheck` → OK.

- [ ] **Step 3: Фильтры журнала — `src/entities/log-entry/model/filters.ts` + тест**

Тест `filters.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { logFiltersSearch, mirrorLogsHref, parseLogFilters } from "./filters";

describe("parseLogFilters", () => {
  it("значения по умолчанию", () => {
    expect(parseLogFilters(new URLSearchParams(""))).toEqual({ level: "info", events: [], experiment: "", days: 2 });
  });
  it("события списком, days зажат в 1…14, неизвестный уровень → info", () => {
    expect(parseLogFilters(new URLSearchParams("level=x&event=a, b,,c&experiment=F03&days=99"))).toEqual({ level: "info", events: ["a", "b", "c"], experiment: "F03", days: 14 });
    expect(parseLogFilters(new URLSearchParams("days=0")).days).toBe(1);
    expect(parseLogFilters(new URLSearchParams("days=abc")).days).toBe(2);
  });
});

describe("logFiltersSearch / mirrorLogsHref", () => {
  it("не пишет значения по умолчанию", () => {
    expect(logFiltersSearch({})).toBe("");
    expect(logFiltersSearch({ level: "warn", events: ["a", "b"], days: 14 })).toBe("?level=warn&event=a%2Cb&days=14");
  });
  it("ссылка на отказы и пропуски эксперимента", () => {
    expect(mirrorLogsHref("F03")).toBe("/logs?event=mirror.rejected%2Cmirror.skipped&experiment=F03&days=14");
  });
});
```

Реализация:

```ts
import { LOG_LEVELS, type LogLevel } from "./schema";

// Фильтры страницы /logs и GET /api/logs — в URL (spec 0016): уровень, события, эксперимент, период.

export const LOG_DAYS_DEFAULT = 2;
export const LOG_DAYS_MAX = 14;
export const MIRROR_LOG_EVENTS = ["mirror.rejected", "mirror.skipped"] as const;

export interface LogFilters {
  level: LogLevel;
  /** Точные имена событий; пусто — все. */
  events: string[];
  /** data.experimentId; пусто — все. */
  experiment: string;
  /** Глубина в сутках, 1…LOG_DAYS_MAX. */
  days: number;
}

export const DEFAULT_LOG_FILTERS: LogFilters = { level: "info", events: [], experiment: "", days: LOG_DAYS_DEFAULT };

export function parseLogFilters(params: URLSearchParams): LogFilters {
  const level = LOG_LEVELS.find((l) => l === params.get("level")) ?? "info";
  const events = (params.get("event") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const experiment = (params.get("experiment") ?? "").trim();
  const raw = Number.parseInt(params.get("days") ?? "", 10);
  const days = Number.isNaN(raw) ? LOG_DAYS_DEFAULT : Math.min(LOG_DAYS_MAX, Math.max(1, raw));
  return { level, events, experiment, days };
}

export function logFiltersSearch(f: Partial<LogFilters>): string {
  const p = new URLSearchParams();
  if (f.level && f.level !== DEFAULT_LOG_FILTERS.level) p.set("level", f.level);
  if (f.events?.length) p.set("event", f.events.join(","));
  if (f.experiment) p.set("experiment", f.experiment);
  if (f.days && f.days !== LOG_DAYS_DEFAULT) p.set("days", String(f.days));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Ссылка из «N отказ · M пропуск»: отказы и пропуски зеркала одного эксперимента за всё время хранения. */
export const mirrorLogsHref = (experimentId: string) =>
  `/logs${logFiltersSearch({ events: [...MIRROR_LOG_EVENTS], experiment: experimentId, days: LOG_DAYS_MAX })}`;
```

Экспортировать из `src/entities/log-entry/index.ts`: `DEFAULT_LOG_FILTERS, LOG_DAYS_DEFAULT, LOG_DAYS_MAX, type LogFilters, logFiltersSearch, MIRROR_LOG_EVENTS, mirrorLogsHref, parseLogFilters`.

Run → PASS. (Примечание: `MIRROR_LOG_EVENTS` в `features/demo-mirror` и в `entities/log-entry` — две константы в двух доменах, намеренно: домены не импортируют друг друга; тесты фиксируют имена событий.)

- [ ] **Step 4: `readLogs` с фильтрами — тест в `src/app/server/logs.test.ts`**

```ts
it("фильтрует по событиям, experimentId в data и глубине в днях", async () => {
  const now = Date.now();
  await writeLogs([
    { ts: new Date(now - 1000).toISOString(), level: "warn", event: "mirror.rejected", message: "F03", data: { experimentId: "F03" } },
    { ts: new Date(now - 2000).toISOString(), level: "info", event: "mirror.skipped", message: "F03 skip", data: { experimentId: "F03" } },
    { ts: new Date(now - 3000).toISOString(), level: "info", event: "mirror.skipped", message: "S01", data: { experimentId: "S01" } },
    { ts: new Date(now - 5 * 86_400_000).toISOString(), level: "info", event: "mirror.skipped", message: "старая", data: { experimentId: "F03" } },
  ]);
  const f = { level: "info" as const, events: ["mirror.rejected", "mirror.skipped"], experiment: "F03", days: 2 };
  expect((await readLogs(f, 10)).map((e) => e.message)).toEqual(["F03", "F03 skip"]);
  expect((await readLogs({ ...f, days: 14 }, 10)).map((e) => e.message)).toEqual(["F03", "F03 skip", "старая"]);
  expect(await readLogs({ ...f, experiment: "F03' OR 1=1" }, 10)).toEqual([]);
  expect((await readLogs({ ...f, events: [], experiment: "" }, 10)).length).toBe(3);
}, 30_000);
```

Существующие вызовы `readLogs("info", 10)` в этом файле заменить на `readLogs({ ...DEFAULT_LOG_FILTERS }, 10)` / `{ ...DEFAULT_LOG_FILTERS, level: "error" }`.

Реализация `readLogs(filters: LogFilters, limit: number)`:

```ts
const since = new Date(Date.now() - filters.days * 86_400_000).toISOString();
.where(
  and(
    gte(appLogsTable.ts, since),
    inArray(appLogsTable.level, levelsFrom(filters.level)),
    filters.events.length ? inArray(appLogsTable.event, filters.events) : undefined,
    filters.experiment ? sql`${appLogsTable.data}->>'experimentId' = ${filters.experiment}` : undefined,
  ),
)
```

(`import { and, desc, gte, inArray, lt, sql } from "drizzle-orm"`.) Комментарий функции: «Записи за `days` суток, новые сверху; события и эксперимент — опционально».

`app/api/logs/route.ts` GET: `const filters = parseLogFilters(params); return Response.json({ entries: await readLogs(filters, limit) });`.

Run: `pnpm vitest run src/app/server/logs.test.ts` → PASS.

- [ ] **Step 5: Клиент — `useLogs(filters)` и страница**

`useLogs.ts`:

```ts
export function useLogs(filters: LogFilters) {
  return useQuery({
    queryKey: ["logs", filters],
    queryFn: async () => {
      const qs = new URLSearchParams(logFiltersSearch(filters));
      qs.set("limit", "300");
      const res = await fetch(`/api/logs?${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Журнал не загрузился (${res.status})`);
      return logsResponseSchema.parse(await res.json()).entries;
    },
    refetchInterval: 10_000,
  });
}
```

`LogsPage.tsx` — nuqs:

```ts
const [{ level, event, experiment, days }, setFilters] = useQueryStates(
  {
    level: parseAsStringLiteral(LOG_LEVELS).withDefault("info"),
    event: parseAsString.withDefault(""),
    experiment: parseAsString.withDefault(""),
    days: parseAsInteger.withDefault(LOG_DAYS_DEFAULT),
  },
  { clearOnDefault: true },
);
const filters = useMemo(
  () => parseLogFilters(new URLSearchParams({ level, event, experiment, days: String(days) })),
  [level, event, experiment, days],
);
const logs = useLogs(filters);
const active = filters.events.length > 0 || filters.experiment !== "" || filters.days !== LOG_DAYS_DEFAULT || filters.level !== "info";
```

UI под табами уровня — строка фильтров: `Input` «Событие (через запятую)» ← `event`, `Input` «Эксперимент» ← `experiment`, `Tabs` для `days` (`2 дня · 7 дней · 14 дней`), кнопка «Сбросить фильтры» (`setFilters(null)`), видна при `active`. Описание страницы: «Журнал сервера за {days} суток…». Пустой список — `LogList` получает проп `onReset?: () => void` и показывает «Записей нет.» + кнопку «Сбросить фильтры», если проп передан (страница передаёт его только при `active`).

- [ ] **Step 6: Иконка-ссылка в `DemoMisses`**

Домены не пересекаются и слайсы одного слоя не импортируют друг друга, поэтому `DemoMisses` (entities/experiment) получает готовую ссылку пропом `logsHref?: string`, а строит её страница через `mirrorLogsHref` из `@/entities/log-entry`:

```tsx
import { ScrollText } from "lucide-react";
import Link from "next/link";
import type { DemoSummary } from "../model/view";

export function DemoMisses({ d, logsHref }: { d: Pick<DemoSummary, "rejected" | "skipped">; logsHref?: string }) {
  if (!d.rejected && !d.skipped) return null;
  return (
    <span className="flex items-center justify-end gap-1 text-xs text-muted-foreground" title={/* как было */}>
      <span>{[d.rejected > 0 && `${d.rejected} отказ`, d.skipped > 0 && `${d.skipped} пропуск`].filter(Boolean).join(" · ")}</span>
      {logsHref && (
        <Link href={logsHref} className="hover:text-foreground" title="Причины — в журнале" aria-label="Отказы и пропуски в журнале">
          <ScrollText className="size-3.5" />
        </Link>
      )}
    </span>
  );
}
```

Вызовы: `ExperimentsPage.tsx:174` → `<DemoMisses d={d} logsHref={mirrorLogsHref(e.id)} />`, `DemoAccountsCard.tsx:248` → `logsHref={mirrorLogsHref(e.id)}` (страницы склеивают домены — разрешено).

- [ ] **Step 7: Текст диалога «Сбросить всё Demo» (AC10)**

`DemoAccountsCard.tsx:166-169` — заменить третий `<li>`:

```tsx
<li>
  Paper-счета и галочки «торговля» не меняются. Баланс демо-счёта приложение сбросить не может
  (у Binance нет такого API): нажмите «Сброс» на{" "}
  <a href="https://demo.binance.com/en/my/wallet/demo/main" target="_blank" rel="noreferrer" className="underline underline-offset-4">
    demo.binance.com → Активы
  </a>
  , если хотите начать и баланс с нуля.
</li>
```

Проверить `ResetDemoButton` (сброс одного эксперимента, строка ~78): если там тоже обещается сброс баланса — заменить аналогично.

- [ ] **Step 8: Проверка и коммит**

Run: `pnpm check && pnpm build`.
На `pnpm wt serve`: `/logs?event=mirror.rejected,mirror.skipped&experiment=F03&days=14` показывает фильтры заполненными; клик по иконке у «отказ · пропуск» ведёт туда же; «Сбросить фильтры» очищает URL.

```bash
git add src/features/demo-mirror src/app/server src/entities/log-entry src/entities/experiment/ui/DemoMisses.tsx app/api/logs src/pages/logs src/widgets/log-list src/pages/experiments src/pages/settings
git commit -m "0016: отказы и пропуски зеркала в журнале, фильтры /logs в URL, ссылка из «отказ · пропуск», текст демо-сброса"
```

---

### Task 6: Документация и завершение ветки

**Files:**
- Modify: `docs/specs/0016-glossary-ag-demo-columns.md` (статус `approved` → `testing`; журнал: коммиты, выбранный цвет), `docs/ai/architecture.md` (строка лаборатории: «группы активов AG — `entities/experiment/model/assetGroup.ts`»; платформа: фильтры `/api/logs` `level/event/experiment/days`).

- [ ] **Step 1:** Обновить перечисленные документы; `docs/HISTORY.md` не трогать (закрывается последним коммитом на этапе ready).
- [ ] **Step 2:** `pnpm check && pnpm build` → зелёные; `git push -u origin feature/0016-glossary-ag-demo-columns`.
- [ ] **Step 3:** Коммит `0016: документация — архитектура, журнал spec`.

## Self-review (выполнен)
- Spec coverage: AC1–AC2 → Task 1; AC3 → Task 2; AC4 → Task 3; AC5, AC6, AC11 → Task 4; AC7–AC10, AC12 → Task 5; документация → Task 6.
- Типы: `Glossary/GlossaryTerm` (T1) используются в T2; `ASSET_GROUPS/assetGroupOf/ASSET_GROUP_DESCRIPTION` (T3) используются в T2-тесте и T3; `computeDemoStats/toDemoSummary/DemoSummary` (T4) согласованы; `LogFilters/parseLogFilters/logFiltersSearch/mirrorLogsHref` (T5) согласованы с `readLogs(filters, limit)`.
- Review Focus: 1 → T1 Step 2 (ошибка со строкой); 2–3 → T5 Step 3–4; 4 → T4 Step 3; 5 → T2 Step 1.
