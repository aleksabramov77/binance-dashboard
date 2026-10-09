"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { useRefreshSnapshot } from "../api/useRefreshSnapshot";

export function RefreshButton() {
  const { mutate, isPending, error } = useRefreshSnapshot();
  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={() => mutate()} disabled={isPending}>
        <RefreshCw className={isPending ? "animate-spin" : undefined} />
        {isPending ? "Загружаю с Binance…" : "Обновить сейчас"}
      </Button>
      {error && <p className="text-xs text-destructive">{error.message}</p>}
    </div>
  );
}
