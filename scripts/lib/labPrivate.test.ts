import type { Experiment } from "@binance-dashboard/trading-core";
import { describe, expect, it } from "vitest";
import { EXPERIMENT_CATALOG } from "@/features/paper-engine";
import {
  DEFAULT_PRIVATE_FILE,
  decideLabPrivateWrite,
  describeDbTarget,
  formatPlanLine,
  NEED_PROD_HINT,
  type ParseResult,
  parseLabPrivateArgs,
  parsePrivateExperiments,
  planPrivateSeed,
} from "./labPrivate";

// Фиктивные эксперименты: настоящие приватные параметры в публичный репозиторий не пишем.
const CONFIG = {
  timeframe: "1h",
  entry: { type: "hold" },
  exit: { stop: { type: "none" }, takeProfit: null },
  universe: { type: "majors" },
  directions: ["long"],
  maxOpen: 1,
};
const item = (over: Record<string, unknown> = {}) => ({
  id: "PS99",
  market: "spot",
  name: "Тестовый",
  hypothesis: "Проверка разбора",
  config: CONFIG,
  ...over,
});
const CATALOG_IDS = new Set(EXPERIMENT_CATALOG.map((e) => e.id));
const parse = (value: unknown, text = JSON.stringify(value)) =>
  parsePrivateExperiments(text, CATALOG_IDS);
const errorsOf = (r: ParseResult) => (r.ok ? [] : r.errors);

