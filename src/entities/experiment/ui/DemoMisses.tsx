import { ScrollText } from "lucide-react";
import Link from "next/link";
import type { DemoSummary } from "../model/view";

const DEMO_MISSES_HINT =
  "Отказ — биржа не приняла вход или стоп (позиция не открыта или сразу закрыта). Пропуск — зеркало не повторяло вход: монеты нет на демо, встречная позиция другого эксперимента без Hedge mode или вход старше 10 минут.";

/**
 * Под числом демо-сделок: сколько входов не открылось (отказ биржи) и сколько зеркало пропустило
 * само (встречная позиция без Hedge mode, монеты нет на демо, вход старше 10 минут). logsHref — ссылка
 * на причины в журнале; её строит страница (журнал — другой слайс, spec 0016). Те же счётчики у реального счёта
 * (spec 0054) — со своей подсказкой title.
 */
export function DemoMisses({
  d,
  logsHref,
  title = DEMO_MISSES_HINT,
}: {
  d: Pick<DemoSummary, "rejected" | "skipped">;
  logsHref?: string;
  title?: string;
}) {
  if (!d.rejected && !d.skipped) return null;
  return (
    <span
      className="flex items-center justify-end gap-1 text-xs text-muted-foreground"
      title={title}
    >
      <span>
        {[
          d.rejected > 0 && `${d.rejected} отказ`,
          d.skipped > 0 && `${d.skipped} пропуск`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
      {logsHref && (
        <Link
          href={logsHref}
          className="hover:text-foreground"
          title="Причины отказов и пропусков — в журнале"
          aria-label="Отказы и пропуски в журнале"
          onClick={(e) => e.stopPropagation()}
        >
          <ScrollText className="size-3.5" />
        </Link>
      )}
    </span>
  );
}
