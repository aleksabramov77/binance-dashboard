"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AiCreditsBadge } from "@/entities/ai-credits";
import { MarketBudgets } from "@/entities/experiment";
import { UserMenu } from "@/features/auth";
import { EngineToggle } from "@/features/engine-toggle";
import { NAV_ITEMS } from "@/shared/config";
import { cn } from "@/shared/lib";

// Хедер — слой платформы: склеивает домены (Лаборатория, ИИ-кредиты, вход) только через их public API.
export function AppHeader() {
  const pathname = usePathname();
  return (
    <header className="border-b bg-card/60 backdrop-blur">
      <div className="flex w-full flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-2 font-semibold tracking-tight"
        >
          <span className="size-2.5 rotate-45 bg-primary" aria-hidden />
          Binance Dashboard
        </Link>
        {/* Лаборатория: на узком экране — отдельной строкой под логотипом, с переносом. */}
        <div className="order-last flex w-full min-w-0 flex-wrap items-center gap-x-4 gap-y-1 lg:order-none lg:w-auto">
          <EngineToggle />
          <MarketBudgets />
        </div>
        <div className="ml-auto flex items-center gap-4">
          <AiCreditsBadge />
          <UserMenu />
        </div>
      </div>
      <nav className="flex w-full gap-1 overflow-x-auto px-4 pb-2 text-sm sm:px-8">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "shrink-0 rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground",
              pathname?.startsWith(item.href) && "bg-secondary text-foreground",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
