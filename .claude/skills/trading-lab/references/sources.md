# Источники методологии

Скилл написан для проекта по мотивам открытых наборов скиллов и литературы (найдены 2026-10-15). Чужие
скиллы не установлены целиком: они рассчитаны на акции США, Python и платные API (FMP, FinViz, Alpaca), а
лаборатория — крипта, TypeScript и свои сделки в БД. Взята методология; при желании их можно поставить
отдельно в `~/.claude/skills/` — сначала прочитав код.

| Источник | Лицензия | Что взято |
|---|---|---|
| [tradermonty/claude-trading-skills](https://github.com/tradermonty/claude-trading-skills) — `backtest-expert` | MIT | «наказывай стратегию», плато вместо пика, пороги выборки 30/100/200, флаг «слишком хорошо», решения deploy/refine/abandon |
| там же — `trade-hypothesis-ideator`, `edge-strategy-reviewer` | MIT | карточки гипотез с вердиктом pursue/revise/discard и kill-критериями; ревью на переобучение (число фильтров, точные пороги) |
| там же — `signal-postmortem`, `strategy-pivot-designer` | MIT | разбор исходов сигналов с минимальной выборкой; смена архетипа и инверсия допущения, когда тюнинг застрял |
| [agiprolabs/claude-trading-skills](https://github.com/agiprolabs/claude-trading-skills) | MIT | крипто-ориентированный набор: TA (ta-lib, pandas-ta), walk-forward, risk management, exit-strategies, regime-detection |
| [shakeebshaan/claude-code-quant-skills](https://github.com/shakeebshaan/claude-code-quant-skills) | MIT | чек-лист аудита бэктеста (look-ahead, survivorship, издержки, режимная зависимость), «скептичный риск-менеджер» |
| [Do Candlestick Patterns Work in Cryptocurrency Trading?](https://ieeexplore.ieee.org/document/9671826) (IEEE, 2021) | — | 68 паттернов на топ-23 криптовалютах почти не предсказывают |

Если понадобится полноценный бэктест на истории (а не только живой paper-поток), ориентиры — разделы
`walk-forward-validation` и `vectorbt` у agiprolabs; в проекте это была бы отдельная фича.
