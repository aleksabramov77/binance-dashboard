"use client";

import { Suspense } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { EARN_TABS, type EarnTab, useEarnView } from "../model/useEarnView";
import { DualTab } from "./DualTab";
import { GuideTab } from "./GuideTab";
import { SimpleEarnTab } from "./SimpleEarnTab";
import { StakingTab } from "./StakingTab";

const TAB_LABELS: Record<EarnTab, string> = {
  simple: "Simple Earn",
  dual: "Dual Investment",
  staking: "Стейкинг и DeFi",
  guide: "Гид и диверсификация",
};

function EarnView() {
  const [{ tab }, setView] = useEarnView();
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Earn</h1>
        <p className="text-sm text-muted-foreground">
          Где на Binance можно получать доход, чем рискуете и как разложить
          сумму.
        </p>
      </header>
      {/* Неактивные вкладки не монтируются: каталог по ключу грузится только с Dual, Стейкинга и Гида. */}
      <Tabs
        value={tab}
        onValueChange={(value) => setView({ tab: value as EarnTab })}
        className="gap-6"
      >
        <TabsList className="h-auto flex-wrap">
          {EARN_TABS.map((t) => (
            <TabsTrigger key={t} value={t}>
              {TAB_LABELS[t]}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="simple">
          <SimpleEarnTab />
        </TabsContent>
        <TabsContent value="dual">
          <DualTab />
        </TabsContent>
        <TabsContent value="staking">
          <StakingTab />
        </TabsContent>
        <TabsContent value="guide">
          <GuideTab onOpenTab={(next) => setView({ tab: next })} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function EarnPage() {
  return (
    <Suspense>
      <EarnView />
    </Suspense>
  );
}
