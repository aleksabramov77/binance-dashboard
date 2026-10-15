import {
  aprRange,
  EARN_KIND_INFO,
  EARN_KINDS,
  type EarnKind,
  type KindSummary,
  type KindTab,
  PrincipalBadge,
  RiskDots,
} from "@/entities/earn-product";
import { DIVERSIFICATION_RULES } from "@/features/allocation-advice";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";

const TAB_LINKS: Record<KindTab, string> = {
  simple: "Открыть Simple Earn",
  dual: "Открыть Dual Investment",
  staking: "Открыть Стейкинг и DeFi",
};

/** Живой диапазон APR вида по всем активам сводки. */
function liveRange(kind: EarnKind, summary: KindSummary[] | undefined) {
  const rows = (summary ?? []).filter((s) => s.kind === kind);
  if (rows.length === 0) return null;
  const min = Math.min(...rows.map((r) => r.minApr));
  const max = Math.max(...rows.map((r) => r.maxApr));
  return {
    text: aprRange(min, max),
    assets: rows.map((r) => r.asset).join(", "),
  };
}

function Section({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <p>{text}</p>
    </div>
  );
}

/** Гид: карточка каждого вида Earn с риском, ликвидностью и живыми ставками + правила диверсификации. */
export function EarnGuide({
  summary,
  onOpenTab,
}: {
  summary: KindSummary[] | undefined;
  onOpenTab: (tab: KindTab) => void;
}) {
  return (
    <div className="flex flex-col gap-8">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Правила диверсификации</h2>
        <ol className="grid gap-3 md:grid-cols-2">
          {DIVERSIFICATION_RULES.map((rule, i) => (
            <li key={rule.title} className="rounded-xl border p-4 text-sm">
              <p className="font-medium">
                {i + 1}. {rule.title}
              </p>
              <p className="mt-1 text-muted-foreground">{rule.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Виды продуктов Earn</h2>
        <p className="text-sm text-muted-foreground">
          От самых спокойных к самым рискованным. «Капитал защищён» значит, что
          вернётся то же количество монет; их цена в долларах при этом может
          меняться.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          {[...EARN_KINDS]
            .sort(
              (a, b) =>
                EARN_KIND_INFO[a].riskLevel - EARN_KIND_INFO[b].riskLevel,
            )
            .map((kind) => {
              const info = EARN_KIND_INFO[kind];
              const live = liveRange(kind, summary);
              return (
                <Card key={kind}>
                  <CardHeader>
                    <CardTitle className="flex items-start justify-between gap-3 text-base">
                      {info.title}
                      <RiskDots level={info.riskLevel} withLabel />
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {info.tagline}
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Badge variant="outline">{info.liquidity}</Badge>
                      <PrincipalBadge kind={kind} withLabel />
                      {live && (
                        <Badge variant="secondary" title={live.assets}>
                          сейчас {live.text}
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <Section title="Как работает" text={info.howItWorks} />
                    <Section
                      title="Что можно потерять"
                      text={info.whatYouCanLose}
                    />
                    <Section title="Кому подходит" text={info.whoFor} />
                    {info.tab && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => info.tab && onOpenTab(info.tab)}
                      >
                        {TAB_LINKS[info.tab]}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
        </div>
      </section>
    </div>
  );
}
