// План применения решений лаборатории (`pnpm lab:apply`): разбор аргументов и проверка, что изменения не
// противоречат друг другу. Сами записи в БД — scripts/lab-apply.ts через public API entities/experiment.
import {
  ASSET_GROUPS,
  type DemoMirrorMode,
  DISABLE_NOTE_MAX,
  DISABLE_REASON_KEYS,
  DISABLE_REASONS,
  type DisableReason,
  disableReasonSchema,
  enabledVariantsOf,
  type Market,
} from "@/entities/experiment";
import { PRIVATE_ID_PATTERN } from "./labPrivate";

export interface ApplyPlan {
  disable: string[];
  enable: string[];
  /** Положение демо-зеркала (spec 0043): ручные «Вкл» / «Выкл» и «Авто». */
  mirrorOn: string[];
  mirrorOff: string[];
  mirrorAuto: string[];
  /** Причина выключения по id (spec 0046): у каждого из disable — обязательно. */
  reasons: Record<string, DisableReason>;
  /** Короткий текст причины по id (необязательно). */
  notes: Record<string, string>;
  /** Выключить контрольный, у которого идут варианты, — только с согласия пользователя. */
  forceControl: boolean;
  dryRun: boolean;
  /** Разрешить запись в локальную PGlite (без DATABASE_URL); иначе скрипт отказывается — это не прод. */
  local: boolean;
  /** Каталог прогона: туда дописывается apply.md. */
  out?: string;
}

export interface ApplyFlags {
  id: string;
  name: string;
  market: Market;
  enabled: boolean;
  demoMirror: boolean;
  demoMirrorMode: DemoMirrorMode;
  /** Контрольный варианта; null — не вариант. */
  parentId: string | null;
  /** Причина последнего выключения как в БД; null — нет. */
  disabledReason: string | null;
  disabledNote: string | null;
}

/** Причина выключения: категория и текст. */
export interface ApplyReason {
  reason: DisableReason;
  note: string | null;
}

export type ApplyChange =
  | {
      id: string;
      name: string;
      field: "enabled";
      from: boolean;
      to: boolean;
      /** Причина при выключении; при включении — null (причина очищается). */
      reason: ApplyReason | null;
    }
  | {
      id: string;
      name: string;
      field: "demoMirrorMode";
      from: DemoMirrorMode;
      to: DemoMirrorMode;
      /** Зеркало сейчас — для «Было» у «Авто» (вкл / выкл). */
      demoMirror: boolean;
    }
  | {
      /** Уже выключенный: новая причина (backfill, повторный разбор). */
      id: string;
      name: string;
      field: "reason";
      from: { reason: string | null; note: string | null };
      to: ApplyReason;
    };

/** id каталога (S01…, F01…); приватные (PS01, PF01, PC01) — формат lab:private, общий PRIVATE_ID_PATTERN. */
const CATALOG_ID = /^[SF]\d{2}$/;
const isExperimentId = (id: string) =>
  CATALOG_ID.test(id) || PRIVATE_ID_PATTERN.test(id);

const checkId = (id: string, flag: string) => {
  if (!isExperimentId(id))
    throw new Error(
      `${flag}: «${id}» — не похоже на id эксперимента: каталог S01…F20, приватные PS01, PF01, PC01`,
    );
};

const normalize = (ids: string[] | undefined, flag: string): string[] => {
  const out = [...new Set((ids ?? []).map((id) => id.trim().toUpperCase()))];
  for (const id of out) checkId(id, flag);
  return out;
};

const REASON_LIST = DISABLE_REASON_KEYS.map(
  (k) => `${k} (${DISABLE_REASONS[k]})`,
).join(", ");

/** Значения вида `<id>=<текст>` → id → текст; повтор id или пустое значение — ошибка. */
function pairs(
  values: string[] | undefined,
  flag: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of values ?? []) {
    const eq = raw.indexOf("=");
    const id = (eq === -1 ? raw : raw.slice(0, eq)).trim().toUpperCase();
    const value = eq === -1 ? "" : raw.slice(eq + 1).trim();
    checkId(id, flag);
    if (!value) throw new Error(`${flag}: нужно ${flag} ${id}=<значение>`);
    if (id in out) throw new Error(`${flag}: ${id} указан дважды`);
    out[id] = value;
  }
  return out;
}

const overlap = (a: string[], b: string[]) => a.filter((id) => b.includes(id));