describe("parsePrivateExperiments", () => {
  it("дефолты каталога: бюджет 10 000, включён, без demo-зеркала", () => {
    const r = parse([item(), item({ id: "PF99", market: "futures" })]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.experiments[0]).toMatchObject({
      id: "PS99",
      initialBudget: 10_000,
      enabled: true,
      demoMirror: false,
    });
    expect(r.experiments[1].market).toBe("futures");
  });

  it("явные initialBudget, enabled, demoMirror сохраняются", () => {
    const r = parse([
      item({ initialBudget: 500, enabled: false, demoMirror: true }),
    ]);
    expect(r.ok && r.experiments[0]).toMatchObject({
      initialBudget: 500,
      enabled: false,
      demoMirror: true,
    });
  });

  it("пустой массив — ок, ничего не записывать", () => {
    expect(parse([])).toEqual({ ok: true, experiments: [] });
  });

  it("невалидный JSON и не массив — понятная ошибка", () => {
    expect(errorsOf(parse(null, "[{"))[0]).toMatch(/^невалидный JSON/);
    expect(errorsOf(parse({ id: "PS99" }))[0]).toMatch(/массив/);
  });

  it("нарушение схемы — какой эксперимент и какое поле", () => {
    const errors = errorsOf(
      parse([
        item({ config: { ...CONFIG, maxOpen: 0 } }),
        item({ id: "PS98", hypothesis: " " }),
        { market: "spot" },
      ]),
    );
    expect(errors).toContainEqual(
      expect.stringMatching(/^PS99: поле config\.maxOpen — /),
    );
    expect(errors).toContainEqual(
      expect.stringMatching(/^PS98: поле hypothesis — /),
    );
    expect(errors).toContainEqual(
      expect.stringMatching(/^#3 \(без id\): поле id — /),
    );
  });

  it("лишнее поле верхнего уровня (опечатка) — ошибка", () => {
    expect(errorsOf(parse([item({ enabeld: false })]))).toEqual([
      expect.stringMatching(/^PS99: поле enabeld — .*enabeld/),
    ]);
  });

  it("неизвестное поле в config (опечатка) — ошибка с путём поля (spec 0029)", () => {
    expect(
      errorsOf(
        parse([
          item({
            config: {
              ...CONFIG,
              marketFiltr: {},
              exit: { ...CONFIG.exit, trailATR: 2 },
            },
          }),
        ]),
      ),
    ).toEqual([
      expect.stringMatching(/^PS99: поле config\.exit\.trailATR — /),
      expect.stringMatching(/^PS99: поле config\.marketFiltr — /),
    ]);
  });

  it("id без префикса PS/PF и id с префиксом другого рынка", () => {
    expect(errorsOf(parse([item({ id: "X01" })]))).toEqual([
      expect.stringMatching(/^X01: поле id — нужен вид PS01/),
    ]);
    expect(errorsOf(parse([item({ id: "PS1" })]))).toHaveLength(1);
    expect(errorsOf(parse([item({ id: "PF99" })]))).toEqual([
      "PF99: поле market — префикс PF означает futures, а указано spot",
    ]);
  });

  it("повтор id в файле и совпадение с id каталога", () => {
    expect(errorsOf(parse([item(), item()]))).toEqual([
      "PS99: поле id — повторяется в файле",
    ]);
    const r = parsePrivateExperiments(
      JSON.stringify([item()]),
      new Set(["PS99"]),
    );
    expect(errorsOf(r)).toEqual([
      "PS99: поле id — совпадает с id публичного каталога",
    ]);
  });

  it("id публичного каталога не проходят проверку префикса", () => {
    for (const e of EXPERIMENT_CATALOG)
      expect(parse([item({ id: e.id, market: e.market })]).ok).toBe(false);
  });
});

describe("planPrivateSeed", () => {
  const exp = (id: string, over: Partial<Experiment> = {}): Experiment => {
    const r = parse([item({ id, ...over })]);
    if (!r.ok) throw new Error(r.errors.join("\n"));
    return r.experiments[0];
  };

  it("новый, обновится, без изменений (порядок ключей конфига из jsonb не важен)", () => {
    const a = exp("PS01");
    const b = exp("PS02");
    const c = exp("PS03");
    const reordered = Object.fromEntries(
      Object.entries(a.config).reverse(),
    ) as Experiment["config"];
    expect(Object.keys(reordered)[0]).toBe("maxOpen");
    const plan = planPrivateSeed(
      [a, b, c],
      [
        { ...a, config: reordered },
        { ...b, config: { ...b.config, maxOpen: 2 } },
      ],
    );
    expect(plan.map((l) => [l.id, l.status])).toEqual([
      ["PS01", "unchanged"],
      ["PS02", "update"],
      ["PS03", "new"],
    ]);
    expect(formatPlanLine(plan[2])).toMatch(/^PS03 +spot +новый +Тестовый$/);
  });
});

describe("describeDbTarget", () => {
  it("Postgres — без пользователя и пароля; PGlite — каталог", () => {
    const text = describeDbTarget({
      kind: "postgres",
      url: "postgresql://postgres.ref:s3cret@aws-0.pooler.example.com:6543/postgres",
    });
    expect(text).toBe("Postgres aws-0.pooler.example.com:6543/postgres");
    expect(text).not.toMatch(/s3cret|postgres\.ref/);
    expect(describeDbTarget({ kind: "pglite", dir: "/tmp/x" })).toBe(
      "локальная PGlite (/tmp/x)",
    );
  });
});

describe("parseLabPrivateArgs", () => {
  it("без аргументов — файл по умолчанию, без флагов", () => {
    expect(parseLabPrivateArgs([])).toEqual({
      ok: true,
      args: { dryRun: false, prod: false, file: DEFAULT_PRIVATE_FILE },
    });
  });

  it("флаги и --file отдельным аргументом", () => {
    expect(
      parseLabPrivateArgs(["--prod", "--dry-run", "--file", "x.json"]),
    ).toEqual({
      ok: true,
      args: { dryRun: true, prod: true, file: "x.json" },
    });
  });

  it("--file=… делится по первому «=»: значение с «=» не обрезается", () => {
    const parsed = parseLabPrivateArgs(["--file=a=b.json"]);
    expect(parsed).toEqual({
      ok: true,
      args: { dryRun: false, prod: false, file: "a=b.json" },
    });
  });

  it("ошибки: неизвестный аргумент, --file без пути, флаг со значением", () => {
    expect(parseLabPrivateArgs(["--force"]).ok).toBe(false);
    expect(parseLabPrivateArgs(["--file"]).ok).toBe(false);
    expect(parseLabPrivateArgs(["--file="]).ok).toBe(false);
    expect(parseLabPrivateArgs(["--prod=yes"]).ok).toBe(false);
  });
});

describe("decideLabPrivateWrite", () => {
  it("Postgres без --prod — отказ, с --prod — запись", () => {
    expect(
      decideLabPrivateWrite("postgres", { dryRun: false, prod: false }),
    ).toBe("need-prod");
    expect(
      decideLabPrivateWrite("postgres", { dryRun: false, prod: true }),
    ).toBe("write");
  });

  it("--dry-run работает без --prod и никогда не пишет", () => {
    expect(
      decideLabPrivateWrite("postgres", { dryRun: true, prod: false }),
    ).toBe("dry-run");
    expect(
      decideLabPrivateWrite("postgres", { dryRun: true, prod: true }),
    ).toBe("dry-run");
    expect(decideLabPrivateWrite("pglite", { dryRun: true, prod: false })).toBe(
      "dry-run",
    );
  });

  it("PGlite пишется без --prod", () => {
    expect(
      decideLabPrivateWrite("pglite", { dryRun: false, prod: false }),
    ).toBe("write");
  });

  it("подсказка называет --prod и запуск для сервера worktree", () => {
    expect(NEED_PROD_HINT).toContain("--prod");
    expect(NEED_PROD_HINT).toContain("DATABASE_URL= pnpm lab:private");
    expect(NEED_PROD_HINT).toContain("pnpm wt stop");
  });
});
