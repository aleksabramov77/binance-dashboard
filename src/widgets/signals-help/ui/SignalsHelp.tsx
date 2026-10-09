import { Sparkles, Zap } from "lucide-react";

function Item({
  title,
  children,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <p className="font-medium text-foreground">{title}</p>
      <div className="text-muted-foreground">{children}</div>
    </div>
  );
}

/** Справка по карточкам сетапов: цвета кнопок, статусы, разбор ИИ, предпроверка и риск. */
export function SignalsHelp() {
  return (
    <details className="group rounded-xl border bg-card px-4 py-3 text-sm">
      <summary className="cursor-pointer select-none font-medium">
        Как читать карточки и кнопки
        <span className="ml-2 text-xs font-normal text-muted-foreground group-open:hidden">
          (развернуть)
        </span>
      </summary>
      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <Item
          title={
            <span className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                <Zap className="size-3" /> жёлтая
              </span>
              кнопка «Сделка в 1 клик»
            </span>
          }
        >
          Статус «можно входить»: условия сетапа выполнены <b>и</b> последняя
          часовая свеча уже развернулась в сторону сделки (для лонга — зелёная,
          для шорта — красная). Это более надёжный момент входа.
        </Item>
        <Item
          title={
            <span className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs">
                <Zap className="size-3" /> чёрная
              </span>
              кнопка «Сделка в 1 клик»
            </span>
          }
        >
          Статус «ждём разворота»: перекупленность/перепроданность уже есть, но
          цена ещё продолжает двигаться против идеи. Войти можно, но риск
          «поймать нож» выше — обычно разумнее дождаться разворотной свечи и
          пересканировать.
        </Item>
        <Item title="Кнопки сделки нет совсем">
          Монеты нет в Binance Demo Trading (например, CT на демо-фьючерсах) —
          открыть демо-сделку по ней нельзя, поэтому вместо кнопки — пометка.
        </Item>
        <Item
          title={
            <span className="flex items-center gap-2">
              <Sparkles className="size-4" /> «Разбор от ИИ»
            </span>
          }
        >
          Второе мнение модели (Claude Haiku через OpenRouter, ≈ $0,0004): она
          смотрит на цифры сетапа и даёт вердикт — входить, ждать или
          пропустить, аргументы за и против и условие, при котором идея
          ломается. Это не прогноз цены и не обязательный шаг: сделка от разбора
          не зависит. После нажатия кнопка заменяется результатом — поэтому на
          части карточек её «нет»: там разбор уже показан (повтор в течение 15
          минут бесплатный).
        </Item>
        <Item title="Что происходит при нажатии «Сделка в 1 клик»">
          Окно само перепроверяет сетап по свежим свечам: «актуален», «уровни
          обновлены» (SL/TP подставляются автоматически) или «входить уже не
          стоит» (кнопка блокируется с причиной). Затем — вход по рынку и сразу
          Stop Loss и Take Profit на бирже.
        </Item>
        <Item title="Риск">
          Потеря на стопе — не больше 2% баланса кошелька (по умолчанию 1%
          капитала, объём — не больше лимита на сделку). Если денег на кошельке
          не хватает или риск больше 2%, окно скажет об этом до отправки, а
          сервер дополнительно откажет.
        </Item>
      </div>
    </details>
  );
}