/** Значения node:util parseArgs → план; бросает понятную ошибку при пустом или противоречивом наборе. */
export function planApply(values: {
  disable?: string[];
  enable?: string[];
  "mirror-on"?: string[];
  "mirror-off"?: string[];
  "mirror-auto"?: string[];
  reason?: string[];
  note?: string[];
  "force-control"?: boolean;
  "dry-run"?: boolean;
  local?: boolean;
  out?: string;
}): ApplyPlan {
  const disable = normalize(values.disable, "--disable");
  const reasonText = pairs(values.reason, "--reason");
  const notes = pairs(values.note, "--note");
  const reasons: Record<string, DisableReason> = {};
  for (const [id, value] of Object.entries(reasonText)) {
    const parsed = disableReasonSchema.safeParse(value);
    if (!parsed.success)
      throw new Error(
        `--reason ${id}: категории «${value}» нет; есть: ${REASON_LIST}`,
      );
    reasons[id] = parsed.data;
  }
  for (const [flag, map] of [
    ["--reason", reasons],
    ["--note", notes],
  ] as const)
    for (const id of Object.keys(map))
      if (!disable.includes(id))
        throw new Error(
          `${flag} ${id}: нет --disable ${id} — причина пишется только выключаемому`,
        );
  for (const [id, note] of Object.entries(notes))
    if (note.length > DISABLE_NOTE_MAX)
      throw new Error(`--note ${id}: длиннее ${DISABLE_NOTE_MAX} символов`);
  const missing = disable.filter((id) => !(id in reasons));
  if (missing.length)
    throw new Error(
      `выключение без причины: ${missing.join(", ")} — добавьте --reason <id>=<категория> (${REASON_LIST})`,
    );

  const plan: ApplyPlan = {
    disable,
    enable: normalize(values.enable, "--enable"),
    mirrorOn: normalize(values["mirror-on"], "--mirror-on"),
    mirrorOff: normalize(values["mirror-off"], "--mirror-off"),
    mirrorAuto: normalize(values["mirror-auto"], "--mirror-auto"),
    reasons,
    notes,
    forceControl: values["force-control"] ?? false,
    dryRun: values["dry-run"] ?? false,
    local: values.local ?? false,
    out: values.out,
  };
  const both = [
    ...overlap(plan.disable, plan.enable),
    ...overlap(plan.mirrorOn, plan.mirrorOff),
  ];
  if (both.length)
    throw new Error(`противоречие: ${both.join(", ")} и включить, и выключить`);
  const twoModes = [
    ...overlap(plan.mirrorAuto, plan.mirrorOn),
    ...overlap(plan.mirrorAuto, plan.mirrorOff),
  ];
  if (twoModes.length)
    throw new Error(
      `противоречие: ${twoModes.join(", ")} — два положения демо-зеркала сразу`,
    );
  if (
    !plan.disable.length &&
    !plan.enable.length &&
    !plan.mirrorOn.length &&
    !plan.mirrorOff.length &&
    !plan.mirrorAuto.length
  )
    throw new Error(
      "нечего применять: --disable, --enable, --mirror-on, --mirror-off или --mirror-auto <id>",
    );
  return plan;
}

/**
 * Что реально поменяется: неизвестный id — ошибка, уже в нужном состоянии — пропуск. Уже выключенный с новой
 * причиной — смена причины. Выключение контрольного, у которого после плана остаются включённые варианты, —
 * ошибка без --force-control.
 */
