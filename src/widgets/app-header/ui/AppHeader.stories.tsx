import { usePathname } from "@storybook/nextjs-vite/navigation.mock";
import { delay, HttpResponse, http, type RequestHandler } from "msw";
import { expect, waitFor, within } from "storybook/test";
import { flag, select } from "#.storybook/controls";
import preview, { QueryProvider } from "#.storybook/preview";
import type { AccountBalances } from "@/entities/account-balance";
import type { AiCredits } from "@/entities/ai-credits";
import type {
  EngineExposure,
  EngineStatus,
  ExperimentBudgets,
} from "@/entities/experiment";
import { NAV_ITEMS } from "@/shared/config";
import { AppHeader } from "./AppHeader";

// Все состояния шапки (задача 0051): данные подменяет MSW — те же эндпоинты, что зовут хуки частей шапки.
// Каждая история — набор аргументов-сценариев (SCENARIO), Playground меняет их контролами.

const AT = "2026-10-16T09:30:00.000Z";
const PULSE = "2026-10-16T09:29:10.000Z";

const budgets: ExperimentBudgets = {
  runId: 7,
  markets: [
    {
      market: "spot",
      initial: 1000,
      realized: 32.4,
      fees: 3.1,
      unrealized: 5.2,
      openTrades: 3,
      equity: 1037.6,
      change: 37.6,
      changePct: 0.0376,
    },
    {
      market: "usdm",
      initial: 1000,
      realized: -12.3,
      fees: 4.8,
      unrealized: 2.1,
      openTrades: 2,
      equity: 989.8,
      change: -10.2,
      changePct: -0.0102,
    },
    {
      market: "coinm",
      initial: 500,
      realized: 0,
      fees: 0,
      unrealized: 0,
      openTrades: 0,
      equity: 500,
      change: 0,
      changePct: 0,
    },
  ],
};

const losingBudgets: ExperimentBudgets = {
  runId: 7,
  markets: budgets.markets.map((b) => ({
    ...b,
    realized: -b.initial * 0.08,
    unrealized: null,
    equity: b.initial * 0.92,
    change: -b.initial * 0.08,
    changePct: -0.08,
  })),
};

const wallet = (usd: number | null, hint: string | null = null, at?: string) =>
  ({ usd, hint, at }) as const;

const balances: AccountBalances = {
  demo: {
    spot: wallet(5023.17),
    usdm: wallet(4870.02),
    coinm: wallet(1210.4),
  },
  real: {
    spot: wallet(152.3, null, PULSE),
    usdm: wallet(48.15, null, PULSE),
    coinm: wallet(0, null, PULSE),
  },
  at: AT,
};

/** «—» с причиной и оговорки при числе: звёздочка в ячейке и строки под таблицей поповера. */
const balancesWithHints: AccountBalances = {
  demo: {
    spot: wallet(5023.17, "часть активов без цены — не учтены"),
    usdm: wallet(4870.02),
    coinm: wallet(null, "COIN-M на Demo недоступен"),
  },
  real: {
    spot: wallet(null, "воркер реального счёта молчит больше 5 минут"),
    usdm: wallet(null, "воркер реального счёта молчит больше 5 минут"),
    coinm: wallet(null, "воркер реального счёта молчит больше 5 минут"),
  },
  at: AT,
};

const lastTick: NonNullable<EngineStatus["lastTick"]> = {
  status: "ok",
  runner: "supabase",
  at: AT,
  opened: 2,
  closed: 1,
  evaluated: [],
  errors: [],
};

const engineOn: EngineStatus = {
  enabled: true,
  runner: "supabase",
  processRunner: "supabase",
  lastTick,
};

const engineOff: EngineStatus = {
  ...engineOn,
  enabled: false,
  lastTick: { ...lastTick, status: "disabled", opened: 0, closed: 0 },
};

const aiCredits: AiCredits = {
  configured: true,
  balanceUsd: 7.42,
  totalCreditsUsd: 20,
  totalUsageUsd: 12.58,
  keyLimitUsd: 10,
  keyRemainingUsd: 7.42,
  keyUsageUsd: 2.58,
};

const exposure: EngineExposure = { openPaper: 5, openDemo: 2 };

