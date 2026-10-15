/** Параметры тика движка экспериментов (spec 003). */
export const ENGINE = {
  /** Свечей TF сигнала: хватает на EMA/SMA 200 с прогревом. */
  signalCandles: 300,
  /** Свечей при дозагрузке, когда кэш уже есть (новые свечи + перекрытие). */
  refreshCandles: 10,
  /** Максимум 1m-свечей за один запрос Binance (лимит API). */
  maxMinuteCandles: 1000,
  /**
   * Страниц 1m-свечей на символ за тик при догрузке после простоя: 3 × 1000 мин ≈ 50 ч. Больший разрыв
   * дочитывается следующими тиками (раз в минуту) — бережём вес API: на фьючерсах запрос 1000 свечей
   * весит 5 при лимите 2400 в минуту, а символов с открытыми сделками бывают десятки.
   */
  maxMinutePages: 3,
  /** Одновременных запросов к Binance — бережём rate limit. */
  concurrency: 8,
  /** Минимальный оборот за 24 ч для movers — отсекаем неликвид. */
  moversMinQuoteVolume: 20_000_000,
  /** Объём каждой paper-сделки, USD (решение пользователя 2026-10-10). */
  tradeNotionalUsd: 50,
  /** Плечо paper-фьючерсов (USDⓈ-M и COIN-M): маржа = объём. */
  futuresLeverage: 1,
  /**
   * Окно свежести сигнала: вход — только если свеча TF закрылась не раньше max(3 мин, 5% TF) назад
   * (5m/15m/1h — 3 мин, 4h — 12 мин, 1d — 72 мин). 3 мин = интервал тика + запас.
   */
  minSignalAgeMs: 3 * 60_000,
  signalAgeShare: 0.05,
  /** Длина ATR для стопов и трейлинга. */
  atrPeriod: 14,
  /**
   * Отсечённые сигналы (spec 0030): не больше строк на (эпоха, эксперимент, причина). Прод — Supabase Free
   * (500 МБ, features/db-space): строка с индексами ≈ 0,2 КБ, худший случай 3 причины × 500 × ~45
   * экспериментов ≈ 13 МБ на эпоху. Для разбора хватает выборки; сверх лимита сигналы не пишутся.
   */
  skippedSignalsCap: 500,
  /** Срок хранения отсечённых сигналов, дней: старые эпохи не копятся в базе. */
  skippedSignalsRetentionDays: 45,
  /** Символ режима рынка в контексте входа (BTC 4h, spec 0030). */
  contextBtcSymbol: "BTCUSDT",
} as const;

/** Хвост символа группы после базы: BTCUSDT, BTCUSD_PERP (бессрочный COIN-M). */
export const SYMBOL_SUFFIX = {
  spot: "USDT",
  usdm: "USDT",
  coinm: "USD_PERP",
} as const;

/** Плечевые токены Binance — не торгуем. */
export const LEVERAGED_TOKEN = /(UP|DOWN|BULL|BEAR)USDT$/;

/**
 * Стейблкоины (база ≈ 1 USD) — исключаем из юниверса. Копия списка shared/config/stablecoins:
 * модуль движка не импортирует @/… — его исходники исполняет и Deno (Edge Function Supabase).
 */
export const STABLECOINS = new Set([
  "USDT",
  "USDC",
  "FDUSD",
  "TUSD",
  "USDP",
  "DAI",
  "BFUSD",
  "USD1",
  "RLUSD",
  "PYUSD",
  "USDE",
  "USDS",
  "XUSD",
  "U",
  "BUSD",
  "EUR",
  "EURI",
  "AEUR",
]);

/**
 * Не-крипто активы (spec 0029) — исключаем из юниверса: в нём только крипта. Spot `exchangeInfo` не
 * отличает токенизированные акции и металлы от монет, поэтому список явный: металлы и индексы, затем
 * токенизированные акции и ETF Binance (база с суффиксом B — снимок spot `exchangeInfo` на 2026-10-15,
 * новые листинги дописывать сюда). Futures дополнительно фильтрует поставщик тикеров по `underlyingType`.
 */
export const NON_CRYPTO = new Set([
  // Металлы и индексы.
  "PAXG",
  "XAUT",
  "XAU",
  "XAG",
  "BTCDOM",
  // Токенизированные акции и ETF.
  ..."AAOIB AAPLB ADBEB AGPUB ALABB AMATB AMCB AMDB AMZNB ARMB ASMLB ASTSB AVGOB AXTIB BABAB BBB BEB BMNRB BNCB CBRSB COHRB COINB CRCLB CRDOB CRMB CRWDB CRWVB CYPHB DELLB DJTB DRAMB EWYB FLNCB FWDIB GLWB GMEB GOOGLB GPROB GSB HIMSB HOODB HPEB IBMB INTCB INTWB IRENB JPMB KORUB LITEB LLYB MDBB METAB MRNAB MRVLB MSFTB MSTRB MUB MUUB MVLLB NBISB NFLXB NOKB NVDAB ORCLB PDDB PENGB PLTRB PYPLB QCOMB QNTB QQQB RDDTB RKLBB SECZB SHAZB SKHYB SMCIB SMHB SNDKB SNXXB SOXLB SOXSB SPCXB SPYB SQQQB STXB TQQQB TSLAB TSMB USARB USDEB UVXYB WDCB WENB ZMB".split(
    " ",
  ),
]);