export function diffApply(
  plan: ApplyPlan,
  current: ApplyFlags[],
): ApplyChange[] {
  const byId = new Map(current.map((e) => [e.id, e]));
  const get = (id: string) => {
    const e = byId.get(id);
    if (!e) throw new Error(`эксперимента ${id} нет в БД`);
    return e;
  };
  const changes: ApplyChange[] = [];

  for (const id of plan.disable) {
    const e = get(id);
    const reason: ApplyReason = {
      reason: plan.reasons[id],
      note: plan.notes[id] ?? null,
    };
    if (e.enabled)
      changes.push({
        id,
        name: e.name,
        field: "enabled",
        from: true,
        to: false,
        reason,
      });
    else if (
      e.disabledReason !== reason.reason ||
      (e.disabledNote ?? null) !== reason.note
    )
      changes.push({
        id,
        name: e.name,
        field: "reason",
        from: { reason: e.disabledReason, note: e.disabledNote },
        to: reason,
      });
  }
  for (const id of plan.enable) {
    const e = get(id);
    if (!e.enabled)
      changes.push({
        id,
        name: e.name,
        field: "enabled",
        from: false,
        to: true,
        reason: null,
      });
  }
  // «Вкл» и «Авто» для группы без демо-зеркала — ошибка с той же причиной, что в UI и API (spec 0043; с spec 0056
  // зеркало есть у всех групп, COIN-M тоже).
  const mode = (ids: string[], to: DemoMirrorMode) => {
    for (const id of ids) {
      const e = get(id);
      const blocked = ASSET_GROUPS[e.market].demoMirrorBlocked;
      if (to !== "off" && blocked) throw new Error(`${id}: ${blocked}`);
      if (e.demoMirrorMode !== to)
        changes.push({
          id,
          name: e.name,
          field: "demoMirrorMode",
          from: e.demoMirrorMode,
          to,
          demoMirror: e.demoMirror,
        });
    }
  };
  mode(plan.mirrorOff, "off");
  mode(plan.mirrorOn, "on");
  mode(plan.mirrorAuto, "auto");

  // Варианты, которые после плана останутся включёнными, — без контрольного их не с чем сравнивать.
  if (!plan.forceControl) {
    const after = current.map((e) => ({
      ...e,
      enabled: plan.disable.includes(e.id)
        ? false
        : plan.enable.includes(e.id)
          ? true
          : e.enabled,
    }));
    for (const c of changes) {
      if (c.field !== "enabled" || c.to) continue;
      const variants = enabledVariantsOf(after, c.id);
      if (variants.length)
        throw new Error(
          `${c.id} — контрольный для ${variants.join(", ")}: без него варианты не с чем сравнивать. Выключить — только с согласия пользователя: --force-control`,
        );
    }
  }
  return changes;
}

const MODE_LABEL: Record<DemoMirrorMode, string> = {
  off: "Выкл (вручную)",
  auto: "Авто",
  on: "Вкл (вручную)",
};

const enabledState = (v: boolean) => (v ? "включён" : "выключен");

const reasonText = (r: { reason: string | null; note: string | null }) => {
  if (r.reason === null) return "—";
  const parsed = disableReasonSchema.safeParse(r.reason);
  const label = parsed.success ? DISABLE_REASONS[parsed.data] : r.reason;
  // «|» в тексте сломал бы строку таблицы apply.md.
  return (r.note ? `${label}: ${r.note}` : label).replaceAll("|", "\\|");
};

const row = (c: ApplyChange, what: string, from: string, to: string) =>
  `| ${c.id} | ${c.name} | ${what} | ${from} | ${to} |`;

function rows(c: ApplyChange): string[] {
  switch (c.field) {
    case "reason":
      return [row(c, "причина", reasonText(c.from), reasonText(c.to))];
    case "demoMirrorMode":
      return [
        row(
          c,
          "демо-зеркало",
          c.from === "auto"
            ? `Авто · ${c.demoMirror ? "вкл" : "выкл"}`
            : MODE_LABEL[c.from],
          c.to === "auto" ? "Авто (решит автомат)" : MODE_LABEL[c.to],
        ),
      ];
    case "enabled":
      return [
        row(c, "эксперимент", enabledState(c.from), enabledState(c.to)),
        ...(c.reason ? [row(c, "причина", "—", reasonText(c.reason))] : []),
      ];
  }
}

/** notes — что сразу решил автомат для переведённых в «Авто» (строки как в журнале, spec 0043). */
export function renderApplyMarkdown(
  at: string,
  database: string,
  changes: ApplyChange[],
  dryRun: boolean,
  notes: string[] = [],
): string {
  const title = `## ${at}${dryRun ? " (dry-run, не применено)" : ""}`;
  const head = [title, "", `БД: ${database}.`, ""];
  if (!changes.length)
    return [...head, "Изменений нет — всё уже в нужном состоянии.", ""].join(
      "\n",
    );
  return [
    ...head,
    "| id | Эксперимент | Что | Было | Стало |",
    "|---|---|---|---|---|",
    ...changes.flatMap(rows),
    "",
    ...(notes.length
      ? [
          "Авто-зеркало сразу после перевода в «Авто»:",
          "",
          ...notes.map((n) => `- ${n}`),
          "",
        ]
      : []),
  ].join("\n");
}
