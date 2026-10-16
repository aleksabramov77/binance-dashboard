"use client";

import { EngineToggle } from "@/features/engine-toggle";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";

/** Тумблер «Автоторговля» (движок лаборатории) с пояснением — тот же, что в шапке (spec 0044). */
export function EngineCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Автоторговля</CardTitle>
        <CardDescription>
          Движок лаборатории: раз в минуту открывает paper-сделки включённых
          экспериментов и проверяет стопы и тейки открытых, демо-зеркало
          повторяет их на демо-счёте. Выключенный движок пропускает тик целиком:
          стопы и тейки не проверяются, а после включения пропущенные выходы
          закроются задним числом по 1m-свечам, демо-позиции — по текущей цене.
          Тот же тумблер — в шапке.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <EngineToggle className="text-sm" />
      </CardContent>
    </Card>
  );
}