// Аватар — встроенной картинкой: истории не ходят в сеть.
const AVATAR = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" fill="#f0b90b"/><text x="14" y="19" font-size="13" font-family="sans-serif" text-anchor="middle" fill="#1e2026">AA</text></svg>',
)}`;

const session = {
  user: { login: "aleksabramov77", name: "Aleksandr", image: AVATAR },
};

const API = {
  budgets: "/api/experiments/budgets",
  balances: "/api/accounts/balances",
  engine: "/api/experiments/engine",
  exposure: "/api/experiments/engine/exposure",
  ai: "/api/openrouter/balance",
  session: "/api/auth/session",
  version: "/api/version",
} as const;

const ok = (url: string, body: unknown) =>
  http.get(url, () => HttpResponse.json(body as never));

const fail = (url: string, error: string, status = 502) =>
  http.get(url, () => HttpResponse.json({ error }, { status }));

/** Ответ, который не приходит никогда: состояние «загружается». */
const pending = (url: string) =>
  http.get(url, async () => {
    await delay("infinite");
    return HttpResponse.json(null);
  });

/** Ответ на переключение «Автоторговли»: успех — новый статус, ошибка — 503, «выполняю…» — не приходит никогда. */
const toggleOk = http.post(API.engine, async ({ request }) => {
  const { enabled } = (await request.json()) as { enabled: boolean };
  return HttpResponse.json({ ...engineOn, enabled });
});

// Сценарии данных шапки: у каждой части — все её состояния. Это аргументы историй и контролы Playground.
const SCENARIO = {
  engine: {
    вкл: ok(API.engine, engineOn),
    выкл: ok(API.engine, engineOff),
    загрузка: pending(API.engine),
    ошибка: fail(API.engine, "Движок лаборатории не ответил"),
  },
  paper: {
    плюс: ok(API.budgets, budgets),
    минус: ok(API.budgets, losingBudgets),
    загрузка: pending(API.budgets),
    ошибка: fail(API.budgets, "База лаборатории недоступна"),
  },
  balances: {
    обычные: ok(API.balances, balances),
    "с оговорками и «—»": ok(API.balances, balancesWithHints),
    загрузка: pending(API.balances),
    ошибка: fail(API.balances, "Binance Demo: таймаут"),
  },
  ai: {
    обычный: ok(API.ai, aiCredits),
    "мало кредитов": ok(API.ai, {
      ...aiCredits,
      balanceUsd: 0.37,
      keyRemainingUsd: 0.37,
    } satisfies AiCredits),
    "ключ не настроен": ok(API.ai, { configured: false } satisfies AiCredits),
    загрузка: pending(API.ai),
    ошибка: fail(API.ai, "OpenRouter: 401 Unauthorized"),
  },
  session: {
    вошли: ok(API.session, session),
    "без аватара": ok(API.session, { user: { login: "aleksabramov77" } }),
    "не вошли": ok(API.session, {}),
    "вход отключён локально": ok(API.session, { authDisabled: true }),
    загрузка: pending(API.session),
  },
  exposure: {
    "5 сделок и 2 позиции": ok(API.exposure, exposure),
    "нет открытых": ok(API.exposure, {
      openPaper: 0,
      openDemo: 0,
    } satisfies EngineExposure),
    загрузка: pending(API.exposure),
    ошибка: fail(API.exposure, "Не удалось посчитать сделки"),
  },
  toggle: {
    успех: toggleOk,
    ошибка: http.post(API.engine, () =>
      HttpResponse.json(
        { error: "Нет связи с базой лаборатории" },
        { status: 503 },
      ),
    ),
    "выполняю…": http.post(API.engine, async () => {
      await delay("infinite");
      return HttpResponse.json(null);
    }),
  },
} satisfies Record<string, Record<string, RequestHandler>>;

type Part = keyof typeof SCENARIO;
const PARTS = Object.keys(SCENARIO) as Part[];
const PATHNAMES = [...NAV_ITEMS.map((i) => i.href), "/experiments/42", "/"];

type Scenario = { [K in Part]: keyof (typeof SCENARIO)[K] } & {
  /** Вкладка открыта на старой сборке, сервер уже на новой — баннер «Вышла новая версия». */
  newVersion: boolean;
  /** Текущий адрес — подсветка раздела в навигации. */
  pathname: string;
};

/** Шапка в сценарии: пропсы — контролы Playground, данные под них ставит декоратор (MSW). */
function AppHeaderScenario(_: Scenario) {
  return <AppHeader />;
}

const optionsOf = (part: Part) =>
  select(Object.keys(SCENARIO[part]), { optional: false });

const meta = preview.meta({
  title: "Widgets/AppHeader",
  component: AppHeaderScenario,
  args: {
    engine: "вкл",
    paper: "плюс",
    balances: "обычные",
    ai: "обычный",
    session: "вошли",
    exposure: "5 сделок и 2 позиции",
    toggle: "успех",
    newVersion: false,
    pathname: "/portfolio",
  } satisfies Scenario,
  argTypes: {
    engine: {
      ...optionsOf("engine"),
      description: "Статус движка (тумблер «Автоторговля»)",
    },
    paper: {
      ...optionsOf("paper"),
      description: "Бюджеты лаборатории — Paper в чипах",
    },
    balances: { ...optionsOf("balances"), description: "Остатки Demo и Real" },
    ai: { ...optionsOf("ai"), description: "Баланс OpenRouter (ИИ)" },
    session: {
      ...optionsOf("session"),
      description: "Вход (меню пользователя)",
    },
    exposure: {
      ...optionsOf("exposure"),
      description: "Подсчёт открытых сделок в модалке выключения",
    },
    toggle: {
      ...optionsOf("toggle"),
      description: "Ответ на подтверждение в модалке тумблера",
    },
    newVersion: flag({ optional: false }),
    pathname: select(PATHNAMES, { optional: false }),
  },
  // Аргументы → моки и адрес. Новый кэш запросов на каждый набор аргументов: смена контрола сразу перезапрашивает.
  decorators: [
    (Story, { args, msw }) => {
      msw.resetHandlers(
        ...PARTS.map(
          (part) =>
            (SCENARIO[part] as Record<string, RequestHandler>)[args[part]],
        ),
        ok(API.version, { version: args.newVersion ? "build-new" : null }),
      );
      if (args.newVersion) document.documentElement.dataset.dplId = "build-old";
      else delete document.documentElement.dataset.dplId;
      usePathname.mockReturnValue(args.pathname);
      return (
        <QueryProvider key={JSON.stringify(args)}>
          <Story />
        </QueryProvider>
      );
    },
  ],
  beforeEach: () => () => {
    delete document.documentElement.dataset.dplId;
    usePathname.mockReset();
  },
});

const phone = { viewport: { value: "phone", isRotated: false } };
const tablet = { viewport: { value: "tablet", isRotated: false } };

export const Playground = meta.story({ name: "Playground" });

export const Loading = meta.story({
  name: "Загрузка",
  args: {
    engine: "загрузка",
    paper: "загрузка",
    balances: "загрузка",
    ai: "загрузка",
    session: "загрузка",
  },
});

export const ApiErrors = meta.story({
  name: "Ошибки API",
  args: { engine: "ошибка", paper: "ошибка", balances: "ошибка", ai: "ошибка" },
});

export const EngineOff = meta.story({
  name: "Автоторговля выключена",
  args: { engine: "выкл" },
});

export const PaperLoss = meta.story({
  name: "Paper в минусе",
  args: { paper: "минус" },
});

export const WalletHints = meta.story({
  name: "Счета с оговорками и «—»",
  args: { balances: "с оговорками и «—»" },
});

export const AiLow = meta.story({
  name: "ИИ: мало кредитов",
  args: { ai: "мало кредитов" },
});

export const AiNotConfigured = meta.story({
  name: "ИИ: ключ не настроен",
  args: { ai: "ключ не настроен" },
});

export const AuthDisabled = meta.story({
  name: "Вход отключён локально",
  args: { session: "вход отключён локально" },
});

export const SignedOut = meta.story({
  name: "Не вошли",
  args: { session: "не вошли" },
});

export const NoAvatar = meta.story({
  name: "Без аватара",
  args: { session: "без аватара" },
});

export const NewVersion = meta.story({
  name: "Вышла новая версия",
  args: { newVersion: true },
});

export const OtherSection = meta.story({
  name: "Активный раздел «Эксперименты»",
  args: { pathname: "/experiments/42" },
});

export const Phone = meta.story({ name: "Телефон", globals: phone });

export const PhoneNewVersion = meta.story({
  name: "Телефон: новая версия и ошибки",
  globals: phone,
  args: { newVersion: true, balances: "ошибка", ai: "ошибка" },
});

export const Tablet = meta.story({ name: "Планшет", globals: tablet });

// Первый запуск холодный (воркер MSW, компиляция Vite): данные могут прийти позже секунды по умолчанию.
const WAIT = { timeout: 5000 };

const body = () => within(document.body);

/** Поповер и модалка появляются с анимацией (opacity от 0) — видимость ждём, а не проверяем в первый кадр. */
const visible = (el: HTMLElement) =>
  waitFor(() => expect(el).toBeVisible(), WAIT);

export const AccountsPopover = meta.story({
  name: "Поповер счетов",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByText("SPOT"));
    await visible(await body().findByText("Сбросы →"));
  },
});

export const AccountsPopoverHints = meta.story({
  name: "Поповер счетов с оговорками",
  args: WalletHints.input.args,
  play: AccountsPopover.input.play,
});

export const PhoneAccountsPopover = meta.story({
  name: "Телефон: поповер счетов",
  globals: phone,
  play: async ({ canvas, userEvent }) => {
    await canvas.findByText("+1,10%", {}, WAIT);
    await userEvent.click(await canvas.findByText("Счета"));
    await visible(await body().findByText("Сбросы →"));
  },
});

/** Нажать на тумблер «Автоторговля», когда статус загрузится, и дождаться модалки. */
const openEngineDialog = async ({
  canvas,
  userEvent,
}: {
  canvas: ReturnType<typeof within>;
  userEvent: { click: (el: Element) => Promise<void> };
}) => {
  const toggle = await canvas.findByRole("switch");
  await waitFor(() => expect(toggle).toBeEnabled(), WAIT);
  await userEvent.click(toggle);
  return body().findByRole("dialog");
};

export const DisableEngineDialog = meta.story({
  name: "Модалка: выключить автоторговлю",
  play: async (context) => {
    const dialog = await openEngineDialog(context);
    await visible(
      await within(dialog).findByText(/перестанут проверяться/, {}, WAIT),
    );
  },
});

export const DisableEngineDialogCounting = meta.story({
  name: "Модалка: считаю открытые сделки…",
  args: { exposure: "загрузка" },
  play: async (context) => {
    const dialog = await openEngineDialog(context);
    await visible(await within(dialog).findByText("Считаю открытые сделки…"));
  },
});

export const DisableEngineDialogCountError = meta.story({
  name: "Модалка: сделки не посчитались",
  args: { exposure: "ошибка" },
  play: async (context) => {
    const dialog = await openEngineDialog(context);
    await visible(
      await within(dialog).findByText(
        /^Открытые paper-сделки и демо-позиции/,
        {},
        WAIT,
      ),
    );
  },
});

export const DisableEngineDialogNothingOpen = meta.story({
  name: "Модалка: открытых сделок нет",
  args: { exposure: "нет открытых" },
  play: async (context) => {
    const dialog = await openEngineDialog(context);
    await visible(
      await within(dialog).findByText(/^Открыто 0 paper-сделок/, {}, WAIT),
    );
  },
});

export const EnableEngineDialog = meta.story({
  name: "Модалка: включить автоторговлю",
  args: { engine: "выкл" },
  play: async (context) => {
    await openEngineDialog(context);
  },
});

const confirmDisable = async (
  context: Parameters<typeof openEngineDialog>[0],
  expected: string,
) => {
  const dialog = await openEngineDialog(context);
  await context.userEvent.click(
    within(dialog).getByRole("button", { name: "Выключить" }),
  );
  await visible(await within(dialog).findByText(expected, {}, WAIT));
};

export const ToggleEngineError = meta.story({
  name: "Модалка: переключение не удалось",
  args: { toggle: "ошибка" },
  play: (context) => confirmDisable(context, "Нет связи с базой лаборатории"),
});

export const ToggleEnginePending = meta.story({
  name: "Модалка: выполняю…",
  args: { toggle: "выполняю…" },
  play: (context) => confirmDisable(context, "Выполняю…"),
});
