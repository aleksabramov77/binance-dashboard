import type { DemoSummary } from "../model/view";

/**
 * Под числом демо-сделок: сколько входов не открылось (отказ биржи) и сколько зеркало пропустило
 * само (монета занята другим зеркалом, вход старше 10 минут).
 */
export function DemoMisses({
  d,
}: {
  d: Pick<DemoSummary, "rejected" | "skipped">;
}) {
  if (!d.rejected && !d.skipped) return null;
  return (
    <span
      className="block text-xs text-muted-foreground"
      title={`Отказ — биржа не приняла вход (нет монеты на демо, мин. объём). Пропуск — зеркало не повторяло вход: по монете уже есть зеркальная позиция другого эксперимента или вход старше 10 минут.`}
    >
      {[
        d.rejected > 0 && `${d.rejected} отказ`,
        d.skipped > 0 && `${d.skipped} пропуск`,
      ]
        .filter(Boolean)
        .join(" · ")}
    </span>
  );
}
