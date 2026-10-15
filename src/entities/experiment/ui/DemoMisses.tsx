import type { DemoSummary } from "../model/view";

/**
 * Под числом демо-сделок: сколько входов не открылось (отказ биржи) и сколько зеркало пропустило
 * само (монета занята другим зеркалом, монеты нет на демо, вход старше 10 минут).
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
      title={`Отказ — биржа не приняла вход или стоп (позиция не открыта или сразу закрыта). Пропуск — зеркало не повторяло вход: монеты нет на демо, по монете уже есть зеркальная позиция другого эксперимента или вход старше 10 минут.`}
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
