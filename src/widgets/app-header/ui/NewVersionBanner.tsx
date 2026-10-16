"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { useNewVersionAvailable } from "../api/useNewVersionAvailable";

/**
 * Вкладка открыта на старой сборке: предлагаем обновиться, но сами не перезагружаем —
 * не теряется ввод (например, в форме сделки).
 */
export function NewVersionBanner() {
  const available = useNewVersionAvailable();
  if (!available) return null;
  return (
    <output className="flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b bg-primary/10 px-4 py-1.5 text-sm sm:px-8">
      <span>Вышла новая версия</span>
      <Button
        size="xs"
        variant="outline"
        onClick={() => window.location.reload()}
      >
        <RefreshCw aria-hidden />
        Обновить
      </Button>
    </output>
  );
}
